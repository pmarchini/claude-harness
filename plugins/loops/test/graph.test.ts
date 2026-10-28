// The graph module on its own, for what only the pane asks of it: the CLI's
// `show` test covers the plain drawing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderLoop } from '../src/graph.ts';

test('selected steps are drawn with a heavy border so the cursor is visible', () => {
  const loop = {
    name: 'any-loop',
    steps: [
      { id: 'plan', agent: 'planner' },
      { id: 'tests', run: 'npm test' },
    ],
  };

  const graph = renderLoop(loop, { selected: [1] });

  assert.match(graph, /┌─+┐ +┏━+┓/);
  assert.match(graph, /│ plan +│─+>┃ tests +┃/);
});
