import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunRecord } from './runner.ts';

const RUNS_DIR = '.claude/loop-runs';

/** Writes a finished run to `.claude/loop-runs/<started-at>/run.json`. */
export function saveRun(projectDir: string, record: RunRecord, startedAt: Date): void {
  // ISO time without colons: sorts by start time and is a valid folder name everywhere.
  const runDir = join(projectDir, RUNS_DIR, startedAt.toISOString().replaceAll(':', '-'));
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'run.json'), `${JSON.stringify(record, null, 2)}\n`);
}

/** Reads the most recently started run, or undefined when the project has none. */
export function readLatestRun(projectDir: string): RunRecord | undefined {
  const runsDir = join(projectDir, RUNS_DIR);
  if (!existsSync(runsDir)) return undefined;

  const latest = readdirSync(runsDir).sort().at(-1);
  if (latest === undefined) return undefined;
  return JSON.parse(readFileSync(join(runsDir, latest, 'run.json'), 'utf8'));
}
