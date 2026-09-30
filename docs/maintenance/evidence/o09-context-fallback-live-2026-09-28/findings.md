# O09 live compaction fallback — 2026-09-28

Bounded F semantic evidence for one O09 retry/fallback transition: provider-native remote
compaction returns a real HTTP 503, then OMP advances to the configured soft compaction method.
This does not close O09 or F and makes no packaged, web, iPhone, automatic-maintenance or
external-provider claim. The earlier cancellation case is separate evidence and was not repeated.

## Live observation

`bun scripts/omp-context-fallback-smoke.ts` passed against the prepared OMP `18.1.18`
development-source launcher. An isolated CEDIA host and task used a loopback OpenAI-compatible
fixture. The runtime made exactly five requests:

1. One successful seed turn at `/v1/chat/completions`.
2. One provider-native attempt at `/v1/responses/compact`, answered by the fixture with HTTP 503.
3. Two local soft-summary requests at `/v1/chat/completions` (the seeded conversation remained
   the active turn prefix).
4. One successful follow-up turn at `/v1/chat/completions`.

The host accepted `/compact` through its owner command route and the command reached `completed`.
The owner context snapshot returned `state: available` and `compacting: false`. The host's event
journal contained OMP's bounded warning, `remote compaction failed; trying the next preferred
method`. The durable OMP session file contained exactly one compaction entry; its method was
`soft`, and its summary contained the fixture's recovered summary text. A follow-up turn was
accepted and completed. This shows that the failed remote attempt produced no ghost commit and
the successful fallback committed once before the session resumed.

No credentials, external model service, packaged app, Keychain, Login Item or paid inference were
used. The user-visible observation is the actual OMP warning frame recorded in the host journal;
no renderer or packaged panel was launched.

## Harness correction log

The first attempts exposed assertion defects in this new smoke harness, not runtime failures:

- One wait returned a boolean but compared it as a request count, so it timed out despite OMP
  reaching fallback. The wait now reads the numeric request count.
- An intermediate assertion required the asynchronous `/compact` command to remain `claimed`
  after the fallback request appeared. The operation may already be complete by then; the smoke
  now checks the route acknowledgement and final durable `completed` state.
- The first summary assertion expected bare fixture text. This seed was a turn prefix, so OMP
  correctly stored its split-turn wrapper around the summary; the assertion now checks the
  durable method and included summary text.
- The initial request-count expectation missed OMP's second soft-summary request for the split
  turn. The final exact path ledger asserts one seed, one failed remote attempt, two soft-summary
  requests and one follow-up. The final run passed every assertion.

No OMP production change was exposed or made in this slice.

## Verification

- `bun scripts/omp-context-fallback-smoke.ts` — PASS; `ok: true`, OMP `18.1.18`, five fixture
  requests, one durable soft compaction entry.
- `bun run typecheck` — PASS at the CEDIA root.
- `bun run check:repo` — PASS; `CI-OK parents=198 ui=75 children=129 lock-shas=3 doc-links=804 md=344 evidence=311`.
- `bun run check:omp-coverage --require-complete` — PASS; 1,041/1,041 audited mappings,
  zero fatal issues, F source completeness green (not full F acceptance).
- `git diff --check` — PASS.
- The smoke asserts owner command acceptance/completion, owner context availability and idle
  state, the OMP fallback warning in the host journal, exactly one durable commit, and a
  completed follow-up turn. Its only network listener binds to `127.0.0.1`.

## Runtime attestation

- Runtime: `development-source-launcher`, OMP `18.1.18`; source verified.
- Pinned source revision: `00085d4e7dfdcfbf302c122fa2682b410a0f43d1`
- Verified source tree: `46a035a378569e81ed55bb065de6f7c858276489`
- Launcher SHA-256: `f78a41a46ca6f76240f4e0c6c07dcc9b6537823babbe97cc5872cdc435a1c107`
- Patch manifest SHA-256: `fce3ed0f89e40ee9f25558bb1f865bf24e80be06b9d931486d5fbf986832fac5`
- Pinned patch SHA-256: `0d05ce6796f83633ec498c78f3a0ed71e6b139c5c5dd0ec989d0b241ddad760e`
- Bun SHA-256: `35d20dd0263e5c950194434b925454fdfa9ba6e4467da960410fa05b08a7a5b5`
- Native executable SHA-256: `05774ec09950a150b7c1cce63359bd26ed6d3eecc44a6261e09e9403371e7869`

This receipt proves one manual O09 remote-to-soft compaction fallback. It does not prove
fallback after cancellation, auto-compaction retry policy, other context or memory controls,
packaged UI behavior, real provider inference, or F acceptance.
