'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const adapters = require('../lib/adapters');
const OxlintAdapter = require('../lib/adapters/oxlint');

// Recorded from oxlint 1.90.0.
const FINDINGS = `{ "diagnostics": [{"message": "\`debugger\` statement is not allowed","code": "eslint(no-debugger)","severity": "error","url": "https://oxc.rs/x","help": "Remove the debugger statement","filename": "src/a.ts","labels": [{"span": {"offset": 18,"length": 9,"line": 2,"column": 1}}]},
{"message": "Unused import","code": "eslint(no-unused-vars)","severity": "warning","filename": "src/b.ts","labels": [{"label": "declared here","span": {"offset": 1,"length": 1,"line": 3,"column": 5}}]}],
  "number_of_files": 2, "number_of_rules": 95, "threads_count": 8, "start_time": 0.007 }`;
const SYNTAX_ERROR = `{ "diagnostics": [{"message": "Unexpected token","severity": "error","filename": "src/bad.ts","labels": [{"span": {"offset": 6,"length": 1,"line": 1,"column": 7}}]}], "number_of_files": 1 }`;
const NO_FILES = `No files found to lint. Please check your paths and ignore patterns.
{ "diagnostics": [], "number_of_files": 0, "number_of_rules": 96 }`;

function tmp(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gtl-oxlint-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test.describe('parse', () => {
  const ox = new OxlintAdapter({ projectRoot: '/proj' });

  test('is registered', () => {
    assert.ok(adapters.getAdapter('oxlint') instanceof OxlintAdapter);
  });

  test('maps diagnostics', () => {
    const [a, b] = ox.parse(FINDINGS);
    assert.strictEqual(a.file, 'src/a.ts');
    assert.strictEqual(a.line, 2);
    assert.strictEqual(a.col, 1);
    assert.strictEqual(a.ruleId, 'eslint(no-debugger)');
    assert.strictEqual(a.severity, 'error');
    assert.strictEqual(a.source, 'oxlint');
    assert.strictEqual(b.severity, 'warning');
  });

  test('a syntax error has no code but stays identifiable', () => {
    assert.strictEqual(ox.parse(SYNTAX_ERROR)[0].ruleId, 'syntax-error');
  });

  test('a diagnostic with no labels still parses', () => {
    const out = ox.parse('{"diagnostics":[{"message":"m","code":"c","severity":"advice","filename":"a.ts"}]}');
    assert.strictEqual(out[0].severity, 'info');
    assert.strictEqual(out[0].ruleId, 'c');
  });

  test('tolerates the banner before the JSON', () => {
    assert.deepStrictEqual(ox.parse(NO_FILES), []);
  });
});

test.describe('buildCommand', () => {
  test('whole-app run ignores node_modules and errors on no files', (t) => {
    const root = tmp(t);
    const { cmd, args, cwd } = new OxlintAdapter({ projectRoot: root, appRoot: root }).buildCommand(['.']);
    assert.strictEqual(cmd, 'oxlint');
    assert.strictEqual(cwd, root);
    assert.ok(args.includes('--format=json'));
    assert.ok(args.includes('--ignore-pattern=**/node_modules/**'));
    assert.ok(!args.includes('--no-error-on-unmatched-pattern'));
    assert.strictEqual(args.at(-1), '.');
  });

  test('a scoped run tolerates ignored files and paths stay inside the app', (t) => {
    const root = tmp(t);
    const app = path.join(root, 'apps/web');
    fs.mkdirSync(app, { recursive: true });
    const { args } = new OxlintAdapter({ projectRoot: root, appRoot: app }).buildCommand(['apps/web/src/a.ts']);
    assert.ok(args.includes('--no-error-on-unmatched-pattern'));
    assert.strictEqual(args.at(-1), 'src/a.ts');
  });

  test('passes -c only for oxlintrc.json, the name oxlint will not find itself', (t) => {
    const root = tmp(t);
    const ox = new OxlintAdapter({ projectRoot: root, appRoot: root });
    fs.writeFileSync(path.join(root, 'oxlintrc.json'), '{}');
    const c = ox.buildCommand(['.']).args;
    assert.strictEqual(c[c.indexOf('-c') + 1], path.join(root, 'oxlintrc.json'));

    fs.rmSync(path.join(root, 'oxlintrc.json'));
    fs.writeFileSync(path.join(root, '.oxlintrc.json'), '{}');
    assert.ok(!ox.buildCommand(['.']).args.includes('-c'), '-c would disable nested configs');
  });

  test('--fix is passed through', (t) => {
    const root = tmp(t);
    assert.ok(new OxlintAdapter({ projectRoot: root }).buildCommand(['.'], { fix: true }).args.includes('--fix'));
  });

  test('prefers the app-local binary', (t) => {
    const root = tmp(t);
    const app = path.join(root, 'apps/web');
    const bin = path.join(app, 'node_modules/.bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'oxlint'), '');
    assert.strictEqual(new OxlintAdapter({ projectRoot: root, appRoot: app }).binary, path.join(bin, 'oxlint'));
  });
});

test.describe('failed runs are not clean', () => {
  function withBinary(t, script) {
    const root = tmp(t);
    const bin = path.join(root, 'node_modules/.bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'oxlint'), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
    return new OxlintAdapter({ projectRoot: root, appRoot: root });
  }

  test('a broken config: exit 1, non-JSON stdout', (t) => {
    const ox = withBinary(t, 'echo "Failed to parse oxlint configuration file."; exit 1');
    assert.throws(() => ox.lint(['.']), /oxlint exited 1[\s\S]*Failed to parse/);
  });

  test('no files matched: exit 1, valid JSON with nothing in it', (t) => {
    const ox = withBinary(t, `cat <<'J'\n${NO_FILES}\nJ\nexit 1`);
    assert.throws(() => ox.lint(['.']), /oxlint exited 1/);
  });

  test('findings with exit 1 are findings', (t) => {
    const ox = withBinary(t, `cat <<'J'\n${FINDINGS}\nJ\nexit 1`);
    assert.strictEqual(ox.lint(['.']).length, 2);
  });
});

const { discoverApps } = require('../lib/project-model');
const { writeLinterConfigs } = require('../lib/linter-configs');
const { init } = require('../lib/installer');

function tree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}
const APP = '{"name":"w","dependencies":{"react":"1"}}';
const appWith = (dev) => JSON.stringify({ name: 'w', dependencies: { react: '1' }, devDependencies: dev });
const linters = (root, app) => (discoverApps(root, { config: {} }).find((a) => a.appPath === app) || {}).linters;

test.describe('discovery', () => {
  for (const name of ['.oxlintrc.json', '.oxlintrc.jsonc', 'oxlintrc.json', 'oxlint.config.ts']) {
    test(`${name} binds oxlint and drops ESLint`, (t) => {
      const root = tmp(t);
      tree(root, { 'apps/web/package.json': APP, 'apps/web/src/a.ts': '', [`apps/web/${name}`]: '{}' });
      assert.deepStrictEqual(linters(root, 'apps/web'), ['oxlint']);
    });
  }

  test('a devDependency alone binds oxlint', (t) => {
    const root = tmp(t);
    tree(root, { 'package.json': appWith({ oxlint: '1' }), 'src/a.ts': '' });
    assert.deepStrictEqual(linters(root, '.'), ['oxlint']);
  });

  test('a devDependency with no source does not bind it, or drift would never clear', (t) => {
    const root = tmp(t);
    tree(root, { 'package.json': '{"name":"t","devDependencies":{"oxlint":"1"}}' });
    assert.strictEqual(linters(root, '.'), undefined);
  });

  test('without oxlint nothing changes', (t) => {
    const root = tmp(t);
    tree(root, { 'package.json': APP, 'src/a.ts': '' });
    assert.deepStrictEqual(linters(root, '.'), ['eslint']);
  });

  test('the config install used to seed does not keep ESLint bound', (t) => {
    const root = tmp(t);
    tree(root, { 'package.json': APP, 'src/a.ts': '', '.oxlintrc.json': '{}', 'eslint.config.js': '' });
    assert.deepStrictEqual(linters(root, '.'), ['oxlint']);
  });

  test('a real ESLint setup stays alongside oxlint', (t) => {
    const root = tmp(t);
    tree(root, { 'package.json': appWith({ eslint: '9', oxlint: '1' }), 'src/a.ts': '', 'eslint.config.js': '' });
    assert.deepStrictEqual(linters(root, '.'), ['eslint', 'oxlint']);
  });

  test('ESLint declared at the repo root with config in the app stays', (t) => {
    const root = tmp(t);
    tree(root, {
      'package.json': '{"name":"r","private":true,"devDependencies":{"eslint":"9"}}',
      'apps/web/package.json': APP,
      'apps/web/src/a.ts': '',
      'apps/web/.oxlintrc.json': '{}',
      'apps/web/eslint.config.js': '',
    });
    assert.deepStrictEqual(linters(root, 'apps/web'), ['eslint', 'oxlint']);
  });

  test('a root config covers nested apps: no ESLint there, oxlint runs from the root', (t) => {
    const root = tmp(t);
    tree(root, {
      '.oxlintrc.json': '{}',
      'package.json': '{"name":"r","private":true}',
      'apps/web/package.json': APP,
      'apps/web/src/a.ts': '',
    });
    assert.deepStrictEqual(linters(root, '.'), ['oxlint']);
    assert.strictEqual(linters(root, 'apps/web'), undefined);
  });

  test('a sibling oxlint does not cost another app its ESLint', (t) => {
    const root = tmp(t);
    tree(root, {
      'apps/web/package.json': APP,
      'apps/web/src/a.ts': '',
      'apps/web/.oxlintrc.json': '{}',
      'apps/webadmin/package.json': APP,
      'apps/webadmin/src/a.ts': '',
    });
    assert.deepStrictEqual(linters(root, 'apps/webadmin'), ['eslint']);
  });

  test('an unbound root oxlint does not drop ESLint: the app must not lose its only guard', (t) => {
    const root = tmp(t);
    tree(root, {
      '.oxlintrc.json': '{}',
      'apps/web/package.json': APP,
      'apps/web/src/a.ts': '',
      'apps/web/.oxlintrc.json': '{}',
      'apps/other/package.json': APP,
      'apps/other/src/a.ts': '',
    });
    assert.deepStrictEqual(linters(root, 'apps/web'), ['oxlint']);
    assert.deepStrictEqual(linters(root, 'apps/other'), ['eslint']);
  });
});

test.describe('install', () => {
  test('seeds no ESLint or Prettier config for an oxlint app', async (t) => {
    const root = tmp(t);
    tree(root, { 'apps/web/package.json': APP, 'apps/web/src/a.ts': '', 'apps/web/.oxlintrc.json': '{}' });
    await writeLinterConfigs(root);
    assert.ok(!fs.existsSync(path.join(root, 'apps/web/eslint.config.js')));
    assert.ok(!fs.existsSync(path.join(root, 'apps/web/.prettierrc.json')));
    assert.strictEqual(fs.readFileSync(path.join(root, 'apps/web/.oxlintrc.json'), 'utf8'), '{}');
  });

  test('the legacy frontend/ path seeds nothing for an oxlint app either', async (t) => {
    const root = tmp(t);
    tree(root, {
      'frontend/package.json': APP,
      'frontend/src/a.ts': '',
      'frontend/.oxlintrc.json': '{}',
      'backend/pyproject.toml': '[project]\nname="b"\nversion="1"\n',
    });
    await init(root, {});
    assert.ok(!fs.existsSync(path.join(root, 'frontend/eslint.config.js')));
    assert.ok(!fs.existsSync(path.join(root, 'frontend/.prettierrc.json')));
  });

  test('the legacy path still seeds an ESLint app', async (t) => {
    const root = tmp(t);
    tree(root, {
      'frontend/package.json': APP,
      'frontend/src/a.ts': '',
      'backend/pyproject.toml': '[project]\nname="b"\nversion="1"\n',
    });
    await init(root, {});
    assert.ok(fs.existsSync(path.join(root, 'frontend/eslint.config.js')));
  });
});
