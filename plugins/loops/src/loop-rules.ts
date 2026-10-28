// The loop format and its rules. No Node imports: the pane (a Claude Code mod,
// which has no Node) shares this file with the CLI.

export type Step = { id: string; run?: string; agent?: string };
export type RepeatGroup = {
  id: string;
  until: string[];
  max_rounds: number;
  steps: Step[];
};
export type Node = Step | { repeat: RepeatGroup };
export type Loop = { name: string; steps: Node[] };

/** Everything that makes `loop` unsafe or impossible to run, as sentences for the person. */
export function problemsIn(loop: Loop): string[] {
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
