// scripts/patches/bug-cmd.ts.patch.js
// LOCAL MOD: route `openwolf bug <term>` CLI to read from workspace .wolf/
// instead of the project-local .wolf/. This module has no existing ./shared.js
// (or ../hooks/shared.js) import, so we inject a fresh import.

const MARKER = 'LOCAL MOD (claude-stack): bug-cmd → workspace';
const PROVENANCE_MARKER = 'LOCAL MOD (claude-stack): bug-cmd project_origin';

// Anchor: the wolfDir assignment line in bugSearch().
const ANCHOR_RE = /const\s+wolfDir\s*=\s*path\.join\(\s*projectRoot\s*,\s*["']\.wolf["']\s*\)\s*;/;
const REPLACEMENT =
  'const wolfDir = getWorkspaceWolfDir(); /* LOCAL MOD (claude-stack): bug-cmd → workspace */';

// pass CLAUDE_PROJECT_DIR || projectRoot as projectOrigin filter.
const SEARCH_CALL_ANCHOR = /searchBugs\(wolfDir,\s*term\)/;
const SEARCH_CALL_REPLACE =
  'searchBugs(wolfDir, term, process.env.CLAUDE_PROJECT_DIR || projectRoot) /* LOCAL MOD (claude-stack): bug-cmd project_origin */';

// Inject the shared helper import just after the last existing import line.
const IMPORT_LINE =
  'import { getWorkspaceWolfDir } from "../hooks/shared.js"; /* LOCAL MOD (claude-stack): bug-cmd → workspace */';

function ensureImport(content) {
  // Check specifically for an import-statement bringing getWorkspaceWolfDir in,
  // not just any occurrence (replacement-site also contains the name).
  if (/import\s+\{[^}]*getWorkspaceWolfDir[^}]*\}\s+from\s+["'][^"']+["']/.test(content)) {
    return content;
  }
  // Find last `import ... from "...";` and append after it.
  const importLines = [...content.matchAll(/^import\s.+from\s+["'][^"']+["'];?\s*$/gm)];
  if (importLines.length === 0) {
    // No imports at all — prepend at top.
    return IMPORT_LINE + '\n' + content;
  }
  const last = importLines[importLines.length - 1];
  const insertAt = last.index + last[0].length;
  return content.slice(0, insertAt) + '\n' + IMPORT_LINE + content.slice(insertAt);
}

function apply(content) {
  const alreadyWorkspace = content.includes(MARKER);
  const alreadyProvenance = content.includes(PROVENANCE_MARKER);
  if (alreadyWorkspace && alreadyProvenance) return content; // idempotent

  let patched = content;
  if (!alreadyWorkspace) {
    if (!ANCHOR_RE.test(patched)) {
      throw new Error('bug-cmd.ts patch anchor not found — upstream wolfDir assignment changed');
    }
    patched = patched.replace(ANCHOR_RE, REPLACEMENT);
    patched = ensureImport(patched);
    if (!patched.includes(MARKER)) {
      throw new Error('bug-cmd.ts patch applied but marker missing');
    }
  }

  if (!alreadyProvenance) {
    if (!SEARCH_CALL_ANCHOR.test(patched)) {
      throw new Error('bug-cmd.ts patch: searchBugs call anchor not found');
    }
    patched = patched.replace(SEARCH_CALL_ANCHOR, SEARCH_CALL_REPLACE);
    if (!patched.includes(PROVENANCE_MARKER)) {
      throw new Error('bug-cmd.ts provenance marker missing after patch');
    }
  }

  return patched;
}

module.exports = { apply, MARKER };
