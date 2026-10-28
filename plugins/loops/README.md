# loops

A Claude Code plugin that turns "how we use agents on this codebase" into versioned config. A **loop** is a named list of steps (shell commands and agents), and a **repeat** group runs some of them round after round until a condition holds or a round limit is hit.

Requires Node 22.18 or later (TypeScript runs directly, no build step).

## Commands

```
/loops validate                         check every loop file
/loops show <loop>                      draw a loop as an ASCII graph
/loops run <loop> "what to build"       run it; exit 1 if it fails
/loops status                           how the last run went, round by round
/loops rm <loop>                        delete a loop's file
```

The same commands work outside Claude Code: `node src/cli.ts <command>`.

Loop files live in `.claude/loops/` (project) and `~/.claude/loops/` (personal). See [examples/build-until-green.yaml](examples/build-until-green.yaml) and the `loop-authoring` skill for the format. Run records are written to `.claude/loop-runs/`.

## Development

```
npm install
npm test
npm run typecheck
```

Tests drive the real CLI against throwaway project folders. Agent steps call `claude -p`; tests swap in a fake through `LOOPS_CLAUDE_BIN`.
