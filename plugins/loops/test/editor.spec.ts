// The editor behind `/loops new`, tested below the pane: its combinations of
// edits are many, and the pane test covers the journey end to end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'yaml';
import {
  addAfter,
  blankLoop,
  BLOCKS,
  changeRepeat,
  detectCommands,
  fromTemplate,
  remove,
  toYaml,
  wrapInRepeat,
} from '../src/editor.ts';
import { problemsIn, type Loop, type Step } from '../src/loop-rules.ts';

test('steps added one after another to a blank loop save as a valid loop file', () => {
  let loop = blankLoop('build-until-green');
  loop = addAfter(loop, -1, BLOCKS.plan).loop;
  loop = addAfter(loop, 0, BLOCKS.implement).loop;
  loop = addAfter(loop, 1, BLOCKS.tests('mvn -q test')).loop;

  const saved = parse(toYaml(loop));

  assert.deepEqual(saved, {
    name: 'build-until-green',
    steps: [
      { id: 'plan', agent: 'planner' },
      { id: 'implement', agent: 'main' },
      { id: 'tests', run: 'mvn -q test' },
    ],
  });
  assert.deepEqual(problemsIn(saved), []);
});

test('wrapping steps in a repeat stops on the last of them, at 10 rounds unless changed', () => {
  const loop = loopOf(BLOCKS.plan, BLOCKS.implement, BLOCKS.tests('npm test'), BLOCKS.report);

  const wrapped = wrapInRepeat(loop, 1, 2);
  assert.ok(typeof wrapped !== 'string', `could not wrap: ${String(wrapped)}`);

  assert.deepEqual(parse(toYaml(wrapped)), {
    name: 'any-loop',
    steps: [
      { id: 'plan', agent: 'planner' },
      {
        repeat: {
          id: 'repeat',
          until: ['tests'],
          max_rounds: 10,
          steps: [
            { id: 'implement', agent: 'main' },
            { id: 'tests', run: 'npm test' },
          ],
        },
      },
      { id: 'report', agent: 'reporter' },
    ],
  });
});

/** Wraps steps that are known to be wrappable, so the test body stays a list of edits. */
function wrap(loop: Loop, first: number, last: number): Loop {
  const wrapped = wrapInRepeat(loop, first, last);
  assert.ok(typeof wrapped !== 'string', `could not wrap: ${String(wrapped)}`);
  return wrapped;
}

/** A loop holding `blocks` in order, built the way the pane builds one. */
function loopOf(...blocks: Step[]): Loop {
  return blocks.reduce((loop, block, i) => addAfter(loop, i - 1, block).loop, blankLoop('any-loop'));
}

test('a step added after one inside a repeat joins the repeat, so it runs every round', () => {
  const loop = wrap(loopOf(BLOCKS.plan, BLOCKS.implement, BLOCKS.tests('npm test'), BLOCKS.report), 1, 2);

  // Positions count steps in the order they are drawn: plan 0, implement 1, tests 2, report 3.
  const { loop: edited, position } = addAfter(loop, 2, BLOCKS.lint('npm run lint'));

  assert.equal(position, 3);
  assert.deepEqual(stepIdsByGroup(edited), ['plan', ['implement', 'tests', 'lint'], 'report']);
});

/** Step ids in drawing order, a repeat's ids as a nested list. */
function stepIdsByGroup(loop: Loop): Array<string | string[]> {
  return loop.steps.map((node) => ('repeat' in node ? node.repeat.steps.map((s) => s.id) : node.id));
}

test('a block added twice gets a numbered id, so until and the run record can tell them apart', () => {
  const loop = loopOf(BLOCKS.tests('npm test'), BLOCKS.tests('npm run e2e'));

  assert.deepEqual(stepIdsByGroup(loop), ['tests', 'tests-2']);
});

test('removing the step a repeat stops on moves the until to the last step left, so the loop stays valid', () => {
  const loop = wrap(loopOf(BLOCKS.implement, BLOCKS.tests('npm test'), BLOCKS.lint('npm run lint')), 0, 1);
  const withLintInside = addAfter(loop, 1, BLOCKS.lint('npm run lint')).loop;

  const edited = remove(withLintInside, 1);

  assert.deepEqual(stepIdsByGroup(edited), [['implement', 'lint-2'], 'lint']);
  assert.deepEqual(problemsIn(edited), []);
  assert.match(toYaml(edited), /until: \[lint-2\]/);
});

test('removing the only step in a repeat removes the repeat too', () => {
  const loop = wrap(loopOf(BLOCKS.plan, BLOCKS.tests('npm test')), 1, 1);

  assert.deepEqual(stepIdsByGroup(remove(loop, 1)), ['plan']);
});

test('steps already in a repeat cannot be wrapped again: repeats do not nest', () => {
  const loop = wrap(loopOf(BLOCKS.implement, BLOCKS.tests('npm test'), BLOCKS.report), 0, 1);

  assert.equal(wrapInRepeat(loop, 1, 2), 'Pick steps outside a repeat: repeats do not nest.');
});

test('a repeat can stop on several steps and allow more rounds', () => {
  const loop = addAfter(wrap(loopOf(BLOCKS.implement, BLOCKS.tests('npm test')), 0, 1), 1, BLOCKS.lint('npm run lint')).loop;

  const edited = changeRepeat(loop, 'repeat', { until: ['tests', 'lint'], max_rounds: 15 });

  assert.match(toYaml(edited), /until: \[tests, lint\]\n {6}max_rounds: 15/);
  assert.deepEqual(problemsIn(edited), []);
});

test('the "Repeat until done" template plans, repeats implement and tests until green, then reports', () => {
  const loop = fromTemplate('repeat-until-done', 'build-until-green', { tests: 'npm test', lint: 'npm run lint' });

  assert.deepEqual(stepIdsByGroup(loop), ['plan', ['implement', 'tests'], 'report']);
  assert.match(toYaml(loop), /until: \[tests\]/);
  assert.deepEqual(problemsIn(loop), []);
});

test('the test and lint commands come from the build files the repo has', () => {
  assert.deepEqual(detectCommands(['README.md', 'pom.xml']), { tests: 'mvn -q test', lint: 'mvn -q checkstyle:check' });
  assert.deepEqual(detectCommands(['package.json']), { tests: 'npm test', lint: 'npm run lint' });
  assert.deepEqual(detectCommands(['build.gradle.kts']), { tests: './gradlew test', lint: './gradlew check' });
  assert.deepEqual(detectCommands(['main.go']), { tests: 'make test', lint: 'make lint' });
});
