# Slice (O07 loop mode): the queue OMP re-sends, on the composer strip — 2026-09-25

`/loop` repeats the owner's next prompt after every yield, bounded by a count/duration
or gated by `--until`/`--while`. The enable transition already runs headless: the RPC
prompt path dispatches `/loop` through the RPC terminal owner (`rpcTuiMode`), proven by
`smoke:omp:slash`. What Cedia lacked was the state surface — this slice adds the read,
the disable half, and the strip chip. Gap count **34 → 33** (O07 slash 4 → 3).

## What was built

- Runtime (`upstream/omp`, pinned `omp/18.1.18`): `cedia-loop-bridge.ts` projects the
  terminal owner's loop state (`loopModeEnabled/loopModePaused/loopLimit/loopCondition/
  loopPrompt`) to `{enabled, paused, limit, condition, hasPrompt}`. `limit`/`condition`
  carry the runtime's own `describeLoopLimitRuntime`/`describeLoopCondition` words;
  `hasPrompt` names only whether a repeat prompt is armed — no prompt text crosses.
  `loop.state.get` is controller-scoped, `loop.set` is owner-scoped and takes no payload:
  it runs the terminal owner's own `disableLoopMode` (the same teardown the terminal's
  `/loop` toggle calls) and answers the state that follows; disabling while off answers
  the state, never an error. Enabling stays on the typed `/loop` prompt path by design.
  Table + dispatcher + `RpcCediaLoopData` + `cedia-loop-bridge.test.ts` (6 pass).
- Host (`apps/host/src/omp-loop.ts`): strict `parseOmpLoopData`/`parseOmpLoopCommandResult`,
  `OmpLoop` projection, controller-visible `GET /v1/sessions/:id/loop`, owner-only durable
  `POST .../loop` (`kind: cedia_loop_set`, replay returns the receipt). `omp-loop.test.ts`
  (6 pass) covers parse strictness, bridge absence honesty, controller-read/owner-write
  auth, bad-body refusal, and a live fixture round trip (read → disable → replay → reread).
- Window: `LoopModeChip.tsx` beside the composer model picker (renders nothing unless
  loop is on; shows the runtime's bound words and a Disable action), `CediaLoopAnswer`
  + query/mutation options in `serverReactQuery.ts`, `getLoop`/`disableLoop` in
  `cedia-adapter.ts` + native exposure, `ChatView.tsx` mount. `loop-mode-chip.test.tsx`
  (5 pass) pins rendering, strict parsing, the refetch rule, and the adapter envelope.

## Live proof (prepared runtime, no provider turn anywhere)

`bun scripts/omp-loop-smoke.ts`: fresh terminal owner reads off; `prompt {"/loop 3"}`
is consumed by the terminal owner with no turn starting; `loop.state.get` reads back
enabled with the runtime's own `"3 of 3 iterations remaining"` and `hasPrompt: false`;
`loop.set` answers off and a second read stays off. Host half: no-runtime absence with
reason, fresh-runtime off, owner disable accepted, replay identical, extra-field/missing-
incarnation 400, stale incarnation 409.

## Still open

- Enabling with an inline prompt (`/loop 3 <text>`) submits the first iteration through
  the prompt path; Cedia surfaces no structured enable form — the bound is typed as `/loop`.
- O07 `guided-goal`, `agents`, `hub` remain gaps (each needs its own bridge + surface).
- No packaged window was captured showing the chip on (enabling needs a typed `/loop`;
  the off path is the honest live state here).

## Patch-regen note (audited, not just appended)

`bun scripts/refresh-omp-patch.ts` picked up this slice **plus seven worktree files the
committed patch did not cover** (`ai/types.ts` + `wire/index.ts` `cediaIntentId` turn
contract; `advisor/config.ts` WATCHDOG schema export; `config/settings.ts`
`settingsWithApplyHooks`; `modes/types.ts` plan-review delegate types;
`session/agent-session{,-types}.ts`). All seven are plan-recorded slices (R3 turn intent,
O07 plan/advisor, O04 timing) whose worktree edits postdate the last regen — verified by
reading each hunk, not by trust. Reverting them would break recorded behavior, so the
regen correctly bundles them. Proof is the prepare attestation plus the suites below,
not the file list.

## Evidence (this revision and build)

- `bun scripts/omp-loop-smoke.ts`: all 16 checks pass (runtime + host halves above).
- Upstream: `cedia-loop-bridge` + capability + model-state + loop-limit + loop-condition +
  interactive-mode-loop + rpc-tui-slash (83 pass); `check:types` clean.
- Host suite 407 pass / 0 fail; agent-window suite 317 pass / 0 fail; root `typecheck` clean.
- `bun run check:omp-coverage`: integrity PASS, gap count **33** (was 34).
- `git diff --check`: clean.

## Addendum 2026-09-25 (window certification post-vertical)

`bun scripts/agent-window-smoke.ts` (stub harness: new task, in-place first Send,
restore across reload, second-task identity, IDE handoff and return) passes with the
loop chip mounted in `ChatView`: `ok true`, 0 provider calls, `errors []`. The mount
is safe in real flows; the chip renders nothing in these flows because loop stays off.
