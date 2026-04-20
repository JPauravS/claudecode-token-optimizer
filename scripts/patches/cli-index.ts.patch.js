// scripts/patches/cli-index.ts.patch.js
// LOCAL MOD (claude-stack): drop dashboard + designqc command registrations.
// We own the dashboard (port 3847); designqc is permanently dropped.
// Daemon + cron command groups stay — daemon-cmd.ts is pm2-based (harmless if
// unused); cron-cmd.ts falls back to direct CronEngine execution.

const MARKER = 'LOCAL MOD (claude-stack): cli-index stubs-removed';
const DAEMON_MARKER = 'cli-index stubs-removed — daemon command group dropped';

const DASHBOARD_IMPORT_ANCHOR = /\nimport \{ dashboardCommand \} from "\.\/dashboard\.js";/;
const DASHBOARD_CMD_ANCHOR = /\n  program\n    \.command\("dashboard"\)\n    \.description\("Open browser to dashboard"\)\n    \.action\(dashboardCommand\);\n/;
const DESIGNQC_BLOCK_ANCHOR = /\n  \/\/ --- Design QC command ---\n  program\n    \.command\("designqc \[target\]"\)[\s\S]*?\n    \}\);\n/;
// drop daemon command group (wolf-daemon.ts not vendored; pm2 spawn broken).
const DAEMON_BLOCK_ANCHOR = /\n  const daemon = program\n    \.command\("daemon"\)[\s\S]*?daemonLogs\(\);\n    \}\);\n/;

function apply(content) {
  const alreadyStubs = content.includes(MARKER);
  const alreadyDaemon = content.includes(DAEMON_MARKER);
  if (alreadyStubs && alreadyDaemon) return content; // idempotent

  let patched = content;

  if (!alreadyStubs) {
    if (!DASHBOARD_IMPORT_ANCHOR.test(patched)) {
      throw new Error('cli-index.ts patch: dashboard import anchor not found');
    }
    if (!DASHBOARD_CMD_ANCHOR.test(patched)) {
      throw new Error('cli-index.ts patch: dashboard .command block anchor not found');
    }
    if (!DESIGNQC_BLOCK_ANCHOR.test(patched)) {
      throw new Error('cli-index.ts patch: designqc block anchor not found');
    }
    patched = patched.replace(
      DASHBOARD_IMPORT_ANCHOR,
      '\n// LOCAL MOD (claude-stack): cli-index stubs-removed — dashboard import dropped'
    );
    patched = patched.replace(
      DASHBOARD_CMD_ANCHOR,
      '\n  /* LOCAL MOD (claude-stack): cli-index stubs-removed — dashboard subcommand dropped (use npm run dashboard) */\n'
    );
    patched = patched.replace(
      DESIGNQC_BLOCK_ANCHOR,
      '\n  /* LOCAL MOD (claude-stack): cli-index stubs-removed — designqc permanently dropped */\n'
    );
    if (!patched.includes(MARKER)) {
      throw new Error('cli-index.ts patch applied but marker missing');
    }
  }

  if (!alreadyDaemon) {
    if (!DAEMON_BLOCK_ANCHOR.test(patched)) {
      throw new Error('cli-index.ts patch: daemon command group anchor not found');
    }
    patched = patched.replace(
      DAEMON_BLOCK_ANCHOR,
      '\n  /* LOCAL MOD (claude-stack): cli-index stubs-removed — daemon command group dropped (wolf-daemon.ts not vendored; pm2 spawn broken) */\n'
    );
    if (!patched.includes(DAEMON_MARKER)) {
      throw new Error('cli-index.ts patch: daemon marker missing after apply');
    }
  }

  return patched;
}

module.exports = { apply, MARKER };
