# OMP collab readiness — 2026-09-23

Research date: 2026-09-23. This note answers the bounded question in issue 09: what OMP
collab already provides for controlling one running Mac session from another desktop, a web
browser, or an iPhone browser, and what CEDIA would still own. It does not test a public relay,
deploy a service, install anything, or mutate an application.

## Revisions and evidence levels

The vendored checkout is OMP **v18.1.18**, commit `00085d4e7dfdcfbf302c122fa2682b410a0f43d1`
(commit date 2026-09-11, tag `v18.1.18`). The local collab sources and docs below are the
implementation available to CEDIA. The current upstream `main` documentation was fetched on
2026-09-23; `main` is mutable and was not pinned to a commit in this note. It adds features
(`collab.autoStart` and a local host registry with `collab list`/`collab link`) that are absent
from the vendored revision. Do not silently treat those upstream-main additions as present in
CEDIA's checkout.

The local fixture/unit run was:

```text
cd /Users/pond/cedia/upstream/omp
bun test packages/coding-agent/test/collab packages/collab-web/test
```

Result: **182 pass, 0 fail, exit 0**, across 23 files. This verifies protocol, crypto,
permission, queue/steer, UI-request, reconnect-state, local-relay, and browser-client behavior
with local fixtures. It is not an independent public-relay, packaged-CEDIA, internet, or
cellular-iPhone run.

## What OMP collab owns

OMP collab is a live session projection/control channel. The **host OMP process remains the
single execution and transcript owner**: it runs the model and every tool. Guests never peer
with one another. A TUI guest receives a host snapshot into a local replica and then receives
durable entries plus live events/state; the browser guest keeps an equivalent in-memory replica.
The host is authoritative for execution, machine effects, and session transitions. This is
collab collaboration between guests and one host, not subagent orchestration or a second agent
loop.

That makes collab a strong candidate for the “same running Mac task” transport. It does not
project the Code-OSS workbench, arbitrary Mac windows, files, debugger, or terminal UI into the
guest. It also does not ship a native iPhone client. An iPhone can use the standalone web guest
in iOS Safari in principle (a standards-compliant HTTPS browser with WebCrypto), but that
cross-device path has not been run here.

## Capability matrix

| Area | Verified implementation | CEDIA implication / limit |
|---|---|---|
| Host and guests | `/collab` starts a full-control room; `/collab view` produces a read-only room; `/join <link>` joins from another OMP TUI. Host broadcasts `welcome`/snapshot, entries, events, state, agent registry and selected EventBus traffic. | Multiple desktop TUI/web guests can observe and control the same OMP session. CEDIA still owns the IDE/workbench window projection and any native-device client. |
| Internet hosting | Default relay is `wss://my.omp.sh`; links may name a custom relay. The production relay's Go source/binaries are not published for self-hosting. `packages/collab-web/scripts/local-relay.ts` is a WebSocket-only development stand-in and does not serve the web app, `/share`, or `/healthz`. | A real internet deployment depends on the hosted relay or separately authorized relay infrastructure. Availability, rate limits, latency, and relay operations were not tested. |
| Link/auth boundary | Full link carries a 32-byte AES-256-GCM room key plus a 16-byte write token (48 bytes encoded as base64url). View link carries only the 32-byte key. The room secret stays in the URL fragment; the host timing-safely verifies the write token. There is no separate user-login/identity provider in this protocol. | Possession of a control URL is authority to read and steer. CEDIA must treat links as secrets and decide how its host/device UX distributes, revokes, and rotates them. |
| Encryption/relay visibility | Every session payload (entries, events, state, prompts) is sealed before the socket. The relay sees room ID, connection counts, opaque frame bytes/sizes, and a 4-byte routing prefix. | Relay is content-blind by design; this does not by itself provide CEDIA account auth, device attestation, or host policy. |
| Full-control guest | Can read the complete back-transcript, prompt, interrupt, use Agent Hub chat/kill/revive, fetch subagent transcripts, and answer host `select`/`editor` requests. | Covers prompt/steer/abort and OMP subagent controls. It is not general control of Code-OSS or the Mac GUI. |
| View-only guest | Can read back-transcript, streaming text, tool cards, and subagent transcripts. Host rejects prompt, interrupt, agent control, and UI responses without a valid write token. | Useful for observation; no remote write capability. |
| Prompt, steer, queue | Host handles a writable guest `prompt` with `session.promptCustomMessage(..., { streamingBehavior: "steer", queueChipText: text })`. While a turn is streaming, the prompt is a steer and appears in the agent-core queued-message count. Web Composer sends prompts only when live and writable and displays `queued ×N`. There is no guest queue reorder/remove command. | OMP already supplies prompt/steer semantics and queue visibility. CEDIA should not create a second queue or reinterpret a queued steer as a second execution owner. |
| Abort | Writable guest `abort` routes to the host session's `abort({ reason: USER_INTERRUPT_LABEL })`; web and TUI expose a Stop/Esc path. | Remote interruption is implemented for the OMP turn. Tool/process cancellation remains whatever the host OMP session guarantees. |
| Questions / approvals | Host `requestGuestUi` sends `ui-request` only to writable peers. The protocol currently names `select` and `editor`; the first submitted or cancelled `ui-response` settles the request and `ui-request-end` dismisses other copies. TUI and web guests render these asks. | This is a concrete remote question/input path. No separate generic “approval” frame or policy model was found; CEDIA-specific approval types would need a mapping or host-owned path. |
| Model changes | Host state includes the full model object and thinking level; guests apply that state for display/context math. `/model` and other session/machine-mutating commands are host-only. | Guests can inspect the active model but cannot change it. Any CEDIA model picker must send a host-owned command through CEDIA's own protocol/UI. |
| Reconnect | Relay socket retries transient closes with jittered exponential backoff (1 s base, capped at 30 s), re-sends `hello`, and the host sends a fresh welcome/snapshot. Fatal close codes are 4001 room closed, 4004 no room, 4009 host conflict, and 4029 room full; bad-key/corrupt-frame decryption is terminal. Sealed outbound frames are buffered up to 256 while reconnecting; overflow is dropped. | Reconnect is session resynchronization, not failover. If the host room disappears, the guest ends and restores its prior local session. Internet/restart recovery for CEDIA remains separately unverified. |
| Transcript ownership | Host `onEntryAppended` broadcasts wire entries and host events. TUI guests ingest entries into `~/.omp/collab/<roomId>.jsonl` and load through normal resume; entry frames are not rendered directly to avoid duplicate event rendering. Browser guests maintain immutable client snapshots and fetch subagent JSONL incrementally on demand. | Host OMP remains the durable execution/journal owner; guest replicas are display/control projections. CEDIA must preserve one session owner when adding IDE/mobile surfaces. |
| Web/mobile surface | `packages/collab-web` is a standalone static SPA; deep links auto-connect, it uses the relay directly, and the key stays in the fragment. The composer supports prompts, Stop, queue badge, and `select`/`editor` responses; the Agent Drawer supports subagent transcript polling and writable chat/kill/revive. | It can be a browser surface on another computer or iPhone Safari. There is no native iOS app or proof here of a physical iPhone over cellular controlling a live Mac. |

## Local source anchors

The links in this section pin the vendored base to commit `00085d4e7dfdcfbf302c122fa2682b410a0f43d1` recorded above; the applied CEDIA patch tree remains separately recorded as `112ad5eee1cc236b5382a691ccf3202b2ced5c1e`.

- [Local collab contract](https://github.com/can1357/oh-my-pi/blob/00085d4e7dfdcfbf302c122fa2682b410a0f43d1/docs/collab.md): host/guest ownership and commands (lines 1–41), link/key forms (43–67), encryption and guest permissions (69–95), web client/settings/relay limits (97–124), and frame/topology/transcript ownership (126–138).
- [Host implementation](https://github.com/can1357/oh-my-pi/blob/00085d4e7dfdcfbf302c122fa2682b410a0f43d1/packages/coding-agent/src/collab/host.ts): room/link generation and relay setup (205–288), hello/token/snapshot admission (333–423), prompt/abort/UI response handling (460–520), state/model/queue fields (530–551), Agent Hub and transcript reads (594–681).
- [Wire/link contract](https://github.com/can1357/oh-my-pi/blob/00085d4e7dfdcfbf302c122fa2682b410a0f43d1/packages/coding-agent/src/collab/protocol.ts): frame union and guest→host commands (59–106), link generation/parsing and 32/48-byte secret validation (132–295).
- [Crypto](https://github.com/can1357/oh-my-pi/blob/00085d4e7dfdcfbf302c122fa2682b410a0f43d1/packages/coding-agent/src/collab/crypto.ts): AES-GCM room-key import and `[12-byte IV][ciphertext+tag]` sealing (1–54).
- [TUI guest](https://github.com/can1357/oh-my-pi/blob/00085d4e7dfdcfbf302c122fa2682b410a0f43d1/packages/coding-agent/src/collab/guest.ts): join/hello, writable token, prompt/abort (256–388), replica snapshot/normal resume (433–468), entry/event/state/UI application (502–610), host ask presentation and local-session restoration (662–768).
- [Relay socket](https://github.com/can1357/oh-my-pi/blob/00085d4e7dfdcfbf302c122fa2682b410a0f43d1/packages/coding-agent/src/collab/relay-client.ts): close-code table/backoff/buffer limits (1–26), send/reconnect behavior (35–127), fatal/transient close handling (232–281).
- [Browser package README](https://github.com/can1357/oh-my-pi/blob/00085d4e7dfdcfbf302c122fa2682b410a0f43d1/packages/collab-web/README.md): standalone SPA, HTTPS/WebCrypto, direct relay, and fragment-secret behavior (1–37).
- [Browser guest client](https://github.com/can1357/oh-my-pi/blob/00085d4e7dfdcfbf302c122fa2682b410a0f43d1/packages/collab-web/src/lib/client.ts): prompt/UI/abort/Agent Hub commands and transcript fetch (172–207), hello/reconnect phase (214–229), snapshot/event/UI application (285–404).
- [Browser composer](https://github.com/can1357/oh-my-pi/blob/00085d4e7dfdcfbf302c122fa2682b410a0f43d1/packages/collab-web/src/components/shell/Composer.tsx): writable/live gating, prompt and queue badge (111–140, 198–250), `select`/`editor` response and Stop controls (142–196).
- [Browser Agent Drawer](https://github.com/can1357/oh-my-pi/blob/00085d4e7dfdcfbf302c122fa2682b410a0f43d1/packages/collab-web/src/components/agents/AgentDrawer.tsx): on-demand host transcript polling and writable chat/kill/revive controls (14–212).
- Focused local tests include `test/collab/steer-queue.test.ts`, `read-only.test.ts`, `guest-ui-request.test.ts`, `chunked-welcome.test.ts`, `relay-client-backpressure.test.ts`, `test/collab-web/client.test.ts`, `local-relay.test.ts`, `composer.test.tsx`, and `codec.test.ts`; the command/result is recorded above.

## Current official upstream references

The current primary docs were read from upstream `main` on 2026-09-23:

- [Official collab documentation](https://github.com/can1357/oh-my-pi/blob/73a11421fe34fbab8ad058ab9c1a2e4f447852ea/docs/collab.md) — confirms the same host-authoritative model, link permissions, AES-GCM relay contract, guest prompt/interrupt/Agent Hub/UI-request powers, browser client, and the non-self-hosted production relay. Its current `main` text additionally documents `collab.autoStart` and `omp collab list`/`omp collab link` local-host discovery; those additions are not in the vendored v18.1.18 files.
- [Official collab-web README](https://github.com/can1357/oh-my-pi/blob/73a11421fe34fbab8ad058ab9c1a2e4f447852ea/packages/collab-web/README.md) — confirms standalone browser use, offline mock-host, static build, HTTPS/WebCrypto, direct WebSocket relay, and fragment-only room key.
- [Official host source](https://github.com/can1357/oh-my-pi/blob/73a11421fe34fbab8ad058ab9c1a2e4f447852ea/packages/coding-agent/src/collab/host.ts), [guest source](https://github.com/can1357/oh-my-pi/blob/73a11421fe34fbab8ad058ab9c1a2e4f447852ea/packages/coding-agent/src/collab/guest.ts), [relay client](https://github.com/can1357/oh-my-pi/blob/73a11421fe34fbab8ad058ab9c1a2e4f447852ea/packages/coding-agent/src/collab/relay-client.ts), and [wire constants](https://github.com/can1357/oh-my-pi/blob/73a11421fe34fbab8ad058ab9c1a2e4f447852ea/packages/wire/src/index.ts) are the source-of-truth links for current-main protocol details.

## Decision-relevant conclusion

For the interview requirement “web and iPhone control the same running Mac OMP session over the
internet,” OMP collab already fills the **OMP session sharing/control** slice: a full link lets
a browser or another OMP guest read, prompt/steer, stop, answer OMP asks, and operate the host's
Agent Hub while the Mac remains the sole executor. The web guest is a plausible iPhone-Safari
surface, subject to HTTPS and relay reachability.

It does not fill the complete CEDIA product contract by itself: it has no native iPhone app, no
Code-OSS/fullIDE window projection, no generic CEDIA approval/device protocol, no published
self-hostable production relay, and no independent internet/cellular runtime receipt. CEDIA can
reuse/adapt the OMP collab protocol or use its relay as the OMP control plane, while OMP remains the sole execution/session owner. CEDIA still owns application lifecycle,
IDE/device integration, and the corresponding runtime evidence.

## CEDIA integration feasibility follow-up — 2026-09-23

Read-only inspection of the same pinned checkout and current CEDIA worktree; no additional
provider or runtime test was run. These findings qualify the existing collab evidence:

- [OmpRpcClient](../../../../packages/omp-adapter/src/client.ts) always spawns `--mode rpc-ui`
  with child stdin/stdout. [Host service](../../../../apps/host/src/service.ts) starts or
  resumes that owned child and verifies its session path. There is no collab guest adapter
  or arbitrary live-CLI attach in this path. Collab is an existing bounded alternative to
  investigate, not proof that another IPC must be invented or that full attachment works.
- [Runtime lock](../../../../apps/host/src/runtime-lock.ts) holds an exclusive SQLite
  transaction for a cooperating CEDIA child. It is not a universal lock for unrelated OMP
  CLI writers. Same-file external-session continuation needs a verified ownership handoff.
  Import/fork into a new session does not meet the owner's same-session requirement.
- OMP [Settings](https://github.com/can1357/oh-my-pi/blob/00085d4e7dfdcfbf302c122fa2682b410a0f43d1/packages/coding-agent/src/config/settings.ts)
  implements `get/set/flush/reloadFromDisk`; [layer documentation](https://github.com/can1357/oh-my-pi/blob/00085d4e7dfdcfbf302c122fa2682b410a0f43d1/docs/config-usage.md)
  says ordinary `set` persists global settings and project/overlay layers are read-only.
  [RPC types](https://github.com/can1357/oh-my-pi/blob/00085d4e7dfdcfbf302c122fa2682b410a0f43d1/packages/coding-agent/src/modes/rpc/rpc-types.ts)
  have specialized CEDIA auth/model-role commands, but no generic settings read/write/reload
  operation. A versioned bridge is feasible source work, not an existing settings API.
- [Approval schema](https://github.com/can1357/oh-my-pi/blob/00085d4e7dfdcfbf302c122fa2682b410a0f43d1/packages/coding-agent/src/config/settings-schema.ts)
  defines OMP tool policies. CEDIA's host service separately authorizes editor mutations
  and native bridge effects. The selected single-policy UI must distinguish OMP policy from
  CEDIA-owned path/device/buffer protection; current source is not evidence of one prompt.
- Prompt/steer RPC accepts text and `ImageContent` images, not arbitrary file attachments.
  A CEDIA context adapter must authorize/read files or explicit unsaved-buffer snapshots,
  convert supported images to the typed payload, and label text snapshots with source and
  revision. Binary or oversized input needs an honest unsupported/size result, not silent
  truncation or fabricated native OMP attachment support.
