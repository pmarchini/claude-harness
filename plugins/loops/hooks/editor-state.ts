// What each key and choice in the `/loop-manager new` pane does to the editor's
// state. Pure functions of EditorState, so the pane's handlers stay one line.
import {
  addAfter,
  BLOCKS,
  blankLoop,
  changeCommand,
  changeRepeat,
  fromTemplate,
  remove,
  repeatAt,
  repeatChoices,
  TEMPLATES,
  wrapInRepeat,
} from '../src/editor.ts'
import type { Commands, TemplateId } from '../src/editor.ts'
import { problemsIn } from '../src/loop-rules.ts'
import type { EditorState, EditorStep } from '../types'

/** One entry of a list the pane shows in place of its actions. */
export type Choice = { value: string; label: string; detail?: string }

export function newEditor(commands: Commands): EditorState {
  return { stage: 'name', loop: blankLoop(''), cursor: -1, commands }
}

export function nameLoop(state: EditorState, text: string): EditorState {
  const name = text.trim()
  if (name === '') return warn(state, 'Type a name first, like build-until-green.')
  // The name becomes the file name under .claude/loops, so nothing that could leave that folder.
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(name)) {
    const tried = { ...state, loop: { ...state.loop, name } }
    return warn(tried, 'Use letters, digits and dashes for the name, like build-until-green.')
  }

  return quiet({ ...state, stage: 'start', loop: { ...state.loop, name } })
}

/** The ways to start a loop, as the start list shows them. */
export function startChoices(): Choice[] {
  return [
    { value: 'blank', label: 'Blank', detail: 'an empty graph, you add the steps' },
    ...Object.entries(TEMPLATES).map(([value, { label, detail }]) => ({ value, label, detail })),
  ]
}

export function start(state: EditorState, choice: string): EditorState {
  const name = state.loop.name
  if (choice === 'blank') {
    // Nothing to do on an empty graph but add a step, so the palette is already open.
    return quiet({ ...state, stage: 'edit', loop: blankLoop(name), cursor: -1, picker: 'block' })
  }

  const loop = fromTemplate(choice as TemplateId, name, state.commands)
  return quiet({ ...state, stage: 'edit', loop, cursor: 0 })
}

/** The blocks of the palette, with what each does in this repo. */
export function blockChoices(commands: Commands): Choice[] {
  return [
    { value: 'plan', label: 'Plan', detail: 'Claude writes a plan, you approve it' },
    { value: 'implement', label: 'Implement', detail: 'Claude writes the code' },
    { value: 'tests', label: 'Run tests', detail: `${commands.tests}, passes when it exits 0` },
    { value: 'lint', label: 'Lint', detail: `${commands.lint}, passes when it exits 0` },
    { value: 'report', label: 'Report', detail: 'a summary when the loop ends' },
  ]
}

export function addBlock(state: EditorState, block: string): EditorState {
  const steps: Record<string, EditorStep> = {
    plan: BLOCKS.plan,
    implement: BLOCKS.implement,
    tests: BLOCKS.tests(state.commands.tests),
    lint: BLOCKS.lint(state.commands.lint),
    report: BLOCKS.report,
  }
  const { loop, position } = addAfter(state.loop, state.cursor, steps[block]!)
  const added = drawnSteps(loop)[position]!
  const before = drawnSteps(loop)[position - 1]
  const hasRepeat = loop.steps.some(node => 'repeat' in node)

  const message = [before ? `Added ${added.id} after ${before.id}.` : `Added ${added.id}.`]
  if (added.run !== undefined && !hasRepeat) {
    message.push(`Every step runs once for now: to go round until ${added.id} passes, press r.`)
  }
  return say({ ...state, loop, cursor: position, picker: undefined }, message.join(' '))
}

export function removeStep(state: EditorState): EditorState {
  if (state.cursor < 0) return state

  const removed = drawnSteps(state.loop)[state.cursor]!
  const loop = remove(state.loop, state.cursor)
  return say({ ...state, loop, cursor: Math.max(-1, state.cursor - 1) }, `Removed ${removed.id}.`)
}

/** Moves the cursor by `delta` steps, staying on a step. */
export function moveCursor(state: EditorState, delta: number): EditorState {
  const count = drawnSteps(state.loop).length
  if (count === 0) return state
  return { ...state, cursor: Math.min(count - 1, Math.max(0, state.cursor + delta)) }
}

/** Shows a list in place of the actions; the last message was about an earlier edit, so it goes. */
export function openPicker(state: EditorState, picker: NonNullable<EditorState['picker']>): EditorState {
  return quiet({ ...state, picker })
}

/** Shows a field in place of the actions, for the cursor's command or its repeat's round limit. */
export function openField(state: EditorState, editing: NonNullable<EditorState['editing']>): EditorState {
  return quiet({ ...state, editing })
}

/** Leaves the open list or field without changing anything. */
export function back(state: EditorState): EditorState {
  return quiet({ ...state, picker: undefined, editing: undefined })
}

/** The runs of steps the cursor's step could repeat with, named by their ends, the likeliest first. */
export function rangeChoices(state: EditorState): Choice[] {
  const ids = drawnSteps(state.loop).map(step => step.id)
  return repeatChoices(state.loop, state.cursor).map(({ first, last }, i) => ({
    value: `${first}-${last}`,
    label: first === last ? `${ids[first]} alone` : `${ids[first]} → ${ids[last]}`,
    detail: i === 0 ? 'suggested' : undefined,
  }))
}

/** Wraps the run of steps a `rangeChoices` value names in a repeat. */
export function wrapRange(state: EditorState, range: string): EditorState {
  const [first = 0, last = 0] = range.split('-').map(Number)
  const wrapped = wrapInRepeat(state.loop, first, last)
  if (typeof wrapped === 'string') return warn({ ...state, picker: undefined }, wrapped)

  const repeat = repeatAt(wrapped, first)!
  const ids = drawnSteps(state.loop).map(step => step.id)
  const steps = first === last ? ids[first] : `${ids[first]} → ${ids[last]}`
  const message =
    `Wrapped ${steps} in a repeat: it goes round until ${repeat.until.join(' and ')} passes, ` +
    `${repeat.max_rounds} rounds at most. u and n change that.`
  return say({ ...state, loop: wrapped, picker: undefined }, message)
}

/** What the cursor's repeat can wait on: one of its steps, or every one. */
export function untilChoices(state: EditorState): Choice[] {
  const repeat = repeatAt(state.loop, state.cursor)
  if (!repeat) return []

  const isAll = repeat.until.length === repeat.steps.length && repeat.steps.length > 1
  const mark = (isPicked: boolean) => (isPicked ? '●' : '○')
  return [
    ...repeat.steps.map(step => ({
      value: step.id,
      label: `${mark(!isAll && repeat.until.includes(step.id))} ${whenPasses(step)}`,
    })),
    { value: 'all', label: `${mark(isAll)} every step in the repeat passes` },
  ]
}

/** Makes the cursor's repeat wait on one of its steps, or on all of them (`all`). */
export function setUntil(state: EditorState, choice: string): EditorState {
  const repeat = repeatAt(state.loop, state.cursor)
  if (!repeat) return state

  const until = choice === 'all' ? repeat.steps.map(step => step.id) : [choice]
  const loop = changeRepeat(state.loop, repeat.id, { until })
  return say({ ...state, loop, picker: undefined }, `The repeat now goes round until ${until.join(' and ')} passes.`)
}

export function setRounds(state: EditorState, text: string): EditorState {
  const repeat = repeatAt(state.loop, state.cursor)
  if (!repeat) return state
  if (text.trim() === '') return back(state)

  const rounds = Number(text)
  if (!Number.isInteger(rounds) || rounds < 1) return warn(state, 'Rounds must be a whole number, 1 or more.')
  const loop = changeRepeat(state.loop, repeat.id, { max_rounds: rounds })
  return say({ ...state, loop, editing: undefined }, `The repeat now stops anyway after ${rounds} rounds.`)
}

export function setCommand(state: EditorState, text: string): EditorState {
  const command = text.trim()
  if (command === '') return back(state)

  const loop = changeCommand(state.loop, state.cursor, command)
  return say({ ...state, loop, editing: undefined }, `${drawnSteps(loop)[state.cursor]?.id} now runs ${command}.`)
}

/** What stops the loop from being saved, as the end of a sentence; undefined when nothing does. */
export function whyNotSavable(loop: EditorState['loop']): string | undefined {
  if (loop.steps.length === 0) return 'add a step first'
  const problems = problemsIn(loop)
  return problems.length > 0 ? problems.join('; ') : undefined
}

/** What `step` does and when it passes, as a sentence. */
export function describeStep(step: EditorStep): string {
  if (step.run !== undefined) return `${step.id} runs ${step.run}, and passes when it exits 0.`
  const who = step.agent === 'main' ? 'Claude in a fresh session' : `the ${step.agent} subagent`
  return `${step.id} asks ${who}, and passes when it finishes without an error.`
}

/** What it takes for `step` to pass, as an until choice says it. */
function whenPasses(step: EditorStep): string {
  return step.run === undefined ? `${step.id} finishes without an error` : `${step.id} passes: ${step.run} exits 0`
}

/** Every step, in drawing order: the cursor's positions. */
export function drawnSteps(loop: EditorState['loop']): EditorStep[] {
  return loop.steps.flatMap(node => ('repeat' in node ? node.repeat.steps : [node]))
}

/** Sets the line under the graph to news of an edit. */
export function say(state: EditorState, message: string): EditorState {
  return { ...state, message, warning: undefined }
}

/** Sets the line under the graph to what is wrong. */
export function warn(state: EditorState, warning: string): EditorState {
  return { ...state, message: undefined, warning }
}

function quiet(state: EditorState): EditorState {
  return { ...state, message: undefined, warning: undefined }
}
