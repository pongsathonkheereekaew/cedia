# Cedia desktop defaults

Base: `ea1912fd6a05b80a56b2ad9b955075211deea521` (retained Cedia Code-OSS fork).

`manifest.json` lists every patch and its digest; `scripts/prepare-desktop.ts`
verifies the base revision and each digest before applying.

> Retired 2026-09-20: patches `0008`, `0010`, `0015`-`0018`, `0020`-`0026`,
> `0029`, `0031`, `0035`, `0039`, `0042`, `0048`-`0055` are gone (27 files). They all served
> only the native sessions workbench UI, which no window renders since `0056` loads the
> standalone agent bundle instead. `0005` stays: its import trims keep the sessions entries
> compiling against the `removals` list (the gulp build fails without it). `0007` keeps its
> platform hunk; only the sessions-contribution hunk retired.
> Retired 2026-09-22 (plan §10 item 56): patches `0011`, `0013`, `0014`, `0040`, `0041`,
> `0043`-`0047` are gone (10 files). They were the native model-picker path — the workbench
> pickers that drew OMP's catalogue through session option groups — and they retire with the
> registration that published those groups (`apps/macos/src/chat-sessions.ts`,
> `omp-language-models.ts`, the `chatSessions`/`chatParticipants` contributions and the
> `chatSessionsProvider`/`chatParticipantPrivate`/`defaultChatParticipant` proposals).
> The manifest holds the 19 that remain; see the plan's §9 entry.

`0001-cedia-startup-defaults.patch` changes only initial settings: disable upstream
AI surfaces, start without the VS Code welcome editor, and disable experimental
Copilot onboarding. These remain settings, not policy overrides. The Cedia task
extension supplies the shell, including a non-executing Restricted Mode surface.
Workspace trust enforcement remains enabled.

`0002-cedia-agents-window-menus.patch` drops Selection, Go, Run and Terminal from
the menu bar while the `cedia.agentsWindow` context key is set. The reference
agent window shows Cursor/File/Edit/View/Window/Help, and the pinned Code-OSS
already uses the same mechanism to hide Run in its own sessions window. The key
is set by the Cedia extension when the window shows the Agents shell
(`CEDIA_AGENTS_WINDOW_CONTEXT` in `apps/macos/src/workbench-mode.ts`), so the IDE
window keeps the editor menus. `apps/macos/test/ide-native-workbench.test.ts`
pins the key, the patch text, and the manifest digest together.

**Retired.** The base Agents window registers its own menu set now, so hiding
editor menus by context key is no longer needed: the patch file and its manifest
entry are gone, and the context key it depended on was removed with it.

`0003-cedia-agents-window-proposals.patch` is Cedia's product identity for the
Agents window: it allows the built-in `cedia.cedia` extension to use the proposed
`chatProvider` and `chatParticipantAdditions` APIs (the `chatSessionsProvider`,
`chatParticipantPrivate` and `defaultChatParticipant` rows retired with item 56),
and it removes the Copilot product identity —
`defaultChatAgent` (the key that made the sessions window run Copilot's
welcome/sign-in flow), the Copilot entries in `trustedExtensionAuthAccess`, and
`GitHub.copilot-chat` from `builtInExtensionsEnabledWithAutoUpdates`. After this
patch `product.json` contains no Copilot references. It is a prerequisite for
`docs/maintenance/CEDIA-PLAN.md` step S1 and has no effect until the
next Code-OSS build. The 0002 menu patch is scheduled for retirement in that same
plan: the base Agents window registers its own menu set, so hiding editor menus by
context key stops being necessary once the Agents window is the real surface.

`0004-cedia-agents-entry.patch` is the drift that used to live only in the
checkout: it routes the workbench "Open Agents" action to the Cedia extension
instead of the base Agents window. It exists so the tree has no unreviewed
modification. Step S1 of `docs/maintenance/CEDIA-PLAN.md` inverts
this patch (route to `workbench.action.openAgentsWindow` and delete the comment
that calls that window Copilot's) once the Copilot harness is gone and the Cedia
provider serves the window.

**Retired.** Step S1 landed: `workbench.action.openAgentsWindow` is the route
again, so the patch file and its manifest entry are gone.

`0005-cedia-remove-copilot-sessions.patch` stops the sessions workbench (the
Agents window) from loading the Copilot chat session provider in both the desktop
and web entry points. After this patch nothing imports
`copilotChatSessions.contribution.js`, so the window no longer offers
`Session Type: Copilot`; Cedia's own provider is the only session source once
step S2 lands. The Copilot harness directories are still on disk at this step —
removing the registration before deleting the code keeps every intermediate tree
buildable.

`0006-cedia-unwire-agent-harnesses.patch` removes the agent-harness registrations
themselves: no Copilot/Claude/Codex provider is registered in `agentHostMain` or
`agentHostServerMain`, `providerConfigurations` is empty, and the Copilot BYOK
proxy, Claude/Codex proxy services, pending-edit content provider and the Copilot
API service wiring in `agentHostServices`/`agentHostBootstrap` are gone. Verified
with `npm run typecheck-client` (0 errors) and the import resolver check. The
harness directories are still on disk; deleting them (and the sessions pickers
that import the Copilot pickers) is step S1b.

`0007-cedia-drop-harness-pickers.patch` removes the last production references to
the Copilot harness: the Copilot-schema picker family is gone (mode, permission,
approval, agent pickers plus their mobile variants) and `sessionPluginBundler.ts`
declares the discovery shape it used to import from the Copilot module. (The patch
once also trimmed the sessions-side remote-agent-host contribution; that hunk retired
with the native sessions UI on 2026-09-20.)

Patches `0009` and `0011`-`0014` are the plan's S1-S4 work (the sessions-UI members of
the old `0008`-`0015` range — `0008`, `0010`, `0015` — retired 2026-09-20, see below);
their intent is recorded in the evidence receipts under `docs/maintenance/evidence/` rather than here.

`0019-cedia-customize-in-sidebar.patch` is the one Cedia patch that edits
`src/vs/workbench/**`, so it is deliberately a single configuration default:
`chat.agentSessions.customizationEntryPoints` goes from `product.quality !== 'stable'`
to `false`. That setting's own description is the choice between the new-session
composer and the Agents Window sidebar; section 3 of the plan lists `Customize` in
the sidebar, so Cedia selects the sidebar placement. Every consumer of the setting
lives under `src/vs/sessions/**`, so the IDE window is untouched. It is recorded in
`docs/maintenance/evidence/s4-customize-sidebar-2026-09-14/`.

`0027-cedia-agents-open-new-tab-menu.patch` renames the editor group's `+` in the
Agents window to the reference's wording. `editorTabsControl.ts` reads its label from
the active context key, so the patch adds `IsSessionsWindowContext` to the condition
that picks between `Add Tab` and `Open new tab menu`: the sessions-window branch is
dormant (no sessions workbench renders since `0056`), the IDE keeps upstream's wording.

`0028-cedia-inline-react-in-client-bundles.patch` inlines React into the workbench
client bundles. It was written for the native sessions React surfaces (retired with
`0021` on 2026-09-20); no rendered surface consumes the inlining today, so the patch
is inert configuration kept out of build-infra caution. Removing it is a follow-up
once the workbench carries no React consumer at all.

Both `0021` and `0028` were re-cut on 2026-09-15 from the working tree, because the
checkout had drifted past what the patches said: `agentHomeUtilityEditor.ts` had
moved on (the strip entries open an instance of their own), the Agents window's
context-menu surface was added to `agentHomeUtility.css`, and the React inlining
existed only in the checkout. `bun scripts/prepare-desktop.ts` was red until then,
because a patch that does not match the tree cannot pass its own reverse-check.

`0032-cedia-no-base-agent-host.patch` is Cedia's whole answer to the base Agent Host, in
two halves. Both are needed: stopping the prewarm alone left the client in place, so any
surface that asked that host for work still started the process.

1. **The prewarm stops.** The utility process exists to host the Copilot/Claude/Codex
   harnesses, and S1 removed that layer - but the process's node-side graph still requires
   Copilot services that no longer exist (`agentHostCustomizationEnablementService depends
   on copilotApiService which is NOT registered`), so a process started at restore dies on
   boot, `AgentHostProcessManager` restarts it five times and the window shows "The Agent
   Host failed to start". `AgentHostPrewarmContribution` no longer starts it, and the
   base's own suite for that contribution pins the Cedia contract ("does not start the
   agent host while enabled").
2. **The client is the base's null implementation.** `NullAgentHostService` already
   exists for browser contexts where no local host is available; the desktop DI shim now
   returns it for the local branch, with a Cedia reason
   (`Cedia ships no agent host: OMP is the only harness this build runs.`) instead of the
   browser-worded default. The remote branch is untouched for a window attached to a
   remote authority. Every call into it now throws that one sentence, which is the honest
   reading of this build: the harness layer it would host is removed, and OMP is the only
   execution owner.

Three base files, none touched by an earlier patch: the workbench service that carries the
shim and the prewarm contribution, its test, and `NullAgentHostService` itself (the reason
becomes a constructor argument, and the module-private `notSupported` const becomes a
protected method so a caller's build can name itself). Booting the process instead would
mean restoring Copilot services across `agentHostServices.ts`, `agentBranchNameGenerator.ts`
and the changeset handlers, which is the layer the plan removes rather than re-adds.

`0033-cedia-agents-no-copilot-composer-controls.patch` closes three of the plan's chrome
decisions in the Agents window, all by scoping a base chat control out of that window with
`IsSessionsWindowContext.toNegated()` (the IDE window keeps every one of them):

- `chatToolActions.ts` - `Configure Tools...` configures the base's tool set for the default
  agent, and the window runs on OMP, which owns its tools end to end; offering it would promise
  a setting nothing reads.
- `chatExecuteActions.ts` - the permission picker's levels (manual / allow all / autopilot) are
  the Copilot permission model, while this window's approvals come from OMP.
- `chatModeActions.ts` - `Configure Custom Agents...` opens a Copilot-chat surface that does not
  exist here; the gate applies to both the menu entry and the action's precondition, so the
  command palette entry is disabled rather than dead.

The fourth decision (the sidebar's empty `Chats` group) is a setting, not a patch: the
extension writes `sessions.list.showEmptyDefaultGroups: false` into the Agents window's own
workspace file beside the theme keys.

`0034-cedia-drop-agent-workbench-shell.patch` is one hunk: it drops the
`./contrib/agentWorkbench/electron-sandbox/agentWorkbench.contribution.js` import from
`src/vs/workbench/workbench.common.main.ts`. Everything that import loaded lives in
`src/vs/workbench/contrib/agentWorkbench/`, which is a `removals` entry below, so the patch and the
removal are one change in two files.

Why it exists: that island was Cedia's earliest shell scaffold, and by the time this landed its only
live effect was two command-palette entries. `cedia.openAgentsWindow` ran a mode service and then
opened the view id `cediaComposer` - the extension webview shell that the native Agents window
replaced - so the palette offered a second route to a retired surface beside the base's own
`workbench.action.openAgentsWindow`. `cedia.openIde` recorded the same mode flag and told the user
they were already in the IDE. Nothing read that flag: the context key `cediaWorkbenchShell` appears
in no `when` clause in the tree, and `getLastShellState()` had no caller. Opening the Agents surface
is now one route (`cedia.showAgents` in the extension). See the plan's §6.2 ledger.

## Removals

`manifest.json` also carries a `removals` list: whole trees and files Cedia does
not ship (the `copilot`/`claude`/`codex` harness directories, the agent-host test
tree, the Copilot chat-session provider, the picker files above, and Cedia's own
retired `src/vs/workbench/contrib/agentWorkbench/` island). They are
deleted by `prepare-desktop.ts` instead of living in a multi-megabyte deletion
patch, so the list stays reviewable and every path is still tracked. Restoring the
pinned checkout and re-running `bun scripts/prepare-desktop.ts` reproduces the
Copilot-free tree; that state passes `npm run typecheck-client` with 0 errors.

Not yet removed: 15 Copilot-named helper files that are not part of the harness
(`copilotCliConfig`, `copilotHome`, `copilotManagedSettings`, `copilotToolIds`,
slash-command and prompt-syntax compat helpers). They register nothing and gate
nothing; they are naming/identity debt for a later S1 follow-up.

Run `bun scripts/prepare-desktop.ts` before the pinned Code-OSS package task;
`bun scripts/build-cedia.ts --portable --desktop` also applies this patch and the
tracked Cedia extension/icon overlay. The script verifies base and patch digest,
accepts an already-applied patch, and refuses a conflicting checkout.

Then build `vscode-darwin-arm64-min` from `desktop` with the installed Node 24
runtime, followed by `CEDIA_HOST_NODE=/absolute/path/to/node bun run package:mac`.
The latter replaces the generated Cedia extension, copies the packager's filtered
Tree-sitter WASM assets to their real filesystem lookup path, and locally ad-hoc
signs the app. This is not Developer ID signing or notarization.
