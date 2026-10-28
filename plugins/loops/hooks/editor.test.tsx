// The `/loops new` pane, driven the way a person drives it, on the surfaces
// that take input. Each hook given to `on` stands for the engine.
import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const EDITOR = {
  plugin: 'loops',
  component: 'Pane',
  requestId: 'loops-editor',
  props: {
    title: 'New loop',
    isFocused: true,
    bodyColumns: 160,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

/** What a command typed in the composer carries besides its name and arguments. */
const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 160 } } as const

/** A file at the repo's root, as `fs.list` lists it. */
const file = (name: string) => ({ name, kind: 'file', size: 1, mtimeMs: 0, isLink: false }) as const

/**
 * Runs `/loop-manager new` in a repo holding `files` and mounts the pane on
 * `surface`. `written` collects what the pane saves, `closed` the panes it closes.
 */
async function openEditor(
  $: Parameters<TestBody>[0],
  on: Parameters<TestBody>[1],
  { files = [] as string[], surface = 'terminal' as Surface } = {},
) {
  const { written, closed } = await startSessionIn($, on, files)
  return { ui: await mountEditor($, surface), written, closed }
}

type Surface = 'terminal' | 'desktop'
type Editor = Awaited<ReturnType<typeof mountEditor>>

async function buttons(ui: Editor) {
  return (await ui.findAll({ type: 'Button' })).map(button => button.key)
}

/** The line under the title: the loop's size, and whether it can be saved. */
async function status(ui: Editor) {
  return (await ui.find({ type: 'Text', text: /^(no steps yet|\d+ steps?) · / }))?.text
}

/** Names the loop and presses Enter, which moves on to picking how to start. */
async function nameLoop(ui: Editor, name: string) {
  await ui.input({ key: 'name', text: name })
}

/** Starts a session in a repo holding `files`, recording the files the pane writes and the panes it closes. */
async function startSessionIn($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], files: string[]) {
  const written: Array<{ path: string; text: string }> = []
  const closed: string[] = []
  on('command.register', () => ({ value: { command: 'loop-manager' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', (_, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  on('fs.list', () => ({ value: files.map(file) }))
  on('fs.write', (_, e) => {
    written.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  return { written, closed }
}

async function mountEditor($: Parameters<TestBody>[0], surface: Surface) {
  await $.command.run({ command: 'loop-manager', args: 'new', ...TYPED })
  return $.ui.mount({ ...EDITOR, surface })
}


test('Enter on the name moves on to a list of ways to start, every one of them shown', async ($, on) => {
  const { ui } = await openEditor($, on)

  await nameLoop(ui, 'build-until-green')

  expect(await ui.find({ type: 'Input', key: 'name' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /◆ New loop · build-until-green/ })).toBeDefined()
  expect(await buttons(ui)).toEqual(['start:blank', 'start:plan-build-test', 'start:repeat-until-done', 'rename'])
  await ui.unmount()
})

test('a name that is not a plain file name is refused, so the loop is never written outside .claude/loops', async ($, on) => {
  const { ui } = await openEditor($, on)

  await nameLoop(ui, '../../settings')

  expect(await ui.find({ type: 'Text', text: /Use letters, digits and dashes/ })).toBeDefined()
  expect(await ui.find({ type: 'Input', key: 'name' })).toBeDefined()
  await ui.unmount()
})

test('a blank loop opens the palette at once; its first step comes from there, or back adds nothing', async ($, on) => {
  await startSessionIn($, on, ['package.json'])
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mountEditor($, surface)
    await nameLoop(ui, 'build-until-green')
    await ui.press({ key: 'start:blank' })

    expect(await buttons(ui)).toEqual(['block:plan', 'block:implement', 'block:tests', 'block:lint', 'block:report', 'back'])

    await ui.press({ key: 'back' })
    expect(await status(ui)).toBe('no steps yet · press a to add one')

    await ui.press({ key: 'add' })
    await ui.press({ key: 'block:plan' })
    expect(await status(ui)).toBe('1 step · ✓ ready to save')
    await ui.unmount()
  }
})

test('only the actions that can do something are offered', async ($, on) => {
  const { ui } = await openEditor($, on)
  await nameLoop(ui, 'build-until-green')
  await ui.press({ key: 'start:blank' })
  await ui.press({ key: 'back' })

  expect(await buttons(ui)).toEqual(['add'])

  await ui.press({ key: 'add' })
  await ui.press({ key: 'block:implement' })

  expect(await buttons(ui)).toEqual(['add', 'remove', 'repeat', 'save'])

  await ui.press({ key: 'add' })
  await ui.press({ key: 'block:tests' })

  expect(await buttons(ui)).toEqual(['prev', 'next', 'add', 'remove', 'repeat', 'command', 'save'])
  await ui.unmount()
})

test('implement and tests wrapped in a repeat save as a loop that goes round until the tests pass', async ($, on) => {
  const { ui, written } = await openEditor($, on, { files: ['pom.xml'] })
  await nameLoop(ui, 'build-until-green')
  await ui.press({ key: 'start:blank' }) // opens the palette
  await ui.press({ key: 'block:plan' })
  for (const block of ['implement', 'tests', 'report']) {
    await ui.press({ key: 'add' })
    await ui.press({ key: `block:${block}` })
  }

  await ui.press({ key: 'prev' }) // cursor on tests
  await ui.press({ key: 'repeat' })
  expect((await ui.find({ type: 'Button', key: 'range:1-2' }))?.text).toMatch(/implement → tests.*suggested/)
  await ui.press({ key: 'range:1-2' })
  expect(
    await ui.find({
      type: 'Text',
      text: 'Wrapped implement → tests in a repeat: it goes round until tests passes, 10 rounds at most. u and n change that.',
    }),
  ).toBeDefined()
  await ui.press({ key: 'save' })

  expect(written).toHaveLength(1)
  // The engine hands fs.write the path resolved against the session's folder.
  expect(written[0]?.path).toMatch(/\/\.claude\/loops\/build-until-green\.yaml$/)
  expect(written[0]?.text).toContain('until: [tests]')
  expect(written[0]?.text).toContain('run: mvn -q test')
  await ui.unmount()
})

test('with the cursor inside a repeat, u picks what it waits on and n sets its round limit', async ($, on) => {
  const { ui, written } = await openEditor($, on, { files: ['package.json'], surface: 'desktop' })
  await nameLoop(ui, 'green-and-clean')
  await ui.press({ key: 'start:repeat-until-done' })
  // The cursor starts on plan.
  await ui.press({ key: 'next' }) // implement
  await ui.press({ key: 'next' }) // tests
  await ui.press({ key: 'add' })
  await ui.press({ key: 'block:lint' }) // joins the repeat, after tests

  await ui.press({ key: 'until' })
  expect((await ui.find({ type: 'Button', key: 'until:tests' }))?.text).toContain('tests passes: npm test exits 0')
  await ui.press({ key: 'until:all' })
  await ui.press({ key: 'rounds' })
  await ui.input({ key: 'rounds-field', text: '15' })
  await ui.press({ key: 'save' })

  expect(written[0]?.text).toContain('until: [implement, tests, lint]')
  expect(written[0]?.text).toContain('max_rounds: 15')
  await ui.unmount()
})

test('a round limit that is not a whole number is refused and the field stays open', async ($, on) => {
  const { ui } = await openEditor($, on)
  await nameLoop(ui, 'any-loop')
  await ui.press({ key: 'start:repeat-until-done' })
  await ui.press({ key: 'next' }) // implement, inside the repeat

  await ui.press({ key: 'rounds' })
  await ui.input({ key: 'rounds-field', text: 'lots' })

  expect(await ui.find({ type: 'Text', text: 'Rounds must be a whole number, 1 or more.' })).toBeDefined()
  expect(await ui.find({ type: 'Input', key: 'rounds-field' })).toBeDefined()
  await ui.unmount()
})

test('x removes the step under the cursor', async ($, on) => {
  const { ui, written } = await openEditor($, on)
  await nameLoop(ui, 'any-loop')
  await ui.press({ key: 'start:blank' }) // opens the palette
  await ui.press({ key: 'block:tests' })
  await ui.press({ key: 'add' })
  await ui.press({ key: 'block:report' })

  await ui.press({ key: 'remove' })
  await ui.press({ key: 'save' })

  expect(written[0]?.text).toContain('id: tests')
  expect(written[0]?.text).not.toContain('id: report')
  await ui.unmount()
})

test('the step under the cursor says what it does, and e changes a command step\'s command', async ($, on) => {
  const { ui, written } = await openEditor($, on, { files: ['pom.xml'] })
  await nameLoop(ui, 'build-until-green')
  await ui.press({ key: 'start:plan-build-test' })

  expect(await ui.find({ type: 'Text', text: /plan asks the planner subagent, and passes when it finishes without an error\./ })).toBeDefined()

  await ui.press({ key: 'next' }) // implement
  await ui.press({ key: 'next' }) // tests
  expect(await ui.find({ type: 'Text', text: /tests runs mvn -q test, and passes when it exits 0\./ })).toBeDefined()

  await ui.press({ key: 'command' })
  await ui.input({ key: 'command-field', text: './mvnw verify' })
  expect(await ui.find({ type: 'Input', key: 'command-field' })).toBeUndefined()
  await ui.press({ key: 'save' })

  expect(written[0]?.text).toContain('run: "./mvnw verify"')
  await ui.unmount()
})

test('adding the first check says that steps run once until a repeat makes them go round', async ($, on) => {
  const { ui } = await openEditor($, on, { files: ['pom.xml'] })
  await nameLoop(ui, 'build-until-green')
  await ui.press({ key: 'start:blank' })
  await ui.press({ key: 'block:implement' })

  expect(await ui.find({ type: 'Text', text: 'Added implement.' })).toBeDefined()

  await ui.press({ key: 'add' })
  await ui.press({ key: 'block:tests' })

  expect(
    await ui.find({
      type: 'Text',
      text: 'Added tests after implement. Every step runs once for now: to go round until tests passes, press r.',
    }),
  ).toBeDefined()
  await ui.unmount()
})

test('while a list is open, its choices and back are the only things to act on', async ($, on) => {
  const { ui } = await openEditor($, on)
  await nameLoop(ui, 'build-until-green')
  await ui.press({ key: 'start:blank' })
  await ui.press({ key: 'block:implement' })
  await ui.press({ key: 'add' })

  expect((await buttons(ui)).every(key => key === 'back' || key?.startsWith('block:'))).toBe(true)
  expect(await ui.find({ type: 'Text', text: /^Added / })).toBeUndefined()
  await ui.unmount()
})

test('once saved, the pane says how to run the loop and offers to keep editing, start another or close', async ($, on) => {
  const { ui, closed } = await openEditor($, on, { files: ['pom.xml'] })
  await nameLoop(ui, 'build-until-green')
  await ui.press({ key: 'start:repeat-until-done' })
  await ui.press({ key: 'save' })

  expect(await ui.find({ type: 'Text', text: /Saved \.claude\/loops\/build-until-green\.yaml/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '/loop-manager run build-until-green "what to build"' })).toBeDefined()
  expect(await buttons(ui)).toEqual(['edit', 'new', 'close'])

  await ui.press({ key: 'edit' })
  expect(await status(ui)).toBe('4 steps · ✓ ready to save')

  await ui.press({ key: 'save' })
  await ui.press({ key: 'close' })
  expect(closed).toEqual(['loops-editor'])
  await ui.unmount()
})

test('every other subcommand runs the loops CLI and shows what it printed', async ($, on) => {
  const ran: string[][] = []
  on('command.register', () => ({ value: { command: 'loop-manager' } }))
  on('process.run', (_, e) => {
    ran.push([...e.argv])
    return { value: { exitCode: 0, stdout: '✓ build-until-green\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const answer = await $.command.run({
    command: 'loop-manager',
    args: 'run build-until-green "add a refund endpoint"',
    ...TYPED,
  })

  expect(ran[0]?.slice(-3)).toEqual(['run', 'build-until-green', 'add a refund endpoint'])
  expect(ran[0]?.[1]).toMatch(/\/src\/cli\.ts$/)
  expect(answer.text).toContain('✓ build-until-green')
})
