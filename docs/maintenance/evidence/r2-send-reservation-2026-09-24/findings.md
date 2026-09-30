# R2 Send uses the draft submission reservation — 2026-09-24

This receipt records the slice that makes a real Send go through the shared draft owner
(CEDIA-PLAN §2.5 items 2 and 3), which the previous slices had implemented and tested only at
the store and route level. Evidence is fixture-based: no packaged build and no two-window run.
§10 item 70 remains the owner of status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the previous slices plus this one.
- Before this slice nothing called `POST /v1/drafts/:id/submissions`, so the "one revision
  produces one command" rule could not hold in a real send.

## Implemented in this working tree

**The shared draft owner can reserve and release.** `createSharedDraftAccess`
(`apps/macos/src/agent-window-main.ts`) gains `reserve(threadId, commandId, message)` and
`release(threadId, revision)`:

- `reserve` reads the task's draft revision from the host, then claims
  `(device, draftId, revision)` with `sha256:<hex>` of the exact turn text as its opaque
  identity token. The host returns the command bound to that revision, so a repeated send of
  the same revision resolves to the **same** command rather than a second one. A revision
  already sent with different text answers 409 and becomes `conflict`; a task with no draft
  record, or any other failure, becomes `none` so bookkeeping never blocks a send.
- `release` clears the draft only while its revision still matches, so an edit made in the
  other window while the turn was being accepted survives.

**The Agent Window surface carries it.** The `uiDraft` request the composer already uses gains
`action: "reserve"` and `action: "clear"`, so the adapter can ask the owner without a second
channel. A clear without a revision is rejected rather than silently dropping whatever is
there now.

**The adapter reserves before dispatch** (`apps/macos/agent-window/src/cedia-adapter.ts`,
`thread.turn.start`): it dispatches with the command the host bound to the revision (including
the `not_dispatched` retry, which reuses the same command id), throws a user-facing error on a
conflict instead of sending, and releases the draft only after the turn is accepted.
`reserveDraftSubmission`/`releaseDraftSubmission` swallow transport failures: an unavailable
draft owner leaves the send exactly as it was before this slice.

## Defect found and fixed during this slice

The new "releases a delivered draft only while its revision still matches" fixture failed
because the offline cache still held the payload: after a successful clear the host answered
404, the next read re-imported the cached payload and the **text the user had just sent came
back as a fresh draft**. Fixed by clearing both cache records with the release (a new
`removeAgentUiState` helper), so the read afterwards honestly returns nothing. The
revision-mismatch path is unchanged: `cleared: false` leaves the cache and the newer draft
alone.

Two test fixtures also stopped recording the non-HTTP draft traffic in their call lists
(`adapter.test.ts`, `composer-image-turn.test.ts`): those rows carry no `path`, so leaving them
in would have made every `path`-based assertion in those suites meaningless. The assertions
themselves are unchanged.

## Verification performed

| Command | Result |
|---|---|
| `bun test apps/macos/test/shared-draft.test.ts` | 8 passed, 0 failed (29 assertions) |
| `bun test apps/macos/agent-window/test` | 118 passed, 0 failed (360 assertions), 28 files |
| `bun test packages/omp-adapter packages/relay apps/host apps/macos/test scripts/lib` | 1,021 passed, 1 failed (the pre-existing `ide-native-workbench` theme failure), 124 files |
| `bun run --cwd apps/macos/agent-window typecheck` | passed, including the vendor tree |
| `bun run build:agent` | built |
| `node scripts/ci-validate.mjs` | `CI-OK parents=198 ui=75 children=129 lock-shas=3 doc-links=373 md=125 evidence=106` |
| `git diff --check` | clean |

New fixtures prove: a task with no draft reserves nothing; a reserved revision returns the
command bound first even when a second window asks with its own; different text at the same
revision is a conflict; release honours the revision (a newer edit survives and the delivered
text does not come back); the reservation path never throws when the host cannot answer; the
Agent Window surface exposes reserve/clear and rejects a revision-less clear; and the real
adapter dispatches with the canonical command id, stops on a conflict without posting any
command, and falls back to its own command id when the owner is unavailable.

## Not implemented / not claimed

- **No cross-window push and no conflict surface.** The draft bridge still converges on
  hydrate/focus, and `getConflict`/`resolveConflict` have no view.
- The end-to-end acceptance scenario is not exercised: two independent renderers racing an
  edit and a Send, then a restart (R4's scenario), needs a packaged or real two-window run.
- Attachments stay inside the draft `content`; the normalized `attachments` projection is
  still empty.
- The reservation adds one `GET /v1/drafts/:id` before a turn, and a turn is not queued behind
  it; the per-task intent/queue projection of §2.4 is still R3 work.
- R6-R8 and every §8.2 O-packet remain open; speech-to-text stays deferred.

## Limitations

Fixture evidence from the revision above. It proves the send path now uses the shared draft
identity at the code and test level; it does not certify the desktop checkpoint, packaging or
any two-client behaviour.
