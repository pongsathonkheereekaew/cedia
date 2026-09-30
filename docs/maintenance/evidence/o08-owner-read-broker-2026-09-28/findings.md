# O08 inspect-only owner read transport

Date: 2026-09-28

## Result

Added a typed persistent read client for an already instrumented **CEDIA-hosted RPC owner**. The
local Unix socket now uses bridge protocol v2 with a token-authenticated identity handshake and
request IDs. The host validates the record, session/incarnation, socket location and live owner,
then verifies identity again during adapter attachment. The client has no process spawn, signal or
owner-stop behavior; `detach()` only destroys its own socket.

The host exposes an exported `attachCediaOwnerReadClient` helper and the tests exercise it, but the
production host service, router and UI do not call it yet. It is a tested transport foundation, not
a user-visible owner-reselection or reattachment workflow.

Only `get_state` and `get_available_commands` can cross the socket. OMP creates a separate internal
request ID and sends each through the existing `RpcInputDispatcher`, preserving its serialization
and ordering. Private UI, host-tool and event frames are never fanned out. The response hook returns
only correlated projections: session/model identity, streaming/compaction flags, queue/message
counts and the credit-guard state; and a bounded command catalog with bounded text fields and an
explicit `truncated` flag. Session paths, prompt/transcript content, system prompt, tool schemas,
context/todos, and arbitrary RPC methods are excluded. A disabled credit guard is reported as a
fact and does not block safe reads; the socket exposes no mutation commands. The existing owner-only
HTTP summary route remains available as a smaller summary projection.

The owner record still carries a bridge-issued `ownerStartedAt` marker, not kernel process-birth
identity. A local authenticated live socket and exact identity/incarnation check are used here;
full OS process-start identity remains an O08 requirement. This is inspection continuity for a
CEDIA-hosted RPC process, not external CLI/TUI discovery or full attach/control.

## Verification

Against the refreshed pinned OMP 18.1.18 development runtime, the live test attached with the guard
disabled, issued concurrent `get_state` and `get_available_commands`, checked the safe state and
catalog projections, detached, then confirmed the original owner PID and primary stdio RPC client
were still usable. A `prompt` method attempt was refused. The suite also covers mismatched identity,
forged token, malformed and oversized input, stale/dead owners, unsupported protocol, concurrent
client reads and bounded shutdown while a reader is pending.

- `bun scripts/refresh-omp-patch.ts` — regenerated combined OMP patch, SHA-256
  `3b418e19d8ce8e88334598c89856cc771024cd6e93e67bf0f7250f6369e07461`.
- `bun scripts/prepare-omp-runtime.ts` — prepared `dist/omp/omp` from the pinned source.
- `bun test packages/omp-adapter/test/owner-read-client.test.ts apps/host/test/omp-owner-attach.test.ts`
  — 12 passed, 0 failed, 66 assertions.
- `bun run check:repo` — passed (`CI-OK parents=198 ui=75 children=129 lock-shas=3 doc-links=819 md=352 evidence=319`).
- `git diff --check` — passed.
- `bun run typecheck` — passed after the parallel O06 composer edits were reconciled.
- OMP runtime attestation — `sourceVerified: true`; source revision
  `00085d4e7dfdcfbf302c122fa2682b410a0f43d1`, source tree
  `7b735e22023f5338f9b9d782f776cacb31b5f003`, executable SHA-256
  `f78a41a46ca6f76240f4e0c6c07dcc9b6537823babbe97cc5872cdc435a1c107`, patch manifest SHA-256
  `33bc4085853f857315059394430b954cb7b022027484f6ee54a72aa30a7706de`.

No packaged app, Keychain, Login Item, device, paid provider, commit or push was used. The checkout
contains extensive unrelated dirty work; no unrelated files were reverted or staged.

## Remaining O08 / F work

Only CEDIA-hosted RPC owners publish this endpoint. Independently started CLI/TUI sessions are not
instrumented or discovered. The UI does not list owners or offer interactive attach. Transcript
access, permission and side-channel routing, controller mutations, full lifecycle detach, and OS
process-start identity remain open. The session is inspect-only regardless of guard state; controller
control requires a separately proven qualified owner path and policy attestation. This receipt does
not pass O08 or F acceptance.
