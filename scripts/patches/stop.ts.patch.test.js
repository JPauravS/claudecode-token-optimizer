// scripts/patches/stop.ts.patch.test.js
const assert = require('node:assert');
const { apply } = require('./stop.ts.patch.js');

// Rich body covering every anchor the apply() expects. Reused across
// fixtures that differ only in their shared.js import shape (import-anchor checks).
const RICH_BODY = `
function reflect() {
  const wolfDir = getWolfDir();
  const cerebrum = path.join(wolfDir, "cerebrum.md");
  fs.appendFileSync(cerebrum, "entry\\n");
}
function unrelated() {
  const wolfDir = getWolfDir();
  return path.join(wolfDir, "memory.md");  // must NOT be patched
}
async function stopMain() {
  const session = readJSON(sessionFile, { stop_count: 0 });
  session.stop_count++;

  // Check for files edited many times without a buglog entry
  checkForMissingBugLogs(wolfDir, session);

  // Check if cerebrum was updated this session (it should be if there were edits)
  checkCerebrumFreshness(wolfDir, session);

  const sessionEntry = { id: session.session_id, totals: {} };
  const ledgerPath = path.join(wolfDir, "token-ledger.json");
  const ledger = readJSON(ledgerPath, { lifetime: {}, sessions: [] });

  ledger.sessions.push(sessionEntry);
  ledger.lifetime.total_reads += readCount;
  ledger.lifetime.total_writes += writeCount;
  ledger.lifetime.total_tokens_estimated += inputTokens + outputTokens;
  ledger.lifetime.anatomy_hits += session.anatomy_hits;
  ledger.lifetime.anatomy_misses += session.anatomy_misses;
  ledger.lifetime.repeated_reads_blocked += session.repeated_reads_warned;
  ledger.lifetime.estimated_savings_vs_bare_cli += savedFromAnatomy + savedFromRepeats;

  writeJSON(ledgerPath, ledger);

  if (writeCount > 0) {
    try {
      const uniqueFiles = new Set(session.files_written.map(w => path.basename(w.file)));
      appendMarkdown(memoryPath, \`| \${timeShort()} | Session end | \${uniqueFiles.size} files |\\n\`);
    } catch {}
  }
}`;

const fixture = `import { getWolfDir, readJSON, writeJSON, appendMarkdown, timeShort } from "./shared.js";
import path from "node:path";
${RICH_BODY}`;

const once = apply(fixture);
assert.ok(once.includes('getWorkspaceWolfDir(), "cerebrum.md"'), 'cerebrum routed to workspace');
assert.ok(once.includes('path.join(wolfDir, "memory.md")'), 'memory untouched');
assert.ok(once.includes('getWorkspaceWolfDir'), 'import added');
assert.ok(once.includes('cerebrum → workspace'), 'marker present');

// Stronger: verify import statement itself contains getWorkspaceWolfDir
const importLine = once.match(/import\s+\{[^}]*\}\s+from\s+["']\.\/shared\.js["']/);
assert.ok(importLine && importLine[0].includes('getWorkspaceWolfDir'),
  'import statement contains getWorkspaceWolfDir');

const twice = apply(once);
assert.strictEqual(once, twice, 'idempotent');

assert.throws(() => apply('no cerebrum here'), /anchor not found/);

// missing ./shared.js named-import anchor throws from ensureImport.
// Uses rich body so all non-import anchors resolve and ensureImport is reached.
const noShared = `import path from "node:path";
${RICH_BODY}`;
assert.throws(() => apply(noShared),
  /ensureImport: \.\/shared\.js named-import anchor not found/,
  'missing ./shared.js named-import anchor must throw');

const driftExt = `import { getWolfDir, readJSON, writeJSON, appendMarkdown, timeShort } from "./shared";
import path from "node:path";
${RICH_BODY}`;
assert.throws(() => apply(driftExt),
  /ensureImport: \.\/shared\.js named-import anchor not found/,
  'upstream dropping .js extension must throw');

console.log('PASS: stop.ts.patch.js');

// --- B1 + B4 + B5 cases ---

const p22Fixture = `import { getWolfDir, readJSON, writeJSON, appendMarkdown, timeShort } from "./shared.js";
import path from "node:path";

async function main() {
  const wolfDir = getWolfDir();
  const session = readJSON(sessionFile, { stop_count: 0 });
  session.stop_count++;

  // Check for files edited many times without a buglog entry
  checkForMissingBugLogs(wolfDir, session);

  // Check if cerebrum was updated this session (it should be if there were edits)
  checkCerebrumFreshness(wolfDir, session);

  const cerebrum = path.join(wolfDir, "cerebrum.md");
  const sessionEntry = { id: session.session_id, totals: {} };
  const ledgerPath = path.join(wolfDir, "token-ledger.json");
  const ledger = readJSON(ledgerPath, { lifetime: {}, sessions: [] });

  ledger.sessions.push(sessionEntry);
  ledger.lifetime.total_reads += readCount;
  ledger.lifetime.total_writes += writeCount;
  ledger.lifetime.total_tokens_estimated += inputTokens + outputTokens;
  ledger.lifetime.anatomy_hits += session.anatomy_hits;
  ledger.lifetime.anatomy_misses += session.anatomy_misses;
  ledger.lifetime.repeated_reads_blocked += session.repeated_reads_warned;
  ledger.lifetime.estimated_savings_vs_bare_cli += savedFromAnatomy + savedFromRepeats;

  writeJSON(ledgerPath, ledger);

  if (writeCount > 0) {
    try {
      const uniqueFiles = new Set(session.files_written.map(w => path.basename(w.file)));
      appendMarkdown(memoryPath, \`| \${timeShort()} | Session end | \${uniqueFiles.size} files |\\n\`);
    } catch {}
  }
}`;

const p22Out = apply(p22Fixture);

assert.ok(p22Out.includes('const isFirstStop = session.stop_count === 1'),
  'B5: isFirstStop marker injected after stop_count++');
assert.ok(p22Out.includes('if (isFirstStop) {'),
  'B5: checkForMissingBugLogs + checkCerebrumFreshness wrapped in isFirstStop gate');
assert.ok(p22Out.includes('if (isFirstStop && writeCount > 0)'),
  'B4: memory.md append wrapped in isFirstStop gate');
assert.ok(/const\s+_priorIdx\s*=\s*ledger\.sessions\.findIndex/.test(p22Out),
  'B1: ledger.sessions dedupe findIndex present');
assert.ok(/ledger\.sessions\[_priorIdx\]\s*=\s*sessionEntry/.test(p22Out),
  'B1: in-place replace of prior session entry');
assert.ok(/_priorSnap/.test(p22Out),
  'B1: prior snapshot reference present for delta compute');
assert.ok(/ledger\.lifetime\.total_reads\s*\+=\s*readCount\s*-\s*_priorSnap\.reads/.test(p22Out),
  'B1: total_reads uses delta against prior snapshot');
assert.ok(/ledger\.lifetime\.estimated_savings_vs_bare_cli\s*\+=\s*\(savedFromAnatomy\s*\+\s*savedFromRepeats\)\s*-\s*_priorSnap\.estimated_savings/.test(p22Out),
  'B1: savings delta computed');

// Idempotent
assert.strictEqual(apply(p22Out), p22Out, 'changes idempotent');

// Loud-fail: missing stop_count++ anchor
const noStopCount = p22Fixture.replace('session.stop_count++;', '/* removed */');
assert.throws(() => apply(noStopCount), /stop_count anchor not found/,
  'missing stop_count++ anchor must throw');

// Loud-fail: missing ledger.sessions.push anchor
const noPush = p22Fixture.replace('ledger.sessions.push(sessionEntry);', '/* gone */');
assert.throws(() => apply(noPush), /sessions\.push anchor not found/,
  'missing sessions.push anchor must throw');

console.log('PASS: stop.ts.patch.js cases');
