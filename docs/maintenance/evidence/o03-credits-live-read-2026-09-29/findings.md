# O03 saved-reset credits live read (no spend) — 2026-09-29

## Result

`GET /v1/sessions/:id/credits` against the real authenticated `opencode-go`
provider answers live (no fixture, no mock):

```json
{"state":"available","revision":1,"accounts":[{
  "credentialId":4,
  "accountId":"82649042-c77b-45de-a239-a5f84d700693",
  "email":"pongsathon.dev@pm.me",
  "availableCount":0,"credits":[],"active":true}]}
```

## No-spend decision (owner-directed)

- `availableCount: 0`, `credits: []` — there is nothing to redeem. Owner
  chose not to fire the redeem call; the receipt records the live read as the
  proof that the path is available and honest.
- The redeem wire itself (`POST .../credits/redeem` → owner-only,
  single-account target, `confirm: true` on the runtime request) is already
  covered by `apps/host/test/omp-credits.test.ts` (reads + redeems through
  negotiated controls with wire confirmation, replay, malformed-body and
  method refusals — 8 tests green in the finish-all survey).
- A successful live spend remains unproven by fact (zero balance + no
  authorization to manufacture one). O03/F stay open on that row only.
