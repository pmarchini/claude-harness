import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectWith, runLoops } from './helpers.ts';

/** A shell command that fails until it has been run `n` times, like tests that go green after fixes. */
const passesOnAttempt = (n: number) =>
  `c=$(cat .attempts 2>/dev/null || echo 0); c=$((c+1)); echo $c > .attempts; test $c -ge ${n}`;

test('a repeat runs its steps again until the until-step passes', () => {
  const project = projectWith({
    '.claude/loops/until-green.yaml': `
name: until-green
steps:
  - repeat:
      id: build
      until: [tests]
      max_rounds: 5
      steps:
        - id: tests
          run: "${passesOnAttempt(3)}"
`,
  });

  const result = runLoops(project, ['run', 'until-green', 'add a refund endpoint']);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /✓ build: until met in round 3 of 5/);
});

test('a repeat that never meets its condition stops at max_rounds and the run fails', () => {
  const project = projectWith({
    '.claude/loops/stuck.yaml': `
name: stuck
steps:
  - repeat:
      id: build
      until: [tests]
      max_rounds: 2
      steps:
        - id: tests
          run: "echo 'RefundTest: expected 40.00, got 39.99'; exit 1"
`,
  });

  const result = runLoops(project, ['run', 'stuck', 'add a refund endpoint']);

  assert.equal(result.exitCode, 1);
  assert.match(result.stdout, /✗ build: stopped after 2 of 2 rounds, still failing: tests/);
});

/** Stands in for the `claude` CLI: records each prompt it gets, one block per call. */
const FAKE_CLAUDE = `#!/bin/sh
printf '%s\\n---\\n' "$*" >> prompts.log
`;

test('each round, the agent gets the task and what failed in the round before', () => {
  const project = projectWith({
    'fake-claude': FAKE_CLAUDE,
    '.claude/loops/fix-until-green.yaml': `
name: fix-until-green
steps:
  - repeat:
      id: build
      until: [tests]
      max_rounds: 5
      steps:
        - id: implement
          agent: main
        - id: tests
          run: "echo 'RefundTest: expected 40.00, got 39.99'; ${passesOnAttempt(2)}"
`,
  });

  const result = runLoops(project, ['run', 'fix-until-green', 'add a refund endpoint'], {
    LOOPS_CLAUDE_BIN: `${project}/fake-claude`,
  });

  assert.equal(result.exitCode, 0, result.stderr);
  const [firstPrompt = '', secondPrompt = ''] = readFileSync(join(project, 'prompts.log'), 'utf8').split('\n---\n');
  assert.match(firstPrompt, /add a refund endpoint/);
  assert.doesNotMatch(firstPrompt, /failed/);
  assert.match(secondPrompt, /add a refund endpoint/);
  assert.match(secondPrompt, /tests failed[\s\S]*RefundTest: expected 40\.00, got 39\.99/);
});

test('a named agent step asks Claude to hand the work to that subagent', () => {
  const project = projectWith({
    'fake-claude': FAKE_CLAUDE,
    '.claude/loops/plan-first.yaml': 'name: plan-first\nsteps:\n  - id: plan\n    agent: planner\n',
  });

  const result = runLoops(project, ['run', 'plan-first', 'add a refund endpoint'], {
    LOOPS_CLAUDE_BIN: `${project}/fake-claude`,
  });

  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(readFileSync(join(project, 'prompts.log'), 'utf8'), /Use the planner subagent[\s\S]*add a refund endpoint/);
});

test('status shows how the last run went, round by round, after the run has ended', () => {
  const project = projectWith({
    '.claude/loops/until-green.yaml': `
name: until-green
steps:
  - repeat:
      id: build
      until: [tests]
      max_rounds: 5
      steps:
        - id: tests
          run: "${passesOnAttempt(3)}"
`,
  });
  runLoops(project, ['run', 'until-green', 'add a refund endpoint']);

  const result = runLoops(project, ['status']);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /until-green · passed · "add a refund endpoint"/);
  assert.match(result.stdout, /build +round 1 ✗ tests · round 2 ✗ tests · round 3 ✓ tests/);
});

test('a failing step outside a repeat ends the run, and the steps after it never start', () => {
  const project = projectWith({
    '.claude/loops/lint-first.yaml': `
name: lint-first
steps:
  - id: lint
    run: "exit 1"
  - id: tests
    run: "touch tests-ran"
`,
  });

  const result = runLoops(project, ['run', 'lint-first', 'add a refund endpoint']);

  assert.equal(result.exitCode, 1);
  assert.equal(existsSync(join(project, 'tests-ran')), false);
  assert.match(runLoops(project, ['status']).stdout, /lint-first · failed[\s\S]*lint +✗/);
});

test('run refuses a loop name it does not know, and starts nothing', () => {
  const project = projectWith({ '.claude/loops/lint-first.yaml': 'name: lint-first\nsteps:\n  - id: lint\n    run: "true"\n' });

  const result = runLoops(project, ['run', 'lint-frist', 'add a refund endpoint']);

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /No loop named "lint-frist"\. Known loops: lint-first/);
  assert.match(runLoops(project, ['status']).stdout, /No runs yet/);
});

test('run asks what to build when no description is given, and starts nothing', () => {
  const project = projectWith({ '.claude/loops/lint-first.yaml': 'name: lint-first\nsteps:\n  - id: lint\n    run: "true"\n' });

  const result = runLoops(project, ['run', 'lint-first']);

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /Say what to build: loops run lint-first "what to build"/);
  assert.match(runLoops(project, ['status']).stdout, /No runs yet/);
});
