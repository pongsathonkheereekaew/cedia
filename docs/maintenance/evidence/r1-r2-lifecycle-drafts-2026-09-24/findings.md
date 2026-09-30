# R1 lifetime handshake and R2 draft CAS — 2026-09-24

This receipt records partial local implementation of §8 R1 and R2. It does not certify D, W,
N or F, does not certify packaged lifecycle or two-window behaviour, and does not claim the
OMP settings bridge. CEDIA-PLAN.md §10 item 70 remains the owner of status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`,
  dirty with 40 changed entries at inspection (the plan, project instructions, READMEs,
  `.scratch/`, dated evidence directories and the implementation below). Pre-existing user
  work was preserved; nothing was reset, cleaned or overwritten.
- Contract read before implementation: §2.2–§2.8, §3.C–§3.D, §6.4–§6.5, §8, §10 item 70, §11.
- No OMP/provider call, no packaging and no signing ran in this slice. All fixtures are
  isolated temporary state directories or in-memory fakes.

## Implemented in this working tree

**R1 — host lifetime handshake (`apps/host`).** `HostLifecycle` now writes a three-phase
identity (`ready` → `quitting` → `stopped`) atomically at mode 0600, exposes
`requestQuit`/`completeQuit`/`accepting`, and `readLifecycleSnapshot` reads the phase from
disk after the process is gone. The router fences every mutation with `host_quitting` (409)
once quitting starts, adds `GET /v1/lifecycle` and owner-only `POST /v1/lifecycle/quit`
(ACK receipt with `accepted`/`alreadyRequested`/`runningSessions`), and keeps adoption
rejected after quitting. `startHostServer` reports `stats().shutdownRequested`, fires
`onQuitRequested` only after the reply is written, and leaves `lifecycle.json` at
`stopped` before closing the store. `cedia-host serve` stops on an accepted quit, and its
`healthy()` treats a host that is not `ready`/`accepting` as offline.

**R1 — Mac application coordinator (`apps/macos/src/app-lifecycle.ts`).** A new
Electron-free state machine: `createCediaAppLifecycle({ gateway, confirmStopAndQuit, … })`
with `status`/`refresh`/`tryQuit`, and `installCediaQuitGuard({ app, lifecycle })`. It asks
the owner before stopping active sessions or dirty editors, returns `cancelled` without
touching the host, and reports `stopped` only from evidence: a non-accepting lifecycle
snapshot or the durable `stopped` receipt the host writes before exiting. An unavailable
lifecycle without that receipt is reported `failed`, never as success. The quit path uses a
read-only gateway peek, so asking to quit cannot start the host it is stopping.

**R1 — capability and lifecycle reach the windows (`apps/macos/src`).** `capabilities` and
`lifecycle` are added to the main-process application allowlist, and
`createAgentHostGateway` exposes `capabilities()`, `lifecycleStatus()`, `quitHost()`,
`peek()`, `reliable()` and `shutdownReceipt()`. `CediaHostClient` gained `lifecycle()`,
`quitHost()` and `capabilities()`.

**R2 — shared Mac draft owner (`apps/host`).** New `apps/host/src/drafts.ts` validation
service over the durable store: schema version 3 with explicit migrations from 1 and 2, a
`drafts` table keyed by `(device_id, draft_id)` plus a `draft_submissions` table keyed by
`(device_id, draft_id, revision)`, compare-and-swap `writeDraft`, idempotent
`claimDraftSubmission` (same revision and payload hash returns the same command; a different
hash conflicts), revision-matched `clearDraft`, and one-time idempotent `importDrafts` that
never overwrites the first copy. Owner-only routes: `GET`/`PATCH /v1/drafts/:id`,
`POST /v1/drafts/:id/submissions`, `POST /v1/drafts/:id/clear`, `POST /v1/drafts/import`;
they answer `503 drafts_unavailable` rather than a fake success when the owner is absent.

**Retained from the earlier partial slice (unchanged here):** the host capability snapshot
in `apps/host/src/capabilities.ts` and the allowlisted, revision-checked CEDIA preference
owner in `apps/host/src/settings.ts` with owner-only `GET`/`PATCH /v1/settings`.

## Defect found and fixed during integration

`startHostServer` refactored `createRouter(host, auth, extras)` into a spread copy
`{ ...extras, lifecycle, settings, drafts, stateDir }`. Because `remote` is assigned onto
`extras` *after* the router is built, the router received `remote: undefined`, so
`POST /v1/remote/pair` failed and `cedia.pairDevice` produced no QR panel.
`apps/macos/test/ide-native-host.test.ts` ("pairs a device through the host and shows a real
QR code") failed; the same file passes at `HEAD` in a clean worktree, which isolated the
cause to this change. Fixed by giving the router one extras identity that `remote` is
assigned onto, and by declaring the status helpers before that object. The file passes again.

## Verification performed

| Command | Result |
|---|---|
| `bun test apps/host` | 168 passed, 0 failed (982 assertions), 23 files |
| `bun test apps/macos/test/app-lifecycle.test.ts apps/macos/test/agent-window-main.test.ts` | 21 passed, 0 failed (105 assertions) |
| `bun test packages/omp-adapter packages/relay apps/host apps/macos/test scripts/lib` | 1,003 passed, 1 failed (the pre-existing failure below), 123 files |
| `npx tsc --noEmit` | errors remain in 4 files, all untouched by this slice: `apps/macos/agent-window/vendor/synara/apps/web/src/nativeApi.ts` (7), `.../lib/serverReactQuery.ts` (1), `.../lib/providerDiscoveryReactQuery.ts` (1) and `apps/macos/test/state.test.ts` (1). Zero errors in `apps/host`, `packages/protocol`, `apps/macos/src` and the new test file. |
| `bun run --cwd apps/macos/agent-window typecheck` | passed, including the vendor tree (`tsc --noEmit && tsc --noEmit -p tsconfig.vendor.json`) |
| `node scripts/ci-validate.mjs` | `CI-OK parents=198 ui=75 children=129 lock-shas=3 doc-links=364 md=121 evidence=102` |
| `git diff --check` | clean |

Pre-existing failures, confirmed against a clean `HEAD` worktree (`0676dd70d54`, detached,
node_modules symlinked) rather than attributed to this change:

- `apps/macos/test/ide-native-workbench.test.ts` → "hands the Agents window the theme and the
  extension that paints it" fails at `HEAD` with an extra `someone.unrelated` key in
  `extensions.supportAgentsWindow`. Unrelated to this slice; not repaired here.
- Root `npx tsc --noEmit` is red at `HEAD` too: that worktree reports errors in 96 files,
  including the 4 above (plus `apps/macos/src/extension.ts`, `apps/macos/test/editor.test.ts`
  and the wider vendor web tree). Comparing error-file sets shows the current tree reports a
  strict subset with **no new error file**, so this slice adds no root typecheck error; the
  bundle-scoped typecheck, which is the plan's stated check for the vendor tree, is green.

## Not implemented / not claimed

- The Electron/Code-OSS main entry is not yet patched to install `installCediaQuitGuard` or
  to register a login item, so packaged close/Quit/Cancel/login and crash-adoption proof
  remain open. `apps/macos/src/app-lifecycle.ts` is verified by fixture only.
- Host crash with a surviving OMP child has no attach or `recovery_required` admission hook;
  the pinned runtime still owns its stdio session.
- No renderer is wired to the host draft owner yet: both windows still write the local
  `agent-ui` files and `synara:composer-drafts:v1`, and the one-time legacy import is not
  executed. Send reservation is therefore not yet used by a real Send.
- The vendored bundle does not yet consume the capability snapshot (navigation, settings,
  search, deep links), and no capability-status page exists.
- The versioned OMP settings bridge (`cedia_get_capabilities`/`cedia_control`), app-settings
  migration, cross-window broadcast and packaged two-window theme evidence are untouched.
- R3–R8 and every §8.2 O-packet remain open. Speech-to-text remains deferred and inactive.

## Limitations

These results are fixture and source evidence from the revision above. They are not a
packaged runtime, remote-network or device receipt, and they do not certify any D/W/N/F
checkpoint. Provider, relay, signing and device steps were not exercised.
