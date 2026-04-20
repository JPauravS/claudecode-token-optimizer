#!/usr/bin/env node
// scripts/fetch-openwolf.js
// Fetches pinned-SHA openwolf source files from GitHub.
// Applies LOCAL MOD patches. Appends AGPL-3.0 openwolf section to LICENSE-ATTRIBUTION.md
// (preserves existing caveman section — does NOT overwrite).

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const sources = JSON.parse(fs.readFileSync(path.join(__dirname, 'openwolf-sources.json'), 'utf8'));
const baseUrl = sources.base_url_template.replace('{commit}', sources.commit);

const PATCHES = {
  'hooks/openwolf/src/hooks/shared.ts':       require('./patches/shared.ts.patch.js'),
  'hooks/openwolf/src/hooks/stop.ts':         require('./patches/stop.ts.patch.js'),
  'hooks/openwolf/src/hooks/post-write.ts':   require('./patches/post-write.ts.patch.js'),
  'hooks/openwolf/src/hooks/session-start.ts':require('./patches/session-start.ts.patch.js'),
  'hooks/openwolf/src/hooks/pre-write.ts':    require('./patches/pre-write.ts.patch.js'),
  'hooks/openwolf/src/cli/init.ts':           require('./patches/init.ts.patch.js'),
  'hooks/openwolf/src/cli/bug-cmd.ts':        require('./patches/bug-cmd.ts.patch.js'),
  'hooks/openwolf/src/cli/status.ts':         require('./patches/status.ts.patch.js'),
  'hooks/openwolf/src/buglog/bug-tracker.ts': require('./patches/bug-tracker.ts.patch.js'),
  'hooks/openwolf/src/cli/index.ts':          require('./patches/cli-index.ts.patch.js'),
  'hooks/openwolf/src/daemon/cron-engine.ts': require('./patches/cron-engine.ts.patch.js'),
};

// Template strip rules (applied to fetched template files, not .ts source)
const TEMPLATE_STRIPS = {
  'hooks/openwolf/src/templates/OPENWOLF.md': stripOpenwolfMdSections,
  'hooks/openwolf/src/templates/config.json': stripConfigJsonDesignqc,
};

function log(msg) { process.stdout.write(`[fetch-openwolf] ${msg}\n`); }

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  return await res.text();
}

function writeFile(dst, content) {
  const abs = path.join(REPO_ROOT, dst);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

function stripOpenwolfMdSections(content) {
  // Remove ## Design QC and ## Reframe — UI Framework Selection sections
  // Section boundary = next `## ` heading or EOF.
  const lines = content.split('\n');
  const out = [];
  let skipping = false;
  for (const line of lines) {
    if (/^##\s+(Design QC|Reframe)/i.test(line)) { skipping = true; continue; }
    if (skipping && /^##\s+/.test(line)) { skipping = false; }
    if (!skipping) out.push(line);
  }
  return out.join('\n');
}

function stripConfigJsonDesignqc(content) {
  const parsed = JSON.parse(content);
  delete parsed.designqc;
  return JSON.stringify(parsed, null, 2) + '\n';
}

async function main() {
  log(`repo ${sources.repo} @ ${sources.commit.slice(0, 8)}`);
  let patchedCount = 0;

  for (const f of sources.files) {
    const url = baseUrl + f.src;
    let content = await fetchText(url);
    if (PATCHES[f.dst]) {
      content = PATCHES[f.dst].apply(content);
      patchedCount++;
      log(`  [patched] ${f.dst}`);
    }
    if (TEMPLATE_STRIPS[f.dst]) {
      content = TEMPLATE_STRIPS[f.dst](content);
      log(`  [stripped] ${f.dst}`);
    }
    writeFile(f.dst, content);
    log(`  ${f.dst}  (${content.length} bytes)`);
  }

  // License
  const licenseText = await fetchText(baseUrl + sources.license_file.src);
  writeFile(sources.license_file.dst, licenseText);
  log(`  ${sources.license_file.dst}  (${licenseText.length} bytes)`);

  // Append openwolf section to LICENSE-ATTRIBUTION.md (preserve caveman content)
  const attrPath = path.join(REPO_ROOT, 'LICENSE-ATTRIBUTION.md');
  let existing = fs.existsSync(attrPath) ? fs.readFileSync(attrPath, 'utf8') : '';
  const OPENWOLF_MARKER = '## cytostack/openwolf';
  if (existing.includes(OPENWOLF_MARKER)) {
    // Remove existing openwolf section so we rewrite it with latest SHA
    existing = existing.split(OPENWOLF_MARKER)[0].trimEnd() + '\n';
  }
  const patchedFiles = sources.files.filter(f => PATCHES[f.dst]).map(f => f.dst);
  const strippedFiles = sources.files.filter(f => TEMPLATE_STRIPS[f.dst]).map(f => f.dst);
  const openwolfSection = `
${OPENWOLF_MARKER}

The following files are vendored from
https://github.com/cytostack/openwolf at commit \`${sources.commit}\`:

${sources.files.map(f => {
  const mods = [];
  if (patchedFiles.includes(f.dst)) mods.push('patched');
  if (strippedFiles.includes(f.dst)) mods.push('stripped');
  const tag = mods.length ? ` **(${mods.join(', ')})**` : '';
  return `- \`${f.dst}\` (from \`${f.src}\`)${tag}`;
}).join('\n')}

### Local modifications

- \`hooks/openwolf/src/hooks/shared.ts\` — added \`getWorkspaceWolfDir()\` +
  \`resolveWolfFile()\` to support dual-\`.wolf/\` routing (workspace for shared
  guidance files, project for project-local state). See
  \`scripts/patches/shared.ts.patch.js\`.
- \`hooks/openwolf/src/hooks/stop.ts\` — cerebrum reflection writes routed to
  workspace \`.wolf/cerebrum.md\`. See \`scripts/patches/stop.ts.patch.js\`.
- \`hooks/openwolf/src/hooks/post-write.ts\` — bug detection reads + writes
  routed to workspace \`.wolf/buglog.json\`. See
  \`scripts/patches/post-write.ts.patch.js\`.
- \`hooks/openwolf/src/hooks/session-start.ts\` — auto-create project
  \`.wolf/\` on first session when inside configured workspace. See
  \`scripts/patches/session-start.ts.patch.js\`.
- \`hooks/openwolf/src/hooks/pre-write.ts\` — cerebrum + buglog reads routed
  to workspace \`.wolf/\`. See \`scripts/patches/pre-write.ts.patch.js\`.
- \`hooks/openwolf/src/cli/init.ts\` — neutralized references to
  \`reframe-frameworks.md\` + \`designqc-report.json\` (dropped features).
- \`hooks/openwolf/src/cli/bug-cmd.ts\` — buglog lookup routed to workspace
  \`.wolf/\`. See \`scripts/patches/bug-cmd.ts.patch.js\`.
- \`hooks/openwolf/src/cli/status.ts\` — dual \`.wolf/\` helper routes
  workspace-owned files. See \`scripts/patches/status.ts.patch.js\`.
- \`hooks/openwolf/src/templates/OPENWOLF.md\` — stripped \`## Design QC\`
  and \`## Reframe\` sections.
- \`hooks/openwolf/src/templates/config.json\` — stripped \`designqc\` block.

**License:** ${sources.license_spdx} (AGPL-3.0) — copyleft. Distribution of this
repo as-is requires AGPL-compatible licensing for the whole work OR clearly
separated vendored openwolf subtree. Full upstream LICENSE at
\`${sources.license_file.dst}\` and below:

---

${licenseText}
`;
  fs.writeFileSync(attrPath, existing.trimEnd() + openwolfSection, 'utf8');
  log(`  LICENSE-ATTRIBUTION.md (appended openwolf section)`);

  log(`Done. ${patchedCount} file(s) patched.`);
}

main().catch(err => {
  console.error(`[fetch-openwolf] ERROR: ${err.message}`);
  process.exit(1);
});
