import * as fs from "node:fs";
import * as path from "node:path";
const pathJoin25e = path.join; /* LOCAL MOD (claude-stack): cron-engine backup + catch-up */
import { execSync, spawnSync } from "node:child_process";
import cron from "node-cron";
import parser from "cron-parser"; /* LOCAL MOD (claude-stack): cron-engine backup + catch-up */
import * as fs25e from "node:fs"; /* LOCAL MOD (claude-stack): cron-engine backup + catch-up */
import * as crypto25e from "node:crypto"; /* LOCAL MOD (claude-stack): cron-engine backup + catch-up */
import { readJSON, writeJSON, readText, writeText } from "../utils/fs-safe.js";
import { scanProject } from "../scanner/anatomy-scanner.js";
import { detectWaste } from "../tracker/waste-detector.js";
export class CronEngine {
    wolfDir;
    projectRoot;
    logger;
    broadcast;
    scheduledTasks = [];
    failureCounts = new Map();
    constructor(wolfDir, projectRoot, logger, broadcast) {
        this.wolfDir = wolfDir;
        this.projectRoot = projectRoot;
        this.logger = logger;
        this.broadcast = broadcast;
    }
    start() {
        const manifest = this.readManifest();
        for (const task of manifest.tasks) {
            if (!task.enabled)
                continue;
            if (!cron.validate(task.schedule)) {
                this.logger.warn(`Invalid cron schedule for ${task.id}: ${task.schedule}`);
                continue;
            }
            const scheduled = cron.schedule(task.schedule, () => {
                this.executeTask(task).catch((err) => {
                    this.logger.error(`Task ${task.id} failed: ${err}`);
                });
            });
            this.scheduledTasks.push(scheduled);
            this.logger.info(`Scheduled task: ${task.name} (${task.schedule})`);
        }
        this.catchUp(manifest); /* LOCAL MOD (claude-stack): cron-engine backup + catch-up */
    }
    catchUp(manifest) {
        try {
            const state = this.readState();
            const execLog = Array.isArray(state.execution_log) ? state.execution_log : [];
            const now = new Date();
            for (const task of manifest.tasks) {
                if (!task.enabled)
                    continue;
                if (!cron.validate(task.schedule))
                    continue;
                let expected;
                try {
                    const interval = parser.parseExpression(task.schedule, { currentDate: now });
                    expected = interval.prev().toDate();
                }
                catch {
                    continue;
                }
                const lastSuccess = execLog.filter((e) => e.task_id === task.id && e.status === "success")
                    .map((e) => new Date(e.timestamp).getTime())
                    .sort((a, b) => b - a)[0];
                if (lastSuccess !== undefined && lastSuccess >= expected.getTime())
                    continue;
                this.logger.info(`Catch-up: ${task.name} (expected ${expected.toISOString()}, last ${lastSuccess ? new Date(lastSuccess).toISOString() : "never"})`);
                this.executeTask(task).catch((err) => this.logger.error(`Catch-up ${task.id} failed: ${err}`));
            }
        }
        catch (err) {
            this.logger.warn(`Catch-up pass failed: ${err}`);
        }
    }
    backupWolfFile(filename) {
        try {
            const src = pathJoin25e(this.wolfDir, filename);
            if (!fs25e.existsSync(src))
                return;
            const backupsDir = pathJoin25e(this.wolfDir, "backups");
            fs25e.mkdirSync(backupsDir, { recursive: true });
            const current = fs25e.readFileSync(src);
            const currentHash = crypto25e.createHash("sha256").update(current).digest("hex");
            const existing = fs25e.readdirSync(backupsDir).filter(f => f.startsWith(filename + "."));
            for (const prev of existing) {
                try {
                    const prevHash = crypto25e.createHash("sha256").update(fs25e.readFileSync(pathJoin25e(backupsDir, prev))).digest("hex");
                    if (prevHash === currentHash) {
                        this.logger.info(`Backup skipped (unchanged): ${filename}`);
                        return;
                    }
                }
                catch { }
            }
            const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
            const dest = pathJoin25e(backupsDir, `${filename}.${ts}.bak`);
            fs25e.copyFileSync(src, dest);
            this.logger.info(`Backup: ${filename} → backups/${filename}.${ts}.bak`);
        }
        catch (err) {
            this.logger.warn(`Backup failed for ${filename}: ${err}`);
        }
    }
    stop() {
        for (const task of this.scheduledTasks) {
            task.stop();
        }
        this.scheduledTasks = [];
    }
    async runTask(taskId) {
        const manifest = this.readManifest();
        const task = manifest.tasks.find((t) => t.id === taskId);
        if (!task) {
            this.logger.warn(`Task not found: ${taskId}`);
            return;
        }
        await this.executeTask(task);
    }
    readManifest() {
        return readJSON(path.join(this.wolfDir, "cron-manifest.json"), { version: 1, tasks: [] });
    }
    readState() {
        return readJSON(path.join(this.wolfDir, "cron-state.json"), { last_heartbeat: null, engine_status: "running", execution_log: [], dead_letter_queue: [], upcoming: [] });
    }
    writeState(state) {
        writeJSON(path.join(this.wolfDir, "cron-state.json"), state);
    }
    async executeTask(task) {
        const startTime = Date.now();
        this.logger.info(`Executing task: ${task.name}`);
        try {
            await this.runAction(task.action);
            const duration = Date.now() - startTime;
            // Log success
            const state = this.readState();
            state.execution_log.push({
                task_id: task.id,
                status: "success",
                timestamp: new Date().toISOString(),
                duration_ms: duration,
            });
            // Keep last 100 entries
            if (state.execution_log.length > 100) {
                state.execution_log = state.execution_log.slice(-100);
            }
            this.writeState(state);
            this.failureCounts.set(task.id, 0);
            this.broadcast({
                type: "cron_executed",
                task_id: task.id,
                status: "success",
                duration_ms: duration,
            });
            this.logger.info(`Task ${task.name} completed in ${duration}ms`);
        }
        catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            const duration = Date.now() - startTime;
            const failures = (this.failureCounts.get(task.id) ?? 0) + 1;
            this.failureCounts.set(task.id, failures);
            this.logger.error(`Task ${task.name} failed (attempt ${failures}): ${errorMsg}`);
            if (failures < task.retry.max_attempts) {
                // Retry with backoff
                const delay = this.calculateDelay(task.retry.backoff, task.retry.base_delay_seconds, failures);
                this.logger.info(`Retrying ${task.name} in ${delay}ms`);
                setTimeout(() => {
                    this.executeTask(task).catch(() => { });
                }, delay);
            }
            else {
                // Dead letter or skip
                const state = this.readState();
                state.execution_log.push({
                    task_id: task.id,
                    status: "failed",
                    timestamp: new Date().toISOString(),
                    duration_ms: duration,
                    error: errorMsg,
                });
                if (task.failsafe.dead_letter) {
                    state.dead_letter_queue.push({
                        task_id: task.id,
                        error: errorMsg,
                        timestamp: new Date().toISOString(),
                        attempts: failures,
                    });
                }
                this.writeState(state);
                this.failureCounts.set(task.id, 0);
            }
            this.broadcast({
                type: "cron_executed",
                task_id: task.id,
                status: "failed",
                duration_ms: duration,
            });
        }
    }
    calculateDelay(backoff, baseSec, attempt) {
        const baseMs = baseSec * 1000;
        switch (backoff) {
            case "exponential":
                return baseMs * Math.pow(2, attempt - 1);
            case "linear":
                return baseMs * attempt;
            default:
                return 0;
        }
    }
    async runAction(action) {
        switch (action.type) {
            case "scan_project":
                scanProject(this.wolfDir, this.projectRoot);
                break;
            case "consolidate_memory":
                this.consolidateMemory(action.params?.older_than_days ?? 7);
                break;
            case "generate_token_report":
                this.generateTokenReport();
                break;
            case "ai_task":
                await this.runAiTask(action.params);
                break;
            default:
                throw new Error(`Unknown action type: ${action.type}`);
        }
    }
    consolidateMemory(olderThanDays) {
        const memoryPath = path.join(this.wolfDir, "memory.md");
        this.backupWolfFile("memory.md"); /* LOCAL MOD (claude-stack): cron-engine backup + catch-up */
        const content = readText(memoryPath);
        if (!content)
            return;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - olderThanDays);
        const lines = content.split("\n");
        const result = [];
        let inOldSession = false;
        let oldSessionLines = [];
        let currentSessionDate = null;
        for (const line of lines) {
            const sessionMatch = line.match(/^## Session: (\d{4}-\d{2}-\d{2})/);
            if (sessionMatch) {
                // Flush previous old session
                if (inOldSession && oldSessionLines.length > 0) {
                    const actionCount = oldSessionLines.filter((l) => l.startsWith("|") && !l.startsWith("|--") && !l.startsWith("| Time")).length;
                    result.push(`> Consolidated session (${actionCount} actions)`);
                    result.push("");
                }
                currentSessionDate = new Date(sessionMatch[1]);
                if (currentSessionDate < cutoff) {
                    inOldSession = true;
                    oldSessionLines = [];
                    result.push(line); // Keep the header
                }
                else {
                    inOldSession = false;
                    result.push(line);
                }
                continue;
            }
            if (inOldSession) {
                oldSessionLines.push(line);
            }
            else {
                result.push(line);
            }
        }
        // Flush last old session
        if (inOldSession && oldSessionLines.length > 0) {
            const actionCount = oldSessionLines.filter((l) => l.startsWith("|") && !l.startsWith("|--") && !l.startsWith("| Time")).length;
            result.push(`> Consolidated session (${actionCount} actions)`);
            result.push("");
        }
        writeText(memoryPath, result.join("\n"));
    }
    generateTokenReport() {
        const flags = detectWaste(this.wolfDir);
        const ledgerPath = path.join(this.wolfDir, "token-ledger.json");
        const ledger = readJSON(ledgerPath, {});
        ledger.waste_flags = flags;
        ledger.optimization_report = {
            last_generated: new Date().toISOString(),
            patterns: flags.map((f) => f.pattern),
        };
        writeJSON(ledgerPath, ledger);
    }
    hasClaude() {
        try {
            const cmd = process.platform === "win32" ? "where claude" : "which claude";
            execSync(cmd, { stdio: "ignore" });
            return true;
        }
        catch {
            return false;
        }
    }
    async runAiTask(params) {
        if (!this.hasClaude()) {
            throw new Error("Claude CLI not found. Install it from https://claude.ai/download or add it to PATH.");
        }
        const contextParts = [];
        for (const file of params.context_files) {
            const filePath = path.join(this.projectRoot, file);
            try {
                contextParts.push(`--- ${file} ---\n${fs.readFileSync(filePath, "utf-8")}`);
            }
            catch {
                contextParts.push(`--- ${file} --- (not found)`);
            }
        }
        const fullPrompt = `${params.prompt}\n\n---\nContext:\n${contextParts.join("\n\n")}`;
        try {
            // Use spawnSync to pipe prompt via stdin — avoids command-line length limits on Windows
            // claude -p (no argument) reads prompt from stdin
            // Strip ANTHROPIC_API_KEY so claude uses OAuth subscription credentials
            // instead of a potentially depleted API key
            const env = { ...process.env };
            delete env.ANTHROPIC_API_KEY;
            const proc = spawnSync("claude -p --output-format text", {
                input: fullPrompt,
                timeout: 120000,
                encoding: "utf-8",
                cwd: this.projectRoot,
                env,
                stdio: ["pipe", "pipe", "pipe"],
                // shell: true needed on Windows so that claude.cmd is resolved
                shell: true,
                windowsHide: true,
            });
            if (proc.error) {
                throw proc.error;
            }
            if (proc.status !== 0) {
                const stderr = proc.stderr?.trim();
                const stdout = proc.stdout?.trim();
                const errMsg = stderr || stdout || "Unknown error";
                throw new Error(`Exit code ${proc.status}: ${errMsg}`);
            }
            let result = (proc.stdout || "").replace(/\r\n/g, "\n").trim();
            // Strip markdown code fences if present (```markdown ... ``` or ```json ... ```)
            const fenceMatch = result.match(/```[\w]*\n([\s\S]*?)\n```/);
            if (fenceMatch) {
                result = fenceMatch[1].trim();
            }
            // Write result to suggestions.json if it looks like JSON
            try {
                const parsed = JSON.parse(result);
                writeJSON(path.join(this.wolfDir, "suggestions.json"), {
                    generated_at: new Date().toISOString(),
                    ...parsed,
                });
            }
            catch {
                // Not JSON, might be a cerebrum update
                if (result.includes("## User Preferences") || result.includes("## Key Learnings") || result.includes("# Cerebrum")) {
                    this.backupWolfFile("cerebrum.md"); /* LOCAL MOD (claude-stack): cron-engine backup + catch-up */
                    writeText(path.join(this.wolfDir, "cerebrum.md"), result);
                }
            }
        }
        catch (err) {
            throw new Error(`claude -p failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}
