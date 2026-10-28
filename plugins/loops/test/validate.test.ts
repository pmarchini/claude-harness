import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectWith, runLoops } from './helpers.ts';

test('a well-formed loop validates', () => {
  const project = projectWith({
    '.claude/loops/build-until-green.yaml': `
name: build-until-green
steps:
  - id: tests
    run: npm test
`,
  });

  const result = runLoops(project, ['validate']);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /✓ build-until-green/);
});

test('a repeat with no round limit is rejected, so it can never run forever', () => {
  const project = projectWith({
    '.claude/loops/forever.yaml': `
name: forever
steps:
  - repeat:
      id: build
      until: [tests]
      steps:
        - id: tests
          run: npm test
`,
  });

  const result = runLoops(project, ['validate']);

  assert.equal(result.exitCode, 3);
  assert.match(result.stderr, /forever\.yaml: repeat "build" needs max_rounds/);
});

test('a repeat must stop on a step inside it, because the condition is read from that step\'s result', () => {
  const project = projectWith({
    '.claude/loops/typo.yaml': `
name: typo
steps:
  - repeat:
      id: build
      until: [test]
      max_rounds: 10
      steps:
        - id: tests
          run: npm test
`,
  });

  const result = runLoops(project, ['validate']);

  assert.equal(result.exitCode, 3);
  assert.match(result.stderr, /typo\.yaml: repeat "build" stops on "test", which is not a step inside it/);
});

test('a file that is not valid YAML is reported, and the other loops still validate', () => {
  const project = projectWith({
    '.claude/loops/broken.yaml': 'name: broken\nsteps: [\n',
    '.claude/loops/fine.yaml': 'name: fine\nsteps:\n  - id: tests\n    run: npm test\n',
  });

  const result = runLoops(project, ['validate']);

  assert.equal(result.exitCode, 3);
  assert.match(result.stderr, /broken\.yaml: not valid YAML/);
  assert.match(result.stdout, /✓ fine/);
});

test('every step says what it does: a command to run or an agent to ask', () => {
  const project = projectWith({
    '.claude/loops/vague.yaml': `
name: vague
steps:
  - id: tests
  - repeat:
      id: build
      until: [lint]
      max_rounds: 3
      steps:
        - id: lint
          run: npm run lint
          agent: reviewer
`,
  });

  const result = runLoops(project, ['validate']);

  assert.equal(result.exitCode, 3);
  assert.match(result.stderr, /vague\.yaml: step "tests" needs either run or agent/);
  assert.match(result.stderr, /vague\.yaml: step "lint" needs either run or agent/);
});

test('a file without a name or steps is reported instead of crashing', () => {
  const project = projectWith({ '.claude/loops/empty.yaml': 'description: nothing here\n' });

  const result = runLoops(project, ['validate']);

  assert.equal(result.exitCode, 3);
  assert.match(result.stderr, /empty\.yaml: needs a name and a list of steps/);
});

test('loops come from your home folder and the project, and a project loop replaces a personal one with the same name', () => {
  const home = projectWith({
    '.claude/loops/mine.yaml': 'name: mine\nsteps:\n  - id: tests\n    run: npm test\n',
    '.claude/loops/shared.yaml': 'name: shared\nsteps:\n  - id: tests\n    run: npm test\n',
  });
  const project = projectWith({
    '.claude/loops/shared.yaml': 'name: shared\nsteps:\n  - id: tests\n    run: npm test -- --ci\n',
  });

  const result = runLoops(project, ['validate'], { HOME: home });

  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /✓ mine +~\/\.claude\/loops\/mine\.yaml/);
  assert.match(result.stdout, /✓ shared +\.claude\/loops\/shared\.yaml/);
  assert.doesNotMatch(result.stdout, /~\/\.claude\/loops\/shared\.yaml/);
});
