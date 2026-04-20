#!/usr/bin/env node
// hooks/dashboard-autostart.js — SessionStart hook that ensures the dashboard
// is running at 127.0.0.1:3847 whenever a Claude Code session starts.
//
// Opt-in: add to ~/.claude/settings.json via:
//   node scripts/merge-settings.js --enable-autostart
//
// Behavior:
//   1. Probe 127.0.0.1:3847 — if open, exit (already running).
//   2. Check pidfile. If it points to a live process, exit.
//   3. Spawn `node dashboard/server.js` detached, write pid to pidfile, exit.
// Never blocks the session start (< 600ms total in practice).

const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const PID_FILE = path.join(REPO_ROOT, 'dashboard', 'data', 'dashboard.pid');
const SERVER = path.join(REPO_ROOT, 'dashboard', 'server.js');
const LOG_FILE = path.join(REPO_ROOT, 'dashboard', 'data', 'autostart.log');
const ERR_FILE = path.join(REPO_ROOT, 'dashboard', 'data', 'autostart-last-error.txt');
const PORT = 3847;
const HOST = '127.0.0.1';
// cap autostart.log at 100KB — on overflow, truncate and keep a header so
// the user can still see recent lines. SessionStart fires often; unbounded
// append is a slow memory leak on busy machines.
const LOG_MAX_BYTES = 100 * 1024;

function log(msg) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    try {
      const st = fs.statSync(LOG_FILE);
      if (st.size > LOG_MAX_BYTES) {
        fs.writeFileSync(LOG_FILE, `[${new Date().toISOString()}] (log rotated: was ${st.size} bytes)\n`);
      }
    } catch (_) { /* file absent — first write creates it below */ }
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
  } catch (_) {}
}

// write a single-line error file that users + doctor can surface easily
// when spawn fails. Overwritten each failure so it always shows the latest.
function writeLastError(msg) {
  try {
    fs.mkdirSync(path.dirname(ERR_FILE), { recursive: true });
    fs.writeFileSync(ERR_FILE, `[${new Date().toISOString()}] ${msg}\n`, 'utf8');
  } catch (_) {}
}
function clearLastError() {
  try { fs.unlinkSync(ERR_FILE); } catch (_) {}
}

function probePort(timeoutMs) {
  return new Promise(resolve => {
    const s = new net.Socket();
    let done = false;
    const finish = (state) => { if (!done) { done = true; try { s.destroy(); } catch (_) {} resolve(state); } };
    s.setTimeout(timeoutMs);
    s.once('connect', () => finish('open'));
    s.once('timeout', () => finish('closed'));
    s.once('error', () => finish('closed'));
    s.connect(PORT, HOST);
  });
}

function pidAlive(pid) {
  if (!pid || Number.isNaN(pid)) return false;
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
}

async function main() {
  const state = await probePort(400);
  if (state === 'open') {
    log('port 3847 already listening — skip spawn');
    return;
  }
  if (fs.existsSync(PID_FILE)) {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    if (pidAlive(pid)) {
      log(`pidfile pid ${pid} alive but port not listening — waiting to avoid double-spawn`);
      return;
    }
    log(`removing stale pidfile (pid ${pid} dead)`);
    try { fs.unlinkSync(PID_FILE); } catch (_) {}
  }
  if (!fs.existsSync(SERVER)) {
    const msg = `SPAWN_FAILED: dashboard/server.js not found at ${SERVER} — did setup complete?`;
    log(msg);
    writeLastError(msg);
    return;
  }
  let child;
  try {
    child = spawn(process.execPath, [SERVER], {
      cwd: REPO_ROOT,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, DASHBOARD_AUTOSTART: '1' },
    });
  } catch (err) {
    const msg = `SPAWN_FAILED: spawn threw: ${err && err.message || err}`;
    log(msg);
    writeLastError(msg);
    return;
  }
  // async spawn errors (ENOENT, EACCES, etc.) arrive via 'error' event
  // AFTER spawn() returns. Capture + surface so users can diagnose; hook
  // still exits 0 so SessionStart does not fail.
  child.once('error', (err) => {
    const msg = `SPAWN_FAILED: child error: ${err && err.message || err}`;
    log(msg);
    writeLastError(msg);
  });
  child.unref();
  log(`spawned dashboard pid ${child.pid}`);
  clearLastError();
}

// SessionStart must not block the session — always exit 0 from the hook.
// Errors are already surfaced via log + autostart-last-error.txt.
main().catch(err => {
  const msg = `SPAWN_FAILED: ${err && err.message || err}`;
  log(msg);
  writeLastError(msg);
});
