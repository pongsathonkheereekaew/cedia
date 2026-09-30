# Slice (O06 Code Mode partition): the restricted surface, readable — 2026-09-25

Code Mode engages at startup on a Code Mode model and leaves only a direct tool
partition model-visible, with eval prelude namespaces (`browser`, `computer`) gated by
their own enabled flags. The two getters (`getCodeModeDirectToolNames`,
`getEvalPreludes`) had no Cedia reader. This slice adds one: the registered
`tools.codemode.get` operation projects `{active, directToolNames, preludes}` — names
and one boolean each, never prelude `javascript`/`python` sources, documentation, or
exports — and the Tool catalog panel draws a Code Mode section from it. Gap count
**32 → 30** (O06 sdk 2 → 0).

## What was built

- Runtime (`upstream/omp`, pinned `omp/18.1.18`): `readCediaCodeMode` in
  `cedia-tools-bridge.ts` calls the session's own getters (the same ones the eval tool
  and the browser/computer gates consult); `RpcCediaCodeModeData`; `tools.codemode.get`
  registered controller/session/immediate in the conditional tools.* shape with
  `noPayload` validation; `cedia-tools-codemode-bridge.test.ts` (5 pass, including a
  sources-never-cross assertion).
- Host (`apps/host/src/omp-management.ts`): `parseOmpCodeModeData` (strict, rejects
  unknown fields — including a smuggled `javascript` key), `OmpCodeMode` projection,
  controller-visible `GET /v1/sessions/:id/tools/codemode`, service
  `toolCodeModeSnapshot`. `omp-management.test.ts` +5 (parse strictness, bridge
  absence honesty, controller route + refusals, live fixture round trip).
- Window: `CediaCodeModeSection` inside the Tool catalog panel (off state names the
  partition honestly; on state lists direct names and prelude flags), query/mutation
  options + strict parse in `serverReactQuery.ts`, `getCodeMode` in `cedia-adapter.ts`
  + native exposure. `tool-codemode-section.test.tsx` (6 pass).
- Gate (`scripts/lib/omp-coverage.ts`): `{getCodeModeDirectToolNames, getEvalPreludes}
  → tools.codemode.get` source-verified links; the gate re-reads the registration.

## Live proof (prepared runtime, no provider request anywhere)

`bun scripts/omp-codemode-smoke.ts` (13 checks): disengaged partition reads
`{active: false, directToolNames: null, preludes: [{browser, enabled: true}]}` — the
browser prelude's live flag is OMP's own answer, not a default; rows are name+flag
with no `javascript`/`python`/`documentation` keys; host route carries the same shape
to a controller, refuses query fields (400) and writes (405), and reports absence with
a reason pre-start. The engaged rendering is renderer-tested only: engaging needs a
Code Mode model this environment does not select.

## Incidents during the slice (both mine, both fixed in-slice)

- Smoke asserted `token: controller` (the whole object) instead of
  `controller.token` — the route honestly refused; fixed, no product change.
- Earlier: a smoke script dropped `.data` off a `requestCedia` ack (loop slice) — same
  class of harness bug, fixed in-slice.

## Still open

- O06 `<custom-or-extension-name>` (a pattern, not fixed names), `extensions` +
  `status` alias (extension management needs a runtime roots path + UI).
- An engaged-partition window capture (needs a Code Mode model).

## Evidence (this revision and build)

- `bun scripts/omp-codemode-smoke.ts`: all 13 checks pass.
- Upstream codemode/catalog/capability bridges (39 pass); `check:types` clean.
- Host suite 412 pass / 0 fail; agent-window suite 323 pass / 0 fail; root typecheck clean.
- `bun run check:omp-coverage`: integrity PASS, gap count **30** (was 32).
- Patch regen is faithful to the worktree (spot-audited hunks: only this slice's
  additions plus previously documented slices); runtime re-prepared with attestation.
- `git diff --check`: clean.
