import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse, YAMLParseError } from 'yaml';

export type Step = { id: string; run?: string; agent?: string };
export type RepeatGroup = {
  id: string;
  until: string[];
  max_rounds: number;
  steps: Step[];
};
export type Node = Step | { repeat: RepeatGroup };
export type Loop = { name: string; steps: Node[] };

/** A loop with the file it was read from: `path` on disk, `source` as shown to the person. */
export type LoadedLoop = { loop: Loop; path: string; source: string };
export type LoadResult = { loops: LoadedLoop[]; problems: string[] };

/**
 * Reads the loops visible from `projectDir` and reports what is wrong with each file.
 * Personal loops (~/.claude/loops) load first; a project loop with the same name
 * replaces the personal one, the way project settings override user settings.
 */
export function loadLoops(projectDir: string): LoadResult {
  const layers = [
    { dir: join(homedir(), '.claude/loops'), label: '~/.claude/loops' },
    { dir: join(projectDir, '.claude/loops'), label: '.claude/loops' },
  ];
  const loopsByName = new Map<string, LoadedLoop>();
  const problems: string[] = [];

  for (const { dir, label } of layers) {
    if (!existsSync(dir)) continue;

    for (const file of readdirSync(dir).filter((f) => f.endsWith('.yaml'))) {
      const path = join(dir, file);
      const source = `${label}/${file}`;
      const loop = parseLoop(readFileSync(path, 'utf8'));
      if (typeof loop === 'string') {
        problems.push(`${source}: ${loop}`);
        continue;
      }

      const fileProblems = problemsIn(loop).map((p) => `${source}: ${p}`);
      problems.push(...fileProblems);
      if (fileProblems.length === 0) loopsByName.set(loop.name, { loop, path, source });
    }
  }

  return { loops: [...loopsByName.values()], problems };
}

/** Returns the parsed loop, or why the text is not one. */
function parseLoop(text: string): Loop | string {
  try {
    return parse(text);
  } catch (error) {
    if (!(error instanceof YAMLParseError)) throw error;
    return `not valid YAML (${error.message.split('\n')[0]})`;
  }
}

function problemsIn(loop: Loop): string[] {
  if (typeof loop?.name !== 'string' || !Array.isArray(loop.steps)) {
    return ['needs a name and a list of steps'];
  }

  const problems: string[] = [];
  for (const node of loop.steps) {
    if (!('repeat' in node)) {
      problems.push(...stepProblems(node));
      continue;
    }

    const { id, until, max_rounds, steps } = node.repeat;
    if (!max_rounds) problems.push(`repeat "${id}" needs max_rounds`);

    const insideIds = steps.map((step) => step.id);
    for (const stepId of until.filter((u) => !insideIds.includes(u))) {
      problems.push(`repeat "${id}" stops on "${stepId}", which is not a step inside it`);
    }

    problems.push(...steps.flatMap(stepProblems));
  }
  return problems;
}

function stepProblems(step: Step): string[] {
  const hasOneAction = (step.run === undefined) !== (step.agent === undefined);
  return hasOneAction ? [] : [`step "${step.id}" needs either run or agent`];
}
