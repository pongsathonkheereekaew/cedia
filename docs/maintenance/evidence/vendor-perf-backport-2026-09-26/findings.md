# Selective backport batch 2: streaming/idle efficiency (#1258, #1290 parts) — 2026-09-26

Ports upstream #1258 (reveal-tail settle, hidden-document presentation ticks)
and the #1290 memoization pieces for `useTurnDiffSummaries` /
`ReviewFileTreePanel` only. Global vendor pin unchanged
(`33333439c4b9c74d0097bc01196cccc921f67cf3`); all four files verified
byte-identical to their pre-change upstream base before porting (plus our tree
clean vs HEAD). Source: immutable checkout `a33435c…` (ref verified). No
provider involvement. §10 item 70 owns status.

## What was ported (owned by this slice)

- `hooks/useSmoothStreamedText.ts`: settle a sub-1/1000-char reveal remainder
  (exact 6-line upstream body). Fixes the last character staying hidden with
  rAF running indefinitely at high refresh rates.
- `hooks/useNowMs.ts` + new `lib/visibleInterval.ts` (exact 41-line copy):
  elapsed-label ticks suspend while the document is hidden and refresh once on
  resume. Presentation-only by contract (helper header forbids provider/
  transport use); verified callers are presentation-only —
  `ContextWindowMeter`, `WorkflowRunCard`, `ComposerGoalHeader`. No OMP
  execution or transport liveness path reads this hook. Same
  `document.visibilityState` API in the IDE webview and the standalone window,
  so no variant code.
- `hooks/useTurnDiffSummaries.ts`: stable empty array + memoized inference
  (exact upstream body) — stops invalidating ChatView memos on every streamed
  flush.
- `components/ReviewFileTreePanel.tsx`: memoized filter + tree build (exact
  upstream body).
- `hooks/useSmoothStreamedText.energy.test.ts` (new, exact copy): lifecycle
  regression incl. final-character reveal (`shown === 100`) and sleep/wake.

## Proof

- Energy test (plain vitest, no browser): 7 passed. Scroll regression test
  (batch 1): re-ran green after these edits.
- Root `tsc --noEmit`: clean. Vendor program: only the known pre-existing
  foreign-file error, untouched.
- Rebuilt bundle + `bun scripts/agent-window-smoke.ts`: PASS (`ok: true`, 0
  provider calls).

## Not claimed

- No speedup/battery percentages (no measurement made; none cited).
- No other #1290 server/desktop/web hunks (different owners/services).
- Server-side catalog/turn optimizations were not adopted (Synara server paths
  do not exist in CEDIA; OMP owns execution truth).
