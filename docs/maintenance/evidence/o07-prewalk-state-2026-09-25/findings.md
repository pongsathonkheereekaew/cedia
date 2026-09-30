# Slice (O07 prewalk state): `getPrewalkState` read from session to status chip

A complete vertical for the last O07 SDK row: the pinned runtime registers a read-only
`prewalk.state.get` operation, the host projects it through an owner-visible route, and
the composer shows an armed chip beside the model picker. No provider, no turn, no
management write is involved at any step.

## Runtime (upstream, pinned patch regenerated)

- `cedia-prewalk-bridge.ts` (new): `readCediaPrewalkState` projects
  `getPrewalkState()` to `{armed: boolean}`; undefined/null read as disarmed, anything
  else non-object is refused, never defaulted.
- `rpc-mode.ts`: `"prewalk.state.get": () => readCediaPrewalkState(session)`.
- `cedia-capability-bridge.ts`: type entry, O07/controller/session/immediate descriptor
  with source+receipt, and operation registration with `noPayload` validation.
- `rpc-types.ts`: `RpcCediaPrewalkData { armed: boolean }`.
- `patches/omp/0001-cedia-rpc-bridges.patch` regenerated via
  `refresh-omp-patch.ts` (the tree showed exactly pin + patch + the two new files, so
  the regen contains only this slice) and `prepare-omp-runtime.ts` re-prepared cleanly.
- `test/cedia-prewalk-bridge.test.ts` (new): disarmed/object/refusal reads, table
  advertisement with the O07 controller contract, control round-trip.
- Two existing tests name every handler/table row explicitly and needed the new entry:
  `cedia-capability-bridge.test.ts` (available-ids list) and
  `cedia-model-state-bridge.test.ts` (full handlers literal).

## Host, adapter, window

- `apps/host/src/omp-prewalk.ts` (new): strict `{armed}` parsing, `OmpPrewalk`
  projection with runtime/bridge absence reasons, nothing probed when down.
- `service.ts` (field, runtime entry, `prewalkSnapshot`, client wiring),
  `router.ts` (controller-visible `GET /v1/sessions/:id/prewalk`, typed 502 mapping).
- Fake runtime answers the op for the live route test.
- Adapter `getPrewalk` + bridge map entry; `serverPrewalkQueryOptions` (with the
  missing-backend re-read rule), strict parse, API guard; `PrewalkArmedChip` beside
  the composer model picker (renders nothing unless armed), honoring the status bar's
  no-second-data-path contract by staying out of it.

## Proof

- Upstream: new bridge tests + table/handler registration tests green; `check:types`
  clean (two pre-existing test literals needed the new handler entry — found by the
  compiler, fixed by adding it).
- Live: prepared runtime advertises 53 descriptors (was 52); gate settles
  `getPrewalkState` through the live table — gap count 35 → 34, O07 sdk 0.
- Host: new `omp-prewalk.test.ts` (parse, bridge present/absent without probing, mocked
  route, real-host unavailable + live).
- Window: chip render/parse/wiring/route tests; full agent-window suite green.
- Full matrix + repo typecheck green; gate integrity PASS; `ci-validate` CI-OK.

## Still open in O07

`agents`, `guided-goal`, `hub`, `loop` — all TUI-dashboard/flow surfaces with no
headless carrier; each needs its own bridge plus surface. The orchestration spawn
mechanism (`spawn_agent`) is unavailable in this environment, so this vertical ran
staged solo with test gates at every step (see the turn record); the patch regen was
byte-audited to contain only this slice before preparing.

## Live proof (prepared runtime, provider-free)

- Capability table carries 53 descriptors (was 52); the `prewalk.state.get` row reads
  O07/controller/session/immediate/available with the bridge source and test receipt.
- `cedia_control {operation: "prewalk.state.get"}` answers
  `{armed: false}` on a fresh session — the read path runs end to end with no turn.
- Gate settles `getPrewalkState` through the live table: gap count 35 → 34, O07 sdk 0.
- An armed-true window state needs `@smol` with real auth, so the chip's armed rendering
  is renderer-tested only; the disarmed/absence paths are the honest live states here.
- Unrelated incident during the slice: the gitignored `dist/` tree vanished mid-turn
  (deleter unidentified — no repo script or test removes it); source, docs and the
  packaged app were intact, and `prepare-omp-runtime.ts` + `build:agent` restored
  everything with all suites green after.

## Addendum 2026-09-25 (post-vertical window certification)

Both window harnesses pass with the vertical landed: the stub smoke (new task, in-place
first Send, restore across reload, second-task identity, IDE handoff and return; 0
provider calls, 0 renderer errors) proves the ChatView mount with the new chip is safe
in real flows, and the live smoke re-ran green (21 tool rows, dependency rows, tree
points, running turn, 1 hanging incomplete provider attempt). Same run also exposed an
environmental gap, not a product one: the Playwright browser cache
(`~/Library/Caches/ms-playwright/`) vanished mid-week like `dist/` did, failing both
smokes at launch; reinstalling the headless shell restored them. The deleter remains
unidentified — build outputs stay regenerable, sources and docs were never at risk.

## Addendum 2026-09-25 (packaged certification post-vertical)

Rebuilt the packaged app with the vertical landed (`package:mac`, ad-hoc signed;
`check:packaged` all OK) and ran the native agent-window smoke against it: new task,
in-place first Send, restore across reload, second-task identity, IDE handoff and
return — 0 provider calls, 0 renderer errors, all captures. The shipped artifact runs
the new bridge, route, adapter read and chip mount without issue.
