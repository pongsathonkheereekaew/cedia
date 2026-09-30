# The packaged shell matches the tree again — 2026-09-25

This receipt records an item-40 repair: `bun run check:packaged` was red, so the
shipped `Cedia.app` was older than the working tree it claims to ship. Repackaging
turns the gate green. §10 item 70 owns status. No provider request was made.

## What was wrong

- `FAIL Agent Window assets are missing or differ from the stamp/local build` —
  the packaged bundle predated the recent slices, including the agent-window
  renderer fixes (fresh-profile settings defaults, idle→ready session status) and
  everything landed since.
- `FAIL packaged Cedia.app does not verifiably match the current patch set` —
  the stamp recorded an older patch digest than the repository's
  `086d31f75d3688905304e07758c808e138632c4fb672167950c6df01e45a31b5`
  (18 patches).

## What was done

- `bun run package:mac` with `CEDIA_HOST_NODE` pointing at the Node 24
  executable (without it the script exits 1 demanding the variable — recorded
  here so the next run does not rediscover it). The run rebuilt the Agent Window
  assets, stamped `product.json` with the current 18-patch set, refreshed the
  workbench checksums, and ad-hoc re-signed the bundle.
- `bun run check:packaged`: 12/12 OK — patch-set sha, base revision, patch
  count, all four shell shas, Agent Window assets vs stamp and local build, and
  the three at-least-as-new-as-patch gates.
- `bun scripts/verify-packaged-cedia.ts`: structural checks green (binary
  present, codesign verifies, argv keeps `password-store=basic` with in-memory
  secret storage and no crash reporter, bundled standalone OMP + host + remote
  web client present). `uiVerified: false` — this slice proves the package
  matches the tree, not a rendered run.

## Still open (not claimed)

- No packaged window was rendered from this build; UI verification, the login
  cycle, background launch, crash/adoption and update paths keep whatever status
  the handoff's not-verified list gives them.
- The agent-window browser smoke proves the bundle's behavior; the packaged
  native path is exercised separately.

## Addendum 2026-09-25: repackaged with the transcript-stack fix, native smoke green

Preconditions re-verified, not assumed: desktop patch integrity 18/18 with
matching SHAs (the old "modified manifest + 3 unmanifested" state is gone —
0060/0061/0062 are now manifested); OMP runtime attestation matches the manifest
(rev `00085d4e`, patch sha `8e8a74…`, exe sha `f78a41a4…`); `check:packaged`
before this run was 10/12 with only the Agent Window assets stale by design.

- `bun run package:mac` (`CEDIA_HOST_NODE` = Node 24): agent-window rebuilt,
  stamp `086d31f75d36` (18 patches), checksums refreshed, ad-hoc re-signed.
- `bun run check:packaged`: 12/12 OK — agent-window assets `76f1dd6b…`
  match stamp and local build; packaged app matches the current patch set.
  Packaged 2026-09-25T16:54:33Z, upstream `ea1912fd6a05`, source branch `main`
  at `0676dd70d54` dirty (all prior uncommitted slices preserved, nothing
  committed).
- `verify-packaged-cedia.ts`: structural checks green (`uiVerified: false`
  here — UI proof is the native run below, not this script).
- `bun scripts/agent-window-smoke.ts --native` on this build: PASS —
  `ok: true`, `providerCalls: 0`, `errors: []`; first send renders the fixture
  response (the transcript-stack fix working in the packaged path), reload
  persistence, second task in its own worktree, Open in IDE, Meta+Shift+A
  return to two live windows with the IDE handoff cwd canonical.
  Screenshots `home/conversation/restored/returned-from-ide` in
  `dist/agent-window-native-smoke/`.

Still open on this build (unchanged): login cycle, background launch,
crash/adoption paths, approval/tool-loop proof (needs an answering model —
free tier silent, see `o11-tooloop-attempt-2026-09-25`), provider-backed
usage/tiers/accounts.
