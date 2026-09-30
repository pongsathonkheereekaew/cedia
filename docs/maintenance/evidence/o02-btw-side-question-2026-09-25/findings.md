# Slice (O02 side question): ask without touching, promote by forking — 2026-09-25

`/btw` asks an ephemeral question against the session context: the answer never
touches the transcript, and promoting it forks the session file through the session's
own branch path. The terminal carries this in its overlay controller; Cedia carries it
as its own composer Side-question panel over three registered operations
(`btw.state.get` controller read, `btw.ask` + `btw.branch` owner writes) with the
answered question held server-side between ask and branch — the same hold the
terminal keeps between its overlay answer and the `b` key. Gap count **27 → 25**
(O02 slash 5 → 4 via `btw`; O02 sdk 3 → 2 via `branchFromBtw`).

## What was built

- Runtime (`upstream/omp`, pinned `omp/18.1.18`): `cedia-btw-bridge.ts` —
  `createCediaBtwBridge({session})` with `ask` (same rendered kickoff + the session's
  own `runEphemeralTurn`), `read` (idle/answering/ready/failed, bounded echo+answer,
  branchable with the reason when not), and `branch` (the session's own
  `branchFromBtw` with the held objects, answering the branched file; a consumed
  answer resets to idle like the terminal disposing). The wire carries bounded text
  only; the full question and assistant message never leave the runtime.
  `cedia-btw-bridge.test.ts` (8 pass, driving session doubles through ask, failed
  ask, cancel-kept, truncation, and the table contract).
- Host (`apps/host/src/omp-btw.ts`): strict parses, `OmpBtw` projection,
  controller-visible `GET /v1/sessions/:id/btw`, owner-only durable
  `POST .../btw/ask` and `POST .../btw/branch`. On a successful branch the host
  adopts the branched session file the runtime names (owned-path assertion +
  record update, mirroring the new_session/switch_session/branch adoption), so
  windows follow the conversation where it continues. `omp-btw.test.ts` (5 pass,
  including a fixture round trip that asks, promotes into an adopted file, refuses
  the second branch, and returns to idle).
- Window: `CediaBtwSurface.tsx` (question input, Ask, bounded answer, Branch with
  confirmation copy, Copy, per-half errors, branched notice) mounted in the composer
  panel stack; query/mutation options + strict parses in `serverReactQuery.ts`;
  `getBtw`/`askBtw`/`branchBtw` in `cedia-adapter.ts` + native exposure.
  `btw-side-question.test.tsx` (7 pass, including the answering poll rule).

## Design correction made mid-slice (the important one)

The first version awaited the ephemeral turn inside `ask`, occupying the call until
the answer settled. A dead-endpoint probe showed the failure takes ~31 s (OMP's
retry budget) — past the host's 30 s control timeout — and a hung endpoint would
hold it indefinitely. There is no per-model timeout worth tuning: even success takes
a whole model turn. So the bridge now matches the terminal, which fires the run
without awaiting it: `ask` answers the answering state at once, the held outcome
lands later, the panel polls `btw.state.get` while answering (2 s, terminal states
never poll), and the durable ask receipt is the acceptance — the answer is read from
the state, which keeps moving after the receipt is stored. The unit tests caught a
real snapshot bug in the first version on the way (`return read()` evaluated before
`finally` cleared the running flag, freezing the state at answering).

## Live proof (prepared runtime, dead endpoint, no provider request anywhere)

`bun scripts/omp-btw-smoke.ts` (19 checks): idle reads with nothing held; the ask
dispatches at once; the failure lands with the runtime's own error and holds no
branch; branching with nothing held is refused before forking; host routes hold
(controller read-only, owner ask/branch, replay, 400s, 409); the fixture round trip
in the host tests proves the answered-then-branched path including file adoption.
Reaching a real answer plus a real branch live needs a provider turn — fixture-proven
and renderer-tested, honestly open.

## Still open

- A live answered-then-branched run (needs a provider turn).
- Aborting a running ask has no control (the TUI's Esc): a hung ask rides out the
  retry budget; closing the session kills it. Named, not built.
- O02 `cleanse`, `omfg`, `tan`, `move`/`moveSession`/`switchSession` remain gaps.

## Evidence (this revision and build)

- `bun scripts/omp-btw-smoke.ts`: all 19 checks pass.
- Upstream btw/capability/model-state bridges (38 pass); `check:types` clean.
- Host suite 418 pass / 0 fail; agent-window suite 335 pass / 0 fail; root typecheck clean.
- `bun run check:omp-coverage`: integrity PASS, gap count **25** (was 27).
- Patch regen is faithful to the worktree (spot-audited); runtime re-prepared with attestation.
- `git diff --check`: clean.
