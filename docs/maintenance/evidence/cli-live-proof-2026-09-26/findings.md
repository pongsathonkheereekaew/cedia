# Proof (headless CLI live run with a real OMP turn) — 2026-09-26

Closes the live half of §10 item 5b: the `cedia-host` CLI drives a running
host and a real (fixture, provider-free) OMP turn end to end. Driver:
`scripts/omp-cli-live-proof.ts` (`smoke:cli-live`). §10 item 70 owns status.

## What was proven (14 checks, all green)

Against a real loopback host server (host.json descriptor discovery, bearer
auth, JSON stdout — the exact `runCli` path the binary uses): `project-create`
and `session-create` answer ids, `session-start` boots, `send --wait` settles
`completed` on the wire (live incarnation addressing, settlement polling),
`events` carries the fixture response, `sessions` lists the task, generic `rpc
get_state` answers through the same path, and a messageless turn verb exits 2
(usage). The host journal recorded only `prompt` + `get_state` — no
provider-backed commands anywhere by construction.

## Still open from 5b (recorded, not built)

- IDE palette wiring for the daily verbs (workbench work, untouched).
- Abort against a running turn (needs an answering model to hold a turn open;
  abort paths are unit-covered and O11 session aborts are proven live).
- TUI-only slash commands stay reachable only through `rpc` where OMP exposes
  them as RPC (unchanged scope rule).
