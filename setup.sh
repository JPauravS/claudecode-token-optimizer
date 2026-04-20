#!/usr/bin/env bash
# Combined Claude Stack installer.
#
# Default: quiet one-line-per-phase output. Full detail in install.log.
# Flags:
#   --yes              accept all prompt defaults (project/workspace auto-detect)
#   --non-interactive  no prompts; exit on missing prereqs; auto-run doctor
#   --verbose          stream full phase output to stdout
#   --reconfigure      re-prompt for .wolf/ paths even if config exists
#
# Rollback: on any failure, ~/.claude/settings.json is restored from the
# timestamped snapshot created in phase 0 (see SNAPSHOT).

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
GLOBAL_SETTINGS="$HOME/.claude/settings.json"
LOG_FILE="$REPO_DIR/install.log"

SNAPSHOT=""        # timestamped settings.json snapshot, set in phase 0
CURRENT_PHASE=""   # for error reporting

# -- flag parsing --------------------------------------------------------------
VERBOSE=0
YES=0
NON_INTERACTIVE=0
FORWARD_ARGS=()
for a in "$@"; do
  case "$a" in
    --verbose) VERBOSE=1 ;;
    --yes) YES=1; FORWARD_ARGS+=("--yes") ;;
    --non-interactive) NON_INTERACTIVE=1; FORWARD_ARGS+=("--non-interactive") ;;
    --reconfigure) FORWARD_ARGS+=("--reconfigure") ;;
    *) FORWARD_ARGS+=("$a") ;;
  esac
done

# CI env implies non-interactive
if [ -n "${CI:-}" ]; then
  NON_INTERACTIVE=1
  FORWARD_ARGS+=("--non-interactive")
fi

export NON_INTERACTIVE YES VERBOSE

# -- logging primitives --------------------------------------------------------
: > "$LOG_FILE"   # truncate log at start of run

phase_start() {
  CURRENT_PHASE="$1"
  # One-line status to stdout (default UX); detail goes to log.
  printf '[setup] %s...\n' "$1"
  printf '[PHASE:START] %s\n' "$1" >> "$LOG_FILE"
}

phase_ok() {
  printf '[PHASE:OK] %s\n' "$1" >> "$LOG_FILE"
  if [ "$VERBOSE" -eq 1 ]; then
    printf '[setup] %s: OK\n' "$1"
  fi
}

log_verbose() {
  printf '[verbose] %s\n' "$*" >> "$LOG_FILE"
  if [ "$VERBOSE" -eq 1 ]; then
    printf '[setup] %s\n' "$*"
  fi
}

# Run a command: always append output to log; echo to stdout only in verbose mode.
# check both PIPESTATUS entries so tee failures (disk full, permission) don't hide.
run_phase_cmd() {
  if [ "$VERBOSE" -eq 1 ]; then
    "$@" 2>&1 | tee -a "$LOG_FILE"
    local cmd_rc="${PIPESTATUS[0]}"
    local tee_rc="${PIPESTATUS[1]}"
    if [ "$tee_rc" -ne 0 ]; then
      printf '[setup] WARN: tee to %s failed (rc %s) — log may be incomplete\n' "$LOG_FILE" "$tee_rc" >&2
    fi
    return "$cmd_rc"
  else
    "$@" >> "$LOG_FILE" 2>&1
  fi
}

# -- rollback (A4) -------------------------------------------------------------
# per-phase cleanup — rollback clears partial state in addition to
# restoring settings.json snapshot. Only node_modules cleanup is destructive;
# caveman/openwolf fetches and TS compile are overwrite-safe on next run.
#
# M6 convention: child scripts invoked under FORWARD_ARGS MUST honor both
# argv flags AND the exported env vars (NON_INTERACTIVE / YES / VERBOSE).
# openwolf-prompt.js does both; fetch-* + install-commands.js are fully
# non-interactive by design so they need no flag handling.
rollback() {
  local exit_code=$?
  echo "" >&2
  echo "[setup] FAILED at: $CURRENT_PHASE (exit $exit_code)" >&2
  printf '[PHASE:FAIL] %s (exit %s)\n' "$CURRENT_PHASE" "$exit_code" >> "$LOG_FILE"
  echo "[setup] last 20 lines of $LOG_FILE:" >&2
  tail -20 "$LOG_FILE" >&2 || true
  # Per-phase cleanup of partial state
  case "$CURRENT_PHASE" in
    *"phase 2/"*)
      if [ -d "$REPO_DIR/node_modules" ]; then
        echo "[setup] cleanup: removing partial node_modules/" >&2
        rm -rf "$REPO_DIR/node_modules"
      fi
      ;;
  esac
  if [ -n "$SNAPSHOT" ] && [ -f "$SNAPSHOT" ]; then
    echo "[setup] rolling back $GLOBAL_SETTINGS from $SNAPSHOT" >&2
    mv "$SNAPSHOT" "$GLOBAL_SETTINGS"
  fi
  echo "[setup] diagnose: run 'npm run doctor' or open an issue with install.log" >&2
  exit "$exit_code"
}
trap rollback ERR

# -- banner --------------------------------------------------------------------
echo "[setup] Combined Claude Stack installer"
log_verbose "repo:     $REPO_DIR"
log_verbose "settings: $GLOBAL_SETTINGS"
log_verbose "log:      $LOG_FILE"
log_verbose "flags:    verbose=$VERBOSE yes=$YES non_interactive=$NON_INTERACTIVE"

# -- phase 0: preflight --------------------------------------------------------
phase_start "phase 0/8: preflight"

check_cmd() {
  local cmd="$1"
  local name="$2"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERR_PREREQ: $name not found (command: $cmd)" >&2
    exit 1
  fi
}
check_cmd node "Node.js"
check_cmd npm  "npm"
check_cmd git  "git"
check_cmd claude "claude-code CLI"

# Node >= 20
NODE_MAJOR="$(node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "ERR_PREREQ: node>=20 required, found $(node -v)" >&2
  exit 1
fi
log_verbose "node $(node -v) OK"

# Detect pre-existing upstream caveman/openwolf install (A3)
# narrow patterns — require /hooks suffix so a home folder literally named
# `.caveman` (unusual but possible) or a path containing `caveman` without a
# hook-entry context doesn't false-positive as "upstream detected".
detect_upstream() {
  if [ -f "$GLOBAL_SETTINGS" ]; then
    if grep -q '\.caveman/hooks' "$GLOBAL_SETTINGS" 2>/dev/null \
       || grep -q '\.claude/skills/caveman/hooks' "$GLOBAL_SETTINGS" 2>/dev/null \
       || grep -q '\.claude/skills/openwolf/src' "$GLOBAL_SETTINGS" 2>/dev/null; then
      cat >&2 <<'EOF'

ERR_UPSTREAM_DETECTED: upstream caveman or openwolf install found.

This stack vendors both at pinned SHAs and wraps them with extra hooks
(Stop-hook token capture, dashboard, prose/tool-use split, project_origin
scoping). Running two copies will cause hook conflicts.

Uninstall upstream first:
  1. Remove upstream install dirs (e.g., ~/.caveman, ~/.claude/skills/caveman,
     ~/.claude/skills/openwolf).
  2. Remove upstream hook entries from ~/.claude/settings.json manually, OR
     restore the pre-upstream backup at ~/.claude/settings.json.bak if one
     exists.

Then re-run: npm run setup
EOF
      exit 1
    fi
  fi
}
detect_upstream

# Snapshot settings.json BEFORE any write (A4)
# Note: merge-settings.js maintains its own one-time ~/.claude/settings.json.bak
# for the *oldest* baseline. This snapshot is separate — per-run rollback only.
#
# on fresh installs where settings.json does not exist, create an empty
# stub so rollback has an empty baseline to restore to (rather than no-op on
# a partial first-install failure).
# prune oldest snapshots, keep the 3 most recent — prevents unbounded
# accumulation on repeat installs (e.g., CI loops).
if [ ! -f "$GLOBAL_SETTINGS" ]; then
  mkdir -p "$(dirname "$GLOBAL_SETTINGS")"
  echo '{}' > "$GLOBAL_SETTINGS"
  log_verbose "created empty stub $GLOBAL_SETTINGS (fresh install)"
fi
SNAPSHOT="$GLOBAL_SETTINGS.pre-setup-$(date +%Y%m%dT%H%M%S).bak"
cp "$GLOBAL_SETTINGS" "$SNAPSHOT"
log_verbose "snapshot: $SNAPSHOT"

# Prune old snapshots (keep latest 3)
# shellcheck disable=SC2012  # ls -t safe here: filenames are our own timestamped bak
SNAP_DIR="$(dirname "$GLOBAL_SETTINGS")"
SNAP_BASE="$(basename "$GLOBAL_SETTINGS").pre-setup-"
SNAP_OLD="$(ls -t "$SNAP_DIR"/"$SNAP_BASE"*.bak 2>/dev/null | tail -n +4 || true)"
if [ -n "$SNAP_OLD" ]; then
  echo "$SNAP_OLD" | while IFS= read -r f; do
    [ -n "$f" ] && rm -f "$f"
  done
  log_verbose "pruned old snapshots (kept latest 3)"
fi
phase_ok "phase 0/8: preflight"

# -- phase 1: fetch pinned caveman ---------------------------------------------
phase_start "phase 1/8: fetch caveman sources"
run_phase_cmd node "$REPO_DIR/scripts/fetch-caveman.js"
phase_ok "phase 1/8: fetch caveman sources"

# -- phase 2: npm install ------------------------------------------------------
phase_start "phase 2/8: install npm dependencies"
cd "$REPO_DIR"
run_phase_cmd npm install --silent
phase_ok "phase 2/8: install npm dependencies"

# -- phase 3: slash commands ---------------------------------------------------
phase_start "phase 3/8: install slash commands"
run_phase_cmd node "$REPO_DIR/scripts/install-commands.js" install
phase_ok "phase 3/8: install slash commands"

# -- phase 4: openwolf config --------------------------------------------------
phase_start "phase 4/8: configure .wolf/ locations"
run_phase_cmd node "$REPO_DIR/scripts/openwolf-prompt.js" "${FORWARD_ARGS[@]}"
phase_ok "phase 4/8: configure .wolf/ locations"

# -- phase 5: fetch openwolf ---------------------------------------------------
phase_start "phase 5/8: fetch openwolf sources"
run_phase_cmd node "$REPO_DIR/scripts/fetch-openwolf.js"
phase_ok "phase 5/8: fetch openwolf sources"

# -- phase 6: compile openwolf -------------------------------------------------
phase_start "phase 6/8: compile openwolf TypeScript"
run_phase_cmd npm run build:openwolf --silent
phase_ok "phase 6/8: compile openwolf TypeScript"

# -- phase 7: merge settings ---------------------------------------------------
phase_start "phase 7/8: merge ~/.claude/settings.json"
run_phase_cmd node "$REPO_DIR/scripts/merge-settings.js" \
  --settings "$GLOBAL_SETTINGS" \
  --repo "$REPO_DIR"
phase_ok "phase 7/8: merge ~/.claude/settings.json"

# -- phase 8: init .wolf/ ------------------------------------------------------
phase_start "phase 8/8: initialize .wolf/ directories"
run_phase_cmd node "$REPO_DIR/scripts/openwolf-init.js"
phase_ok "phase 8/8: initialize .wolf/ directories"

# -- done ----------------------------------------------------------------------
CURRENT_PHASE=""
trap - ERR
echo "[setup] complete. verify with: npm run doctor"
echo "[setup] start dashboard:  npm run dashboard"
echo "[setup] view savings at:  http://127.0.0.1:3847"

if [ "$NON_INTERACTIVE" -eq 1 ]; then
  echo "[setup] non-interactive: running doctor"
  node "$REPO_DIR/scripts/doctor.js" || exit $?
fi
