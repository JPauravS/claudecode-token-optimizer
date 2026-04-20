// scripts/patches/session-start.ts.patch.test.js
const assert = require('node:assert');
const { apply } = require('./session-start.ts.patch.js');

const fixture = `import path from "node:path";
import fs from "node:fs";
import { getWolfDir, ensureWolfDir, timestamp } from "./shared.js";

async function main() {
  ensureWolfDir();
  // ...
}
main();`;

const once = apply(fixture);
assert.ok(once.includes('auto-init project .wolf/'), 'marker present');
assert.ok(once.includes('autoInitProjectWolf'), 'prelude injected');
// Imports preserved
assert.ok(once.includes('import fs from "node:fs";'), 'imports intact');
// Prelude appears BEFORE main() call
const preludeIdx = once.indexOf('autoInitProjectWolf');
const mainCallIdx = once.indexOf('main();');
assert.ok(preludeIdx < mainCallIdx, 'prelude before main()');

const twice = apply(once);
assert.strictEqual(once, twice, 'idempotent');

assert.throws(() => apply('no imports here'), /no import statements/);

console.log('PASS: session-start.ts.patch.js');

// --- B2 + B3: cerebrum + buglog read routing ---

const readFixture = `import { getWolfDir, readJSON, appendMarkdown, timestamp, timeShort } from "./shared.js";
import * as fs from "node:fs";
import * as path from "node:path";

async function main() {
  const wolfDir = getWolfDir();

  try {
    const cerebrumPath = path.join(wolfDir, "cerebrum.md");
    const cerebrumContent = fs.readFileSync(cerebrumPath, "utf-8");
  } catch {}

  try {
    const buglogPath = path.join(wolfDir, "buglog.json");
    const buglog = readJSON(buglogPath, { bugs: [] });
  } catch {}

  const ledgerPath = path.join(wolfDir, "token-ledger.json");  // must NOT be patched
}`;

const readOut = apply(readFixture);

assert.ok(readOut.includes('getWorkspaceWolfDir(), "cerebrum.md"'),
  'B3: cerebrum read routed to workspace');
assert.ok(readOut.includes('getWorkspaceWolfDir(), "buglog.json"'),
  'B2: buglog read routed to workspace');
assert.ok(readOut.includes('path.join(wolfDir, "token-ledger.json")'),
  'token-ledger path untouched (project-local)');

const readImport = readOut.match(/import\s+\{[^}]*\}\s+from\s+["']\.\/shared\.js["']/);
assert.ok(readImport && readImport[0].includes('getWorkspaceWolfDir'),
  'import includes getWorkspaceWolfDir');

// Idempotent
assert.strictEqual(apply(readOut), readOut, 'read-routing idempotent');

// Loud-fail on missing shared.js import anchor (but has other anchors so reaches ensureImport)
const noShared = `import * as path from "node:path";
import * as fs from "node:fs";

async function main() {
  const wolfDir = getWolfDir();
  const x = path.join(wolfDir, "cerebrum.md");
  const y = path.join(wolfDir, "buglog.json");
}`;
assert.throws(() => apply(noShared),
  /ensureImport: \.\/shared\.js named-import anchor not found/,
  'missing shared.js import must throw');

console.log('PASS: session-start.ts.patch.js cases');
