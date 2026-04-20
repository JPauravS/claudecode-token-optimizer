// scripts/patches/stop.ts.patch.js
// LOCAL MOD: (1) route cerebrum.md writes from stop.ts reflection to workspace .wolf/.
//            (2) dedupe ledger.sessions[] by session_id + delta-aware lifetime counters
//                so per-turn Stop fires don't inflate (B1).
//            (3) gate checkForMissingBugLogs, checkCerebrumFreshness, and memory.md
//                "Session end" append on stop_count === 1 so they fire once per session
//                not once per turn (B4 + B5).

const MARKER_CEREBRUM    = 'LOCAL MOD (claude-stack): cerebrum → workspace';
const MARKER_FIRSTSTOP   = 'LOCAL MOD (claude-stack): isFirstStop gate';
const MARKER_DEDUPE      = 'LOCAL MOD (claude-stack): ledger dedupe + delta';

// ─── (1) cerebrum → workspace ────────────────────────────────────────────────

const CEREBRUM_ANCHOR_RE = /path\.join\(\s*wolfDir\s*,\s*["']cerebrum\.md["']\s*\)/g;
const CEREBRUM_REPL = `path.join(getWorkspaceWolfDir(), "cerebrum.md") /* ${MARKER_CEREBRUM} */`;

const IMPORT_ADD_MARKER = '/* LOCAL MOD: getWorkspaceWolfDir */';

function ensureImport(content) {
  const importMatch = content.match(/import\s+\{[^}]*\}\s+from\s+["']\.\/shared\.js["']/);
  if (importMatch && importMatch[0].includes('getWorkspaceWolfDir')) return content;
  const patched = content.replace(
    /import\s+\{\s*([^}]*)\}\s+from\s+["']\.\/shared\.js["']/,
    (m, inner) => {
      if (inner.includes('getWorkspaceWolfDir')) return m;
      const cleaned = inner.trim().replace(/,\s*$/, '');
      return `import { ${cleaned}, getWorkspaceWolfDir ${IMPORT_ADD_MARKER} } from "./shared.js"`;
    }
  );
  if (patched === content) {
    throw new Error('stop.ts ensureImport: ./shared.js named-import anchor not found');
  }
  return patched;
}

// ─── (2) isFirstStop gate — inject after stop_count++ ───────────────────────

const STOP_COUNT_ANCHOR_RE = /session\.stop_count\+\+;/;
const STOP_COUNT_REPL = `session.stop_count++;
  const isFirstStop = session.stop_count === 1; /* ${MARKER_FIRSTSTOP} */`;

// ─── (3) wrap checkForMissingBugLogs + checkCerebrumFreshness ───────────────

const NUDGE_BLOCK_RE = /(\/\/ Check for files edited many times[^\n]*\n\s*checkForMissingBugLogs\(wolfDir, session\);\s*\n\s*\n\s*\/\/ Check if cerebrum[^\n]*\n\s*checkCerebrumFreshness\(wolfDir, session\);)/;
const NUDGE_BLOCK_REPL = `if (isFirstStop) { /* ${MARKER_FIRSTSTOP} */
    $1
  }`;

// ─── (4) memory.md append — wrap outer if ───────────────────────────────────

const MEMORY_IF_RE = /if \(writeCount > 0\) \{\s*\n\s*try \{\s*\n\s*const uniqueFiles = new Set/;
const MEMORY_IF_REPL = `if (isFirstStop && writeCount > 0) { /* ${MARKER_FIRSTSTOP} */
    try {
      const uniqueFiles = new Set`;

// ─── (5) ledger dedupe + delta ──────────────────────────────────────────────

const SESSIONS_PUSH_RE = /ledger\.sessions\.push\(sessionEntry\);/;
const SESSIONS_PUSH_REPL = `/* ${MARKER_DEDUPE} */
  const _priorIdx = ledger.sessions.findIndex((s) => s && s.id === sessionEntry.id);
  const _priorSnap = (_priorIdx >= 0 && ledger.sessions[_priorIdx] && (ledger.sessions[_priorIdx] as any)._snapshot)
    ? (ledger.sessions[_priorIdx] as any)._snapshot
    : { reads: 0, writes: 0, tokens: 0, anatomy_hits: 0, anatomy_misses: 0, repeated_reads_blocked: 0, estimated_savings: 0 };
  const _savedFromAnatomyLocal = session.anatomy_hits * 200;
  const _savedFromRepeatsLocal = Object.values(session.files_read || {})
    .filter((r: any) => r.count > 1)
    .reduce((sum: number, r: any) => sum + r.tokens * (r.count - 1), 0);
  (sessionEntry as any)._snapshot = {
    reads: readCount,
    writes: writeCount,
    tokens: inputTokens + outputTokens,
    anatomy_hits: session.anatomy_hits,
    anatomy_misses: session.anatomy_misses,
    repeated_reads_blocked: session.repeated_reads_warned,
    estimated_savings: _savedFromAnatomyLocal + _savedFromRepeatsLocal,
  };
  if (_priorIdx >= 0) ledger.sessions[_priorIdx] = sessionEntry;
  else ledger.sessions.push(sessionEntry);`;

const LIFETIME_BLOCK_RE = /ledger\.lifetime\.total_reads \+= readCount;\s*\n\s*ledger\.lifetime\.total_writes \+= writeCount;\s*\n\s*ledger\.lifetime\.total_tokens_estimated \+= inputTokens \+ outputTokens;\s*\n\s*ledger\.lifetime\.anatomy_hits \+= session\.anatomy_hits;\s*\n\s*ledger\.lifetime\.anatomy_misses \+= session\.anatomy_misses;\s*\n\s*ledger\.lifetime\.repeated_reads_blocked \+= session\.repeated_reads_warned;/;
const LIFETIME_BLOCK_REPL = `ledger.lifetime.total_reads += readCount - _priorSnap.reads; /* ${MARKER_DEDUPE} */
  ledger.lifetime.total_writes += writeCount - _priorSnap.writes;
  ledger.lifetime.total_tokens_estimated += (inputTokens + outputTokens) - _priorSnap.tokens;
  ledger.lifetime.anatomy_hits += session.anatomy_hits - _priorSnap.anatomy_hits;
  ledger.lifetime.anatomy_misses += session.anatomy_misses - _priorSnap.anatomy_misses;
  ledger.lifetime.repeated_reads_blocked += session.repeated_reads_warned - _priorSnap.repeated_reads_blocked;`;

const SAVINGS_RE = /ledger\.lifetime\.estimated_savings_vs_bare_cli \+= savedFromAnatomy \+ savedFromRepeats;/;
const SAVINGS_REPL = `ledger.lifetime.estimated_savings_vs_bare_cli += (savedFromAnatomy + savedFromRepeats) - _priorSnap.estimated_savings; /* ${MARKER_DEDUPE} */`;

// ─── apply ──────────────────────────────────────────────────────────────────

function apply(content) {
  if (content.includes(MARKER_DEDUPE) && content.includes(MARKER_FIRSTSTOP) && content.includes(MARKER_CEREBRUM)) {
    return content; // fully patched
  }

  let patched = content;

  // (1) cerebrum routing
  if (!patched.includes(MARKER_CEREBRUM)) {
    const matches = patched.match(CEREBRUM_ANCHOR_RE);
    if (!matches || matches.length === 0) {
      throw new Error('stop.ts patch anchor not found — upstream cerebrum write path changed');
    }
    patched = patched.replace(CEREBRUM_ANCHOR_RE, CEREBRUM_REPL);
  }

  // (2) isFirstStop injection
  if (!patched.includes(MARKER_FIRSTSTOP)) {
    if (!STOP_COUNT_ANCHOR_RE.test(patched)) {
      throw new Error('stop.ts: stop_count anchor not found — upstream session.stop_count++ missing');
    }
    patched = patched.replace(STOP_COUNT_ANCHOR_RE, STOP_COUNT_REPL);

    // (3) wrap nudges
    if (!NUDGE_BLOCK_RE.test(patched)) {
      throw new Error('stop.ts: checkForMissingBugLogs + checkCerebrumFreshness block anchor not found');
    }
    patched = patched.replace(NUDGE_BLOCK_RE, NUDGE_BLOCK_REPL);

    // (4) wrap memory.md append
    if (!MEMORY_IF_RE.test(patched)) {
      throw new Error('stop.ts: memory.md append anchor not found');
    }
    patched = patched.replace(MEMORY_IF_RE, MEMORY_IF_REPL);
  }

  // (5) dedupe + delta
  if (!patched.includes(MARKER_DEDUPE)) {
    if (!SESSIONS_PUSH_RE.test(patched)) {
      throw new Error('stop.ts: ledger.sessions.push anchor not found');
    }
    patched = patched.replace(SESSIONS_PUSH_RE, SESSIONS_PUSH_REPL);

    if (!LIFETIME_BLOCK_RE.test(patched)) {
      throw new Error('stop.ts: lifetime increment block anchor not found — upstream ledger.lifetime.* lines changed');
    }
    patched = patched.replace(LIFETIME_BLOCK_RE, LIFETIME_BLOCK_REPL);

    if (!SAVINGS_RE.test(patched)) {
      throw new Error('stop.ts: estimated_savings_vs_bare_cli anchor not found');
    }
    patched = patched.replace(SAVINGS_RE, SAVINGS_REPL);
  }

  patched = ensureImport(patched);

  if (!patched.includes(MARKER_CEREBRUM) || !patched.includes(MARKER_FIRSTSTOP) || !patched.includes(MARKER_DEDUPE)) {
    throw new Error('stop.ts patch applied but one or more markers missing');
  }
  return patched;
}

module.exports = {
  apply,
  MARKER: MARKER_CEREBRUM,
  MARKER_CEREBRUM,
  MARKER_FIRSTSTOP,
  MARKER_DEDUPE,
};
