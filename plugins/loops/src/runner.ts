import { spawnSync } from 'node:child_process';
import type { Loop, RepeatGroup, Step } from './loop-rules.ts';

export type StepRecord = { id: string; passed: boolean };
export type RepeatRecord = { repeat: string; passed: boolean; rounds: StepRecord[][] };

/** Everything a finished run leaves behind for `loops status` and the report. */
export type RunRecord = {
  loop: string;
  task: string;
  status: 'passed' | 'failed';
  steps: Array<StepRecord | RepeatRecord>;
};

/** What every step of one run shares. */
export type RunContext = {
  projectDir: string;
  /** What the person asked to build, handed to every agent step. */
  task: string;
  /** The `claude` executable agent steps call; tests point it at a fake. */
  claudeBin: string;
  say: (line: string) => void;
};

type StepResult = { step: Step; passed: boolean; output: string };

/** How much of a failing step's output the next round's agent gets to see. */
const FAILURE_TAIL_LINES = 40;

/** The agent name that means "the main conversation", not a subagent. */
const MAIN_AGENT = 'main';

/**
 * Runs a loop's steps in order, printing progress through `context.say`, and
 * stops at the first step that fails. A repeat group runs its steps round after
 * round until every until-step passes in the same round, or max_rounds is reached.
 */
export function runLoop(loop: Loop, context: RunContext): RunRecord {
  const steps: RunRecord['steps'] = [];

  for (const node of loop.steps) {
    const record = 'repeat' in node
      ? runRepeat(node.repeat, context)
      : toRecord(runStep(node, context.task, context));
    steps.push(record);

    if (!record.passed) return { loop: loop.name, task: context.task, status: 'failed', steps };
  }
  return { loop: loop.name, task: context.task, status: 'passed', steps };
}

function runRepeat(repeat: RepeatGroup, context: RunContext): RepeatRecord {
  const rounds: StepRecord[][] = [];
  let lastRound: StepResult[] = [];
  let stillFailing = repeat.until;

  for (let round = 1; round <= repeat.max_rounds; round++) {
    const prompt = promptForRound(context.task, lastRound);
    lastRound = repeat.steps.map((step) => runStep(step, prompt, context));
    rounds.push(lastRound.map(toRecord));

    stillFailing = repeat.until.filter((id) => !lastRound.some((r) => r.step.id === id && r.passed));
    if (stillFailing.length === 0) {
      context.say(`✓ ${repeat.id}: until met in round ${round} of ${repeat.max_rounds}`);
      return { repeat: repeat.id, passed: true, rounds };
    }
  }

  const limit = repeat.max_rounds;
  context.say(`✗ ${repeat.id}: stopped after ${limit} of ${limit} rounds, still failing: ${stillFailing.join(', ')}`);
  return { repeat: repeat.id, passed: false, rounds };
}

/**
 * Each round starts with fresh context, so the agent learns about earlier rounds
 * only from this prompt: the task, plus the output of whatever failed last time.
 */
function promptForRound(task: string, lastRound: StepResult[]): string {
  const failures = lastRound
    .filter((result) => !result.passed)
    .map(({ step, output }) => `${step.id} failed:\n${output.split('\n').slice(-FAILURE_TAIL_LINES).join('\n')}`);
  if (failures.length === 0) return task;

  return `${task}\n\nThe previous round did not finish the job. Fix what failed:\n\n${failures.join('\n\n')}`;
}

function runStep(step: Step, prompt: string, context: RunContext): StepResult {
  const options = { cwd: context.projectDir, encoding: 'utf8' } as const;
  const result = step.run !== undefined
    ? spawnSync('sh', ['-c', step.run], options)
    : spawnSync(context.claudeBin, ['-p', agentPrompt(step.agent!, prompt)], options);
  return { step, passed: result.status === 0, output: `${result.stdout}${result.stderr}` };
}

function agentPrompt(agent: string, prompt: string): string {
  if (agent === MAIN_AGENT) return prompt;
  return `Use the ${agent} subagent for this.\n\n${prompt}`;
}

function toRecord({ step, passed }: StepResult): StepRecord {
  return { id: step.id, passed };
}
