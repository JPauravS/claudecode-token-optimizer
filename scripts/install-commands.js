#!/usr/bin/env node
// Installs/uninstalls ~/.claude/commands/{caveman,openwolf}.md (global slash commands).
// Source-of-truth bodies live at assets/{caveman,openwolf}-command.md.
// Idempotent:
//   install   — write only if missing; no-op if already our body.
//   uninstall — delete only if body matches ours (don't clobber user edits).

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const REPO_ROOT = path.resolve(__dirname, '..');
const COMMANDS_DIR = path.join(os.homedir(), '.claude', 'commands');

// List of commands to install/uninstall.
const COMMANDS = [
  { asset: 'caveman-command.md', target: 'caveman.md' },
  { asset: 'openwolf-command.md', target: 'openwolf.md' },
];

function log(m) { process.stdout.write(`[install-commands] ${m}\n`); }

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function ourBody(assetName) {
  const source = path.join(REPO_ROOT, 'assets', assetName);
  return fs.readFileSync(source, 'utf8');
}

function install() {
  fs.mkdirSync(COMMANDS_DIR, { recursive: true });

  for (const cmd of COMMANDS) {
    const target = path.join(COMMANDS_DIR, cmd.target);
    const body = ourBody(cmd.asset);

    if (fs.existsSync(target)) {
      const existing = fs.readFileSync(target, 'utf8');
      if (existing === body) {
        log(`already installed (unchanged): ${target}`);
        continue;
      }
      if (sha256(existing) === sha256(body)) {
        log(`already installed (matching hash): ${target}`);
        continue;
      }
      log(`WARN: ${target} exists with different content — preserving user version`);
      continue;
    }

    fs.writeFileSync(target, body, 'utf8');
    log(`installed: ${target}`);
  }
}

function uninstall() {
  for (const cmd of COMMANDS) {
    const target = path.join(COMMANDS_DIR, cmd.target);

    if (!fs.existsSync(target)) {
      log(`not present: ${target}`);
      continue;
    }

    const body = ourBody(cmd.asset);
    const existing = fs.readFileSync(target, 'utf8');
    if (existing !== body) {
      log(`WARN: ${target} has been modified — leaving in place`);
      continue;
    }

    fs.unlinkSync(target);
    log(`removed: ${target}`);
  }
}

function main() {
  const cmd = process.argv[2];
  if (cmd === 'install') { install(); return; }
  if (cmd === 'uninstall') { uninstall(); return; }
  process.stderr.write('Usage: install-commands.js <install|uninstall>\n');
  process.exit(2);
}

main();
