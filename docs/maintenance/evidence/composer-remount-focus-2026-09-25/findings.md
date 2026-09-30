# Defect note (composer teardown on task open swallows in-flight input)

Opening a task from home tears the composer down and remounts it ~60 ms later. Input
landing exactly in that window is silently dropped: the focused contenteditable node
is replaced, browser focus falls back to `<body>`, and a programmatic fill completes
without error but inserts nothing - leaving an empty composer and a disabled Send.

## Confirmed mechanism (hash timeline, 2026-09-25)

The teardown is the secondary-chrome defer (`ChatView.tsx`: `secondaryChromeReady`
gates the real composer form vs the deferred placeholder), and it fires here for a
genuine reason: the route itself changes identity. Instrumented runs show the home
route holding one id (`#/<draft-or-project>`) while the clicked task lands on the
session id (`SESSION-ID` printed server-side matches the post-click hash exactly):

- `~500ms HASH=#/824a...` (home), `R-` form mounted
- task click `~1100ms` -> `-D` (unmount) `~60ms` -> `R-` (remount) -> `HASH=#/2d58...` (session)

So this is a draft/project -> session navigation: a real thread-identity change, and
the teardown is the designed thread-switch behavior, not a stale-render bug. A
same-thread skip was tried and reverted - it cannot apply when the ids genuinely
differ, and it was removed to keep the tree free of speculative vendor edits.

## How the drop was proven

- Loop harness (open task, fill once visible, read back DOM text + Send state):
  ~30-75% of runs show text `"\n"` with Send disabled, stable indefinitely.
- Page-side instrumentation (`beforeinput`/`input` capture listeners,
  MutationObserver on the editor subtree, `activeElement`): stuck runs show NO
  `beforeinput` at all with focus on `<body>`; healthy runs show the
  `focusin` + `insertText (canceled=false)` sequence. The fill never dispatches.

## Ruled out along the way

- Host-draft wipe: no `uiDraft read` crosses the fixture IPC (one `uiDraft write`
  of the empty draft, accepted, before the click).
- `isConnecting` editable toggle: the Send aria-label never reads "Connecting".
- Lexical remount by key (`COMPOSER_EDITOR_HMR_KEY` is constant) and the controlled
  value sync (snapshot guard returns early on equal strings).
- The checkpoint's `e is not iterable` hydrate throw did NOT reproduce in 35+ runs
  on the current build; it stays an unreproduced intermittent, not this defect.
- Build forensics footnote: verify renderer behavior against the `main-*.js` chunk,
  not `appSettings-*.js` - the composer lives in main. An A/B rebuild with a
  one-line source change flips the main chunk hash, so `build:agent` tracks source.

## Mitigations in place (no vendor change)

- `scripts/agent-window-smoke.ts#fillComposerAndSend` and the live smoke fill both
  settle, fill, wait for Send-enabled, and refill (up to 3 attempts) when a late
  re-render wins the race. The plan's gates no longer depend on winning the window.
- Real-user impact is narrow: only input within ~100 ms of clicking a task can drop,
  and the dropped focus is visible (caret gone). A durable fix would keep the
  teardown for genuine switches while preserving focus/in-flight input across it -
  a slice of its own, not a drive-by edit.
