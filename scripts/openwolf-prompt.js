#!/usr/bin/env node
// scripts/openwolf-prompt.js
// Auto-detect project root + workspace parent; prompt user to approve or override.
// Writes dashboard/data/openwolf-config.json. Skipped if config exists and --reconfigure absent.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline');

const REPO_ROOT = path.resolve(__dirname, '..');
const CFG_PATH = path.join(REPO_ROOT, 'dashboard', 'data', 'openwolf-config.json');
// truthy env-var checks so YES=1 / YES=true / YES=yes all work. Matches
// the setup.sh pattern of treating any non-empty, non-"0" value as enabled.
function envTrue(name) {
  const v = process.env[name];
  return v !== undefined && v !== '' && v !== '0' && v.toLowerCase() !== 'false';
}
const RECONFIGURE = process.argv.includes('--reconfigure');
const YES = process.argv.includes('--yes') || envTrue('YES');
const NON_INTERACTIVE = process.argv.includes('--non-interactive')
  || envTrue('NON_INTERACTIVE')
  || envTrue('CI');

// Project-root markers — matches upstream src/scanner/project-root.ts marker set
const MARKERS = ['.git', 'package.json', 'Cargo.toml', 'pyproject.toml', 'go.mod', 'pom.xml', 'Gemfile', 'composer.json', 'build.gradle', 'Makefile'];
const MAX_DEPTH = 10;

function log(msg) { process.stdout.write(`[openwolf-prompt] ${msg}\n`); }

function normalize(p) {
  if (!p) return p;
  const expanded = p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
  return path.resolve(expanded);
}

function findProjectRoot(startDir) {
  let dir = path.resolve(startDir);
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    for (const marker of MARKERS) {
      if (fs.existsSync(path.join(dir, marker))) return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function detectWorkspace(projectRoot) {
  const parent = path.dirname(projectRoot);
  if (parent === projectRoot) return projectRoot;
  let siblingProjectCount = 0;
  try {
    for (const name of fs.readdirSync(parent)) {
      const sub = path.join(parent, name);
      let stat;
      try { stat = fs.statSync(sub); } catch { continue; }
      if (!stat.isDirectory()) continue;
      if (MARKERS.some(m => fs.existsSync(path.join(sub, m)))) siblingProjectCount++;
      if (siblingProjectCount >= 2) break;
    }
  } catch {}
  return parent;
}

function confirmOrOverride(rl, label, detected) {
  return new Promise((resolve, reject) => {
    process.stdout.write(`\n${label}\n  detected: ${detected}\n  [Y]es / [n]o / or type an absolute path: `);

    rl.once('line', (raw) => {
      raw = raw.trim();
      if (raw === '' || raw.toLowerCase() === 'y' || raw.toLowerCase() === 'yes') {
        resolve(detected);
        return;
      }
      if (raw.toLowerCase() === 'n' || raw.toLowerCase() === 'no') {
        // the outer close listener below auto-accepts the detected
        // default on EOF. Once the user explicitly said 'n' we must drop
        // that auto-accept before arming the inner close handler, else EOF
        // after 'n' silently resolves with the value the user just rejected.
        //
        // re-arm a fresh close listener BEFORE awaiting the inner 'line'
        // so ctrl-C / EOF during the inner prompt rejects cleanly instead of
        // hanging the process (no listener → readline waits forever).
        rl.removeAllListeners('close');
        rl.once('close', () => {
          reject(new Error(`no path provided for ${label} (stdin closed)`));
        });
        process.stdout.write('  enter path: ');
        rl.once('line', (manual) => {
          manual = manual.trim();
          if (!manual) {
            reject(new Error(`no path provided for ${label}`));
          } else {
            resolve(normalize(manual));
          }
        });
        return;
      }
      resolve(normalize(raw));
    });

    rl.once('close', () => {
      resolve(detected); // Auto-accept on EOF
    });
  });
}

function validate(workspace, project) {
  if (!fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) {
    throw new Error(`workspace path does not exist or is not a directory: ${workspace}`);
  }
  if (!fs.existsSync(project) || !fs.statSync(project).isDirectory()) {
    throw new Error(`project path does not exist or is not a directory: ${project}`);
  }
  if (workspace === project) {
    throw new Error(`workspace and project must differ (got same: ${workspace})`);
  }
  const rel = path.relative(workspace, project);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`project (${project}) must be inside workspace (${workspace})`);
  }
}

async function main() {
  if (fs.existsSync(CFG_PATH) && !RECONFIGURE) {
    const existing = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
    log(`config exists (skip — use --reconfigure to re-detect):`);
    log(`  workspace_wolf_parent: ${existing.workspace_wolf_parent}`);
    log(`  project_default:       ${existing.project_default}`);
    return;
  }

  log('Configure dual .wolf/ locations (A-reduced model).');
  log('  workspace .wolf/  — shared: cerebrum, identity, OPENWOLF, buglog, config');
  log('  project .wolf/    — per-project: anatomy, memory, token-ledger');

  const cwd = process.cwd();
  const detectedProject = findProjectRoot(cwd) || cwd;
  if (!findProjectRoot(cwd)) {
    log(`WARN: no project marker file (${MARKERS.join(', ')}) found walking up from ${cwd}`);
    log(`      defaulting to cwd; you can override at the prompt.`);
  }
  const detectedWorkspace = detectWorkspace(detectedProject);

  // S6 + N5: honor --yes / --non-interactive / CI=1 — skip prompt, accept detected defaults.
  let project, workspace;
  if (YES || NON_INTERACTIVE) {
    log(`non-interactive: accepting detected defaults`);
    log(`  project:   ${detectedProject}`);
    log(`  workspace: ${detectedWorkspace}`);
    project = detectedProject;
    workspace = detectedWorkspace;
    validate(workspace, project);
  } else {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      project   = await confirmOrOverride(rl, 'Project root (where .wolf/ for this session lives):', detectedProject);
      workspace = await confirmOrOverride(rl, 'Workspace parent (shared .wolf/ for guidance across projects):', detectedWorkspace);
      validate(workspace, project);
    } finally {
      rl.close();
    }
  }

  const cfg = {
    schema_version: 1,
    workspace_wolf_parent: workspace,
    project_default: project,
    detected: {
      cwd_at_setup: cwd,
      auto_detected_project: detectedProject,
      auto_detected_workspace: detectedWorkspace,
      user_overrode_project: project !== detectedProject,
      user_overrode_workspace: workspace !== detectedWorkspace,
    },
    configured_at: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(CFG_PATH), { recursive: true });
  const tmp = CFG_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  fs.renameSync(tmp, CFG_PATH);
  log(`wrote ${CFG_PATH}`);
}

main().catch(err => {
  console.error(`[openwolf-prompt] ERROR: ${err.message}`);
  process.exit(1);
});
