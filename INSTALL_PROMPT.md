<!--
  DRIFT GUARDRAIL: the install prompt below is duplicated in README.md
  (§ "Install — paste into Claude Code"). Keep both copies identical.
  If you change one, update the other in the same PR. Both must have
  the same URL, same pinned release tag (`v1.1.5`), the same
  interactive-setup default (no `--yes` bundled in the prompt body),
  the same explicit `package.json` postinstall-check instruction in
  step 2, and the same split autostart step (autostart is a separate
  user-initiated command, never bundled).
-->

# Install via Claude Code

Paste this prompt into any Claude Code session. It is written as a normal request — Claude will review the repo before installing and ask you to confirm anything destructive.

---

I want to try `claudecode-token-optimizer` — an open-source Claude Code add-on (MIT + vendored AGPL-3.0, no telemetry, dashboard binds 127.0.0.1 only). Repo: https://github.com/JPauravS/claudecode-token-optimizer

Please install it for me with these steps:

1. Clone the repo to `~/claudecode-token-optimizer`, pinned to release tag `v1.1.5` (`git clone --depth 1 --branch v1.1.5 https://github.com/JPauravS/claudecode-token-optimizer.git`). If the directory already exists and is a git checkout, `git fetch --tags && git checkout v1.1.5`; if it exists but is not a git checkout, rename it to `${dir}.backup.<timestamp>` and clone fresh at the tag.
2. Open `README.md` and `SECURITY.md` from the clone and skim them so you understand what the install does. The relevant scripts are `scripts/install.js`, `scripts/merge-settings.js`, and `teardown.sh` — glance at those too. Also open `package.json` and check the `scripts` block for any `preinstall`, `install`, `postinstall`, or `prepare` hooks; those run automatically during `npm install` and are the single highest-leverage attack surface in any Node project — if any are present and look unfamiliar, stop and tell me what they do. If anything else looks off, stop and tell me before continuing.
3. Run `npm run setup` (interactive — answer the prompts using detected defaults unless I tell you otherwise). Then run `npm run doctor` and read the `DOCTOR_RESULT:` JSON sentinel on the last stdout line to confirm `{"pass":true}`.
4. Tell me the doctor result. Do **not** enable any auto-start, persistence, or settings-file modifications beyond what `npm run setup` does by default. If I want the dashboard to launch on every Claude Code session, I will ask you to run `node scripts/merge-settings.js --enable-autostart` as a separate explicit step.
5. To view savings I'll run `npm run dashboard` myself and open http://127.0.0.1:3847.

If `npm run setup` exits with `ERR_PREREQ:`, fix the missing prerequisite (Node ≥ 20, git, bash) and retry. If anything else fails, run `npm run doctor`, paste its output here, and stop.

---

## Notes

- **Why this prompt looks the way it does:** earlier versions used `--yes --non-interactive` and bundled the autostart flag in one line. Some Claude Code sessions correctly flagged that as supply-chain-attack-shaped (unknown repo + scripted flags + persistence + auto-confirm = the exact pattern). The rewrite asks Claude to review the repo first, run setup interactively, and treat persistence as a separate opt-in. See `TRUST.md`.
- **Prerequisites:** Claude Code already installed. Node ≥ 20, git, bash (Git Bash on Windows). Auto-checked.
- **Safe to re-paste:** existing git checkouts are pulled in place; non-git dirs are backed up before re-clone. `npm run setup` is idempotent.
- **Prefer shell?** See `README.md` → "Manual install (for auditors or CI)".
