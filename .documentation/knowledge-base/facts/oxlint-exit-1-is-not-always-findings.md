---
title: "oxlint exits 1 for findings, a broken config, and no files matched, and -c turns off nested configs"
tier: fact
domains:
  - troubleshooting
status: active
last_updated: 2026-11-02T00:00:00.000Z
id: oxlint-exit-1-is-not-always-findings
confidence: high
last_verified: 2026-11-02T00:00:00.000Z
verify_command: |
  #!/usr/bin/env bash
  set -euo pipefail
  cd "$(git rev-parse --show-toplevel)"
  node -e "
  const assert = require('assert');
  const os = require('os');
  const fs = require('fs');
  const path = require('path');
  const Ox = require('./lib/adapters/oxlint');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ox-'));
  const ox = new Ox({ projectRoot: root, appRoot: root });
  assert.ok(ox.buildCommand(['.']).args.includes('--ignore-pattern=**/node_modules/**'));
  fs.writeFileSync(path.join(root, '.oxlintrc.json'), '{}');
  assert.ok(!ox.buildCommand(['.']).args.includes('-c'));
  assert.deepStrictEqual(ox.parse('No files found to lint.\n{\"diagnostics\": [], \"number_of_files\": 0}'), []);
  "
provenance:
  - sources/gimme-the-lint-issue-39
sources:
  - lib/adapters/oxlint.js
tags:
  - gotcha
  - oxlint
  - silent-failure
invalidated_by:
  - oxlint changes its exit codes or stops disabling nested configs under -c
last_validated: 2026-11-02
---

# oxlint exits 1 for findings, a broken config, and no files matched

## Claim

Observed on oxlint 1.90.0:

- Exit 1 means findings, a config that failed to parse (non-JSON stdout), or no files
  matched (a banner, then JSON with empty `diagnostics` and `number_of_files: 0`).
- With no `.gitignore`, `oxlint .` lints `node_modules`: 2,556 findings against 2 in the
  same small app.
- `.oxlintrc.json`, `.oxlintrc.jsonc` and `oxlint.config.ts` are found automatically, including
  in parent directories. `oxlintrc.json` without the dot is not, and oxlint silently uses its
  default rules instead.
- Passing `-c` turns off nested configs.

## How to verify

The `verify_command` pins how the adapter responds to this, without needing oxlint
installed. Confirm the oxlint behaviour itself with the real binary.

## Instead

Read the findings rather than the exit code, ignore `node_modules` explicitly, and pass `-c`
only for `oxlintrc.json`.

## See also

- [A linter crash looks like a clean run](a-linter-crash-looks-like-a-clean-run.md)
