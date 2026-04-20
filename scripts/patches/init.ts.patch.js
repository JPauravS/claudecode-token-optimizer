// scripts/patches/init.ts.patch.js
// LOCAL MOD: remove designqc + reframe references from upstream init.ts.
// Scope-bounded because our openwolf-init.js replaces most of upstream init's role;
// we still patch init.ts in case it's invoked via the CLI bin for project-level init.

const MARKER = '// LOCAL MOD (claude-stack): dropped designqc/reframe';

// Patch strategy: neutralize lines that reference the dropped files.
// These exact patterns are confirmed in upstream 2026-03-20 init.ts.
const NEUTRALIZATIONS = [
  { pattern: /^\s*["']reframe-frameworks\.md["']\s*,?\s*$/m,       replace: `// ${MARKER}: removed "reframe-frameworks.md"` },
  { pattern: /^\s*["']designqc-report\.json["']\s*,?\s*$/m,        replace: `// ${MARKER}: removed "designqc-report.json"` },
  // Also strip any import of reframe or designqc templates
  { pattern: /^\s*import\s+.*reframe.*$/mi,                        replace: `// ${MARKER}: removed reframe import` },
  { pattern: /^\s*import\s+.*designqc.*$/mi,                       replace: `// ${MARKER}: removed designqc import` },
];

function apply(content) {
  if (content.includes(MARKER)) return content;
  let changed = false;
  let out = content;
  for (const { pattern, replace } of NEUTRALIZATIONS) {
    if (pattern.test(out)) {
      out = out.replace(pattern, replace);
      changed = true;
    }
  }
  if (!changed) {
    // Not fatal — upstream may have already restructured. Log but don't throw.
    // fetch-openwolf.js will surface a warning.
    console.warn('[init.ts.patch] no neutralization targets matched — verify upstream init.ts');
  }
  // Always annotate with marker at top for idempotency signal
  return `// ${MARKER}\n${out}`;
}

module.exports = { apply, MARKER };
