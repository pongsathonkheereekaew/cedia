# Slice (extension enable/disable in the Tool catalog panel + `/extensions` settlement)

The extension toggle host route existed with no window driving it: the panel showed
extension records read-only while `POST /v1/sessions/:id/tools/extensions/set` had only
its host tests. This slice wires the operation end to end and settles the two audited
rows that named it.

## What was built

- Adapter (`apps/macos/agent-window/src/cedia-adapter.ts`): `setExtensionEnabled`
  posts `{commandId, incarnation, id, enabled}` to `.../tools/extensions/set` with a fresh
  command id and the session's live incarnation, mirroring `setActiveTools`.
- Mutation (`serverReactQuery.ts`): `serverToolExtensionSetMutationOptions` parses through
  `parseCediaExtensionsAnswer` and invalidates the extensions query on an available answer.
- Panel (`CediaToolCatalogSurface.tsx`): `CediaExtensionsSection` renders a per-row
  Enable/Disable toggle for `active`/`disabled` rows (shadowed rows intentionally show state
  only — they are already overridden); the surface confirms before dispatch, reports the
  runtime's refusal in the shared error row, and treats the toggle as busy alongside the
  tool and refresh mutations.

## Proof

- `bun test apps/macos/agent-window/test/cedia-tools-catalog.test.tsx tool-extensions-section.test.tsx slash-command-coverage.test.tsx`: 22 pass, 0 fail.
- `bun test apps/macos/agent-window/test`: 355 pass, 0 fail.
- `bun test apps/host/test/omp-management.test.ts`: 17 pass, 0 fail (replay + unknown-id behavior).
- `bun run typecheck`: exit 0.
- `bun run check:omp-coverage`: integrity PASS; gaps 22 -> 20 (`slash extensions` and
  `slash-alias status` settled as `platform_presentation_equivalent`; the alias inherits
  the parent row).

## Still open

- O06's `dynamic-tool` row (the registering subsystem), the headless `/move` hang (O02),
  AgentHub (O07), collab/external qualifications (O08/O10/O11/O12): untouched by design.
- No live or packaged capture of an extension toggle against the pinned runtime; the
  durable path is fixture-proven on both ends.
