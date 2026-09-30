# Dynamic provider-tab projection fixture — 2026-09-28

## Scope

This is a source/fixture projection check for the F dynamic-provider acceptance row. It adds no
runtime behavior. The existing live OMP receipt already proves provider add/remove and owner
catalog changes in one host-backed session; this test checks how changed model-catalog snapshots
map into the composer model picker's upstream tabs and rows.

## Procedure and result

`apps/macos/agent-window/test/provider-tabs.test.ts` now supplies an initial OMP catalog with
OpenAI Codex, adds the live-approved `opencode-go/muse-spark-1.3-contributor` row, and then removes
that provider. The assertions verify:

- the new `upstream:opencode-go` tab appears with its OpenCode Go label;
- the row appears only on that upstream tab with the exact Muse model identity;
- the pre-existing OpenAI Codex tab keeps its stable ID; and
- after removal, both the OpenCode Go tab and its model row disappear.

Command: `bun test apps/macos/agent-window/test/provider-tabs.test.ts` — **7 pass, 0 fail, 29
expectations**. No app, device, provider or paid model call was used.

## Limits

The test passes updated catalog snapshots directly to the composer view-model helpers. It does not
verify the live React Query invalidation path, a mounted/packaged renderer receiving the update,
remote/iPhone projection, or all §11.1 semantic/dynamic scenarios. It is one F source/fixture
projection case, not F acceptance. Those remain open under §10 item 70.
