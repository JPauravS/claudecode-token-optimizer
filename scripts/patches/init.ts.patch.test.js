// scripts/patches/init.ts.patch.test.js
const assert = require('node:assert');
const { apply } = require('./init.ts.patch.js');

const fixture = `import { readFileSync } from "node:fs";
const TEMPLATES = [
  "OPENWOLF.md",
  "reframe-frameworks.md",
  "identity.md",
];
const SEEDS = [
  "buglog.json",
  "designqc-report.json",
  "suggestions.json",
];`;

const once = apply(fixture);
assert.ok(!/^\s*["']reframe-frameworks\.md["']\s*,\s*$/m.test(once), 'reframe entry neutralized');
assert.ok(!/^\s*["']designqc-report\.json["']\s*,\s*$/m.test(once), 'designqc entry neutralized');
assert.ok(once.includes('"OPENWOLF.md"'), 'OPENWOLF.md preserved');
assert.ok(once.includes('"identity.md"'), 'identity preserved');

const twice = apply(once);
assert.strictEqual(once, twice, 'idempotent');

console.log('PASS: init.ts.patch.js');
