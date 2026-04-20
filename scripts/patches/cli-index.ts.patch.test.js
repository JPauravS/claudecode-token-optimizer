// scripts/patches/cli-index.ts.patch.test.js
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { apply } = require('./cli-index.ts.patch.js');

const fixture = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'hooks', 'openwolf', 'src', 'cli', 'index.ts'),
  'utf8'
);

const once = apply(fixture);

// dashboard import gone
assert.ok(!/import \{ dashboardCommand \} from "\.\/dashboard\.js"/.test(once),
  'dashboard import removed');
// dashboard command block gone
assert.ok(!/\.action\(dashboardCommand\)/.test(once),
  'dashboard .action(dashboardCommand) removed');
// designqc block gone
assert.ok(!/designqcCommand/.test(once),
  'designqcCommand reference removed');
assert.ok(!/designqc \[target\]/.test(once),
  'designqc command registration removed');

// daemon group dropped (wolf-daemon not vendored)
assert.ok(!/\.command\("daemon"\)/.test(once), 'daemon command group removed');
assert.ok(!/daemonStart|daemonStop|daemonRestart|daemonLogs/.test(once),
  'daemon-cmd dynamic imports removed');
// cron + bug preserved
assert.ok(/\.command\("cron"\)/.test(once),   'cron command preserved');
assert.ok(/cronList/.test(once),    'cron-cmd dynamic imports preserved');
// bug command preserved
assert.ok(/bugSearch/.test(once),   'bug-cmd preserved');

// Marker present
assert.ok(once.includes('cli-index stubs-removed'), 'marker present');

// Idempotent
const twice = apply(once);
assert.strictEqual(once, twice, 'idempotent');

// Missing anchor throws
assert.throws(() => apply('export function x() {}'),
  /anchor not found/, 'missing anchor throws');

console.log('PASS: cli-index.ts.patch.js');
