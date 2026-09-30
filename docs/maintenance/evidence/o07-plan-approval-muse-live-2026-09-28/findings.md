# O07 live Muse plan-approval proof — 2026-09-28

## Scope

Exercise approval of a provider-backed OMP `xd://propose` review through the CEDIA host's owner-only
plan route, then verify the resulting OMP turn completion in the host's authoritative in-process
event journal. The proof runs on isolated scratch project/state directories without launching the
packaged app.

## Result

- Before dispatch, OMP `18.1.18` was source-attested: source revision
  `00085d4e7dfdcfbf302c122fa2682b410a0f43d1`; tree
  `7e0ac3862e0c849b4467c508b8b3c175217968cc`; patch-manifest SHA-256
  `246014bfe03ee7dbf1e6f2034c4e7df516b2a43919228f183811ea3fc2fb0431`; executable SHA-256
  `f78a41a46ca6f76240f4e0c6c07dcc9b6537823babbe97cc5872cdc435a1c107`; Bun SHA-256
  `35d20dd0263e5c950194434b925454fdfa9ba6e4467da960410fa05b08a7a5b5`; native SHA-256
  `05774ec09950a150b7c1cce63359bd26ed6d3eecc44a6261e09e9403371e7869`.
- The host selected/read back `opencode-go/muse-spark-1.3-contributor`; provider metadata reported
  authenticated and available before a user prompt was dispatched.
- In the final corrected run, one user prompt produced a live `xd://propose` review. The operator
  inspected the proposal in the live TTY and approved after verifying it requested a two-sentence
  text response without code or project-file changes. The proposal text was not retained (851
  characters; SHA-256
  `fd4838d62f534d8889d004b9d9a3b8ca5d5e5f06a2980c42a1796fb251c07823`).
- The owner-only host plan route accepted approval and cleared the pending review. Reading events
  directly from `started.host.store.readEvents(...)` then found terminal `agent_end` at sequence
  `445`. The isolated scratch project remained empty.
- There were three provider prompts across three independent isolated runs, with no internal retry:
  1. The first run produced a review and accepted approval, but its older event-route cursor/read
     path failed to observe completion within 180 seconds. The approval postcondition was
     inconclusive; this was a proof-harness failure, not evidence of a failed OMP turn.
  2. The second run stopped before approval because the assumed cursor was absent from that route.
  3. The corrected run sourced events from the host's authoritative in-process journal and passed.
- Scratch state was cleaned up. No packaged app, Login Item, Keychain, physical device, commit or
  push was used.

## Verification

- `bun scripts/omp-plan-review-muse-live-proof.ts`: **PASS** on the final corrected run; approved
  review cleared and terminal `agent_end` observed at sequence 445.
- `bun test upstream/omp/packages/coding-agent/test/interactive-mode-plan-review.test.ts upstream/omp/packages/coding-agent/test/modes/controllers/event-controller-plan-approval-dispatch.test.ts`:
  **63 pass, 0 fail, 196 expectations**.
- `bun test upstream/omp/packages/coding-agent/test/cedia-plan-bridge.test.ts apps/host/test/omp-progress.test.ts`:
  **25 pass, 0 fail, 99 expectations**.
- `bun scripts/omp-plan-mode-smoke.ts`: **PASS** for plan-mode transitions, host route,
  authentication/refusal and idempotency; it does not exercise a provider-generated proposal.
- Root `bun run typecheck`, `bun run check:repo`, `bun run check:omp-coverage --require-complete`,
  and `git diff --check` passed after the proof-runner correction and before this receipt was added.
- Proof-runner SHA-256: `747b5160c76b1f675f30775dbf646afa2547684743db83e53f08aee41e6f669d` at repository
  revision `0676dd70d54e429b5a72c98cb3f22a646bbd10eb` (dirty working tree).

## Limits

This proves one live host/runtime plan-approval case. It is not packaged review-panel evidence and
does not close the remaining O07 records, D, or F acceptance.
