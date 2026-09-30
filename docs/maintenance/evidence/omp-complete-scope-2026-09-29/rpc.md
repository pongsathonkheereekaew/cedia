# OMP rpc-ui completeness evidence (2026-09-29)

This receipt inventories the effective OMP RPC surface for the CEDIA Agentic IDE. It is evidence for the canonical plan, not a second plan. Speech-to-text is explicitly excluded from this gate.

## Pin and effective source

- Stock source: OMP `18.4.3`, revision `fc671eba383f2a7208500836673b485c0dc7073d` (`upstream/omp/packages/coding-agent/src/modes/rpc/rpc-types.ts:28-125` at `HEAD`).
- CEDIA runtime: the stock revision plus `patches/omp/0002-cedia-rpc-bridges-18.4.3.patch`, SHA-256 `a90b75f9fbcde9979e68af0ddd9ceca740f3b3720dd93f732f286fdc366782d5`, from `patches/omp/manifest.json`.
- The patch adds eight commands and bridge markers; the stock adapter tuple intentionally has 42 commands, while `CEDIA_UI_COMMAND_TYPES` carries the eight opt-in commands (`packages/omp-adapter/src/types.ts:74-132`).
- The checkout is dirty because the manifest patch is applied. Parent verification with `verifyOmpSource` passed: the complete tracked/untracked non-ignored tree equals the pinned revision plus patch, tree `3b333bd1fea898e8c5c81e6e06d83db26d70d61d`. No outside-patch drift was found. This verifies source identity, not a running packaged binary.

## Exhaustive command coverage

The JSON companion lists all 61 named `RpcCommand` operations with family, payload fields, current host path, current presentation, and the smallest missing addition:

- Stock protocol/prompt/session/state/model/thinking/queue/compaction/retry/shell/messages/auth (42): `negotiate_protocol`, `prompt`, `steer`, `follow_up`, `abort`, `abort_and_prompt`, `new_session`, `get_state`, `set_fast_mode`, `get_available_commands`, `set_todos`, `set_host_tools`, `set_host_uri_schemes`, `set_subagent_subscription`, `get_subagents`, `get_subagent_messages`, `set_model`, `cycle_model`, `get_available_models`, `set_thinking_level`, `cycle_thinking_level`, `set_steering_mode`, `set_follow_up_mode`, `set_interrupt_mode`, `compact`, `set_auto_compaction`, `set_auto_retry`, `abort_retry`, `bash`, `abort_bash`, `get_session_stats`, `export_html`, `switch_session`, `branch`, `get_branch_messages`, `get_last_assistant_text`, `set_session_name`, `handoff`, `get_messages`, `get_messages_page`, `get_login_providers`, `login`.
- CEDIA patch (8): `cedia_terminal_negotiate`, `cedia_terminal_input`, `cedia_terminal_resize`, `cedia_get_model_roles`, `cedia_set_model_role`, `cedia_get_auth_providers`, `cedia_set_api_key`, `cedia_logout`.
- Dispatch is real in the pinned source/patch switch (`upstream/omp/packages/coding-agent/src/modes/rpc/rpc-mode.ts:1384-2126`). CEDIA reaches it through `apps/host/src/service.ts:397-460`, where command IDs/incarnations are journaled and `requestCedia` applies ready-frame capability gates.
- “Reachable” does not mean “complete UI”: the generic `cedia-host rpc` path accepts all 42 stock names (`apps/host/src/cli-client.ts:29-50,242-257`), but several controls still need named Agent/IDE/remote presentation. Per-command status is authoritative in `rpc.json`.

## Actual data flow

`Agent/IDE/iPhone/CLI` → authenticated CEDIA host command envelope → `CediaHost.command` → `OmpRpcClient.request` or capability-gated `requestCedia` → one OMP `rpc-ui` process. The adapter correlates ACKs by wire ID; prompt completion arrives later as `agent_end` (`packages/omp-adapter/src/client.ts:239-267,404-490`). The host separately records claimed/acknowledged/completed/unknown command states (`apps/host/src/service.ts:415-460`).

OMP stdout is first journaled and then routed to the terminal registry, extension UI broker, host dispatcher, and lifecycle reducer (`apps/host/src/service.ts:580-610`). The Agent/IDE projections reduce the journal; raw/unmodelled frames remain activity data (`apps/macos/agent-window/src/cedia-adapter.ts:497-572`, `apps/macos/src/state.ts:765-803`). No second agent loop is introduced.

## Extension UI and host bridges

The complete `extension_ui_request` method set is: `select`, `confirm`, `input`, `editor`, `cancel`, `notify`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text`, `open_url` (`rpc-types.ts:523-604`). `ExtensionUiBroker` validates, deduplicates, times out, cancels and sends explicit responses (`packages/omp-adapter/src/ui.ts:296-450`). `select`/`confirm`/`input`/`editor` are interactive; the rest are presentation/custom UI or cancellation. The JSON companion marks which have a current CEDIA consumer and which require a bounded slot or explicit unsupported result.

The host bridge frame set is `host_tool_call`, `host_tool_cancel`, `host_tool_update`, `host_tool_result`, `host_uri_request`, `host_uri_cancel`, `host_uri_result`. `OmpHostDispatcher` validates IDs, authorization, cancellation, timeouts and result shapes (`packages/omp-adapter/src/host.ts:495-826`); CEDIA registers guarded editor/native permission tools at startup (`apps/host/src/service.ts:338-370`). Browser, Git/review/worktree, user Terminal, remote devices and notifications remain CEDIA-owned surfaces; they are not invented OMP RPC names.

## State/event completeness

`RpcSessionEventFrame` is `AgentSessionEvent | RpcSubagentFrame` (`rpc-types.ts:499-516`). The source union has 28 event names: core agent/turn/message/tool lifecycle (including `tool_stream_update`), compaction/retry/fallback, model/config/advisor, TTSR/todo/IRC/notice/thinking/goal events. The stock `rpc-client.ts` allow-list recognizes 25 and omits `config_warnings_changed`, `advisor_cost_changed`, and `advisor_yielded` (`upstream/omp/packages/coding-agent/src/modes/rpc/rpc-client.ts:143-183`). CEDIA's generic frame listener still journals unknown frames, but a complete IDE must add typed capability/event fixtures rather than silently dropping those three.

Subagent frames are `subagent_lifecycle`, `subagent_progress`, and `subagent_event`; they are typed and journaled but have no dedicated Agent panel yet. `ready`, `rpc_chunk`, `response`, `prompt_result`, `available_commands_update`, and `extension_ui_request` are also covered in the JSON companion, including protocol-v2 size/order gates and the distinction between ACK and terminal result.

## Verdict for the plan

The OMP transport/bridge inventory is complete and exhaustive at the pinned revision: 50 commands, 11 extension UI methods, 7 host bridge frame types, 28 source session events, and the three recognition gaps are named. The product plan may claim **OMP RPC-complete scope** only if every `ui-missing`/`ui-partial` entry in `rpc.json` receives a CEDIA surface, owner, capability marker, and acceptance fixture in R1–R8. A generic RPC endpoint alone is not full Agentic-IDE support.
