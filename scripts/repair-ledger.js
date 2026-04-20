#!/usr/bin/env node
// scripts/repair-ledger.js
// One-shot: dedupe ledger.sessions[] by session_id (keep last occurrence) and
// recompute lifetime counters from the remaining entries' _snapshot field
// (falling back to totals.*). Repairs historical pollution from the per-turn
// Stop hook bug (B1). Idempotent.
//
// Usage:
//   node scripts/repair-ledger.js                  # repair all project + workspace ledgers
//   node scripts/repair-ledger.js <path/to/ledger> # repair one specific ledger

const fs = require('node:fs');
const path = require('node:path');

function repairLedger(ledgerPath) {
  const raw = fs.readFileSync(ledgerPath, 'utf8');
  const ledger = JSON.parse(raw);
  if (!Array.isArray(ledger.sessions)) {
    return { ledgerPath, duplicates_removed: 0, sessions_after: 0, skipped: 'no sessions array' };
  }
  const priorCount = ledger.sessions.length;

  // Dedupe keeping last occurrence per session_id
  const lastById = new Map();
  for (const entry of ledger.sessions) {
    if (!entry || typeof entry.id !== 'string') continue;
    lastById.set(entry.id, entry);
  }
  const deduped = [...lastById.values()];

  // Recompute lifetime from snapshots (preferred) or totals (fallback)
  const lifetime = {
    total_tokens_estimated: 0,
    total_reads: 0,
    total_writes: 0,
    anatomy_hits: 0,
    anatomy_misses: 0,
    repeated_reads_blocked: 0,
    estimated_savings_vs_bare_cli: 0,
  };
  for (const e of deduped) {
    const snap = e._snapshot;
    if (snap) {
      lifetime.total_reads += snap.reads || 0;
      lifetime.total_writes += snap.writes || 0;
      lifetime.total_tokens_estimated += snap.tokens || 0;
      lifetime.anatomy_hits += snap.anatomy_hits || 0;
      lifetime.anatomy_misses += snap.anatomy_misses || 0;
      lifetime.repeated_reads_blocked += snap.repeated_reads_blocked || 0;
      lifetime.estimated_savings_vs_bare_cli += snap.estimated_savings || 0;
    } else if (e.totals) {
      lifetime.total_reads += e.totals.reads_count || 0;
      lifetime.total_writes += e.totals.writes_count || 0;
      lifetime.total_tokens_estimated += (e.totals.input_tokens_estimated || 0) + (e.totals.output_tokens_estimated || 0);
      lifetime.anatomy_hits += e.totals.anatomy_lookups || 0;
      lifetime.repeated_reads_blocked += e.totals.repeated_reads_blocked || 0;
    }
  }

  // Preserve total_sessions (driven by session-start increment, NOT by dedupe count).
  const preservedSessions = typeof ledger.lifetime?.total_sessions === 'number'
    ? ledger.lifetime.total_sessions
    : deduped.length;

  ledger.sessions = deduped;
  ledger.lifetime = { ...(ledger.lifetime || {}), ...lifetime, total_sessions: preservedSessions };

  // Atomic write
  const tmp = ledgerPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2), 'utf8');
  fs.renameSync(tmp, ledgerPath);

  return {
    ledgerPath,
    duplicates_removed: priorCount - deduped.length,
    sessions_after: deduped.length,
  };
}

function findAllLedgers() {
  const cfgPath = path.join(__dirname, '..', 'dashboard', 'data', 'openwolf-config.json');
  if (!fs.existsSync(cfgPath)) return [];
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const parent = cfg.workspace_wolf_parent;
  if (!parent || !fs.existsSync(parent)) return [];

  const out = [];
  for (const name of fs.readdirSync(parent)) {
    const sub = path.join(parent, name);
    let stat;
    try { stat = fs.statSync(sub); } catch { continue; }
    if (!stat.isDirectory()) continue;
    const ledger = path.join(sub, '.wolf', 'token-ledger.json');
    if (fs.existsSync(ledger)) out.push(ledger);
  }
  const wsLedger = path.join(parent, '.wolf', 'token-ledger.json');
  if (fs.existsSync(wsLedger)) out.push(wsLedger);
  return out;
}

function main() {
  const arg = process.argv[2];
  const targets = arg ? [path.resolve(arg)] : findAllLedgers();
  if (targets.length === 0) {
    console.log('[repair-ledger] No ledgers found.');
    return;
  }
  let totalDupes = 0;
  for (const t of targets) {
    try {
      const res = repairLedger(t);
      console.log(`[repair-ledger] ${t} — removed ${res.duplicates_removed} dupe rows, ${res.sessions_after} sessions remain`);
      totalDupes += res.duplicates_removed;
    } catch (err) {
      console.error(`[repair-ledger] FAILED ${t}: ${err.message}`);
    }
  }
  console.log(`[repair-ledger] Done. Total dupe rows removed: ${totalDupes}`);
}

if (require.main === module) main();

module.exports = { repairLedger, findAllLedgers };
