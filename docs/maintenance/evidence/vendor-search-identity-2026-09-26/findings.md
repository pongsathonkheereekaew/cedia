# Selective backport batch 24: #1290 search identity (stable palette) — 2026-09-26

Ports the #1290 `Sidebar.tsx` search-identity hunks: per-thread message
projections cached in a WeakMap plus a `useStableValue` wrap so the
rebuilt palette list keeps its identity while nothing shown changed
(pairing with batch-14's field equality and batch-23's sort work). The
global vendor pin is UNCHANGED; ported from the release PR patch with
per-file base verification. §10 item 70 owns status. No provider
involvement. No gap change (stays **2**).

## Base verification (before touching)

- `useStableValue` hook absent in-tree; upstream file identical at pin and
  release (1 KB, react-only) → ported byte-identical as a new file.
- `Sidebar.tsx` locally diverged (capability-gating + prior slices in the
  same diff regions): 4/5 hunks applied via patch, the controller hunk
  rejected (line drift) and applied manually against CEDIA's exact region
  — memo rename, message-projection swap, stable wrap with CEDIA's own dep
  array (no `props.projects`: CEDIA's memo never reads it). `.rej`
  removed afterwards. `Thread` type already imported; `threads=` prop now
  reads the stable value.
- The second #1290 `useStableValue` use site (another file) stays out as a
  separate owner.

## What was ported (2 files)

- `hooks/useStableValue.ts` (new, byte-identical to upstream pin/release).
- `Sidebar.tsx`: imports, WeakMap message cache + `searchPaletteMessagesFor`,
  `rebuiltSearchPaletteThreads` rename with explanatory comment,
  `useStableValue(rebuilt, areSidebarSearchThreadListsEqual)` wrap.

## Proof

- Comparator semantics pinned by the batch-14 stability tests (4 green,
  re-verified with this slice's typecheck run); the hook + wrap are
  upstream-verbatim and typechecked. No new test: hook testing needs a
  renderer the tree does not vendor (no testing-library/jsdom), recorded
  rather than worked around.
- Root `tsc --noEmit`: clean. Vendor program: only the known pre-existing
  `CediaToolCatalogSurface.tsx` error from another slice's in-flight file.
- Rebuilt bundle + `bun scripts/agent-window-smoke.ts`: PASS (`ok: true`,
  0 provider calls, `errors: []`, batch-21 `archiveRestore` still true).
- `package:mac` (Node 24 via `CEDIA_HOST_NODE`) + `bun run check:packaged`:
  all checks OK with batch 24 inside.
- `git diff --check`: clean.

## Not claimed

- No wholesale vendor upgrade, no ACP, no OMP pin change, no behavior
  change beyond palette identity stability.
- D1–D5 and the open `switchSession` untouched; uncommitted tree preserved,
  nothing committed.
