// scripts/patches/pre-write.ts.patch.test.js
const assert = require('node:assert');
const { apply } = require('./pre-write.ts.patch.js');

const BUGENTRY_INTERFACE = `interface BugEntry {
  id: string;
  error_message: string;
  root_cause: string;
  fix: string;
  file: string;
  tags: string[];
}
`;

const FILEMATCHES_BLOCK = `
  const fileMatches = bugLog.bugs.filter(b => {
    const bugBasename = path.basename(b.file);
    return bugBasename === basename;
  });
`;

const fixture = `import { getWolfDir, ensureWolfDir, readJSON, readMarkdown, readStdin } from "./shared.js";
import path from "node:path";
import * as fs from "node:fs";

${BUGENTRY_INTERFACE}
function checkCerebrum(wolfDir) {
  const cerebrumContent = readMarkdown(path.join(wolfDir, "cerebrum.md"));
  return cerebrumContent;
}
function checkBugLog(wolfDir, basename) {
  const bugLogPath = path.join(wolfDir, "buglog.json");
  if (!fs.existsSync(bugLogPath)) return;
  const bugLog = readJSON(bugLogPath, { version: 1, bugs: [] });
${FILEMATCHES_BLOCK}  return fileMatches;
}
function untouched(wolfDir) {
  return path.join(wolfDir, "memory.md");  // must NOT be patched
}`;

const once = apply(fixture);

// cerebrum routed
assert.ok(once.includes('getWorkspaceWolfDir(), "cerebrum.md"'), 'cerebrum routed to workspace');
// buglog routed
assert.ok(once.includes('getWorkspaceWolfDir(), "buglog.json"'), 'buglog routed to workspace');
// unrelated join untouched
assert.ok(once.includes('path.join(wolfDir, "memory.md")'), 'memory.md untouched');
// markers present
assert.ok(once.includes('pre-write cerebrum → workspace'), 'cerebrum marker present');
assert.ok(once.includes('pre-write buglog → workspace'), 'buglog marker present');

// scope filter applied
assert.ok(/_claudeOrigin = process\.env\.CLAUDE_PROJECT_DIR \|\| process\.cwd\(\)/.test(once),
  'scope: _claudeOrigin computed');
assert.ok(/!b\.project_origin \|\| b\.project_origin === _claudeOrigin/.test(once),
  'scope: filter body present');
assert.ok(once.includes('pre-write project_origin scope'), 'scope marker present');

// import contains getWorkspaceWolfDir
const importLine = once.match(/import\s+\{[^}]*\}\s+from\s+["']\.\/shared\.js["']/);
assert.ok(importLine && importLine[0].includes('getWorkspaceWolfDir'),
  'import statement contains getWorkspaceWolfDir');

// Idempotent
const twice = apply(once);
assert.strictEqual(once, twice, 'idempotent');

// Already-imported fixture: no double-add (with BugEntry + fileMatches block)
const already = `import { getWolfDir, getWorkspaceWolfDir } from "./shared.js";
${BUGENTRY_INTERFACE}
const a = path.join(wolfDir, "cerebrum.md");
const b = path.join(wolfDir, "buglog.json");
${FILEMATCHES_BLOCK}`;
const alreadyOut = apply(already);
const imports = (alreadyOut.match(/import\s+\{[^}]*\}\s+from\s+["']\.\/shared\.js["']/g) || []);
assert.strictEqual(imports.length, 1, 'single import line after apply');
assert.strictEqual((imports[0].match(/getWorkspaceWolfDir/g) || []).length, 1,
  'getWorkspaceWolfDir appears once in import');

// Anchor-not-found throws (no cerebrum/buglog joins, no fileMatches)
assert.throws(() => apply('no anchors in here'), /anchor not found/);

// missing ./shared.js named-import anchor throws from ensureImport.
const noShared = `import path from "node:path";
${BUGENTRY_INTERFACE}
const x = path.join(wolfDir, "cerebrum.md");
const y = path.join(wolfDir, "buglog.json");
${FILEMATCHES_BLOCK}`;
assert.throws(() => apply(noShared),
  /ensureImport: \.\/shared\.js named-import anchor not found/,
  'missing ./shared.js named-import anchor must throw');

const driftExt = `import { getWolfDir } from "./shared";
${BUGENTRY_INTERFACE}
const x = path.join(wolfDir, "cerebrum.md");
const y = path.join(wolfDir, "buglog.json");
${FILEMATCHES_BLOCK}`;
assert.throws(() => apply(driftExt),
  /ensureImport: \.\/shared\.js named-import anchor not found/,
  'upstream dropping .js extension must throw');

// Missing BugEntry interface throws when workspace already applied
const noInterface = `import { getWolfDir, getWorkspaceWolfDir } from "./shared.js";
const a = path.join(wolfDir, "cerebrum.md");
const b = path.join(wolfDir, "buglog.json");
${FILEMATCHES_BLOCK}`;
assert.throws(() => apply(noInterface),
  /BugEntry interface anchor not found/,
  'missing BugEntry interface must throw');

// Missing fileMatches anchor throws when workspace + interface already present
const noFileMatches = `import { getWolfDir, getWorkspaceWolfDir } from "./shared.js";
${BUGENTRY_INTERFACE}
const a = path.join(wolfDir, "cerebrum.md");
const b = path.join(wolfDir, "buglog.json");
// no fileMatches block`;
assert.throws(() => apply(noFileMatches),
  /fileMatches anchor not found/,
  'missing fileMatches anchor must throw');

console.log('PASS: pre-write.ts.patch.js');
