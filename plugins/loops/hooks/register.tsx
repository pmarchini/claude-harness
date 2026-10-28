import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import { detectCommands, repeatAt, toYaml } from '../src/editor.ts'
import { renderLoop } from '../src/graph.ts'
import type { EditorState } from '../types'
import {
  addBlock,
  back,
  blockChoices,
  describeStep,
  drawnSteps,
  moveCursor,
  nameLoop,
  newEditor,
  openField,
  openPicker,
  rangeChoices,
  removeStep,
  setCommand,
  setRounds,
  setUntil,
  start,
  startChoices,
  untilChoices,
  warn,
  whyNotSavable,
  wrapRange,
} from './editor-state.ts'
import type { Choice } from './editor-state.ts'

const EDITOR_PANE = 'loops-editor'

// Change the tag when EditorState's fields change: it declines what an
// earlier version stored, which outlives a reload.
const editor = atom({ plugin: 'loops', key: 'editor' } as const, newEditor(detectCommands([])), { shape: 'editor-3' })

/** The stages the title shows the person moving through. */
const PROGRESS = ['name', 'start', 'build', 'save'] as const
// Saved is past the last stage, so every one shows as done.
const PROGRESS_AT: Record<EditorState['stage'], number> = { name: 0, start: 1, edit: 2, saved: 4 }

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      // Claude Code ships its own /loops, so this one cannot take that name.
      name: 'loop-manager',
      description: 'Build, show and run loops: /loop-manager new opens the editor',
    })

    return next(e)
  })

  on('command.run', { command: 'loop-manager' }, async ($, e) => {
    const [subcommand, ...rest] = splitArgs(e.args)
    if (subcommand !== 'new') return runCli($, [subcommand ?? 'validate', ...rest])

    const commands = detectCommands((await $.fs.list()).map(entry => entry.name))
    await update($, editor, () => newEditor(commands))
    await $.ui.open({ id: EDITOR_PANE, title: 'New loop', focus: true })

    return { text: 'Opened the loop editor.' }
  })

  on('ui.render', { component: 'Pane', requestId: EDITOR_PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    if (!('Input' in elements)) {
      const { Text } = elements
      return <Text>Building a loop needs text fields: open it in the terminal or the desktop app.</Text>
    }

    const { Box, Text, Input, Button } = elements
    const state = await read($, editor)
    const change = (fn: (state: EditorState) => EditorState) => update($, editor, fn)
    /** Opens a field and puts the cursor in it, so typing goes there at once. */
    const editField = async (field: NonNullable<EditorState['editing']>) => {
      await change(s => openField(s, field))
      await focus($, `${field}-field`)
    }

    /** The pane's frame: title and progress on top, the stage's body, then what was said and the key hints. */
    const Frame = ({ hints, children }: { hints: string; children: RenderChildren }) => (
      <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color="claude">
            ◆ New loop{state.loop.name && state.stage !== 'name' ? ` · ${state.loop.name}` : ''}
          </Text>
          <Progress at={PROGRESS_AT[state.stage]} />
        </Box>
        <Text> </Text>
        {children}
        <Text> </Text>
        {state.warning && <Text color="warning">{state.warning}</Text>}
        {state.message && <Text>{state.message}</Text>}
        <Text dimColor>{hints}</Text>
      </Box>
    )

    const Progress = ({ at }: { at: number }) => (
      <Text dimColor>
        {PROGRESS.map((stage, i) => (
          <Text bold={i === at} color={i === at ? 'claude' : undefined}>
            {i > 0 ? ' › ' : ''}
            {i < at ? `✓ ${stage}` : stage}
          </Text>
        ))}
      </Text>
    )

    /** A list of choices, each pressed by its number, then back. */
    const Choices = ({ name, title, choices, onPick }: ChoicesProps) => {
      const width = Math.max(...choices.map(choice => choice.label.length))
      return (
        <Box flexDirection="column">
          <Text bold>{title}</Text>
          {choices.map((choice, i) => (
            <Button
              key={`${name}:${choice.value}`}
              plain
              // A hotkey is one key, so choices past the ninth are reached with Tab.
              hotkey={i < 9 ? String(i + 1) : undefined}
              onPress={() => change(s => onPick(s, choice.value))}
            >
              {choice.label.padEnd(width)}
              {choice.detail && <Text dimColor>{`  ${choice.detail}`}</Text>}
            </Button>
          ))}
          {name !== 'start' && (
            <Button key="back" plain hotkey="b" onPress={() => change(back)}>
              back
            </Button>
          )}
        </Box>
      )
    }

    const Graph = ({ cursor }: { cursor: number }) => {
      if (state.loop.steps.length === 0) return <Text dimColor>An empty graph: steps you add appear here.</Text>
      return (
        <Box flexDirection="column">
          {renderLoop(state.loop, { selected: [cursor] })
            .split('\n')
            .map(row => (
              <Text mono wrap="truncate-end">
                {row}
              </Text>
            ))}
        </Box>
      )
    }

    if (state.stage === 'name') {
      return (
        <Frame hints="⏎ next · esc back to the prompt">
          <Text bold>What's the loop called?</Text>
          <Input
            key="name"
            label="Name"
            placeholder="build-until-green"
            submitLabel="next"
            autoFocus
            value={state.loop.name}
            onSubmit={name => change(s => nameLoop(s, name))}
          />
          <Text dimColor>It is saved as .claude/loops/&lt;name&gt;.yaml, so use letters, digits and dashes.</Text>
        </Frame>
      )
    }

    if (state.stage === 'start') {
      return (
        <Frame hints="1-3 pick · tab and ⏎ work too · b rename">
          <Choices name="start" title="How do you want to start?" choices={startChoices()} onPick={start} />
          <Button
            key="rename"
            plain
            hotkey="b"
            onPress={async () => {
              await change(s => ({ ...s, stage: 'name' }))
              await focus($, 'name')
            }}
          >
            rename
          </Button>
          <Text> </Text>
          <Text dimColor>
            Test steps run {state.commands.tests} and lint steps run {state.commands.lint}: you can change either later.
          </Text>
        </Frame>
      )
    }

    if (state.stage === 'saved') {
      return (
        <Frame hints="esc back to the prompt">
          <Text bold color="success">
            ✓ Saved .claude/loops/{state.loop.name}.yaml. Commit it to share the loop with your team.
          </Text>
          <Text> </Text>
          <Graph cursor={-1} />
          <Text> </Text>
          <Text>Run it from the prompt:</Text>
          <Text bold>{`/loop-manager run ${state.loop.name} "what to build"`}</Text>
          <Text> </Text>
          <Box flexDirection="row" gap={3}>
            <Button key="edit" plain hotkey="e" onPress={() => change(s => ({ ...s, stage: 'edit' }))}>
              keep editing
            </Button>
            <Button key="new" plain hotkey="n" onPress={() => change(s => newEditor(s.commands))}>
              new loop
            </Button>
            <Button key="close" plain hotkey="c" onPress={() => $.ui.close({ id: EDITOR_PANE })}>
              close
            </Button>
          </Box>
        </Frame>
      )
    }

    const steps = drawnSteps(state.loop)
    const step = steps[state.cursor]
    const repeat = repeatAt(state.loop, state.cursor)
    const blocker = whyNotSavable(state.loop)
    const status =
      steps.length === 0
        ? 'no steps yet · press a to add one'
        : `${steps.length === 1 ? '1 step' : `${steps.length} steps`} · ${blocker ?? '✓ ready to save'}`

    const below = (() => {
      if (state.picker === 'block') {
        const where = step ? `after ${step.id}` : 'first'
        return (
          <Choices
            name="block"
            title={`Add a step ${where}:`}
            choices={blockChoices(state.commands)}
            onPick={addBlock}
          />
        )
      }
      if (state.picker === 'range') {
        return (
          <Choices
            name="range"
            title="Repeat which steps? They go round together."
            choices={rangeChoices(state)}
            onPick={wrapRange}
          />
        )
      }
      if (state.picker === 'until') {
        return <Choices name="until" title="Stop repeating when:" choices={untilChoices(state)} onPick={setUntil} />
      }
      if (state.editing === 'command' && step?.run !== undefined) {
        return (
          <Input
            key="command-field"
            label={`${step.id} runs`}
            submitLabel="set"
            value={step.run}
            onSubmit={text => change(s => setCommand(s, text))}
          />
        )
      }
      if (state.editing === 'rounds' && repeat) {
        return (
          <Input
            key="rounds-field"
            label="Stop anyway after this many rounds"
            submitLabel="set"
            value={String(repeat.max_rounds)}
            onSubmit={text => change(s => setRounds(s, text))}
          />
        )
      }
      return (
        <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
          {steps.length > 1 && (
            <Button key="prev" plain hotkey="h" onPress={() => change(s => moveCursor(s, -1))}>
              ← prev
            </Button>
          )}
          {steps.length > 1 && (
            <Button key="next" plain hotkey="l" onPress={() => change(s => moveCursor(s, +1))}>
              next →
            </Button>
          )}
          <Button key="add" plain hotkey="a" onPress={() => change(s => openPicker(s, 'block'))}>
            add
          </Button>
          {step && (
            <Button key="remove" plain hotkey="x" onPress={() => change(removeStep)}>
              remove
            </Button>
          )}
          {step && !repeat && (
            <Button key="repeat" plain hotkey="r" onPress={() => change(s => openPicker(s, 'range'))}>
              repeat…
            </Button>
          )}
          {repeat && (
            <Button key="until" plain hotkey="u" onPress={() => change(s => openPicker(s, 'until'))}>
              until…
            </Button>
          )}
          {repeat && (
            <Button key="rounds" plain hotkey="n" onPress={() => editField('rounds')}>
              rounds
            </Button>
          )}
          {step?.run !== undefined && (
            <Button key="command" plain hotkey="e" onPress={() => editField('command')}>
              edit command
            </Button>
          )}
          {steps.length > 0 && (
            <Button key="save" plain hotkey="s" onPress={() => save($)}>
              save
            </Button>
          )}
        </Box>
      )
    })()

    const hints = state.picker
      ? 'press a number to pick · b back'
      : state.editing
        ? '⏎ set · an empty ⏎ keeps it as it is'
        : 'tab walks the actions · esc back to the prompt'
    return (
      <Frame hints={hints}>
        <Text dimColor>{status}</Text>
        <Text> </Text>
        <Graph cursor={state.cursor} />
        <Text> </Text>
        {step && <Text>▸ {describeStep(step)}</Text>}
        {repeat && (
          <Text>
            ⟳ The repeat goes round until {repeat.until.join(' and ')} passes, {repeat.max_rounds} rounds at most.
          </Text>
        )}
        {step && <Text> </Text>}
        {below}
      </Frame>
    )
  })
}

type ChoicesProps = {
  /** Prefixes each choice's key: `block:plan`. */
  name: string
  title: string
  choices: Choice[]
  onPick: (state: EditorState, value: string) => EditorState
}

/** Runs the loops CLI that ships beside this mod and answers with what it printed. */
async function runCli($: EngineInterface, args: string[]): Promise<{ text: string }> {
  const { exitCode, stdout, stderr } = await $.process.run(['node', `${$.plugin.root}/src/cli.ts`, ...args], {
    timeoutMs: 600_000,
  })
  const failed = exitCode === 0 ? '' : `(exit code ${exitCode})\n`
  return { text: `${failed}\`\`\`\n${stdout}${stderr}\`\`\`` }
}

/** Splits command arguments on spaces, keeping "quoted text" as one argument. */
function splitArgs(args: string): string[] {
  return [...args.matchAll(/"([^"]*)"|(\S+)/g)].map(match => match[1] ?? match[2] ?? '')
}

/**
 * Puts the keyboard in the field drawn under `key`, which no Button may share:
 * the Button pressed to open the field is still drawn when this runs. A surface that cannot move
 * it (the test kit has no focus) leaves the field one Tab away instead.
 */
async function focus($: EngineInterface, key: string): Promise<void> {
  try {
    await $.ui.focus({ requestId: EDITOR_PANE, key })
  } catch {
    // Nothing to do: the field is drawn either way.
  }
}

/** Writes the loop to .claude/loops/<name>.yaml, unless something stops it from being saved. */
async function save($: EngineInterface): Promise<void> {
  const state = await read($, editor)
  const blocker = whyNotSavable(state.loop)
  if (blocker) {
    await update($, editor, s => warn(s, `Can't save yet: ${blocker}.`))
    return
  }

  await $.fs.write(`.claude/loops/${state.loop.name}.yaml`, toYaml(state.loop))
  await update($, editor, s => ({ ...back(s), stage: 'saved' as const }))
}
