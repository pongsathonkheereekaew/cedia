# Command metadata freshness and the RPC host-tool refresh, through paths that already exist — 2026-09-24

This receipt records the O06 gate-settlement slice: two audited SDK rows settled with no new
runtime, host or window code — `refreshRpcHostTools` through the host handshake's audited
`set_host_tools` command (named Cedia caller), and `subscribeCommandMetadataChanged` through the
runtime's own subscription plus Cedia's frame handling (source-evidence disposition). §10 item 70
owns status; this file records what was observed at the revision below. No provider request was
made and no model turn was run.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision `0676dd70d54` with this slice applied;
  the tree is dirty by design (no commit, push or publish was made).
- Pinned runtime: OMP `18.1.18`. No upstream change in this slice:
  `patches/omp/0001-cedia-rpc-bridges.patch` untouched (sha256
  `82ffecbd54284de17a3d678f16af45bd4510b129d02dc82cd7782c5a3a8a4261` per
  `patches/omp/manifest.json`); `dist/omp/omp` not re-prepared.
- Changed for this slice: `scripts/lib/omp-coverage.ts`,
  `scripts/lib/omp-coverage.test.ts`, `scripts/check-omp-coverage.ts`,
  `apps/macos/test/state.test.ts`; this receipt; `docs/maintenance/CEDIA-PLAN.md` (item 70 row
  plus the O06 prose it supersedes).

## What changed

- **One caller link** (`OMP_SDK_VIA_CEDIA_CALLER`): `refreshRpcHostTools` is carried by the
  audited `set_host_tools` command Cedia's host sends in the runtime handshake
  (`apps/host/src/service.ts`); rpc-mode answers that command by running the session's own
  `refreshRpcHostTools` (`upstream/omp/packages/coding-agent/src/modes/rpc/rpc-mode.ts`). The
  refresh is the handshake itself and has no separate Cedia control. The gate fails the run if
  the caller stops sending the command.
- **One source-evidence disposition** (`OMP_SDK_DISPOSITIONS`):
  `subscribeCommandMetadataChanged` is `platform_presentation_equivalent` — rpc-mode subscribes
  to the session's own metadata changes and emits an `available_commands_update` frame, and
  Cedia's task state applies that frame to `slashCommands`
  (`apps/macos/src/state.ts#applyFrame`), so the composer menu follows OMP rather than a cached
  list. The gate re-reads both literals on every run.
- **One focused test**: `applyFrame` with an `available_commands_update` frame sets the composer
  menu (dropping nameless rows) and leaves the transcript alone
  (`apps/macos/test/state.test.ts`).
- **One test repair**: the shipped-caller-table test hardcoded `new_session` as the only audited
  command; it now proves every shipped caller link against the dated RPC inventory in
  `coverage.json`, which is strictly stronger and had to change the moment a second command
  earned a caller link.

## What was observed

- `bun run check:omp-coverage`: integrity PASS, 1,041 audited records with 1,041 Cedia mappings,
  live `omp/18.1.18` (498 settings, 50 audited RPC commands, 46 capability descriptors); gap
  count **71** (was 73), O06 sdk 6 (was 8). `--list-gaps` no longer names either row.
- Negative probes: a caller text without the `"set_host_tools"` literal and an evidence text
  without the `available_commands_update` literal each report `unclassified` — the guards hold.
- Focused sweep — `bun test scripts/lib apps/macos/test/state.test.ts
  apps/macos/test/session-event-kinds.test.ts apps/macos/test/omp-ui-methods.test.ts
  apps/host/test/service.test.ts`: 136 pass / 0 fail.
- `git diff --check` clean.

## Still open (not claimed)

- `refreshMCPTools` (its input is a discovery-produced array Cedia cannot synthesize), `reload`
  (session lifecycle with no Cedia control), `extensionRunner` (in-process extension machinery),
  code-mode rows (`getCodeModeDirectToolNames`, `initializeCodeMode`, `getEvalPreludes`),
  `/extensions` plus the `status` alias, the two O06 dynamic-tool rows, and any packaged capture
  of the catalog panel.
- No live MCP/RPC-host refresh was exercised against a running runtime beyond the gate's
  live-table read; no packaged capture exists.
