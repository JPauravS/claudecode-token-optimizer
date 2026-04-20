#!/usr/bin/env node
// Stops the dashboard server via PID file.

const fs = require('node:fs');
const path = require('node:path');

const PID_PATH = path.resolve(__dirname, '..', 'dashboard', 'data', 'dashboard.pid');

function log(msg) { process.stdout.write(`[stop-dashboard] ${msg}\n`); }

function main() {
  if (!fs.existsSync(PID_PATH)) {
    log('No pid file — dashboard not running?');
    return;
  }
  const pid = parseInt(fs.readFileSync(PID_PATH, 'utf8').trim(), 10);
  if (!pid || Number.isNaN(pid)) {
    log('Invalid pid file — removing');
    fs.unlinkSync(PID_PATH);
    return;
  }
  // only unlink PID file when the process is confirmed gone
  // (kill success or ESRCH). Other errors (EPERM, EINVAL, …) leave the
  // pid file in place so a live dashboard remains discoverable.
  let canUnlink = false;
  try {
    process.kill(pid, 'SIGTERM');
    log(`Sent SIGTERM to pid ${pid}`);
    canUnlink = true;
  } catch (e) {
    if (e.code === 'ESRCH') {
      log(`pid ${pid} not running — cleaning stale pid file`);
      canUnlink = true;
    } else {
      log(`kill failed: ${e.message} — leaving pid file in place`);
    }
  }
  if (canUnlink) {
    try { fs.unlinkSync(PID_PATH); } catch (_) {}
  }
}

main();
