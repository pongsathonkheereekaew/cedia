# O05/O06: slash commands run over the surface Cedia actually uses — 2026-09-24

This receipt records how the slash family is decided: by the audit's own surface metadata, and by
a provider-free smoke that shows the runtime executing a builtin command rather than treating it
as a prompt. §10 item 70 owns status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a46bbd10eb`, dirty with the open slices.
- New: `scripts/omp-slash-smoke.ts` (`bun run smoke:omp:slash`),
  `apps/macos/agent-window/test/omp-slash-dispatch.test.ts`.
- Changed: `scripts/check-omp-coverage.ts`, `package.json`.

## What was wrong before

The gate gave every slash record the same hand-written reason: "OMP owns slash-command execution;
Cedia has no equivalent command owner." That is half true and half misleading. OMP does own
execution - that is the boundary, not a gap - and the audit separately records, per command,
which surfaces can reach it. The gate simply was not reading that.

## What the runtime actually does (measured)

`packages/coding-agent/src/modes/rpc/rpc-mode.ts` routes a `/`-prefixed prompt through
`executeBuiltinSlashCommand` **when the virtual terminal has been negotiated**, and falls back to
a smaller ACP set otherwise. The Cedia host performs exactly that negotiation when `virtualUi` is
on (`apps/host/src/service.ts:1360`, the packaged default), so the dispatcher is live in a real
Cedia session.

The first probe missed this and proved the opposite: without the negotiation, `/status` produced
`agent_start`/`turn_start` frames and one request to the model endpoint. With the negotiation the
same command answers `{"agentInvoked": false}`, produces no turn, and leaves the endpoint at zero.
That difference is why this is a smoke and not an inference.

```
bun run smoke:omp:slash
# ok: true, providerRequests: 0, framesSeen: [ready, response, available_commands_update,
#   cedia_terminal_open, cedia_terminal_output]
# candidates: /status, /tools, /usage, /security status, /security scans, /security disposition
# every one: agentInvoked=false, providerRequests=0
# checks: virtual-terminal-negotiated, command-catalog-published,
#   every-slash-command-stayed-local, no-turn-started
```

The smoke's endpoint accepts a request and never answers, so a command that fell through to the
model would be visible as a hit rather than as a plausible success.

## What changed

- The gate builds `slash → reachable` from the audit's own `surfaces` and `tuiOnly` fields
  (`rpc`/`acp` and not TUI-only counts as reachable) and applies it to a command, its aliases and
  its subcommands. Reachable records are `available` with the builtin dispatcher as the handler and
  Cedia's composer/catalog as the presentation; the rest stay gaps with a reason that names the
  restriction instead of a blanket claim.
- `apps/macos/agent-window/test/omp-slash-dispatch.test.ts` holds the Cedia half: the audit's
  reachable set is non-empty and split from the TUI-only one, and a command, a subcommand, an alias
  and a command with trailing arguments all reach the session's `prompt` payload exactly as typed.

## Result

```
bun run check:omp-coverage    # Integrity PASS; 756 gaps (was 899)
```

143 records advanced (41 slash + 99 subcommands + 3 aliases); 51 stay open, all of them commands
the audit marks `tuiOnly` or limits to the `tui` surface (38 commands, 9 of their subcommands, 4
aliases). That split is upstream's own metadata, and it is the same question §10 item 70 records
about surfaces Cedia does not have.

## Not done here

- Cedia still asks the runtime for the catalog per session (`get_available_commands`); the
  sessionless catalog O06 asks for is not built, and the composer still offers only the parent
  command names, not their subcommands.
- No packaged window has been observed typing a slash command; this is a runtime smoke plus the
  adapter fixture.
- The 51 TUI-only records remain gaps on purpose, awaiting the surface decision recorded in the
  settings-timing receipt.
