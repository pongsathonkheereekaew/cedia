# R1–R2 implementation work — 2026-09-24

This receipt records partial local implementation only. It does not certify D, W, N, F, packaged lifecycle, or two-window settings behavior.

## Source state

- Workspace: `/Users/pond/cedia`, branch `main`, ahead 21 commits at inspection; pre-existing user changes included the plan, instructions, READMEs, `.scratch/`, and seven dated evidence directories. These were preserved.
- The canonical plan was read through its implementation reading contract and §§2.2–2.8, 3, 6, 8, 10 and 11. The 2026-09-23 OMP complete-scope receipt states that it is a source/coverage audit, not application implementation or runtime acceptance.
- OMP identity in that receipt: base `00085d4e7dfdcfbf302c122fa2682b410a0f43d1`; patch SHA-256 `c7286164c78b543501e23519769cd275764e463e8645157093846cdedc508b6e`.

## Implemented in this working tree

- Added a host capability snapshot. Remote Tailscale, settings bridge, live OMP CLI attach and deferred speech are reported `integration_missing`; they are not presented as working controls.
- Added host lifecycle identity with process-start timestamp, state directory, protocol version and app generation. Owner-only adoption validates the prior identity and rotates the generation; the main-process host gateway checks the health identity before reuse. OMP per-session exclusive SQLite ownership remains in the OMP process.
- Added an allowlisted host-owned CEDIA preference subset with atomic file replacement, fsync, revision compare-and-swap, category validation and restart persistence. Host settings reads/writes are currently owner-only; controller redaction is still required before general exposure.
- No app settings/localStorage migration, cross-window broadcast, OMP config RPC, main-process Quit coordinator, dirty-buffer/terminal drain UI, Tailscale gateway, or CLI live-attach implementation is claimed.

## Verification

- `bun run typecheck` — passed after the changes.
- Targeted lifecycle/settings/HTTP tests — 9 passed, 0 failed (54 assertions); HTTP suite separately 5 passed, 0 failed (39 assertions).
- R1 broader run: `bun test apps/host packages/omp-adapter/test/version.test.ts apps/macos/test/agent-window-main.test.ts` — 176 passed, 0 failed (1,001 assertions), including the existing real OMP lock contention fixture.
- `node scripts/ci-validate.mjs` — passed: 198 parents, 75 UI families, 129 children, lock SHAs and documentation/evidence links valid.
- `bun run build:mac` — built the pinned development OMP runtime, Agent Window assets, host and Mac extension under `dist/`.
- `bun run check:packaged` — failed against the pre-existing `VSCode-darwin-arm64/Cedia.app`, packaged 2026-09-23: Agent Window assets differ from the current local build, and the package does not verify against the current patch set. This is expected stale-package evidence, not a successful runtime check.
- `scripts/build-cedia.ts --package` explicitly removes and replaces the packaged CEDIA extension and Agent Window assets in `Cedia.app`, then re-signs it. It was not run, to preserve the existing packaged application and its identity.

## Remaining R1/R2 gates

- Wire a main-process lifecycle coordinator for login/background start, close-without-stop, Quit/Cancel, active OMP/user PTY drain, IDE dirty-buffer protection, and crash adoption; prove it in the packaged app.
- Prove a surviving OMP child is never duplicated and host recovery requires the exclusive OMP lock.
- Add the pinned OMP versioned settings bridge, config conflict/readback checks, and provider-free bridge fixtures.
- Implement draft CAS/submission/migration and migrate the applicable settings schema while excluding provider installers, other harnesses, account controls and credentials.
- Wire both windows to the same settings owner, app-theme/syntax separation and broadcast; capture packaged-window evidence.
- Rebuild/package and rerun the packaged-shell/lifecycle gates in an output app path that does not overwrite the existing `Cedia.app` without preserving it.
