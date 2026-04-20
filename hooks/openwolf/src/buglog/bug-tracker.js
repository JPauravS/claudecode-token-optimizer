import * as path from "node:path";
import { readJSON, writeJSON } from "../utils/fs-safe.js";
export function getBugLogPath(wolfDir) {
    return path.join(wolfDir, "buglog.json");
}
export function readBugLog(wolfDir) {
    return readJSON(getBugLogPath(wolfDir), { version: 1, bugs: [] });
}
export function logBug(wolfDir, bug) {
    const bugLog = readBugLog(wolfDir);
    const now = new Date().toISOString();
    // Check for near-duplicate (score > 0.8)
    const similar = findSimilarBugs(wolfDir, bug.error_message, bug.project_origin) /* LOCAL MOD (claude-stack): bug-tracker findSimilar project_origin */;
    if (similar.length > 0 && similar[0].score > 0.8) {
        const existing = bugLog.bugs.find((b) => b.id === similar[0].bug.id);
        if (existing) {
            existing.occurrences++;
            existing.last_seen = now;
            if (!existing.project_origin && bug.project_origin)
                existing.project_origin = bug.project_origin; /* LOCAL MOD (claude-stack): buglog project_origin */
            writeJSON(getBugLogPath(wolfDir), bugLog);
            return;
        }
    }
    const id = `bug-${String(bugLog.bugs.length + 1).padStart(3, "0")}`;
    bugLog.bugs.push({
        id,
        timestamp: now,
        error_message: bug.error_message,
        file: bug.file,
        line: bug.line,
        root_cause: bug.root_cause,
        fix: bug.fix,
        tags: bug.tags,
        related_bugs: [],
        occurrences: 1,
        last_seen: now,
        project_origin: bug.project_origin, /* LOCAL MOD (claude-stack): buglog project_origin */
    });
    writeJSON(getBugLogPath(wolfDir), bugLog);
}
function normalize(text) {
    return text.toLowerCase().replace(/\d+/g, "N").replace(/[^\w\s]/g, " ").trim();
}
function tokenize(text) {
    return new Set(normalize(text).split(/\s+/).filter((w) => w.length > 2));
}
function jaccardSimilarity(a, b) {
    const intersection = new Set([...a].filter((x) => b.has(x)));
    const union = new Set([...a, ...b]);
    return union.size === 0 ? 0 : intersection.size / union.size;
}
export function findSimilarBugs(wolfDir, errorMessage, projectOrigin /* LOCAL MOD (claude-stack): bug-tracker findSimilar project_origin */) {
    const bugLog = readBugLog(wolfDir);
    const normalizedInput = normalize(errorMessage);
    const inputTokens = tokenize(errorMessage);
    const _scopedBugs = projectOrigin ? bugLog.bugs.filter((b) => !b.project_origin || b.project_origin === projectOrigin) : bugLog.bugs; /* LOCAL MOD (claude-stack): bug-tracker findSimilar project_origin */
    const results = [];
    for (const bug of _scopedBugs) {
        let score = 0;
        // Exact substring match
        if (normalize(bug.error_message).includes(normalizedInput) ||
            normalizedInput.includes(normalize(bug.error_message))) {
            score += 1.0;
        }
        // Word overlap (jaccard)
        const bugTokens = tokenize(bug.error_message);
        score += jaccardSimilarity(inputTokens, bugTokens) * 0.5;
        if (score > 0.3) {
            results.push({ bug, score });
        }
    }
    results.sort((a, b) => b.score - a.score);
    return results;
}
export function searchBugs(wolfDir, term, projectOrigin /* LOCAL MOD (claude-stack): buglog project_origin */) {
    const bugLog = readBugLog(wolfDir);
    const lower = term.toLowerCase();
    return bugLog.bugs.filter((b) => b.error_message.toLowerCase().includes(lower) ||
        b.root_cause.toLowerCase().includes(lower) ||
        b.fix.toLowerCase().includes(lower) ||
        b.tags.some((t) => t.toLowerCase().includes(lower)) ||
        b.file.toLowerCase().includes(lower)).filter((b) => !projectOrigin || !b.project_origin || b.project_origin === projectOrigin /* LOCAL MOD (claude-stack): buglog project_origin */);
}
