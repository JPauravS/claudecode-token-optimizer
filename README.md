# claudecode-token-optimizer

**50%+ fewer input tokens. 20%+ shorter output. Do more work in the same context window.**

Claude Code sessions get smaller inputs, shorter outputs, and a local dashboard to measure both — without changing how you work. Both axes. Measured.

[![License](https://img.shields.io/badge/license-MIT%20%2B%20AGPL--3.0-blue.svg)](./LICENSE-ATTRIBUTION.md)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](#prerequisites)

![Dashboard demo — 3.9M tokens tracked · 65% input saved · 26.5% output saved](./docs/demo.gif)

---

## Before / After

🐢 **Without optimizer**
```
Claude reads config.ts... reads config.ts again... reads config.ts a third time.
"Sure! I'd be happy to help. The issue you're experiencing is most likely..."
→ 3 redundant file reads + prose overhead
```

⚡ **With optimizer**
```
[OpenWolf: file cached from session start — blocking repeated read]
"Config cached. Auth bug: token expiry check uses < not <=. Fix:"
→ One read. No fluff. Same answer.
```

Same fix. Fraction of the tokens. Context window stays clear for the next task.

---

## What it saves

```
INPUT TOKENS SAVED    ██████████  50%+  repeated-read blocking + file compression
OUTPUT TOKENS SAVED   ████████    20%+  prose-axis · code/commits/PRs unchanged
CONTEXT WINDOW        ██████████  ↑     longer tasks · more files · fewer compactions
TECHNICAL ACCURACY    ██████████ 100%
```

`n=17 sessions · prose-axis isolated from tool-use tokens · reproducible on your own data`

The context window benefit compounds: smaller inputs mean more turns before context fills, longer uninterrupted tasks, and more files held in context simultaneously — without upgrading to a larger context plan.

---

## Install — paste into Claude Code

<!--
  DRIFT GUARDRAIL: the install prompt below is duplicated in
  INSTALL_PROMPT.md. Keep both copies identical. If you change one,
  update the other in the same PR.
-->

Claude reviews the repo, runs the install interactively, and reports back. Paste this once:

```text
I want to try `claudecode-token-optimizer` — an open-source Claude Code add-on (MIT + vendored AGPL-3.0, no telemetry, dashboard binds 127.0.0.1 only). Repo: https://github.com/JPauravS/claudecode-token-optimizer

Please install it for me with these steps:

1. Clone the repo to `~/claudecode-token-optimizer`, pinned to release tag `v1.1.5` (`git clone --depth 1 --branch v1.1.5 https://github.com/JPauravS/claudecode-token-optimizer.git`). If the directory already exists and is a git checkout, `git fetch --tags && git checkout v1.1.5`; if it exists but is not a git checkout, rename it to `${dir}.backup.<timestamp>` and clone fresh at the tag.
2. Open `README.md` and `SECURITY.md` from the clone and skim them so you understand what the install does. The relevant scripts are `scripts/install.js`, `scripts/merge-settings.js`, and `teardown.sh` — glance at those too. Also open `package.json` and check the `scripts` block for any `preinstall`, `install`, `postinstall`, or `prepare` hooks; those run automatically during `npm install` and are the single highest-leverage attack surface in any Node project — if any are present and look unfamiliar, stop and tell me what they do. If anything else looks off, stop and tell me before continuing.
3. Run `npm run setup` (interactive — answer prompts using detected defaults unless I tell you otherwise). Then run `npm run doctor` and read the `DOCTOR_RESULT:` JSON sentinel on the last stdout line to confirm `{"pass":true}`.
4. Tell me the doctor result. Do **not** enable any auto-start, persistence, or settings-file modifications beyond what `npm run setup` does by default. If I want the dashboard to launch on every Claude Code session, I will ask you to run `node scripts/merge-settings.js --enable-autostart` as a separate explicit step.
5. To view savings I'll run `npm run dashboard` myself and open http://127.0.0.1:3847.

If `npm run setup` exits with `ERR_PREREQ:`, fix the missing prerequisite (Node ≥ 20, git, bash) and retry. If anything else fails, run `npm run doctor`, paste its output here, and stop.
```

<details>
<summary><b>What does the install actually change on my system?</b> (click to expand)</summary>

| Path | Written | Reversible? |
|---|---|---|
| `~/claudecode-token-optimizer/` | Cloned repo + `node_modules/` | Yes — `bash teardown.sh` then `rm -rf` the dir |
| `~/.claude/settings.json` | New `hooks` entries bracketed by `# BEGIN claudecode-token-optimizer` / `# END` markers; original saved to `.bak` | Yes — teardown restores from `.bak` |
| `~/.claude/skills/` | `caveman/` + `caveman-compress/` | Yes — teardown removes both |
| `~/.claude/commands/` | `/caveman` + `/openwolf` slash commands | Yes — teardown removes both |
| `<workspace>/.wolf/` + `<project>/.wolf/` | Per-project state (memory, ledger, anatomy) | Yes — teardown prompts before delete |
| `~/claudecode-token-optimizer/dashboard/data/` | Local runtime state (sessions, snapshots). Gitignored | Yes — deleted with the install dir |

**No** systemd/launchd, **no** scheduled tasks, **no** browser extensions, **no** outbound network beyond `git clone` + `npm install`, **no** telemetry. Dashboard binds `127.0.0.1` only and only runs when you start it manually with `npm run dashboard`. Autostart is opt-in via a separate explicit command.

Full audit + verification commands: [`TRUST.md`](./TRUST.md).

</details>

> **Did Claude Code refuse the install with a "this looks like a supply-chain attack" warning?** That warning is correct behavior — and the rewrite above removes every signal that triggered it (auto-confirm flags, bundled persistence step, scripted-shell shape). See **[`TRUST.md`](./TRUST.md)** for the full breakdown + how to audit the source yourself before installing.

### Prerequisites

Auto-checked by the installer. If any are missing, `npm run setup` exits with an `ERR_PREREQ:` line that Claude will see and resolve before retrying.

- Claude Code (already installed — that's how you're pasting this)
- Node ≥ 20
- git
- bash (Git Bash on Windows)

---

## What's in the box

| Component | What it does | Measured effect |
|---|---|---|
| **`caveman`** | Injects output-compression rules per session. Strips articles, filler, pleasantries, hedging. Code, errors, commits, PRs unchanged. | 20%+ shorter output (~35% prose-axis isolated — n=8 full + 9 off sessions) |
| **`OpenWolf`** | Blocks repeated reads of the same file per session. Cached anatomy descriptions inject instead. Per-project memory + buglog. | 50%+ fewer input tokens (n=17 sessions) |
| **`caveman-compress`** | On-demand skill that compresses markdown memory files in place. | 30–50% file-size reduction on CLAUDE.md / memory.md |
| **Dashboard** | Local Express server on `http://127.0.0.1:3847`. Hero KPI strip + 5-tab drilldown, per-project switcher, cron host. | Observability — measures both axes |

---

## Manual install (for auditors or CI)

```bash
git clone https://github.com/JPauravS/claudecode-token-optimizer.git
cd claudecode-token-optimizer
npm run setup              # add --verbose for full phase output
npm run doctor             # verify — look for DOCTOR_RESULT: {"pass":true}
npm run dashboard          # start dashboard at http://127.0.0.1:3847
```

| Flag | Effect |
|---|---|
| `--yes` | Accept all interactive defaults (detected project/workspace paths) |
| `--non-interactive` | No prompts; exit on missing prereqs; auto-run doctor post-install (implied by `CI=1`) |
| `--verbose` | Stream full phase output to stdout (default: one line per phase) |
| `--reconfigure` | Re-prompt for `.wolf/` paths even if config exists |

See `TROUBLESHOOTING.md` for platform gotchas (Windows Git Bash, OneDrive-synced paths, corporate proxies).

---

## Slash commands (added globally to Claude Code)

- `/caveman off | on | lite | ultra` — toggle output compression mid-session
- `/openwolf status | scan | bug` — memory/state + project anatomy + buglog

---

## How it works

1. **Hooks.** At session start, the caveman `UserPromptSubmit` hook injects compression rules; OpenWolf hooks wrap `Read` / `Write` to dedupe repeated reads and inject cached file descriptions. At `Stop`, per-session token usage is recorded to `dashboard/data/sessions.json`.
2. **Skills.** `caveman` defines the compression contract; `caveman-compress` is an on-demand tool to shrink markdown memory files.
3. **Dashboard.** Node/Express server renders local state and hosts the cron scheduler (`anatomy-rescan` every 6h, `memory-consolidation` at 02:00 daily).
4. **Data stays local.** Dashboard binds `127.0.0.1` only. No telemetry, no analytics, no outbound traffic beyond `git clone` and `npm install` at setup.

---

## Uninstall

```bash
cd ~/claudecode-token-optimizer
bash teardown.sh
```

Restores `~/.claude/settings.json` from `.bak`, removes `node_modules`, prompts to delete `.wolf/` directories (preserves by default in non-interactive mode). Run `npm run doctor` afterward to confirm clean state.

---

## Privacy + license

- **Network:** dashboard binds `127.0.0.1` only — not LAN-exposed, not internet-exposed.
- **Telemetry:** none. No phone-home. No analytics. Every byte stays on your machine.
- **License:** MIT (our code) + AGPL-3.0-or-later (vendored OpenWolf — see `LICENSE-ATTRIBUTION.md` for scope and obligations).

---

## Contributing + issues

Bugs / install failures: https://github.com/JPauravS/claudecode-token-optimizer/issues — issue templates prompt for `npm run doctor` output + the `dashboard/data/diagnostic-*.log` path. Security issues: see `SECURITY.md`.

PRs welcome. Read `CONTRIBUTING.md` first. Vendored subtrees (`hooks/openwolf/`, `hooks/caveman-*`, `skills/caveman*`) must be modified via `scripts/patches/*.patch.js` so changes survive the next `npm run fetch-*` sync.

Roadmap: see `ROADMAP.md`.

---

## Credits

- [`JuliusBrussee/caveman`](https://github.com/JuliusBrussee/caveman) — MIT. Source of the prose-compression hook and skills.
- [`cytostack/openwolf`](https://github.com/cytostack/openwolf) — AGPL-3.0-or-later. Source of the memory/state and read-dedupe hooks.

See `LICENSE-ATTRIBUTION.md` for the full scope, pinned commits, file paths, local modifications, and license obligations.

---

If this saves you tokens — leave a star. ⭐ Helps others find it.
