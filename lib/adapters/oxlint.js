'use strict';

const fs = require('fs');
const path = require('path');
const { LinterAdapter } = require('./adapter');
const { createViolation, SEVERITY } = require('../violation');

// oxlint adapter. Parses `oxlint --format=json`.
//
// Exit 1 means findings, a broken config, or no files matched. The last two print no
// usable findings, so parse() returns [] and the shared lint() reports the failed run.

const OXLINT_CONFIG_FILES = [
  '.oxlintrc.json',
  '.oxlintrc.jsonc',
  'oxlintrc.json',
  'oxlint.config.ts',
];

// The one config name oxlint does not find by itself. The others are left to its own
// discovery, because passing -c turns off nested configs.
const NEEDS_EXPLICIT_CONFIG = 'oxlintrc.json';

class OxlintAdapter extends LinterAdapter {
  get id() {
    return 'oxlint';
  }

  get languages() {
    return ['javascript', 'typescript'];
  }

  get supportsFix() {
    return true;
  }

  get sourceExtensions() {
    return ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'];
  }

  get binary() {
    return this.resolveBinary([
      path.join(this.appRoot, 'node_modules', '.bin', 'oxlint'),
      path.join(this.projectRoot, 'node_modules', '.bin', 'oxlint'),
      'oxlint',
    ]);
  }

  configFiles() {
    return OXLINT_CONFIG_FILES;
  }

  detect(dir) {
    if (!dir || !fs.existsSync(dir)) return false;
    return (
      OXLINT_CONFIG_FILES.some((name) => fs.existsSync(path.join(dir, name))) ||
      this._scanForSource(dir, 5)
    );
  }

  buildCommand(targets, opts = {}) {
    // oxlint honours .gitignore but not node_modules by default: without a .gitignore
    // it lints every dependency, and baseline would grandfather all of it.
    const args = ['--format=json', '--ignore-pattern=**/node_modules/**'];
    if (opts.fix) args.push('--fix');

    const cwd = opts.cwd || this.appRoot;
    const config = this.resolveConfigPath(cwd);
    if (config && path.basename(config) === NEEDS_EXPLICIT_CONFIG) args.push('-c', config);

    const list = (targets && targets.length ? targets : ['.']).map((t) => {
      const rel = path.relative(cwd, path.resolve(this.projectRoot, t));
      return rel === '' ? '.' : rel;
    });
    // A staged file the config ignores is not a failure. A whole-app run that matches
    // nothing still is, so the flag applies to scoped runs only.
    if (list.some((t) => t !== '.')) args.push('--no-error-on-unmatched-pattern');
    args.push(...list);
    return { cmd: this.binary, args, cwd };
  }

  parse(stdout) {
    const text = (stdout || '').trim();
    let report;
    try {
      report = JSON.parse(text.slice(text.indexOf('{')));
    } catch {
      return [];
    }
    const diagnostics = report && Array.isArray(report.diagnostics) ? report.diagnostics : [];

    return diagnostics.map((d) => {
      const span = (d.labels && d.labels[0] && d.labels[0].span) || {};
      return createViolation({
        file: this._relativize(d.filename || ''),
        line: span.line,
        col: span.column,
        // oxlint gives syntax errors no code; keep them distinguishable.
        ruleId: d.code || 'syntax-error',
        severity:
          d.severity === 'error'
            ? SEVERITY.ERROR
            : d.severity === 'warning'
              ? SEVERITY.WARNING
              : SEVERITY.INFO,
        message: d.message,
        source: 'oxlint',
      });
    });
  }
}

module.exports = OxlintAdapter;
