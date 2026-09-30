# Slice (extension toggle, live against the pinned runtime)

The previous slice wired the extension toggle through the panel and proved the durable
path with fixtures on both ends. This slice replaces "fixture-proven" with a live run:
`scripts/omp-extensions-smoke.ts` now disables and re-enables the active fixture MCP
server through the host's owner-only durable route, replays the first command id, and
names an unknown id — all against the pinned 18.1.18 runtime with no model, provider,
or session turn anywhere in the run.

## What the run proves

- Disabling answers the catalog that follows with the runtime's own `disabled` state.
- A repeated command id replays the stored catalog byte-for-byte, not a second toggle.
- Re-enabling restores `active`.
- An unknown id answers 200 `available: false` with the runtime's own reason
  (`Unknown extension: mcp:missing`) — the mapping this route owns, not a 409.
- The write half needs no TUI: unlike `/move`, nothing hangs headless.

## Proof

- `bun scripts/omp-extensions-smoke.ts`: 18 checks OK (11 read + 5 toggle + 2 route gates).
- `bun run check:omp-coverage`: integrity PASS, gaps unchanged at 20; the settled
  `/extensions` row now cites this smoke.

## Still open

- Custom roots stay a separate surface with their own gate.
- No packaged-window capture of a toggle; the panel half is renderer-test-proven.
