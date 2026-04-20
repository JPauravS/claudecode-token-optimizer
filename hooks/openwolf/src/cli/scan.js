import * as fs from "node:fs";
import * as path from "node:path";
import { findProjectRoot } from "../scanner/project-root.js";
import { scanProject, buildAnatomy } from "../scanner/anatomy-scanner.js";
export async function scanCommand(options) {
    const projectRoot = findProjectRoot();
    const wolfDir = path.join(projectRoot, ".wolf");
    if (!fs.existsSync(wolfDir)) {
        console.log("OpenWolf not initialized. Run: openwolf init");
        return;
    }
    if (options.check) {
        const { content: newContent } = buildAnatomy(wolfDir, projectRoot);
        const anatomyPath = path.join(wolfDir, "anatomy.md");
        let existingContent = "";
        try {
            existingContent = fs.readFileSync(anatomyPath, "utf-8");
        }
        catch {
            // File doesn't exist — anatomy is out of date
        }
        // Strip the timestamp line before comparing, since it changes every scan
        const stripTimestamp = (s) => s.replace(/^> Auto-maintained by OpenWolf\. Last scanned: .+$/m, "");
        if (stripTimestamp(existingContent) === stripTimestamp(newContent)) {
            console.log("Anatomy is up to date");
            return;
        }
        else {
            console.log("Anatomy is out of date. Run `openwolf scan` to update.");
            process.exit(1);
        }
    }
    console.log("Scanning project...");
    const startTime = Date.now();
    const fileCount = scanProject(wolfDir, projectRoot);
    const elapsed = Date.now() - startTime;
    console.log(`  ✓ Anatomy scan complete: ${fileCount} files indexed in ${elapsed}ms`);
}
