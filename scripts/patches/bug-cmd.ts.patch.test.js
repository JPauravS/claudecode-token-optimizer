// scripts/patches/bug-cmd.ts.patch.test.js
const assert = require('node:assert');
const { apply } = require('./bug-cmd.ts.patch.js');

const fixture = `import * as fs from "node:fs";
import * as path from "node:path";
import { findProjectRoot } from "../scanner/project-root.js";
import { searchBugs } from "../buglog/bug-tracker.js";

export function bugSearch(term: string): void {
  const projectRoot = findProjectRoot();
  const wolfDir = path.join(projectRoot, ".wolf");

  if (!fs.existsSync(wolfDir)) {
    console.log("OpenWolf not initialized. Run: openwolf init");
    return;
  }
  const results = searchBugs(wolfDir, term);
}`;

const once = apply(fixture);

// wolfDir assignment replaced
assert.ok(once.includes('const wolfDir = getWorkspaceWolfDir();'),
  'wolfDir assigned via getWorkspaceWolfDir');
// old RHS gone
assert.ok(!/const\s+wolfDir\s*=\s*path\.join\(\s*projectRoot\s*,\s*["']\.wolf["']\s*\)/.test(once),
  'old path.join RHS removed');
// marker present
assert.ok(once.includes('bug-cmd → workspace'), 'marker present');
// provenance — searchBugs call gains 3rd arg
assert.ok(/searchBugs\(wolfDir, term, process\.env\.CLAUDE_PROJECT_DIR \|\| projectRoot\)/.test(once),
  'searchBugs call gains projectOrigin arg');
assert.ok(once.includes('bug-cmd project_origin'), 'provenance marker present');
// import injected
assert.ok(once.includes('import { getWorkspaceWolfDir } from "../hooks/shared.js"'),
  'shared.js import injected');

// Idempotent
const twice = apply(once);
assert.strictEqual(once, twice, 'idempotent');

// Verify import count = 1 after double apply
const imports = once.match(/import\s+\{\s*getWorkspaceWolfDir\s*\}/g) || [];
assert.strictEqual(imports.length, 1, 'single getWorkspaceWolfDir import');

// Anchor-not-found throws
assert.throws(() => apply('export function x() {}'), /anchor not found/);

console.log('PASS: bug-cmd.ts.patch.js');
