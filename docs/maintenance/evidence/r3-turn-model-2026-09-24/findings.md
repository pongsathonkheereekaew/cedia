# R3 the model a turn actually ran on — 2026-09-24

This receipt records the slice that answers §2.4's "actual model" requirement: the pinned
runtime now reports the model and thinking level it is running a turn with, and the host records
them on that submission's turn intent. Evidence is the patched pinned runtime plus the host
fixture suite; no provider was contacted. §10 item 70 remains the owner of status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the previous slices plus this one.
- Before this slice a turn intent recorded identity, state and evidence cursor, but not the model
  the turn ran on, so no surface could say which model produced a result without asking the
  session for its *current* model - which a pending change could already have moved.

## Implemented in this working tree

**The runtime reports the running turn's model.** `CediaTurnQueueSnapshot.current` and the
`cedia_turn_queue` answer gain `model: { provider, id, name? }` and `thinkingLevel`, read from
the session at the boundary. The four turn boundaries additionally carry `cediaModel`
(`provider/id`) and `cediaThinkingLevel` when the session knows them, so a client can attribute
the model without a second round trip.

**The host records it on the submission, never from a request.** `TurnIntent` gains `model`
(`provider/id`) and optional `thinkingLevel`; the store's `turn_intents` table gains `model` and
`thinking_level` (schema 5, with the same additive upgrade and private version-named backup). A
turn boundary's `cediaModel` is written directly; the queue snapshot fills it when the runtime
answers. A requested-but-not-yet-accepted change never reaches these fields - only what OMP
reports does.

## Verification performed

| Command | Result |
|---|---|
| `bun scripts/omp-turn-bridge-smoke.ts` (pinned runtime, local endpoint that never answers) | `ok: true`; `currentIntent: "turn-smoke-1"`; `currentModel: "fixture/fixture-model"`; `queued: [{ intentId: "turn-smoke-2", kind: "followUp", position: 1 }]`; every named boundary carried the model |
| `bun test apps/host/test/service.test.ts` | 28 passed, 0 failed (184 assertions) |
| `bun test apps/host` | 183 passed, 0 failed, 23 files |
| `bun test apps/host apps/macos/agent-window/test` | 301 passed, 0 failed, 51 files |
| `bun run --cwd upstream/omp/packages/coding-agent check:types` | no type errors |
| `bun scripts/prepare-omp-runtime.ts` + `attestOmpRuntime` | rebuilt; source tree `6d7be509abe8c7f22b9fcdc5386655383c01de7d` matches the manifest |
| `node scripts/ci-validate.mjs` | `CI-OK … doc-links=387 md=132 evidence=113` |

The host fixture proves the same path through the real adapter: after a prompt completes, its
turn intent carries `model: "fixture/fixture-model"` and `thinkingLevel: "medium"` because the
runtime named them on the boundary, alongside the OMP event sequence the state came from.

## Not implemented / not claimed

- **Pending model/effort acceptance is still unbuilt** (§2.4's remaining bullet): there is no
  revision handed to OMP for a model change, no commit of that revision at OMP's dequeue/start
  boundary, and therefore no honest "awaiting acknowledgment" state to show. Today a model change
  goes through OMP's ordinary `set_model`, whose effect is not attributed to a turn.
- A turn whose model changes mid-run keeps the model reported at its start; a later report would
  need a per-step field rather than a per-turn one.
- No rendered model indicator and no packaged or two-window run of this projection.
- §2.6 cleanup, the rest of §3.C, R4-R8 and every §8.2 O-packet remain open; speech-to-text stays
  deferred.

## Limitations

Runtime evidence comes from the development launcher against the pinned source tree, not a
packaged standalone binary, and from a local endpoint that never answers rather than a live
provider. Neither is full OMP conformance.
