'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { LinterAdapter } = require('../lib/adapters/adapter');
const { runCheck } = require('../lib/check');
const { runBaseline } = require('../lib/baseline');

// A linter that crashed reported nothing, and "reported nothing" is what clean looks
// like. ESLint with a config that imports a missing plugin exits 2 with empty stdout;
// Biome with a broken biome.json exits 1 with empty stdout. Both used to baseline as
// `clean` and then pass every commit, including ones adding new violations (found
// while investigating #39).

// Runs `node -e <script>` as the linter, so these tests need no linter installed.
class Scripted extends LinterAdapter {
  constructor(script) {
    super({ projectRoot: os.tmpdir() });
    this.script = script;
  }
  get id() {
    return 'scripted';
  }
  buildCommand() {
    return { cmd: process.execPath, args: ['-e', this.script] };
  }
  parse(stdout) {
    return stdout.trim() ? JSON.parse(stdout) : [];
  }
}

test.describe('LinterAdapter.lint() cannot read a failed run as clean', () => {
  test('non-zero exit with no findings throws, carrying the reason', () => {
    const a = new Scripted('console.error("Cannot find package x"); process.exit(2)');
    assert.throws(
      () => a.lint([]),
      (err) => {
        assert.strictEqual(err.code, 'ADAPTER_FAILED');
        assert.match(err.message, /scripted exited 2/);
        assert.match(err.message, /Cannot find package x/);
        return true;
      }
    );
  });

  test('a linter killed by a signal throws', () => {
    const a = new Scripted('process.kill(process.pid, "SIGKILL")');
    assert.throws(() => a.lint([]), /scripted exited SIGKILL/);
  });

  test('a failure with nothing on stderr or stdout still throws', () => {
    assert.throws(() => new Scripted('process.exit(1)').lint([]), /scripted exited 1/);
  });

  test('non-zero exit WITH findings is findings: that is how linters report them', () => {
    const a = new Scripted('console.log(JSON.stringify([{ruleId:"r"}])); process.exit(1)');
    assert.deepStrictEqual(a.lint([]), [{ ruleId: 'r' }]);
  });

  test('exit 0 with no findings stays clean', () => {
    assert.deepStrictEqual(new Scripted('process.exit(0)').lint([]), []);
  });
});

// The same failure through the real engine and the real ESLint adapter, with a stand-in
// binary reproducing what ESLint 9 does: exit 2, empty stdout, the reason on stderr.
function crashingEslintApp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gtl-failed-run-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  spawnSync('git', ['init', '-q'], { cwd: root });
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"a","dependencies":{"x":"1"}}');
  fs.writeFileSync(path.join(root, 'a.js'), 'debugger;\n');
  const bin = path.join(root, 'node_modules', '.bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(
    path.join(bin, 'eslint'),
    '#!/bin/sh\n[ "$1" = "--version" ] && { echo v9.0.0; exit 0; }\n' +
      'echo "Cannot find package eslint-plugin-x" >&2\nexit 2\n',
    { mode: 0o755 }
  );
  return root;
}

test.describe('a crashing linter through the engine', () => {
  test('baseline records an error, not clean', async (t) => {
    const root = crashingEslintApp(t);
    const result = await runBaseline(root, {});
    const eslint = result.units.flatMap((u) => u.sections).find((s) => s.linter === 'eslint');

    assert.strictEqual(eslint.status, 'error');
    assert.match(eslint.reason, /Cannot find package eslint-plugin-x/);
    assert.ok(result.incomplete.length > 0, 'the baseline must report itself incomplete');
  });

  test('check reports it unchecked, not passed, and --fail-on-skip blocks', async (t) => {
    const root = crashingEslintApp(t);

    const report = await runCheck(root, { stage: 'commit' });
    const eslint = report.units.find((u) => u.linter === 'eslint');
    assert.strictEqual(eslint.status, 'error');
    assert.ok(report.unchecked.some((u) => u.linter === 'eslint'));
    assert.strictEqual(report.ok, true, 'warns by default, like every other unchecked state');

    const strict = await runCheck(root, { stage: 'commit', failOnSkip: true });
    assert.strictEqual(strict.ok, false);
  });
});
