# O08: the runtime publishes a local owner endpoint, and the host refuses what it cannot prove — 2026-09-24

This receipt records the discovery half of O08. The exclusive session lock already decided *who*
owns a session; nothing told any other process *where* that owner was, so an external client had
to guess from a PID. That guess is now a record with an identity and a socket with a liveness
proof, and the host's answer is a decision rather than an action. §10 item 70 owns status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a46bbd10eb`, dirty with the open slices.
- OMP patch `0001-cedia-rpc-bridges.patch`, sha256
  `3286e37381f5e32d99254b6764490512410325c68145f239519b7c3f77097acc`
  (previous `f3c0d40c967fe0b1aec9631349f8e9375acb1e5dce77db6030738a433a5d027d`).
- New: `upstream/omp/packages/coding-agent/src/session/cedia-owner-bridge.ts`,
  `apps/host/src/owner-endpoint.ts`, `apps/host/test/omp-owner-attach.test.ts`.
- Changed: `upstream/omp/.../modes/rpc/rpc-mode.ts`, `apps/host/src/service.ts`,
  `apps/host/src/router.ts`, `apps/host/src/cli.ts`.

## What it does

- `startCediaOwnerBridge` (OMP) writes `owner.json` beside `CEDIA_SESSION_LOCK` with
  `{ sessionId, incarnation, pid, processStartedAt, startedAt, cwd, sessionFile, socket, token }`
  at mode 0600, and listens on `owner.sock` at mode 0600. The record is written **after** the
  socket listens, so a client can only discover an endpoint that already answers.
- The endpoint answers `identify` and `status` from a static table: one line in, one line out,
  bounded by 8 KiB and 16 requests per connection. A request outside the table is refused by name,
  and a payload can never name a function, executable or source text. Every answer is read-only
  metadata; nothing here can start, stop or replace an owner.
- A request without the record's token is `unauthorized`; the record's mode is the boundary, since
  Node cannot read Unix peer credentials.
- `probeCediaOwner` (host) returns `absent`, `attached`, `stale` or `conflict`. The order is the
  point: the record must parse, its `protocolVersion` must match, an expected session/incarnation
  must agree, the socket must be that directory's own `owner.sock`, the recorded process must still
  exist, and only then is the socket asked to prove it is the same process. A failure at any step
  gets its own state instead of being flattened into "unavailable".
- Nothing in the path starts, stops or deletes anything. A stale record is left in place as the
  evidence of what happened; a conflict is reported for a human to resolve.
- The host publishes the endpoint when it starts a runtime
  (`service.ts` passes `CEDIA_RPC_OWNER_BRIDGE=1` and `CEDIA_SESSION_INCARNATION`), and the packaged
  CLI turns it on for a bundled runtime by default, the same rule the virtual UI already follows.
- `GET /v1/sessions/:id/owner` is owner-only and answers that decision.

## Verification

```
bun test apps/host/test/omp-owner-attach.test.ts   # 8 pass, 0 fail, 35 expect() calls
bun test apps/host                                 # 237 pass, 0 fail
bun run check:omp-coverage                         # Integrity PASS, live omp/18.1.18
bun run typecheck                                  # same 10 pre-existing errors, none new
git diff --check                                   # clean
```

The cases run the pinned runtime, not a mock of it: the record appears with mode 0600, the host's
probe answers `attached` with the same pid/incarnation, two concurrent probes both succeed without
ownership moving, a probe is detach-safe (the owner keeps answering after the client leaves), and a
clean close removes the record. Then an owner is `SIGKILL`ed: the probe turns `stale`, the record
stays, and nothing is spawned or cleaned up to "fix" it. The remaining cases are fixtures: a
malformed record, a socket outside the session directory, a socket that answers as a different
process, and an expected session/incarnation that disagrees are all `conflict`; a missing record is
`absent`.

## Not done here

- The **qualified CLI launcher** is not built. It is what would attach to this endpoint and broker a
  verb through it, so the audit's 41 CLI commands and 64 launch flags stay open - the endpoint is
  the prerequisite, not the delivery.
- Nothing is brokered yet beyond `identify`/`status`: the request table is deliberately read-only
  until a launcher needs more.
- The Mac UI does not surface an attached external client yet; the route exists for it to.
