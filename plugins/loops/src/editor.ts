// The editor behind `/loops new`: edits on a loop being built, and the YAML it
// saves as. Pure functions with no Node imports, so the pane (a Claude Code mod)
// and the tests share them.
import type { Loop, RepeatGroup, Step } from './loop-rules.ts';

/** The blocks of the palette, each a step with sensible defaults. */
export const BLOCKS = {
  plan: { id: 'plan', agent: 'planner' },
  implement: { id: 'implement', agent: 'main' },
  tests: (command: string): Step => ({ id: 'tests', run: command }),
  lint: (command: string): Step => ({ id: 'lint', run: command }),
  report: { id: 'report', agent: 'reporter' },
} as const;

/** Rounds a new repeat allows until the person changes it: enough to converge, never endless. */
const DEFAULT_MAX_ROUNDS = 10;

export function blankLoop(name: string): Loop {
  return { name, steps: [] };
}

/**
 * Adds `block` after the step drawn at `position` (-1 adds it first) and returns
 * the new loop with the position the added step now holds. Positions count steps
 * in drawing order, those inside repeats included; a step added after one inside
 * a repeat joins that repeat.
 */
export function addAfter(loop: Loop, position: number, block: Step): { loop: Loop; position: number } {
  const steps = [...loop.steps];
  const where = position < 0 ? undefined : locate(loop, position);
  const added = { ...block, id: unusedId(loop, block.id) };

  if (where?.inner === undefined) {
    steps.splice(where ? where.node + 1 : 0, 0, added);
  } else {
    const { repeat } = steps[where.node] as { repeat: RepeatGroup };
    const inside = [...repeat.steps];
    inside.splice(where.inner + 1, 0, added);
    steps[where.node] = { repeat: { ...repeat, steps: inside } };
  }
  return { loop: { ...loop, steps }, position: position + 1 };
}

/**
 * Removes the step drawn at `position`. A repeat left empty goes too; a repeat
 * that stopped on the removed step stops on its last remaining step instead.
 */
export function remove(loop: Loop, position: number): Loop {
  const where = locate(loop, position);
  if (!where) return loop;

  const steps = [...loop.steps];
  if (where.inner === undefined) {
    steps.splice(where.node, 1);
    return { ...loop, steps };
  }

  const { repeat } = steps[where.node] as { repeat: RepeatGroup };
  const inside = repeat.steps.filter((_, i) => i !== where.inner);
  if (inside.length === 0) {
    steps.splice(where.node, 1);
    return { ...loop, steps };
  }

  const kept = repeat.until.filter((id) => inside.some((step) => step.id === id));
  const until = kept.length > 0 ? kept : [inside[inside.length - 1].id];
  steps[where.node] = { repeat: { ...repeat, until, steps: inside } };
  return { ...loop, steps };
}

/**
 * Wraps the steps drawn from `first` to `last` (inclusive) in a repeat group. It
 * stops when the last of them passes, which is usually the check (tests after
 * implement). Returns why not, as a sentence, when the range holds a repeat.
 */
export function wrapInRepeat(loop: Loop, first: number, last: number): Loop | string {
  const start = locate(loop, first);
  const end = locate(loop, last);
  if (!start || !end || start.inner !== undefined || end.inner !== undefined) {
    return 'Pick steps outside a repeat: repeats do not nest.';
  }

  const inside = loop.steps.slice(start.node, end.node + 1);
  if (inside.some((node) => 'repeat' in node)) return 'Pick steps outside a repeat: repeats do not nest.';

  const repeat: RepeatGroup = {
    id: 'repeat',
    until: [(inside[inside.length - 1] as Step).id],
    max_rounds: DEFAULT_MAX_ROUNDS,
    steps: inside as Step[],
  };
  const steps = [...loop.steps.slice(0, start.node), { repeat }, ...loop.steps.slice(end.node + 1)];
  return { ...loop, steps };
}

/** `id`, or `id-2`, `id-3`… when the loop already has a step called that. */
function unusedId(loop: Loop, id: string): string {
  const taken = new Set(loop.steps.flatMap((node) => ('repeat' in node ? node.repeat.steps : [node])).map((s) => s.id));
  let candidate = id;
  for (let n = 2; taken.has(candidate); n++) candidate = `${id}-${n}`;
  return candidate;
}

/** Where the step drawn at `position` sits: its top-level node, and its index inside that node's repeat. */
function locate(loop: Loop, position: number): { node: number; inner?: number } | undefined {
  let drawn = 0;
  for (const [node, entry] of loop.steps.entries()) {
    if (!('repeat' in entry)) {
      if (drawn === position) return { node };
      drawn += 1;
      continue;
    }

    const inner = position - drawn;
    if (inner < entry.repeat.steps.length) return { node, inner };
    drawn += entry.repeat.steps.length;
  }
  return undefined;
}

/** The loop as the YAML file `loops validate` reads. */
export function toYaml(loop: Loop): string {
  const lines = [`name: ${scalar(loop.name)}`, 'steps:'];
  for (const node of loop.steps) {
    if (!('repeat' in node)) {
      lines.push(...stepLines(node, '  '));
      continue;
    }

    const { id, until, max_rounds, steps } = node.repeat;
    lines.push(
      '  - repeat:',
      `      id: ${scalar(id)}`,
      `      until: [${until.map(scalar).join(', ')}]`,
      `      max_rounds: ${max_rounds}`,
      '      steps:',
      ...steps.flatMap((step) => stepLines(step, '        ')),
    );
  }
  return `${lines.join('\n')}\n`;
}

function stepLines(step: Step, indent: string): string[] {
  const action = step.run !== undefined ? `run: ${scalar(step.run)}` : `agent: ${scalar(step.agent!)}`;
  return [`${indent}- id: ${scalar(step.id)}`, `${indent}  ${action}`];
}

/** Leaves plain words plain and quotes anything YAML could read as something else. */
function scalar(text: string): string {
  return /^[A-Za-z0-9][\w .\/-]*$/.test(text) && !text.endsWith(' ') ? text : JSON.stringify(text);
}
