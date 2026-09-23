# Security notes

## Hardening (2026-09-16)
- Container runs as non-root (`USER node`, uid 1000) — see Dockerfile.
- `npm audit fix` applied (non-breaking) — server-side high-severity issues cleared.
- docker-compose volume pinned as `name: mangva-data`.
- Rollback image: `mangva:pre-harden-20260916-035949`. Backups: `*.bak-*` in this dir.

## Accepted risks (intentionally left in)
Two advisories remain in **react-router / react-router-dom** (the only vulns that ship to the browser):
- **GHSA-wrjc-x8rr-h8h6** (moderate) — open redirect via backslash in `<Link>`/`useNavigate`.
  Only reachable if untrusted input drives navigation (e.g. a `?redirect=` param). Low exposure
  with fixed internal routes.
- **GHSA-337j-9hxr-rhxg** (CVSS 6.1) — constructor injection via `deserializeErrors()` during
  SSR hydration. Not applicable: this is a client-side SPA (no SSR), so the path is never hit.

Decision: **accepted / not fixing for now.** The fix is a semver-major `react-router-dom`
v6 -> v7.18.4 upgrade (breaking frontend change); revisit as normal maintenance, test in dev.

Note: a full `npm audit` also lists build-time dev tooling (vite, esbuild, postcss,
browserslist, @babel/core, puppeteer build helpers, nanoid). Those run at build time only —
not shipped to browsers, not executed by the running server.
