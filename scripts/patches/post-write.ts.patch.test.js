// scripts/patches/post-write.ts.patch.test.js
const assert = require('node:assert');
const { apply } = require('./post-write.ts.patch.js');

// Push + dupe blocks mirror upstream autoDetectBugFix shape.
const AUTO_BLOCK = `
  if (recentDupe) {
    recentDupe.occurrences++;
    recentDupe.last_seen = new Date().toISOString();
    writeJSON(bugLogPath, bugLog);
    return;
  }

  bugLog.bugs.push({
    id: nextId,
    timestamp: new Date().toISOString(),
    error_message: detection.summary,
    file: relFile,
    root_cause: detection.rootCause,
    fix: detection.fix,
    tags: ["auto-detected", detection.category, "ts"],
    related_bugs: [],
    occurrences: 1,
    last_seen: new Date().toISOString(),
  });
`;

const fixture = `import { getWolfDir, readJSON, writeJSON, timestamp } from "./shared.js";
import path from "node:path";

function detectBug(wolfDir, projectRoot) {
  const bugLogPath = path.join(wolfDir, "buglog.json");
  const bugLog = readJSON(bugLogPath, { entries: [] });
${AUTO_BLOCK}  writeJSON(bugLogPath, bugLog);
}
function anatomyPath(wolfDir) {
  return path.join(wolfDir, "anatomy.md");  // must NOT be patched
}`;

const once = apply(fixture);
const matches = once.match(/getWorkspaceWolfDir\(\), "buglog\.json"/g);
assert.strictEqual(matches.length, 1, 'buglog path routed to workspace');
assert.ok(once.includes('path.join(wolfDir, "anatomy.md")'), 'anatomy untouched');

const importLine = once.match(/import\s+\{[^}]*\}\s+from\s+["']\.\/shared\.js["']/);
assert.ok(importLine && importLine[0].includes('getWorkspaceWolfDir'),
  'import contains getWorkspaceWolfDir');

// provenance applied
assert.ok(/project_origin: process\.env\.CLAUDE_PROJECT_DIR \|\| projectRoot/.test(once),
  'push gains project_origin');
assert.ok(/if \(!\(recentDupe as any\)\.project_origin\)/.test(once),
  'dupe branch backfills project_origin');

// Idempotent
const twice = apply(once);
assert.strictEqual(once, twice, 'idempotent');

// Already-imported + already-patched fixture survives
const already = `import { getWolfDir, getWorkspaceWolfDir } from "./shared.js";
function f(projectRoot) {
  const a = path.join(wolfDir, "buglog.json");
${AUTO_BLOCK}}`;
const alreadyOut = apply(already);
const imports = (alreadyOut.match(/import\s+\{[^}]*\}\s+from\s+["']\.\/shared\.js["']/g) || []);
assert.strictEqual(imports.length, 1, 'single import line after apply');
assert.strictEqual((imports[0].match(/getWorkspaceWolfDir/g) || []).length, 1,
  'getWorkspaceWolfDir appears once in import');

// Missing workspace anchor throws
assert.throws(() => apply('no buglog here'), /anchor not found/);

// missing ./shared.js named-import anchor throws from ensureImport.
const noShared = `import path from "node:path";
const x = path.join(wolfDir, "buglog.json");${AUTO_BLOCK}`;
assert.throws(() => apply(noShared),
  /ensureImport: \.\/shared\.js named-import anchor not found/,
  'missing ./shared.js named-import anchor must throw');

const driftExt = `import { getWolfDir } from "./shared";
const x = path.join(wolfDir, "buglog.json");${AUTO_BLOCK}`;
assert.throws(() => apply(driftExt),
  /ensureImport: \.\/shared\.js named-import anchor not found/,
  'upstream dropping .js extension must throw');

// Missing provenance push anchor throws when workspace patch already applied
const workspaceOnly = `import { getWolfDir, getWorkspaceWolfDir } from "./shared.js";
const a = path.join(wolfDir, "buglog.json");
// no autoDetect block — provenance anchors will be missing`;
assert.throws(() => apply(workspaceOnly),
  /auto-detect push anchor not found/,
  'missing push anchor must throw');

console.log('PASS: post-write.ts.patch.js');
