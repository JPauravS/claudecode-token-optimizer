// scripts/patches/status.ts.patch.js
// LOCAL MOD: make `openwolf status` dual-.wolf aware. For files that live in the
// workspace .wolf/ (cerebrum, buglog, token-ledger), resolve to whichever of
// workspace-.wolf or project-.wolf exists, so the existence check doesn't
// spuriously report "missing" after the dual-.wolf routing change.
//
// Approach: inject a small set of workspace-owned filenames + a resolver helper
// near the top of the module, then rewrite the existence-check anchor to use it.

const MARKER = 'LOCAL MOD (claude-stack): status dual-.wolf';

const HELPER_BLOCK = `
/* ${MARKER} */
import { getWorkspaceWolfDir as _getWorkspaceWolfDir } from "../hooks/shared.js";
const _WS_FILES = new Set(["cerebrum.md", "identity.md", "OPENWOLF.md", "buglog.json", "config.json"]);
function _resolveWolfPath(file: string, wolfDir: string): string {
  if (_WS_FILES.has(file)) {
    try {
      const wsPath = path.join(_getWorkspaceWolfDir(), file);
      if (fs.existsSync(wsPath)) return wsPath;
    } catch {}
  }
  return path.join(wolfDir, file);
}
`;

// Anchor: the bare `fs.existsSync(path.join(wolfDir, file))` inside the required-files loop.
const ANCHOR_RE = /fs\.existsSync\(\s*path\.join\(\s*wolfDir\s*,\s*file\s*\)\s*\)/;
const REPLACEMENT =
  `fs.existsSync(_resolveWolfPath(file, wolfDir)) /* ${MARKER} */`;

function ensureHelper(content) {
  // Guard against re-injection: check for the helper declaration itself,
  // not just the marker (the replacement site carries the marker too).
  if (content.includes('function _resolveWolfPath')) return content;
  // Insert helper block after the last `import ... from "...";` line.
  const importLines = [...content.matchAll(/^import\s.+from\s+["'][^"']+["'];?\s*$/gm)];
  if (importLines.length === 0) {
    return HELPER_BLOCK.trim() + '\n' + content;
  }
  const last = importLines[importLines.length - 1];
  const insertAt = last.index + last[0].length;
  return content.slice(0, insertAt) + '\n' + HELPER_BLOCK + content.slice(insertAt);
}

function apply(content) {
  if (content.includes(MARKER)) return content; // idempotent
  if (!ANCHOR_RE.test(content)) {
    throw new Error('status.ts patch anchor not found — upstream existence-check changed');
  }
  let patched = content.replace(ANCHOR_RE, REPLACEMENT);
  patched = ensureHelper(patched);
  if (!patched.includes(MARKER)) {
    throw new Error('status.ts patch applied but marker missing');
  }
  return patched;
}

module.exports = { apply, MARKER };
