# Absence-copy check: upstream remedy does not transfer — 2026-09-26

Closes reusable item 2 from the #1166 differential (batch 10): compare
upstream's empty-catalog remedy copy against CEDIA's honest-absence states.
No product code changed; no gap change (stays **2**: `switchSession`,
`browser-relay`). §10 item 70 owns status. No provider involvement.

## Comparison (source-quoted, current tree)

- Upstream (`Layers/OmpAdapter.ts`, model/list): empty discovery answers
  "OMP model discovery returned no models. Run `omp` to authenticate so
  ~/.omp credentials exist." The remedy fits its mechanism: it spawns `omp
  models --json`, so an empty catalog means the CLI context is
  unauthenticated.
- CEDIA (`apps/host/src/service.ts:189-191`): "No OMP runtime is running;
  Cedia reads [the capability table / OMP settings] from a live session
  runtime." Same honest shape (name the missing thing + where it is read
  from), but a different fact: no live runtime means no session exists yet,
  so "run `omp` to authenticate" would be the wrong remedy — the fix is
  opening a task, not terminal authentication.
- CEDIA's empty-catalog path (`apps/macos/src/omp-catalog.ts`,
  `fetchOmpModelSnapshot`): a fetch failure leaves `models: []` so the
  picker stays honest-disabled, and logs the failed operation
  ("Cedia could not list OMP models: …"). Auth guidance lives where it
  belongs: the login-providers fetch in the same path, not a blanket
  authenticate sentence. CEDIA's catalog cache
  (`apps/host/src/model-catalog.ts`, 30 s TTL) already caches only
  successful reads — the anti-stale half of upstream's discovery cache
  without the staleness risk.

## Verdict

No copy adopted. The remedy sentence is mechanism-bound and does not
transfer; CEDIA's reasons already distinguish no-runtime (open a task)
from fetch-failure (logged operation) from auth (login providers). A
user-visible empty-with-reason picker state remains future surface work,
not a copy fix.

## Proof

- `bun test apps/host/test/model-catalog.test.ts`: 2 pass, 0 fail
  (20 expects) — discovery/normalization and cache-only-successful,
  this turn.
- `git diff --check`: clean.

## Preserved

- D1–D5, deferred voice, `switchSession` open, single OMP
  execution/transcript/auth owner. Pin unchanged. Nothing committed;
  uncommitted tree preserved.
