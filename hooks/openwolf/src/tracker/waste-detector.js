import * as fs from "node:fs";
import * as path from "node:path";
import { readLedger } from "./token-ledger.js";
export function detectWaste(wolfDir) {
    const flags = [];
    const ledger = readLedger(wolfDir);
    const now = new Date().toISOString();
    // Pattern 1: Repeated file reads
    for (const session of ledger.sessions) {
        const readCounts = new Map();
        for (const read of session.reads) {
            const count = (readCounts.get(read.file) ?? 0) + 1;
            readCounts.set(read.file, count);
        }
        for (const [file, count] of readCounts) {
            if (count > 1) {
                flags.push({
                    pattern: "repeated_reads",
                    description: `File ${file} was read ${count} times in session ${session.id}`,
                    tokens_wasted: Math.round((session.reads.find((r) => r.file === file)?.tokens_estimated ?? 200) * (count - 1)),
                    suggestion: "Hooks should have warned about repeated reads.",
                    detected_at: now,
                });
            }
        }
    }
    // Pattern 2: Large reads where anatomy sufficed
    for (const session of ledger.sessions) {
        for (const read of session.reads) {
            if (read.tokens_estimated > 500 && read.anatomy_had_description) {
                flags.push({
                    pattern: "anatomy_could_suffice",
                    description: `anatomy.md had a description for ${read.file} (~${read.tokens_estimated} tok)`,
                    tokens_wasted: read.tokens_estimated,
                    suggestion: "Full read may not have been needed — anatomy description was available.",
                    detected_at: now,
                });
            }
        }
    }
    // Pattern 3: Memory bloat
    try {
        const memoryPath = path.join(wolfDir, "memory.md");
        const memContent = fs.readFileSync(memoryPath, "utf-8");
        const memTokens = Math.ceil(memContent.length / 4.0);
        if (memTokens > 5000) {
            flags.push({
                pattern: "memory_bloat",
                description: `memory.md is ~${memTokens} tokens`,
                tokens_wasted: memTokens - 5000,
                suggestion: "memory.md is growing large. Consolidation should run more frequently.",
                detected_at: now,
            });
        }
    }
    catch {
        // memory.md doesn't exist, no issue
    }
    // Pattern 4: Cerebrum staleness
    try {
        const cerebrumPath = path.join(wolfDir, "cerebrum.md");
        const stat = fs.statSync(cerebrumPath);
        const daysSinceModified = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24);
        if (daysSinceModified > 14) {
            flags.push({
                pattern: "cerebrum_stale",
                description: `cerebrum.md hasn't been updated in ${Math.floor(daysSinceModified)} days`,
                tokens_wasted: 0,
                suggestion: "Learning may not be active. Check if cerebrum is being updated by hooks.",
                detected_at: now,
            });
        }
    }
    catch {
        // cerebrum.md doesn't exist
    }
    // Pattern 5: Anatomy misses (only count project files, not .wolf/ reads)
    for (const session of ledger.sessions) {
        // Filter out .wolf/ reads from the miss calculation — they are infrastructure
        const projectReads = session.reads.filter(r => {
            const normalized = r.file.replace(/\\/g, "/");
            return !normalized.includes("/.wolf/") && !normalized.includes("\\.wolf\\");
        });
        const projectReadCount = projectReads.length;
        const hits = session.totals.anatomy_lookups;
        if (projectReadCount > 0) {
            const missRate = (projectReadCount - hits) / projectReadCount;
            if (missRate > 0.2) {
                flags.push({
                    pattern: "anatomy_miss_rate",
                    description: `${Math.round(missRate * 100)}% of file lookups missed anatomy in session ${session.id}`,
                    tokens_wasted: 0,
                    suggestion: "Run openwolf scan to refresh anatomy.md.",
                    detected_at: now,
                });
            }
        }
    }
    return flags;
}
