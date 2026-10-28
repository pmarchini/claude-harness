# loops

A Claude Code plugin that turns "how we use agents on this codebase" into versioned config. A **loop** is a named list of steps (shell commands and agents), and a **repeat** group runs some of them round after round until a condition holds or a round limit is hit.

Requires Node 22.18 or later (TypeScript runs directly, no build step).

## Commands

```
/loop-manager new                              build a loop in the editor pane
/loop-manager validate                         check every loop file
/loop-manager show <loop>                      draw a loop as an ASCII graph
/loop-manager run <loop> "what to build"       run it; exit 1 if it fails
/loop-manager status                           how the last run went, round by round
/loop-manager rm <loop>                        delete a loop's file
```

Claude Code ships its own `/loops`, so the plugin's command is `/loop-manager`. Everything but `new` works outside Claude Code too: `node src/cli.ts <command>`.

### Building a loop in the editor

`/loop-manager new` opens a pane. Name the loop, then start blank or from a template ("Plan → build → test", "Repeat until done"). Then, with the pane focused:

| Key | Does |
| --- | --- |
| `h` / `l` | move the cursor to the previous or next step |
| `a` | add a step after the cursor from the palette (inside a repeat when the cursor is) |
| `x` | remove the step under the cursor |
| `r` | repeat: pick which steps around the cursor go round together (the step before it and the cursor's step are suggested) |
| `s` | save to `.claude/loops/<name>.yaml`, once it validates |

With the cursor inside a repeat, the pane also shows its settings: which step it waits on (or every step), and how many rounds it may take before it stops anyway. The test and lint commands come from the repo's build files (Maven, Gradle, npm).

Loop files live in `.claude/loops/` (project) and `~/.claude/loops/` (personal). See [examples/build-until-green.yaml](examples/build-until-green.yaml) and the `loop-authoring` skill for the format. Run records are written to `.claude/loop-runs/`.

## Development

```
npm install
npm test
npm run typecheck
claude plugin test .
```

- `test/*.spec.ts` (node:test) drive the real CLI against throwaway project folders, plus the editor and graph modules. Agent steps call `claude -p`; tests swap in a fake through `LOOPS_CLAUDE_BIN`.
- `hooks/*.test.tsx` drive the editor pane through Claude Code's mod test kit: `claude plugin test .`
