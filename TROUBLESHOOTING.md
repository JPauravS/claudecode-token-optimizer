# Troubleshooting — Manual Install Path

For users running `npm run setup` directly (not via the Claude Code prompt in `INSTALL_PROMPT.md`).

First step for any failure: **`npm run doctor`**. It writes `dashboard/data/diagnostic-<ts>.log` on failure — attach this to any GitHub issue.

---

## Prereqs missing

The installer exits with `ERR_PREREQ: <name> not found`. Install and re-run:

| Prereq | Install command (one of) |
|---|---|
| Node.js ≥ 20 | `nvm install 20 && nvm use 20` / `brew install node@20` / `winget install OpenJS.NodeJS.LTS` / `curl -fsSL https://deb.nodesource.com/setup_20.x \| sudo -E bash - && sudo apt install -y nodejs` |
| git | Preinstalled on macOS / `sudo apt install git` / `winget install Git.Git` |
| Claude Code CLI | `npm install -g @anthropic-ai/claude-code` |

## Windows

- **Use Git Bash**, not PowerShell or CMD. `setup.sh` uses POSIX bash. Claude Code's Bash tool uses Git Bash internally on Windows, so the prompt-install path works out of the box — only direct `bash setup.sh` invocations need Git Bash.
- **OneDrive-synced paths:** if the repo lives under `~/OneDrive/...`, watch for file-lock contention during install. Prefer cloning outside OneDrive (e.g., `~/code/`).

## Node version too old

```
ERR_PREREQ: node>=20 required, found v18.x.x
```

Upgrade via nvm (`nvm install 20 && nvm use 20`) and re-run.

## Upstream caveman detected

Installer refuses with `ERR_UPSTREAM_DETECTED`. Our stack vendors caveman/OpenWolf at pinned SHAs with additional hooks (token capture, dashboard, project_origin scoping). Running both copies causes conflicts. Uninstall upstream in 3 steps:

**Step 1 — remove upstream install directories:**

```bash
rm -rf ~/.caveman ~/.claude/skills/caveman ~/.claude/skills/openwolf
```

**Step 2 — strip upstream hook entries from `~/.claude/settings.json`.** The installer detects entries whose `command` contains `.caveman/hooks`, `.claude/skills/caveman/hooks`, or `.claude/skills/openwolf/src`. Removing the directories alone is NOT enough — settings.json still references them and A3 detect will keep refusing.

Pick one:

- **Quick reset (recommended if no other manual edits):** move settings.json aside so our installer writes a fresh one:
  ```bash
  mv ~/.claude/settings.json ~/.claude/settings.json.manual-cleanup.bak
  ```
- **Surgical (preserves other customizations):** open `~/.claude/settings.json` and delete any hook group whose `command` field contains the upstream paths above. Also delete any `statusLine` entry pointing at upstream.
- **Restore upstream's own pre-install backup** (if upstream created `~/.claude/settings.json.bak`):
  ```bash
  mv ~/.claude/settings.json.bak ~/.claude/settings.json
  ```

**Step 3 — verify + re-run:**

```bash
npm run doctor     # should now report `no upstream caveman/openwolf` PASS
npm run setup      # or: npm run setup:yes
```

If doctor still reports upstream detected after Step 2, grep your settings.json manually:
```bash
grep -nE "\.caveman/hooks|\.claude/skills/(caveman/hooks|openwolf/src)" ~/.claude/settings.json
```
Any matching line is the entry you still need to remove.

## Dashboard port 3847 held by zombie

`npm run doctor` reports:

```
FAIL  dashboard port 3847  port held but no pidfile — zombie?
```

Kill the holder:

```bash
npx kill-port 3847
rm -f dashboard/data/dashboard.pid
npm run dashboard
```

## Hook entries missing after install

Run `npm run doctor`. If `all hook MARKERS present` fails:

```bash
# Re-run the merge step only:
node scripts/merge-settings.js --settings ~/.claude/settings.json --repo $(pwd)

# Or re-run full setup (idempotent):
npm run setup --verbose
```

Inspect `install.log` (repo root) for the failing phase.

## Install fails at phase 6 — TypeScript compile error

Symptoms: `install.log` tail shows errors like:
```
hooks/openwolf/src/hooks/shared.ts(16,47): error TS1005: ',' expected.
hooks/openwolf/src/hooks/shared.ts(16,48): error TS1161: Unterminated regular expression literal.
```

Cause: pre-fix version of the patches introduced invalid TypeScript in
`shared.ts` / `session-start.ts`. Fixed in commit `a34a654`.

Fix — `git pull` and re-run:
```bash
cd ~/claudecode-token-optimizer && git pull
npm run setup -- --yes --non-interactive
npm run doctor
```

## Partial / corrupt install

If setup failed mid-run, the installer's `trap ERR` should have restored `~/.claude/settings.json` from the timestamped snapshot (`settings.json.pre-setup-<ts>.bak`). Verify:

```bash
ls ~/.claude/settings.json*
cat install.log | tail -50
npm run doctor
```

If the snapshot is still present but `settings.json` looks wrong, restore manually:

```bash
mv ~/.claude/settings.json.pre-setup-<ts>.bak ~/.claude/settings.json
```

## Dashboard won't start

For the SessionStart-spawn path (opt-in via `--enable-autostart`), check the most-recent spawn failure first:

```bash
cat dashboard/data/autostart-last-error.txt   # latest SPAWN_FAILED reason, if any
cat dashboard/data/autostart.log              # rolling history (rotates at 100KB)
```

Or run the dashboard directly and watch stderr:

```bash
npm run dashboard
```

Common causes: port 3847 in use (kill the holder above), `dashboard/server.js` missing (re-run `npm run setup`), permission denied on `dashboard/data/` (check ownership).

## Corporate proxy / firewall

`git clone` + `npm install` are the only outbound requests during setup. Set `HTTPS_PROXY` / `HTTP_PROXY` in your shell before running `npm run setup`. No runtime outbound connections — the dashboard binds `127.0.0.1` only and the hooks do not phone home.

---

## Still stuck?

Open an issue with these attachments:

1. `npm run doctor` output (the `DOCTOR_RESULT: {...}` sentinel line + the table above it)
2. Latest `dashboard/data/diagnostic-<ts>.log`
3. `install.log` (repo root)
4. OS + Node version (`uname -a` / `ver` + `node -v`)

Issues: https://github.com/JPauravS/claudecode-token-optimizer/issues
