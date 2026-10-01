# O08 CLI discovery UI, CEDIA-side half — 2026-10-01

## Result

PASS. The owner-listing route (`GET /v1/owners`) finally has a client: the
mobile/remote-web app ships an "Elsewhere on this Mac" section listing exactly
the discoverable owners (live, stale, conflicting; idle tasks stay in the task
list), with Attach offered only for controller-capable live owners. Attach
starts the task, which adopts the live owner in place through the existing
`startSession` path; viewing navigates to the task transcript and never needs
the owner. No OMP change: all routes and adoption flows already existed.

- `apps/ios/src/core/owners.ts`: strict `GET /v1/owners` parser (unknown
  shapes refused, modeless identities stay controller-capable) + row
  projection (Live / View only / Ended / Elsewhere / Idle).
- `CediaApi.listOwners()` + `owners` state/reducer + dashboard section with
  Attach (⎘) for controller owners; best-effort refresh (a 403 for
  non-owner devices clears the list without touching the connection).
- `scripts/omp-owners-contract-proof.ts`: live host + prepared 18.4.8
  runtime, one attached + one absent session; route→parser→projection→adopt
  verified, zero provider calls.

Verification: ios suite 177/177 (25 files, incl. 5 new parser/projection
tests), ios typecheck clean, contract proof 8/8 OK. No pixels captured: the
web-export + pairing harness for a rendered capture is still open, as is the
OMP-side owner endpoint for externally started CLI sessions (§8.2 O08).

## Limits

Externally started CLI/TUI sessions (never registered in the host store) are
still undiscoverable — that half needs the OMP-side owner endpoint publish
tracked under O08. Stale/conflict rows show the host's bounded reason and
offer no action by design.
