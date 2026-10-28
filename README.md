# claude-harness

Claude Code plugins that standardize how we use agents on our codebases.

## Plugins

- [loops](plugins/loops): define loops of steps and checks, including repeat-until rounds, and run them against an implementation.

Install from Claude Code:

```
/plugin marketplace add pmarchini/claude-harness
/plugin install loops@claude-harness
```

Or, from a clone of this repo (needs Node 22.18+ and the `claude` CLI):

```
make install
```

This installs dependencies, runs the typecheck and tests, and installs `loops` from your checkout, so edits apply at the next session start or after `/reload-plugins`.
