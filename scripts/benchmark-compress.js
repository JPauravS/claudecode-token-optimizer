#!/usr/bin/env node
// Wraps vendored skills/caveman-compress/scripts/benchmark.py.
// Usage:
//   node scripts/benchmark-compress.js <original.md> <compressed.md>
//   npm run benchmark:compress -- <original.md> <compressed.md>
//
// Appends result entry to dashboard/data/compress-benchmarks.json.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const BENCHMARK_PY = path.join(REPO_ROOT, 'skills', 'caveman-compress', 'scripts', 'benchmark.py');
const DATA_FILE = path.join(REPO_ROOT, 'dashboard', 'data', 'compress-benchmarks.json');

function log(m) { process.stdout.write(`[benchmark-compress] ${m}\n`); }
function err(m) { process.stderr.write(`[benchmark-compress] ${m}\n`); }

function pickPython() {
  for (const cmd of ['py', 'python3', 'python']) {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
    if (r.status === 0) return cmd;
  }
  return null;
}

// Parse the markdown table benchmark.py prints:
//   | File | Original | Compressed | Saved % | Valid |
//   |------|----------|------------|---------|-------|
//   | foo.md | 200 | 100 | 50.0% | ✅ |
function parseMarkdownTable(stdout) {
  const lines = stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const rows = [];
  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    if (/^\|[-: |]+\|$/.test(line)) continue;     // separator row
    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length < 5) continue;
    if (/^file$/i.test(cells[0])) continue;       // header
    const [file, origStr, compStr, savedStr, validStr] = cells;
    const original_tokens = parseInt(origStr, 10);
    const compressed_tokens = parseInt(compStr, 10);
    const saved_pct = parseFloat(savedStr.replace('%', ''));
    const valid = /✅|true|yes|ok/i.test(validStr);
    if (!Number.isNaN(original_tokens) && !Number.isNaN(compressed_tokens)) {
      rows.push({ file, original_tokens, compressed_tokens, saved_pct, valid });
    }
  }
  return rows;
}

function appendEntry(entry) {
  let arr = [];
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      if (raw.trim()) arr = JSON.parse(raw);
      if (!Array.isArray(arr)) arr = [];
    }
  } catch (_) { arr = []; }
  arr.push(entry);
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(arr, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2) {
    err('Usage: benchmark-compress.js <original.md> <compressed.md>');
    process.exit(2);
  }
  const [origArg, compArg] = args;
  const origPath = path.resolve(origArg);
  const compPath = path.resolve(compArg);

  if (!fs.existsSync(origPath)) { err(`not found: ${origPath}`); process.exit(2); }
  if (!fs.existsSync(compPath)) { err(`not found: ${compPath}`); process.exit(2); }
  if (!fs.existsSync(BENCHMARK_PY)) { err(`missing benchmark.py: ${BENCHMARK_PY}`); process.exit(2); }

  const py = pickPython();
  if (!py) { err('no python interpreter found (tried py, python3, python)'); process.exit(2); }

  log(`${py} ${BENCHMARK_PY} ${origPath} ${compPath}`);
  const run = spawnSync(py, [BENCHMARK_PY, origPath, compPath], {
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  if (run.status !== 0) {
    err(`benchmark.py exited ${run.status}`);
    if (run.stderr) err(run.stderr.trim());
    if (run.stdout) err(run.stdout.trim());
    process.exit(run.status || 1);
  }

  const stdout = run.stdout || '';
  const rows = parseMarkdownTable(stdout);

  const entry = {
    _meta: {
      timestamp: new Date().toISOString(),
      original_path: origPath,
      compressed_path: compPath,
      python: py,
    },
    result: { rows, raw_stdout: stdout.trim() },
  };
  appendEntry(entry);

  log('Result:');
  process.stdout.write(stdout);
  log(`Recorded to ${DATA_FILE}`);
}

main();
