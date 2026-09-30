# OMP tool and extension scope (2026-09-23)

This is the OMP execution-surface inventory for CEDIA.  It is intentionally
separate from Synara's product UI.  Source is the local checkout at
`upstream/omp`, revision `00085d4e7dfdcfbf302c122fa2682b410a0f43d1`; that
checkout contains the applied CEDIA patch. Parent `verifyOmpSource` confirmed tree
`112ad5eee1cc236b5382a691ccf3202b2ced5c1e` exactly matches the base plus manifest patch.
Implementation acceptance must still record its actual packaged/runtime revision.  The registry source is
[`builtin-names.ts`](https://github.com/can1357/oh-my-pi/blob/00085d4e7dfdcfbf302c122fa2682b410a0f43d1/packages/coding-agent/src/tools/builtin-names.ts)
and the factory/conditional source is
[`tools/index.ts`](https://github.com/can1357/oh-my-pi/blob/00085d4e7dfdcfbf302c122fa2682b410a0f43d1/packages/coding-agent/src/tools/index.ts).

## Canonical model-facing registry

`BUILTIN_TOOLS` registers 28 ordinary names: `read`, `bash`, `edit`,
`ast_grep`, `ast_edit`, `ask`, `debug`, `eval`, `github`, `glob`, `grep`,
`lsp`, `checkpoint`, `rewind`, `context_notes`, `new_context`,
`security_scan`, `task`, `hub`, `todo`, `web_search`, `write`, `memory_edit`,
`retain`, `recall`, `reflect`, `learn`, and `manage_skill`.  Three hidden
control names are `think`, `yield`, and `goal`.  The complete name/family and
condition map is machine-readable in [`tools.json`](tools.json).

Conditions are applied by `createTools` and by each factory; a name in the
registry does not mean a live tool in every session.  The important gates are:

- `bash`, `glob`, `grep`, `ast_grep`, `ast_edit`, `web_search`, `security_scan`,
  `debug`, `github`, `lsp`, `todo`, and `goal` require their corresponding
  settings (and `github` also requires a usable `gh` integration).
- `eval` requires an enabled JavaScript or Python backend.  `task` is limited
  by recursion depth; `hub` requires IRC/AgentHub enabled and is unavailable in
  restricted sessions.  `ask` also requires an interactive UI/prompt callback.
- `checkpoint`/`rewind` require checkpoint settings and session depth rules.
  `context_notes`/`new_context` require experimental context management plus a
  valid session manager.  `think` requires external-thinking support from the
  selected model, and `yield` is a hidden session-control tool.
- Memory tools require the configured Hindsight/Mnemopi backend (`memory_edit`
  is Mnemopi-only). `learn`/`manage_skill` require autolearn; `learn` also
  requires a supported memory backend.

`search` and `find` are compatibility aliases for `grep` and `glob`; there is
no separate builtin named `search`.  `tools.xdev` can present builtins,
custom tools, and MCP tools under `xd://` discovery without creating another
execution owner; it changes presentation/load mode, not capability ownership.

## Capability families

- **Files, code, documents, media:** `read`, `write`, `edit`, `glob`, and
  `grep` are native. `read` handles text, images, converted documents, and
  video frame/time selectors; URL fetch conversion covers PDF/DOCX/PPTX/XLSX/
  EPUB. See [`read.ts`](https://github.com/can1357/oh-my-pi/blob/00085d4e7dfdcfbf302c122fa2682b410a0f43d1/packages/coding-agent/src/tools/read.ts)
  and [`fetch.ts`](https://github.com/can1357/oh-my-pi/blob/00085d4e7dfdcfbf302c122fa2682b410a0f43d1/packages/coding-agent/src/tools/fetch.ts).
- **Shell and code execution:** `bash` is the native shell surface; `eval`
  runs the enabled JS/Python backend. Background `bash`, `eval`, and `task`
  jobs are owned by `AsyncJobManager`, not by a second harness.
- **Code intelligence:** `ast_grep`, `ast_edit`, and `lsp` are conditional
  native tools. `github` and `web_search` are OMP tools with provider/auth
  settings, not Synara-only features.
- **Browser and desktop:** browser and computer are eval **preludes**, not
  builtin registry entries. When enabled they expose `browser` and `computer`
  JS/Python globals through [`preludes.ts`](https://github.com/can1357/oh-my-pi/blob/00085d4e7dfdcfbf302c122fa2682b410a0f43d1/packages/coding-agent/src/eval/preludes.ts),
  [`browser.ts`](https://github.com/can1357/oh-my-pi/blob/00085d4e7dfdcfbf302c122fa2682b410a0f43d1/packages/coding-agent/src/tools/browser.ts),
  and [`computer.ts`](https://github.com/can1357/oh-my-pi/blob/00085d4e7dfdcfbf302c122fa2682b410a0f43d1/packages/coding-agent/src/tools/computer.ts).
- **Image and speech:** `generate_image` and `tts` are dynamic custom tools;
  image generation requires a model/provider tool and TTS requires
  `speechgen.enabled`. CEDIA defers speech-to-text/Thai voice input; TTS is an
  existing optional OMP capability. See [`sdk.ts`](https://github.com/can1357/oh-my-pi/blob/00085d4e7dfdcfbf302c122fa2682b410a0f43d1/packages/coding-agent/src/sdk.ts)
  and [`tts.ts`](https://github.com/can1357/oh-my-pi/blob/00085d4e7dfdcfbf302c122fa2682b410a0f43d1/packages/coding-agent/src/tools/tts.ts).
- **Planning and recovery:** `todo` is persisted structured work state;
  hidden `goal` is budgeted goal lifecycle; `/plan` is a mode (there is no
  builtin called `plan`); `checkpoint`/`rewind` are session recovery.
- **Subagents, peers, and jobs:** `task` owns the subagent tree and persisted
  task transcripts. `hub` is AgentHub peer messaging plus named process
  supervision and job wait/cancel/list; it is distinct from a task subtree.
  `AsyncJobManager` owns `bash`/`eval`/`task` async jobs and progress/events.
  Sources: [`task/index.ts`](https://github.com/can1357/oh-my-pi/blob/00085d4e7dfdcfbf302c122fa2682b410a0f43d1/packages/coding-agent/src/task/index.ts),
  [`hub/index.ts`](https://github.com/can1357/oh-my-pi/blob/00085d4e7dfdcfbf302c122fa2682b410a0f43d1/packages/coding-agent/src/tools/hub/index.ts),
  [`job-manager.ts`](https://github.com/can1357/oh-my-pi/blob/00085d4e7dfdcfbf302c122fa2682b410a0f43d1/packages/coding-agent/src/async/job-manager.ts).

## Dynamic discovery and extension surfaces

The complete dynamic rule is: keep builtin names above; add eval preludes when
their settings/backend are active; discover custom/extension tools from the
capability providers, `.omp/tools` (and compatible foreign roots), plugins, and
explicit paths; discover MCP servers from project/user/plugin config and expose
each tool as `mcp__<server>_<tool>` (or deferred `xd://` catalog entries).  Tool
name collisions with builtins are rejected.  Each subagent reloads factories
for its own cwd/session.  See [`custom-tools/loader.ts`](https://github.com/can1357/oh-my-pi/blob/00085d4e7dfdcfbf302c122fa2682b410a0f43d1/packages/coding-agent/src/extensibility/custom-tools/loader.ts),
[`extensions/types.ts`](https://github.com/can1357/oh-my-pi/blob/00085d4e7dfdcfbf302c122fa2682b410a0f43d1/packages/coding-agent/src/extensibility/extensions/types.ts),
[`capability/index.ts`](https://github.com/can1357/oh-my-pi/blob/00085d4e7dfdcfbf302c122fa2682b410a0f43d1/packages/coding-agent/src/capability/index.ts),
and [`mcp/tool-bridge.ts`](https://github.com/can1357/oh-my-pi/blob/00085d4e7dfdcfbf302c122fa2682b410a0f43d1/packages/coding-agent/src/mcp/tool-bridge.ts).

Skills, hooks, extension commands, MCP resources/prompts, and custom tools are
OMP capability providers.  Hooks observe/guard tool calls and approvals; they
do not execute a parallel transcript.  MCP discovery/reconnect/catalog events
are exposed by `MCPManager`; CEDIA should display and route these events through
the existing session/RPC bridge.

## CEDIA boundary and acceptance implications

OMP remains the sole execution, provider-auth, transcript, tool-registry,
subagent, job, MCP, extension, hook, and skill owner.  CEDIA owns the native
Code-OSS host, dirty-buffer/editor bridge, terminal/browser/computer UI,
workspace/project settings, remote transport, and mobile continuation.  The
existing RPC surface already carries prompt/steer/abort, model/auth, todos,
subagent lifecycle/progress, host-tool calls, URI schemes, terminal frames,
extension UI, and state snapshots; use it instead of adding a second harness.
See [`rpc-types.ts`](https://github.com/can1357/oh-my-pi/blob/00085d4e7dfdcfbf302c122fa2682b410a0f43d1/packages/coding-agent/src/modes/rpc/rpc-types.ts),
[`host-tools.ts`](https://github.com/can1357/oh-my-pi/blob/00085d4e7dfdcfbf302c122fa2682b410a0f43d1/packages/coding-agent/src/modes/rpc/host-tools.ts),
and [`cedia-client-bridge.ts`](https://github.com/can1357/oh-my-pi/blob/00085d4e7dfdcfbf302c122fa2682b410a0f43d1/packages/coding-agent/src/modes/rpc/cedia-client-bridge.ts).

Synara-only product work (window layout, branding, settings taxonomy, project
management, Tailscale/remote policy, IDE dirty-buffer UX, and mobile approval
UX) must not be represented as new OMP tools.  Acceptance must prove that one
OMP session owner drives every agent action, that disabled conditions hide or
defer tools correctly, and that CEDIA can surface dynamic MCP/extension/custom
tools without forking the harness.
