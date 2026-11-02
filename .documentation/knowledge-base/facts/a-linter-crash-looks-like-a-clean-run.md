---
title: "A linter that crashed reports nothing, and nothing is what clean looks like"
tier: fact
domains:
  - troubleshooting
status: active
last_updated: 2026-11-02T00:00:00.000Z
id: a-linter-crash-looks-like-a-clean-run
confidence: high
last_verified: 2026-11-02T00:00:00.000Z
verify_command: |
  #!/usr/bin/env bash
  set -euo pipefail
  node -e "
  const assert = require('assert');
  const { LinterAdapter } = require('./lib/adapters/adapter');
  class Crash extends LinterAdapter {
    get id() { return 'crash'; }
    buildCommand() { return { cmd: process.execPath, args: ['-e', 'process.exit(2)'] }; }
    parse() { return []; }
  }
  assert.throws(() => new Crash({ projectRoot: '.' }).lint([]), (e) => e.code === 'ADAPTER_FAILED');
  "
tags:
  - gotcha
  - silent-failure
  - eslint
  - biome
invalidated_by:
last_validated: 2026-11-02
---

# A linter that crashed reports nothing, and nothing is what clean looks like

## Claim

ESLint 9 with a config that imports a missing plugin exits 2 with empty stdout. Biome with
a broken `biome.json` exits 1 with empty stdout. An adapter's `parse()` returns `[]` for
empty output, which is also what a clean run returns. Only the exit code tells them apart.

## Why it matters

Before this was caught, `baseline` recorded such a linter as `clean` and `check` printed
`Safe to commit`, including on a commit that added `debugger;`. The seeded
`eslint.config.js` imports plugins the app may not have, so installing ESLint without them
was enough to hit it.

## Instead

Never decide "clean" from the output alone. `LinterAdapter.lint()` treats a non-zero exit
with no findings as a failed run and throws `ADAPTER_FAILED`. An adapter that overrides
`lint()` has to make the same check itself.

A baseline captured during a crash recorded zero fingerprints. Once the linter runs again,
everything it finds is new, so re-run `gimme-the-lint baseline` after repairing it.

## See also

- [Troubleshooting guide](../../troubleshooting/troubleshooting-guide.md)
