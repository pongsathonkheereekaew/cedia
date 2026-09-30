# D runtime rebuild + live re-proof on the current tree — 2026-09-26

`dist/` (runtime, agent bundle) vanished mid-turn from an external cause; nothing in this
turn deletes files. Rebuilt what the tree owns and re-proved the live D rows with zero
provider involvement and zero spend. W/N out of scope per owner. §10 item 70 owns status.

## Done

- `CARGO_BUILD_JOBS=2 bun run prepare:omp` (jobs capped: the first attempt died silently
  mid-compile on a memory-starved machine, ~60 MB free): EXIT 0, native addon built in
  11m37s, `dist/omp/omp --version` → `omp/18.1.18`. Coverage gate reads the live runtime
  again (498 settings, 50 RPC commands, 73 capability descriptors); integrity PASS.
- `bun run build:agent`: agent bundle back in `dist/agent-window` (the missing bundle was
  the entire cause of the `smoke:restore-window` timeout — `ENOENT index.html`, not product
  code and not memory).
- Live re-proofs, all green: `smoke:omp:turn-bridge` (`ok: true`), `smoke:send-race`
  (`ok: true`, same-text one command + 409 user-facing refusal intact), `smoke:restore-window`
  (archive → Restore click → toast → unarchived readback), relay live-connect against the
  rebuilt runtime (headed extension connected, 5 tabs, real CDP descriptor on 9224).
- Real defect found and fixed on the way: `scripts/omp-relay-smoke.ts` probed absence on
  the default port 9224, which the user's now-installed live headed extension also watches —
  the extension won the race and the expected 503 read as 200. The smoke now probes an
  unclaimed port (9333) with the reason in a comment; boundary assertions unchanged,
  `{"ok": true}` again.

## Verified totals (current tree)

- `bun test packages/omp-adapter packages/relay apps/host apps/macos/test scripts/lib`:
  1381 pass, 0 fail (the 2 `cli-launcher` failures seen mid-turn were the missing runtime).
- `bun test apps/macos/agent-window/test`: 392 pass, 0 fail (includes this turn's confirm
  synthesis + onboarding tests). Agent-window typecheck: 1 pre-existing vendor error untouched.
- `node scripts/ci-validate.mjs`: CI-OK. Coverage: integrity PASS, gaps stay 2 by design
  (`switchSession` owner gate; `browser-relay` relay-driving).

## Still open in D (no gap change, stays 2)

- Packaged two-window Send-vs-edit race (headless live stands); dirty-file picker composer UI
  (host pipeline exists, adapter + picker + packaged proof missing); capability-panel packaged
  captures; live confirm-click observation; crash-at-every-boundary live rehearsal. None needs
  a provider turn except the confirm click; none is W/N.

## Preserved

- D1–D5, deferred voice, W/N deferred per owner. Nothing committed.
