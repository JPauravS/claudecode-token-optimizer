// scripts/patches/status.ts.patch.test.js
const assert = require('node:assert');
const { apply } = require('./status.ts.patch.js');

const fixture = `import * as fs from "node:fs";
import * as path from "node:path";
import { findProjectRoot } from "../scanner/project-root.js";
import { readJSON, readText } from "../utils/fs-safe.js";

export async function statusCommand(): Promise<void> {
  const projectRoot = findProjectRoot();
  const wolfDir = path.join(projectRoot, ".wolf");

  const requiredFiles = ["cerebrum.md", "buglog.json", "memory.md"];
  for (const file of requiredFiles) {
    const exists = fs.existsSync(path.join(wolfDir, file));
    if (!exists) console.log("missing " + file);
  }
}`;

const once = apply(fixture);

// Anchor rewritten
assert.ok(once.includes('fs.existsSync(_resolveWolfPath(file, wolfDir))'),
  'existence check uses resolver');
// Helper block injected
assert.ok(once.includes('_WS_FILES'), 'helper set injected');
assert.ok(once.includes('function _resolveWolfPath'), 'helper function injected');
assert.ok(once.includes('_getWorkspaceWolfDir'), 'workspace import injected');
// Marker present
assert.ok(once.includes('status dual-.wolf'), 'marker present');

// Helper injected AFTER imports — the import line must appear before the helper.
const helperIdx = once.indexOf('_WS_FILES');
const lastImportMatch = [...once.matchAll(/^import\s.+from\s+["'][^"']+["'];?\s*$/gm)].pop();
assert.ok(lastImportMatch && lastImportMatch.index < helperIdx,
  'helper block positioned after imports');

// Idempotent
const twice = apply(once);
assert.strictEqual(once, twice, 'idempotent');

// Helper appears exactly once
const helperCount = (once.match(/function _resolveWolfPath/g) || []).length;
assert.strictEqual(helperCount, 1, 'helper defined once');

// Anchor-not-found throws
assert.throws(() => apply('export function x() {}'), /anchor not found/);

console.log('PASS: status.ts.patch.js');
