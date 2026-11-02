---
title: "An older global gimme-the-lint on PATH runs ahead of the plugin copy in hooks"
tier: fact
domains:
  - troubleshooting
status: active
last_updated: 2026-11-02T00:00:00.000Z
id: a-global-cli-on-path-shadows-the-plugin-copy
confidence: high
last_verified: 2026-11-02T00:00:00.000Z
verify_command: |
  #!/usr/bin/env bash
  set -euo pipefail
  cd "$(git rev-parse --show-toplevel)"
  node -e "
  const assert = require('assert');
  const { hookSnippet } = require('./lib/git-hooks-manager');
  const s = hookSnippet('pre-commit');
  const local = s.indexOf('node_modules/.bin/gimme-the-lint');
  const onPath = s.indexOf('command -v gimme-the-lint');
  const plugin = s.indexOf('plugins/cache');
  assert.ok(local > -1 && local < onPath && onPath < plugin);
  "
provenance:
  - sources/gimme-the-lint-issue-39
sources:
  - lib/git-hooks-manager.js
  - githooks/pre-commit
  - githooks/pre-push
tags:
  - gotcha
  - hooks
  - install
invalidated_by:
  - hooks stop preferring PATH over the plugin cache when resolving the CLI
last_validated: 2026-11-02
---

# An older global gimme-the-lint on PATH runs ahead of the plugin copy in hooks

## Claim

Hooks look for the CLI in this order: the repo's `node_modules/.bin`, then `PATH`, then the
Claude Code plugin cache. A global install on `PATH` therefore wins over a newer plugin copy,
and the hook runs the older engine with no warning about which copy it used.

Observed while testing the crash fix for #39: a commit that should have been blocked passed,
because a global install without the fix ran first. With the current CLI first on `PATH`, the
same commit was blocked.

## How to verify

The `verify_command` pins the lookup order in the snippet. To see which copy your hooks would
reach, run `command -v gimme-the-lint` and `gimme-the-lint --version`.

## Instead

Upgrade or remove the global install on a machine that uses the plugin:
`npm uninstall -g gimme-the-lint`. When testing a change to the engine, put the working copy
first on `PATH`, or the test may exercise the installed version instead.

## See also

- [A linter crash looks like a clean run](a-linter-crash-looks-like-a-clean-run.md)
