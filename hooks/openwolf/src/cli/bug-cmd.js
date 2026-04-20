import * as fs from "node:fs";
import { findProjectRoot } from "../scanner/project-root.js";
import { searchBugs } from "../buglog/bug-tracker.js";
import { getWorkspaceWolfDir } from "../hooks/shared.js"; /* LOCAL MOD (claude-stack): bug-cmd → workspace */
export function bugSearch(term) {
    const projectRoot = findProjectRoot();
    const wolfDir = getWorkspaceWolfDir(); /* LOCAL MOD (claude-stack): bug-cmd → workspace */
    if (!fs.existsSync(wolfDir)) {
        console.log("OpenWolf not initialized. Run: openwolf init");
        return;
    }
    const results = searchBugs(wolfDir, term, process.env.CLAUDE_PROJECT_DIR || projectRoot) /* LOCAL MOD (claude-stack): bug-cmd project_origin */;
    if (results.length === 0) {
        console.log(`No bugs found matching "${term}".`);
        return;
    }
    console.log(`Found ${results.length} matching bug(s):\n`);
    for (const bug of results) {
        console.log(`  [${bug.id}] ${bug.error_message.slice(0, 80)}`);
        console.log(`    File: ${bug.file}${bug.line ? `:${bug.line}` : ""}`);
        console.log(`    Root cause: ${bug.root_cause}`);
        console.log(`    Fix: ${bug.fix}`);
        console.log(`    Tags: ${bug.tags.join(", ")}`);
        console.log(`    Occurrences: ${bug.occurrences} | Last seen: ${bug.last_seen}`);
        console.log("");
    }
}
