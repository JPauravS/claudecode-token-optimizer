<!--
  DRIFT GUARDRAIL: the install prompt below is duplicated in README.md
  (§ "Install — paste into Claude Code"). Keep both copies identical.
  If you change one, update the other in the same PR. Both must have
  the same URL, same dir alias (`D=~/claudecode-token-optimizer`), same
  flag set (`--yes --non-interactive`), and same post-install instructions.
-->

# Install via Claude Code

Paste this prompt into any Claude Code session:

---

Install claudecode-token-optimizer: set `D=~/claudecode-token-optimizer`; if `[ -d "$D/.git" ]` run `cd "$D" && git pull`, elif `[ -d "$D" ]` run `mv "$D" "${D}.backup.$(date +%s)" && git clone --depth 1 https://github.com/JPauravS/claudecode-token-optimizer.git "$D" && cd "$D"`, else run `git clone --depth 1 https://github.com/JPauravS/claudecode-token-optimizer.git "$D" && cd "$D"`; then `npm run setup -- --yes --non-interactive` and `npm run doctor` (read the `DOCTOR_RESULT:` sentinel on the last stdout line — `{"pass":true}` = green; or pipe `--json` for pure JSON). If green, ask the user if they want the dashboard to auto-start on every Claude Code session — if yes, run `node scripts/merge-settings.js --enable-autostart`. To view savings, run `npm run dashboard` in a new terminal and open http://127.0.0.1:3847. If install fails, run `npm run doctor`, copy its output plus the path `dashboard/data/diagnostic-*.log` it prints, and open a GitHub issue at https://github.com/JPauravS/claudecode-token-optimizer/issues with both.

---

## Notes

- **Prerequisites:** Claude Code already installed (that's how you're pasting this). Node ≥ 20, git, bash. The installer checks these and exits with `ERR_PREREQ:` if any are missing — Claude will see the error and install the missing prereq for you, then retry.
- **Safe to re-paste:** the `[ -d $D/.git ]` check pulls on existing clones; if the dir exists but isn't a git repo, it's backed up to `${D}.backup.{timestamp}` and re-cloned fresh (safer than blind `git pull` on a non-git dir). `npm run setup` is idempotent.
- **Prefer shell?** See `README.md` → "Manual install (advanced)" for the direct `npm run setup` path.
