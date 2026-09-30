# D+F closeout on 18.4.3 — audit regen, standalone rebuild, adopt-EOF re-probe, packaged build (2026-09-29)

Follow-up to the [18.4.3 cutover](../o12-omp-1843-cutover-2026-09-29/findings.md).
Every "not done" row there except the CUA-gated packaged Send/edit re-proof is now closed.

## 1. Coverage audit re-generated for 18.4.3 — gate green

New dated dir `docs/maintenance/evidence/omp-complete-scope-2026-09-29/` (11 files;
generator `scripts/regen-omp-audit.ts`). The 2026-09-23 dir stays as the 18.1.18 record.
`scripts/check-omp-coverage.ts` retargeted (`auditDir` one-liner).

- Counts: 1101 mappings (was 1041). 516 settings / 82 slash / 50 CLI / 30 tools /
  61 RPC / 106 SDK. Rows: -17 dropped (14 gone settings + `hub` tool + `find`
  tool-alias + `drop` slash), +77 added (32 settings O04, 11 RPC, 4 slash + 7
  subcommands + 1 alias, 9 CLI + 3 aliases, 3 tools, 2 launch flags).
- `bun scripts/check-omp-coverage.ts`: Integrity PASS, 0 fatal, 0 gaps
  (1101/1101; live omp/18.4.3, 516 settings, 61 RPC, 73 capability descriptors).
- `--require-complete`: F completeness PASS, exit 0.
- `verify.py` rewritten (registry-based settings via `register({ id:` grep,
  skills 7th slash file, new tool names/alias map) — passes.
- Deviation log (all grounded in live tree): `advisor configure` kept (live still
  declares it); slash subcommand changes additions-only; RPC union is 61 unique
  (47 stock + 14 cedia); launch flags 66 not 64 (`--no-ui`,
  `--system-prompt-template` were missed before); `/delete`+`/record` recorded
  `explicitly_excluded`; 3 SDK needle fixes
  (`sessionEvents.forward({`, `pi.sendUserMessage() or pi.sendMessage()` in
  rpc-prompt-results.ts, `deliverIrcMessage(msg: IrcMessage)` + `return
  this.#irc.deliver(msg);`); `immediate` apply-timing count 13→21 (live answer).
- Ripple (required for typecheck/suites): adapter `types.ts` RPC union + payload
  map extended to 47 stock; `service.test.ts` + `omp-o11-command-smoke.ts`
  payload maps reordered; 42→47 inventory locks (`rpc-inventory.test.ts`,
  `adapter.test.ts`, `router.test.ts`) retargeted to the new audit dir.

## 2. Standalone rebuilt — packaged-editor test green

`buildOmpNative` now stamps the addon post-link
(`scripts/stamp-native-version.ts`; embed-native refuses unstamped addons).
`prepare-omp-runtime --standalone`: `dist/omp-standalone/omp` reports
`omp/18.4.3`. The `starts standalone OMP with the packaged editor and
permission bridges` test passes with `CEDIA_OMP_BINARY=dist/omp/omp`.

## 3. Adopt-after-EOF re-probed — test bug, not a runtime regression

The incarnation-mismatch failure was a test/timing artifact, root-caused, not
a semantic change:

- The owner publishes its record ~800ms into startup, inside a ~57KB startup
  burst (incl. `available_commands_update`). EOF + stdout/stderr destroy inside
  the burst breaks the runtime's output writer → orderly `exit(1)` with record
  cleanup → host spawns fresh (new incarnation). Deterministic in
  `service.test.ts` (record appears while burst in flight), invisible in
  standalone probes (EOF arrived post-burst by luck of timing).
- Proven: +3s pre-EOF delay flips the same test to SAME-incarnation; stdout
  timeline shows burst ending ~800ms, quiescence after.
- Fix in `apps/host/test/service.test.ts` (test-only): gate EOF on output
  quiescence — `available_commands_update` seen AND 750ms with no stdout bytes
  (comment cites platform-clock reason). 30/30 isolated sweeps green; full
  `service.test.ts` 44/44 with `CEDIA_OMP_BINARY=dist/omp/omp`.
- Also fixed the payload-map order (`get_available_thinking_levels` back in
  union position) and the 42→47 inventory locks above.

Suite state (`CEDIA_OMP_BINARY=dist/omp/omp`): 552/552 host+adapter;
`apps/macos/test` 781/782 (one fail is a missing `rg` binary in PATH —
environment tool, unrelated, unmodified file). typecheck clean, diff-check clean.
Without the env override, two tests fall back to the stale
`/Users/pond/.local/bin/omp` (18.4.2, below the moved floor) — operator env,
not a product gap.

## 4. Packaged build on the new runtime — green; Send/edit re-proof CUA-gated

- `export:web` (iOS) + `package:mac` (with `CEDIA_HOST_NODE` Node 24): fresh
  `Cedia.app` built and ad-hoc signed. `check:packaged` 12/12 OK.
- `smoke:send-race-packaged` repaired to the stage-time shim pattern (was
  pinning a stale 09-28 shim hash no fresh build can match): verifies staged
  `main.cjs` equals current `dist/agent-window/main.cjs`, applies the two
  reviewed Login Item interception needles in the scratch copy only, re-signs.
  Both shim events observed in the staged run
  (`intercept-set-login-item`, `simulated-login-state`).
- The proof then needs its human Computer Use gates
  (`computer-use-preflight-release`, `computer-use-release`: native keyboard
  edit in the staged IDE window). This agent context has no Screen Recording
  permission (`PermissionDenied`), so the CUA steps cannot be driven here.
  Two staged runs reached the preflight gate and timed out at 120s as designed.
  The 09-28 receipt already closed this subscenario on 18.1.18; the 18.4.3
  re-proof of the CUA half waits on a human operator. Row stays open, scoped
  to the CUA edit + release only — everything before the gate is green on the
  new build.

## Still open (scoped)

- Packaged Send/edit CUA half on the 18.4.3 build (human with screen permission;
  staged app + shim + preflight harness verified working).
- Real Login Item/login cycle; paired-client lifecycle repeats (unchanged).
- W (tailnet/off-LAN) and N (physical iPhone) — external prerequisites.
