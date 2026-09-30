# R3 OMP turn bridge: named submissions and the runtime's own queue — 2026-09-24

This receipt records the OMP half of §2.4: the pinned runtime now echoes the identity Cedia gave
a submitted turn and reports its own queue, so the host no longer has to bind a turn boundary by
guessing. Evidence is the patched pinned runtime itself plus the host/fixture suites; no provider
was contacted. §10 item 70 remains the owner of status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the previous slices plus this one.
- Before this slice the pinned runtime knew nothing about Cedia's turn identities: a client could
  not tell OMP which submission it was sending, boundaries carried no identity, and the only
  queue fact exposed was `queuedMessageCount`.

## Implemented in this working tree

**The patch (consolidated `patches/omp/0001-cedia-rpc-bridges.patch`, same pinned OMP revision).**
It is always advertised and inert unless used, matching the model-role and provider-auth
precedent: stock behavior stays selected for a client that never names a turn.

- `packages/ai/src/types.ts` and `packages/wire/src/index.ts`: `UserMessage` gains
  `cediaIntentId`, so the identity travels with the message and is persisted in the session file.
- `agent-session-types.ts` / `agent-session.ts`: `PromptOptions`, `FollowUpOptions` and `steer`
  accept the identity; the session keeps the submissions that have not started (steering and
  other, apart, because OMP drains steering first) and adopts one at `agent_start`, releasing it
  at `agent_end`. `getCediaTurnQueue()` answers `{ current?, queued: [{ intentId?, kind,
  position }] }` from state OMP already holds.
- `rpc-types.ts` / `rpc-mode.ts`: the four turn commands accept `cediaIntentId`,
  `cedia_turn_queue` is answered, the ready frame advertises `cediaTurnBridgeVersion: 1`, and the
  turn boundaries are emitted with the adopted identity (`agent_end` names the run it settled).
- `patches/omp/manifest.json` carries the new patch digest and `patches/omp/README.md` documents
  the bridge; `scripts/prepare-omp-runtime.ts` rebuilt the development runtime at the new tree.

**Cedia's side.** `OmpRpcClient.turnBridgeAdvertised()` reports the negotiation;
`OmpRpcClient.#cediaCommandAdvertised` refuses `cedia_turn_queue` on a runtime that never
advertised it. The host adds `cediaIntentId` to the dispatched payload of a turn command (never
to the stored command receipt, so a receipt's payload hash stays the hash of the user's command),
binds a named boundary to that exact intent, and records the position OMP reports for a still
queued submission.

## Defects found by the fixtures

- **The ACK could restate a running turn as queued.** OMP can emit `agent_start` before the host
  processes the transport ACK; the projection then moved `running` back to `queued`. A turn now
  only ever moves forward (`TURN_STATE_ORDER`), and a test covers the race.
- **`transitionTurnIntent` treated a repeated state as a complete no-op**, so the position OMP
  reported for a still queued turn could not be stored. Repeating a state now still records new
  evidence, and only a call that changes nothing is skipped.
- **A `follow_up` was never queued in the projection.** Its command receipt completes at the ACK
  because OMP answers the call rather than the turn, so the intent was left `prepared`. Turn
  intents are now queued at acceptance for every turn submission.
- The first runtime attempt echoed nothing on `agent_start`: the identity was derived from the
  transcript, which does not yet contain the user message when `agent_start` is emitted. The
  session now adopts the submission at the fan-out seam, before subscribers see the boundary.
- **`git diff --check` flagged the regenerated patch as whitespace.** The patch reproduces
  upstream source bytes, so its context lines begin with a space and a tab; once a hunk shifts,
  those lines are new to the repository and the check reads them as the repository's own
  indentation. `.gitattributes` now records that generated patches under `patches/**/*.patch`
  are not whitespace-policed, which keeps the check meaningful for the hand-written tree.

## Verification performed

| Command | Result |
|---|---|
| `bun scripts/omp-turn-bridge-smoke.ts` (pinned runtime, local endpoint that never answers) | `ok: true`; `advertisedTurnBridge: true`; `echoedOn: ["agent_start","turn_start","turn_end","agent_end"]`; `currentIntent: "turn-smoke-1"`; `queued: [{ intentId: "turn-smoke-2", kind: "followUp", position: 1 }]` |
| `bun run --cwd upstream/omp/packages/coding-agent check:types` (also `wire`, `ai`, `agent`) | no type errors |
| `bun test packages/coding-agent/test/agent-session-*queue*.test.ts` (OMP's own queue suites) | 23 passed, 0 failed |
| `bun test apps/host` | 183 passed, 0 failed, 23 files (1,084 assertions) |
| `bun test packages/omp-adapter packages/relay apps/host apps/macos/test scripts/lib` | 1,033 passed, 1 failed (the pre-existing `ide-native-workbench` theme failure) |
| `bun scripts/prepare-omp-runtime.ts` | rebuilt; `verifyOmpSource` agrees with the manifest (tree `efacae17e339e8f20bb220778d10de347dc12dbb`) |
| `node scripts/ci-validate.mjs` | `CI-OK … doc-links=385 md=131 evidence=112` |
| `git diff --check` | clean, with generated patches exempted by `.gitattributes` |

The host fixture drives the same negotiation through the real adapter: the prompt reaches the
runtime carrying `cediaIntentId` equal to the stored intent identity, the boundary binds the run
by that name (`OMP named this turn starting`), and a `follow_up` behind the running turn records
`queuePosition: 1` from the runtime's snapshot rather than from Cedia's own order.

## Not implemented / not claimed

- **The per-turn actual model is still unrecorded.** The bridge reports identities and queue
  order; naming the model a turn actually ran on needs its own field and readback.
- **Pending model/effort acceptance is unbuilt** (§2.4's third bullet): a UI change is still not
  bound to the OMP dequeue boundary, and the deferred-model action stays unavailable.
- OMP's full type/test suite was not run as a gate; the touched packages typecheck and the queue
  suites pass. Cedia's own packaged runtime (`--standalone`) was not rebuilt, and no packaged
  application or two-window run exercised this bridge.
- No rendered turn state, no queue indicator and no per-turn model indicator in either window.
- §2.6 cleanup, the rest of §3.C, R4–R8 and every §8.2 O-packet remain open; speech-to-text stays
  deferred.

## Limitations

Runtime evidence comes from the development launcher (`dist/omp/omp` → the pinned source tree),
not from a packaged standalone binary, and from the host's scripted fixture rather than a live
model. Neither is full OMP conformance, and neither certifies a release build.
