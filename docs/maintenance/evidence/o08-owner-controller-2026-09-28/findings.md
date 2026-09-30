# O08 CEDIA-hosted owner controller slice

Date: 2026-09-28

## Implemented

The instrumented `rpc-ui` process now keeps its OMP `AgentSession`, owner lock and private local
endpoint after its primary stdin reaches EOF. A replacement host can authenticate against the
mode-0600 owner record, claim one controller lease, send supported commands through the existing
`RpcInputDispatcher`, receive their correlated acknowledgements and OMP events, and detach without
stopping the owner. A live primary connection and a second controller are refused. A disabled CEDIA
credit guard permits only `get_state` and `get_available_commands`; it cannot gain a mutation lease.
The controller uses a 1 MiB frame limit, 8 MiB outbound backlog and 64 in-flight commands.

Extension UI, host-tool and host-URI requests follow the current controller lease. Disconnect
cancels requests owned by that lease; late responses cannot answer a successor's requests. A
dispatched command whose transport disappears has an unknown outcome and is never replayed by the
adapter. The host probes the stored session and incarnation before rotation or spawn, adopts a
qualified live owner without creating a second executor, and refuses stale, conflicting or ambiguous
records. Attached host close releases its controller while preserving the OMP process. Explicit
stop/delete of an attached owner is refused pending an owner migration/stop protocol.

The owner record uses the CEDIA task ID supplied by the host as its discovery identity; OMP's own
session ID remains attached to the transcript. A real-process test caught this mismatch after the
initial controller implementation: using OMP's session ID in the record made the host refuse its own
owner on reconnect. The host now supplies the task ID when it launches OMP; independently launched
OMP retains its own session ID in its record.

Explicit `OmpRpcClient.close()` sends the primary-only `cedia_owner_shutdown` frame before EOF. OMP
acknowledges it, closes the endpoint, disposes the session and exits. This is distinct from a host
crash or transport EOF, which leaves the owner available for reattachment. A bounded signal fallback
remains for a child that does not complete shutdown.

## Verification at this revision

- CEDIA checkout: `0676dd70d54e429b5a72c98cb3f22a646bbd10eb` plus the dirty working tree;
  no commit or push. Pinned OMP source revision: `00085d4e7dfdcfbf302c122fa2682b410a0f43d1`.
- `bun scripts/refresh-omp-patch.ts` generated the consolidated patch with SHA-256
  `25280b4a783445af417adfd56e5725e14856aa97b265aec7ee1bf5066a41cca4`.
  `bun scripts/prepare-omp-runtime.ts` succeeded. Runtime attestation returned
  `sourceVerified: true`, source tree `33eb8eb5ed52e39003a460217371db3782857af0`, executable
  SHA-256 `f78a41a46ca6f76240f4e0c6c07dcc9b6537823babbe97cc5872cdc435a1c107`, and patch
  manifest SHA-256 `c50372ca39036454a5217a2924cca7036367c3174ed1fba74640852fcb9a8e10`.
- `bun test upstream/omp/packages/coding-agent/test/cedia-owner-bridge-controller.test.ts`:
  7 passed, 175 assertions. The live process cases prove EOF, two sequential controller attachments
  to the same PID/session, an explicit shutdown ACK, endpoint removal and a fresh owner acquiring the
  lock. The extension approval case refuses malformed and stale lease replies.
- `bun test upstream/omp/packages/coding-agent/test/rpc-input-frame.test.ts
  upstream/omp/packages/coding-agent/test/rpc-host-tools.test.ts
  upstream/omp/packages/coding-agent/test/rpc-host-uris.test.ts`: 31 passed, 111 assertions.
- `CEDIA_OMP_BINARY=/Users/pond/cedia/dist/omp/omp bun test apps/host/test/service.test.ts
  apps/host/test/omp-owner-attach.test.ts`: 48 passed, 310 assertions. A new real-process case
  proves that the owner record uses the CEDIA task ID, a host adopts after primary EOF without a
  second spawn or incarnation change, and host close leaves the same owner PID alive. The suite
  also covers live endpoint and explicit-close behavior.
- `bun test packages/omp-adapter`: 83 passed, 1,722 assertions.
- `bun run typecheck` passed. The F inventory gate reported 1,041 audited records and 1,041 CEDIA
  mappings with zero missing dispositions; that is mapping completeness, not F behavior acceptance.

## Limits and open acceptance

This is a source/development-runtime slice for CEDIA-started RPC owners. Independently started
CLI/TUI owners are not instrumented or discovered; the app has no owner list/selection UI. The
record's `ownerStartedAt` is a bridge marker rather than OS process-birth identity. The controller
transport has no chunking for payloads above 1 MiB. A real host process crash while a turn or
native permission is pending, durable event catch-up, the full editor/host-tool/URI path, competing
host/launcher election and atomic owner migration have not passed end-to-end acceptance.

During development, direct external SIGTERM occasionally exited the Bun child with status 143 and
left a stale owner record; explicit host close now uses the acknowledged shutdown command. A stale
record is refused rather than deleted or used to start another executor. External signal cleanup
remains unqualified. No packaged app, Login Item, Keychain, physical iPhone, paid provider, commit or
push was used for this slice. O08 and F remain open; D's packaged lifecycle gate is separately open.
