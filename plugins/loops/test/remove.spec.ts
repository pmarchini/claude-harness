import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { projectWith, runLoops } from './helpers.ts';

test('rm deletes the file a loop was loaded from, so the loop is gone', () => {
  const project = projectWith({
    '.claude/loops/old-checks.yaml': 'name: old-checks\nsteps:\n  - id: lint\n    run: "true"\n',
  });

  const result = runLoops(project, ['rm', 'old-checks']);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /Removed old-checks \(\.claude\/loops\/old-checks\.yaml\)/);
  assert.equal(existsSync(join(project, '.claude/loops/old-checks.yaml')), false);
});
