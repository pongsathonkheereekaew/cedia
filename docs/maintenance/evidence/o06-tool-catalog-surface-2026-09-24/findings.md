# The catalog both windows can draw — 2026-09-24

This receipt records the O06 catalog-surface slice: the composer's panel stack draws the runtime's
own tool catalog through the same adapter both windows use, and the two settled SDK rows now name
that real surface instead of a fallback string. §10 item 70 owns status; this file records what was
observed at the revision below. No provider request was made and no model turn was run.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`
  with this slice applied; the tree is dirty by design (no commit, push or publish was made).
- Pinned runtime unchanged: OMP `18.1.18`, patch sha256
  `d5d304b81985a5274da15fda19f0cf8b747df26f42a69997844674e42a91b039` (no `upstream/omp` file was
  touched, so no patch regeneration was due).
- Changed for this slice: `apps/macos/agent-window/src/cedia-adapter.ts` (`getToolCatalog` read plus
  the `cedia` namespace entry both windows consume);
  `vendor/synara/.../lib/serverReactQuery.ts` (tool-catalog query key, strict answer parsing,
  `serverToolCatalogQueryOptions`);
  `vendor/synara/.../components/chat/CediaToolCatalogSurface.tsx` (new: pure read-only panel plus
  the hook-backed surface);
  `vendor/synara/.../components/ChatView.tsx` (the panel mounted in the composer stack beside the
  tree surface for every server thread);
  `apps/macos/agent-window/test/cedia-tools-catalog.test.tsx` (new);
  `scripts/check-omp-coverage.ts` (`sdkPresentation` for `getAllToolInfos`/`getActiveToolNames`).

## What changed

- **One shared surface.** The composer draws the catalog both windows already render: name, source
  class (`Built-in`/`MCP`/`SDK host`/`Extension`), active marker, bounded descriptions with their
  truncation flags, the runtime's own `activeCount of total` line and its truncation notice. An
  absent runtime or bridge renders the host's own reason; a loading state never renders as an empty
  catalog. The panel carries deliberately no toggle, enable or refresh control: management writes
  stay a separate slice with their own gates.
- **An honesty fix.** The two rows the previous slice settled (`getAllToolInfos`,
  `getActiveToolNames`) fell through to the coverage script's goal-mode fallback presentation
  string. They now name the real path: the registered `tools.catalog.get` operation, the
  controller-visible host route, the composer panel, and the four proofs. Gap count unchanged at 75;
  integrity PASS.

## What was observed

- `bun test apps/macos/agent-window/test/cedia-tools-catalog.test.tsx`: 4 pass (strict parsing,
  panel rendering with no management affordance, unavailable honesty, adapter route use).
- `bun test apps/macos/agent-window/test`: 280 pass / 0 fail (276 + 4 new).
- `bun run --cwd apps/macos/agent-window typecheck` (app plus vendor trees): exit 0.
- No-regression sweep: root suites 1297 pass / 0 fail, `bun run check:omp-coverage` integrity PASS
  with 75 gaps, `node scripts/ci-validate.mjs` `CI-OK`, `git diff --check` clean, root typecheck
  holds the 10 pre-existing `apps/macos` errors only.

## Still open (not claimed)

- No management write and no catalog refresh path: `setActiveToolsByName`, the three refresh paths,
  `reload`, `extensionRunner`, code-mode partitions and `subscribeCommandMetadataChanged` stay gaps
  with their O06 reasons, and `/extensions` plus the `status` alias have no surface.
- The four dynamic-tool rows stay `integration_missing` under their owning packets (O05 image, O11
  speech, O10 browser/computer, O06 MCP/extension): the panel draws live presence per session, but
  no subsystem that registers those tools has landed, so nothing was reclassified to look greener.
- No packaged capture of the catalog panel exists.
