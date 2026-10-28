#!/usr/bin/env node
import { loadLoops } from './loop-file.ts';

/** Exit codes shared with headless runs: see the design doc, "Headless and CI". */
const EXIT_INVALID_LOOP = 3;

const [command] = process.argv.slice(2);

if (command === 'validate') {
  const { loops, problems } = loadLoops(process.cwd());
  for (const { loop, source } of loops) console.log(`✓ ${loop.name.padEnd(24)} ${source}`);
  for (const problem of problems) console.error(`✗ ${problem}`);
  if (problems.length > 0) process.exitCode = EXIT_INVALID_LOOP;
}
