#!/usr/bin/env node
// Fetches pinned-SHA caveman source files from GitHub.
// Writes LICENSE-ATTRIBUTION.md with license text inline.
// Idempotent: re-running overwrites destinations (safe — sources are pinned).

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

const sources = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'caveman-sources.json'), 'utf8')
);

const baseUrl = sources.base_url_template.replace('{commit}', sources.commit);

function log(msg) {
  process.stdout.write(`[fetch-caveman] ${msg}\n`);
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  }
  return await res.text();
}

function writeFile(dst, content) {
  const absDst = path.join(REPO_ROOT, dst);
  fs.mkdirSync(path.dirname(absDst), { recursive: true });
  fs.writeFileSync(absDst, content, 'utf8');
}

// LOCAL MOD: patch mode-tracker.js to handle /caveman off|on args.
// Applied after fetch so re-running setup.sh doesn't clobber the change.
function applyModeTrackerPatch(content) {
  const marker = 'LOCAL MOD (claude-stack)';
  if (content.includes(marker)) return content; // already patched
  const needle = "      } else if (cmd === '/caveman' || cmd === '/caveman:caveman') {\n        if (arg === 'lite') mode = 'lite';";
  const replacement = "      } else if (cmd === '/caveman' || cmd === '/caveman:caveman') {\n        // LOCAL MOD (claude-stack): explicit off/on arg handling.\n        if (arg === 'off' || arg === 'disable' || arg === 'stop') mode = 'off';\n        else if (arg === 'on' || arg === 'enable' || arg === 'start' || arg === 'full') mode = 'full';\n        else if (arg === 'lite') mode = 'lite';";
  if (!content.includes(needle)) {
    throw new Error('fetch-caveman: mode-tracker patch anchor not found — upstream changed structure');
  }
  return content.replace(needle, replacement);
}

// LOCAL MOD: force UTF-8 stdout/stderr on Windows.
// Without this, prints containing emoji (U+274C etc.) raise UnicodeEncodeError
// under Windows cp1252, which killed the rollback path during validation
// failures. Patch applied at top of cli.py so all downstream modules benefit.
function applyCliPyPatch(content) {
  const marker = '# LOCAL MOD (claude-stack)';
  if (content.includes(marker)) return content;
  const needle = 'import sys\nfrom pathlib import Path';
  const replacement =
    'import sys\n' +
    '# LOCAL MOD (claude-stack): force UTF-8 on Windows consoles so emoji in\n' +
    '# error paths do not crash cp1252 default encoders.\n' +
    'if sys.platform == "win32":\n' +
    '    try:\n' +
    '        sys.stdout.reconfigure(encoding="utf-8")\n' +
    '        sys.stderr.reconfigure(encoding="utf-8")\n' +
    '    except Exception:\n' +
    '        pass\n' +
    'from pathlib import Path';
  if (!content.includes(needle)) {
    throw new Error('fetch-caveman: cli.py patch anchor not found — upstream changed structure');
  }
  return content.replace(needle, replacement);
}

// LOCAL MOD: add encoding="utf-8" to the claude-CLI subprocess call so that
// Unicode chars in prompt/response (arrows, box-drawing, etc.) round-trip
// without being mangled to U+FFFD on Windows cp1252 default.
function applyCompressPyPatch(content) {
  const marker = '# LOCAL MOD (claude-stack)';
  if (content.includes(marker)) return content;
  const needle =
    '            ["claude", "--print"],\n' +
    '            input=prompt,\n' +
    '            text=True,\n' +
    '            capture_output=True,\n' +
    '            check=True,';
  const replacement =
    '            ["claude", "--print"],\n' +
    '            input=prompt,\n' +
    '            text=True,\n' +
    '            encoding="utf-8",  # LOCAL MOD (claude-stack): preserve Unicode on Windows\n' +
    '            capture_output=True,\n' +
    '            check=True,';
  if (!content.includes(needle)) {
    throw new Error('fetch-caveman: compress.py patch anchor not found — upstream changed structure');
  }
  return content.replace(needle, replacement);
}

async function main() {
  log(`Fetching ${sources.repo} @ ${sources.commit.slice(0, 8)}`);

  for (const f of sources.files) {
    const url = baseUrl + f.src;
    let content = await fetchText(url);
    let patched = false;
    if (f.dst === 'hooks/caveman-mode-tracker.js') {
      content = applyModeTrackerPatch(content);
      patched = true;
    } else if (f.dst === 'skills/caveman-compress/scripts/cli.py') {
      content = applyCliPyPatch(content);
      patched = true;
    } else if (f.dst === 'skills/caveman-compress/scripts/compress.py') {
      content = applyCompressPyPatch(content);
      patched = true;
    }
    if (patched) log(`  [patched] ${f.dst}`);
    writeFile(f.dst, content);
    log(`  ${f.dst}  (${content.length} bytes)`);
  }

  const licenseUrl = baseUrl + sources.license_file.src;
  const licenseText = await fetchText(licenseUrl);
  writeFile(sources.license_file.dst, licenseText);
  log(`  ${sources.license_file.dst}  (${licenseText.length} bytes)`);

  const header = `# Third-Party Attributions\n\n`;
  const cavemanSection = `## JuliusBrussee/caveman

The following files are vendored from
https://github.com/JuliusBrussee/caveman at commit \`${sources.commit}\`:

${sources.files.map(f => {
  const modded = new Set([
    'hooks/caveman-mode-tracker.js',
    'skills/caveman-compress/scripts/cli.py',
    'skills/caveman-compress/scripts/compress.py',
  ]);
  const modMark = modded.has(f.dst) ? ' **(local mod)**' : '';
  return `- \`${f.dst}\` (from \`${f.src}\`)${modMark}`;
}).join('\n')}

### Local modifications

- \`hooks/caveman-mode-tracker.js\` — added explicit \`off\`/\`on\`/\`disable\`/\`enable\` arg
  handling to the \`/caveman\` command switch. Upstream fell through to
  \`getDefaultMode()\` for unknown args, so \`/caveman off\` wrote \`full\` to the
  flag. Patch applied by \`scripts/fetch-caveman.js\` (\`applyModeTrackerPatch\`).
- \`skills/caveman-compress/scripts/cli.py\` — force UTF-8 on Windows
  \`sys.stdout\`/\`sys.stderr\` via \`reconfigure()\` so emoji in error paths
  (\`❌\`, \`✅\`, \`⚠️\`) don't raise \`UnicodeEncodeError\` under cp1252. Applied
  at top of cli entry point so all downstream module prints benefit.
  (\`applyCliPyPatch\`).
- \`skills/caveman-compress/scripts/compress.py\` — added
  \`encoding="utf-8"\` to the \`claude --print\` \`subprocess.run\` call so
  Unicode in prompt/response (arrows, box-drawing, non-ASCII content) round-trips
  intact. Default Windows encoding mangled these to \`U+FFFD\` and broke
  code-block validation. (\`applyCompressPyPatch\`).

All other files are unmodified.

**License:** ${sources.license_spdx}
**Source:** https://github.com/JuliusBrussee/caveman

Full upstream LICENSE is reproduced in \`${sources.license_file.dst}\` and below:

---

${licenseText}
`;

  // LICENSE-ATTRIBUTION.md is checked into the repo with hand-curated
  // attribution content (condensed + reorganized). Do not regenerate it here —
  // users who bump the pinned commit update the attribution file manually.
  // The `header` and `cavemanSection` templates above are kept for reference
  // / downstream forks that want an auto-generated file.
  void header;
  void cavemanSection;

  log('Done.');
}

main().catch(err => {
  console.error(`[fetch-caveman] ERROR: ${err.message}`);
  process.exit(1);
});
