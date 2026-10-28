import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import {
  addAfter,
  BLOCKS,
  blankLoop,
  changeCommand,
  changeRepeat,
  detectCommands,
  fromTemplate,
  remove,
  repeatAt,
  repeatChoices,
  TEMPLATES,
  toYaml,
  wrapInRepeat,
} from '../src/editor.ts'
import type { TemplateId } from '../src/editor.ts'
import { renderLoop } from '../src/graph.ts'
import { problemsIn } from '../src/loop-rules.ts'
import type { EditorState, EditorStep } from '../types'

const EDITOR_PANE = 'loops-editor'

// Change the tag when EditorState's fields change: it declines what an
// earlier version stored, which outlives a reload.
const editor = atom({ plugin: 'loops', key: 'editor' } as const, newEditor(), { shape: 'editor-2' })

/** The palette, in the order it lists blocks. */
const PALETTE = [
  { value: 'plan', label: 'Plan: Claude writes a plan, you approve it' },
  { value: 'implement', label: 'Implement: Claude writes the code' },
  { value: 'tests', label: 'Run tests: passes when the test command exits 0' },
  { value: 'lint', label: 'Lint: passes when the lint command exits 0' },
  { value: 'report', label: 'Report: a summary when the loop ends' },
] as const
/** The last option of every picker: leave it without changing anything. */
const BACK = { value: 'back', label: '← Back to the graph' }

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
            placeholder="build-until-green"
            submitLabel="next"
            autoFocus
            value={state.loop.name}
            // Kept as typed, so picking a start without pressing Enter still has the name.
            onInput={name => change(s => ({ ...s, loop: { ...s.loop, name }, message: undefined }))}
            onSubmit={name =>
              change(s => ({ ...s, loop: { ...s.loop, name }, message: `Now pick how to start ${name.trim()}, below.` }))
            }
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

    if (state.stage === 'saved') {
      return (
        <Box flexDirection="column">
          <Text bold color="success">
            ✓ {state.message}. Commit it to share the loop with your team.
          </Text>
          <Graph state={{ ...state, cursor: -1 }} Box={Box} Text={Text} />
          <Text>Run it: /loop-manager run {state.loop.name} "what to build"</Text>
          <Box flexDirection="row" gap={2}>
            <Button key="edit" hotkey="e" onPress={() => change(s => ({ ...s, stage: 'edit', message: undefined }))}>
              keep editing
            </Button>
            <Button key="new" hotkey="n" onPress={() => change(s => ({ ...newEditor(), commands: s.commands }))}>
              new loop
            </Button>
            <Button key="close" hotkey="c" onPress={() => $.ui.close({ id: EDITOR_PANE })}>
              close
            </Button>
          </Box>
        </Box>
      )
    }

    const repeat = repeatAt(state.loop, state.cursor)
    const step = drawnSteps(state.loop)[state.cursor]
    const blocker = whyNotSavable(state.loop)
    const steps = countSteps(state)
    const isOnStep = state.cursor >= 0
    return (
      <Box flexDirection="column">
        <Text bold>
          {state.loop.name} · {describeCount(steps)} · {blocker ?? '✓ ready to save'}
        </Text>
        <Graph state={state} Box={Box} Text={Text} />
        {state.picker === 'block' && (
          <Select
            key="block"
            label="Add a step"
            options={[...PALETTE, BACK]}
            onSelect={block => change(s => (block === BACK.value ? closePicker(s) : addBlock(s, block)))}
          />
        )}
        {state.picker === 'range' && (
          <Select
            key="range"
            label="Repeat which steps?"
            options={[...rangeOptions(state), BACK]}
            onSelect={range => change(s => (range === BACK.value ? closePicker(s) : wrapRange(s, range)))}
          />
        )}
        {step && !state.picker && (
          <Box flexDirection="column">
            <Text>{describeStep(step)}</Text>
            {step.run !== undefined && (
              <Input
                key="command"
                label="Command"
                submitLabel="set"
                value={step.run}
                onSubmit={command => change(s => setCommand(s, command))}
              />
            )}
          </Box>
        )}
        {repeat && !state.picker && (
          <Box flexDirection="column">
            <Text bold>This repeat goes round until what you pick passes, or stops anyway after the round limit.</Text>
            <Select
              key="until"
              label="Until"
              value={repeat.until.length === repeat.steps.length ? 'all' : repeat.until.join(',')}
              options={[
                ...repeat.steps.map(step => ({ value: step.id, label: whenPasses(step) })),
                { value: 'all', label: 'every step in the repeat passes' },
              ]}
              onSelect={choice => change(s => setUntil(s, choice))}
            />
            <Input
              key="rounds"
              label="Stop anyway after this many rounds"
              submitLabel="set"
              value={String(repeat.max_rounds)}
              onSubmit={text => change(s => setRounds(s, text))}
            />
          </Box>
        )}
        <Box flexDirection="row" gap={2}>
          {steps > 1 && (
            <Button key="prev" hotkey="h" onPress={() => change(s => moveCursor(s, -1))}>
              ← prev
            </Button>
          )}
          {steps > 1 && (
            <Button key="next" hotkey="l" onPress={() => change(s => moveCursor(s, +1))}>
              next →
            </Button>
          )}
          <Button key="add" hotkey="a" onPress={() => change(s => ({ ...s, picker: 'block' }))}>
            {steps === 0 ? 'add a step' : 'add after'}
          </Button>
          {isOnStep && (
            <Button key="remove" hotkey="x" onPress={() => change(removeStep)}>
              remove
            </Button>
          )}
          {isOnStep && !repeat && (
            <Button key="repeat" hotkey="r" onPress={() => change(s => ({ ...s, picker: 'range' }))}>
              repeat…
            </Button>
          )}
          {steps > 0 && (
            <Button key="save" hotkey="s" variant="primary" onPress={() => save($)}>
              save
            </Button>
          )}
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

  if (choice === 'blank') {
    // Nothing to do on an empty graph but add a step, so the palette is already open.
    return { ...state, stage: 'edit', loop: blankLoop(name), cursor: -1, picker: 'block', message: undefined }
  }
  const loop = fromTemplate(choice as TemplateId, name, state.commands)
  return { ...state, stage: 'edit', loop, cursor: 0, message: undefined }
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
  const added = drawnSteps(loop)[position]!
  const before = drawnSteps(loop)[position - 1]
  const hasRepeat = loop.steps.some(node => 'repeat' in node)

  const message = [before ? `Added ${added.id} after ${before.id}.` : `Added ${added.id}.`]
  if (added.run !== undefined && !hasRepeat) {
    message.push(`Every step runs once for now: to go round until ${added.id} passes, press r.`)
  }
  return { ...state, loop, cursor: position, picker: undefined, message: message.join(' ') }
}

function removeStep(state: EditorState): EditorState {
  if (state.cursor < 0) return state

  const loop = remove(state.loop, state.cursor)
  return { ...state, loop, cursor: Math.max(-1, state.cursor - 1) }
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
  return drawnStepIds(state.loop).length
}

function closePicker(state: EditorState): EditorState {
  return { ...state, picker: undefined }
}

/** The runs of steps the cursor's step could repeat with, as options named by their ends. */
function rangeOptions(state: EditorState) {
  const ids = drawnStepIds(state.loop)
  return repeatChoices(state.loop, state.cursor).map(({ first, last }, i) => {
    const steps = first === last ? `${ids[first]} alone` : `${ids[first]} → ${ids[last]}`
    return { value: `${first}-${last}`, label: i === 0 ? `${steps} (suggested)` : steps }
  })
}

/** Wraps the run of steps an option of `rangeOptions` names in a repeat. */
function wrapRange(state: EditorState, range: string): EditorState {
  const [first = 0, last = 0] = range.split('-').map(Number)
  const wrapped = wrapInRepeat(state.loop, first, last)
  if (typeof wrapped === 'string') return { ...state, picker: undefined, message: wrapped }

  const repeat = repeatAt(wrapped, first)!
  const ids = drawnStepIds(state.loop)
  const steps = first === last ? ids[first] : `${ids[first]} → ${ids[last]}`
  const message =
    `Wrapped ${steps} in a repeat: it goes round until ${repeat.until.join(' and ')} passes, ` +
    `${repeat.max_rounds} rounds at most. Change either below.`
  return { ...state, loop: wrapped, picker: undefined, message }
}

/** What `step` does and when it passes, as a sentence. */
function describeStep(step: EditorStep): string {
  if (step.run !== undefined) return `${step.id} runs a command, and passes when it exits 0.`
  const who = step.agent === 'main' ? 'Claude in a fresh session' : `the ${step.agent} subagent`
  return `${step.id} asks ${who}, and passes when it finishes without an error.`
}

function setCommand(state: EditorState, text: string): EditorState {
  const command = text.trim()
  if (command === '') return { ...state, message: "A command can't be empty." }

  const loop = changeCommand(state.loop, state.cursor, command)
  return { ...state, loop, message: `${drawnSteps(loop)[state.cursor]?.id} now runs ${command}.` }
}

/** What it takes for `step` to pass, as an until option says it. */
function whenPasses(step: EditorStep): string {
  return step.run === undefined ? `${step.id} finishes without an error` : `${step.id} passes: ${step.run} exits 0`
}

/** Every step, in drawing order: the cursor's positions. */
function drawnSteps(loop: EditorState['loop']): EditorStep[] {
  return loop.steps.flatMap(node => ('repeat' in node ? node.repeat.steps : [node]))
}

function drawnStepIds(loop: EditorState['loop']): string[] {
  return drawnSteps(loop).map(step => step.id)
}

/** What stops the loop from being saved, as the end of a sentence; undefined when nothing does. */
function whyNotSavable(loop: EditorState['loop']): string | undefined {
  if (loop.steps.length === 0) return 'add a step to save it'
  const problems = problemsIn(loop)
  return problems.length > 0 ? problems.join('; ') : undefined
}

function describeCount(steps: number): string {
  if (steps === 0) return 'no steps yet'
  return steps === 1 ? '1 step' : `${steps} steps`
}

/** Writes the loop to .claude/loops/<name>.yaml, unless something stops it from being saved. */
async function save($: EngineInterface): Promise<void> {
  const state = await read($, editor)
  const blocker = whyNotSavable(state.loop)
  if (blocker) {
    await update($, editor, s => ({ ...s, message: `Can't save yet: ${blocker}.` }))
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
    const next = state.picker ? 'Pick the first step below.' : 'Press a to add the first step.'
    return <Text dimColor>Empty loop. {next}</Text>
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
