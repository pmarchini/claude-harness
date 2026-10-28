#!/usr/bin/env node
import { renderLoop } from './graph.ts';
import { loadLoops } from './loop-file.ts';

/** Exit codes shared with headless runs: see the design doc, "Headless and CI". */
const EXIT_INVALID_LOOP = 3;

const [command, ...args] = process.argv.slice(2);

if (command === 'validate') {
  const { loops, problems } = loadLoops(process.cwd());
  for (const { loop, source } of loops) console.log(`✓ ${loop.name.padEnd(24)} ${source}`);
  for (const problem of problems) console.error(`✗ ${problem}`);
  if (problems.length > 0) process.exitCode = EXIT_INVALID_LOOP;
}

if (command === 'show') {
  const [name] = args;
  const { loops } = loadLoops(process.cwd());
  const found = loops.find(({ loop }) => loop.name === name);
  if (found) {
    console.log(renderLoop(found.loop));
  } else {
    const known = loops.map(({ loop }) => loop.name).join(', ') || 'none';
    console.error(`No loop named "${name}". Known loops: ${known}`);
    process.exitCode = 1;
  }
}
