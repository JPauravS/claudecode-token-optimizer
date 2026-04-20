// scripts/patches/cron-engine.ts.patch.test.js
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { apply } = require('./cron-engine.ts.patch.js');

const fixture = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'hooks', 'openwolf', 'src', 'daemon', 'cron-engine.ts'),
  'utf8'
);

const once = apply(fixture);

// cron-parser import injected
assert.ok(/import parser from "cron-parser";/.test(once), 'cron-parser imported');
assert.ok(/import \* as fs25e from "node:fs";/.test(once), 'fs25e imported');
assert.ok(/import \* as crypto25e from "node:crypto";/.test(once), 'crypto25e imported');
assert.ok(/const pathJoin25e = path\.join;/.test(once), 'pathJoin25e alias present');

// catchUp method + body
assert.ok(/private catchUp\(manifest: CronManifest\): void/.test(once), 'catchUp method present');
assert.ok(/parser\.parseExpression\(task\.schedule/.test(once), 'catchUp uses cron-parser');
assert.ok(/this\.executeTask\(task\)\.catch/.test(once), 'catchUp dispatches executeTask');

// catchUp called from start()
assert.ok(/this\.catchUp\(manifest\);/.test(once), 'start() calls catchUp');

// backupWolfFile helper
assert.ok(/private backupWolfFile\(filename: string\): void/.test(once), 'backupWolfFile method present');
assert.ok(/pathJoin25e\(this\.wolfDir, "backups"\)/.test(once), 'backups subdir path');
assert.ok(/createHash\("sha256"\)/.test(once), 'content hash for dedupe');
assert.ok(/fs25e\.copyFileSync\(src, dest\)/.test(once), 'copyFileSync write');

// Called from consolidateMemory + cerebrum write
const consolMatches = (once.match(/this\.backupWolfFile\("memory\.md"\)/g) || []);
assert.strictEqual(consolMatches.length, 1, 'memory.md backup call at consolidateMemory');
const cerebrumMatches = (once.match(/this\.backupWolfFile\("cerebrum\.md"\)/g) || []);
assert.strictEqual(cerebrumMatches.length, 1, 'cerebrum.md backup call at ai_task cerebrum branch');

// Marker present
assert.ok(once.includes('cron-engine backup + catch-up'), 'marker present');

// Idempotent
const twice = apply(once);
assert.strictEqual(once, twice, 'idempotent');

// Missing anchor throws
assert.throws(() => apply('// unrelated content'), /anchor not found/);

console.log('PASS: cron-engine.ts.patch.js');
