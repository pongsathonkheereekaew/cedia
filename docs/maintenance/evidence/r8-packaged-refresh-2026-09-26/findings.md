# Repackage after vendor batch 6 — 2026-09-26

No product code changed; no gap change (stays **2**: `switchSession`,
`browser-relay`). No provider involvement.

## Cause

`bun run check:packaged` failed on exactly one check: Agent Window assets in
`VSCode-darwin-arm64/Cedia.app` no longer matched the stamp/local build. The
batch-6 slice (`vendor-markdown-alerts-2026-09-26`) rebuilt
`dist/agent-window` but the packaged app still carried the pre-batch bundle,
so the package was stale relative to the tree — not a source defect.

## Action

- `CEDIA_HOST_NODE=/Users/pond/.caret-tools/node-v24.18.0-darwin-arm64/bin/node
  bun run package:mac` — rebuilt the Agent Window, restamped
  `product.json` (patch set `086d31f75d36`, 18 patches over
  `ea1912fd6a05`), refreshed workbench checksums, re-signed ad-hoc.
  (First attempt without the env failed by name as designed:
  `Set CEDIA_HOST_NODE to the Node 24 executable to bundle`.)
- `bun run check:packaged` — all checks OK, including
  `Agent Window assets match the stamp and local build` and
  `packaged Cedia.app matches the current patch set`.
- `bun scripts/agent-window-smoke.ts` against the new package —
  `ok: true`, `providerCalls: 0`, `errors: []`
  (`dist/agent-window-smoke/result.json`).

## Preserved

- D1–D5 owner decisions untouched (no source changed, no reclassification).
- `switchSession` stays open with its reason; no retarget feature added.
- OMP-native auth path untouched; smoke made zero provider calls.
- All 535 pre-existing uncommitted tree modifications preserved; nothing
  committed by this slice.

## Still open on this build

Login cycle, background launch, crash/adoption on real state,
approval/tool-loop proof (needs an answering model), provider-backed paths.
