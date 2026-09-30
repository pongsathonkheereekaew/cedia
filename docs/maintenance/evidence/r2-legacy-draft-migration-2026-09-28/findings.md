# R2 legacy draft migration and restart fixtures — 2026-09-28

## Scope

This slice repairs and verifies the old draft sources that precede the shared host draft owner.
The repository was already dirty at base revision `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`;
the revision was not changed, and unrelated work was preserved.

The Agent Window's one-time import of `draft:<threadId>` now reaches the host PATCH route with its
`agent-ui-import` source label. The application router accepts that field and forwards it into the
host draft store. When the host already has a different canonical draft, the older app-side copy is
imported under a deterministic, separately labeled host draft ID and read back before a local
import marker is written; the host copy remains canonical for the task.

The extension's old global-state map `cedia.drafts` is imported as separate `legacy-extension-*`
host records. Each record retains its source key and text, uses a stable ID derived from the key and
text, and is verified by reading it back from the host. Imports run in batches of four. The
original map remains intact as a recovery copy. A versioned migration marker is written only after
all records verify and the source map is confirmed unchanged; extension writes stop treating the
old map as authoritative after that marker.

## Verification

- `bun test apps/macos/test/agent-window-main.test.ts apps/macos/test/shared-draft.test.ts apps/macos/test/agent-ui-state.test.ts` — **35 passed, 0 failed; 170 expectations**. The real-host fixture covers the app-side import label, a legacy `cedia.drafts` copy alongside the app-side task draft, the migration marker and retained source map, and readback after closing/restarting the host on the same scratch state directory. A separate fixture proves that a stale app-side cache is preserved as a labeled host record before the canonical cache is refreshed.
- `bun test apps/host/test/http.test.ts apps/host/test/drafts.test.ts` — **22 passed, 0 failed; 193 expectations**. This includes the draft PATCH route with `source`, import idempotency, and durable record behavior.
- `bun run test` — **1,434 passed, 0 failed; 8,526 expectations across 167 files**.
- `bun run typecheck` — **passed**.
- `bun run build` — **passed**; host, extension, and Agent Window outputs built to ignored `dist/`. Vite reported the existing large-chunk warning; Node reported `[DEP0205]`.
- `bun run check:repo` — **passed**; CI-OK, 885 document links, 386 Markdown files, 341 evidence items.
- `bun run check:omp-coverage --require-complete` — **passed**; 1,041/1,041 mappings, 498 settings, 50 audited RPC commands, 73 capability descriptors, zero fatal or unmapped records. This is F source coverage only.
- `git diff --check` — **passed**.

All host tests use isolated temporary state directories and make no provider requests.

## Limits

The restart fixture restarts the host process; it does not restart the packaged Cedia app or observe
the renderer rehydrating its composer. The shared-draft packaged restart/UI acceptance row therefore
remains open. This receipt does not qualify the macOS Login Item, active-turn packaged-app recovery,
W off-LAN access, N on a physical iPhone, or full F acceptance.
