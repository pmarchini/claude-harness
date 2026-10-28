#!/usr/bin/env node
import { renderLoop } from './graph.ts';
import { loadLoops, type Loop } from './loop-file.ts';
import { readLatestRun, saveRun } from './run-folder.ts';
import { runLoop, type RunRecord } from './runner.ts';

/** Exit codes shared with headless runs: see the design doc, "Headless and CI". */
const EXIT_GATE_FAILED = 1;
const EXIT_INVALID_LOOP = 3;

const projectDir = process.cwd();
const [command, ...args] = process.argv.slice(2);

switch (command) {
  case 'validate': {
    const { loops, problems } = loadLoops(projectDir);
    for (const { loop, source } of loops) console.log(`✓ ${loop.name.padEnd(24)} ${source}`);
    for (const problem of problems) console.error(`✗ ${problem}`);
    if (problems.length > 0) process.exitCode = EXIT_INVALID_LOOP;
    break;
  }

  case 'show': {
    const loop = findLoop(args[0]);
    if (loop) console.log(renderLoop(loop));
    break;
  }

  case 'run': {
    const [name, task] = args;
    const loop = findLoop(name);
    if (!loop) break;

    const startedAt = new Date();
    const record = runLoop(loop, {
      projectDir,
      task,
      claudeBin: process.env.LOOPS_CLAUDE_BIN ?? 'claude',
      say: (line) => console.log(line),
    });
    saveRun(projectDir, record, startedAt);
    if (record.status === 'failed') process.exitCode = EXIT_GATE_FAILED;
    break;
  }

  case 'status': {
    const record = readLatestRun(projectDir);
    console.log(record ? describeRun(record) : 'No runs yet.');
    break;
  }

  default:
    console.error('Usage: loops validate | show <loop> | run <loop> "what to build" | status');
    process.exitCode = 1;
}

/** Finds a valid loop by name; when there is none, says which loops exist and sets a failing exit code. */
function findLoop(name: string | undefined): Loop | undefined {
  const { loops } = loadLoops(projectDir);
  const found = loops.find(({ loop }) => loop.name === name);
  if (found) return found.loop;

  const known = loops.map(({ loop }) => loop.name).join(', ') || 'none';
  console.error(`No loop named "${name}". Known loops: ${known}`);
  process.exitCode = 1;
  return undefined;
}

function describeRun(record: RunRecord): string {
  const mark = (passed: boolean) => (passed ? '✓' : '✗');
  const lines = record.steps.map((step) => {
    if (!('repeat' in step)) return `  ${step.id.padEnd(12)} ${mark(step.passed)}`;

    const rounds = step.rounds.map(
      (round, i) => `round ${i + 1} ${round.map((s) => `${mark(s.passed)} ${s.id}`).join(' ')}`,
    );
    return `  ${step.repeat.padEnd(12)} ${rounds.join(' · ')}`;
  });
  return [`${record.loop} · ${record.status} · "${record.task}"`, ...lines].join('\n');
}
