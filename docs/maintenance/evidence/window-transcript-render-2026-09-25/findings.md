# Defect note (agent-window smoke: turn completes, transcript never renders)

`scripts/agent-window-smoke.ts` fails at the first send: `Fixture response: ...` never
appears. No product code changed in this slice — this receipt isolates the boundary
with proof so the render-layer owner can reconcile without re-tracing the stack.

## Proven working (each verified live, fixture OMP + real host)

- Fixture turn execution: `prompt` answers `Fixture response: <message>` with full
  frame emission (`apps/macos/test/fixtures/agent-window-omp.mjs`).
- Host turn pipeline: durable command `completed`, session back to `idle`, complete
  turn frames in the event journal (`message_start/end`, text delta, `prompt_result`,
  terminal `agent_end`).
- Adapter projection: `createCediaNativeApi` + `orchestration.getThreadDetailSnapshot`
  against the live host returns the response in the thread snapshot.
- UI dispatch: `orchestration.dispatchCommand {type: thread.turn.start, ...}` observed
  with the user text (model `cedia:unresolved`, which the pipeline tolerates — proven
  by the harness above using the identical shape).
- UI polling: the events route is fetched continuously (~57 reads over the run).
- Boot/nav/composer/panels: home, task open, composer visible, Send enabled.

## Proven broken

- Neither the user echo nor the assistant response appears in the DOM. Panels show
  their honest absence states (the fixture's bare ready frame advertises no
  capability bridge — by design, per the packaged-absence precedent).

## Boundary

Between emitted thread snapshots (`emitThread`, adapter) and the Synara store/DOM.
The adapter emits every poll; the store never shows the turn.

## Suspects (read-only; not touched, not reverted)

- `.../components/ChatView.tsx` (+163-line in-flight diff: Cedia surface imports,
  all-threads selector, busy-git defaulting, composer picker fragment change).
- `.../components/chat/useChatTurnExecution.ts` (thread.create baseRef change).
- `.../storeNormalization.ts` (pendingModel/archive/turns carry-through).
- All three carry another slice's uncommitted work; the break sits inside the
  snapshot-to-DOM consumption they own.

## Needed

Whoever owns the render-layer slices reconciles them against a passing window
smoke; this receipt is the pre-traced baseline. No gap change claimed here.

## Addendum: bundle rebuilt with all current vendor changes, boot still clean

`bun scripts/build-agent-window.ts` green (chunk-size warnings only, pre-existing)
and a headless boot probe of the fresh `dist/agent-window` shows zero pageerrors —
the single console error is the probe's own missing preload bridge, also present
before. This rules out bundle staleness/breakage (including the O07 Config UI, the
O10 attach bar/steering guard, and the route-guard mount) as a factor in the render
break above: the shipped bundle boots clean with all of it.

## Addendum: store layer exonerated, delivery starved (probed in-page)

Three more probes, all read-only, all against the live host + fixture:

- Real adapter snapshot through the real `mergeReadModelThreadDetailWithLiveHotPath`
  AND `normalizeThreadFromReadModel` (fresh and with-previous): messages survive both,
  count intact. The store merge/normalize path is not the break.
- Manual `orchestration.subscribeThread` in-page resolves ok; the events route is
  fetched continuously (~57 reads/run).
- But an `orchestration.onThreadEvent` listener registered in-page receives ZERO
  snapshots in 9 s. Polling fetches without emitting, or emitting to no one: the
  remaining suspects are `refreshThread` silently swallowing poll failures (its callers
  catch to undefined), the interval never surviving mount, or listeners never
  registering through the UI's subscribe call sites.

Nothing here was edited to learn this. The break now sits in at most: adapter
poll/emit delivery (`refreshThread`, `subscribeThread` timers, `emitThread`
listeners) or the UI subscribe call sites (`ChatView:1750`, `__root.tsx`,
`useAsyncUserInputResponse`, `useChatPendingInteractions`) — read the request log
(`GET .../events` fetched, zero snapshots delivered) against those call sites.
