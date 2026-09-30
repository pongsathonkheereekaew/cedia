# Every OMP settings key now carries when a change takes effect — 2026-09-24

This receipt closes the half the earlier
[apply-timing mechanism](../r4-omp-settings-apply-timing-2026-09-24/findings.md) deliberately left
open. That receipt shipped only the keys OMP's own hook table proves and said a per-key table
needed each key's call sites; this slice builds that table from OMP's own source and classifies all
498 schema paths. §10 item 70 owns status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the open slices.
- Pinned runtime `00085d4e7dfdcfbf302c122fa2682b410a0f43d1`, patch
  `patches/omp/0001-cedia-rpc-bridges.patch` sha256
  `e44c2f99f6bf873c85fd81a8a80afad07167e2f5e8384a90568b99a94455abc7` (47 changed files, 18
  new-file hunks), attested source tree `89a6e34b8b4bc369d0f0dfefc8b8f9aec7eb29e4`.
- New: `upstream/omp/packages/coding-agent/src/config/settings-apply-timing.ts` and its test.
  Changed: the settings bridge, `packages/omp-adapter/test/cedia-capabilities.test.ts`,
  `apps/host/test/omp-settings.test.ts`.

## How a timing is decided

Three tables, each of which fails loudly if it stops being true:

1. **A reader index** — every literal settings read in OMP's own sources, plus one explicit
   no-reader bucket for schema-only paths. 172 source modules, all of which exist.
2. **A lifecycle rule per source module** — the authored judgement, with a rationale, that says
   whether that consumer runs while a turn is executing (`turn_boundary`), only when a session or
   agent is constructed (`new_session`), or at process/mode startup (`reload`). A path with no
   consumer at all is `reload` with the reason that a future consumer could not observe it sooner.
3. **OMP's own hook table**, which stays the definition of `immediate` — `Settings.set` runs those
   hooks synchronously, so `immediate` is never inferred from a key's name.

`assertSettingApplyRegistry()` fails when a reader has no lifecycle rule, when a registry entry
names a source no path uses, when a rule disagrees with the registry, or when `SETTINGS_SCHEMA`
gains a path the index does not cover. A new upstream key therefore breaks the check instead of
silently publishing an unclassified timing.

## Measured result

Read live from the prepared pinned runtime on a fresh profile with a dead local model endpoint
(`127.0.0.1:9`), `PI_NOTIFICATIONS=off`, so no provider request leaves the machine:

```
498 keys, 0 without an apply timing
immediate 13   turn_boundary 416   new_session 39   reload 30
```

The 13 `immediate` keys are exactly OMP's declared hook set, and the six paths in the no-reader
bucket are `auth.broker.token`, `auth.broker.url`, `gc.coldArchiveAfterDays`,
`gc.retainNewestGlobal`, `gc.retainNewestPerCwd` and `memories.enabled` — schema-only or legacy
paths with no consumer in the pinned source.

## Verification

```
bun scripts/assert-setting-apply-registry.ts        # via the coding-agent test tree
upstream/omp packages/coding-agent test               # cedia bridge 15 pass / 3,708 expects
upstream/omp packages/coding-agent check:types        # passes
bun scripts/prepare-omp-runtime.ts                    # pin + patch hash verified, runtime rebuilt
bun test apps/host/test/omp-settings.test.ts          # 13 pass, 0 fail
bun test packages/omp-adapter                          # 68 pass, 0 fail
bun run check:omp-coverage                             # exit 0; 498 settings, 0 O04 setting gaps
bun test packages/omp-adapter packages/relay apps/host apps/macos/test scripts/lib
                                                       # 1173 pass, 0 fail
```

The adapter assertion that previously required *every* timed key to be `immediate` was updated to
the new contract: no key may lack a timing, every timing is in the four-word vocabulary, and the
`immediate` set is still the hooks. That test is what would have caught a silent invented timing.

## Not done here

- The panel renders a key's timing; no packaged window was captured showing a non-immediate
  timing next to a live session. The classification is proven from the runtime's own answer and
  the adapter suite, not from a capture.
- This classifies *when* a change reaches the runtime's consumers. It does not claim every key's
  effect on a running turn is visible to the user without a restart; that is what the timing says.

## Current-runtime requalification — 2026-09-28

The host-backed capability smoke was extended to verify that the owner settings inventory carries
the full source-derived timing distribution. The first rerun stopped before settings because its
available-operation expectation predated the newly registered O07 operations. That stale fixture
was updated to the current pinned OMP table; the corrected run passed.

- OMP `18.1.18`, source revision
  `00085d4e7dfdcfbf302c122fa2682b410a0f43d1`, source tree
  `7e0ac3862e0c849b4467c508b8b3c175217968cc`; patch-manifest SHA-256
  `246014bfe03ee7dbf1e6f2034c4e7df516b2a43919228f183811ea3fc2fb0431`; launcher SHA-256
  `f78a41a46ca6f76240f4e0c6c07dcc9b6537823babbe97cc5872cdc435a1c107`; Bun SHA-256
  `35d20dd0263e5c950194434b925454fdfa9ba6e4467da960410fa05b08a7a5b5`; native SHA-256
  `05774ec09950a150b7c1cce63359bd26ed6d3eecc44a6261e09e9403371e7869`.
- Corrected `bun scripts/omp-capabilities-smoke.ts`: **PASS**. The live owner route returned 498
  keys, each with a valid timing and exact counts: immediate 13, turn boundary 416, new session 39,
  reload 30. It also exercised an isolated settings write/readback, stale revision 409, protected-key
  refusal, invalid-value refusal and credential redaction. The fixture used a dead localhost model
  endpoint; no external provider was contacted. Scratch state was removed.
- `bun test upstream/omp/packages/coding-agent/test/cedia-capability-bridge.test.ts apps/host/test/omp-settings.test.ts`:
  **36 pass, 0 fail, 4,152 expectations**. OMP `bun run check:types` passed.
- Smoke driver SHA-256: `f97297ab5d977e1f17c81fa5a2104f6e090e9f16d14a954872cef11b907adcea` at root revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb` (dirty working tree).

The settings panel already showed each key's timing through the row description, but its
introduction still said that per-key timing was not classified. Replaced that stale statement
with a description of the live inventory and per-row timing, retaining the notes about lazy value
reads and credential redaction. `OmpSettingsPanel.logic.test.ts` passes (7 tests, 28 expectations),
and root `bun run typecheck` passes. A source search confirms the stale statement is gone. This is
a source/UI-copy correction; packaged settings capture and a live-window conflict choice remain
unverified.
