// scripts/patches/cron-engine.ts.patch.js
// — three additions to upstream cron-engine.ts:
//   1. backupWolfFile(filename): copy <wolfDir>/<file> → <wolfDir>/backups/<file>.<YYYY-MM-DD-HHmm>.bak
//      Skip if unchanged since most recent backup (content hash).
//      Kept forever (no rotation) per user preference.
//   2. catchUp(manifest): on start(), use cron-parser to compute the most recent
//      expected fire time per enabled task. If it's > last successful execution
//      in cron-state.execution_log, run the task once (catch-up).
//   3. Inject backup calls into consolidateMemory (memory.md) and runAiTask
//      cerebrum-write branch (cerebrum.md).

const MARKER = 'LOCAL MOD (claude-stack): cron-engine backup + catch-up';

// 1. Add cron-parser import after the existing node-cron import.
const IMPORT_ANCHOR = /import cron from "node-cron";\nimport \{ readJSON, writeJSON, readText, writeText, appendText \} from "\.\.\/utils\/fs-safe\.js";/;
const IMPORT_REPLACE =
  'import cron from "node-cron";\nimport parser from "cron-parser"; /* LOCAL MOD (claude-stack): cron-engine backup + catch-up */\nimport * as fs25e from "node:fs"; /* LOCAL MOD (claude-stack): cron-engine backup + catch-up */\nimport * as crypto25e from "node:crypto"; /* LOCAL MOD (claude-stack): cron-engine backup + catch-up */\nimport { readJSON, writeJSON, readText, writeText, appendText } from "../utils/fs-safe.js";';

// 2. Inject this.catchUp(manifest) at end of start().
const START_END_ANCHOR = /(      this\.logger\.info\(`Scheduled task: \$\{task\.name\} \(\$\{task\.schedule\}\)`\);\n    \}\n  \})/;
const START_END_REPLACE =
  '$1\n\n  private catchUp(manifest: CronManifest): void { /* LOCAL MOD (claude-stack): cron-engine backup + catch-up */\n    try {\n      const state = this.readState();\n      const execLog = Array.isArray(state.execution_log) ? state.execution_log : [];\n      const now = new Date();\n      for (const task of manifest.tasks) {\n        if (!task.enabled) continue;\n        if (!cron.validate(task.schedule)) continue;\n        let expected: Date;\n        try {\n          const interval = parser.parseExpression(task.schedule, { currentDate: now });\n          expected = interval.prev().toDate();\n        } catch { continue; }\n        const lastSuccess = execLog.filter((e: any) => e.task_id === task.id && e.status === "success")\n          .map((e: any) => new Date(e.timestamp).getTime())\n          .sort((a: number, b: number) => b - a)[0];\n        if (lastSuccess !== undefined && lastSuccess >= expected.getTime()) continue;\n        this.logger.info(`Catch-up: ${task.name} (expected ${expected.toISOString()}, last ${lastSuccess ? new Date(lastSuccess).toISOString() : "never"})`);\n        this.executeTask(task).catch((err) => this.logger.error(`Catch-up ${task.id} failed: ${err}`));\n      }\n    } catch (err) {\n      this.logger.warn(`Catch-up pass failed: ${err}`);\n    }\n  }\n\n  private backupWolfFile(filename: string): void { /* LOCAL MOD (claude-stack): cron-engine backup + catch-up */\n    try {\n      const src = pathJoin25e(this.wolfDir, filename);\n      if (!fs25e.existsSync(src)) return;\n      const backupsDir = pathJoin25e(this.wolfDir, "backups");\n      fs25e.mkdirSync(backupsDir, { recursive: true });\n      const current = fs25e.readFileSync(src);\n      const currentHash = crypto25e.createHash("sha256").update(current).digest("hex");\n      const existing = fs25e.readdirSync(backupsDir).filter(f => f.startsWith(filename + "."));\n      for (const prev of existing) {\n        try {\n          const prevHash = crypto25e.createHash("sha256").update(fs25e.readFileSync(pathJoin25e(backupsDir, prev))).digest("hex");\n          if (prevHash === currentHash) {\n            this.logger.info(`Backup skipped (unchanged): ${filename}`);\n            return;\n          }\n        } catch {}\n      }\n      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);\n      const dest = pathJoin25e(backupsDir, `${filename}.${ts}.bak`);\n      fs25e.copyFileSync(src, dest);\n      this.logger.info(`Backup: ${filename} → backups/${filename}.${ts}.bak`);\n    } catch (err) {\n      this.logger.warn(`Backup failed for ${filename}: ${err}`);\n    }\n  }';

// 3. Inject pathJoin25e helper (alias to node:path.join, needed because upstream
// imports path via namespace; we want a stable reference in our injected code).
const PATHJOIN_ANCHOR = /import \* as path from "node:path";/;
const PATHJOIN_REPLACE =
  'import * as path from "node:path";\nconst pathJoin25e = path.join; /* LOCAL MOD (claude-stack): cron-engine backup + catch-up */';

// 4. Wire catchUp call at end of start(). Separate from method injection above
// because the injected block goes AFTER start() (as a new class method).
// Actually: the injection already lives after start(). We also need to CALL it
// from inside start(). Patch the start() closing.
const START_CALL_ANCHOR = /(  start\(\): void \{\n    const manifest = this\.readManifest\(\);\n    for \(const task of manifest\.tasks\) \{\n(?:.*\n)*?    \}\n)(  \})/;
const START_CALL_REPLACE =
  '$1    this.catchUp(manifest); /* LOCAL MOD (claude-stack): cron-engine backup + catch-up */\n$2';

// 5. Inject backup call in consolidateMemory (before the read).
const CONSOL_ANCHOR = /(  private consolidateMemory\(olderThanDays: number\): void \{\n    const memoryPath = path\.join\(this\.wolfDir, "memory\.md"\);\n)/;
const CONSOL_REPLACE =
  '$1    this.backupWolfFile("memory.md"); /* LOCAL MOD (claude-stack): cron-engine backup + catch-up */\n';

// 6. Inject backup call before cerebrum write in runAiTask.
const CEREBRUM_ANCHOR = /(        if \(result\.includes\("## User Preferences"\) \|\| result\.includes\("## Key Learnings"\) \|\| result\.includes\("# Cerebrum"\)\) \{\n)(          writeText\(path\.join\(this\.wolfDir, "cerebrum\.md"\), result\);)/;
const CEREBRUM_REPLACE =
  '$1          this.backupWolfFile("cerebrum.md"); /* LOCAL MOD (claude-stack): cron-engine backup + catch-up */\n$2';

function apply(content) {
  if (content.includes(MARKER)) return content; // idempotent

  if (!IMPORT_ANCHOR.test(content)) {
    throw new Error('cron-engine.ts patch: import anchor not found');
  }
  if (!PATHJOIN_ANCHOR.test(content)) {
    throw new Error('cron-engine.ts patch: path import anchor not found');
  }
  if (!START_END_ANCHOR.test(content)) {
    throw new Error('cron-engine.ts patch: start() end anchor not found');
  }
  if (!START_CALL_ANCHOR.test(content)) {
    throw new Error('cron-engine.ts patch: start() call-site anchor not found');
  }
  if (!CONSOL_ANCHOR.test(content)) {
    throw new Error('cron-engine.ts patch: consolidateMemory anchor not found');
  }
  if (!CEREBRUM_ANCHOR.test(content)) {
    throw new Error('cron-engine.ts patch: cerebrum write anchor not found');
  }

  let patched = content;
  patched = patched.replace(IMPORT_ANCHOR, IMPORT_REPLACE);
  patched = patched.replace(PATHJOIN_ANCHOR, PATHJOIN_REPLACE);
  // Order matters: append methods AFTER start() first, then insert the
  // catchUp call inside start(). Otherwise the inserted call breaks the
  // START_END_ANCHOR `    }\n  }` pattern.
  patched = patched.replace(START_END_ANCHOR, START_END_REPLACE);
  patched = patched.replace(START_CALL_ANCHOR, START_CALL_REPLACE);
  patched = patched.replace(CONSOL_ANCHOR, CONSOL_REPLACE);
  patched = patched.replace(CEREBRUM_ANCHOR, CEREBRUM_REPLACE);

  if (!patched.includes(MARKER)) {
    throw new Error('cron-engine.ts patch applied but marker missing');
  }
  return patched;
}

module.exports = { apply, MARKER };
