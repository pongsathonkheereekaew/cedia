# Addendum 2026-09-25: host handle registry retired (deleted, not wired)

`apps/host/src/omp-browser-tabs.ts` (+ its 6 tests) was removed the same day it landed.
Reason, verified by grep: zero importers outside its own module — the OMP-facing
carrier arrived through a different, already-enforced path (per-thread CDP endpoint in
the Electron main process + global `browser.cdpUrl` steering + route-level guard), so
the registry was bookkeeping without enforcement. Keeping it would have been dead code
wearing a contract's clothes.

The O10 packet's "scoped opaque resource ID" is satisfied without it: attach returns
the tab's `randomUUID` id, scoped by the per-thread endpoint that is the only
discovery surface serving it. URL-revision staleness cannot arise because no handle
embeds a URL; navigation is observed live per request.

Personal-profile precedence checked read-only the same day: no `browser:` section in
`~/.omp/agent/config.yml`, so defaults apply — relay off, cmux on, cdpUrl unset. OMP
resolves relay → cdpUrl → cmux → headless, so steering onto the agent endpoint wins
exactly when set and costs nothing when cleared. No profile change made.

Count reconciliation: the full host suite read 443 with the registry's 6 tests
included; after this deletion it reads 437 across 54 files, all passing. The "443"
in neighboring ledger rows stays true as written — it predates the removal.
