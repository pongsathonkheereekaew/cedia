# Slice (live panels in a running window + stuck-panel fix)

Two things that belong together: the first observed-in-a-window proof of the
bridge-backed composer panels against the real pinned runtime, and the real defect
that proof shook out.

## The harness (`scripts/agent-window-live-smoke.ts`, `smoke:agent-window:live`)

The stub smoke proves the window against a fixture whose runtime advertises no bridge,
so backend panels can only ever show absence. The live variant points the same harness
at the prepared pinned runtime with one fixture model (auth none, endpoint that never
answers): pick the model, send one turn that hangs at the held endpoint, and read the
panels while it runs. No provider call completes (1 hanging attempt is reported, not
asserted away). Result: 21 live tool rows, both Needs-setup dependency rows, session
tree points, live context numbers — `dist/agent-window-live-smoke/live-panels.png` —
with zero renderer errors.

## What the harness proved on the way

- Opening a task does NOT boot OMP: pre-send panels honestly report no runtime. The
  runtime boots for the dispatched turn (`status running`, intent `running` with the
  model OMP named, `set_model` completed).
- The model picker resolves the catalog without a runtime (`Live Fixture` listed while
  panels still report no runtime); picking it before sending works.

## The defect: panels stuck on pre-boot absence

With the runtime up and host routes answering 200-available (verified through the
in-process router mid-run), the window kept showing "No OMP runtime is running". Two
falsified hypotheses are recorded so nobody re-tries them: (1) an error-only
re-poll rule — the failing reads are not the problem, because absence arrives as a
*successful* `available: false` answer, which no error rule ever revisits; (2) a
two-argument rule signature — TanStack v5 calls `refetchInterval` with the query
object as its only argument (verified in query-core 5.103 sources and types), so the
first version always returned false. A total-helper crash caught by the same smoke
(now covered by an explicit no-argument test) belongs in the same lesson.
The fix: `missingBackendRefetchInterval` on the catalog and tree queries — re-read
while the answer is missing (error or reported absence), never once live. Success
behavior is unchanged (focus/reconnect/remount/invalidation only), `retry: false`
stays, and a down backend costs one cheap read per 5 s per mounted panel. The smoke
passes with no reload, which is the proof the fix (not the remount) heals the panels.

## Proof

- `bun run smoke:agent-window:live`: ok true, 21 tool rows, dependency + tree + context
  live, 0 renderer errors, 1 hanging (incomplete) provider attempt.
- `bun test apps/macos/agent-window/test` (308 pass, incl. the rule + wiring tests),
  `apps/macos/test` + `scripts/lib` (844 pass), `bun run typecheck` (0 errors).
- `bun run check:omp-coverage`: unchanged, integrity PASS at 35 (no gap movement by
  design — observation plus a self-healing fix).

## Still open

The same stuck shape may affect other session queries (queue, context, progress,
model-state were not asserted live); the rule was applied only where observed
(catalog, tree). Packaged-window capture against a real backend, login /
background-launch / crash paths.

## Addendum 2026-09-25 (freshness architecture map — why the fix stays scoped)

Surveyed whether the same stuck shape affects other session queries. It does not need
the same fix — every sibling already has a healing path:

- progress, queue, context, memory, agents, advisor, transcript: invalidated by the
  native thread-activity stream (`api.orchestration.onThreadEvent` in
  `routes/__root.tsx`). The live screenshot itself shows Context live, consistent with
  event/remount healing independent of this slice's rule.
- plan: polls every second by prior design (needs live plan transitions).
- modelState: heals through user-action invalidation (the model pick mutation refreshes
  it — observed live in the smoke run).
- goalDetails: nothing to heal without a goal; absence is the correct answer.
- catalog, tree: the only two with neither event invalidation nor polling — the exact
  hole this slice's rule fills. Verified stuck pre-fix (180 s of live runtime, dead
  panels) and healed post-fix with no reload.

Not extended: pause (unobserved; its controls mutate through dedicated routes either
way) and anything on-demand by design (usage, credits, history transcript must never
poll — they would hit providers). If a future observation shows a stuck sibling, the
rule is one line per query options block plus a wiring assertion in
`cedia-tools-catalog.test.tsx`.
