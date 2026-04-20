#!/usr/bin/env node
// Merges caveman + stop-hook entries into ~/.claude/settings.json.
// - Idempotent (skips entries already present by command substring)
// - Backs up original to settings.json.bak (only once — preserves oldest baseline)
// - Writes forward-slash paths so Git Bash + native Windows Claude Code both work
// - Atomic write via tmp + rename

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function arg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx > -1 ? process.argv[idx + 1] : null;
}

const SETTINGS = arg('settings') || path.join(os.homedir(), '.claude', 'settings.json');
const REPO    = arg('repo') || path.resolve(__dirname, '..');

const repoPosix = REPO.replace(/\\/g, '/');

// Claude Code hook schema:
//   events[event][] = { matcher: string, hooks: [ { type: "command", command: "..." } ] }
// matcher is empty string for events without a tool filter (SessionStart, Stop,
// UserPromptSubmit, etc.). PreToolUse/PostToolUse use e.g. "Read" or "Edit|Write".
function cavemanHookGroup(cmd) {
  return {
    matcher: '',
    hooks: [ { type: 'command', command: cmd } ],
  };
}

function openwolfHookGroup(matcher, cmdTail) {
  return {
    matcher,
    hooks: [{ type: 'command', command: `node "${repoPosix}/hooks/openwolf/src/hooks/${cmdTail}"`, timeout: 5 }],
  };
}

const DESIRED = {
  hooks: {
    SessionStart: [
      cavemanHookGroup(`node "${repoPosix}/hooks/caveman-activate.js"`),
      openwolfHookGroup('', 'session-start.js'),
    ],
    UserPromptSubmit: [
      cavemanHookGroup(`node "${repoPosix}/hooks/caveman-mode-tracker.js"`),
    ],
    PreToolUse: [
      openwolfHookGroup('Read', 'pre-read.js'),
      openwolfHookGroup('Write|Edit|MultiEdit', 'pre-write.js'),
    ],
    PostToolUse: [
      openwolfHookGroup('Read', 'post-read.js'),
      openwolfHookGroup('Write|Edit|MultiEdit', 'post-write.js'),
    ],
    Stop: [
      cavemanHookGroup(`node "${repoPosix}/hooks/caveman-session-stop.js"`),
      openwolfHookGroup('', 'stop.js'),
    ],
  },
  statusLine: {
    type: 'command',
    command: `bash "${repoPosix}/hooks/caveman-statusline.sh"`,
  },
};

// split markers by where they live in settings.json. HOOK_MARKERS appear
// under `settings.hooks[event][].hooks[].command`. STATUSLINE_MARKERS appear
// under `settings.statusLine.command`. Keeping these separate lets doctor.js
// read directly without hardcoded filters — less fragile across schema changes.
const HOOK_MARKERS = [
  'caveman-activate',
  'caveman-mode-tracker',
  'caveman-session-stop',
  'openwolf/src/hooks/session-start',
  'openwolf/src/hooks/pre-read',
  'openwolf/src/hooks/pre-write',
  'openwolf/src/hooks/post-read',
  'openwolf/src/hooks/post-write',
  'openwolf/src/hooks/stop',
];
const STATUSLINE_MARKERS = [
  'caveman-statusline',
];
// Combined list retained for backward-compat consumers (e.g., older doctor).
const MARKERS = [...HOOK_MARKERS, ...STATUSLINE_MARKERS];

function log(msg) { process.stdout.write(`[merge-settings] ${msg}\n`); }

function loadSettings() {
  if (!fs.existsSync(SETTINGS)) {
    log(`creating new ${SETTINGS}`);
    fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
    return {};
  }
  try {
    const raw = fs.readFileSync(SETTINGS, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (e) {
    throw new Error(`Could not parse ${SETTINGS}: ${e.message}`);
  }
}

function ensureArray(obj, key) {
  if (!Array.isArray(obj[key])) obj[key] = [];
  return obj[key];
}

function groupContainsMarker(group, marker) {
  if (!group || !Array.isArray(group.hooks)) return false;
  return group.hooks.some(h => typeof h?.command === 'string' && h.command.includes(marker));
}

function arrayContainsMarker(arr, marker) {
  return arr.some(g => groupContainsMarker(g, marker));
}

function firstCommand(group) {
  if (!group || !Array.isArray(group.hooks)) return '';
  const h = group.hooks.find(x => typeof x?.command === 'string');
  return h ? h.command : '';
}

function mergeHooks(existing, desired) {
  existing.hooks = existing.hooks || {};
  let added = 0;
  for (const event of Object.keys(desired.hooks)) {
    const arr = ensureArray(existing.hooks, event);
    for (const group of desired.hooks[event]) {
      const cmd = firstCommand(group);
      const marker = MARKERS.find(m => cmd.includes(m));
      if (marker && arrayContainsMarker(arr, marker)) {
        log(`  skip (already present): ${event} → ${marker}`);
        continue;
      }
      arr.push(group);
      added++;
      log(`  add:  ${event} → ${cmd}`);
    }
  }
  return added;
}

function mergeStatusLine(existing, desired) {
  if (existing.statusLine && typeof existing.statusLine === 'object') {
    if (typeof existing.statusLine.command === 'string' &&
        existing.statusLine.command.includes('caveman-statusline')) {
      log('  skip (already present): statusLine → caveman');
      return 0;
    }
    log(`  WARN: existing statusLine will be preserved (command: ${existing.statusLine.command}). Caveman statusline NOT installed.`);
    return 0;
  }
  existing.statusLine = desired.statusLine;
  log(`  add:  statusLine → ${desired.statusLine.command}`);
  return 1;
}

function backup(settings) {
  if (!fs.existsSync(SETTINGS)) return;
  const bak = SETTINGS + '.bak';
  if (!fs.existsSync(bak)) {
    fs.writeFileSync(bak, fs.readFileSync(SETTINGS, 'utf8'), 'utf8');
    log(`  backup: ${bak}`);
  } else {
    log('  backup: skipping (existing .bak preserved as oldest baseline)');
  }
}

function writeAtomic(obj) {
  const tmp = SETTINGS + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, SETTINGS);
}

// A1: dashboard-autostart (opt-in via --enable-autostart)
const AUTOSTART_MARKER = 'dashboard-autostart';
const AUTOSTART_GROUP = {
  matcher: '',
  hooks: [{ type: 'command', command: `node "${repoPosix}/hooks/dashboard-autostart.js"`, timeout: 3 }],
};

function enableAutostart(settings) {
  settings.hooks = settings.hooks || {};
  const arr = ensureArray(settings.hooks, 'SessionStart');
  if (arrayContainsMarker(arr, AUTOSTART_MARKER)) {
    log('  skip (already enabled): SessionStart → dashboard-autostart');
    return 0;
  }
  arr.push(AUTOSTART_GROUP);
  log('  add:  SessionStart → dashboard-autostart');
  return 1;
}

function disableAutostart(settings) {
  if (!settings.hooks || !Array.isArray(settings.hooks.SessionStart)) return 0;
  const before = settings.hooks.SessionStart.length;
  settings.hooks.SessionStart = settings.hooks.SessionStart.filter(g => !groupContainsMarker(g, AUTOSTART_MARKER));
  const removed = before - settings.hooks.SessionStart.length;
  if (removed) log(`  removed: SessionStart → dashboard-autostart (${removed})`);
  else log('  skip (not enabled): SessionStart → dashboard-autostart');
  return removed;
}

function main() {
  log(`settings: ${SETTINGS}`);
  log(`repo:     ${REPO}`);
  const settings = loadSettings();
  backup(settings);

  const enableAuto = process.argv.includes('--enable-autostart');
  const disableAuto = process.argv.includes('--disable-autostart');

  if (enableAuto || disableAuto) {
    const n = enableAuto ? enableAutostart(settings) : disableAutostart(settings);
    writeAtomic(settings);
    log(`Wrote ${SETTINGS}  (autostart ${enableAuto ? 'enabled' : 'disabled'}: ${n} change)`);
    return;
  }

  const hookAdds = mergeHooks(settings, DESIRED);
  const slAdds = mergeStatusLine(settings, DESIRED);
  writeAtomic(settings);
  log(`Wrote ${SETTINGS}  (hook entries added: ${hookAdds}, statusLine added: ${slAdds})`);
}

if (require.main === module) {
  main();
}

module.exports = { MARKERS, HOOK_MARKERS, STATUSLINE_MARKERS, DESIRED };
