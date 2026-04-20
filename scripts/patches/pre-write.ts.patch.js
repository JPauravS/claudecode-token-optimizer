// scripts/patches/pre-write.ts.patch.js
// LOCAL MOD: route cerebrum.md reads AND buglog.json reads from pre-write.ts
// to the workspace .wolf/ (single-source of truth for reflection + bug history).
// pre-write does only reads for these two files, so a join-site replace is sufficient.

const MARKER_CEREBRUM = 'LOCAL MOD (claude-stack): pre-write cerebrum → workspace';
const MARKER_BUGLOG = 'LOCAL MOD (claude-stack): pre-write buglog → workspace';
const MARKER_SCOPE = 'LOCAL MOD (claude-stack): pre-write project_origin scope';

// scope fileMatches by project_origin (workspace buglog now shared).
// Also extend the local BugEntry interface to include the field — pre-write.ts
// declares its own minimal copy, distinct from buglog/bug-tracker.ts BugEntry.
const BUGENTRY_ANCHOR = /interface BugEntry \{\n  id: string;\n  error_message: string;\n  root_cause: string;\n  fix: string;\n  file: string;\n  tags: string\[\];\n\}/;
const BUGENTRY_REPLACE =
  'interface BugEntry {\n  id: string;\n  error_message: string;\n  root_cause: string;\n  fix: string;\n  file: string;\n  tags: string[];\n  project_origin?: string; /* LOCAL MOD (claude-stack): pre-write project_origin scope */\n}';
const FILEMATCHES_ANCHOR = /const fileMatches = bugLog\.bugs\.filter\(b => \{\s*\n\s*const bugBasename = path\.basename\(b\.file\);\s*\n\s*return bugBasename === basename;\s*\n\s*\}\);/;
const FILEMATCHES_REPLACE =
  `const _claudeOrigin = process.env.CLAUDE_PROJECT_DIR || process.cwd(); /* LOCAL MOD (claude-stack): pre-write project_origin scope */
  const fileMatches = bugLog.bugs.filter(b => {
    const bugBasename = path.basename(b.file);
    if (bugBasename !== basename) return false;
    return !b.project_origin || b.project_origin === _claudeOrigin; /* LOCAL MOD (claude-stack): pre-write project_origin scope */
  });`;

// Single alternation regex covering both files. Preserves each file's own inline marker.
const ANCHOR_RE = /path\.join\(\s*wolfDir\s*,\s*["'](cerebrum\.md|buglog\.json)["']\s*\)/g;

const IMPORT_ADD_MARKER = '/* LOCAL MOD: getWorkspaceWolfDir */';

function replacement(fileName) {
  const marker = fileName === 'cerebrum.md' ? MARKER_CEREBRUM : MARKER_BUGLOG;
  return `path.join(getWorkspaceWolfDir(), "${fileName}") /* ${marker} */`;
}

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
  // if upstream ever drops the `.js` extension, changes path depth,
  // or switches to a default/namespace import, the replace above silently
  // no-ops and apply() emits a .ts that fails tsc with TS2304. Fail loud.
  if (patched === content) {
    throw new Error('pre-write.ts ensureImport: ./shared.js named-import anchor not found');
  }
  return patched;
}

function apply(content) {
  const alreadyWorkspace = content.includes(MARKER_CEREBRUM) || content.includes(MARKER_BUGLOG);
  const alreadyScope = content.includes(MARKER_SCOPE);
  if (alreadyWorkspace && alreadyScope) return content; // idempotent

  let patched = content;

  if (!alreadyWorkspace) {
    const matches = patched.match(ANCHOR_RE);
    if (!matches || matches.length === 0) {
      throw new Error('pre-write.ts patch anchor not found — upstream cerebrum/buglog path changed');
    }
    patched = patched.replace(ANCHOR_RE, (_m, fileName) => replacement(fileName));
    patched = ensureImport(patched);
    if (!patched.includes('pre-write cerebrum → workspace') &&
        !patched.includes('pre-write buglog → workspace')) {
      throw new Error('pre-write.ts patch applied but marker missing');
    }
  }

  if (!alreadyScope) {
    if (!BUGENTRY_ANCHOR.test(patched)) {
      throw new Error('pre-write.ts patch: BugEntry interface anchor not found');
    }
    if (!FILEMATCHES_ANCHOR.test(patched)) {
      throw new Error('pre-write.ts patch: fileMatches anchor not found');
    }
    patched = patched.replace(BUGENTRY_ANCHOR, BUGENTRY_REPLACE);
    patched = patched.replace(FILEMATCHES_ANCHOR, FILEMATCHES_REPLACE);
    if (!patched.includes(MARKER_SCOPE)) {
      throw new Error('pre-write.ts patch: scope marker missing after apply');
    }
  }

  return patched;
}

module.exports = { apply, MARKER_CEREBRUM, MARKER_BUGLOG, MARKER_SCOPE };
