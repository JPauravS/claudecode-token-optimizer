---
description: OpenWolf status, scan, or bug query
---

# /openwolf

Run openwolf subcommands against the dual `.wolf/` install.

**Subcommands:**
- `/openwolf status` — health report (both workspace + project `.wolf/`)
- `/openwolf scan`   — refresh `anatomy.md` for current project
- `/openwolf bug <query>` — search buglog

**Usage:** Claude will run the mapped npm script via Bash:
- `status` → `npm run wolf:status`
- `scan`   → `npm run wolf:scan`
- `bug`    → `npm run wolf:bug -- <query>`

Arguments are passed after `--`. No argument defaults to `status`.
