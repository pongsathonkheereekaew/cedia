# O05 two-client single-winner approval — 2026-09-29

## Result

New host test `lets exactly one of two competing clients win a single
confirm request` passes (`apps/host/test/service.test.ts`, 44/44 green):
one `select` permission request, owner answers first (`completed`), second
client's same-token answer lands `not_dispatched`, exactly one
`fixture_permission_outcome` (`allow_once`) in the journal.

## Mechanism (no new code)

- Winner claims the broker token via `ExtensionUiBroker.respond`
  (`packages/omp-adapter/src/ui.ts:388` takes the pending request before
  send); the loser's same-token answer hits `stale-response` → host maps to
  `not_dispatched` (`service.ts:4594`), never dispatched to OMP.
- Distinct `commandId`s per client keep durable receipts separate; the
  loser's row stays `not_dispatched`, so no replay ambiguity.

## Update (same day): loser receipt carries the refresh marker

The host `respond` path now maps the broker's `stale-response` code to a
`not_dispatched` receipt whose error says `The UI request was already
answered.` — the vendor's `APPROVAL_ALREADY_ANSWERED_INVARIANT_MARKER`
verbatim. The loser's window therefore treats the receipt as a refresh
instruction (existing `useChatPendingInteractions` handler) instead of a
generic failure. The test asserts the marker text on the loser receipt.
Product change: 8 lines in `apps/host/src/service.ts`; `service.test.ts`
44/44, root typecheck clean.

## Limits

Fixture `select` permission only, not a live `confirm` card; no renderer or
  packaged capture. Closes one O05 §8.2 fixture row, not O05/F acceptance.
