# OMP Complete Scope Evidence

Inspected on 2026-09-23 from local `upstream/omp` at commit `00085d4e7dfdcfbf302c122fa2682b410a0f43d1`. The checkout is dirty because the pinned CEDIA OMP manifest patch is applied; parent verification found tracked/untracked non-ignored tree `112ad5eee1cc236b5382a691ccf3202b2ced5c1e`, exactly equal to the pinned revision plus that manifest patch. The settings schema, CLI registry, slash registry, and cited documentation were read at this verified source tree. This is a source inventory and bridge contract, not a claim that CEDIA has implemented every surface.

The machine-readable companion [config-cli.json](./config-cli.json) is the exhaustive list. It contains every effective settings-schema path (including hidden/config-file-only paths), its high-level family, root, type, default expression, UI metadata, credential marker, and source ID; every built-in slash command with aliases, subcommands, transport surfaces, TUI-only status, and source ID; all top-level CLI commands and registered launch flags; and the feature/bridge map.

## Inventory result

- **498** unique settings paths from `SETTINGS_SCHEMA`.
- **79** built-in slash commands from six registered arrays.
- **38** slash commands are TUI-only (`handleTui` without `handle`); **34** have both TUI and text/ACP handlers; **7** have a text/ACP handler and use the TUI adapter.
- **41** top-level CLI commands, including `launch` and the internal `__complete` command.
- Settings family counts: runtime 13, auth 2, interaction 50, models 54, shell 25, tools/extensions 56, providers 47, appearance 56, context 33, tasks/workflows 51, workspace/review 9, memory 73, files 29.

The extraction starts at the `export const SETTINGS_SCHEMA = {` root and recognizes both quoted dotted keys and bare identifier keys at the schema's top-level indentation. It therefore does not confuse nested UI option objects with settings.

## Settings ownership and write routes

The effective precedence is built-in defaults → global `config.yml/config.yaml` → project capability settings → repeatable `--config` overlays → runtime overrides. `Settings.get(path)` returns the merged value or schema default. `Settings.loadReadOnly()` reads without migration, agent-db access, or writes. Sources: [settings.md](../../../../upstream/omp/docs/settings.md), [settings.ts](../../../../upstream/omp/packages/coding-agent/src/config/settings.ts#L590-L682).

- `omp config list/get/set/reset/path/init-xdg` is the native settings CLI. `set` and `reset` validate against the schema and persist the global file; reset writes the schema default rather than deleting a key. Source: [config-cli.ts](../../../../upstream/omp/packages/coding-agent/src/cli/config-cli.ts#L243-L422).
- Ordinary `Settings.set` writes the global layer and runs setting hooks. A dedicated exception writes only `modelRoles` into project `.omp/config.yml` when `modelRoleStorage: project`; missing project roles fall back to global roles. Source: [settings.ts](../../../../upstream/omp/packages/coding-agent/src/config/settings.ts#L652-L682) and [settings.ts](../../../../upstream/omp/packages/coding-agent/src/config/settings.ts#L1244-L1258).
- CLI overlays and runtime flags are read-only from CEDIA's persistent settings surface. CEDIA must preserve their scope instead of copying them into a second global store.
- Credential markers and UI secrets are redacted by native config listing. A bridge must keep the same redaction rule and must not forward an unredacted `config get` result to a remote client by default.
- Model/provider definitions are a separate native surface: `models.yml`/`models.yaml`, ModelRegistry, provider discovery, extension providers, and AuthStorage. They are not additional CEDIA settings keys. Source: [models.md](../../../../upstream/omp/docs/models.md) and [providers.md](../../../../upstream/omp/docs/providers.md).

CEDIA should expose an OMP settings capability browser/status view backed by these native routes. It may group or hide advanced rows in the normal UI, but must retain a discoverable path to every listed key and must not invent a second harness-specific setting.

## Native slash-command surface

The registry is assembled in [builtin-registry.ts](../../../../upstream/omp/packages/coding-agent/src/slash-commands/builtin-registry.ts#L38-L55) from modes, collaboration, session, lifecycle, marketplace, and control arrays. The JSON records the exact names, aliases, subcommands, and handlers.

File-backed and generated commands are additional runtime data:

- `.omp/commands` and provider-compatible user/project command roots are loaded through `loadSlashCommands`.
- Skills contribute `/skill:<name>` commands.
- Extensions, hooks, MCP, and installed plugins can add command metadata.
- The bundled workflow command `/init` is embedded by `task/commands.ts`.
- RPC emits `available_commands_update` at startup, after extension initialization, and after plugin/skill/MCP refresh. CEDIA clients must consume those updates instead of caching one command list.

A slash spec with only `handleTui` is not callable through ordinary ACP/text dispatch. The 38 names are listed in `tuiOnlySlashCommands` in the JSON. They require an explicit versioned CEDIA host/UI bridge or a TUI-compatible invocation path; implementing a second agent loop would violate OMP ownership.

## CLI, attach, sessions, and collaboration

The native top-level registry is [cli-commands.ts](../../../../upstream/omp/packages/coding-agent/src/cli-commands.ts#L22-L227). Flag ownership is split between [flag-tables.ts](../../../../upstream/omp/packages/coding-agent/src/cli/flag-tables.ts) and [args.ts](../../../../upstream/omp/packages/coding-agent/src/cli/args.ts). The JSON lists value-taking, optional-value, and boolean/flag aliases, including `--mode rpc`, `--mode rpc-ui`, and `--mode acp`.

- RPC is the CEDIA attach boundary: JSONL ready/response/event frames, protocol negotiation, prompt/steer/follow-up/abort, state/model/thinking/queue/compaction/retry, bash, session, message paging, login, host tools/URI schemes, extension UI, and subagent subscriptions. Source: [rpc.md](../../../../upstream/omp/docs/rpc.md) and [rpc-types.ts](../../../../upstream/omp/packages/coding-agent/src/modes/rpc/rpc-types.ts).
- ACP is a separate standard transport to support compatible clients; it remains backed by the same OMP AgentSession. The selected CEDIA integration retains RPC plus its versioned bridge; ACP support is not permission to start a second owner.
- Session import/resume/fork is native: `--continue`, `--resume`, `--fork`, `--from-claude`, `--from-codex`, and SessionManager. CEDIA maps these to the same session owner.
- OMP-native provider account controls include `/login`, `/logout`, `/session pin`, RPC login/provider discovery, `listCurrentProviderOAuthAccounts`, and `pinCurrentProviderOAuthAccount`. OMP-native Codex reset-credit controls include `/usage reset`, `listResetCredits`, and `redeemResetCredit`. These use OMP AuthStorage; they are not a second Codex/Synara harness or a separate credits UI.
- OMP collaboration remains host-owned execution over an encrypted relay: `/collab`, `/join`, `/leave`, full/view-only links, prompt/interrupt and interactive request arbitration. CEDIA's Tailscale remote control is a separate authenticated transport and must not silently replace OMP collab semantics. Source: [collab.md](../../../../upstream/omp/docs/collab.md).

## Feature mapping for CEDIA

| Capability | Native source/route | CEDIA rule |
| --- | --- | --- |
| Settings | SETTINGS_SCHEMA + Settings + `omp config` | OMP owns values, precedence, validation, migration, and redaction. |
| Model roles | MODEL_ROLES + `modelRoles/modelTags/cycleOrder` | Keep role IDs and project/global provenance; no duplicate model resolver. |
| Auth/accounts | AuthStorage, `/login`, RPC login, session pin/reset | Keep credentials and account actions behind OMP. |
| Models/providers | models.yml, ModelRegistry, discovery, `registerProvider` | Surface discovery/refresh and exact provider/model identity. |
| Import/instructions | SessionManager importers, AGENTS/context/rules, prompt templates, `@file` | Preserve native discovery roots and source provenance. |
| Extensions/plugins | extension loader, hooks, plugin/marketplace commands | Show install/enable/reload status; trigger native refresh. |
| MCP/skills | MCP manager/config, skill discovery and commands | Bind tools/commands to the active OMP session and advertise updates. |
| Browser/terminal | Eval/browser relay; bash PTY/hub/RPC bash | Keep user terminal separate from AI bash; retain abort and approval semantics. |
| Review/worktree | git UI, commit, branch/fork/tree, worktree | Map to active session/worktree; no direct file mutation outside the owner contract. |
| Speech-to-text | OMP STT settings/workers | Deferred by the current product decision; excluded from this scope gate. |

## Required CEDIA gates

1. Launch OMP through one negotiated RPC/ACP session owner; verify IDs, ordering, abort, reconnect, and message paging.
2. Expose all 498 setting paths through a schema-backed capability route with global/project/overlay/runtime scope and credential redaction.
3. Consume `available_commands_update` after startup and every discovery/plugin/MCP/skill reload; route the 38 TUI-only commands through a versioned bridge or an explicit CEDIA presentation equivalent. A missing applicable bridge remains integration-missing and blocks F; unavailable status is not completion.
4. Verify model/provider refresh, AuthStorage login/logout/account pin/reset, and session import/resume/fork without duplicate credentials, transcript, or execution.
5. Verify OMP collab independently from CEDIA Tailscale remote control, including host ownership and first-response-wins interactive approvals.

This evidence closes the inventory gap for “OMP-ready” planning. It does not claim runtime completion; implementation and packaged/remote acceptance remain separate gates.
