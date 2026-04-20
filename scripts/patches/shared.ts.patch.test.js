// scripts/patches/shared.ts.patch.test.js
const assert = require('node:assert');
const { apply } = require('./shared.ts.patch.js');

const fixture = `import path from "node:path";
import fs from "node:fs";

export function getWolfDir(): string {
  // Prefer CLAUDE_PROJECT_DIR so hooks work even if CWD changes during a session
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  return path.join(projectDir, ".wolf");
}

export function ensureWolfDir(): void { /* ... */ }`;

// First apply injects
const once = apply(fixture);
assert.ok(once.includes('getWorkspaceWolfDir'), 'exports getWorkspaceWolfDir');
assert.ok(once.includes('resolveWolfFile'), 'exports resolveWolfFile');
assert.ok(once.includes('LOCAL MOD (claude-stack): dual-.wolf routing'), 'marker present');

// Idempotent — re-apply is no-op
const twice = apply(once);
assert.strictEqual(once, twice, 'patch idempotent');

// Anchor-missing must throw
assert.throws(() => apply('export function something(): void {}'),
  /anchor not found/, 'throws on missing anchor');

console.log('PASS: shared.ts.patch.js');
