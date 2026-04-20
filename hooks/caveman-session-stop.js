#!/usr/bin/env node
// caveman-session-stop.js — Claude Code Stop hook
// Parses the session's transcript JSONL, extracts real output_tokens per
// assistant turn, writes ONE namespaced entry to dashboard/data/sessions.json.
// Schema v2 — see plan file for shape.
//
// Silent-fails on any error — hook must never crash the Claude session.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const readline = require('node:readline');

const SCHEMA_VERSION = 3;

function findRepoRoot() {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function readCurrentMode() {
  const flagPath = path.join(os.homedir(), '.claude', '.caveman-active');
  try {
    const st = fs.lstatSync(flagPath);
    if (st.isSymbolicLink() || !st.isFile() || st.size > 64) return null;
    const raw = fs.readFileSync(flagPath, 'utf8').trim().toLowerCase();
    const valid = ['off', 'lite', 'full', 'ultra',
      'wenyan-lite', 'wenyan', 'wenyan-full', 'wenyan-ultra',
      'commit', 'review', 'compress'];
    return valid.includes(raw) ? raw : null;
  } catch (_) {
    // Absent flag = /caveman off (mode-tracker unlinks the flag on 'off').
    return 'off';
  }
}

// Claude Code slugifies cwd → project dir name by replacing EACH non-alphanumeric
// character with a dash (no run collapse), then trimming leading/trailing dashes:
//   C:\projects\example app
//   → C--projects-example-app
// Note the double dash after "C" — `:` and `\` each contribute one dash.
function slugifyCwd(cwd) {
  if (!cwd) return null;
  return cwd.replace(/[^A-Za-z0-9]/g, '-').replace(/^-+|-+$/g, '');
}

function resolveTranscriptPath(stdinPayload) {
  if (stdinPayload?.transcript_path && fs.existsSync(stdinPayload.transcript_path)) {
    return stdinPayload.transcript_path;
  }
  const sid = stdinPayload?.session_id;
  const cwd = stdinPayload?.cwd || process.cwd();
  if (!sid) return null;
  const slug = slugifyCwd(cwd);
  if (!slug) return null;
  const candidate = path.join(os.homedir(), '.claude', 'projects', slug, `${sid}.jsonl`);
  return fs.existsSync(candidate) ? candidate : null;
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function parseTranscript(transcriptPath) {
  return new Promise(resolve => {
    const result = {
      output_tokens_total: 0,
      input_tokens_total: 0,
      cache_read_total: 0,
      assistant_turns: 0,
      per_turn_tokens: [],
      // prose vs tool_use char accounting for caveman-axis delta.
      // Caveman compresses prose only; tool_use (code in Edit/Write/Bash) is
      // preserved verbatim per SKILL.md. Split output_tokens_total by char
      // ratio to get honest prose-only jurisdiction measurement.
      prose_chars_total: 0,
      tool_use_chars_total: 0,
    };
    try {
      const stream = fs.createReadStream(transcriptPath, { encoding: 'utf8' });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
      rl.on('line', line => {
        if (!line.trim()) return;
        try {
          const obj = JSON.parse(line);
          if (obj?.type !== 'assistant') return;
          const usage = obj?.message?.usage;
          if (!usage) return;
          const out = Number(usage.output_tokens) || 0;
          const inp = Number(usage.input_tokens) || 0;
          const cr = Number(usage.cache_read_input_tokens) || 0;
          result.output_tokens_total += out;
          result.input_tokens_total += inp;
          result.cache_read_total += cr;
          result.assistant_turns += 1;
          result.per_turn_tokens.push(out);
          // Char accounting across content blocks.
          const content = obj?.message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block?.type === 'text' && typeof block.text === 'string') {
                result.prose_chars_total += block.text.length;
              } else if (block?.type === 'tool_use') {
                try {
                  result.tool_use_chars_total += JSON.stringify(block.input || {}).length;
                } catch (_) { /* circular etc. — skip */ }
              }
            }
          }
        } catch (_) { /* skip malformed line */ }
      });
      rl.on('close', () => resolve(result));
      rl.on('error', () => resolve(result));
    } catch (_) {
      resolve(result);
    }
  });
}

function appendEntry(sessionsPath, entry) {
  let arr = [];
  try {
    if (fs.existsSync(sessionsPath)) {
      const raw = fs.readFileSync(sessionsPath, 'utf8');
      if (raw.trim()) arr = JSON.parse(raw);
      if (!Array.isArray(arr)) arr = [];
    }
  } catch (_) { arr = []; }
  // Dedupe by session_id — Claude Code's Stop hook fires per assistant turn,
  // not per session. Replace existing entry so one session = one row.
  const sid = entry?._meta?.id;
  const idx = sid ? arr.findIndex(e => e?._meta?.id === sid) : -1;
  if (idx >= 0) arr[idx] = entry;
  else arr.push(entry);
  fs.mkdirSync(path.dirname(sessionsPath), { recursive: true });
  const tmp = sessionsPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(arr, null, 2), 'utf8');
  fs.renameSync(tmp, sessionsPath);
}

function readStdinJSON() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch (_) { return {}; }
}

async function main() {
  try {
    const repoRoot = findRepoRoot();
    if (!repoRoot) return;

    const sessionsPath = path.join(repoRoot, 'dashboard', 'data', 'sessions.json');
    const stdinPayload = readStdinJSON();
    const mode = readCurrentMode();
    const transcriptPath = resolveTranscriptPath(stdinPayload);

    let parsed = null;
    let method = 'unavailable';
    if (transcriptPath) {
      parsed = await parseTranscript(transcriptPath);
      method = parsed.assistant_turns > 0 ? 'transcript-parse' : 'unavailable';
    }

    const entry = {
      _meta: {
        id: stdinPayload.session_id || crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        phase: 2,
        transcript_path: transcriptPath || null,
        cwd: stdinPayload.cwd || null,
      },
      caveman: {
        mode: mode || 'unknown',
        active: mode !== null && mode !== 'off',
        measurement_method: method,
        schema_version: SCHEMA_VERSION,
        assistant_turns: parsed?.assistant_turns ?? null,
        output_tokens_total: parsed?.output_tokens_total ?? null,
        output_tokens_per_turn_median: parsed?.per_turn_tokens?.length
          ? median(parsed.per_turn_tokens)
          : null,
        input_tokens_total: parsed?.input_tokens_total ?? null,
        cache_read_total: parsed?.cache_read_total ?? null,
        // prose-axis fields.
        prose_chars_total: parsed?.prose_chars_total ?? null,
        tool_use_chars_total: parsed?.tool_use_chars_total ?? null,
        prose_ratio: (parsed && (parsed.prose_chars_total + parsed.tool_use_chars_total) > 0)
          ? +(parsed.prose_chars_total / (parsed.prose_chars_total + parsed.tool_use_chars_total)).toFixed(4)
          : null,
        prose_tokens_est: (parsed && (parsed.prose_chars_total + parsed.tool_use_chars_total) > 0)
          ? Math.round(parsed.output_tokens_total * (parsed.prose_chars_total / (parsed.prose_chars_total + parsed.tool_use_chars_total)))
          : null,
        tool_use_tokens_est: (parsed && (parsed.prose_chars_total + parsed.tool_use_chars_total) > 0)
          ? Math.round(parsed.output_tokens_total * (parsed.tool_use_chars_total / (parsed.prose_chars_total + parsed.tool_use_chars_total)))
          : null,
      },
    };

    appendEntry(sessionsPath, entry);
  } catch (_) {
    // Never throw — hook must not break Claude
  }
}

main();
