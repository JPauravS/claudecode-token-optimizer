# Security Policy

## Supported versions

Only `main` is actively maintained. Pinned vendored dependencies (caveman @ `c2ed24b3`, openwolf @ `bd69835`) are refreshed via `scripts/fetch-*.js`; report issues in vendored code to the upstream repositories directly.

## Reporting a vulnerability

Use GitHub's **Report a vulnerability** button on the [Security tab](https://github.com/JPauravS/claudecode-token-optimizer/security/advisories) to open a private advisory.

Best-effort acknowledgement — this is a solo-maintainer project. No fixed response SLA.

## Scope

**In scope:**
- Our own code in this repo (installer, hooks glue, dashboard, scripts, patches)
- Privilege-escalation or arbitrary-code-execution via `setup.sh`, `teardown.sh`, or any `scripts/*.js`
- Unintended network exposure from the dashboard

**Out of scope:**
- Vulnerabilities in vendored upstream code — report to [`JuliusBrussee/caveman`](https://github.com/JuliusBrussee/caveman) or [`cytostack/openwolf`](https://github.com/cytostack/openwolf) directly
- User-installed third-party Claude Code configurations
- Transitive dependency vulnerabilities surfaced at `npm install` (use `npm audit` locally)
- Anything requiring attacker-controlled write access to the user's machine

## Disclosure posture

Coordinate via the private advisory. No fixed timeline. Dashboard binds `127.0.0.1` only; telemetry is zero — most user-data exposure scenarios don't apply by design.
