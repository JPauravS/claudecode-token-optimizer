import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { initCommand } from "./init.js";
import { statusCommand } from "./status.js";
import { scanCommand } from "./scan.js";
// LOCAL MOD (claude-stack): cli-index stubs-removed — dashboard import dropped
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
function getVersion() {
    try {
        const pkgPath = path.resolve(__dirname, "../../../package.json");
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        return pkg.version || "unknown";
    }
    catch {
        return "unknown";
    }
}
export function createProgram() {
    const program = new Command();
    program
        .name("openwolf")
        .description("Token-conscious AI brain for Claude Code projects")
        .version(getVersion());
    program
        .command("init")
        .description("Initialize .wolf/ in current project")
        .action(initCommand);
    program
        .command("status")
        .description("Show daemon health, last session stats, file integrity")
        .action(statusCommand);
    program
        .command("scan")
        .description("Force full anatomy rescan")
        .option("--check", "Verify anatomy.md matches filesystem (no changes)")
        .action(scanCommand);
    /* LOCAL MOD (claude-stack): cli-index stubs-removed — dashboard subcommand dropped (use npm run dashboard) */
    /* LOCAL MOD (claude-stack): cli-index stubs-removed — daemon command group dropped (wolf-daemon.ts not vendored; pm2 spawn broken) */
    const cron = program
        .command("cron")
        .description("Cron task management");
    cron
        .command("list")
        .description("Show all cron tasks with next run times")
        .action(async () => {
        const { cronList } = await import("./cron-cmd.js");
        cronList();
    });
    cron
        .command("run <id>")
        .description("Manually trigger a cron task")
        .action(async (id) => {
        const { cronRun } = await import("./cron-cmd.js");
        await cronRun(id);
    });
    cron
        .command("retry <id>")
        .description("Retry a dead-lettered task")
        .action(async (id) => {
        const { cronRetry } = await import("./cron-cmd.js");
        cronRetry(id);
    });
    // --- Update command ---
    program
        .command("update")
        .description("Update all registered OpenWolf projects to latest version")
        .option("--dry-run", "Show what would be updated without making changes")
        .option("--project <name>", "Update only a specific project (partial name match)")
        .option("--list", "List all registered projects")
        .action(async (opts) => {
        const { updateCommand, listProjects } = await import("./update.js");
        if (opts.list) {
            listProjects();
        }
        else {
            await updateCommand(opts);
        }
    });
    // --- Restore command ---
    program
        .command("restore [backup]")
        .description("Restore .wolf from a backup (run in project dir). Without args, lists available backups.")
        .action(async (backup) => {
        const { restoreCommand } = await import("./update.js");
        restoreCommand(backup);
    });
    /* LOCAL MOD (claude-stack): cli-index stubs-removed — designqc permanently dropped */
    // --- Bug command ---
    const bug = program
        .command("bug")
        .description("Bug memory management");
    bug
        .command("search <term>")
        .description("Search buglog for matching entries")
        .action(async (term) => {
        const { bugSearch } = await import("./bug-cmd.js");
        bugSearch(term);
    });
    return program;
}
