#!/usr/bin/env node
// Claude Stack dashboard server —
// Bound to 127.0.0.1:3847 (no LAN exposure). PID written to data/dashboard.pid.

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const PORT = 3847;
const HOST = '127.0.0.1';
const REPO_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSIONS_PATH = path.join(DATA_DIR, 'sessions.json');
const COMPRESS_PATH = path.join(DATA_DIR, 'compress-benchmarks.json');
const PID_PATH = path.join(DATA_DIR, 'dashboard.pid');

const MIN_SESSIONS_PER_MODE = 2;
const MIN_TURNS_PER_MODE = 5;
const CONFIDENT_SESSIONS = 3;
const CONFIDENT_TURNS = 10;

function readJson(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback;
    const raw = fs.readFileSync(p, 'utf8');
    if (!raw.trim()) return fallback;
    const v = JSON.parse(raw);
    return v;
  } catch (_) { return fallback; }
}

function writeJson(p, v) {
  fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
}

// auto-discover every sibling under workspace_wolf_parent with a
// seeded .wolf/token-ledger.json. Result sorted by mtime desc — most recently
// touched project first (= natural "active" default).
function discoverProjects(cfg) {
  const parent = cfg && cfg.workspace_wolf_parent;
  if (!parent || !fs.existsSync(parent)) return [];
  const out = [];
  for (const name of fs.readdirSync(parent)) {
    const projectPath = path.join(parent, name);
    let stat;
    try { stat = fs.statSync(projectPath); } catch { continue; }
    if (!stat.isDirectory()) continue;
    const wolfDir = path.join(projectPath, '.wolf');
    const ledger = path.join(wolfDir, 'token-ledger.json');
    if (!fs.existsSync(ledger)) continue;
    let lastTouch = 0;
    try { lastTouch = fs.statSync(ledger).mtimeMs; } catch {}
    out.push({ path: projectPath, label: name, wolf_dir: wolfDir, last_touch_ms: lastTouch });
  }
  out.sort((a, b) => b.last_touch_ms - a.last_touch_ms);
  return out;
}

// schema v1 → v2 migration. Adds projects[] overlay, preserving
// current Combine GitRepo cron behavior. Idempotent.
function migrateConfigSchema(cfgPath) {
  if (!fs.existsSync(cfgPath)) return null;
  const cfg = readJson(cfgPath, null);
  if (!cfg) return null;
  if ((cfg.schema_version || 0) >= 2 && Array.isArray(cfg.projects)) return cfg;
  cfg.schema_version = 2;
  if (!Array.isArray(cfg.projects)) {
    cfg.projects = cfg.project_default
      ? [{ path: cfg.project_default, cron_enabled: true }]
      : [];
  }
  try { writeJson(cfgPath, cfg); } catch (_) {}
  return cfg;
}

// active-project resolver with path-traversal guard. `?project=`
// must exact-match a discovered path. Mismatch → silent fallback to the
// most-recently-touched project (or project_default when discovery empty).
function getActiveProject(req, cfg) {
  const discovered = discoverProjects(cfg);
  const fallback = cfg.project_default || (discovered[0] && discovered[0].path) || cfg.workspace_wolf_parent;
  if (discovered.length === 0) return fallback;
  const requested = req && req.query && req.query.project;
  if (requested) {
    const normalized = path.resolve(String(requested));
    const match = discovered.find(p => path.resolve(p.path) === normalized);
    if (match) return match.path;
    // Silent fallback — prevents traversal via ?project=../../etc.
  }
  return discovered[0].path;
}

// read projects[] overlay, merge with auto-discovery. Overlay
// provides cron_enabled; discovery provides last_touch + label defaults.
function mergedProjects(cfg) {
  const discovered = discoverProjects(cfg);
  const overlay = Array.isArray(cfg.projects) ? cfg.projects : [];
  const byPath = new Map();
  for (const d of discovered) {
    byPath.set(path.resolve(d.path), { ...d, cron_enabled: false, registered: false });
  }
  for (const o of overlay) {
    if (!o || !o.path) continue;
    const key = path.resolve(o.path);
    const existing = byPath.get(key) || {
      path: o.path,
      label: path.basename(o.path),
      wolf_dir: path.join(o.path, '.wolf'),
      last_touch_ms: 0,
    };
    existing.cron_enabled = !!o.cron_enabled;
    existing.registered = true;
    byPath.set(key, existing);
  }
  return Array.from(byPath.values()).sort((a, b) => b.last_touch_ms - a.last_touch_ms);
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function summarizeCaveman(sessions) {
  const total_sessions = sessions.length;
  const v2 = sessions.filter(s =>
    s?.caveman?.schema_version >= 2 &&
    s?.caveman?.measurement_method === 'transcript-parse' &&
    typeof s?.caveman?.output_tokens_total === 'number'
  );

  const mode_breakdown = {};
  for (const s of sessions) {
    const m = s?.caveman?.mode || 'unknown';
    mode_breakdown[m] = (mode_breakdown[m] || 0) + 1;
  }

  let output_tokens_total_all_time = 0;
  let assistant_turns_all_time = 0;
  const byMode = {};   // mode -> { sessions: [], turnsTotal, perSessionMedians: [] }

  for (const s of v2) {
    const c = s.caveman;
    output_tokens_total_all_time += c.output_tokens_total || 0;
    assistant_turns_all_time += c.assistant_turns || 0;
    const mode = c.mode || 'unknown';
    if (!byMode[mode]) byMode[mode] = { sessions: 0, turns: 0, perSessionMedians: [] };
    byMode[mode].sessions += 1;
    byMode[mode].turns += c.assistant_turns || 0;
    if (typeof c.output_tokens_per_turn_median === 'number' && c.assistant_turns > 0) {
      byMode[mode].perSessionMedians.push(c.output_tokens_per_turn_median);
    }
  }

  // Pool output tokens per mode for turn-weighted mean.
  // also pool prose_tokens_est (v3 only) — caveman's true
  // jurisdiction. v2 sessions without prose fields excluded from prose pool.
  const poolByMode = {};
  const prosePoolByMode = {};
  for (const s of v2) {
    const c = s.caveman;
    const mode = c.mode || 'unknown';
    if (!poolByMode[mode]) poolByMode[mode] = { turns: 0, output: 0 };
    poolByMode[mode].turns += c.assistant_turns || 0;
    poolByMode[mode].output += c.output_tokens_total || 0;
    // Prose pool: only v3 sessions with populated prose_tokens_est.
    if (c.schema_version >= 3 && typeof c.prose_tokens_est === 'number') {
      if (!prosePoolByMode[mode]) prosePoolByMode[mode] = { turns: 0, prose: 0, tool: 0, sessions: 0 };
      prosePoolByMode[mode].turns += c.assistant_turns || 0;
      prosePoolByMode[mode].prose += c.prose_tokens_est;
      prosePoolByMode[mode].tool += c.tool_use_tokens_est || 0;
      prosePoolByMode[mode].sessions += 1;
    }
  }

  const tokens_per_turn_by_mode = {};
  for (const [mode, d] of Object.entries(byMode)) {
    const pool = poolByMode[mode] || { turns: 0, output: 0 };
    const prose = prosePoolByMode[mode] || { turns: 0, prose: 0, tool: 0, sessions: 0 };
    tokens_per_turn_by_mode[mode] = {
      median: Math.round(median(d.perSessionMedians)),
      pooled_mean: pool.turns > 0 ? Math.round(pool.output / pool.turns) : 0,
      prose_pooled_mean: prose.turns > 0 ? Math.round(prose.prose / prose.turns) : 0,
      tool_pooled_mean: prose.turns > 0 ? Math.round(prose.tool / prose.turns) : 0,
      prose_sessions: prose.sessions,
      prose_ratio_avg: prose.sessions > 0 && (prose.prose + prose.tool) > 0
        ? +(prose.prose / (prose.prose + prose.tool)).toFixed(4) : 0,
      sessions: d.sessions,
      turns: d.turns,
    };
  }

  // Observed delta vs off — tiered confidence.
  // Uses BOTH median-of-medians (legacy) and turn-weighted pooled mean (new
  // primary). Mismatch flag set when they disagree — signals statistical
  // artifact or content confound (tool_use tokens dominate).
  const observed_delta_pct = { lite_vs_off: null, full_vs_off: null, ultra_vs_off: null };
  const observed_delta_pct_pooled = { lite_vs_off: null, full_vs_off: null, ultra_vs_off: null };
  const observed_delta_pct_prose = { lite_vs_off: null, full_vs_off: null, ultra_vs_off: null };
  const confidence_tier = { lite_vs_off: null, full_vs_off: null, ultra_vs_off: null };
  const metric_mismatch = { lite_vs_off: false, full_vs_off: false, ultra_vs_off: false };
  const off = tokens_per_turn_by_mode.off;
  const tier = d => {
    if (!d || d.median <= 0) return 'insufficient_data';
    if (d.sessions >= CONFIDENT_SESSIONS && d.turns >= CONFIDENT_TURNS) return 'confident';
    if (d.sessions >= MIN_SESSIONS_PER_MODE && d.turns >= MIN_TURNS_PER_MODE) return 'preliminary';
    return 'insufficient_data';
  };
  const offTier = tier(off);
  if (offTier !== 'insufficient_data') {
    for (const m of ['lite', 'full', 'ultra']) {
      const cur = tokens_per_turn_by_mode[m];
      const curTier = tier(cur);
      if (curTier !== 'insufficient_data') {
        const momDelta = +(((off.median - cur.median) / off.median) * 100).toFixed(1);
        observed_delta_pct[`${m}_vs_off`] = momDelta;
        if (off.pooled_mean > 0 && cur.pooled_mean > 0) {
          const poolDelta = +(((off.pooled_mean - cur.pooled_mean) / off.pooled_mean) * 100).toFixed(1);
          observed_delta_pct_pooled[`${m}_vs_off`] = poolDelta;
          // Flag mismatch when pooled + MoM disagree by > 15pp — methodology
          // artifact (usually small-n median coincidence) or content confound.
          if (Math.abs(momDelta - poolDelta) > 15) {
            metric_mismatch[`${m}_vs_off`] = true;
          }
        }
        // prose-only delta — caveman's actual scorecard.
        if (off.prose_pooled_mean > 0 && cur.prose_pooled_mean > 0) {
          const proseDelta = +(((off.prose_pooled_mean - cur.prose_pooled_mean) / off.prose_pooled_mean) * 100).toFixed(1);
          observed_delta_pct_prose[`${m}_vs_off`] = proseDelta;
        }
        // Pair tier = weaker of the two.
        confidence_tier[`${m}_vs_off`] = (offTier === 'confident' && curTier === 'confident') ? 'confident' : 'preliminary';
      }
    }
  }

  // sessions[] preserves first-appearance order due to
  // dedupe-by-session_id in caveman-session-stop.js (in-place replace
  // at the original index). Tail is not the latest timestamp under
  // concurrent sessions — scan for the max instead.
  const last_session = sessions.reduce((max, s) => {
    const t = s?._meta?.timestamp;
    return t && (!max || t > max) ? t : max;
  }, null);

  return {
    total_sessions,
    measurement_method: 'transcript-parse',
    mode_breakdown,
    output_tokens_total_all_time,
    assistant_turns_all_time,
    tokens_per_turn_by_mode,
    observed_delta_pct,
    observed_delta_pct_pooled,
    observed_delta_pct_prose,
    metric_mismatch,
    confidence_tier,
    min_sessions_per_mode_for_delta: MIN_SESSIONS_PER_MODE,
    min_turns_per_mode_for_delta: MIN_TURNS_PER_MODE,
    confident_sessions_per_mode: CONFIDENT_SESSIONS,
    confident_turns_per_mode: CONFIDENT_TURNS,
    last_session,
  };
}

function summarizeCompress(entries) {
  if (!entries.length) {
    return { total_runs: 0, total_original_tokens: 0, total_compressed_tokens: 0, avg_savings_pct: 0, recent: [] };
  }
  let orig = 0, comp = 0, sum = 0, n = 0;
  for (const e of entries) {
    const r = e?.result;
    if (!r) continue;
    // r.rows is an array of { file, original_tokens, compressed_tokens, saved_pct, valid }
    const rows = r.rows || [];
    for (const row of rows) {
      orig += row.original_tokens || 0;
      comp += row.compressed_tokens || 0;
      if (typeof row.saved_pct === 'number') { sum += row.saved_pct; n += 1; }
    }
  }
  return {
    total_runs: entries.length,
    total_original_tokens: orig,
    total_compressed_tokens: comp,
    avg_savings_pct: n ? +(sum / n).toFixed(1) : 0,
    recent: entries.slice(-20),
  };
}

function summarizeOpenwolf(activeProjectOverride) {
  const cfgPath = path.join(DATA_DIR, 'openwolf-config.json');
  if (!fs.existsSync(cfgPath)) {
    return { configured: false };
  }
  // migrate-on-read; safe if already v2.
  const cfg = migrateConfigSchema(cfgPath);
  if (!cfg) return { configured: false };

  const workspaceWolf = path.join(cfg.workspace_wolf_parent, '.wolf');
  // active project comes from ?project= (validated by caller) or
  // most-recently-touched fallback. project_default kept only as final floor.
  const activeProject = activeProjectOverride || cfg.project_default;
  const projectWolf = path.join(activeProject, '.wolf');

  function loadWorkspace() {
    const cerebrumPath = path.join(workspaceWolf, 'cerebrum.md');
    const buglogPath = path.join(workspaceWolf, 'buglog.json');
    const cerebrumEntries = fs.existsSync(cerebrumPath)
      ? (fs.readFileSync(cerebrumPath, 'utf8').match(/^-\s+/gm) || []).length
      : 0;
    const buglog = readJson(buglogPath, { bugs: [] });
    const bugs = Array.isArray(buglog.bugs) ? buglog.bugs : [];
    // project-scoped view filters by active project; legacy
    // entries without project_origin are grandfathered in.
    const projectScoped = bugs.filter(b => !b.project_origin || b.project_origin === activeProject);
    const byProject = {};
    for (const b of bugs) {
      const key = b.project_origin || '__unknown__';
      byProject[key] = (byProject[key] || 0) + 1;
    }
    return {
      path: workspaceWolf,
      exists: fs.existsSync(workspaceWolf),
      cerebrum_entries: cerebrumEntries,
      buglog_total: bugs.length,
      buglog_recent: bugs.slice(-5),
      buglog_total_project_scoped: projectScoped.length,
      buglog_recent_project_scoped: projectScoped.slice(-5),
      buglog_by_project: byProject,
    };
  }

  function loadProjectLedger(wolfDir) {
    const ledger = readJson(path.join(wolfDir, 'token-ledger.json'), null);
    if (!ledger) return null;
    const lifetime = ledger.lifetime || {};
    return {
      total_sessions: lifetime.total_sessions || 0,
      total_tokens_estimated: lifetime.total_tokens_estimated || 0,
      total_reads: lifetime.total_reads || 0,
      total_writes: lifetime.total_writes || 0,
      estimated_savings: lifetime.estimated_savings_vs_bare_cli || 0,
    };
  }

  function listSubdirsWithWolf(parent) {
    if (!fs.existsSync(parent)) return [];
    const out = [];
    for (const name of fs.readdirSync(parent)) {
      const sub = path.join(parent, name);
      let stat;
      try { stat = fs.statSync(sub); } catch { continue; }
      if (!stat.isDirectory()) continue;
      if (fs.existsSync(path.join(sub, '.wolf', 'token-ledger.json'))) {
        out.push(path.join(sub, '.wolf'));
      }
    }
    return out;
  }

  const projectWolves = listSubdirsWithWolf(cfg.workspace_wolf_parent);
  const perProject = projectWolves.map(wd => ({
    path: wd,
    ledger: loadProjectLedger(wd),
  }));

  const aggregate = perProject.reduce((acc, p) => {
    if (!p.ledger) return acc;
    acc.total_sessions += p.ledger.total_sessions;
    acc.total_tokens_estimated += p.ledger.total_tokens_estimated;
    acc.estimated_savings += p.ledger.estimated_savings;
    return acc;
  }, { total_sessions: 0, total_tokens_estimated: 0, estimated_savings: 0 });

  const anatomyProject = path.join(projectWolf, 'anatomy.md');
  const anatomyLines = fs.existsSync(anatomyProject)
    ? fs.readFileSync(anatomyProject, 'utf8').split('\n').length
    : 0;

  // cron-state summary for project_default
  function loadCron(wolfDir) {
    const manifestPath = path.join(wolfDir, 'cron-manifest.json');
    const statePath = path.join(wolfDir, 'cron-state.json');
    const manifest = readJson(manifestPath, { tasks: [] });
    const state = readJson(statePath, {
      last_heartbeat: null, engine_status: 'missing',
      execution_log: [], dead_letter_queue: [],
    });
    const tasks = Array.isArray(manifest.tasks) ? manifest.tasks : [];
    const execLog = Array.isArray(state.execution_log) ? state.execution_log : [];
    return {
      configured: fs.existsSync(manifestPath),
      engine_status: state.engine_status || 'unknown',
      last_heartbeat: state.last_heartbeat || null,
      task_count: tasks.length,
      tasks_enabled: tasks.filter(t => t.enabled).length,
      dead_letter_count: Array.isArray(state.dead_letter_queue) ? state.dead_letter_queue.length : 0,
      recent_executions: execLog.slice(-10),
    };
  }

  // anatomy + repeated-read savings from project token-ledger.
  function loadAnatomy(wolfDir) {
    const ledgerPath = path.join(wolfDir, 'token-ledger.json');
    const sessionPath = path.join(wolfDir, 'hooks', '_session.json');
    const ledger = readJson(ledgerPath, null);
    const session = readJson(sessionPath, null);
    if (!ledger) return { configured: false };
    const lt = ledger.lifetime || {};
    const hits = lt.anatomy_hits || 0;
    const misses = lt.anatomy_misses || 0;
    const repeatedBlocked = lt.repeated_reads_blocked || 0;
    const totalReads = lt.total_reads || 0;
    const totalTokensEst = lt.total_tokens_estimated || 0;
    const avgFileTokens = totalReads > 0 ? Math.round(totalTokensEst / totalReads) : 0;
    // Repeated-read blocks are the honest savings signal: each one = a full
    // file-read prevented. anatomy hits = assist count (description injected)
    // but whether Claude skipped is behavioural, not instrumentable — so we
    // surface the count but don't claim token savings from it.
    const repeatedReadTokensSaved = repeatedBlocked * avgFileTokens;
    return {
      configured: true,
      lifetime_anatomy_hits: hits,
      lifetime_anatomy_misses: misses,
      lifetime_repeated_reads_blocked: repeatedBlocked,
      lifetime_total_reads: totalReads,
      avg_file_tokens_est: avgFileTokens,
      repeated_read_tokens_saved_est: repeatedReadTokensSaved,
      hit_rate: (hits + misses) > 0 ? +((hits / (hits + misses)) * 100).toFixed(1) : 0,
      current_session: session ? {
        anatomy_hits: session.anatomy_hits || 0,
        anatomy_misses: session.anatomy_misses || 0,
        repeated_reads_warned: session.repeated_reads_warned || 0,
      } : null,
    };
  }

  return {
    configured: true,
    workspace: loadWorkspace(),
    // `active_project` replaces `project_default` as primary scope.
    // `project_default` key kept for backward-compat with older UI fields.
    active_project: {
      path: activeProject,
      label: path.basename(activeProject),
      wolf_dir: projectWolf,
      exists: fs.existsSync(projectWolf),
      anatomy_lines: anatomyLines,
      ledger: loadProjectLedger(projectWolf),
    },
    project_default: {
      path: projectWolf,
      exists: fs.existsSync(projectWolf),
      anatomy_lines: anatomyLines,
      ledger: loadProjectLedger(projectWolf),
    },
    aggregate_across_workspace: {
      project_count: perProject.length,
      ...aggregate,
    },
    cron: loadCron(projectWolf),
    anatomy: loadAnatomy(projectWolf),
    available_projects: mergedProjects(cfg),
    _cfg: {
      workspace_wolf_parent: cfg.workspace_wolf_parent,
      project_default: cfg.project_default,
      active_project: activeProject,
    },
  };
}

// unified hero KPIs — honest source-tagged totals.
function summarizeSummary(caveman, compress, openwolf) {
  const sessions = readJson(SESSIONS_PATH, []);
  const v2 = (Array.isArray(sessions) ? sessions : []).filter(s =>
    s?.caveman?.schema_version >= 2 &&
    s?.caveman?.measurement_method === 'transcript-parse'
  );

  // Total tokens used = Σ (input + output) across v2+ sessions. Real.
  // also sum prose_tokens_est for prose-axis denominator.
  let inputUsed = 0, outputUsed = 0, proseUsed = 0;
  for (const s of v2) {
    inputUsed += s.caveman.input_tokens_total || 0;
    outputUsed += s.caveman.output_tokens_total || 0;
    if (typeof s.caveman.prose_tokens_est === 'number') {
      proseUsed += s.caveman.prose_tokens_est;
    }
  }
  const totalUsed = inputUsed + outputUsed;

  // Input saved — two sources.
  // (a) compress: real Σ(original - compressed) across benchmarked files.
  const compressSaved = Math.max(0, (compress?.total_original_tokens || 0) - (compress?.total_compressed_tokens || 0));
  // (b) repeated-read blocks: est = repeatedBlocked × avg_file_tokens.
  const repeatedSaved = openwolf?.anatomy?.repeated_read_tokens_saved_est || 0;
  const inputSaved = compressSaved + repeatedSaved;
  // % = saved / (saved + used). Used = real input_tokens_total across v2.
  const inputSavedPct = (inputSaved + inputUsed) > 0
    ? +((inputSaved / (inputSaved + inputUsed)) * 100).toFixed(1) : 0;

  // Output saved now uses prose-only pooled mean — caveman's
  // true jurisdiction (code in tool_use blocks preserved per SKILL.md).
  // Falls back to pooled_mean (total) when prose fields unavailable (v2).
  let outputSaved = 0;
  let outputConfidence = 'insufficient_data';
  let metricMismatchDetected = false;
  let outputAxis = 'total'; // 'prose' | 'total'
  const perMode = caveman?.tokens_per_turn_by_mode || {};
  const off = perMode.off;
  const tiers = caveman?.confidence_tier || {};
  const mismatches = caveman?.metric_mismatch || {};
  const useProseAxis = off && off.prose_pooled_mean > 0;
  if (useProseAxis) outputAxis = 'prose';

  if (off && (useProseAxis ? off.prose_pooled_mean : off.pooled_mean) > 0) {
    for (const m of ['lite', 'full', 'ultra']) {
      const d = perMode[m];
      if (!d) continue;
      const offVal = useProseAxis ? off.prose_pooled_mean : off.pooled_mean;
      const curVal = useProseAxis ? d.prose_pooled_mean : d.pooled_mean;
      if (curVal > 0 && curVal < offVal) {
        outputSaved += (offVal - curVal) * (d.turns || 0);
      }
      if (mismatches[`${m}_vs_off`]) metricMismatchDetected = true;
    }
    const confs = ['lite_vs_off', 'full_vs_off', 'ultra_vs_off']
      .map(k => tiers[k]).filter(Boolean);
    if (confs.includes('confident')) outputConfidence = 'confident';
    else if (confs.includes('preliminary')) outputConfidence = 'preliminary';
  }
  outputSaved = Math.round(outputSaved);
  // Denominator matches axis: prose-axis → prose used; else → total output used.
  const outputDenomBase = useProseAxis ? proseUsed : outputUsed;
  const outputSavedPct = (outputSaved + outputDenomBase) > 0
    ? +((outputSaved / (outputSaved + outputDenomBase)) * 100).toFixed(1) : 0;

  return {
    total_tokens_used: totalUsed,
    input_tokens_used: inputUsed,
    output_tokens_used: outputUsed,
    sessions_tracked: v2.length,
    input_saved: inputSaved,
    input_saved_pct: inputSavedPct,
    input_sources: {
      compress_real: compressSaved,
      repeated_reads_est: repeatedSaved,
    },
    output_saved: outputSaved,
    output_saved_pct: outputSavedPct,
    output_confidence: outputConfidence,
    output_metric_mismatch: metricMismatchDetected,
    output_axis: outputAxis,
    needs_off_baseline: !off || (outputAxis === 'prose' ? off.prose_pooled_mean === 0 : off.pooled_mean === 0),
  };
}

// recent activity — cron exec + buglog + memory.md chronological.
function summarizeActivity(openwolf) {
  if (!openwolf?.configured) return { configured: false, items: [] };
  const items = [];
  const cfg = openwolf._cfg || {};
  // follow active_project rather than static project_default.
  const scope = cfg.active_project || cfg.project_default || '';
  const projectWolf = path.join(scope, '.wolf');

  // Cron executions.
  const cron = openwolf.cron || {};
  for (const e of (cron.recent_executions || []).slice(-10)) {
    items.push({
      at: e.timestamp,
      kind: 'cron',
      summary: `${e.task_id || '?'} → ${e.status || '?'} (${e.duration_ms || 0}ms)`,
    });
  }

  // Buglog recent (project-scoped).
  for (const b of (openwolf.workspace?.buglog_recent_project_scoped || [])) {
    items.push({
      at: b.last_seen,
      kind: 'bug',
      summary: `${b.id || '?'} — ${String(b.error_message || '').slice(0, 80)} [${b.file || '?'}]`,
    });
  }

  // memory.md last N rows.
  const memoryPath = path.join(projectWolf, 'memory.md');
  if (fs.existsSync(memoryPath)) {
    try {
      const raw = fs.readFileSync(memoryPath, 'utf8');
      const lines = raw.split('\n');
      let currentSession = null;
      const memRows = [];
      for (const line of lines) {
        const sessHdr = line.match(/^##\s+Session:\s+(.+)$/);
        if (sessHdr) { currentSession = sessHdr[1].trim(); continue; }
        const row = line.match(/^\|\s*([\d:]+)\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]*)\|/);
        if (row && !/Time|---/.test(row[1])) {
          memRows.push({
            at: currentSession ? `${currentSession} ${row[1].trim()}` : row[1].trim(),
            action: row[2].trim(),
            files: row[3].trim(),
            outcome: row[4].trim(),
          });
        }
      }
      for (const r of memRows.slice(-10)) {
        items.push({
          at: r.at,
          kind: 'memory',
          summary: `${r.action} ${r.files} → ${r.outcome}`,
        });
      }
    } catch (_) { /* ignore */ }
  }

  // Sort chronologically (best-effort; memory 'at' may be relative).
  items.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));

  return {
    configured: true,
    items: items.slice(0, 30),
    cron_heartbeat: cron.last_heartbeat,
    cron_engine_status: cron.engine_status,
    dead_letter_count: cron.dead_letter_count || 0,
  };
}

// read-only config surface (paths + cron manifest + settings hooks).
function summarizeConfig(openwolf) {
  const out = {
    openwolf: null,
    cron_manifest: null,
    settings_hooks: null,
    local_patches: [],
  };
  if (openwolf?.configured && openwolf._cfg) {
    const cfg = openwolf._cfg;
    const scope = cfg.active_project || cfg.project_default;
    out.openwolf = {
      workspace_wolf_parent: cfg.workspace_wolf_parent,
      project_default: cfg.project_default,
      active_project: scope,
      workspace_wolf: path.join(cfg.workspace_wolf_parent, '.wolf'),
      project_wolf: path.join(scope, '.wolf'),
      available_projects: openwolf.available_projects || [],
    };
    const manifestPath = path.join(scope, '.wolf', 'cron-manifest.json');
    const manifest = readJson(manifestPath, null);
    if (manifest && Array.isArray(manifest.tasks)) {
      out.cron_manifest = manifest.tasks.map(t => ({
        id: t.id || t.name,
        schedule: t.schedule || t.cron,
        enabled: !!t.enabled,
        description: t.description || '',
      }));
    }
  }
  // Settings hooks.
  const settingsPath = path.join(process.env.USERPROFILE || process.env.HOME || '', '.claude', 'settings.json');
  const settings = readJson(settingsPath, null);
  if (settings?.hooks) {
    const hookList = [];
    for (const [evt, entries] of Object.entries(settings.hooks)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        const matcher = entry.matcher || '';
        const hooks = Array.isArray(entry.hooks) ? entry.hooks : [];
        for (const h of hooks) {
          hookList.push({ event: evt, matcher, command: h.command || '' });
        }
      }
    }
    out.settings_hooks = hookList;
  }
  // LOCAL MOD patches.
  const patchesDir = path.join(REPO_ROOT, 'scripts', 'patches');
  if (fs.existsSync(patchesDir)) {
    out.local_patches = fs.readdirSync(patchesDir)
      .filter(f => f.endsWith('.patch.js'))
      .sort();
  }
  return out;
}

const app = express();
app.use(express.json({ limit: '32kb' }));
app.use(express.static(PUBLIC_DIR));

// helper — reads ?project=, whitelist-validates against
// discoverProjects(). Returns active project path (never null).
function resolveActive(req) {
  const cfgPath = path.join(DATA_DIR, 'openwolf-config.json');
  const cfg = migrateConfigSchema(cfgPath);
  if (!cfg) return null;
  return getActiveProject(req, cfg);
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, uptime_s: Math.round(process.uptime()), host: HOST, port: PORT });
});

app.get('/api/stats/caveman', (_req, res) => {
  const sessions = readJson(SESSIONS_PATH, []);
  res.json(summarizeCaveman(Array.isArray(sessions) ? sessions : []));
});

app.get('/api/stats/compress', (_req, res) => {
  const entries = readJson(COMPRESS_PATH, []);
  res.json(summarizeCompress(Array.isArray(entries) ? entries : []));
});

app.get('/api/stats/openwolf', (req, res) => {
  const active = resolveActive(req);
  res.json(summarizeOpenwolf(active));
});

// cron opt-in toggle. Writes overlay entry to projects[].
// Validates path against discovery — rejects unknown projects.
app.post('/api/openwolf/cron-toggle', (req, res) => {
  try {
    const { path: projectPath, enabled } = req.body || {};
    if (!projectPath || typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'body must be { path, enabled }' });
    }
    const cfgPath = path.join(DATA_DIR, 'openwolf-config.json');
    const cfg = migrateConfigSchema(cfgPath);
    if (!cfg) return res.status(500).json({ error: 'openwolf not configured' });
    const discovered = discoverProjects(cfg);
    const normalized = path.resolve(String(projectPath));
    const match = discovered.find(p => path.resolve(p.path) === normalized);
    if (!match) {
      return res.status(404).json({ error: 'project not discovered — seed .wolf/ first by opening Claude Code there' });
    }
    if (!Array.isArray(cfg.projects)) cfg.projects = [];
    const idx = cfg.projects.findIndex(p => p && path.resolve(p.path) === normalized);
    if (idx >= 0) {
      cfg.projects[idx].cron_enabled = enabled;
    } else {
      cfg.projects.push({ path: match.path, cron_enabled: enabled });
    }
    writeJson(cfgPath, cfg);
    res.json({ ok: true, restart_required: true, projects: cfg.projects });
  } catch (err) {
    res.status(500).json({ error: String(err && err.message || err) });
  }
});

//
// app.get('/api/stats/cascade',  ...)

app.get('/api/stats', (req, res) => {
  const active = resolveActive(req);
  const sessions = readJson(SESSIONS_PATH, []);
  const compress = readJson(COMPRESS_PATH, []);
  const cavemanS = summarizeCaveman(Array.isArray(sessions) ? sessions : []);
  const compressS = summarizeCompress(Array.isArray(compress) ? compress : []);
  const openwolfS = summarizeOpenwolf(active);
  res.json({
    summary: summarizeSummary(cavemanS, compressS, openwolfS),
    caveman: cavemanS,
    compress: compressS,
    openwolf: openwolfS,
    activity: summarizeActivity(openwolfS),
    config: summarizeConfig(openwolfS),
  });
});

const server = app.listen(PORT, HOST, () => {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(PID_PATH, String(process.pid));
  } catch (_) {}
  console.log(`[dashboard] listening on http://${HOST}:${PORT}  (repo: ${REPO_ROOT})`);
  console.log(`[dashboard] pid ${process.pid} written to ${PID_PATH}`);
  bootCron();
});

// dashboard hosts one CronEngine per cron-enabled
// project in cfg.projects[]. Each engine writes to its own
// .wolf/cron-state.json. Error isolation — one project's broken manifest
// does not take down cron for others.
const cronEngines = new Map();
async function bootCron() {
  try {
    const cfgPath = path.join(DATA_DIR, 'openwolf-config.json');
    const cfg = migrateConfigSchema(cfgPath);
    if (!cfg) {
      console.log('[dashboard] cron: skipped (openwolf not configured)');
      return;
    }
    const enabled = (Array.isArray(cfg.projects) ? cfg.projects : []).filter(p => p && p.cron_enabled);
    if (enabled.length === 0) {
      console.log('[dashboard] cron: no projects with cron_enabled=true — skipping');
      return;
    }
    const engineUrl = pathToFileURL(path.join(REPO_ROOT, 'hooks/openwolf/src/daemon/cron-engine.js')).href;
    const loggerUrl = pathToFileURL(path.join(REPO_ROOT, 'hooks/openwolf/src/utils/logger.js')).href;
    const { CronEngine } = await import(engineUrl);
    const { Logger } = await import(loggerUrl);
    for (const proj of enabled) {
      try {
        const projWolf = path.join(proj.path, '.wolf');
        const manifestPath = path.join(projWolf, 'cron-manifest.json');
        if (!fs.existsSync(manifestPath)) {
          console.warn(`[dashboard] cron: cron_enabled=true but no manifest at ${projWolf} — skipping ${path.basename(proj.path)}`);
          continue;
        }
        const logger = new Logger(path.join(projWolf, 'daemon.log'), 'info');
        const engine = new CronEngine(projWolf, proj.path, logger, () => {});
        engine.start();
        cronEngines.set(proj.path, engine);
        console.log(`[dashboard] cron: started for ${path.basename(proj.path)} (manifest: ${manifestPath})`);
      } catch (innerErr) {
        console.error(`[dashboard] cron: boot failed for ${proj.path}:`, innerErr && innerErr.message);
        // Isolated — keep trying other projects.
      }
    }
  } catch (err) {
    console.error('[dashboard] cron engine init failed:', err && err.message);
  }
}

function cleanup() {
  for (const engine of cronEngines.values()) {
    try { engine.stop(); } catch (_) {}
  }
  cronEngines.clear();
  try { if (fs.existsSync(PID_PATH)) fs.unlinkSync(PID_PATH); } catch (_) {}
  try { server.close(); } catch (_) {}
  process.exit(0);
}
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
