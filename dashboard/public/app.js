// Dashboard polling client — (hero + tabs)

const POLL_MS = 10000;

// active-project selector persists in localStorage. `?project=`
// query string is appended to every OpenWolf-scoped fetch.
const LS_KEY = 'openwolf.activeProject';
let activeProject = null;              // selected path (string) or null → server default
let availableProjects = [];            // from /api/stats response

function qsProject() {
  return activeProject ? ('?project=' + encodeURIComponent(activeProject)) : '';
}

const MODE_COLORS = {
  full:  '#ff8c42',
  lite:  '#e3b341',
  ultra: '#f85149',
  off:   '#8b949e',
  commit: '#58a6ff',
  review: '#58a6ff',
  compress: '#58a6ff',
  unknown: '#30363d',
};

const TABS = ['overview', 'input', 'output', 'activity', 'config'];

function fmtInt(n) { return (n ?? 0).toLocaleString(); }
function fmtPct(n) { return (n == null || isNaN(n)) ? '—' : n.toFixed(1) + '%'; }

// ───── Tab routing ─────────────────────────────────────────────────────────
function activateTab(name) {
  if (!TABS.includes(name)) name = 'overview';
  for (const btn of document.querySelectorAll('.tab')) {
    btn.classList.toggle('active', btn.dataset.tab === name);
  }
  for (const panel of document.querySelectorAll('.tab-panel')) {
    panel.classList.toggle('active', panel.dataset.panel === name);
  }
  if (location.hash.slice(1) !== name) {
    history.replaceState(null, '', '#' + name);
  }
}

function wireTabs() {
  for (const btn of document.querySelectorAll('.tab')) {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  }
  for (const tile of document.querySelectorAll('.hero-tile.clickable')) {
    tile.addEventListener('click', () => activateTab(tile.dataset.tab));
  }
  for (const teaser of document.querySelectorAll('.teaser')) {
    teaser.addEventListener('click', (e) => {
      e.preventDefault();
      activateTab(teaser.dataset.tab);
    });
  }
  window.addEventListener('hashchange', () => activateTab(location.hash.slice(1)));
}

// ───── Poll ────────────────────────────────────────────────────────────────
async function poll() {
  try {
    const [health, stats] = await Promise.all([
      fetch('/api/health').then(r => r.json()),
      fetch('/api/stats' + qsProject()).then(r => r.json()),
    ]);
    renderHealth(health);
    renderProjectSwitcher(stats.openwolf);
    renderSummary(stats.summary, stats);
    renderCaveman(stats.caveman);
    renderCompress(stats.compress);
    renderAnatomy(stats.openwolf);
    renderActivity(stats.activity, stats.openwolf);
    renderConfig(stats.config, stats.openwolf);
    renderTeasers(stats);
  } catch (err) {
    renderHealth({ ok: false });
  }
}

// project switcher dropdown. Reads available_projects from
// /api/stats response; persists selection in localStorage.
function renderProjectSwitcher(ow) {
  const sel = document.getElementById('project-switcher');
  if (!sel) return;
  if (!ow || !ow.configured) {
    sel.innerHTML = '<option value="">(not configured)</option>';
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  availableProjects = Array.isArray(ow.available_projects) ? ow.available_projects : [];
  const serverActive = ow._cfg && (ow._cfg.active_project || ow._cfg.project_default);
  // Preserve local selection if still valid; else fall back to server's active.
  const validSelection = availableProjects.find(p => p.path === activeProject);
  if (!validSelection) {
    activeProject = serverActive && availableProjects.find(p => p.path === serverActive)
      ? serverActive
      : (availableProjects[0] && availableProjects[0].path) || null;
    if (activeProject) localStorage.setItem(LS_KEY, activeProject);
  }
  // Build options.
  sel.innerHTML = '';
  if (availableProjects.length === 0) {
    sel.innerHTML = '<option value="">(no projects discovered)</option>';
    return;
  }
  for (const p of availableProjects) {
    const opt = document.createElement('option');
    opt.value = p.path;
    const age = relativeAge(p.last_touch_ms);
    const cronMark = p.cron_enabled ? ' · cron' : '';
    opt.textContent = `${p.label}${age ? ' · ' + age : ''}${cronMark}`;
    if (p.path === activeProject) opt.selected = true;
    sel.appendChild(opt);
  }
  if (!sel.dataset.wired) {
    sel.addEventListener('change', () => {
      activeProject = sel.value;
      localStorage.setItem(LS_KEY, activeProject);
      poll(); // immediate refresh
    });
    sel.dataset.wired = '1';
  }
}

function relativeAge(ms) {
  if (!ms) return '';
  const diffMin = Math.floor((Date.now() - ms) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h ago`;
  return `${Math.floor(diffMin / 1440)}d ago`;
}

async function toggleCron(projectPath, enabled) {
  try {
    const r = await fetch('/api/openwolf/cron-toggle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: projectPath, enabled }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      alert('Cron toggle failed: ' + (body.error || r.statusText));
      return;
    }
    alert('Cron ' + (enabled ? 'enabled' : 'disabled') + ' for ' + projectPath.split(/[\\/]/).pop() +
      '.\n\nRestart the dashboard to apply:\n  npm run dashboard:stop && npm run dashboard');
    poll();
  } catch (err) {
    alert('Cron toggle error: ' + (err && err.message || err));
  }
}

function renderHealth(h) {
  const dot = document.getElementById('health-dot');
  const txt = document.getElementById('health-text');
  if (h && h.ok) {
    dot.classList.remove('err'); dot.classList.add('ok');
    txt.textContent = `live · uptime ${h.uptime_s}s`;
  } else {
    dot.classList.remove('ok'); dot.classList.add('err');
    txt.textContent = 'server unreachable';
  }
}

// ───── Hero ────────────────────────────────────────────────────────────────
function renderSummary(s, stats) {
  if (!s) return;
  // Total
  document.getElementById('kpi-total').textContent = fmtInt(s.total_tokens_used);
  document.getElementById('kpi-total-sub').textContent =
    `input ${fmtInt(s.input_tokens_used)} · output ${fmtInt(s.output_tokens_used)} · across ${fmtInt(s.sessions_tracked)} sessions`;

  // Input saved
  document.getElementById('kpi-input').childNodes[0].nodeValue = fmtInt(s.input_saved) + ' ';
  document.getElementById('kpi-input-pct').textContent = '(' + fmtPct(s.input_saved_pct) + ')';
  const src = s.input_sources || {};
  document.getElementById('kpi-input-sub').textContent =
    `compress ${fmtInt(src.compress_real)} · repeated-read ${fmtInt(src.repeated_reads_est)}`;

  // Output saved
  const kOut = document.getElementById('kpi-output');
  const kPct = document.getElementById('kpi-output-pct');
  const kBadge = document.getElementById('kpi-output-badge');
  const kSub = document.getElementById('kpi-output-sub');
  if (s.needs_off_baseline) {
    kOut.childNodes[0].nodeValue = '—  ';
    kPct.textContent = '';
    kBadge.textContent = '?';
    kBadge.className = 'src-badge pending';
    kBadge.title = 'needs baseline';
    kSub.innerHTML = 'needs baseline — run one <code>/caveman off</code> session';
  } else {
    kOut.childNodes[0].nodeValue = fmtInt(s.output_saved) + ' ';
    kPct.textContent = '(' + fmtPct(s.output_saved_pct) + ')';
    const axis = s.output_axis || 'total';
    if (axis === 'prose') {
      kBadge.textContent = s.output_confidence === 'confident' ? '✓' : '~';
      kBadge.className = 'src-badge ' + (s.output_confidence === 'confident' ? 'ok' : 'mixed');
      kBadge.title = 'prose-axis measurement (caveman jurisdiction)';
      kSub.textContent = `prose-only vs off · ${s.output_confidence}`;
    } else if (s.output_metric_mismatch) {
      kBadge.textContent = '!';
      kBadge.className = 'src-badge mixed';
      kBadge.title = 'metric mismatch — tool_use tokens confound signal';
      kSub.innerHTML = `total vs off · ${s.output_confidence} · <span style="color:var(--red)">metric mismatch</span>`;
    } else {
      kBadge.textContent = s.output_confidence === 'confident' ? '✓' : '~';
      kBadge.className = 'src-badge ' + (s.output_confidence === 'confident' ? 'ok' : 'mixed');
      kBadge.title = s.output_confidence;
      kSub.textContent = `total vs off · ${s.output_confidence}`;
    }
  }
}

// ───── Overview teasers ────────────────────────────────────────────────────
function renderTeasers(stats) {
  const s = stats.summary || {};
  document.getElementById('teaser-input').textContent =
    `${fmtPct(s.input_saved_pct)} saved · ${fmtInt(s.input_saved)} tokens · 2 sources`;
  const oc = s.output_confidence || 'insufficient_data';
  document.getElementById('teaser-output').textContent = s.needs_off_baseline
    ? 'no off baseline yet'
    : `${fmtPct(s.output_saved_pct)} saved · ${fmtInt(s.output_saved)} tokens · ${oc}`;
  const a = stats.activity || {};
  document.getElementById('teaser-activity').textContent =
    `${(a.items || []).length} recent events · cron ${a.cron_engine_status || '—'}`;
  const c = stats.config || {};
  const hookCount = (c.settings_hooks || []).length;
  const patchCount = (c.local_patches || []).length;
  document.getElementById('teaser-config').textContent =
    `${hookCount} hooks · ${patchCount} patches`;
}

// ───── Output tab ──────────────────────────────────────────────────────────
function renderCaveman(s) {
  if (!s) return;
  document.getElementById('total-sessions').textContent = fmtInt(s.total_sessions);
  document.getElementById('total-output-tokens').textContent = fmtInt(s.output_tokens_total_all_time);
  document.getElementById('total-turns-note').textContent =
    `${fmtInt(s.assistant_turns_all_time)} assistant turns`;

  const breakdown = s.mode_breakdown || {};
  const topMode = Object.entries(breakdown).sort((a, b) => b[1] - a[1])[0];
  const badge = document.getElementById('caveman-mode');
  if (topMode) {
    const [mode] = topMode;
    badge.textContent = mode;
    badge.className = 'badge mode-' + (['full','lite','ultra','off'].includes(mode) ? mode : 'unknown');
  } else {
    badge.textContent = 'no data';
    badge.className = 'badge mode-unknown';
  }

  const bar = document.getElementById('mode-breakdown');
  bar.innerHTML = '';
  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
  if (total === 0) {
    const empty = document.createElement('div');
    empty.className = 'breakdown-seg'; empty.style.flex = '1';
    empty.style.background = 'var(--border)';
    empty.style.color = 'var(--text-dim)';
    empty.textContent = 'no sessions yet';
    bar.appendChild(empty);
  } else {
    for (const [mode, count] of Object.entries(breakdown)) {
      const seg = document.createElement('div');
      seg.className = 'breakdown-seg';
      seg.style.flex = String(count);
      seg.style.background = MODE_COLORS[mode] || MODE_COLORS.unknown;
      seg.title = `${mode}: ${count}`;
      seg.textContent = `${mode} ${count}`;
      bar.appendChild(seg);
    }
  }

  const tbody = document.querySelector('#per-mode-table tbody');
  tbody.innerHTML = '';
  const perMode = s.tokens_per_turn_by_mode || {};
  const order = ['off', 'lite', 'full', 'ultra', 'commit', 'review', 'compress', 'unknown'];
  const modes = Object.keys(perMode).sort((a, b) => (order.indexOf(a) - order.indexOf(b)));
  if (modes.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="4" class="muted">no v2 data yet — next real session will populate</td>';
    tbody.appendChild(tr);
  }
  for (const m of modes) {
    const d = perMode[m];
    const tr = document.createElement('tr');
    const prose = d.prose_pooled_mean || 0;
    const tool = d.tool_pooled_mean || 0;
    tr.innerHTML = `<td><span class="badge mode-${['full','lite','ultra','off'].includes(m) ? m : 'unknown'}">${m}</span></td>
                    <td>${fmtInt(d.sessions)}</td>
                    <td>${fmtInt(d.turns)}</td>
                    <td style="color:var(--accent);font-weight:600">${prose > 0 ? fmtInt(prose) : '—'}</td>
                    <td class="muted">${tool > 0 ? fmtInt(tool) : '—'}</td>
                    <td>${fmtInt(d.pooled_mean)}</td>
                    <td class="muted">${fmtInt(d.median)}</td>`;
    tbody.appendChild(tr);
  }

  const deltas = s.observed_delta_pct || {};
  const deltasPooled = s.observed_delta_pct_pooled || {};
  const deltasProse = s.observed_delta_pct_prose || {};
  const mismatch = s.metric_mismatch || {};
  const tiers = s.confidence_tier || {};
  const preferred = ['full_vs_off', 'lite_vs_off', 'ultra_vs_off'].find(k => typeof deltasProse[k] === 'number' || typeof deltasPooled[k] === 'number' || typeof deltas[k] === 'number');
  const dv = document.getElementById('delta-value');
  const dn = document.getElementById('delta-note');
  const tierBadge = t => {
    if (t === 'confident') return ' <span style="background:var(--accent);color:#000;padding:1px 6px;border-radius:3px;font-size:0.75em">confident</span>';
    if (t === 'preliminary') return ' <span style="background:#d97706;color:#000;padding:1px 6px;border-radius:3px;font-size:0.75em">preliminary</span>';
    return '';
  };
  if (preferred) {
    const prosePct = deltasProse[preferred];
    const poolPct = deltasPooled[preferred];
    const momPct = deltas[preferred];
    // Prose is caveman's honest axis — prefer it as primary.
    const primary = (typeof prosePct === 'number') ? prosePct
      : (typeof poolPct === 'number') ? poolPct : momPct;
    const primaryLabel = (typeof prosePct === 'number') ? 'prose (caveman axis)'
      : (typeof poolPct === 'number') ? 'pooled total' : 'median-of-medians';
    const sign = primary >= 0 ? '−' : '+';
    dv.innerHTML = (sign + Math.abs(primary).toFixed(1) + '%') + tierBadge(tiers[preferred]);
    dv.style.color = primary > 0 ? 'var(--accent)' : (primary < 0 ? 'var(--red)' : 'var(--text-dim)');
    const mismatchFlag = mismatch[preferred] && typeof prosePct !== 'number'
      ? ' <span style="background:var(--red);color:#fff;padding:1px 6px;border-radius:3px;font-size:0.75em">metric mismatch</span>'
      : '';
    dn.innerHTML = `<strong>${preferred.replace('_vs_off', '')} vs off</strong> — ${primaryLabel}${mismatchFlag}<br>` +
      ['lite_vs_off', 'full_vs_off', 'ultra_vs_off'].map(k => {
        const pr = deltasProse[k], p = deltasPooled[k], m = deltas[k];
        if (pr == null && p == null && m == null) return `${k.replace('_vs_off','')} —`;
        const parts = [];
        if (pr != null) parts.push(`<strong style="color:var(--accent)">prose ${pr.toFixed(1)}%</strong>`);
        if (p != null) parts.push(`total ${p.toFixed(1)}%`);
        if (m != null) parts.push(`mom ${m.toFixed(1)}%`);
        return `${k.replace('_vs_off','')} ${parts.join(' / ')}${tierBadge(tiers[k])}`;
      }).join(' · ');
  } else {
    dv.textContent = '—';
    dv.style.color = 'var(--text-dim)';
    const min = s.min_sessions_per_mode_for_delta || 2;
    const minT = s.min_turns_per_mode_for_delta || 5;
    const confS = s.confident_sessions_per_mode || 3;
    const confT = s.confident_turns_per_mode || 10;
    const offData = perMode.off || { sessions: 0, turns: 0 };
    dn.innerHTML = `Preliminary: ≥${min} sessions × ≥${minT} turns each in <code>off</code> + compared mode. ` +
      `Confident: ≥${confS} × ≥${confT}.<br>Current: off = ${offData.sessions} sessions / ${offData.turns} turns.`;
  }

  document.getElementById('last-session').textContent = s.last_session
    ? new Date(s.last_session).toLocaleString()
    : 'none yet';
}

// ───── Input tab ───────────────────────────────────────────────────────────
function renderCompress(s) {
  if (!s) return;
  document.getElementById('compress-runs').textContent = fmtInt(s.total_runs);
  document.getElementById('compress-avg').textContent = s.total_runs ? `${s.avg_savings_pct}%` : '—';
  document.getElementById('compress-saved').textContent = fmtInt(
    (s.total_original_tokens || 0) - (s.total_compressed_tokens || 0)
  );
  document.getElementById('compress-badge').textContent = `${s.total_runs} run${s.total_runs === 1 ? '' : 's'}`;

  const tbody = document.querySelector('#compress-table tbody');
  tbody.innerHTML = '';
  const rows = [];
  for (const e of (s.recent || [])) {
    const r = e?.result;
    if (!r || !Array.isArray(r.rows)) continue;
    for (const row of r.rows) rows.push({ ...row, _ts: e._meta?.timestamp });
  }
  if (!rows.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="4" class="muted">no benchmarks yet</td>';
    tbody.appendChild(tr);
    return;
  }
  for (const r of rows.slice(-10).reverse()) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(r.file || '?')}</td>
                    <td>${fmtInt(r.original_tokens)}</td>
                    <td>${fmtInt(r.compressed_tokens)}</td>
                    <td>${typeof r.saved_pct === 'number' ? r.saved_pct.toFixed(1) + '%' : '—'}</td>`;
    tbody.appendChild(tr);
  }
}

function renderAnatomy(ow) {
  const badge = document.getElementById('anatomy-badge');
  const unc = document.getElementById('anatomy-unconfigured');
  const cfg = document.getElementById('anatomy-configured');
  if (!ow?.configured || !ow.anatomy?.configured) {
    unc.hidden = false; cfg.hidden = true;
    badge.textContent = 'n/a';
    badge.className = 'badge mode-unknown';
    return;
  }
  unc.hidden = true; cfg.hidden = false;
  const a = ow.anatomy;
  badge.textContent = 'live';
  badge.className = 'badge mode-full';
  document.getElementById('an-hit-rate').textContent = fmtPct(a.hit_rate);
  document.getElementById('an-hit-note').textContent =
    `${fmtInt(a.lifetime_anatomy_hits)} hits / ${fmtInt(a.lifetime_anatomy_misses)} misses (lifetime)`;
  document.getElementById('an-rep').textContent = fmtInt(a.lifetime_repeated_reads_blocked);
  document.getElementById('an-saved').textContent = fmtInt(a.repeated_read_tokens_saved_est);
  document.getElementById('an-saved-note').textContent =
    `${fmtInt(a.lifetime_repeated_reads_blocked)} × ${fmtInt(a.avg_file_tokens_est)} avg tokens/file`;
  const c = a.current_session || {};
  document.getElementById('an-cur-hits').textContent = fmtInt(c.anatomy_hits);
  document.getElementById('an-cur-misses').textContent = fmtInt(c.anatomy_misses);
  document.getElementById('an-cur-rep').textContent = fmtInt(c.repeated_reads_warned);
}

// ───── Activity tab ────────────────────────────────────────────────────────
function renderActivity(act, ow) {
  const badge = document.getElementById('activity-cron-badge');
  if (!act?.configured) {
    badge.textContent = 'n/a';
    badge.className = 'badge mode-unknown';
    document.getElementById('act-cron-status').textContent = '—';
    document.getElementById('act-cron-heartbeat').textContent = '—';
    document.getElementById('act-cron-dead').textContent = '0';
    document.getElementById('activity-body').innerHTML = '<tr><td colspan="3" class="muted">openwolf not configured</td></tr>';
    document.getElementById('act-bug-body').innerHTML = '<tr><td colspan="4" class="muted">—</td></tr>';
    return;
  }
  badge.textContent = act.cron_engine_status || '—';
  badge.className = 'badge ' + (act.cron_engine_status === 'running' ? 'mode-full' : 'mode-coming');
  document.getElementById('act-cron-status').textContent = act.cron_engine_status || '—';
  document.getElementById('act-cron-heartbeat').textContent = act.cron_heartbeat ? shortTime(act.cron_heartbeat) : '—';
  document.getElementById('act-cron-dead').textContent = fmtInt(act.dead_letter_count);

  const body = document.getElementById('activity-body');
  const items = act.items || [];
  if (!items.length) {
    body.innerHTML = '<tr><td colspan="3" class="muted">no events yet</td></tr>';
  } else {
    body.innerHTML = '';
    for (const it of items) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(shortTime(it.at) || it.at || '?')}</td>
                      <td><span class="badge mode-${kindClass(it.kind)}">${escapeHtml(it.kind)}</span></td>
                      <td>${escapeHtml(it.summary || '')}</td>`;
      body.appendChild(tr);
    }
  }

  const bugBody = document.getElementById('act-bug-body');
  const bugs = ow?.workspace?.buglog_recent_project_scoped || [];
  if (!bugs.length) {
    bugBody.innerHTML = '<tr><td colspan="4" class="muted">none</td></tr>';
  } else {
    bugBody.innerHTML = '';
    for (const b of bugs.slice().reverse()) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(b.id || '?')}</td>
                      <td><code>${escapeHtml(b.file || '?')}</code></td>
                      <td>${escapeHtml(String(b.error_message || '').slice(0, 60))}</td>
                      <td>${escapeHtml(shortTime(b.last_seen))}</td>`;
      bugBody.appendChild(tr);
    }
  }
}

function kindClass(k) {
  if (k === 'cron') return 'full';
  if (k === 'bug') return 'ultra';
  if (k === 'memory') return 'lite';
  return 'unknown';
}

// ───── Config tab ──────────────────────────────────────────────────────────
function renderConfig(c, ow) {
  if (!c) return;
  const paths = document.getElementById('cfg-paths');
  if (c.openwolf) {
    const ap = c.openwolf.active_project || c.openwolf.project_default;
    paths.innerHTML = `
      <div class="stat-row"><span>Workspace parent:</span> <code>${escapeHtml(c.openwolf.workspace_wolf_parent)}</code></div>
      <div class="stat-row"><span>Workspace wolf:</span> <code>${escapeHtml(c.openwolf.workspace_wolf)}</code></div>
      <div class="stat-row"><span>Active project:</span> <code>${escapeHtml(ap)}</code> <span class="muted">(switch via header dropdown)</span></div>
      <div class="stat-row"><span>Project wolf:</span> <code>${escapeHtml(c.openwolf.project_wolf)}</code></div>
      <div class="stat-row"><span>Project default <span class="muted">(fallback)</span>:</span> <code>${escapeHtml(c.openwolf.project_default)}</code></div>
    `;
  } else {
    paths.innerHTML = '<p class="placeholder-text muted">openwolf not configured</p>';
  }

  // discovered-projects table with per-project cron toggle.
  renderProjectsTable(ow);

  const cron = document.getElementById('cfg-cron-body');
  const tasks = c.cron_manifest || [];
  if (!tasks.length) {
    cron.innerHTML = '<tr><td colspan="4" class="muted">—</td></tr>';
  } else {
    cron.innerHTML = '';
    for (const t of tasks) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><code>${escapeHtml(t.id || '?')}</code></td>
                      <td><code>${escapeHtml(t.schedule || '?')}</code></td>
                      <td>${t.enabled ? '<span style="color:var(--green)">✓ enabled</span>' : '<span class="muted">disabled</span>'}</td>
                      <td>${escapeHtml(t.description || '')}</td>`;
      cron.appendChild(tr);
    }
  }

  const hooks = document.getElementById('cfg-hook-body');
  const hl = c.settings_hooks || [];
  if (!hl.length) {
    hooks.innerHTML = '<tr><td colspan="3" class="muted">—</td></tr>';
  } else {
    hooks.innerHTML = '';
    for (const h of hl) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(h.event)}</td>
                      <td>${escapeHtml(h.matcher || '*')}</td>
                      <td><code>${escapeHtml(h.command)}</code></td>`;
      hooks.appendChild(tr);
    }
  }

  const patches = document.getElementById('cfg-patches');
  const pl = c.local_patches || [];
  if (!pl.length) {
    patches.innerHTML = '<span class="muted">—</span>';
  } else {
    patches.innerHTML = `<span class="muted">${pl.length} patches:</span> ` +
      pl.map(p => `<code style="margin:2px 4px;display:inline-block">${escapeHtml(p)}</code>`).join('');
  }
}

function renderProjectsTable(ow) {
  const body = document.getElementById('cfg-projects-body');
  if (!body) return;
  const projects = (ow && Array.isArray(ow.available_projects)) ? ow.available_projects : [];
  if (!projects.length) {
    body.innerHTML = '<tr><td colspan="5" class="muted">no projects discovered — open Claude Code in any folder under the workspace parent to seed <code>.wolf/</code></td></tr>';
    return;
  }
  body.innerHTML = '';
  for (const p of projects) {
    const tr = document.createElement('tr');
    const age = relativeAge(p.last_touch_ms) || '—';
    const regBadge = p.registered
      ? '<span style="background:var(--accent);color:#000;padding:1px 6px;border-radius:3px;font-size:0.75em">registered</span>'
      : '<span class="muted">auto-discovered</span>';
    tr.innerHTML = `
      <td><code>${escapeHtml(p.label)}</code></td>
      <td><code class="muted">${escapeHtml(p.path)}</code></td>
      <td>${age}</td>
      <td>${regBadge}</td>
      <td>
        <label style="cursor:pointer">
          <input type="checkbox" ${p.cron_enabled ? 'checked' : ''} data-path="${escapeHtml(p.path)}" class="cron-toggle">
          ${p.cron_enabled ? '<span style="color:var(--green)">enabled</span>' : '<span class="muted">off</span>'}
        </label>
      </td>
    `;
    body.appendChild(tr);
  }
  // Wire toggles.
  for (const cb of body.querySelectorAll('.cron-toggle')) {
    cb.addEventListener('change', (e) => {
      const projectPath = e.target.dataset.path;
      const enabled = !!e.target.checked;
      toggleCron(projectPath, enabled);
    });
  }
}

// ───── utils ───────────────────────────────────────────────────────────────
function shortTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    const now = Date.now();
    const diffMin = Math.floor((now - d.getTime()) / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h ago`;
    return d.toISOString().slice(0, 10);
  } catch { return iso; }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ───── boot ────────────────────────────────────────────────────────────────
try { activeProject = localStorage.getItem(LS_KEY) || null; } catch { activeProject = null; }
wireTabs();
activateTab(location.hash.slice(1) || 'overview');
poll();
setInterval(poll, POLL_MS);
