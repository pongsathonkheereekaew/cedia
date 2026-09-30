# Selective backport batch 7: live tool-run folding (#1274) — 2026-09-26

Ports upstream #1274 (both commits: fold the live tool run into one accordion
line wearing its newest call; fold multi-file edits by rendered rows, not
calls). The global vendor pin is UNCHANGED (`upstream.json` stays
`33333439c4b9c74d0097bc01196cccc921f67cf3`); this is a selective backport from
the immutable release checkout `a33435c18474eb7816582004e45f87382965ac8d`
(ref verified before use) plus the PR patch fetched from the release PR.
§10 item 70 owns status. No provider involvement. No gap change (stays **2**:
`switchSession`, `browser-relay`).

## Base verification (per-file, before touching)

Compared each target against the PR parents by blob hash and against the pin:

- Exact PR-parent match (applied cleanly): `MessagesTimeline.logic.ts`,
  `ToolCallGroupSummaryRow.tsx`, `toolCallGroup.logic.ts`,
  `MessagesTimeline.toolGroupCollapse.browser.tsx`.
- CEDIA-diverged but hunks apply with matching minus-side, verified in diff:
  `MessagesTimeline.tsx` (only local delta is the Cedia rewind-gate
  adaptation at ~line 1551, far from the two render-site hunks),
  `TimelineWorkEntryRow.tsx` (SAME-as-pin; PR parent moved other regions,
  the ported regions match), `lib/icons.tsx` (only local delta is batch 6;
  one-line `BookOpenIcon` add lands after `BookIcon`).
- Upstream unit test files (`MessagesTimeline.logic.test.ts`,
  `MessagesTimeline.test.tsx`) are NOT vendored, so their hunks were not
  applied; behavior is pinned by a new Cedia test instead (below).
- Sibling/other-PR changes in the same files between PR base and release
  were deliberately NOT ported (release deltas remain: logic +row-count
  regions excluded, browser file extended by later PRs).

## What was ported (7 files + 1 new test)

- `MessagesTimeline.logic.ts`: `liveEntry` on the render chunk,
  `pickLiveToolEntry` (newest real call; iconless status rows win only when
  alone), `isFoldedWorkEntryChunk`, `resolveWorkEntryChunkFold` (`:live`
  open-state suffix so a run settles collapsed even when opened live),
  cap counts folded chunks as zero open rows, multi-file row-count
  thresholds via `workEntryRowCount`.
- `MessagesTimeline.tsx`: both render sites (group + inline) fold through
  `resolveWorkEntryChunkFold`, pass `liveEntry`, key open state with the
  fold suffix.
- `TimelineWorkEntryRow.tsx`: generic tool calls read `BookOpenIcon`
  ("consulted something") instead of the bolt; row sentence extracted to
  exported `workEntryDisplayParts`/`workEntryDisplayText` shared with the
  live line.
- `ToolCallGroupSummaryRow.tsx`: `liveEntry` prop; a live line wears the
  newest call's sentence (or `multiFileEditLabel`, e.g. "Edited 9 files")
  with `data-tool-group-live="true"`, settled lines unchanged.
- `toolCallGroup.logic.ts`: `workEntryRowCount` (a file-change call counts
  its changed files), `multiFileEditLabel`, fold thresholds count rows.
- `lib/icons.tsx`: `BookOpenIcon = centralIconWrapper("newspaper-2")`.
  Asset check: `newspaper-2.svg` ships in the vendored
  `public/central-icons-{reversed,fill}/` (both variants) and in upstream
  release, so the glyph resolves — no asset gap.
- `MessagesTimeline.toolGroupCollapse.browser.tsx`: #1274 hunks applied to
  the SAME-as-pin file (live run folded to newest call, click reveals
  earlier calls).
- `MessagesTimeline.liveFold.test.ts` (new): mirrors the release assertions
  for both commits — live tail wears newest call, running work never
  collapses, singleton stays open, live run never capped, fold reveals only
  pre-worn calls with `:live` suffix, lone multi-file patch folds to
  "Edited N files" live and settled, single-file edit stays a plain row.

## Proof

- New unit test via vitest: 10 passed.
- Root `tsc --noEmit`: clean. Vendor program: only the known pre-existing
  `CediaToolCatalogSurface.tsx` error from another slice's in-flight file —
  untouched here.
- Rebuilt bundle + `bun scripts/agent-window-smoke.ts`: PASS (`ok: true`,
  0 provider calls, `errors: []`).
- `package:mac` (Node 24 via `CEDIA_HOST_NODE`) + `bun run check:packaged`:
  all checks OK — the package matches the tree with batch 7 inside.
- `git diff --check`: clean.

## Not claimed

- The ported `.browser.tsx` regressions were not executed here: the
  `vitest.browser.config.ts` harness is not vendored (only
  `vitest.providers.config.ts` ships), so there is no local browser runner
  for it. Render proof rests on the unit tests plus the agent-window smoke.
- No wholesale vendor upgrade, no ACP, no OMP pin change, no behavior change
  beyond live-run folding and row-count thresholds.
- D1–D5 and the open `switchSession` untouched; uncommitted tree preserved,
  nothing committed.
