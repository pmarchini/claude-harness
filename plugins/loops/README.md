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

`/loop-manager new` opens a pane that walks through four stages, shown at its top right: name › start › build › save.

1. **Name**: type a name and press Enter.
2. **Start**: press `1` for a blank loop (the palette opens at once), `2` for "Plan → build → test" or `3` for "Repeat until done". `b` goes back to the name.
3. **Build**: the graph, with the step under the cursor described below it. A line under the title counts the steps and says what is missing before the loop can be saved. Every action shows its key, and only the ones that can do something are shown:

| Key | Does |
| --- | --- |
| `h` / `l` | move the cursor to the previous or next step |
| `a` | add a step after the cursor: pick it by number (inside a repeat when the cursor is) |
| `x` | remove the step under the cursor |
| `r` | repeat: pick by number which steps around the cursor go round together (the step before it and the cursor's step come first) |
| `u` / `n` | inside a repeat: what it waits on, and how many rounds it may take before it stops anyway |
| `e` | on a tests or lint step: change its command (it starts from the repo's build files: Maven, Gradle, npm) |
| `s` | save to `.claude/loops/<name>.yaml`, once it validates |

   Lists are picked by number, and `b` leaves one without changing anything. A field (command, rounds) opens with the cursor in it: Enter sets it, an empty Enter keeps it as it was.
4. **Saved**: the pane shows how to run the loop; `e` keeps editing, `n` starts another loop, `c` closes the pane.

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
