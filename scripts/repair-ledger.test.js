// scripts/repair-ledger.test.js
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { repairLedger } = require('./repair-ledger.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-ledger-'));
const ledgerPath = path.join(tmp, 'token-ledger.json');

// Synthetic: two session_ids with duplicate entries from per-turn stop fires
const polluted = {
  version: 1,
  lifetime: {
    total_tokens_estimated: 300,   // inflated: actual should be 100
    total_reads: 30,               // inflated: actual should be 10
    total_writes: 6,               // inflated: actual should be 2
    total_sessions: 2,
    anatomy_hits: 9,               // inflated: actual 3
    anatomy_misses: 6,             // inflated: actual 2
    repeated_reads_blocked: 0,
    estimated_savings_vs_bare_cli: 600,  // inflated: actual 200
  },
  sessions: [
    // Session A: 3 duplicate entries (turns 1, 2, 3) — last is correct cumulative
    { id: 'session-A', totals: { reads_count: 2, writes_count: 1, input_tokens_estimated: 20, output_tokens_estimated: 10, repeated_reads_blocked: 0, anatomy_lookups: 1 } },
    { id: 'session-A', totals: { reads_count: 4, writes_count: 1, input_tokens_estimated: 30, output_tokens_estimated: 10, repeated_reads_blocked: 0, anatomy_lookups: 2 } },
    { id: 'session-A', totals: { reads_count: 6, writes_count: 2, input_tokens_estimated: 40, output_tokens_estimated: 20, repeated_reads_blocked: 0, anatomy_lookups: 2 }, _snapshot: { reads: 6, writes: 2, tokens: 60, anatomy_hits: 2, anatomy_misses: 1, repeated_reads_blocked: 0, estimated_savings: 150 } },
    // Session B: single entry (clean)
    { id: 'session-B', totals: { reads_count: 4, writes_count: 0, input_tokens_estimated: 30, output_tokens_estimated: 10, repeated_reads_blocked: 0, anatomy_lookups: 1 }, _snapshot: { reads: 4, writes: 0, tokens: 40, anatomy_hits: 1, anatomy_misses: 1, repeated_reads_blocked: 0, estimated_savings: 50 } },
  ],
};
fs.writeFileSync(ledgerPath, JSON.stringify(polluted, null, 2));

const result = repairLedger(ledgerPath);
const repaired = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));

assert.strictEqual(repaired.sessions.length, 2, 'dedupes to one row per session_id');
assert.strictEqual(repaired.sessions[0].id, 'session-A', 'session-A preserved (last occurrence)');
assert.strictEqual(repaired.sessions[0].totals.reads_count, 6, 'session-A keeps final cumulative reads');
assert.strictEqual(repaired.sessions[1].id, 'session-B', 'session-B preserved');

// Lifetime recomputed from remaining entries' snapshots (fallback to totals if no snapshot)
assert.strictEqual(repaired.lifetime.total_reads, 10, 'total_reads = 6 + 4');
assert.strictEqual(repaired.lifetime.total_writes, 2, 'total_writes = 2 + 0');
assert.strictEqual(repaired.lifetime.total_tokens_estimated, 100, 'total_tokens = 60 + 40');
assert.strictEqual(repaired.lifetime.anatomy_hits, 3, 'anatomy_hits = 2 + 1');
assert.strictEqual(repaired.lifetime.estimated_savings_vs_bare_cli, 200, 'savings = 150 + 50');
assert.strictEqual(repaired.lifetime.total_sessions, 2, 'total_sessions preserved');

// Idempotent — running again doesn't change anything
const snapshot = JSON.stringify(repaired);
repairLedger(ledgerPath);
const second = fs.readFileSync(ledgerPath, 'utf8');
assert.strictEqual(
  JSON.stringify(JSON.parse(second)),
  JSON.stringify(JSON.parse(snapshot)),
  'second repair is no-op'
);

// Stats returned
assert.strictEqual(result.duplicates_removed, 2, 'reports 2 dupe rows removed');
assert.strictEqual(result.sessions_after, 2);

// Cleanup
fs.rmSync(tmp, { recursive: true, force: true });

console.log('PASS: repair-ledger.test.js');
