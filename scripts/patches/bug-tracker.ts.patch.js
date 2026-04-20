// scripts/patches/bug-tracker.ts.patch.js
// LOCAL MOD (claude-stack): buglog project_origin provenance.
// - BugEntry gains optional project_origin field
// - logBug() accepts + persists project_origin on new + near-dup branches
// - searchBugs() accepts optional projectOrigin filter (grandfathers legacy entries w/o the field)

const MARKER = 'LOCAL MOD (claude-stack): buglog project_origin';
const MARKER_FIND = 'LOCAL MOD (claude-stack): bug-tracker findSimilar project_origin';

// scope findSimilarBugs by project_origin; thread bug.project_origin from logBug.
const FIND_SIG_ANCHOR = /export function findSimilarBugs\(wolfDir: string, errorMessage: string\): ScoredBug\[\] \{/;
const FIND_SIG_REPLACE =
  'export function findSimilarBugs(wolfDir: string, errorMessage: string, projectOrigin?: string /* LOCAL MOD (claude-stack): bug-tracker findSimilar project_origin */): ScoredBug[] {';

const FIND_FILTER_ANCHOR = /(const inputTokens = tokenize\(errorMessage\);\n)(  const results: ScoredBug\[\] = \[\];\n\n  for \(const bug of )bugLog\.bugs(\))/;
const FIND_FILTER_REPLACE =
  '$1  const _scopedBugs = projectOrigin ? bugLog.bugs.filter((b) => !b.project_origin || b.project_origin === projectOrigin) : bugLog.bugs; /* LOCAL MOD (claude-stack): bug-tracker findSimilar project_origin */\n$2_scopedBugs$3';

const LOGBUG_CALL_ANCHOR = /findSimilarBugs\(wolfDir, bug\.error_message\)/;
const LOGBUG_CALL_REPLACE =
  'findSimilarBugs(wolfDir, bug.error_message, bug.project_origin) /* LOCAL MOD (claude-stack): bug-tracker findSimilar project_origin */';

const INTERFACE_ANCHOR = /  occurrences: number;\n  last_seen: string;\n\}/;
const INTERFACE_REPLACE =
  '  occurrences: number;\n  last_seen: string;\n  project_origin?: string; /* LOCAL MOD (claude-stack): buglog project_origin */\n}';

const LOGBUG_SIG_ANCHOR = /    tags: string\[\];\n  \}\n\): void \{/;
const LOGBUG_SIG_REPLACE =
  '    tags: string[];\n    project_origin?: string; /* LOCAL MOD (claude-stack): buglog project_origin */\n  }\n): void {';

const PUSH_ANCHOR = /    occurrences: 1,\n    last_seen: now,\n  \}\);/;
const PUSH_REPLACE =
  '    occurrences: 1,\n    last_seen: now,\n    project_origin: bug.project_origin, /* LOCAL MOD (claude-stack): buglog project_origin */\n  });';

const DUPE_ANCHOR = /existing\.last_seen = now;\n      writeJSON\(getBugLogPath\(wolfDir\), bugLog\);/;
const DUPE_REPLACE =
  'existing.last_seen = now;\n      if (!existing.project_origin && bug.project_origin) existing.project_origin = bug.project_origin; /* LOCAL MOD (claude-stack): buglog project_origin */\n      writeJSON(getBugLogPath(wolfDir), bugLog);';

const SEARCH_ANCHOR = /export function searchBugs\(wolfDir: string, term: string\): BugEntry\[\] \{([\s\S]*?)      b\.file\.toLowerCase\(\)\.includes\(lower\)\n  \);\n\}/;
const SEARCH_REPLACE = (body) =>
  `export function searchBugs(wolfDir: string, term: string, projectOrigin?: string /* LOCAL MOD (claude-stack): buglog project_origin */): BugEntry[] {${body}      b.file.toLowerCase().includes(lower)\n  ).filter((b) => !projectOrigin || !b.project_origin || b.project_origin === projectOrigin /* LOCAL MOD (claude-stack): buglog project_origin */);\n}`;

function apply(content) {
  const alreadyProvenance = content.includes(MARKER);
  const alreadyFind = content.includes(MARKER_FIND);
  if (alreadyProvenance && alreadyFind) return content; // idempotent

  let patched = content;

  if (!alreadyProvenance) {
    if (!INTERFACE_ANCHOR.test(patched)) {
      throw new Error('bug-tracker.ts patch: BugEntry interface anchor not found — upstream schema changed');
    }
    if (!LOGBUG_SIG_ANCHOR.test(patched)) {
      throw new Error('bug-tracker.ts patch: logBug signature anchor not found');
    }
    if (!PUSH_ANCHOR.test(patched)) {
      throw new Error('bug-tracker.ts patch: bugs.push shape anchor not found');
    }
    if (!DUPE_ANCHOR.test(patched)) {
      throw new Error('bug-tracker.ts patch: recentDupe branch anchor not found');
    }
    if (!SEARCH_ANCHOR.test(patched)) {
      throw new Error('bug-tracker.ts patch: searchBugs anchor not found');
    }
    patched = patched.replace(INTERFACE_ANCHOR, INTERFACE_REPLACE);
    patched = patched.replace(LOGBUG_SIG_ANCHOR, LOGBUG_SIG_REPLACE);
    patched = patched.replace(PUSH_ANCHOR, PUSH_REPLACE);
    patched = patched.replace(DUPE_ANCHOR, DUPE_REPLACE);
    patched = patched.replace(SEARCH_ANCHOR, (_m, body) => SEARCH_REPLACE(body));
    if (!patched.includes(MARKER)) {
      throw new Error('bug-tracker.ts patch applied but marker missing');
    }
  }

  if (!alreadyFind) {
    if (!FIND_SIG_ANCHOR.test(patched)) {
      throw new Error('bug-tracker.ts patch: findSimilarBugs signature anchor not found');
    }
    if (!FIND_FILTER_ANCHOR.test(patched)) {
      throw new Error('bug-tracker.ts patch: findSimilarBugs filter anchor not found');
    }
    if (!LOGBUG_CALL_ANCHOR.test(patched)) {
      throw new Error('bug-tracker.ts patch: logBug findSimilarBugs call anchor not found');
    }
    patched = patched.replace(FIND_SIG_ANCHOR, FIND_SIG_REPLACE);
    patched = patched.replace(FIND_FILTER_ANCHOR, FIND_FILTER_REPLACE);
    patched = patched.replace(LOGBUG_CALL_ANCHOR, LOGBUG_CALL_REPLACE);
    if (!patched.includes(MARKER_FIND)) {
      throw new Error('bug-tracker.ts patch: findSimilar marker missing after apply');
    }
  }

  return patched;
}

module.exports = { apply, MARKER };
