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
 * `surface`. `written` collects what the pane saves.
 */
async function openEditor(
  $: Parameters<TestBody>[0],
  on: Parameters<TestBody>[1],
  { files = [] as string[], surface = 'terminal' as Surface } = {},
) {
  const written = await startSessionIn($, on, files)
  return { ui: await mountEditor($, surface), written }
}

type Surface = 'terminal' | 'desktop'
type Editor = Awaited<ReturnType<typeof mountEditor>>

async function buttons(ui: Editor) {
  return (await ui.findAll({ type: 'Button' })).map(button => button.key)
}

/** The line above the graph: the loop's name, its size, and whether it can be saved. */
async function header(ui: Editor) {
  return (await ui.find({ type: 'Text', text: /^\S+ · (no steps yet|\d+ steps?) · / }))?.text
}

/** Starts a session in a repo holding `files`; what the pane writes lands in the array returned. */
async function startSessionIn($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], files: string[]) {
  const written: Array<{ path: string; text: string }> = []
  on('command.register', () => ({ value: { command: 'loop-manager' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('fs.list', () => ({ value: files.map(file) }))
  on('fs.write', (_, e) => {
    written.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  return written
}

async function mountEditor($: Parameters<TestBody>[0], surface: Surface) {
  await $.command.run({ command: 'loop-manager', args: 'new', ...TYPED })
  return $.ui.mount({ ...EDITOR, surface })
}

test('a blank loop gets its first step from the palette', async ($, on) => {
  await startSessionIn($, on, ['package.json'])
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mountEditor($, surface)

    await ui.input({ key: 'name', text: 'build-until-green' })
    await ui.select({ key: 'start', value: 'blank' })
    await ui.press({ key: 'add' })
    await ui.select({ key: 'block', value: 'plan' })

    expect(await ui.find({ type: 'Text', text: /plan/ })).toBeDefined()
    await ui.unmount()
  }
})

test('implement and tests wrapped in a repeat save as a loop that goes round until the tests pass', async ($, on) => {
  const { ui, written } = await openEditor($, on, { files: ['pom.xml'] })
  await ui.input({ key: 'name', text: 'build-until-green' })
  await ui.select({ key: 'start', value: 'blank' })
  for (const block of ['plan', 'implement', 'tests', 'report']) {
    await ui.press({ key: 'add' })
    await ui.select({ key: 'block', value: block })
  }

  await ui.press({ key: 'prev' }) // cursor on tests
  await ui.press({ key: 'repeat' })
  const range = await ui.find({ type: 'Select', key: 'range' })
  expect((range?.props.options as Array<{ label: string }>)[0]?.label).toBe('implement → tests (suggested)')
  await ui.select({ key: 'range', value: '1-2' })
  await ui.press({ key: 'save' })

  expect(written).toHaveLength(1)
  // The engine hands fs.write the path resolved against the session's folder.
  expect(written[0]?.path).toMatch(/\/\.claude\/loops\/build-until-green\.yaml$/)
  expect(written[0]?.text).toContain('until: [tests]')
  expect(written[0]?.text).toContain('run: mvn -q test')
  expect(await ui.find({ type: 'Text', text: /Saved \.claude\/loops\/build-until-green\.yaml/ })).toBeDefined()
  await ui.unmount()
})

test('with the cursor inside a repeat, its until and round limit can be changed before saving', async ($, on) => {
  const { ui, written } = await openEditor($, on, { files: ['package.json'], surface: 'desktop' })
  await ui.input({ key: 'name', text: 'green-and-clean' })
  await ui.select({ key: 'start', value: 'repeat-until-done' })
  await ui.press({ key: 'next' }) // plan
  await ui.press({ key: 'next' }) // implement
  await ui.press({ key: 'next' }) // tests
  await ui.press({ key: 'add' })
  await ui.select({ key: 'block', value: 'lint' }) // joins the repeat, after tests

  await ui.select({ key: 'until', value: 'all' })
  await ui.input({ key: 'rounds', text: '15' })
  await ui.press({ key: 'save' })

  expect(written[0]?.text).toContain('until: [implement, tests, lint]')
  expect(written[0]?.text).toContain('max_rounds: 15')
  await ui.unmount()
})

test('x removes the step under the cursor', async ($, on) => {
  const { ui, written } = await openEditor($, on)
  await ui.input({ key: 'name', text: 'any-loop' })
  await ui.select({ key: 'start', value: 'blank' })
  await ui.press({ key: 'add' })
  await ui.select({ key: 'block', value: 'tests' })
  await ui.press({ key: 'add' })
  await ui.select({ key: 'block', value: 'report' })

  await ui.press({ key: 'remove' })
  await ui.press({ key: 'save' })

  expect(written[0]?.text).toContain('id: tests')
  expect(written[0]?.text).not.toContain('id: report')
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

test('a name that is not a plain file name is refused, so the loop is never written outside .claude/loops', async ($, on) => {
  const { ui } = await openEditor($, on)

  await ui.input({ key: 'name', text: '../../settings' })
  await ui.select({ key: 'start', value: 'blank' })

  expect(await ui.find({ type: 'Text', text: /Use letters, digits and dashes/ })).toBeDefined()
  expect(await ui.find({ type: 'Select', key: 'start' })).toBeDefined()
  await ui.unmount()
})

test('a name typed without pressing Enter is kept when the start is picked', async ($, on) => {
  const { ui } = await openEditor($, on)

  await ui.input({ key: 'name', text: 'build-until-green', kind: 'change' })
  await ui.select({ key: 'start', value: 'blank' })

  expect(await ui.find({ type: 'Text', text: /Empty loop/ })).toBeDefined()
  await ui.unmount()
})

test('Enter in the name field says what comes next', async ($, on) => {
  const { ui } = await openEditor($, on)

  await ui.input({ key: 'name', text: 'build-until-green' })

  expect(await ui.find({ type: 'Text', text: /Now pick how to start build-until-green/ })).toBeDefined()
  await ui.unmount()
})

test('the header names the loop, counts its steps and says whether it can be saved', async ($, on) => {
  const { ui } = await openEditor($, on, { files: ['pom.xml'] })
  await ui.input({ key: 'name', text: 'build-until-green' })
  await ui.select({ key: 'start', value: 'blank' })

  expect(await header(ui)).toBe('build-until-green · no steps yet · add a step to save it')

  await ui.press({ key: 'add' })
  await ui.select({ key: 'block', value: 'implement' })

  expect(await header(ui)).toBe('build-until-green · 1 step · ✓ ready to save')
  await ui.unmount()
})

test('a blank loop opens the palette at once, and the palette closes without adding a step', async ($, on) => {
  const { ui } = await openEditor($, on)
  await ui.input({ key: 'name', text: 'build-until-green' })
  await ui.select({ key: 'start', value: 'blank' })

  expect(await ui.find({ type: 'Select', key: 'block' })).toBeDefined()

  await ui.select({ key: 'block', value: 'back' })

  expect(await ui.find({ type: 'Select', key: 'block' })).toBeUndefined()
  expect(await header(ui)).toContain('no steps yet')
  await ui.unmount()
})

test('only the actions that can do something are offered', async ($, on) => {
  const { ui } = await openEditor($, on)
  await ui.input({ key: 'name', text: 'build-until-green' })
  await ui.select({ key: 'start', value: 'blank' })
  await ui.select({ key: 'block', value: 'back' })

  expect(await buttons(ui)).toEqual(['add'])

  await ui.press({ key: 'add' })
  await ui.select({ key: 'block', value: 'implement' })

  expect(await buttons(ui)).toEqual(['add', 'remove', 'repeat', 'save'])

  await ui.press({ key: 'add' })
  await ui.select({ key: 'block', value: 'tests' })

  expect(await buttons(ui)).toEqual(['prev', 'next', 'add', 'remove', 'repeat', 'save'])
  await ui.unmount()
})
