# Selective backport batch 1: transcript scroll ownership (#1308) + anchor coverage (#1322) — 2026-09-26

Ports upstream #1308 (reset scroll ownership before auto-follow on thread
switch) and the #1322 anchor-hold/overflow-handoff regression coverage that
matches our path. The global vendor pin is UNCHANGED
(`apps/macos/agent-window/upstream.json` stays `33333439c4b9c74d0097bc01196cccc921f67cf3`);
these are selective backports onto the pinned base, verified against the
immutable upstream checkout `a33435c18474eb7816582004e45f87382965ac8d`
(ref verified before use). §10 item 70 owns status. No provider involvement.

## What was ported (3 files, owned by this slice)

- `vendor/.../components/chat/useChatTranscriptScroll.ts`: the #1308 move —
  thread-switch reset runs as a layout effect declared before the auto-follow
  effect (was: passive effect that ran after auto-follow had already skipped
  the new thread). Exact upstream body + comment, plus a CEDIA note naming the
  separation from our `max-h-50` panel-stack fix (different defect, preserved).
  Sibling changes from #1285 in the same file region were deliberately NOT
  ported (blocking-question cancellation is out of scope).
- `vendor/.../components/chat/useChatTranscriptScroll.browser.tsx` (new):
  only the #1308 regression test (idle destination followed after leaving a
  detached transcript); #1285's sibling test not ported.
- `vendor/.../components/ChatView.browser.tsx`: #1308's two test-race fixes
  (QueryClient cancel+clear on cleanup; wait-for-unmount + streaming-message
  wait on thread switch) and the full #1322 anchor test update (40 chunks,
  bottom tracking, hold-vs-handoff split, overflow assertions) — the anchor
  test is now byte-identical to upstream post-#1322 (11,042 chars).

## Proof

- New regression test via vitest browser (real Chrome): 1 passed.
- Root `tsc --noEmit`: clean. Vendor program: only the known pre-existing
  `CediaToolCatalogSurface.tsx` error from another slice's in-flight file —
  untouched here.
- Rebuilt bundle + `bun scripts/agent-window-smoke.ts`: PASS (`ok: true`, 0
  provider calls) — thread switches, transcript render, and the `max-h-50`
  stack fix coexist.
- `git diff --check`: clean.

## Not claimed

- The full ChatView geometry browser suite was not run here (needs its CI
  harness); the ported tests run where browser CI runs.
- No wholesale vendor upgrade, no ACP, no OMP pin change, no behavior change
  beyond scroll-ownership ordering.
