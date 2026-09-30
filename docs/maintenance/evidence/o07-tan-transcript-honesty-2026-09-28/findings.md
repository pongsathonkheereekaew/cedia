# Tan child-transcript honesty fix and live proof — 2026-09-28

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty by design.
- Pinned runtime OMP `18.1.18`; development launcher `dist/omp/omp` restored this session,
  standalone binary attested (source tree `d0105be6509186319c7ae76249d1dc61932c7967`).
- Changed by this slice (all additions to this session's untracked O07 subagent surface, no
  committed file modified): `apps/host/src/omp-agents.ts` (empty-transcript refusal),
  `apps/host/test/omp-agents.test.ts` (new refusal/paging test),
  `scripts/omp-tan-smoke.ts` (corrected transcript-shape assertion). No provider call was made.

## What failed

A 31-script rerun of the O-packet fixture smokes on the current revision passed 30/31.
`bun scripts/omp-tan-smoke.ts` failed 3/3 at the honesty check, so this was not flake.
Two defects, one on each side:

1. Product: a tan child that has produced no output yet answered the owner-only transcript
   route `200` with `state: available` and `messages: []` — a silent empty that renders as
   nothing with no explanation.
2. Proof: the smoke asserted a non-empty `text` field, which does not exist in the
   `OmpAgentTranscriptSnapshot` shape (it carries `messages[]`), so even a readable
   transcript could never satisfy it.

## What changed

- `OmpAgents.transcript` now answers `state: unavailable` with reason
  `Agent <id> has not produced transcript output yet.` when the projected snapshot holds
  zero messages at `fromByte === 0`. A later page (`fromByte > 0`) reading past the end
  stays `available`, since that is paging, not absence.
- The vendor web layer already models `unavailable + reason` for this route, so the refusal
  renders as an explanation, not an empty view.

## Verification

- `bun test apps/host/test/omp-agents.test.ts`: 12 pass, 0 fail, including the new
  refusal/paging test.
- `bun run typecheck`: clean (one narrowing fix was needed for the union snapshot type).
- `bun scripts/omp-tan-smoke.ts`: PASS on the attested runtime — dispatch, roster with
  parentage, clone file on disk, readable running transcript (prompt echo), completed nowhere.
- `bun run test` (full root suite): rerun after the change; see HANDOFF current-turn rows.

## Limitations

- The live smoke exercises a hanging worker (dead model endpoint), so the empty-transcript
  refusal branch is covered by the unit test, not by a live run.
- A tan that finishes end to end still needs a real provider turn; packaged renderer
  observation of the Agents transcript surface and full O07/F acceptance remain open.
- `bun run check:repo` still reports the same 102 pre-existing dead links in historical
  `.scratch/cedia-direction` and brand-prototype evidence; none are in this receipt.
