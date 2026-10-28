// The `/loops new` pane, driven the way a person drives it, on the surfaces
// that take input. Each hook given to `on` stands for the engine.
import { expect, test } from 'claude-code/testing'

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

test('a blank loop gets its first step from the palette', async ($, on) => {
  on('command.register', () => ({ value: { command: 'loop-manager' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.list', () => ({ value: [{ name: 'package.json', kind: 'file', size: 1, mtimeMs: 0, isLink: false }] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    await $.command.run({ command: 'loop-manager', args: 'new', ...TYPED })
    const ui = await $.ui.mount({ ...EDITOR, surface })

    await ui.input({ key: 'name', text: 'build-until-green' })
    await ui.select({ key: 'start', value: 'blank' })
    await ui.press({ key: 'add' })
    await ui.select({ key: 'block', value: 'plan' })

    expect(await ui.find({ type: 'Text', text: /plan/ })).toBeDefined()
    await ui.unmount()
  }
})

test('implement and tests wrapped in a repeat save as a loop that goes round until the tests pass', async ($, on) => {
  const written: Array<{ path: string; text: string }> = []
  on('command.register', () => ({ value: { command: 'loop-manager' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.list', () => ({ value: [{ name: 'pom.xml', kind: 'file', size: 1, mtimeMs: 0, isLink: false }] }))
  on('fs.write', (_, e) => {
    written.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'loop-manager', args: 'new', ...TYPED })
  const ui = await $.ui.mount({ ...EDITOR, surface: 'terminal' })
  await ui.input({ key: 'name', text: 'build-until-green' })
  await ui.select({ key: 'start', value: 'blank' })
  for (const block of ['plan', 'implement', 'tests', 'report']) {
    await ui.press({ key: 'add' })
    await ui.select({ key: 'block', value: block })
  }

  await ui.press({ key: 'prev' }) // cursor on tests
  await ui.press({ key: 'mark' })
  await ui.press({ key: 'prev' }) // cursor on implement
  await ui.press({ key: 'repeat' })
  await ui.press({ key: 'save' })

  expect(written).toHaveLength(1)
  // The engine hands fs.write the path resolved against the session's folder.
  expect(written[0]?.path).toMatch(/\/\.claude\/loops\/build-until-green\.yaml$/)
  expect(written[0]?.text).toContain('until: [tests]')
  expect(written[0]?.text).toContain('run: mvn -q test')
  expect(await ui.find({ type: 'Text', text: /Saved \.claude\/loops\/build-until-green\.yaml/ })).toBeDefined()
  await ui.unmount()
})
