# R2 shared Mac draft in the runtime path — 2026-09-24

This receipt records the slice that makes the host draft owner the authority the two Mac
windows actually use (CEDIA-PLAN.md §2.5). Evidence is fixture-based: no packaged build, no
real two-window run and no provider call happened. §10 item 70 remains the owner of status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, 45+ changed entries at inspection (the plan,
  instructions, READMEs, `.scratch/`, dated evidence, and the R1/R2 implementation of the
  previous slices). Existing work was preserved.
- Before this slice the draft store and its routes existed but nothing used them: both windows
  still wrote the local `agent-ui` file, so the host record could not be authoritative.

## Implemented in this working tree

**Host draft record carries the shared payload.** `DraftSnapshot` gained an optional
`content: Json` next to `text` and `attachments`. `text` stays the readable projection (for
search and the eventual Send summary); `content` is the renderer's own serialized composer
draft, opaque to the host and bounded to 2 MiB. `writeDraft` persists it, a patch that omits
it keeps the stored one (so a caller touching only `text` cannot erase the other window's
draft), and `importDrafts` carries it too. `PATCH /v1/drafts/:id` accepts the field.

**Schema repair in place.** The column was added while the schema version was already 3, so
`initializeSchema` now checks `PRAGMA table_info(drafts)` and adds `content_json` when a state
directory was written by that intermediate build, instead of failing every draft read.

**Main process owns the translation** (`apps/macos/src/agent-window-main.ts`):
`createSharedDraftAccess` turns the renderer's read/write into the draft routes with the
revision the host reported. Results are explicit - `accepted`, `conflict` (with the winning
payload) or `unavailable` - and nothing is reported as saved when it was not. The
pre-host `agent-ui` draft file is read **once** per task to import it (`source:
"agent-ui-import"`) and is never written again; the same file plus a sibling revision record
is kept only as an offline cache, so a window can still resolve and show a draft while the
host is unreachable. `draftTextOf` projects the composer text out of the payload.

**Renderer speaks revisions** (`vendor/synara/apps/web/src/sharedUiDraftBridge.ts`): writes
send `expectedRevision` and adopt the host revision from an accepted write. A newer revision
is adopted automatically only when nothing local is pending; when the user typed here since
the write started, the local text is kept, the newer payload is recorded as a conflict and
that thread stops writing. `getConflict`/`resolveConflict("mine" | "theirs")` expose the
choice; "mine" re-sends the local text on top of the revision the host reported. Hydration on
route change, window focus and `flush()` already existed and now use the same envelope.

## Tests changed because the contract changed (not weakened)

Two existing tests asserted the *old* local-only draft. `agent-ui-state.test.ts` now asserts
the host-owned draft with a stateful fake host (`accepted` with a revision, and a rejected
write without `expectedRevision`), and the "unsent draft" test still proves the product rule
it was written for: writing a draft reaches the host **only** as a draft record - the call
list is exactly `["PATCH drafts/draft-1", "GET sessions/draft-1", "GET projects"]`, so no OMP
session and no command is created, and the workspace handoff still resolves the draft before
its session exists.

## Verification performed

| Command | Result |
|---|---|
| `bun test apps/host/test/drafts.test.ts apps/host/test/store.test.ts apps/host/test/http.test.ts` | 27 passed, 0 failed (174 assertions) |
| `bun test apps/macos/test/shared-draft.test.ts apps/macos/test/agent-ui-state.test.ts` | 6 passed, 0 failed |
| `bun test apps/macos/agent-window/test` | 106 passed, 0 failed (322 assertions), 25 files |
| `bun test packages/omp-adapter packages/relay apps/host apps/macos/test scripts/lib` | 1,017 passed, 1 failed (the pre-existing `ide-native-workbench` theme failure below), 124 files |
| `bun run --cwd apps/macos/agent-window typecheck` | passed, including the vendor tree |
| `bun run build:agent` | built (the vendor bridge change bundles) |
| `node scripts/ci-validate.mjs` | `CI-OK parents=198 ui=75 children=129 lock-shas=3 doc-links=369 md=123 evidence=104` |
| `git diff --check` | clean |

Root `npx tsc --noEmit` keeps its pre-existing vendor/`state.test.ts` errors only; nothing in
`apps/host`, `packages/protocol` or `apps/macos/src` is reported. The
`ide-native-workbench.test.ts` theme failure also fails at `HEAD`.

New fixtures prove: payload round-trip and retention when a patch omits it; size and
serializability rejection; one-time import (the second read hits the host instead); a stale
writer conflicts with the winning payload intact; an unreachable host keeps the text and
serves it from the cache; the renderer carries revisions between writes, adopts a newer
revision when nothing is pending, and on a real conflict keeps its own text, stops writing,
and honours either choice.

## Not implemented / not claimed

- **No cross-window push.** The host stores and broadcasts nothing to clients; the two windows
  converge when a window hydrates (route change, focus) or on the next successful write. §2.5
  asks for the new revision to be broadcast to both Mac windows, and that channel is still
  missing.
- **No conflict surface.** `getConflict`/`resolveConflict` exist and are tested, but no view
  renders them, so the plan's "offer compare/reapply or use-latest" is not yet user-visible.
- **Send still does not use the reservation.** Nothing calls
  `POST /v1/drafts/:id/submissions`, so the "one revision produces one command" rule is
  implemented and tested at the store/route level only.
- Attachments are carried inside `content`; the normalized `attachments` projection is not
  populated from the renderer payload yet.
- No packaged or real two-window run: R4's "two independent Mac draft renderers" scenario and
  the R3 Send-versus-edit race are not exercised here. R2/R3/R4 and every §8.2 O-packet remain
  open; speech-to-text stays deferred.

## Limitations

Fixture evidence from the revision above. Combined with the earlier receipts, this makes the
draft owner reachable from both windows at the code and test level; it does not certify the
desktop checkpoint, packaging, or any remote/native behaviour.
