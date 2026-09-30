# Live two-renderer Send-vs-edit race — 2026-09-26

Stages the race the [harness spec](../r2-race-harness-spec-2026-09-26/findings.md)
specified but did not build, against the real pinned runtime with zero provider
involvement. No gap change (stays **2**). §10 item 70 owns status.

## What was proven (36 checks, `bun run smoke:send-race`, full log in `run.log`)

Two independent renderer paths — two `createCediaNativeApi` adapters through the
real main-process `createAgentWindowHandler` (production's one-main-process,
two-window topology) — against one live host and `omp/18.1.18`. The model
endpoint is a loopback listener that never answers; both turns are attested on
`cedia-race-fixture/cedia-race-fixture-model` with 2 loopback hits and zero
external requests.

- Same text, interleaved: A reserves revision 1 and its dispatch parks at this
  driver's bridge; B reserves the same revision, dispatches first, both turns
  settle on the ONE bound command (`race-a1` on both posts), the journal holds
  exactly one prompt, the first release delivers the draft (`cleared: true`)
  and the second is a revision-gated no-op (`cleared: false`), the 404 and the
  `delivered` broadcast follow.
- Different text: B's reservation answers 409 with a user-facing error and zero
  dispatches; the winner's text stays intact on the host; the journal holds
  exactly the two winning prompts and no loser row.
- Restart on the same state directory: command journal, session incarnation and
  the delivered (absent) draft all survive unchanged.

## Defect found and fixed in this slice

Staging round 2 exposed a real product bug: `clearDraft` deleted only the
`drafts` row, leaving the spent `draft_submissions` claim behind. The next
draft restarts at revision 1, so its reservation collided with the spent claim
and **every second composer Send on the same task refused as a cross-window
conflict**. Fixed in `apps/host/src/store.ts`: a clear that actually deletes
the draft row deletes that revision's submission in the same transaction; a
stale clear that matches nothing leaves live claims alone. Regression test in
`apps/host/test/drafts.test.ts` (deliver → re-draft → re-reserve succeeds;
stale clear preserves the live claim). This is why the harness, not a fixture
replay, was the missing proof.

## The hold, and why it cannot ship open

Determinism comes from explicit sequencing plus one parked promise in window
A's driver bridge between reserve and release — exactly the window the spec
named. The hold lives entirely in `scripts/omp-send-race-proof.ts`; no
product or fixture code carries a test hook. Scripts never ship
(`bun run check:packaged` covers the bundle only).

## Honestly scoped

Headless adapters, not Chromium windows: the send path under test is the
renderer's production code (reserve → dispatch → release), the host CAS, and
the durable envelope — all live. A packaged two-window run with on-screen
renderers remains open, as do the provider-backed approval/tool-loop turns
(probe 11 closed the loop; always-ask flake and `confirm`-frame synthesis are
separate items).

## Preserved

- D1–D5, `switchSession` open. Pin unchanged (`omp/18.1.18`). Nothing
  committed; uncommitted tree preserved (`git diff --check` clean).

## Addendum (packaged two-window run, 2026-09-27)

- New `bun run smoke:send-race-packaged` (`scripts/omp-send-race-packaged-proof.ts`):
  same topology as `agent-window-smoke.ts --native` (in-process host on fixture OMP +
  packaged `Cedia.app` via `_electron`, scratch profile/state dir). Opens the fixture
  task in the Agents window, opens the IDE on the same project (2 on-screen windows
  sharing the host, AGENT dock panel verified open by screenshot).
- Window 1 sends on-screen (typed + Send click in the Agents window); window 2 sends the
  same text through a second production adapter bound to the same host (the IDE dock is
  a Code-OSS webview, not reachable from Playwright — and the IDE extension shows
  Cedia-offline since it spawns its own host view; the race under test is the host
  draft CAS, and both sends travel the production adapter→handler→host path).
- Green: `WINDOW-B: accepted`, journal holds exactly ONE prompt row across all sessions,
  no duplicate. Screenshots in `dist/send-race-packaged-proof/`.
- Honestly scoped: simultaneous-interleave (both reserving revision N at once) stays
  headless-only (`smoke:send-race` rounds 1–2 with the parked-bridge hold); on-screen
  timing cannot deterministically land both sends inside one revision window.
  `switchSession`/`browser-relay` untouched.
