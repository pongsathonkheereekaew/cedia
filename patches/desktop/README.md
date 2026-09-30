# Cedia desktop defaults

Base: `ea1912fd6a05b80a56b2ad9b955075211deea521` (retained Cedia Code-OSS fork).

`manifest.json` lists every patch and its digest; `scripts/prepare-desktop.ts`
verifies the base revision and each digest before applying, deletes the
`removals` paths, and writes a `.prepared.json` stamp so a second run over the
same manifest short-circuits. When a later patch overlaps lines an earlier one
added, the per-patch reverse-check cannot decide "already applied" on its own;
the script then proves the whole set by undoing it, in reverse manifest order,
over a mirror of the checkout's touched files and comparing the result with the
pinned base byte for byte. The manifest is the whole patch set — 17 patches
and 19 removals as of 2026-09-24 — and every paragraph below is backed by an
entry in it. The dated notes at the end of this section are the only text about
patches that no longer exist.

## Retired patches

> Retired 2026-09-20: patches `0008`, `0010`, `0015`-`0018`, `0020`-`0026`,
> `0029`, `0031`, `0035`, `0039`, `0042`, `0048`-`0055` are gone (27 files). They all served
> only the native sessions workbench UI, which no window renders since `0056` loads the
> standalone agent bundle instead. `0005` stays: its import trims keep the sessions entries
> compiling against the `removals` list (the gulp build fails without it).

> Retired 2026-09-22 (plan §10 item 56): patches `0011`, `0013`, `0014`, `0040`, `0041`,
> `0043`-`0047` are gone (10 files). They were the native model-picker path — the workbench
> pickers that drew OMP's catalogue through session option groups — and they retire with the
> registration that published those groups (`apps/macos/src/chat-sessions.ts`,
> `omp-language-models.ts`, the `chatSessions`/`chatParticipants` contributions and the
> `chatSessionsProvider`/`chatParticipantPrivate`/`defaultChatParticipant` proposals).
> The same commit cut the permission-picker hunk out of `0033` (the base carries that gate
> upstream now).

> Retired 2026-09-23 (plan §10 item 67): patches `0019`, `0027`, `0028` and `0033` are gone
> (4 files, all leaves: no remaining patch has context that depends on them).
> `0019` flipped one setting default (`chat.agentSessions.customizationEntryPoints`) whose
> only readers are the sessions tree; `0027` renamed the editor group's `+` in a
> sessions-window branch; `0028` inlined React into the workbench client bundles for native
> sessions surfaces that no longer exist; `0033` scoped three Copilot-flavored composer
> controls out of the sessions window. Each of them was observable only in the native
> sessions workbench: `0019`'s default is read by the sessions tree, `0027`'s branch and
> `0033`'s gates fire only where `isSessionsWindow` is true, and `0028` inlined React for
> the sessions React surfaces that retired with `0021`. No window renders that workbench
> since `0056` points the sessions window at the Cedia agent bundle, and none of the four
> is a prerequisite for another patch.

> Retired earlier: `0002` (the menu-bar trim keyed on `cedia.agentsWindow`, replaced by the
> base's own Agents-window menu set) and `0004` (the Cedia "Open Agents" route, inverted
> when `workbench.action.openAgentsWindow` became the route again). Both were gone before
> the 2026-09-20 cut.

## The patches

`0001-cedia-startup-defaults.patch` changes only initial settings: disable upstream
AI surfaces (`chat.disableAIFeatures`), start without the VS Code welcome editor
(`workbench.startupEditor: none`), and disable experimental Copilot onboarding
(`workbench.welcomePage.experimentalOnboarding`). These remain settings, not policy
overrides. The Cedia task extension supplies the shell, including a non-executing
Restricted Mode surface. Workspace trust enforcement remains enabled.

`0003-cedia-agents-window-proposals.patch` is Cedia's product identity for the
Agents window. It renames the product (`nameShort`/`nameLong`, `applicationName`,
`dataFolderName`, `darwinBundleIdentifier`, `urlProtocol` and the Windows registry
identities go from Caret to Cedia), allows the built-in `cedia.cedia` extension to use
the proposed `chatProvider` and `chatParticipantAdditions` APIs (the
`chatSessionsProvider`, `chatParticipantPrivate` and `defaultChatParticipant` rows
retired with item 56), lists `cedia.cedia` in `sessionsWindowAllowedExtensions`, and
removes the Copilot product identity — the whole `defaultChatAgent` block, the Copilot
entries in `trustedExtensionAuthAccess`, and `GitHub.copilot-chat` from
`builtInExtensionsEnabledWithAutoUpdates`. After this patch `product.json` contains no
Copilot references, which is why `0009` makes every reader of `defaultChatAgent`
tolerate its absence. It has no effect until the next Code-OSS build.

`0005-cedia-remove-copilot-sessions.patch` stops the sessions workbench (the
Agents window) from loading the Copilot chat session provider in both the desktop
and web entry points, and drops the mobile config-picker imports that lived beside
it. After this patch nothing imports `copilotChatSessions.contribution.js`, so the
window no longer offers `Session Type: Copilot`. The Copilot harness directories are
still on disk at this step — removing the registration before deleting the code keeps
every intermediate tree buildable.

`0006-cedia-unwire-agent-harnesses.patch` removes the agent-harness registrations
themselves: no Copilot/Claude/Codex provider is registered in `agentHostMain` or
`agentHostServerMain`, `providerConfigurations` is empty, and the Copilot BYOK
proxy, Claude/Codex proxy services, pending-edit content provider and the Copilot
API service wiring in `agentHostServices`/`agentHostBootstrap` are gone. Verified
with `npm run typecheck-client` (0 errors) and the import resolver check. The
harness directories are still on disk; the `removals` list deletes them.

`0007-cedia-drop-harness-pickers.patch` removes the last production references to
the Copilot harness. `sessionPluginBundler.ts` declares the discovery shape it used
to import from the Copilot module (the bundler was that module's only consumer), and
`remoteAgentHost.contribution.ts` drops the side-effect import of
`agentHostAgentPicker.js`, one of the `removals` paths, so the sessions entries
compile against a tree where the picker no longer exists.

`0009-cedia-no-default-chat-agent.patch` makes the base tolerate the product that
`0003` produced. Six files read `product.defaultChatAgent` without a fallback and
would throw or misreport once it is gone: the extension-management service that
pack-protects the default agent's extension, the gallery service that deprecates and
auto-migrates Copilot Chat, the chat widget's anonymous sign-in notice, the
extensions workbench service's pack-uninstall path, the Copilot-flavored onboarding
variation (which `assertDefined` at import time, taking the whole workbench down),
and `defaultAccount.ts` (the account service opens its init barrier and the provider
contribution returns early, so account reads resolve to "signed out" instead of
blocking). No reader of `defaultChatAgent` is left unguarded.

`0012-cedia-remove-copilot-status-entry.patch` stops registering
`ChatStatusBarEntry` in `chat.shared.contribution.ts`. The Copilot quota/sign-in
status entry has no backend here (OMP is the only harness) and would front a dead
"Copilot status" button, so it stays unregistered in both windows; model state
surfaces through the OMP-backed composer picker instead.

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

`0036-cedia-sash-accessible-name.patch` adds one optional field to
`ISashOptions` in `src/vs/base/browser/ui/sash/sash.ts`: `ariaLabel`. When a caller
sets it, the sash element becomes `role="separator"` with `aria-orientation` and
that label; when it is omitted the sash is byte-for-byte the base sash, so the
workbench does not grow unnamed separators in every split view at once. It is an
opt-in API: no caller passes `ariaLabel` today (the two boundaries that need a name
get theirs from `0037`, which labels the grid's own sash elements), and the file is
otherwise untouched so the base's sash behaviour is unchanged.

`0037-cedia-parts-splitter-names.patch` gives the sidebar and panel boundaries the
accessible names the reference uses (`Resize sidebar`, `Resize panel`). It adds
`Layout.namePartSplitters()` to `src/vs/workbench/browser/layout.ts`, called once
after the grid is built and again whenever a part's visibility changes (a hidden part
takes its boundary with it). The grid creates the sash elements and keeps no handle to
them, so a sash is matched to the part it bounds by geometry rather than by identity;
sashes that bound neither part are left unnamed.

`0056-cedia-agent-window.patch` is the topology patch: it decides what the Agents
window *is*. Cedia keeps the base's native sessions window — its profile, workspace
identity, restore state, single-instance and close/quit lifecycle — but replaces the
renderer it loads. `windowImpl.ts` points `isSessionsWindow` at
`vs/cedia/agent/index.html` (the Cedia bundle built from `apps/macos/agent-window`)
instead of the sessions workbench HTML, and the bundle reports `vscode:workbenchLoaded`
so the window still reaches READY. `app.ts` loads the bundled bridge from
`out/vs/cedia/agent/main.cjs` before the first window opens and hands it the host
services it may use — an `authorize` predicate, `pickFolder`, `openIde` and
`openExternal`, plus the app root, its own pid, the state directory and the product
version. Each call is authorized against the window registry (the sender must be the
registered sessions window's main frame), `openIde` reuses an IDE window already
showing that folder or forces a new one, and the bridge is optional at runtime so a
source checkout without the bundle still starts.
`windowsMainService.openAgentsWindow` reuses the one agent window instead of opening
another, and the last hunk makes an explicit-path launch keep Code-OSS rules while a
plain launch starts in the agent window. Everything a Cedia window renders, and every
native capability it has, is decided here.

`0057-cedia-browser-navigation-owner.patch` hands in-page navigation of the agent
window's browser view to the Cedia bridge. `app.ts` asks the bundle for
`isCediaAgentBrowserWebContents(contents)` and treats its answer like the base treats
its own integrated browser views in the `will-navigate` handler, so the window's
embedded browser can navigate while every other renderer keeps the base's
navigation guard. The bridge is optional (the call is optional-chained), so a checkout
without the bundle behaves exactly as before.

`0058-cedia-agent-zoom-and-traffic-lights.patch` adds the agent window's zoom and
its macOS chrome geometry. The bridge gains `getZoomFactor`/`zoom` (clamped zoom
levels, persisted through `notifyZoomLevel` so a reset stays at 100% even when the
IDE's global default is customized, and echoed back to the renderer as
`vscode:cediaZoomFactor`), and a new file `src/vs/platform/window/electron-main/cediaAgentChrome.ts`
derives the traffic-light position from the header height in `Synara`'s
`desktopChrome.ts`, scaled by the zoom factor. `windowImpl.ts` applies that position
when it creates a sessions window and whenever the zoom level is notified. The
traffic-light call is feature-detected, so non-macOS shells are unaffected.

`0059-cedia-single-ide-agent.patch` makes Cedia's one OMP agent the only chat entry
point in the IDE window, keyed on `product.nameShort === 'Cedia'`: the base Agents view
is never contributed (`when: ContextKeyExpr.false()`), and the three "open chat"
actions (`workbench.action.chat.open`, and the two new-chat entry points) route to
`cedia.openComposer`/`cedia.newTask` instead of the base chat widget. Other products
built from this fork keep the base behavior.

`0060-cedia-app-lifecycle.patch` gives Cedia one application lifetime owner. It calls
the agent bundle's `installCediaMainProcessLifecycle` from the same place `0056`
loads the bridge, and that module (a) joins the host's owner-authenticated quit into
`lifecycleMainService.onWillShutdown`, so the host stops, its running tasks pause and
its durable `stopped` receipt is written before the process exits instead of leaving a
detached execution daemon behind, and (b) registers the packaged build as a macOS
login item. The same patch reads the bundle's `shouldOpenFirstWindow` decision in
`openFirstWindow`: a packaged login launch starts in the background - the host may
run, but no work window opens and no task replays - while a CLI launch, `--agents`,
a folder/file argument, a URL or a protocol link always opens its window. The bundle
call is optional and the whole block is inside a try/catch, so a checkout without the
bundle, or a bundle that predates this export, starts exactly as before.

`0061-cedia-chat-action-returns.patch` repairs two return paths `0059` introduced in
`chatActions.ts`: `if (product.nameShort === 'Cedia') return accessor.get(ICommandService)
.executeCommand(...)` returned a value from some branches of an `async run()` that returns
nothing on every other branch, which is `TS7030` under `noImplicitReturns`. The Cedia
branch now awaits the command and returns. `0059` stays as history; this patch is appended
so the reviewed set is what the checkout contains and `npm run typecheck-client` is clean
again (measured 2026-09-24: 0 errors over `desktop/src`).

`0062-cedia-quit-decision.patch` makes a deliberate Quit cancellable, which the pinned
base does not support: `ILifecycleMainService.onBeforeShutdown` fires only after the
quit is already recorded, so nothing on the main-process side could offer
Stop-and-quit/Cancel before windows started closing (plan §2.7). The service gains
`registerQuitDecider(decider)`, called from the same `before-quit` listener before
`_quitRequested` is set and before `onBeforeShutdown` fires: a decider that answers
`false` leaves the lifecycle exactly as it was - no window closes, no shutdown starts,
and the next Quit asks again - while `true` lets that same quit continue. `app.ts`
passes the service to the bundle's `installCediaMainProcessLifecycle`, which registers
Cedia's decider; without the bundle the service behaves exactly as upstream.

## Removals

`manifest.json` also carries a `removals` list: whole trees and files Cedia does
not ship (the `copilot`/`claude`/`codex` harness directories, the agent-host test
tree, the Copilot chat-session provider, the Copilot-schema picker files, and
Cedia's own retired `src/vs/workbench/contrib/agentWorkbench/` island). They are
deleted by `prepare-desktop.ts` instead of living in a multi-megabyte deletion
patch, so the list stays reviewable and every path is still tracked. Restoring the
pinned checkout and re-running `bun scripts/prepare-desktop.ts` reproduces the
Copilot-free tree; that state passes `npm run typecheck-client` with 0 errors.

## Copilot-named helper files (measured 2026-09-23)

Criterion: files whose *name* matches Copilot (case-insensitive) under `desktop/src`,
after the `removals` list has been applied — the deleted harness trees are not counted.
That is **17 files: 13 non-test and 4 test files** (the test files are
`copilotManagedSettings.test.ts`, `agentHostCopilotCliSettingsContribution.test.ts`,
`copilotConfigSlashSubmitHandler.test.ts` and `copilotCliEventsUri.test.ts`).

The 13 non-test files are 11 TypeScript modules plus one type declaration
(`src/typings/copilot-api.d.ts`) and one spec document
(`src/vs/sessions/copilot-customizations-spec.md`); those two have no importer. The
module's name in parentheses is the number of files that mention it (tests included),
and none of them registers a contribution, service, action or configuration from its
own file:

- `agentHost/common/copilotCliConfig.ts` (13), `copilotConfigSlashCommands.ts` (2),
  `copilotHome.ts` (8), `agentHost/node/shared/copilotApiService.ts` (9) — the harness
  config, slash-command and API layer that outlived its harness.
- `policy/common/copilotManagedSettings.ts` (35) — managed-settings keys and the
  channel that resolves them.
- `workbench/contrib/chat/browser/copilotCliEventsUri.ts` (19),
  `common/tools/copilotToolIds.ts` (2), `common/promptSyntax/hookCopilotCliCompat.ts` (2),
  `agentSessions/agentHost/copilotConfigSlashSubmitHandler.ts` (4) and its sessions
  twin `sessions/contrib/chat/browser/copilotConfigSlashSubmitHandler.ts` (4) —
  Copilot CLI naming that other code still refers to by identity.
- `agentSessions/agentHost/agentHostCopilotCliSettingsContribution.ts` (3) — the one
  file here whose class actually runs: an aggregator registers it as a workbench
  contribution (`agentHost.contribution.ts` in the IDE window, and
  `sessions/contrib/providers/agentHost/browser/localAgentHost.contribution.ts` in the
  sessions tree), so it is instantiated. It is a settings surface, not a gate, and it
  registers nothing itself.

They are naming/identity debt, not dead code: renaming them is rebase churn that buys
nothing, and the files that die with the agent host leave with it. Re-count before any
rename pass (plan §10 item 26 states the same debt and the same decision; item 67(c)
owes the number).

Run `bun scripts/prepare-desktop.ts` before the pinned Code-OSS package task;
`bun scripts/build-cedia.ts --portable --desktop` also applies this patch and the
tracked Cedia extension/icon overlay. The script verifies base and patch digest,
accepts an already-applied patch, and refuses a conflicting checkout.

Then build `vscode-darwin-arm64-min` from `desktop` with the installed Node 24
runtime, followed by `CEDIA_HOST_NODE=/absolute/path/to/node bun run package:mac`.
The latter replaces the generated Cedia extension, copies the packager's filtered
Tree-sitter WASM assets to their real filesystem lookup path, and locally ad-hoc
signs the app. This is not Developer ID signing or notarization.
