# O03 provider-paths live proof (opencode-go) — 2026-09-29

## Result

`bun run smoke:provider-accounts-live`
(`scripts/omp-provider-accounts-live-proof.ts`) passed on attested OMP
18.1.18 (source tree `d0105be6509186319c7ae76249d1dc61932c7967`).
One host-backed session, read-mostly, no credit spend, no model turn.

## Truth found: opencode-go has no OAuth accounts to pin

- `GET /v1/providers`: `opencode-go` authenticated + available (real profile).
- `GET /v1/sessions/:id/accounts` after exact model selection:
  `available: true, supported: true, provider: opencode-go, accounts: []`
  — zero rows, zero token material (regex-checked). The user's opencode-go
  auth is API-key, not OAuth; an empty list is the honest runtime answer.
- Earlier probe note: a different launcher path answered `supported: false`
  for the same provider/HOME — auth-storage path resolution differs by
  launcher, recorded as environment-dependent, not asserted.
- `POST .../accounts/pin` with unknown `credentialId`:
  `pinned: false` + refreshed list — honest refusal path live.
- `POST .../service-tier {family: openai, tier: default}` → 200, reads back
  in `GET .../model-state` — live vocabulary set + readback.
- A *successful* OAuth pin is unprovable here by fact (no OAuth account
  exists on this provider); that row stays open, not as a code gap but as a
  missing fixture. Fixture pin-accept shape is already covered by the
  `omp-model-state-smoke` refused-pin + replay checks.

## Limits

- No credit spend, no model turn, no saved-reset redemption (still open).
  O03/F acceptance stays open.
