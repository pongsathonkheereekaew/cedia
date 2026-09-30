# O06 runtime tool-catalog and activation smoke — 2026-09-27

Bounded F semantic/dynamic evidence against the pinned OMP runtime, with no gap
reclassification. This covers tool activation, skill rediscovery, and adding and
removing an MCP server from a connected session; it does not cover extensions,
providers or commands, packaged renderer projection, iPhone surfaces, or full F
acceptance. §10 item 70 owns status.

## Observed

`bun scripts/omp-tools-catalog-smoke.ts` passed 23 live checks against
`omp/18.1.18`. `bun scripts/omp-tools-mcp-smoke.ts` then passed the connected
session add/remove transition against the same pinned runtime. Both used
isolated fixture profiles and loopback model endpoints that never answer, so no
provider request completed.

- OMP returned its own tool identity, source and activation state; the active
set was a subset of the registered tools and the untruncated catalog count
matched its rows.
- The smoke disabled `bash`, observed it inactive, restored the original active
set, and observed it active again. Skill rediscovery returned the following
catalog and retained the native `read` tool.
- The host reported a reason before runtime start; after session start, a paired
controller saw the runtime catalog. An owner activation write and refresh
returned the resulting catalog, and replaying the same command ID returned the
same receipt.
- Unknown query fields, a wrong HTTP method and an extra payload on a no-payload
  read were refused as expected.
- Before the MCP seam fix, `/mcp reload` completed locally with
  `agentInvoked: false` but the catalog stayed unchanged. The RPC-created
  `InteractiveMode` had no MCP manager, even though the SDK session had created
  the session-owned manager for deferred discovery. `runRpcMode` now receives
  that same manager from `main.ts` and passes it into the virtual UI mode.
- The MCP fixture started as `mcp__fixture_echo`. Editing project `.mcp.json`
  to add `fixture_extra` and issuing `/mcp reload` made both tools visible in a
  complete catalog snapshot. Removing that server and reloading removed only
  `mcp__fixture_extra_echo`; the original tool remained. Both reload commands
  were acknowledged by OMP without an agent/provider turn.
- Patch/build preservation was verified after the final source edit with
  `bun scripts/prepare-omp-runtime.ts` and `attestOmpRuntime(...)`: pinned
  revision `00085d4e7dfdcfbf302c122fa2682b410a0f43d1`, verified source tree
  `98d3c5f692f67b129d53736e388783abe02cb8a1`, development source launcher,
  patch manifest hash
  `50932490a8dabfb4b9978d1f7fd670ef0798fd289d07d3ac49580212304a2c68`.
  The dynamic add/remove smoke passed again against that prepared runtime.
- Lifetime review: SDK session creation constructs the manager once and stores
  it in its tool session; `main.ts` passes that returned instance to
  `runRpcMode`, which passes it into the virtual `InteractiveMode`. The reload
  controller disconnects and rediscovers through that same context manager.
  The RPC seam adds no `new MCPManager`, process-global assignment, or extra
  disposer.

This is fixture/runtime semantic evidence for a bounded subset of O06 dynamic
sources. The §11.1 F semantic/dynamic matrix remains open for other dynamic
sources and enabled desktop/web/iPhone surfaces. Source completeness at
1,041/1,041 is recorded separately and does not substitute for those runtime
checks.
