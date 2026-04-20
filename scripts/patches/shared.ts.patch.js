// scripts/patches/shared.ts.patch.js
// LOCAL MOD: add getWorkspaceWolfDir() + resolveWolfFile() to upstream shared.ts.
// Applied by scripts/fetch-openwolf.js after fetching raw source.

const MARKER = '// LOCAL MOD (claude-stack): dual-.wolf routing';

const ANCHOR = `export function getWolfDir(): string {
  // Prefer CLAUDE_PROJECT_DIR so hooks work even if CWD changes during a session
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  return path.join(projectDir, ".wolf");
}`;

const REPLACEMENT = `${MARKER}
// Config resolver: reads dashboard/data/openwolf-config.json written by setup.sh.
// Walks up from __dirname to locate the stack repo root (contains dashboard/data/).
function readStackConfig(): { workspace_wolf_parent: string; project_default: string } {
  let dir = (typeof __dirname !== "undefined") ? __dirname : process.cwd();
  for (let i = 0; i < 12; i++) {
    const cfg = path.join(dir, "dashboard", "data", "openwolf-config.json");
    if (fs.existsSync(cfg)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(cfg, "utf8"));
        if (parsed && parsed.workspace_wolf_parent && parsed.project_default) {
          return parsed;
        }
      } catch {}
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: cwd acts as both workspace and project (degenerate single-.wolf mode)
  return { workspace_wolf_parent: process.cwd(), project_default: process.cwd() };
}

export function getWorkspaceWolfDir(): string {
  return path.join(readStackConfig().workspace_wolf_parent, ".wolf");
}

export function getWolfDir(): string {
  // Prefer CLAUDE_PROJECT_DIR so hooks work even if CWD changes during a session
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  return path.join(projectDir, ".wolf");
}

// Walks project .wolf/ first, falls back to workspace .wolf/. Returns null if neither.
// ONLY use for files in the workspace-routed set:
// cerebrum.md, identity.md, OPENWOLF.md, buglog.json, config.json
export function resolveWolfFile(fileName: string): string | null {
  const projectPath = path.join(getWolfDir(), fileName);
  if (fs.existsSync(projectPath)) return projectPath;
  const workspacePath = path.join(getWorkspaceWolfDir(), fileName);
  if (fs.existsSync(workspacePath)) return workspacePath;
  return null;
}`;

function apply(content) {
  if (content.includes(MARKER)) return content; // idempotent
  if (!content.includes(ANCHOR)) {
    throw new Error('shared.ts patch anchor not found — upstream getWolfDir() signature changed');
  }
  return content.replace(ANCHOR, REPLACEMENT);
}

module.exports = { apply, MARKER };
