# R3 pending model/effort acceptance at OMP's dequeue boundary — 2026-09-24

This receipt records the last §2.4 item: a model/effort change is now handed to OMP with a
revision, validated there, committed at OMP's own dequeue/start boundary, and only then called
in effect. Evidence is the patched pinned runtime plus the host fixture suite; no provider was
contacted. §10 item 70 remains the owner of status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the previous slices plus this one.
- Before this slice a model change went through OMP's ordinary `set_model`, which applies
  immediately and is attributed to no turn: a client could not tell an accepted change from a
  requested one, and a change made during a turn could be presented as that turn's model.

## Implemented in this working tree

**Where the boundary is, and why.** OMP's agent notifies session listeners synchronously
(`subscribe(fn: void)`) and does not await them, so adopting a change at `turn_start` could race
the turn's own model request. The session instead commits the change at its own
`beforeQueuedMessageDequeue` hook - which the agent *awaits* before dequeuing steering or
follow-up work - and at the top of `prompt()` before a fresh submission can start a turn. Both
are points where the next turn's request has not been built yet and no turn is mid-flight.

**OMP (`patches/omp/0001-cedia-rpc-bridges.patch`).** `cedia_pending_model`
(`{ revision, provider?, modelId?, thinkingLevel? }`) validates the model against the catalog
(including the background refresh) and the thinking level immediately, then holds the change and
echoes the revision. `cedia_turn_queue` reports `pending: { revision, acceptedAt }` while it is
held and `applied: { revision, model, thinkingLevel, appliedAt, error? }` once it was committed -
or why it could not be (for example a model that disappeared between acceptance and the
boundary). The ready frame advertises `cediaPendingModelVersion: 1`; the bridge is inert unless a
client sends a revision, and the ordinary `set_model` keeps its existing meaning.

**Cedia.** `SessionPendingModel` is persisted per task (`pending-model.json`) and stamped on the
session view: `awaiting` until the runtime reports committing that exact revision, `in-effect`
with the model OMP says it is running, or `refused` with the runtime's reason (the route answers
`pending_model_refused`). `POST /v1/sessions/:id/pending-model` carries the revision;
`#syncTurnQueue` reconciles the record from the runtime's own report, and the per-turn `model`
recorded earlier is what a client attributes a result to.

## Verification performed

| Command | Result |
|---|---|
| `bun scripts/omp-turn-bridge-smoke.ts` (pinned runtime, local endpoint that never answers) | `ok: true`; a revision accepted during a running turn stayed `pending` and did not restate that turn's model; an unknown model was refused by the runtime; at the next boundary the new turn ran on `fixture/fixture-model-2` and the snapshot reported `applied.revision: 1` with that model |
| `bun test apps/host/test/service.test.ts` | 29 passed, 0 failed (191 assertions) |
| `bun test apps/host apps/macos/agent-window/test` | 302 passed, 0 failed, 51 files (1,452 assertions) |
| `bun run --cwd upstream/omp/packages/coding-agent check:types` | no type errors |
| `bun scripts/prepare-omp-runtime.ts` + `attestOmpRuntime` | rebuilt; source tree `89c1f7a11f3122d6dfd713034904ed5b79afbcb9` matches the manifest |
| `node scripts/ci-validate.mjs` | `CI-OK … doc-links=389 md=133 evidence=114` |

The host fixture drives the same negotiation through the real adapter: an unknown model is
refused at acceptance and recorded with the runtime's reason, a valid revision is `awaiting` on
the task view, and after the next turn it becomes `in-effect` with `applied.model` equal to the
model OMP reported - which is also what that turn's intent records.

## Not implemented / not claimed

- **No window sends a revision yet.** The desktop adapter still changes models through the
  ordinary `set_model` path; wiring the composer's model picker to `/v1/sessions/:id/pending-model`
  (with a monotonic revision per task) is the next step, and until it lands no rendered control
  exercises this boundary. This is why no rendered evidence is claimed.
- The plan's "pause pending turns while an invalid selection stands" is only partly satisfied:
  an invalid selection is refused at acceptance and never becomes pending, so there is nothing to
  pause; a model that disappears *between* acceptance and the boundary is reported as a refused
  revision but does not yet block later submissions.
- Only one pending revision per task is held; a newer submission replaces the older one and the
  replaced revision is not reported as superseded.
- No packaged two-window run; §2.6 cleanup, the rest of §3.C, R4-R8 and every §8.2 O-packet
  remain open; speech-to-text stays deferred.

## Limitations

Runtime evidence comes from the development launcher against the pinned source tree, not a
packaged standalone binary, and from a local endpoint that never answers rather than a live
provider.
