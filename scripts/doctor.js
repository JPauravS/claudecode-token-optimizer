#!/usr/bin/env node
// scripts/doctor.js — self-verify the Combined Claude Stack install.
//
// Output: human-readable table, followed by a machine-parseable sentinel line:
//   DOCTOR_RESULT: {"pass":true|false,"failed":["check1",...],"checks":N}
//
// On failure, writes dashboard/data/diagnostic-<ts>.log with sanitized details.
// Exits 0 on all-pass, 1 on any failure.
//
// Invocation:
//   node scripts/doctor.js            # interactive human output
//   node scripts/doctor.js --json     # JSON-only output (machine consumers)
//   node scripts/doctor.js --quiet    # suppress table; only sentinel + diagnostic path

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { execSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const SETTINGS = path.join(CLAUDE_DIR, 'settings.json');
const COMMANDS_DIR = path.join(CLAUDE_DIR, 'commands');
const OPENWOLF_CFG = path.join(REPO_ROOT, 'dashboard', 'data', 'openwolf-config.json');
const PID_FILE = path.join(REPO_ROOT, 'dashboard', 'data', 'dashboard.pid');
const DIAGNOSTIC_DIR = path.join(REPO_ROOT, 'dashboard', 'data');

const FLAG_JSON = process.argv.includes('--json');
const FLAG_QUIET = process.argv.includes('--quiet');

// consume split marker exports directly — no local filter.
const { HOOK_MARKERS, STATUSLINE_MARKERS } = require('./merge-settings.js');

const results = [];
function record(name, pass, detail, level) {
  // level: 'FAIL' (default non-pass), 'WARN' (informational only — does not flip overall pass).
  let status;
  if (pass) status = 'PASS';
  else if (level === 'WARN') status = 'WARN';
  else status = 'FAIL';
  results.push({ check: name, status, detail: detail || '' });
}

// -- individual checks ---------------------------------------------------------

function checkNodeVersion() {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  record('node>=20', major >= 20, `found node ${process.versions.node}`);
}

function checkSettingsJson() {
  if (!fs.existsSync(SETTINGS)) {
    record('settings.json exists', false, SETTINGS);
    return null;
  }
  record('settings.json exists', true, SETTINGS);
  try {
    const raw = fs.readFileSync(SETTINGS, 'utf8');
    const obj = raw.trim() ? JSON.parse(raw) : {};
    record('settings.json parseable', true, '');
    return obj;
  } catch (e) {
    record('settings.json parseable', false, e.message);
    return null;
  }
}

function allCommandsInSettings(settings) {
  if (!settings) {
    record('all hook MARKERS present', false, 'settings.json missing or unreadable');
    return;
  }
  const events = (settings.hooks && typeof settings.hooks === 'object') ? settings.hooks : {};
  const allCommands = [];
  for (const ev of Object.keys(events)) {
    const arr = Array.isArray(events[ev]) ? events[ev] : [];
    for (const group of arr) {
      const hooks = Array.isArray(group && group.hooks) ? group.hooks : [];
      for (const h of hooks) {
        if (typeof (h && h.command) === 'string') allCommands.push(h.command);
      }
    }
  }
  // use HOOK_MARKERS directly — statusLine markers live elsewhere and are
  // checked by checkStatusLine(). No hardcoded filter.
  const missing = HOOK_MARKERS.filter(m => !allCommands.some(c => c.includes(m)));
  record('all hook MARKERS present', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : `${HOOK_MARKERS.length} markers found`);
}

function checkStatusLine(settings) {
  if (!settings) {
    record('statusLine caveman present', false, 'settings.json missing');
    return;
  }
  const sl = settings.statusLine;
  // use STATUSLINE_MARKERS (single item today, room to grow).
  const ok = sl && typeof sl.command === 'string'
    && STATUSLINE_MARKERS.some(m => sl.command.includes(m));
  record('statusLine caveman present', !!ok, ok ? '' : `found: ${sl && sl.command || '(none)'}`);
}

function checkSlashCommands() {
  const files = ['caveman.md', 'openwolf.md'];
  const missing = files.filter(f => {
    const p = path.join(COMMANDS_DIR, f);
    if (!fs.existsSync(p)) return true;
    const body = fs.readFileSync(p, 'utf8');
    return body.trim().length === 0;
  });
  record('slash commands installed', missing.length === 0, missing.length ? `missing/empty: ${missing.join(', ')}` : `${files.length} commands in ${COMMANDS_DIR}`);
}

function checkOpenWolfCompiled() {
  const required = [
    'hooks/openwolf/src/hooks/session-start.js',
    'hooks/openwolf/src/hooks/stop.js',
    'hooks/openwolf/src/hooks/pre-read.js',
    'hooks/openwolf/src/hooks/pre-write.js',
    'hooks/openwolf/src/hooks/post-read.js',
    'hooks/openwolf/src/hooks/post-write.js',
  ];
  const missing = required.filter(rel => !fs.existsSync(path.join(REPO_ROOT, rel)));
  record('openwolf TS compiled', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : `${required.length} hook files present`);
}

function checkWolfDirs() {
  if (!fs.existsSync(OPENWOLF_CFG)) {
    record('.wolf/ dirs initialized', false, 'openwolf-config.json missing');
    return;
  }
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(OPENWOLF_CFG, 'utf8'));
  } catch (e) {
    record('.wolf/ dirs initialized', false, `openwolf-config.json parse error: ${e.message}`);
    return;
  }
  const ws = cfg.workspace_wolf_parent;
  const proj = cfg.project_default;
  const missing = [];
  if (!ws || !fs.existsSync(path.join(ws, '.wolf'))) missing.push(`workspace ${ws}/.wolf`);
  if (!proj || !fs.existsSync(path.join(proj, '.wolf'))) missing.push(`project ${proj}/.wolf`);
  record('.wolf/ dirs initialized', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : 'workspace + project .wolf/ present');
}

function probePort(host, port, timeoutMs) {
  return new Promise(resolve => {
    const s = new net.Socket();
    let done = false;
    const finish = (state) => { if (!done) { done = true; try { s.destroy(); } catch (_) {} resolve(state); } };
    s.setTimeout(timeoutMs);
    s.once('connect', () => finish('open'));
    s.once('timeout', () => finish('closed'));
    s.once('error', () => finish('closed'));
    s.connect(port, host);
  });
}

async function checkDashboardPort() {
  const state = await probePort('127.0.0.1', 3847, 500);
  // Port state is informational — closed is fine (dashboard just isn't running).
  // port open + no pidfile is ambiguous — could be our dashboard started
  // manually via `npm run dashboard`, or a truly foreign zombie. Treat as WARN
  // (non-fatal) instead of FAIL so a legit manual start doesn't break doctor.
  // Only the "pidfile points to dead pid" case is unambiguous zombie → FAIL.
  if (state === 'closed') {
    record('dashboard port 3847', true, 'not listening (expected when dashboard stopped)');
    return;
  }
  // state === 'open' — check for zombie vs legit holder
  let pid = null;
  if (fs.existsSync(PID_FILE)) {
    const raw = fs.readFileSync(PID_FILE, 'utf8').trim();
    pid = parseInt(raw, 10);
  }
  if (!pid) {
    record('dashboard port 3847', true, 'port held (no pidfile — likely manual `npm run dashboard`)', 'WARN');
    return;
  }
  let alive = false;
  try { process.kill(pid, 0); alive = true; } catch (_) { alive = false; }
  if (!alive) {
    record('dashboard port 3847', false, `pidfile says pid ${pid} but process dead — zombie holder. kill with: npx kill-port 3847 && rm ${PID_FILE}`);
    return;
  }
  record('dashboard port 3847', true, `held by live dashboard pid ${pid}`);
}

function checkNoUpstreamCaveman() {
  if (!fs.existsSync(SETTINGS)) {
    record('no upstream caveman/openwolf', true, 'settings.json absent');
    return;
  }
  const raw = fs.readFileSync(SETTINGS, 'utf8');
  const hits = [];
  if (/"\.caveman\//.test(raw)) hits.push('~/.caveman/ path');
  if (/\.claude\/skills\/caveman\/hooks/.test(raw)) hits.push('~/.claude/skills/caveman/hooks path');
  if (/\.claude\/skills\/openwolf\//.test(raw)) hits.push('~/.claude/skills/openwolf/ path');
  record('no upstream caveman/openwolf', hits.length === 0, hits.length ? `found: ${hits.join(', ')}` : '');
}

// -- output -------------------------------------------------------------------

function writeDiagnostic(failedChecks) {
  const ts = new Date().toISOString().replace(/[:]/g, '-').replace(/\.\d+Z$/, 'Z');
  const logPath = path.join(DIAGNOSTIC_DIR, `diagnostic-${ts}.log`);
  try { fs.mkdirSync(DIAGNOSTIC_DIR, { recursive: true }); } catch (_) {}
  const lines = [];
  lines.push(`[doctor] diagnostic generated ${new Date().toISOString()}`);
  lines.push(`[env] node=${process.versions.node} platform=${process.platform} arch=${process.arch}`);
  lines.push(`[env] REPO_ROOT=${REPO_ROOT}`);
  lines.push(`[env] CLAUDE_DIR=${CLAUDE_DIR}`);
  lines.push('');
  lines.push('[results]');
  for (const r of results) {
    lines.push(`  ${r.status}  ${r.check}  ${r.detail}`);
  }
  lines.push('');
  lines.push('[failed]');
  for (const name of failedChecks) {
    const r = results.find(x => x.check === name);
    lines.push(`  ${name}: ${r && r.detail || '(no detail)'}`);
  }
  try { fs.writeFileSync(logPath, lines.join('\n') + '\n', 'utf8'); } catch (_) {}
  return logPath;
}

async function main() {
  // Run all checks sequentially (fast; order not significant).
  checkNodeVersion();
  const settings = checkSettingsJson();
  allCommandsInSettings(settings);
  checkStatusLine(settings);
  checkSlashCommands();
  checkOpenWolfCompiled();
  checkWolfDirs();
  await checkDashboardPort();
  checkNoUpstreamCaveman();

  // only FAIL entries flip overall pass. WARN is informational.
  const failed = results.filter(r => r.status === 'FAIL').map(r => r.check);
  const warned = results.filter(r => r.status === 'WARN').map(r => r.check);
  const pass = failed.length === 0;

  let diagnosticPath = null;
  if (!pass) {
    diagnosticPath = writeDiagnostic(failed);
  }

  // in --json mode, emit ONE valid JSON object that includes both the
  // full results AND the sentinel fields. No trailing `DOCTOR_RESULT:` line,
  // so `jq` / JSON parsers can consume stdout cleanly.
  if (FLAG_JSON) {
    const payload = {
      pass,
      failed,
      warned,
      checks: results.length,
      diagnostic: diagnosticPath,
      results,
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    process.exit(pass ? 0 : 1);
  }

  if (!FLAG_QUIET) {
    // Human-readable table.
    process.stdout.write(`\n[doctor] Combined Claude Stack — health check\n`);
    const rows = results.map(r => ({
      check: r.check,
      status: r.status,
      detail: r.detail.length > 70 ? r.detail.slice(0, 67) + '...' : r.detail,
    }));
    // console.table works in Node for arrays of objects.
    console.table(rows);

    if (!pass) {
      process.stdout.write(`\n[doctor] FAIL. ${failed.length} check(s) failed.\n`);
      process.stdout.write(`[doctor] diagnostic written to: ${diagnosticPath}\n`);
      process.stdout.write(`[doctor] open an issue with this log: https://github.com/JPauravS/claudecode-token-optimizer/issues\n`);
    } else if (warned.length) {
      process.stdout.write(`\n[doctor] PASS. ${results.length} checks; ${warned.length} warning(s): ${warned.join(', ')}\n`);
    } else {
      process.stdout.write(`\n[doctor] PASS. ${results.length} checks green.\n`);
    }
  }

  // Machine-parseable sentinel for non-JSON modes only. Claude Code prompt
  // reads `tail -1` of stdout to get this line.
  const sentinel = JSON.stringify({ pass, failed, warned, checks: results.length, diagnostic: diagnosticPath });
  process.stdout.write(`DOCTOR_RESULT: ${sentinel}\n`);

  process.exit(pass ? 0 : 1);
}

main().catch(err => {
  process.stderr.write(`[doctor] FATAL: ${err && err.stack || err}\n`);
  process.stdout.write(`DOCTOR_RESULT: ${JSON.stringify({ pass: false, failed: ['fatal'], error: String(err && err.message || err) })}\n`);
  process.exit(2);
});
