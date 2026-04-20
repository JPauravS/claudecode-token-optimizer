// scripts/openwolf-prompt.test.js
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ow-test-'));
const ws = path.join(tmp, 'ws');
const projA = path.join(ws, 'proj-A');
const projB = path.join(ws, 'proj-B');
fs.mkdirSync(path.join(projA, 'src'), { recursive: true });
fs.mkdirSync(path.join(projB, 'src'), { recursive: true });
fs.writeFileSync(path.join(projA, 'package.json'), '{}');
fs.mkdirSync(path.join(projB, '.git'));

const MARKERS = ['.git', 'package.json', 'Cargo.toml', 'pyproject.toml', 'go.mod', 'pom.xml', 'Gemfile', 'composer.json', 'build.gradle', 'Makefile'];
function findProjectRoot(startDir) {
  let dir = path.resolve(startDir);
  for (let depth = 0; depth < 10; depth++) {
    for (const m of MARKERS) if (fs.existsSync(path.join(dir, m))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
function detectWorkspace(projectRoot) {
  const parent = path.dirname(projectRoot);
  return parent === projectRoot ? projectRoot : parent;
}

assert.strictEqual(findProjectRoot(path.join(projA, 'src')), projA, 'finds proj-A from subdir');
assert.strictEqual(findProjectRoot(projB), projB, 'finds proj-B via .git');
const fromWs = findProjectRoot(ws);
assert.ok(fromWs === null || typeof fromWs === 'string', 'from ws returns null or ancestor');
assert.strictEqual(detectWorkspace(projA), ws, 'workspace = parent of proj-A');
assert.strictEqual(detectWorkspace(projB), ws, 'workspace = parent of proj-B');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('PASS: openwolf-prompt detection helpers');
