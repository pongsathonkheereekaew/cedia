# Paseo relay reuse/compatibility — 2026-09-23

Research date: 2026-09-23. The official repository was fetched read-only at
`3fc41c96c8c63f3a7109e832899cc57d473c4531` (2026-08-22, `main`). This is a
source-compatibility review only: no public relay connection, room registration,
deployment, provider call, or packaged runtime was run. The upstream README says
the project is still under active development and internal protocols may change.

## Wire contract and CEDIA comparison

- The public WebSocket route is `/ws` (the generic listener also serves `/health`,
  `/ready`, and `/metrics`). Query parsing requires `serverId` and `role=server|client`;
  `v` is `1` when absent, or `1|2`; v2 `connectionId` is optional for clients (the
  relay generates `conn_<16 hex>`), while v2 `server` without an ID is the control
  socket and with an ID is a data socket. `serverId` and v2 `connectionId` are capped
  at 256 bytes. [connection.ex](https://github.com/getpaseo/paseo-relay/blob/3fc41c96c8c63f3a7109e832899cc57d473c4531/lib/paseo_relay/connection.ex#L14-L69), [listener.ex](https://github.com/getpaseo/paseo-relay/blob/3fc41c96c8c63f3a7109e832899cc57d473c4531/lib/paseo_relay/listener.ex#L67-L81)
- CEDIA builds `/ws?serverId=...&role=...&v=2[&connectionId=...]`, opens a server
  control socket, follows `sync`/`connected`/`disconnected` IDs to data sockets, and
  omits client `connectionId` unless explicitly supplied. This matches the v2 source
  contract. [CEDIA URL builder](../../../../packages/relay/src/protocol.ts#L315-L330),
  [server routing](../../../../packages/relay/src/server.ts#L163-L207), [client route](../../../../packages/relay/src/client.ts#L188-L204)
- Official v2 control signals are JSON `sync{connectionIds}`, `connected{connectionId}`,
  and `disconnected{connectionId}`; data delivery preserves WebSocket text/binary
  opcode and payload. The only parsed client data exception is JSON `hello` or
  `e2ee_hello`, whose `key` must be canonical padded Base64 for an acceptable 32-byte
  X25519 key; invalid handshakes close `1008` and are not forwarded. [ownership.ex](https://github.com/getpaseo/paseo-relay/blob/3fc41c96c8c63f3a7109e832899cc57d473c4531/lib/paseo_relay/ownership.ex#L281-L363), [socket.ex](https://github.com/getpaseo/paseo-relay/blob/3fc41c96c8c63f3a7109e832899cc57d473c4531/lib/paseo_relay/socket.ex#L94-L114), [handshake_validation.ex](https://github.com/getpaseo/paseo-relay/blob/3fc41c96c8c63f3a7109e832899cc57d473c4531/lib/paseo_relay/handshake_validation.ex#L25-L58)
- CEDIA sends text `e2ee_hello` with a canonical TweetNaCl public key and optional
  `binaryCiphertext` capability. The daemon answers `e2ee_ready`; JSON request/response
  ciphertext is base64 text, while negotiated binary application payloads stay binary.
  The relay can route these frames without understanding CEDIA's encrypted envelope or
  host/device token. [CEDIA E2EE](../../../../packages/relay/src/encrypted-channel.ts#L154-L181), [daemon handshake](../../../../packages/relay/src/encrypted-channel.ts#L245-L290), [frame send/receive](../../../../packages/relay/src/encrypted-channel.ts#L419-L483)
- The relay's data-frame ceiling is 32 MiB minus the 14-byte masked-client header;
  v2 control input is 64 KiB. CEDIA enforces a lower 256 KiB serialized envelope
  limit, so normal CEDIA messages fit but CEDIA's limit is the effective ceiling.
  There is no documented wire-level per-room rate quota in this source; capacity,
  backpressure, connection ceilings, and delivery deadlines are enforced. [protocol.ex](https://github.com/getpaseo/paseo-relay/blob/3fc41c96c8c63f3a7109e832899cc57d473c4531/lib/paseo_relay/protocol.ex#L4-L18), [README limits/framing](https://github.com/getpaseo/paseo-relay/blob/3fc41c96c8c63f3a7109e832899cc57d473c4531/README.md#L50-L122), [CEDIA cap](../../../../packages/relay/src/protocol.ts#L14-L16)

## Self-hosting and the home Mac shape

- The repository is a generic Elixir/Cowboy service with no deployment-provider
  dependency. The checked-in Docker image builds a release and listens on
  `0.0.0.0:4000`; a non-Docker release uses Elixir/Erlang and `mix release`.
  The listener route is fixed at `/ws`, and the generic listener is cleartext, so a
  public `wss://` endpoint needs TLS termination/proxying in front of it. [README operations/build](https://github.com/getpaseo/paseo-relay/blob/3fc41c96c8c63f3a7109e832899cc57d473c4531/README.md#L35-L62), [Dockerfile](https://github.com/getpaseo/paseo-relay/blob/3fc41c96c8c63f3a7109e832899cc57d473c4531/Dockerfile#L1-L19), [listener](https://github.com/getpaseo/paseo-relay/blob/3fc41c96c8c63f3a7109e832899cc57d473c4531/lib/paseo_relay/listener.ex#L67-L81)
- A single self-hosted relay can be a public rendezvous point: the home Mac's CEDIA
  server makes outbound control/data WebSockets and the remote client makes an outbound
  client WebSocket. This removes a home inbound-port requirement, but the Mac process
  must remain running and both sides need reachability to the relay. This is an
  architectural inference from the CEDIA server/client sockets, not a live NAT or
  cellular test. [CEDIA server](../../../../packages/relay/src/server.ts#L163-L207), [CEDIA client](../../../../packages/relay/src/client.ts#L188-L204)
- CEDIA accepts an endpoint and passes its pathname through, except `/` becomes `/ws`.
  Therefore an official self-host is source-compatible when reached as `wss://host/ws`
  (or when a proxy maps a custom public path to `/ws`); the relay source has no custom
  WebSocket path setting. [CEDIA endpoint parsing](../../../../packages/relay/src/protocol.ts#L293-L330)
- The current host integration seeds `relay.paseo.sh:443` in private `remote.json` and
  creates offers from that value; this transport review found no app-level endpoint
  selector/API. A self-host choice therefore needs an explicit product/config change
  before it is a user-selectable production path. [remote.ts](../../../../apps/host/src/remote.ts#L12-L56), [remote test](../../../../apps/host/test/remote.test.ts#L99-L119)

## Trust, hosted service, and licensing boundary

- The relay protocol has no bearer room token or account field: routing identity is
  `serverId` plus role/connection ID, while CEDIA's device token is checked by the
  CEDIA host. Paseo security documentation describes the QR/pairing link's daemon
  public key as the trust anchor and says the relay sees IPs, timing, sizes, and session
  IDs, not plaintext. [Paseo security](https://paseo.sh/docs/security) and [CEDIA host authorization](../../../../packages/relay/src/host.ts#L122-L145)
- The Terms (last updated 2026-08-29) apply to services at `relay.paseo.sh` and say
  the official relay is optional, subject to reasonable/fair use, may limit bandwidth
  or connection volume/abusive traffic, and has no uninterrupted-service promise.
  They do not establish a free/unlimited entitlement for a custom client. [Terms § The official relay](https://paseo.sh/terms#the-official-relay)
- The repository's [LICENSE](https://github.com/getpaseo/paseo-relay/blob/3fc41c96c8c63f3a7109e832899cc57d473c4531/LICENSE#L1-L5) is Apache-2.0. CEDIA's [NOTICE](../../../../packages/relay/NOTICE.md#L1-L18) records separately adapted `@getpaseo/relay` 0.8.0 E2EE code and CEDIA-owned orchestration; Apache code-reuse terms are distinct from permission to use Paseo's hosted endpoint or names.
- The official relay source is transport/routing code; no Paseo agent harness is needed
  to carry CEDIA's own encrypted request/response protocol. This conclusion is source
  scope only; it is not production interoperability evidence.

## Decision and unresolved verification

Source compatibility supports a CEDIA self-hosted Paseo relay option alongside Tailscale,
provided the deployment exposes `/ws` over a reachable TLS endpoint and CEDIA gains an
endpoint-selection/configuration seam. Keep OMP as the execution/transcript owner while
CEDIA owns host transport and app/device lifecycle; the relay should remain a frame router. Official hosted use remains an
operational/service-policy question, separate from Apache code reuse. CEDIA's synthetic
v2 fixture is explicitly not a public relay test ([fixture](../../../../packages/relay/test/relay.test.ts#L28-L30)); no production relay, TLS proxy, home NAT, or cellular interoperability was tested.
