import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectWith, runLoops } from './helpers.ts';

const BUILD_UNTIL_GREEN = `
name: build-until-green
steps:
  - id: plan
    agent: planner
  - repeat:
      id: build
      until: [tests]
      max_rounds: 10
      steps:
        - id: implement
          agent: main
        - id: tests
          run: npm test
  - id: report
    agent: reporter
`;

test('show draws the steps left to right, with the repeat as a frame that loops back', () => {
  const project = projectWith({ '.claude/loops/build-until-green.yaml': BUILD_UNTIL_GREEN });

  const result = runLoops(project, ['show', 'build-until-green']);

  assert.equal(result.exitCode, 0, result.stderr);
  const lines = result.stdout.split('\n');
  assert.match(result.stdout, /╔═ repeat until: tests pass · max 10 rounds ═+╗/);
  assert.ok(
    lines.some((line) => /plan.*║.*implement.*tests.*║.*report/.test(line)),
    `expected plan → [implement → tests] → report on one line:\n${result.stdout}`,
  );
  assert.match(result.stdout, /└─+ no: next round ─+┘/);
});

test('show names the loops it knows when asked for one that does not exist', () => {
  const project = projectWith({ '.claude/loops/build-until-green.yaml': BUILD_UNTIL_GREEN });

  const result = runLoops(project, ['show', 'build-untl-green']);

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /No loop named "build-untl-green"\. Known loops: build-until-green/);
});
