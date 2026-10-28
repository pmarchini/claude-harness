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

/** The commands a repo runs its checks with, as the blocks need them. */
export type Commands = { tests: string; lint: string };

/** Build files, most specific first, and the commands each one implies. */
const BUILD_TOOLS: Array<{ files: string[]; commands: Commands }> = [
  { files: ['pom.xml'], commands: { tests: 'mvn -q test', lint: 'mvn -q checkstyle:check' } },
  { files: ['build.gradle', 'build.gradle.kts'], commands: { tests: './gradlew test', lint: './gradlew check' } },
  { files: ['package.json'], commands: { tests: 'npm test', lint: 'npm run lint' } },
];
const FALLBACK_COMMANDS: Commands = { tests: 'make test', lint: 'make lint' };

/** Picks the test and lint commands from the names of the files at the repo's root. */
export function detectCommands(rootFiles: string[]): Commands {
  const tool = BUILD_TOOLS.find(({ files }) => files.some((file) => rootFiles.includes(file)));
  return tool?.commands ?? FALLBACK_COMMANDS;
}

export const TEMPLATES = {
  'plan-build-test': 'Plan → build → test, each step once',
  'repeat-until-done': 'Repeat until done: plan, then implement and test until the tests pass, then report',
} as const;
export type TemplateId = keyof typeof TEMPLATES;

export function fromTemplate(template: TemplateId, name: string, commands: Commands): Loop {
  const flat = [BLOCKS.plan, BLOCKS.implement, BLOCKS.tests(commands.tests), BLOCKS.report].reduce(
    (loop, block, i) => addAfter(loop, i - 1, block).loop,
    blankLoop(name),
  );
  if (template === 'plan-build-test') return flat;

  // implement (1) and tests (2) go round until the tests pass.
  return wrapInRepeat(flat, 1, 2) as Loop;
}

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
  const until = kept.length > 0 ? kept : [inside.at(-1)!.id];
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

/** A run of steps, by their positions in drawing order, first and last included. */
export type Range = { first: number; last: number };

/**
 * The runs of steps around `position` that a repeat could hold, the likeliest
 * first: the step before it with it (do, then check), then the shorter runs.
 * Steps already inside a repeat are never part of one, as repeats do not nest.
 */
export function repeatChoices(loop: Loop, position: number): Range[] {
  const isOutsideRepeats = (p: number) => {
    const where = p < 0 ? undefined : locate(loop, p);
    return where !== undefined && where.inner === undefined;
  };
  if (!isOutsideRepeats(position)) return [];

  let lowest = position;
  while (isOutsideRepeats(lowest - 1)) lowest -= 1;
  let highest = position;
  while (isOutsideRepeats(highest + 1)) highest += 1;

  const choices: Range[] = [];
  for (let first = lowest; first <= position; first++) {
    for (let last = position; last <= highest; last++) choices.push({ first, last });
  }
  const isDoThenCheck = ({ first, last }: Range) => first === position - 1 && last === position;
  const length = ({ first, last }: Range) => last - first;
  return choices.sort(
    (a, b) => Number(isDoThenCheck(b)) - Number(isDoThenCheck(a)) || length(a) - length(b) || a.first - b.first,
  );
}

/** Changes when a repeat stops: the steps it waits on, the rounds it allows, or both. */
export function changeRepeat(
  loop: Loop,
  repeatId: string,
  changes: Partial<Pick<RepeatGroup, 'until' | 'max_rounds'>>,
): Loop {
  const steps = loop.steps.map((node) =>
    'repeat' in node && node.repeat.id === repeatId ? { repeat: { ...node.repeat, ...changes } } : node,
  );
  return { ...loop, steps };
}

/** Makes the command step drawn at `position` run `command` instead. */
export function changeCommand(loop: Loop, position: number, command: string): Loop {
  const where = locate(loop, position);
  if (!where) return loop;

  const steps = [...loop.steps];
  if (where.inner === undefined) {
    steps[where.node] = { ...(steps[where.node] as Step), run: command };
  } else {
    const { repeat } = steps[where.node] as { repeat: RepeatGroup };
    const inside = repeat.steps.map((step, i) => (i === where.inner ? { ...step, run: command } : step));
    steps[where.node] = { repeat: { ...repeat, steps: inside } };
  }
  return { ...loop, steps };
}

/** The repeat the step drawn at `position` belongs to, if it is inside one. */
export function repeatAt(loop: Loop, position: number): RepeatGroup | undefined {
  const where = locate(loop, position);
  if (where?.inner === undefined) return undefined;
  return (loop.steps[where.node] as { repeat: RepeatGroup }).repeat;
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
