#!/usr/bin/env node
// scripts/wolf-cron-tick.js.
// Minimal viable cron runner: instantiates CronEngine against the current
// project's .wolf/, then either:
//   - runs a named task (argv[2] provided)
//   - writes a heartbeat to cron-state.json and exits (no argv)
//
// We deliberately do NOT run wolf-daemon.ts (port 18791 + WS server conflicts
// with our dashboard on 3847). Scheduled tasks are meant to be driven by the
// host dashboard or by explicit manual invocation (npm run wolf:cron:tick).

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const REPO_ROOT = path.resolve(__dirname, '..');
const CFG_PATH = path.join(REPO_ROOT, 'dashboard', 'data', 'openwolf-config.json');

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function seedIfMissing(wolfDir) {
  const manifestPath = path.join(wolfDir, 'cron-manifest.json');
  const statePath = path.join(wolfDir, 'cron-state.json');
  if (!fs.existsSync(manifestPath)) {
    fs.writeFileSync(manifestPath, JSON.stringify({
      version: 1,
      tasks: [
        {
          id: 'anatomy-rescan',
          name: 'Anatomy rescan',
          schedule: '0 */6 * * *',
          description: 'Full project anatomy rescan every 6 hours',
          action: { type: 'scan_project' },
          retry: { max_attempts: 2, backoff: 'exponential', base_delay_seconds: 60 },
          failsafe: { on_failure: 'skip', dead_letter: true },
          enabled: false,
        },
        {
          id: 'memory-consolidation',
          name: 'Memory consolidation',
          schedule: '0 2 * * *',
          description: 'Collapse sessions older than 7 days in memory.md',
          action: { type: 'consolidate_memory', params: { older_than_days: 7 } },
          retry: { max_attempts: 1, backoff: 'none', base_delay_seconds: 0 },
          failsafe: { on_failure: 'skip' },
          enabled: false,
        },
        {
          id: 'token-report',
          name: 'Token report',
          schedule: '0 3 * * 1',
          description: 'Generate weekly token waste report',
          action: { type: 'generate_token_report' },
          retry: { max_attempts: 1, backoff: 'none', base_delay_seconds: 0 },
          failsafe: { on_failure: 'skip' },
          enabled: false,
        },
      ],
    }, null, 2));
    console.log(`[wolf-cron-tick] seeded ${manifestPath}`);
  }
  if (!fs.existsSync(statePath)) {
    fs.writeFileSync(statePath, JSON.stringify({
      last_heartbeat: null,
      engine_status: 'initialized',
      execution_log: [],
      dead_letter_queue: [],
      upcoming: [],
    }, null, 2));
    console.log(`[wolf-cron-tick] seeded ${statePath}`);
  }
}

function writeHeartbeat(wolfDir) {
  const statePath = path.join(wolfDir, 'cron-state.json');
  const state = readJson(statePath, {
    last_heartbeat: null, engine_status: 'initialized',
    execution_log: [], dead_letter_queue: [], upcoming: [],
  });
  state.last_heartbeat = new Date().toISOString();
  state.engine_status = 'tick';
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  console.log(`[wolf-cron-tick] heartbeat → ${state.last_heartbeat}`);
}

async function runTask(wolfDir, projectRoot, taskId) {
  // Dynamic import against compiled ESM (built by tsc into .js next to .ts).
  const engineModUrl = pathToFileURL(
    path.join(REPO_ROOT, 'hooks', 'openwolf', 'src', 'daemon', 'cron-engine.js')
  ).href;
  const loggerModUrl = pathToFileURL(
    path.join(REPO_ROOT, 'hooks', 'openwolf', 'src', 'utils', 'logger.js')
  ).href;
  const { CronEngine } = await import(engineModUrl);
  const { Logger } = await import(loggerModUrl);

  const logger = new Logger(path.join(wolfDir, 'daemon.log'), 'info');
  const engine = new CronEngine(wolfDir, projectRoot, logger, () => {});
  console.log(`[wolf-cron-tick] running task ${taskId}…`);
  await engine.runTask(taskId);
  console.log(`[wolf-cron-tick] task ${taskId} done`);
}

async function main() {
  const cfg = readJson(CFG_PATH, null);
  if (!cfg) {
    console.error(`[wolf-cron-tick] missing config: ${CFG_PATH}`);
    process.exit(1);
  }
  const projectRoot = cfg.project_default;
  const wolfDir = path.join(projectRoot, '.wolf');
  if (!fs.existsSync(wolfDir)) {
    console.error(`[wolf-cron-tick] missing .wolf dir: ${wolfDir}`);
    process.exit(1);
  }

  seedIfMissing(wolfDir);
  writeHeartbeat(wolfDir);

  const taskId = process.argv[2];
  if (taskId) {
    await runTask(wolfDir, projectRoot, taskId);
  }
}

main().catch(err => {
  console.error('[wolf-cron-tick] error:', err);
  process.exit(1);
});
