// scripts/patches/post-write.ts.patch.js
// LOCAL MOD: route buglog.json reads AND writes from post-write.ts to workspace.
// Rationale: both read + write go to same target, so simple join-site replace suffices.

const MARKER = 'LOCAL MOD (claude-stack): buglog → workspace';
const PROVENANCE_MARKER = 'LOCAL MOD (claude-stack): buglog project_origin';
const ANCHOR_RE = /path\.join\(\s*wolfDir\s*,\s*["']buglog\.json["']\s*\)/g;
const REPLACEMENT = 'path.join(getWorkspaceWolfDir(), "buglog.json") /* LOCAL MOD (claude-stack): buglog → workspace */';
const IMPORT_ADD_MARKER = '/* LOCAL MOD: getWorkspaceWolfDir */';

// project_origin provenance on auto-detected bugs.
const PUSH_ANCHOR = /    occurrences: 1,\n    last_seen: new Date\(\)\.toISOString\(\),\n  \}\);/;
const PUSH_REPLACE =
  '    occurrences: 1,\n    last_seen: new Date().toISOString(),\n    project_origin: process.env.CLAUDE_PROJECT_DIR || projectRoot, /* LOCAL MOD (claude-stack): buglog project_origin */\n  } as any);';

const DUPE_ANCHOR = /    recentDupe\.last_seen = new Date\(\)\.toISOString\(\);/;
const DUPE_REPLACE =
  '    recentDupe.last_seen = new Date().toISOString();\n    if (!(recentDupe as any).project_origin) (recentDupe as any).project_origin = process.env.CLAUDE_PROJECT_DIR || projectRoot; /* LOCAL MOD (claude-stack): buglog project_origin */';

function ensureImport(content) {
  const importMatch = content.match(/import\s+\{[^}]*\}\s+from\s+["']\.\/shared\.js["']/);
  if (importMatch && importMatch[0].includes('getWorkspaceWolfDir')) return content;
  const patched = content.replace(
    /import\s+\{\s*([^}]*)\}\s+from\s+["']\.\/shared\.js["']/,
    (m, inner) => {
      if (inner.includes('getWorkspaceWolfDir')) return m;
      const cleaned = inner.trim().replace(/,\s*$/, '');
      return `import { ${cleaned}, getWorkspaceWolfDir ${IMPORT_ADD_MARKER} } from "./shared.js"`;
    }
  );
  // fail loud if upstream import shape drifts (see pre-write.ts.patch.js).
  if (patched === content) {
    throw new Error('post-write.ts ensureImport: ./shared.js named-import anchor not found');
  }
  return patched;
}

function apply(content) {
  const alreadyWorkspace = content.includes(MARKER);
  const alreadyProvenance = content.includes(PROVENANCE_MARKER);
  if (alreadyWorkspace && alreadyProvenance) return content; // idempotent

  let patched = content;
  if (!alreadyWorkspace) {
    const matches = patched.match(ANCHOR_RE);
    if (!matches || matches.length === 0) {
      throw new Error('post-write.ts patch anchor not found — upstream buglog path changed');
    }
    patched = patched.replace(ANCHOR_RE, REPLACEMENT);
    patched = ensureImport(patched);
    if (!patched.includes('buglog → workspace')) {
      throw new Error('post-write.ts patch applied but marker missing');
    }
  }

  if (!alreadyProvenance) {
    if (!PUSH_ANCHOR.test(patched)) {
      throw new Error('post-write.ts patch: auto-detect push anchor not found');
    }
    if (!DUPE_ANCHOR.test(patched)) {
      throw new Error('post-write.ts patch: auto-detect recentDupe anchor not found');
    }
    patched = patched.replace(PUSH_ANCHOR, PUSH_REPLACE);
    patched = patched.replace(DUPE_ANCHOR, DUPE_REPLACE);
    if (!patched.includes(PROVENANCE_MARKER)) {
      throw new Error('post-write.ts provenance marker missing after patch');
    }
  }

  return patched;
}

module.exports = { apply, MARKER };
