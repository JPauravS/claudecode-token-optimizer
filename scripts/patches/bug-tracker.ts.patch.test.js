// scripts/patches/bug-tracker.ts.patch.test.js
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { apply } = require('./bug-tracker.ts.patch.js');

const fixture = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'hooks', 'openwolf', 'src', 'buglog', 'bug-tracker.ts'),
  'utf8'
);

const once = apply(fixture);

// Interface has project_origin?
assert.ok(/interface BugEntry \{[\s\S]*project_origin\?: string;/.test(once),
  'BugEntry gains project_origin?');

// logBug param type has project_origin?
assert.ok(/tags: string\[\];\n    project_origin\?: string;/.test(once),
  'logBug param type has project_origin?');

// push site includes project_origin
assert.ok(/last_seen: now,\n    project_origin: bug\.project_origin,/.test(once),
  'push site persists project_origin');

// dupe branch backfills project_origin
assert.ok(/if \(!existing\.project_origin && bug\.project_origin\)/.test(once),
  'dupe branch backfills project_origin');

// searchBugs gains third param + filter
assert.ok(/searchBugs\(wolfDir: string, term: string, projectOrigin\?: string/.test(once),
  'searchBugs signature extended');
assert.ok(/\.filter\(\(b\) => !projectOrigin \|\| !b\.project_origin \|\| b\.project_origin === projectOrigin/.test(once),
  'searchBugs body filters');

// findSimilarBugs scoped + logBug threads project_origin
assert.ok(/findSimilarBugs\(wolfDir: string, errorMessage: string, projectOrigin\?: string/.test(once),
  'findSimilarBugs signature extended');
assert.ok(/const _scopedBugs = projectOrigin \? bugLog\.bugs\.filter\(\(b\) => !b\.project_origin \|\| b\.project_origin === projectOrigin\) : bugLog\.bugs/.test(once),
  'findSimilarBugs filter shim present');
assert.ok(/for \(const bug of _scopedBugs\)/.test(once),
  'findSimilarBugs loop iterates _scopedBugs');
assert.ok(/findSimilarBugs\(wolfDir, bug\.error_message, bug\.project_origin\)/.test(once),
  'logBug call site threads bug.project_origin');
assert.ok(once.includes('bug-tracker findSimilar project_origin'),
  'findSimilar marker present');

// Idempotent
const twice = apply(once);
assert.strictEqual(once, twice, 'idempotent');

// Throws on missing anchor
assert.throws(() => apply('// unrelated content'), /anchor not found/);

console.log('bug-tracker.ts.patch.test.js: PASS');
