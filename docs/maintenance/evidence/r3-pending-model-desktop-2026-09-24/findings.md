# R3 a window now defers its model change to OMP's boundary — 2026-09-24

This receipt records the desktop wiring for §2.4's pending model/effort acceptance: a model
picked while a turn is running now goes through the host's revision route instead of OMP's
immediate `set_model`, and a runtime without that boundary is reported as what it is. Evidence
is the adapter and host fixture suites; no packaged or two-window run. §10 item 70 owns status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the previous slices plus this one.
- Before this slice the host, the runtime and the route implemented pending acceptance, but the
  desktop adapter still changed models with the immediate `set_model`, so no window ever sent a
  revision and a change made mid-turn could still be attributed to the running turn.

## Implemented in this working tree

**The adapter asks for the deferred path when a turn is genuinely in flight.**
`setModelIfRequested` sends `POST /v1/sessions/:id/pending-model` with a monotonic per-task
revision when the host's own turn projection shows a `running` turn, and records the model only
when the host answers `in-effect`. It falls back to the previous behaviour when the row has no
turn projection (an older host), and it applies immediately when the task has no turn in flight -
there is nothing to defer to.

**A submission owns the turn it starts.** `ensureStarted` marks a task `running` before its first
prompt, so `status` alone cannot tell "a turn is in flight" from "this task is merely started";
`session.turns` can, and it now travels through the adapter's `asSessions` projection. `thread.
turn.start` and the edit-and-resend path pass `forSubmission: true` because the model picked with
a send belongs to that send; only a queued steer keeps the change deferred.

**A runtime with no boundary is reported, not imitated.** The host checks the runtime's
advertisement before sending any revision: without it, the change is applied at once and the
record says `applied.via: "immediate"` instead of claiming it was held. The same marker reads
`turn-boundary` when OMP committed the revision at its own boundary.

**The request travels with the row.** `pendingModel` is stamped on the thread projection, so a
surface can show "awaiting OMP" rather than presenting a request as the active model. No window
renders it yet.

## Verification performed

| Command | Result |
|---|---|
| `bun test apps/macos/agent-window/test/adapter.test.ts` | 39 passed, 0 failed (114 assertions) |
| `bun test apps/host/test/service.test.ts` | 30 passed, 0 failed (194 assertions) |
| `bun test apps/host apps/macos/agent-window/test` | 304 passed, 0 failed, 51 files (1,459 assertions) |
| `bun scripts/omp-turn-bridge-smoke.ts` (pinned runtime) | `ok: true`; `currentModel: "fixture/fixture-model"`; accepted revision stayed pending; committed revision reported `fixture/fixture-model-2` |
| `npx tsc --noEmit` scoped to the adapter/host/protocol | no new errors |
| `node scripts/ci-validate.mjs` | see the plan index after this slice (doc links and evidence count updated with it) |

The adapter fixture drives the real dispatch path: a task row whose turn projection shows a
running turn posts `{ revision: 1, provider, modelId, thinkingLevel }` to the pending route and
sends **no** `set_model`/`set_thinking_level` command, a second change carries revision 2, and a
plain send still uses the immediate path because it owns the turn it starts. The host fixture
proves the other half: on a runtime that never advertises the boundary, the change is applied at
once, the record says `via: "immediate"`, and no revision is ever sent.

## Not implemented / not claimed

- No rendered "awaiting OMP" surface: the record and the request travel to the window, but no
  control draws them yet, and no packaged or two-window run has exercised this.
- The window's own picker state still shows the selection it made; only the adapter's model map
  follows OMP's report. A rendered surface would resolve that.
- One pending revision per task: a newer change replaces the older one and the replaced revision
  is not reported as superseded.
- §2.6 cleanup, the rest of §3.C, R4-R8 and every §8.2 O-packet remain open; speech-to-text
  stays deferred.

## Limitations

Fixture evidence from the revision above. The runtime half of this boundary was proven against
the pinned runtime in the previous slice; this slice proves the desktop path against the host
fixture, not a rendered or packaged window.
