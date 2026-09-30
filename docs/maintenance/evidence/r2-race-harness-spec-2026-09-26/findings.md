# Send-race harness specification: why live staging needs owner control — 2026-09-26

Specifies (not builds) the missing precondition for a live two-renderer
Send-vs-edit race. No product code changed; no gap change (stays **2**).
§10 item 70 owns status. No provider involvement.

## Finding (verified against current sources)

The race window is reserve→release inside turn acceptance
(`createSharedDraftAccess.reserve` → adapter dispatch with the bound
command → `release` on acceptance), i.e. milliseconds — not the whole
turn. The fixture answers acceptance immediately, so no interleave of two
live sends can deterministically land in one revision: the second send
always sees the restarted revision and becomes a normal second turn
(correct behavior, not the race). Delaying fixture turn *completion* does
not open the window (release keys off acceptance, verified in
`agent-window-omp.mjs`: `prompt` acks accepted at once, completes 250 ms
later). The same-revision behaviors themselves are fixture-proven
(r2-send-reservation: first-bound command returned to a second window,
409 on different text, release honoring revision).

## Specified slice (future, not started)

Deterministic live staging needs test-only controllability in the shared
draft owner (e.g. a gated hold between reserve and release), so window B
can reserve while window A's revision is still current. Acceptance for
that slice: same text → one command observed live across two renderers;
different text → 409 user-facing error with no second command; then remove
or gate the hold so it cannot ship open. No product-code hooks added here.

## Preserved

- D1–D5, `switchSession` open. Pin unchanged. Nothing committed;
  uncommitted tree preserved (`git diff --check` clean).
