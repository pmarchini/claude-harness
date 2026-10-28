import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const CLI = new URL('../src/cli.ts', import.meta.url).pathname;

/** Creates a throwaway repo directory holding the given files (path → content). */
export function projectWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'loops-test-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

/**
 * Runs the `loops` CLI the way the /loops command does, inside `cwd`.
 * HOME is an empty directory unless `env.HOME` says otherwise, so the
 * developer's own ~/.claude/loops never leaks into a test.
 */
export function runLoops(cwd: string, args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, HOME: projectWith({}), ...env },
  });
  return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
}
