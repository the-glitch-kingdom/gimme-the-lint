'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { hookSnippet } = require('../lib/git-hooks-manager');

// A Claude Code plugin install has no project node_modules and no PATH entry, and it
// resolves dependencies from a plugin folder shared with other plugins (#39). That cost
// two things: `install` crashed on the shared cache's ESM-only chalk, and every hook
// printed "not installed" and skipped, so nothing was ever gated.

const REPO = path.join(__dirname, '..');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtl-plugin-only-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return fs.realpathSync(dir);
}

/** A fake $HOME holding plugin versions whose CLI and script record how they were run. */
function fakeHome(root, versions) {
  const home = path.join(root, 'home');
  const log = path.join(root, 'ran.log');
  for (const v of versions) {
    const base = path.join(home, '.claude/plugins/cache/mk/gimme-the-lint', v);
    fs.mkdirSync(path.join(base, 'bin'), { recursive: true });
    fs.mkdirSync(path.join(base, 'scripts'), { recursive: true });
    const stub = `#!/usr/bin/env bash\necho "${v} $*" >> "${log}"\nexit "\${STUB_EXIT:-0}"\n`;
    fs.writeFileSync(path.join(base, 'bin/gimme-the-lint.js'), stub, { mode: 0o755 });
    fs.writeFileSync(path.join(base, 'scripts/run-checks.sh'), stub, { mode: 0o755 });
  }
  return { home, log };
}

function repoWith(root, hookBody) {
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  spawnSync('git', ['init', '-q'], { cwd: repo });
  const hook = path.join(root, 'hook.sh');
  fs.writeFileSync(hook, hookBody.startsWith('#!') ? hookBody : `#!/usr/bin/env bash\n${hookBody}`);
  return { repo, hook };
}

function run(hook, repo, home, env = {}) {
  return spawnSync('bash', [hook], {
    cwd: repo,
    encoding: 'utf8',
    // No gimme-the-lint on PATH: only what a plugin-only machine has.
    env: { PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', HOME: home, ...env },
  });
}

const HOOKS = [
  ['hooks --print pre-commit', () => hookSnippet('pre-commit'), '--stage=commit'],
  ['hooks --print pre-push', () => hookSnippet('pre-push'), '--stage=push'],
  ['installed pre-commit', () => fs.readFileSync(path.join(REPO, 'githooks/pre-commit'), 'utf8'), '--stage=commit'],
  ['installed pre-push', () => fs.readFileSync(path.join(REPO, 'githooks/pre-push'), 'utf8'), '--stage=push'],
];

for (const [name, body, stageFlag] of HOOKS) {
  test.describe(`${name} on a plugin-only install`, () => {
    test('runs the plugin, newest version by version order, not by string order', (t) => {
      const root = tmp(t);
      const { home, log } = fakeHome(root, ['2.9.0', '2.10.0']);
      const { repo, hook } = repoWith(root, body());

      const r = run(hook, repo, home);

      assert.strictEqual(r.status, 0, r.stdout + r.stderr);
      const ran = fs.readFileSync(log, 'utf8');
      assert.match(ran, /^2\.10\.0 /, 'string order would pick 2.9.0');
      assert.ok(ran.includes(stageFlag), ran);
    });

    test('a failing check blocks', (t) => {
      const root = tmp(t);
      const { home } = fakeHome(root, ['2.9.0']);
      const { repo, hook } = repoWith(root, body());

      assert.strictEqual(run(hook, repo, home, { STUB_EXIT: '1' }).status, 1);
    });

    test('with no plugin at all it still says so and lets the commit through', (t) => {
      const root = tmp(t);
      const { repo, hook } = repoWith(root, body());

      const r = run(hook, repo, path.join(root, 'empty-home'));

      assert.strictEqual(r.status, 0);
      assert.match(r.stdout, /gimme-the-lint: .*(not installed|not found), skipping/);
    });
  });
}

test('CLAUDE_CONFIG_DIR is honoured when the plugin is not under ~/.claude', (t) => {
  const root = tmp(t);
  const { home, log } = fakeHome(root, ['2.9.0']);
  const { repo, hook } = repoWith(root, hookSnippet('pre-commit'));

  const r = run(hook, repo, path.join(root, 'other-home'), {
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
  });

  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(fs.existsSync(log), r.stdout);
});

test('`install` runs with only the dependencies a plugin cache supplies, and no chalk', (t) => {
  const root = tmp(t);
  const pkg = path.join(root, 'plugin');
  fs.mkdirSync(pkg);
  for (const entry of ['bin', 'lib', 'templates', 'package.json']) {
    fs.cpSync(path.join(REPO, entry), path.join(pkg, entry), { recursive: true });
  }
  fs.mkdirSync(path.join(root, 'node_modules'));
  for (const dep of ['commander', 'fs-extra', 'graceful-fs', 'jsonfile', 'universalify']) {
    fs.symlinkSync(path.join(REPO, 'node_modules', dep), path.join(root, 'node_modules', dep));
  }
  // The shared cache's chalk 5: ESM-only, so require() gets no usable `.blue`.
  fs.mkdirSync(path.join(root, 'node_modules/chalk'));
  fs.writeFileSync(
    path.join(root, 'node_modules/chalk/package.json'),
    '{"name":"chalk","version":"5.6.2","type":"module","exports":"./index.js"}'
  );
  fs.writeFileSync(path.join(root, 'node_modules/chalk/index.js'), 'export default {};\n');

  const app = path.join(root, 'app');
  fs.mkdirSync(app);
  spawnSync('git', ['init', '-q'], { cwd: app });

  const r = spawnSync(process.execPath, [path.join(pkg, 'bin/gimme-the-lint.js'), 'install'], {
    cwd: app,
    encoding: 'utf8',
  });

  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /Installation complete/);
});

test('colour stays off for pipes and NO_COLOR, on for FORCE_COLOR', () => {
  const script = "process.stdout.write(require('./lib/chalk').red('x'))";
  const out = (env) =>
    spawnSync(process.execPath, ['-e', script], {
      cwd: REPO,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, ...env },
    }).stdout;

  assert.strictEqual(out({}), 'x', 'piped output must have no escape codes');
  assert.strictEqual(out({ FORCE_COLOR: '1' }), '\u001b[31mx\u001b[39m');
  assert.strictEqual(out({ FORCE_COLOR: '1', NO_COLOR: '1' }), 'x');
  assert.strictEqual(out({ FORCE_COLOR: '0' }), 'x');
});
