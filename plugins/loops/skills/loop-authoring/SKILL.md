---
name: loop-authoring
description: Create, change or delete loops for the loops plugin (files in .claude/loops/*.yaml). Use whenever the person asks to make a loop, add or remove a step, add a repeat-until group, or change when a loop stops, with or without the /loops command.
---

# Writing loops

A loop is a YAML file in `.claude/loops/` (shared with the project) or `~/.claude/loops/` (personal). A project loop replaces a personal loop with the same `name`.

```yaml
name: build-until-green
steps:
  - id: plan
    agent: planner            # an agent step: Claude, handed to the named subagent
  - repeat:                   # a repeat group: runs its steps again, round after round
      id: build
      until: [tests]          # stops when all of these steps pass in the same round
      max_rounds: 10          # required: a repeat can never run forever
      steps:
        - id: implement
          agent: main         # "main" means Claude itself, not a subagent
        - id: tests
          run: npm test       # a shell step: passes when the command exits 0
  - id: report
    agent: reporter
```

Rules the validator enforces:
- Every file has a `name` and a list of `steps`.
- Every step has an `id` and exactly one of `run` (shell command) or `agent`.
- Every repeat has `max_rounds`, and every id in `until` is a step inside that repeat.

Each round of a repeat starts with fresh context: agent steps get the task plus the output of whatever failed in the previous round, so the prompt is the only memory between rounds.

## How to make a change

1. Read the current loop file, if any, before changing it. Run `node "${CLAUDE_PLUGIN_ROOT}/src/cli.ts" show <loop>` to see the current graph.
2. Detect the test command from the repo (package.json scripts, pom.xml → `mvn -q test`, build.gradle → `./gradlew test`) instead of guessing.
3. Show the person the diff and the new graph, and ask before writing.
4. After writing, run `node "${CLAUDE_PLUGIN_ROOT}/src/cli.ts" validate`. If it exits 3, fix the reported problem before saying you are done.
5. To delete a loop, confirm with the person, then run `node "${CLAUDE_PLUGIN_ROOT}/src/cli.ts" rm <loop>`.
