import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import {
  addAfter,
  BLOCKS,
  blankLoop,
  changeRepeat,
  detectCommands,
  fromTemplate,
  remove,
  repeatAt,
  TEMPLATES,
  toYaml,
  wrapInRepeat,
} from '../src/editor.ts'
import type { TemplateId } from '../src/editor.ts'
import { renderLoop } from '../src/graph.ts'
import { problemsIn } from '../src/loop-rules.ts'
import type { EditorState } from '../types'

const EDITOR_PANE = 'loops-editor'

// Change the tag when EditorState's fields change: it declines what an
// earlier version stored, which outlives a reload.
const editor = atom({ plugin: 'loops', key: 'editor' } as const, newEditor(), { shape: 'editor-1' })

/** The palette, in the order it lists blocks. */
const PALETTE = [
  { value: 'plan', label: 'Plan: Claude writes a plan, you approve it' },
  { value: 'implement', label: 'Implement: Claude writes the code' },
  { value: 'tests', label: 'Run tests: passes when the test command exits 0' },
  { value: 'lint', label: 'Lint: passes when the lint command exits 0' },
  { value: 'report', label: 'Report: a summary when the loop ends' },
] as const

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
    await update($, editor, () => ({ ...newEditor(), commands }))
    await $.ui.open({ id: EDITOR_PANE, title: 'New loop', focus: true })

    return { text: 'Opened the loop editor.' }
  })

  on('ui.render', { component: 'Pane', requestId: EDITOR_PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    if (!('Input' in elements)) {
      const { Text } = elements
      return <Text>Building a loop needs text fields: open it in the terminal or the desktop app.</Text>
    }

    const { Box, Text, Input, Select, Button } = elements
    const state = await read($, editor)
    const change = (fn: (state: EditorState) => EditorState) => update($, editor, fn)

    if (state.stage === 'start') {
      return (
        <Box flexDirection="column">
          <Text bold>Name the loop, then pick how to start it.</Text>
          <Input
            key="name"
            label="Name"
            value={state.loop.name}
            onSubmit={name => change(s => ({ ...s, loop: { ...s.loop, name } }))}
          />
          <Select
            key="start"
            label="Start from"
            options={[
              { value: 'blank', label: 'Blank: an empty graph, you add the steps' },
              ...Object.entries(TEMPLATES).map(([value, label]) => ({ value, label: `Template: ${label}` })),
            ]}
            onSelect={choice => change(s => start(s, choice))}
          />
          {state.message && <Text color="warning">{state.message}</Text>}
        </Box>
      )
    }

    const repeat = repeatAt(state.loop, state.cursor)
    return (
      <Box flexDirection="column">
        <Graph state={state} Box={Box} Text={Text} />
        {state.palette === 'block' && (
          <Select
            key="block"
            label="Add a step"
            options={PALETTE}
            onSelect={block => change(s => addBlock(s, block))}
          />
        )}
        {repeat && (
          <Box flexDirection="column">
            <Text bold>Repeat: goes round until these pass, or stops after the round limit</Text>
            <Select
              key="until"
              label="Until"
              value={repeat.until.length === repeat.steps.length ? 'all' : repeat.until.join(',')}
              options={[
                ...repeat.steps.map(step => ({ value: step.id, label: `${step.id} passes` })),
                { value: 'all', label: 'every step in the repeat passes' },
              ]}
              onSelect={choice => change(s => setUntil(s, choice))}
            />
            <Input
              key="rounds"
              label="Stop anyway after this many rounds"
              value={String(repeat.max_rounds)}
              onSubmit={text => change(s => setRounds(s, text))}
            />
          </Box>
        )}
        <Box flexDirection="row" gap={2}>
          <Button key="prev" hotkey="h" onPress={() => change(s => moveCursor(s, -1))}>
            ← prev
          </Button>
          <Button key="next" hotkey="l" onPress={() => change(s => moveCursor(s, +1))}>
            next →
          </Button>
          <Button key="add" hotkey="a" onPress={() => change(s => ({ ...s, palette: 'block' }))}>
            add after
          </Button>
          <Button key="remove" hotkey="x" onPress={() => change(removeStep)}>
            remove
          </Button>
          <Button key="mark" hotkey="m" onPress={() => change(s => ({ ...s, mark: s.cursor, message: 'Marked. Move to the other end and press r.' }))}>
            mark
          </Button>
          <Button key="repeat" hotkey="r" onPress={() => change(wrapSelection)}>
            repeat
          </Button>
          <Button key="save" hotkey="s" variant="primary" onPress={() => save($)}>
            save
          </Button>
        </Box>
        {state.message && <Text dimColor>{state.message}</Text>}
      </Box>
    )
  })
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

function newEditor(): EditorState {
  return {
    stage: 'start',
    loop: blankLoop(''),
    cursor: -1,
    commands: detectCommands([]),
  }
}

function start(state: EditorState, choice: string): EditorState {
  const name = state.loop.name.trim()
  if (name === '') return { ...state, message: 'Name the loop first.' }
  // The name becomes the file name under .claude/loops, so nothing that could leave that folder.
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(name)) {
    return { ...state, message: 'Use letters, digits and dashes for the name, like build-until-green.' }
  }

  const loop = choice === 'blank' ? blankLoop(name) : fromTemplate(choice as TemplateId, name, state.commands)
  return { ...state, stage: 'edit', loop, cursor: -1, message: undefined }
}

function addBlock(state: EditorState, block: string): EditorState {
  const step = {
    plan: BLOCKS.plan,
    implement: BLOCKS.implement,
    tests: BLOCKS.tests(state.commands.tests),
    lint: BLOCKS.lint(state.commands.lint),
    report: BLOCKS.report,
  }[block as (typeof PALETTE)[number]['value']]
  const { loop, position } = addAfter(state.loop, state.cursor, step)

  return { ...state, loop, cursor: position, palette: undefined, message: `Added ${step.id}.` }
}

function removeStep(state: EditorState): EditorState {
  if (state.cursor < 0) return state

  const loop = remove(state.loop, state.cursor)
  return { ...state, loop, cursor: Math.max(-1, state.cursor - 1), mark: undefined }
}

/** Makes the cursor's repeat wait on one of its steps, or on all of them (`all`). */
function setUntil(state: EditorState, choice: string): EditorState {
  const repeat = repeatAt(state.loop, state.cursor)
  if (!repeat) return state

  const until = choice === 'all' ? repeat.steps.map(step => step.id) : [choice]
  return { ...state, loop: changeRepeat(state.loop, repeat.id, { until }) }
}

function setRounds(state: EditorState, text: string): EditorState {
  const repeat = repeatAt(state.loop, state.cursor)
  if (!repeat) return state

  const rounds = Number(text)
  if (!Number.isInteger(rounds) || rounds < 1) return { ...state, message: 'Rounds must be a whole number, 1 or more.' }
  return { ...state, loop: changeRepeat(state.loop, repeat.id, { max_rounds: rounds }), message: undefined }
}

/** Moves the cursor by `delta` steps, staying on a step. */
function moveCursor(state: EditorState, delta: number): EditorState {
  const count = countSteps(state)
  if (count === 0) return state
  return { ...state, cursor: Math.min(count - 1, Math.max(0, state.cursor + delta)) }
}

function countSteps(state: EditorState): number {
  return state.loop.steps.reduce((n, node) => n + ('repeat' in node ? node.repeat.steps.length : 1), 0)
}

/** Wraps the steps between the mark and the cursor (or the cursor's step alone) in a repeat. */
function wrapSelection(state: EditorState): EditorState {
  const anchor = state.mark ?? state.cursor
  const wrapped = wrapInRepeat(state.loop, Math.min(anchor, state.cursor), Math.max(anchor, state.cursor))
  if (typeof wrapped === 'string') return { ...state, mark: undefined, message: wrapped }

  return { ...state, loop: wrapped, mark: undefined, message: 'Wrapped in a repeat.' }
}

/** Writes the loop to .claude/loops/<name>.yaml, unless it would not validate. */
async function save($: EngineInterface): Promise<void> {
  const state = await read($, editor)
  const problems = problemsIn(state.loop)
  if (problems.length > 0) {
    await update($, editor, s => ({ ...s, message: `Can't save yet: ${problems.join('; ')}` }))
    return
  }

  const path = `.claude/loops/${state.loop.name}.yaml`
  await $.fs.write(path, toYaml(state.loop))
  await update($, editor, s => ({ ...s, stage: 'saved' as const, message: `Saved ${path}` }))
}

type Elements = ReturnType<EngineInterface['ui']['resolve']>

/** The loop as an ASCII graph, one monospaced line per row, the cursor step heavy. */
function Graph({ state, Box, Text }: { state: EditorState; Box: Elements['Box']; Text: Elements['Text'] }) {
  if (state.loop.steps.length === 0) {
    return <Text dimColor>Empty loop. Press a to add the first step.</Text>
  }

  const rows = renderLoop(state.loop, { selected: [state.cursor] }).split('\n')
  return (
    <Box flexDirection="column">
      {rows.map(row => (
        <Text mono wrap="truncate-end">
          {row}
        </Text>
      ))}
    </Box>
  )
}
