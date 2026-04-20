import * as path from "node:path";
import { readJSON, writeJSON } from "../utils/fs-safe.js";
export function getLedgerPath(wolfDir) {
    return path.join(wolfDir, "token-ledger.json");
}
export function readLedger(wolfDir) {
    return readJSON(getLedgerPath(wolfDir), {
        version: 1,
        created_at: new Date().toISOString(),
        lifetime: {
            total_tokens_estimated: 0,
            total_reads: 0,
            total_writes: 0,
            total_sessions: 0,
            anatomy_hits: 0,
            anatomy_misses: 0,
            repeated_reads_blocked: 0,
            estimated_savings_vs_bare_cli: 0,
        },
        sessions: [],
        daemon_usage: [],
        waste_flags: [],
        optimization_report: { last_generated: null, patterns: [] },
    });
}
export function writeLedger(wolfDir, ledger) {
    writeJSON(getLedgerPath(wolfDir), ledger);
}
export function incrementSessions(wolfDir) {
    const ledger = readLedger(wolfDir);
    ledger.lifetime.total_sessions++;
    writeLedger(wolfDir, ledger);
}
export function addSessionToLedger(wolfDir, session) {
    const ledger = readLedger(wolfDir);
    ledger.sessions.push(session);
    ledger.lifetime.total_reads += session.totals.reads_count;
    ledger.lifetime.total_writes += session.totals.writes_count;
    ledger.lifetime.total_tokens_estimated +=
        session.totals.input_tokens_estimated + session.totals.output_tokens_estimated;
    ledger.lifetime.anatomy_hits += session.totals.anatomy_lookups;
    ledger.lifetime.repeated_reads_blocked += session.totals.repeated_reads_blocked;
    writeLedger(wolfDir, ledger);
}
