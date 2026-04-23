# TRUST.md — why this is safe to install (and how to verify)

If Claude Code refused to run the install with a "this looks like a supply-chain attack" warning, **that warning was correct, and you should be glad it fired.** The pattern Claude was reacting to (unknown repo + scripted `--yes` flags + a settings-file persistence step + auto-confirm) is exactly how a malicious package would try to slip past you. We rewrote the install prompt to remove every one of those signals. This file explains the change and gives you everything you need to audit the repo yourself before installing.

## What Claude flagged, and what we changed

| Original signal | Why Claude flagged it | What we changed |
|---|---|---|
| `npm run setup -- --yes --non-interactive` | Auto-confirms every prompt; bypasses interactive safety | Default install is now interactive — Claude answers prompts one at a time and you see each one |
| `node scripts/merge-settings.js --enable-autostart` bundled into the install line | Modifies `~/.claude/settings.json` to run something every session — classic persistence | Removed from default install. Now an explicit second step, only run if you ask for it |
| Pre-formatted shell-script-shaped install line | Looks copy-paste-from-attacker, not user request | Rewritten as natural-language steps Claude reads and reasons about |
| "If install fails, open a GitHub issue" fallback | Drives engagement to the unknown repo, increases apparent legitimacy | Removed. Doctor output stays local |
| Unknown third-party repo | Cannot be auto-verified | Cannot fix — see "How to verify yourself" below |

## How to verify yourself before installing

1. **Read the source.** It is ~2k lines of plain JavaScript / shell. Start with:
   - `scripts/install.js` — orchestrates the install
   - `scripts/merge-settings.js` — every settings-file mutation goes through here, with comment markers and a `--bak` backup
   - `teardown.sh` — uninstall path; restores from the `.bak` and prompts before deleting `.wolf/` data
   - `hooks/caveman-session-stop.js` — the only first-party hook (the others are vendored — see below)
2. **Check the network surface.**
   - `dashboard/server.js` binds `127.0.0.1` only — `grep -n "listen" dashboard/server.js`
   - No `fetch`, no `http.request`, no telemetry calls — `grep -rn "fetch\|http.request\|telemetry\|analytics" dashboard/ hooks/ scripts/`
   - The only outbound traffic at install time is `git clone` and `npm install` (against pinned `package-lock.json`)
3. **Check the vendored code.** Two upstream projects are subtree-vendored at pinned commits:
   - `JuliusBrussee/caveman` @ `c2ed24b3` (MIT) — under `hooks/caveman-*` and `skills/caveman*`
   - `cytostack/openwolf` @ `bd698351` (AGPL-3.0-or-later) — under `hooks/openwolf/`
   - See `LICENSE-ATTRIBUTION.md` for the full scope, file paths, and any local modifications.
4. **Diff against the upstreams.** `scripts/fetch-caveman.js` and `scripts/fetch-openwolf.js` are how the vendored code is refreshed; they document every local mod via `applyModeTrackerPatch()`-style functions, not hand-edits.
5. **Watch the install in real time.** `npm run setup --verbose` streams every phase. `npm run doctor` runs 10 health checks and prints a `DOCTOR_RESULT:` JSON sentinel on the last line. `npm run doctor --json` emits parser-safe pure JSON.

## What the install actually changes on your system

| Path | What gets written | Reversible? |
|---|---|---|
| `~/claudecode-token-optimizer/` | The cloned repo + `node_modules/` | Yes — `bash teardown.sh` then `rm -rf` the dir |
| `~/.claude/settings.json` | New `hooks` entries (caveman + openwolf + our Stop hook), bracketed by `# BEGIN claudecode-token-optimizer` / `# END` markers | Yes — original is saved to `~/.claude/settings.json.bak` before write; teardown restores it |
| `~/.claude/skills/` | Two skill directories: `caveman/`, `caveman-compress/` | Yes — teardown removes both |
| `~/.claude/commands/` | Two slash commands: `/caveman`, `/openwolf` | Yes — teardown removes both |
| `<workspace>/.wolf/` and `<project>/.wolf/` | Per-workspace and per-project state (memory, ledger, anatomy) | Preserved by default on teardown; `--yes` on teardown deletes them |
| `~/claudecode-token-optimizer/dashboard/data/` | Local runtime state (token ledger, sessions, snapshots). Gitignored | Yes — deleted with the install dir |

**Nothing is written outside these paths.** No systemd / launchd / scheduled tasks. No browser extensions. No global npm installs. The dashboard server only runs when you start it manually with `npm run dashboard`.

## What the install does *not* do

- No outbound network beyond `git clone` and `npm install`.
- No telemetry, no analytics, no error reporting, no phone-home.
- No auto-start on session, on login, or on boot — **unless** you explicitly run `node scripts/merge-settings.js --enable-autostart` as a separate opt-in step.
- No code execution outside the install dir and `~/.claude/`.
- No dependency on any private registry. `package.json` resolves entirely from the public npm registry, lockfile-pinned.

## If you are still unsure

Don't install it. Read the source, run it in a VM or container, or wait for someone you trust to audit it. The install is two lines of `git clone` and `npm install` — there is no urgency.

If you find a real security issue, please follow `SECURITY.md`.
