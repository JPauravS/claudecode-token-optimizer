#!/usr/bin/env bash
# Uninstall script.
# - Stops dashboard via PID file
# - Restores ~/.claude/settings.json from .bak (if present)
# - Removes node_modules

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
GLOBAL_SETTINGS="$HOME/.claude/settings.json"
PID_FILE="$REPO_DIR/dashboard/data/dashboard.pid"

# detect non-interactive environments — no unguarded reads
# parse --yes as its own flag (not by checking $1 positionally — order-
# dependent bug). Both `teardown.sh --yes --non-interactive` and
# `teardown.sh --non-interactive --yes` must produce the same behavior.
NI="${NON_INTERACTIVE:-0}"
YES=0
for a in "$@"; do
  case "$a" in
    --non-interactive) NI=1 ;;
    --yes) NI=1; YES=1 ;;
  esac
done
[ -n "${CI:-}" ] && NI=1
[ ! -t 0 ] && NI=1
NON_INTERACTIVE="$NI"

echo "==> Combined Claude Stack — teardown"
echo

# 0. Remove global slash commands (only if they match our body)
echo "==> Removing slash commands"
node "$REPO_DIR/scripts/install-commands.js" uninstall
echo

# 1. Stop dashboard
if [ -f "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE" | tr -d '[:space:]')"
  if [ -n "$PID" ]; then
    echo "==> Stopping dashboard (pid $PID)"
    kill "$PID" 2>/dev/null || echo "   (process not running)"
  fi
  rm -f "$PID_FILE"
else
  echo "==> Dashboard not running (no pid file)"
fi
echo

# 2. Restore settings.json
# preserve user's current settings.json as .pre-teardown before overwrite,
# so manual edits made since install are recoverable.
if [ -f "$GLOBAL_SETTINGS.bak" ]; then
  if [ -f "$GLOBAL_SETTINGS" ]; then
    cp "$GLOBAL_SETTINGS" "$GLOBAL_SETTINGS.pre-teardown"
    echo "==> Saved current settings as $GLOBAL_SETTINGS.pre-teardown (recover manual edits from here)"
  fi
  echo "==> Restoring $GLOBAL_SETTINGS from .bak"
  mv "$GLOBAL_SETTINGS.bak" "$GLOBAL_SETTINGS"
else
  echo "==> No settings.json.bak found — skipping restore"
  echo "   (hook entries remain in $GLOBAL_SETTINGS — remove manually if needed)"
fi
echo

# 3. Remove node_modules
if [ -d "$REPO_DIR/node_modules" ]; then
  echo "==> Removing node_modules"
  rm -rf "$REPO_DIR/node_modules"
fi
echo

# 4. Optional: remove .wolf/ directories
CFG="$REPO_DIR/dashboard/data/openwolf-config.json"
if [ -f "$CFG" ]; then
  # generalize drive-letter conversion so D:/E:/… workspaces also
  # resolve. Was `s/^C:/\/c/` (C: only).
  # drop GNU-sed `\L` (BSD sed on macOS silently skips) — use `tr`
  # pipeline instead so Windows-path entries resolve on any POSIX system.
  WS_PARENT=$(grep '"workspace_wolf_parent"' "$CFG" \
    | sed -E 's/.*: "//;s/".*//;s/\\\\/\//g' \
    | sed -E 's|^([A-Za-z]):|/\1|' \
    | awk '{ if (match($0, /^\/[A-Za-z]/)) { print tolower(substr($0,1,2)) substr($0,3) } else { print } }')

  # v2 config has projects[] — auto-discover every .wolf/ under
  # workspace parent and prompt. Falls back to project_default (v1) when
  # projects[] absent.
  PROJECT_WOLVES=()
  if [ -n "$WS_PARENT" ] && [ -d "$WS_PARENT" ]; then
    # Enumerate any sibling with .wolf/ seeded (works for v1 and v2).
    while IFS= read -r -d '' wolfdir; do
      PROJECT_WOLVES+=("$wolfdir")
    done < <(find "$WS_PARENT" -maxdepth 2 -type d -name '.wolf' -print0 2>/dev/null)
  fi

  if [ -n "$WS_PARENT" ] || [ ${#PROJECT_WOLVES[@]} -gt 0 ]; then
    echo "==> .wolf/ directories detected:"
    [ -n "$WS_PARENT" ] && [ -d "$WS_PARENT/.wolf" ] && echo "    workspace: $WS_PARENT/.wolf"
    for pw in "${PROJECT_WOLVES[@]}"; do
      # Skip the workspace-level .wolf to avoid double-listing.
      if [ "$pw" != "$WS_PARENT/.wolf" ]; then
        echo "    project:   $pw"
      fi
    done
    REPLY="N"
    if [ "$NON_INTERACTIVE" = "1" ]; then
      # use parsed YES flag instead of positional $1 — works regardless
      # of arg order (`--yes --non-interactive` or `--non-interactive --yes`).
      if [ "$YES" = "1" ]; then
        REPLY="y"
      else
        echo "==> non-interactive: preserving all .wolf/ directories (pass --yes to delete)"
      fi
    else
      printf "==> Delete ALL listed .wolf/ directories? [y/N]: "
      read -r REPLY
    fi
    if [ "$REPLY" = "y" ] || [ "$REPLY" = "Y" ]; then
      [ -n "$WS_PARENT" ] && [ -d "$WS_PARENT/.wolf" ] && rm -rf "$WS_PARENT/.wolf" && echo "    removed $WS_PARENT/.wolf"
      for pw in "${PROJECT_WOLVES[@]}"; do
        if [ "$pw" != "$WS_PARENT/.wolf" ] && [ -d "$pw" ]; then
          rm -rf "$pw" && echo "    removed $pw"
        fi
      done
      rm -f "$CFG"
      echo "    removed $CFG"
    else
      echo "    preserved (run manually to delete later)"
    fi
  fi
else
  echo "==> openwolf-config.json not found — no .wolf/ cleanup needed"
fi
echo

echo "==> Teardown complete."
echo "    verify clean state: npm run doctor"
