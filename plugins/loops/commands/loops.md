---
description: Manage and run loops (validate, show, run, status, rm)
argument-hint: validate | show <loop> | run <loop> "what to build" | status | rm <loop>
allowed-tools: Bash(node:*)
---

Run the loops CLI from the project root and show its output to the person exactly as printed, inside a code block so the graph keeps its shape:

```
node "${CLAUDE_PLUGIN_ROOT}/src/cli.ts" $ARGUMENTS
```

- With no arguments, run `validate` and then `show` for each loop it lists.
- If the command exits with code 3, a loop file is invalid: offer to fix it with the loop-authoring skill.
- Before `rm`, confirm with the person which loop and file will be deleted.
