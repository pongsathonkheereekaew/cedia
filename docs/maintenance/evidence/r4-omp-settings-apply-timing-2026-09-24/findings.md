# O04: a settings key can now carry a timing, and the runtime proves which ones — 2026-09-24

This receipt records the first half of the write-timing classification the plan names as O04's
remaining work. It is deliberately not a confident-looking table of 498 answers: it is the
mechanism plus the keys the runtime can prove, with the rest left unclassified and visible.
§10 item 70 owns status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a46bbd10eb`, dirty with the open slices.
- OMP patch `0001-cedia-rpc-bridges.patch`, sha256
  `f3c0d40c967fe0b1aec9631349f8e9375acb1e5dce77db6030738a433a5d027d`
  (previous `6d67c35a67b9f6b26c0cb4410261b904fb13014712825a37ee2fd4a0aac182a2`).
- Changed: `upstream/omp/.../config/settings.ts`, `.../modes/rpc/rpc-types.ts`,
  `.../modes/rpc/cedia-capability-bridge.ts` and their tests; `packages/protocol/src/index.ts`,
  the settings panel logic and row, `scripts/lib/omp-coverage.ts`,
  `scripts/check-omp-coverage.ts`, and the host/adapter tests.

## Why this is not a per-key table yet

The mechanism receipt measured the truth: OMP holds one process-wide `Settings` loaded once, a
write through Cedia updates that live instance immediately, and whether *behaviour* changes then
depends on the consumer's read site. Classifying 498 keys therefore needs each key's call sites,
and a mechanical pass is not enough to prove one: the first pass classified `modelProviderOrder`
as terminal-UI-only because the real read in `config/model-resolver.ts` uses `settings?.get?.(...)`,
a pattern a `.get(` search misses. An unproven classification here would be a false product claim,
so this receipt ships only what the runtime itself declares.

## What changed

- `settings.ts` exports `settingsWithApplyHooks()`: the key set of its own `SETTING_HOOKS` table.
  `Settings.set` runs the matching hook as the value is written, so these are the paths OMP itself
  declares as taking effect at the moment of the write.
- `RpcCediaSettingsKey.apply` carries
  `immediate | turn_boundary | reload | new_session`, and the bridge publishes `immediate` for
  exactly those hook paths. Every other key carries no timing at all.
- `OmpSettingsKey.apply` is validated in the protocol: an unknown word is refused rather than
  rendered, because a timing the runtime never claimed is exactly the kind of invented state the
  plan forbids.
- The settings row shows the timing: "Applies as soon as it is saved", the three other labels for
  timings a later classification may prove, and "Cedia has not classified when this key takes
  effect" when the runtime publishes none.
- The coverage gate now decides each settings record individually from the live runtime's own
  answer instead of one aggregate capability flag: a key with a published timing is `available`, a
  key without one stays a gap whose reason says so, and with no live runtime nothing is claimed.
  Every settings row also carries the test that proves the read/policy/write path.

## Verification (runtime, not source inspection)

```
bun scripts/prepare-omp-runtime.ts              # dev runtime from the pinned source + patch
bun scripts/prepare-omp-runtime.ts --standalone # the runtime the packaged app ships
bun test packages/coding-agent/test/cedia-capability-bridge.test.ts   # 13 pass (OMP side)
bun test packages/omp-adapter/test/cedia-capabilities.test.ts         # 10 pass, 1096 expects
CEDIA_OMP_BINARY=/Users/pond/cedia/dist/omp-standalone/omp \
  bun test packages/omp-adapter/test/cedia-capabilities.test.ts       # 10 pass against the packaged runtime
bun run check:omp-coverage                      # Integrity PASS; 899 gaps (was 912)
bun test apps/host/test/omp-settings.test.ts    # 13 pass
bun test apps/macos/agent-window/test           # 143 pass
bun run typecheck                               # same 10 pre-existing errors, none new
git diff --check                                # clean
```

The adapter test asserts against the live runtime that the timed keys are exactly the ones with a
hook, that `theme.dark` is among them, and that every published timing is `immediate`. The OMP
test asserts the same against its own hook table, so the runtime cannot publish a timing for a
path it does not act on. Both `dist/omp/runtime.json` and `dist/omp-standalone/runtime.json`
attest the new patch sha, and the standalone binary answers `omp/18.1.18`.

## What this does not claim, and what it exposes

- **485 settings remain gaps.** Each one says "Cedia has not classified when a change to this key
  takes effect", which is true and now visible per key rather than as one blocked capability. The
  next tranche is a real call-site classification; the mechanism receipt records the four
  observable properties it has to satisfy.
- **A structural question for F is now visible in numbers.** A share of the audited records are
  not Cedia surfaces at all by the audit's own metadata: slash commands the audit marks
  `tuiOnly: true` with `surfaces: ["tui"]`, OMP's own launch flags, its CLI verbs and its SDK
  services. OMP owns those inside its own terminal UI; Cedia runs the runtime headless over RPC
  and will never draw them. F's written condition - "no `integration_missing` entry may remain" -
  therefore cannot be met by implementing anything in Cedia for those records. This receipt does
  not resolve that; it records it so the decision is made deliberately rather than by weakening a
  gate one record at a time.
