# Builds the loops plugin and installs it into Claude Code from this checkout.
# The plugin loads in place from plugins/loops, so later edits apply at the next
# session start or after /reload-plugins; run `make install` again after a pull
# to refresh dependencies.

PLUGIN_DIR := plugins/loops

.PHONY: build install

build:
	cd $(PLUGIN_DIR) && npm ci
	cd $(PLUGIN_DIR) && npm run typecheck
	cd $(PLUGIN_DIR) && npm test
	claude plugin validate .

# Both claude commands are safe to repeat: they report "already added/installed".
install: build
	claude plugin marketplace add "$(CURDIR)"
	claude plugin install loops@claude-harness
