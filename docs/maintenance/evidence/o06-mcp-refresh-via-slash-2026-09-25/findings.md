# Slice (O06 MCP refresh via slash): `refreshMCPTools` carried by `/mcp reload`

No new runtime, host or window code. The audited SDK operation `refreshMCPTools` has no
audited RPC command and no registered `cedia_control` operation, but the reachable `/mcp`
command's `reload` (also `reconnect`/`enable`/`disable`) subcommand performs exactly that
method: `mcp-command-controller.ts` `reloadServers()` rediscovers through its own manager
and calls `await this.ctx.session.refreshMCPTools(this.ctx.mcpManager.getTools())`.
Cedia never synthesizes the discovery-produced array — the runtime's own handler supplies
it — which is what the earlier "cannot synthesize" reason required. The composer already
sends reachable slash text (including subcommands) over the prompt path, so the operation
is carried the same way `armPrewalk` (via `/prewalk`) and `getAsyncJobSnapshot` (via
`/jobs`) already are.

This supersedes the "deliberately not settled" note on the `o06-o07-slash-carried` row:
that note treated the whole `/mcp` command as the carrier, and the bare command only shows
help. The carrier named here is precise — the `reload`/`reconnect` subcommands — and the
live proof runs `/mcp reload`.

## Changes

- `scripts/lib/omp-coverage.ts`: new `OMP_SDK_VIA_SLASH` row
  `{ name: "refreshMCPTools", slash: "mcp" }` with a comment naming the subcommand carrier.
  The existing verifier re-checks every run (audited SDK name + audit-reachable slash +
  adapter still sends `prompt`), so the row cannot outlive any of the three facts.
- `scripts/omp-slash-smoke.ts`: `/mcp reload` added to the prompt-path candidates.

## Proof (pinned runtime 18.1.18, provider-free)

- `bun scripts/omp-slash-smoke.ts`: `/mcp reload` answers `agentInvoked: false`, zero
  provider requests, no turn started — alongside the eight previous candidates.
- `bun run check:omp-coverage`: integrity PASS, gap count **39** (was 40), O06 sdk 2 (was 3).
- `bun test scripts/lib` (84 pass) and
  `apps/macos/agent-window/test/omp-slash-dispatch.test.ts` (3 pass).

## Still open in O06

`getCodeModeDirectToolNames`/`getEvalPreludes` (live getters with no Cedia reader, not
stretched into a disposition), the `/extensions` and `status` commands, the two O06
dynamic-tool rows, a direct Cedia control that synthesizes the refresh array (still
refused by the same reason — only the slash carrier is claimed), and packaged capture.
