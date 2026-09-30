# Selective intake batch 3: approval redaction, transport, restart recovery (#1305/#1306/#1307) — 2026-09-26

Assessment with bounded evidence additions. Two dispositions are NO-CHANGE
with proof; one adds a single framing test for an untested-but-present
invariant. No product behavior changed. No provider involvement. §10 item 70
owns status.

## #1305 approval redaction: NO-CHANGE (gap demonstrated absent) + pinning test

Our tree has no approval-parameter display path carrying tool payloads:

- The shared transcript reducer (`apps/macos/src/state.ts`) models zero
  approval kinds — verified by search.
- The adapter projects pending UI requests to a token-only shape
  (`pendingInteractions` in `apps/macos/agent-window/src/cedia-adapter.ts`):
  interactionKind, requestId, threadId, turnId, lifecycleGeneration, status,
  decision, responseCommandId, responseRequestedAt, createdAt, resolvedAt — no
  detail, permissionProfile, requestKind, or params.
- The approval card falls back without detail when those fields are absent.
- Existing settings/credential redaction (runtime-answered, host-enforced) is
  untouched; the journal keeps canonical OMP frames under the owner-local
  boundary.

New pinning test (`apps/macos/agent-window/test/adapter.test.ts`, green): a
raw UI request carrying secret-bearing params, nested auth headers, and
explicit detail/profile fields projects to the token shape only; the sentinel
value appears nowhere in the projection. This pins the invariant so any future
rich-payload forwarding fails loudly instead of displaying silently.

## #1306 transport framing: NO-CHANGE (invariants complete) + one test

`packages/omp-adapter/src/framing.ts` + `client.ts` already implement the
release's scope: chunk-backed NDJSON accumulation across arbitrary byte
boundaries, coalesced records per callback, 1 MiB per-frame cap (complete
lines, partial accumulation, and close-without-newline paths), blank-line
tolerance, fatal UTF-8/JSON errors into protocol failure (bounded memory, no
unbounded growth), v2 negotiation with ready-frame limit validation, command
mismatch/unknown-command refusal, request timeouts with dispatched/unknown
outcome, write-queue drain/close handling, and graceful TERM-then-KILL close
with stdio-drain accounting. No replay of mutations after uncertain outcomes.

New test (green): coalesced multi-record chunk, blank-line tolerance, and
finish-without-trailing-newline — the three present-but-unpinned behaviors.
Existing split-UTF8, oversize-rejection, and v2-sequence tests already pinned
the rest. No Synara transport code imported; OMP NDJSON/v2/limits/
`cedia_control` semantics preserved byte-for-byte.

## #1307 restart recovery: NO-CHANGE (complete, tested)

`DurableStore.recoverPending()` (`apps/host/src/store.ts`) settles
restart-orphaned work in one synchronous transaction at open: claimed/
acknowledged commands become `outcome_unknown`, prepared/queued intents become
`needs_continue` (paused for explicit Continue, never replayed), running
intents become `outcome_unknown`, running sessions (or sessions with
unfinished commands) become `recovery_required`. No background reactors exist
to race it; OMP stays the transcript truth and CEDIA never invents an
outcome. Already covered by `apps/host/test/store.test.ts` (reopen asserts
unknown outcome, recovery_required, replay refusal). No new test needed.

## Proof

- New tests: framing 1 (green), adapter pinning 1 (green).
- `git diff --check`: clean. No product files touched in this batch.
