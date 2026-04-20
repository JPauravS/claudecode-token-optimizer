# Roadmap

Deferred features ship only if post-launch issue volume justifies the maintenance cost. Each has an acceptable v1 workaround in place today.

## Deferred — gated on issue volume

| Feature | v1 workaround (shipped) | Promotion trigger |
|---|---|---|
| **Coexist mode with upstream caveman** — layer our hooks on top of a pre-existing upstream `JuliusBrussee/caveman` install instead of refusing | Installer detects upstream and refuses with uninstall instructions | >3 GitHub issues requesting it |
| **PM2 / launchd / systemd service install** — boot-time dashboard persistence | SessionStart-spawn hook auto-starts dashboard every Claude Code session; covers ~99% of real usage | >5 users asking for true boot persistence |
| **Dashboard health badge** — UI tile showing hook-install health, doctor results, auto-start status | `npm run doctor` CLI surfaces the same data | Post-launch feedback |
| **Doctor-in-teardown** — run `npm run doctor` automatically after `teardown.sh` to verify clean state | Manual one-line instruction in teardown output | Stale-state bug reports |
| **`share-bundle.sh` tarball exporter** — produce a portable install bundle for air-gapped / private-share scenarios | Public repo + `git clone` obsoletes the need | Corporate air-gap requests |

## Near-term planned

- **Codex → buglog ingestor** (~150 LOC). Parses `/codex review` markdown findings → `buglog.json` entries tagged `code-review-suggestion` + `project_origin` scope. Closes gap where codex findings don't flow into dashboard buglog. User-triggered, quota-safe.

## Longer-term — Model cascade

Hook-driven runtime tier suggestions. Task-signal analysis → emits per-turn model recommendation (Haiku vs Sonnet vs Opus). Cascade tab in dashboard. Design not yet firm.

## Non-goals

- **Telemetry / phone-home** — privacy stance: never.
- **Auto-sudo distro package installs** — security risk; installer prints commands, user runs them.
- **npm package publish** — git-clone keeps the pin story simple for v1.
- **Promoting `setup.sh` publicly** — paste-in Claude Code prompt is the sole advertised install path. The script remains available for auditors and CI users who read the README footer.
