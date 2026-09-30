# Native plan mode and plan review in Cedia — 2026-09-24

This receipt records the O07 session-mode slice. Cedia now reads OMP's own plan and vibe state,
drives the same transitions `/plan` and `/vibe` perform, and answers a plan the agent proposes
through a native panel instead of leaving it in the terminal overlay a headless client cannot see
(§8.2 O07, §8.1 D's "explicit Plan instructions" and "plan approval call native operations"). The
coverage gate's remaining O07 gaps drop from 26 records to 16. §10 item 70 owns status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the open slices.
- Pinned OMP patch regenerated for this slice: `patches/omp/0001-cedia-rpc-bridges.patch`, manifest
  sha `f3aebd6c3d7d286e01fa6d623e2243bf6b016596363d6befda1bc045175eac8b`, runtime rebuilt with
  `bun scripts/prepare-omp-runtime.ts` (`omp/18.1.18`, binary
  `f78a41a46ca6f76240f4e0c6c07dcc9b6537823babbe97cc5872cdc435a1c107`).
- Runtime: `packages/coding-agent/src/modes/rpc/{cedia-plan-bridge.ts,rpc-mode.ts,rpc-types.ts}`,
  `…/modes/{interactive-mode.ts,types.ts}`, `…/modes/rpc/cedia-capability-bridge.ts`, tests
  `…/test/{cedia-plan-bridge.test.ts,cedia-capability-bridge.test.ts}`.
- Cedia: `apps/host/src/{omp-plan.ts,omp-progress.ts,router.ts,service.ts,store.ts}`,
  `packages/omp-adapter/src/{types.ts,client.ts}`, `apps/macos/agent-window/src/cedia-adapter.ts`,
  `apps/macos/agent-window/vendor/synara/apps/web/src/{lib/serverReactQuery.ts,components/ChatView.tsx}`
  plus the new `components/cedia/CediaPlanSurface.tsx`, and the host/adapter/UI tests.
- Gate: `scripts/check-omp-coverage.ts`, `scripts/lib/omp-coverage.ts`,
  `scripts/omp-plan-mode-smoke.ts` (new), `scripts/omp-capabilities-smoke.ts`.

## What changed

- **One owner, replaced presentation.** Plan and vibe mode belong to the session's terminal surface
  (`InteractiveMode`), which the Cedia host creates when it negotiates the virtual UI. The bridge
  therefore does not build a second mode machine: it reads `session.getPlanModeState()` /
  `getVibeModeState()`, drives `handlePlanModeCommand` / `handleVibeModeCommand` (the same calls the
  terminal's `/plan` and `/vibe` make), and replaces only the overlay a non-terminal client cannot
  answer. `InteractiveMode.setPlanReviewDelegate` and `handlePlanModeCommand`'s new `exitConfirmed`
  are those two seams; the approved execution still runs through `handlePlanApproval` and
  `#approvePlan`.
- **The wire.** `cedia_plan` (ready frame `cediaPlanVersion: 1`) takes `read` | `enter` | `exit` |
  `vibe.enter` | `vibe.exit` | `review.decide` and answers one snapshot: `{plan, vibe, review,
  changed, reason?}`. Three frames stream out — `cedia_plan_state`, `cedia_plan_review`,
  `cedia_plan_review_closed` — and the runtime's own notices are captured so a refusal carries the
  runtime's words ("Exit plan mode first.") rather than an invented reason.
- **The parked state is on the wire.** The terminal's `/plan` is a three-state toggle, so an exit
  parks plan mode one step before off: the session state is cleared and the plan path is gone, but
  vibe and goal mode stay blocked. `plan.paused` (and an absent `planFilePath`) exists so the
  surface can say "paused" instead of showing "off" while the runtime would refuse the next
  transition; a Cedia `exit` takes the second toggle and ends fully off.
- **Plan review, answered by the owner.** When plan mode is entered through this path, the runtime
  registers its own proposal handler, so a `write xd://propose` lands in `handlePlanApproval`; with
  a delegate installed, the plan (bounded to 64 KiB with an explicit `truncated` flag) is held for
  the client, which answers approve / approve-and-compact / refine / cancel. One review is answered
  once: the id is checked, a second answer is refused by name, and a client that goes away cancels
  the held review instead of leaving the runtime waiting.
- **Cedia's surfaces.** `GET/POST /v1/sessions/:id/plan` is owner-only and reuses the existing
  durable command envelope and idempotency rules; the shared bundle mounts a composer strip
  (On / Paused / Off, the plan file and workflow, the vibe toggle) and the review panel, in both
  windows, with the runtime's refusal text rendered as-is and no control that looks usable while the
  runtime would refuse it.
- **The same behaviour through `cedia_control`.** `plan.get`, `plan.set` and `plan.review` are
  registered operations whose handlers call the one bridge, so a programmatic client and the direct
  command cannot drift; the runtime's own table now carries 16 descriptors.

## Verification

| Command | Result |
|---|---|
| `bun test test/cedia-plan-bridge.test.ts` (runtime) | 10 pass, 0 fail |
| `bun test test/cedia-capability-bridge.test.ts` (runtime) | 17 pass, 0 fail |
| `bun run check:types` (runtime package) | clean |
| `bun scripts/omp-plan-mode-smoke.ts` | 35 checks OK against the prepared runtime: advertised flag, read/enter/exit/vibe transitions, the parked state, the runtime's own refusal text, an unknown-op refusal, the streamed state frames, and the host route end to end (owner-only 401, an unknown body field 400 before any runtime call, a replayed command id answering the recorded outcome, and a reused id with a different body refused) |
| `bun scripts/omp-capabilities-smoke.ts` | every check OK; the available-row list now includes `plan.get`, `plan.review`, `plan.set` |
| `bun run check:omp-coverage` | integrity PASS, 1041 audited records, 16 descriptors, gaps 133 → 123 |
| `bun test apps/host packages/omp-adapter` | 345 pass, 0 fail |
| `bun test packages/omp-adapter packages/relay apps/host apps/macos/test scripts/lib` | 1194 pass, 0 fail |
| `bun test apps/macos/agent-window/test` | 178 pass, 0 fail |
| `bun run --cwd apps/macos/agent-window typecheck` | pass |
| `bun run typecheck` | 10 pre-existing errors, all in the vendor tree's `~/nativeApi` alias and `apps/macos/test/state.test.ts`; none in this slice's files |
| `node scripts/ci-validate.mjs` | CI-OK |
| `git diff --check` | clean |
| packaged run: `build:agent`, `prepare:desktop`, `CEDIA_HOST_NODE=… package:mac`, `check:packaged` | `Cedia.app` stamped as patch set `086d31f75d36` (18 patches); every `check:packaged` row OK, including "Agent Window assets match the stamp and local build" |
| packaged window (live runtime) | the composer strip rendered `Plan mode Off` / `Enter plan mode` / `Vibe off` / "No plan file is active."; clicking **Enter plan mode** turned the real runtime on - `Plan mode On · PLAN.md`, `parallel workflow`, `Exit plan mode`, and the vibe control disabled with the runtime's own reason - and clicking **Exit plan mode** returned it to `Plan mode Off`. Stopping the session made the strip report `Plan mode unavailable` / "No OMP runtime is running", and a deliberate Quit left no app, host or OMP process and a durable `stopped` lifecycle receipt |
| packaged window (no runtime) | an older, stopped thread rendered the strip in the honest unavailable state instead of a working-looking toggle |

Records the gate settles (10): `getPlanModeState`, `setPlanModeState`, `sendPlanModeContext`,
`preparePlanForReview`, `getVibeModeState`, `setVibeModeState`, `sendVibeModeContext` (each through a
registered operation), and the slash rows `/plan`, `/plan-review`, `/vibe`.

## Defects and decisions found while building

- **A descriptor without a registration killed the runtime at startup.** The capability table
  advertised `plan.get`/`plan.set`/`plan.review` before the registered-operation list carried them,
  which the bridge's own invariant turns into a thrown error — every session launch and every host
  suite that starts a real runtime failed on it. Found by the host slice's real-runtime tests, fixed
  by adding the three registered operations with their validators; the invariant is what made the
  mistake loud instead of shipping a table that lies.
- **The vendor's older proposed-plan row is inert.** `ComposerExtrasPanel`'s "plan mode" row and the
  `activeProposedPlan` follow-up flow are fed only by the Synara-side
  `thread.proposed-plan-upserted` event, which nothing in Cedia's adapter or host emits, so that row
  cannot appear in a Cedia window today. It was left in place rather than deleted, and the native
  panel is the only live plan-review surface.
- **Composer chrome, not settings chrome.** The strip uses the composer's own stacked-panel, button
  and textarea primitives: settings primitives would render a second chrome above the composer.

## Not done, and why

- **No plan review was answered end to end by a live model.** Reaching `xd://propose` needs an agent
  turn, which needs a provider; G0 fixtures never call one. The delegate wiring, the held-review
  lifecycle and the decision paths are covered by the runtime test, and the smoke proves everything
  up to the proposal itself. A provider-backed run is a separate authorized step.
- **The approval tier slider has no native control.** At a terminal the operator may pick which role
  model executes an approved plan; Cedia's approve uses the runtime's own default (restore the
  pre-plan model). The plan's approve/refine/cancel requirement is met; the slider is a presentation
  choice Cedia has not built.
- **The review panel itself was not seen in a packaged window.** The strip's live round trip was
  captured in the packaged app (above), but a review panel needs a plan the agent proposes, which
  needs the provider turn this slice does not run. The panel's rendering is covered by the bundle's
  rendered tests and its decisions by the runtime tests.
- **O07's remaining records stay gaps**: Advisor (configs, stats, status, history, enable),
  Prewalk (`armPrewalk`, state), `getTodoPhases`, `get_subagent_messages`, and the slash rows
  `/agents`, `/hub`, `/loop`, `/guided-goal`, `goal show`, `goal budget`. Each is O07 work with its
  packet named in the gate.
