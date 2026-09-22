# CEDIA — SSOT plan

This is the **single authoritative plan and spec** for the CEDIA project. Every other plan,
spec, brief or handoff that ever existed has been deleted from this repository. If the plan
changes, this file changes; there is no second owner of truth anywhere in the tree.

- Revision: 2026-09-16 (English-only rewrite; all superseded documents removed).
- Revision: 2026-09-20 (CEDIA rewrite: owned product, Cursor retired as authority; file renamed CARET-PLAN.md -> CEDIA-PLAN.md).
- Revision: 2026-09-20 (CEDIA rename landed: identifiers, patches, product.json identity, rebuilt runtimes; §6.1 stamp).
- Revision: 2026-09-20 (checkout moved to `/Users/pond/cedia`; packaged `Cedia.app` verified).
- Revision: 2026-09-22 (**two-window spec locked** from the owner's decisions: §3.A IDE contract +
  §3.B agent contract; one theme authority, one chrome policy, status bar in both windows, host
  PTY/git as single implementations, five-way convergence; §10 items 54-67 carry the execution;
  §2 and §6 corrected to the post-`0056` topology).
- Repository: `/Users/pond/cedia` on branch `main`. Layout is one repo; `apps/*` and
  `packages/*` are module boundaries, not remotes.
- Language rule: **every document in this repository is written in English.** No `.th.md`
  files, no mixed-language sections. This keeps a new session able to read the whole plan
  without translation cost and removes the ambiguity of two parallel names for one artifact.
  User-facing product copy may still be localized; documentation may not.
- Section order in this file is stable and intended: read §0 forward. Section numbers are
  identifiers and never reorder.

Read order for a new session:

1. [`AGENTS.md`](../../AGENTS.md) — project rules and invariants, applied every turn.
2. This file — §0 for the definition, §6 for the SSOT split, §8 for the plan, §10 for what is
   open right now.
3. `docs/maintenance/evidence/<receipt>/` — the runtime receipts this plan cites.

---

## 0. Product definition

**CEDIA is an owned Agentic-IDE forked from Code-OSS: the most universal and versatile
workspace for coding tasks and projects.**

- CEDIA defines its own product spec — surfaces, interaction, architecture, visual design —
  on top of the Code-OSS base it forks. It copies no other product's spec.
- The harness is **OMP and only OMP**. Brand, icons and product name are CEDIA's. CEDIA ships
  no Tab engine, no cloud agents and no private models.
- References: **Code-OSS** for the editor base; **OMP** for execution, transcript and the
  agent surfaces (plan / goal / subagent / MCP / approval schema / queue).
- The product target is the OMP+IDE surface class: composer, models, MCP, review, terminal,
  browser, mobile continue.

## 1. Reference precedence

| Layer | Reference |
|---|---|
| Product, surfaces, interaction, window chrome, colour / geometry / motion | **CEDIA workspace contract** (§3 measurements as data, §5 decisions, §10 for what is open) |
| Behaviour only OMP has (plan / goal / subagent / MCP / approval schema / queue) | OMP contract |
| Execution and transcript ownership | **OMP** — one owner, never a second |

When the layers disagree, the CEDIA workspace contract wins — and appearance always uses
CEDIA's token layer (§3.3).

## 2. Architecture

```
CEDIA.app  (Code-OSS fork, CEDIA brand, pinned ea1912fd…)
├─ Agents window   ← the base's window identity (profile/restore/close lifecycle);
│      renderer = the standalone Cedia agent bundle (`vs/cedia/agent/index.html`, patch 0056)
│      sidebar (New thread · Search · Projects) · composer · slim status bar
│      right dock (Changes / Browser / Terminal / Files / Git / Device)
├─ IDE window      ← the normal workbench (Explorer / editor / LSP / debug / terminal)
│      dock `cediaComposerDock` = the same bundle in compact form (`agent-ui/ide.html`)
└─ one CEDIA host  ← lifecycle · journal · artifacts · relay · devices · git · PTY terminals
        │
   OMP — the only harness, owner of execution + transcript
```

Rules:

1. The Agents surface is a **native window of the base** — window identity, profile, restore
   state and close/quit lifecycle are Code-OSS's — and since patch `0056` that window renders
   the **standalone Cedia agent bundle** (`vs/cedia/agent/index.html`) instead of
   `sessions.html`; the main-process bridge is `registerCediaAgentWindowBridge`
   (`patches/desktop/0056`, `apps/macos/src/agent-window-main.ts`). Window chrome policy
   (menus, zoom, traffic lights, status bar) is owned by one main-process module for both
   windows (§3.A/§3.B; §10 item 55).
2. Both windows render **one agent surface**: the same bundle (`index.html` standalone,
   `ide.html` in the IDE dock). Its adapter (`apps/macos/agent-window/src/cedia-adapter.ts`)
   reads sessions/composer/transcript from the host `/v1` API, and OMP answers the host. The
   extension's native `chatSessionsProvider` surface has no renderer left since `0056` and
   retires with §10 item 56.
3. **OMP is the only harness.** Registering or using `copilot` / `claude` / `codex` harnesses is
   forbidden, as is wiring GitHub Copilot auth, sign-in or BYOK. The base's
   `src/vs/platform/agentHost/**` is Copilot-bound and serves only as a shape reference.
4. The IDE window: Code-OSS owns buffers, undo, LSP, debug and extensions.
5. The host owns lifecycle, journal, artifacts, relay and devices. The iPhone client is a
   projection of the same session, never a second owner.
6. OMP owns execution and transcript. The UI never creates a second agent loop.

## 3. Workspace surface contract (two windows: §3.A and §3.B are the contract)

> **Locked 2026-09-22.** CEDIA owns its spec. **§3.A (IDE window)** and **§3.B (agent
> window)** below are the contract; every other block in §3 (the retired Cursor capture,
> §3.1–§3.3 measurements, §3.4–§3.5) is **input data** — values and history CEDIA keeps,
> never an authority to re-measure against. Synara is the agent window's *composition*
> reference only (§3.4); the palette is CEDIA's in both windows. The owner's decisions
> locked in this pass — do not re-derive them:
>
> 1. IDE authority = a CEDIA-owned spec (Cursor measurements demoted to input data).
> 2. Agent scope = render everything OMP/host backs with real data (§3.B scope rule).
> 3. Theme = one authority: `workbench.colorTheme`; the agent window has no theme settings
>    of its own and follows the IDE.
> 4. Window chrome = one main-process policy module for both windows.
> 5. Status bar = present in **both** windows.
> 6. Terminal = agent terminals are one host-PTY registry rendered by the bundle in both
>    windows; the workbench integrated terminal stays the user's private dev shell (§5).
> 7. Git = the host git service is the single implementation behind every Cedia git
>    surface; the stock SCM view stays as an upstream feature (§5).
> 8. Converge to one line each: model picker, project creation, terminal, git, keybindings.
> 9. The IDE dock is the compact form of the agent bundle — one surface spec, responsive
>    rules only (§3.A dock row).

### 3.A IDE window contract

| Region | Element | Contract (v1) | Backed by |
|---|---|---|---|
| Window | identity | normal Code-OSS workbench; invariant: chrome darker than editor (`#141414` < `#181818` dark, `#F3F3F3` < `#FCFCFC` light) | `apps/macos/src/cedia-theme.ts` + `cedia-theme.test.ts` (§11 gate 1) |
| Window | menu set | full workbench menus | Code-OSS |
| Window | status bar | present; carries `cedia.showAgents` plus host/model/session status entries | extension status bar |
| Window | chrome policy | zoom, traffic lights, title bar and menu policy come from one main-process module shared with the agent window | §10 item 55 |
| Layout | workbench parts | Explorer / editor / panel / debug as Code-OSS; both splitters carry accessible names | patches `0036`/`0037` |
| Dock | `cediaComposerDock` | **compact form of §3.B's surface**: same bundle (`agent-ui/ide.html`), routes, components and tokens; responsive rules only (thread sidebar hidden via `isIdeEmbeddedRuntime`, header compact <700px, tour insets collapse). No second chat UI; the webview task shell must be gone (§10 items 10, 63) | `agent-ide-webview.ts` + `ide-bootstrap.ts` |
| Dock/inline | selection actions, inline edit, focus/prefill handoffs | reach the host through the guarded `sendCommand` path; a refusal is shown as a warning, never silent | §10 item 63 |
| Models | selection state of record | one state: `GET /v1/models` → session `set_model` (+ `set_thinking_level`); the control drawn anywhere is the bundle's picker | §10 item 56 (retires the workbench LM-picker path) |
| Projects | creation flow | one flow: host `POST /v1/projects` (+ `/v1/workspace-suggestion`); IDE entry points register through it when a Cedia surface needs the project | §10 item 59 |
| Terminal | integrated terminal | the user's private dev shell: upstream workbench behaviour, xterm.js, not an agent surface | §5 (terminal-roles row) |
| Git | SCM view | stock upstream feature, kept; not a Cedia surface | §5 |
| Keybindings | system | one system: `Cedia/User/keybindings.json`, owned by the workbench; Cedia bindings are `when`-scoped per `backlog/command-map.md` | §10 item 57 |
| Theme | authority | `workbench.colorTheme` → `cedia-theme.ts` palette; follows the OS like the reference | §11 gate 1 |

### 3.B Agent window contract

Renderer: the standalone bundle (`vs/cedia/agent/index.html`) in the base's sessions-window
identity (patch `0056`); composition = Synara (MIT, vendored, **presentation only** — data
always flows through the adapter): layout, elements, geometry, surface typography and motion
come from the port (§3.4 owner decision, 2026-09-19). **Palette = Cedia's own**: every colour,
including type colour, comes from the same token authority as §3.A and follows the IDE theme
(decision 3; execution = §10 item 54). Cedia-authored chrome in this window (status bar,
handoff controls) uses CEDIA's type and motion scales (§3.3–§3.4).

**Scope rule (owner, 2026-09-22: "build everything OMP has and supports").** A surface renders
**iff** OMP or the host backs it with real data. Otherwise it is absent, or a §4
honest-unavailable row (disabled + reason) when the entry itself is product intent.
`list → []` fakes and `unsupported()` behind a live-looking control are defects (§11 gate 4).

| Region | Element | Contract (v1) | Status |
|---|---|---|---|
| Sidebar | Search (⌘K / ⇧⌘P), New thread, Projects + Add project | rows over host projects/sessions | backed — keep |
| Sidebar | Automations | honest-unavailable row (disabled + reason) until a host automation backend exists; route not offered before then | §4 row |
| Sidebar | Kanban, Pull requests, Plugins, Studio, Spaces | **cut** — no OMP/host source | §10 item 60 |
| Header | IDE, Environment, chat actions | handoff `openIde {cwd, path, line}`; Environment rows only where backed | backed |
| Environment panel | top-right card opened from the title-bar `Environment` control | rows only where backed (Changes · Local · branch · Repository · Open in IDE); a row with no source stays absent (§9 rule) | backed — keep |
| Status bar | slim bottom bar (new) | bundle-drawn: host state · model · session status · branch, painted with `statusBar.*` tokens | §10 item 55 |
| Composer | input, send/steer/queue/abort by state, voice | host commands; state machine honest | backed |
| Composer | attachments | images reach OMP (`images[]` on `prompt`); other references become a labelled attached-context block — the payload the native path already proved (§10 item 34) | §10 item 61 |
| Composer | mentions | `/` = real skill/slash list from `get_available_commands`; `@` = file/workspace refs → attached context | §10 items 61/62 |
| Composer | model + effort | one picker component: host catalogue, provider tabs, stars, effort ladder → `set_model` / `set_thinking_level` | backed — keep |
| Transcript | messages, tool cards, approvals/questions, presentations, edit + rewind (tail; any-message = §10 1b) | host journal projection + `uiRequests` | backed — keep |
| Right dock | Changes · Browser · Terminal · Files · Git · Device · Sidechat | each pane on its host bridge; Git on the host git service incl. the currently-throwing actions (item 58); Sidechat = OMP fork; Changes shows the working-tree diff today, turn diffs pending §10 1c/35 | backed (Git = item 58; turn diffs = §10 1c/35) |
| Settings | General, Chat behavior, Archived, Models & writing, OMP Providers, Conversation storage | only these render as live sections; Appearance = read-only "following the IDE theme" status (no packs, no mode picker) | backed; Appearance per §10 item 54 |
| Settings | Skills, MCP connections | render only when their capability is real (§10 items 62/43); until then hidden or disabled + reason | pending |
| Settings | AppSnap, Safari vault, Profile stats, Usage, Worktrees; keybinding *editing* until item 57 | **cut** (the keybindings section may show read-only shortcuts from the real file) | §10 items 60/57 |
| Onboarding | welcome → tour → project → done (OMP-only card) + the gateway card (external MCP pairing, kept per §9) | as landed 2026-09-20; the gateway card's MCP capability tracks §10 item 43 | backed; gateway = pending (item 43) |
| Local-only UI | task-completion toasts · split view · draft persistence | renderer-local state, no host dependency; the draft-lifecycle defect stays §10 1d | backed — keep |
| Feedback / What's New | — | the feedback endpoint is cut (no third-party POST); release history = a Cedia changelog or cut | §10 item 60 |
| Theme | appearance | no theme settings in this window; follows `workbench.colorTheme`; pack editor and packs cut | §10 item 54 |
| Shortcuts | sheet + editing | reads and writes the real `keybindings.json` through the extension bridge; no second chord vocabulary | §10 item 57 |

Acceptance for both windows: §11 gates 1–4, with geometry/colour measured from the real DOM or
compositor (gate 2) and the scope rule above as the honesty test (gate 4).

**Input data (not the contract):** the retired Cursor capture and tables that follow, §3.1–§3.3
measurements, and §3.4–§3.5 history.

```text
Cursor Agents (window)
├─ Title bar: close / minimize / fullscreen; no editor tab, no editor title actions
├─ Sidebar (single column)
│  ├─ Hide Sidebar · Go Back · Go Forward
│  ├─ New Chat ⌘N · Search ⌘K · Automations · Customize
│  ├─ Projects (+ New Project)
│  ├─ Repositories (+ Customize Sidebar, Open Workspace)
│  ├─ session rows: grouped by project, row = state + name + relative time
│  ├─ Getting Started card (Skip step, Connect Slack)
│  └─ Account menu · Settings
├─ Main
│  ├─ Header: IDE · Chat actions · Show Apps
│  ├─ Session transcript (when there is work)
│  └─ Composer: project popup · branch combo · environment ("This Mac") ·
│              input (placeholder "Plan, Build, / for skills, @ for context") ·
│              toolbar: Add agents/context/tools · reasoning popup · voice input · Send
├─ Recommendation rows (Dismiss where present): Plan New Idea ⇧Tab · Multitask ·
│  Run in Cloud · Build from a design · Deploy my prototype · Start with a plan · Debug an issue
└─ Notifications (alt+T)
```

| Region | Element | Behaviour to match |
|---|---|---|
| Window | menu bar | the Agents window's menu set: `Cedia · File · Edit · View · Window · Help` (no Selection/Go/Run/Terminal) |
| Sidebar | New Chat / Search | shortcut hints that actually resolve; Search opens search, it is not a permanent field |
| Sidebar | Automations / Customize | entry points to real product capability |
| Sidebar | Projects + New Project | separate from Repositories |
| Sidebar | Repositories + Customize Sidebar / Open Workspace | manage repo groups and open a workspace |
| Sidebar | session rows | state + name + relative time, grouped by project |
| Sidebar | recommendation card | dismissible/skippable, never permanently stuck |
| Sidebar | Account + Settings | entry points to account and settings |
| Header | IDE | switches to the editor window (a different window) |
| Header | Chat actions / Show Apps | task context menu and apps entry |
| Composer | project / branch / environment | name the real workspace per task before sending |
| Composer | input + IME | same placeholder; Enter sends, Shift+Enter newline |
| Composer | toolbar | agents/context/tools, reasoning, voice input, send/stop by state |
| Recommendation rows | idea rows + Dismiss | create a draft from the text; dismiss per row |
| Panels | Changes · Files · Browser · Terminal · preview/artifacts | per task, carrying workspace identity |

### 3.1 Measured values (light theme, empty draft, 1710×1073, default zoom)

| Element | Measured | Note |
|---|---|---|
| Sidebar width | 255px | there is a "Resize sidebar" splitter, so it is adjustable, not constant |
| Sidebar row inset | 8px left/right | the selected row's fill spans x8..246 |
| Sidebar row box | 30px | token `--ui-sidebar-menu-button-min-height` = 28px → **token and rendered box disagree**; trust the rendered value |
| Sidebar row pitch | ~30.7px | measured from text-row spacing |
| Sidebar row fill (selected) | `rgb(223,224,225)` on chrome `rgb(236,237,238)` | — |
| Composer card (empty draft) | **608 × 106px** including a 1px border, centred in the main pane | x679..1286, y506..611 · 423px margin each side |
| Composer card border | 1px `rgb(234,234,234)` | all four sides |
| Composer card fill | `#FCFCFC` = `editor.background` = **lighter than the page behind it** | token: `--prompt-input-container-bg` = `--cursor-bg-input-surface` = `color-mix(in srgb, var(--cursor-base) 6%, transparent)` |
| Composer shadow | none | token `--prompt-input-container-shadow: none`; never add elevation |
| Composer radius / editor | radius 18 (`radius-4xl`) · editor min-height 36 (`spacing-9`) | matches `--prompt-input-border-radius-expanded` / `--prompt-input-editor-min-height` |
| Idea rows (empty state) | 4 rows below the card, occupying y624..793 (~42px/row) | separator inset 12px from the card edge; mode pills sit below the card |
| Type scale the agent CSS actually uses | 11/12/13/14 (tokens) **plus 16/17/18/20px classes** | `.ui-osj86m{font-size:18px}` → an 18px heading is not outside Cursor's own scale |
| Motion | instant/fast/normal/slow = 50/100/150/200ms · `--cursor-easing-out-cubic` = `cubic-bezier(0.215, 0.61, 0.355, 1)` | values declared in the bundle (real animation timing not yet observed) |

**Colour measurement rule (read this before chasing ghosts).** Cursor's chrome and chat
surfaces are **translucent (glass)**, not opaque. `screencapture -l <windowID>` composites them
against a transparent backdrop and reads roughly 7 units darker (chrome reads
`rgb(236,237,238)`) while a full-screen capture of the same display reads `rgb(250,250,251)`.
In one full-screen capture containing both apps, Cursor's sidebar and Cedia's read identically.
The ~7-unit delta is a **capture artefact, not a product difference**. To close §11 gate 2, use a
full-screen capture containing both apps, or treat the theme file as the base and verify against
a full-screen capture. Never compare colours with `screencapture -l` alone.

### 3.2 AX correction pass (2026-09-14)

§3's tree and table above were summarised from an earlier pass. This pass pulled the
**accessibility tree of the running `Cursor Agents` window** (Computer Use → `@oai/sky`; raw dump
at [`evidence/cursor-agents-ax-2026-09-14/cursor-agents-ax-tree.txt`](evidence/cursor-agents-ax-2026-09-14/cursor-agents-ax-tree.txt))
and found the following corrections. Where they disagree with §3, **these win**:

- **No in-window menu bar**: `Cursor | File | Edit | View | Window | Help` is the macOS menu bar
  (an AX sibling of the window), not drawn in the window, and there is **no title bar band** —
  the traffic lights float over the sidebar itself.
- **The right side is one panel, not a list of panels**: `Panel editor-panel-group` is headed by
  `Tabs` + an `Open new tab menu` button + `Enter Full Screen` + `Hide Apps`, with
  `Changes · Browser · Terminal · File` laid out as tab-strip entries. `Show Apps` / `Hide Apps`
  toggles this panel (storage key `cursor/glass.rightPane`) and it is about 608px wide — the same
  as the composer.
- **The empty composer has no Send button**: the toolbar holds only `Add agents, context, tools` ▾,
  `High` ▾ (reasoning) and `Start voice input`; the row above is the project popup + branch combo
  (`main`) + `This Mac`.
- **Recommendation rows carry subtitles and not every row has Dismiss**: `Plan New Idea ⇧Tab` ·
  `Multitask` · `Run in Cloud` (no subtitle) · `Build from a design — Turn a frame into working UI
  in this repo` + Dismiss · `Deploy my prototype — Put it on a live link anyone can open` +
  Dismiss · `Start with a plan — Align on implementation before writing code` · `Debug an issue —
  Find root causes and fix tricky bugs`. `Run in Cloud` denotes a cloud runtime option (it appears
  in Cursor's own source as a label in the Autopilot PR menu), not a full cloud-agent entry point.
- **Real sidebar order**: Hide Sidebar · Go Back (disabled) · Go Forward (disabled) ·
  New Chat ⌘N · Search ⌘K · Automations · Customize · Projects (+ New Project) ·
  Repositories (+ Customize Sidebar ▾, Open Workspace ▾) · sortable project groups ·
  Getting Started card (Skip step n of m, Connect Slack) · Account menu · Settings ·
  `Resize sidebar` splitter. There is **no** `Sessions` label and no pet.
  **Corrected again from a real screenshot (2026-09-15)**: in an actual Agents window screenshot
  (3420×2224) the sidebar ends at `Repositories` + repo rows — **no Getting Started card and no
  Account/Settings row** — while `Go Back/Go Forward` are in the title bar, not the sidebar, and
  the `Repositories` heading has two icons (filter, add) rather than a `Customize Sidebar ▾`.
  The AX list above therefore describes another pass or another state, not this empty home. The
  user chose Cursor's rendering over the spec draft, so both blocks were removed and a test pins
  their absence.
- **Colours read from the real screen (dark)**: chrome/sidebar `rgb(35,35,37)` · main pane
  `rgb(27,27,27)` · composer card `rgb(34,34,34)` (lighter than its background) · right panel
  `rgb(26,26,26)`; the composer is 608 wide and ~107 tall, centred in the main pane at the
  1710×1073 rig (consistent with §3.1, which was measured in light).
- **Still unverified**: running/approval/error states, the dark half of the light-theme pair, and
  real animation timing.

### 3.4 The agent window's UI reference is Synara, under MIT (decided 2026-09-19)

§3.A is the contract for the **IDE window** (the Code-OSS workbench); §3.1-3.3 are its input
data (measured from Cursor 3.20.x, kept as values, not as a target — corrected 2026-09-22). The **agent window** is a deliberate, owner-directed
deviation: its look is the reference app Synara, whose repository
([`Emanuele-web04/synara`](https://github.com/Emanuele-web04/synara)) is **MIT** (Copyright (c) 2026
T3 Tools Inc. and Emanuele Di Pietro; no NOTICE, no extra terms), so its components can be reused
with the copyright and permission notice kept.

What that means for this repository, decided rather than drifted into:

1. **One execution owner stays**: OMP, reached only through `apps/macos`'s extension and the host.
   Synara's own server, provider adapters, contracts and updater are **not** taken. Its UI is a
   React renderer (`apps/web`, Vite) whose components are taken as *presentational* code and fed by a
   Cedia adapter, so no second process can own a session, an approval or a credential.
2. **Two windows with two references**: the IDE window keeps Cursor parity (§3); the agent window
   takes Synara's composition - hero, composer footer, provider-rail model picker with stars,
   environment picker, sidebar sections - and its visual language *inside that window only*, so the
   workbench tokens the rest of the product uses are untouched.
   **Owner clarification, 2026-09-19:** *what* comes from Synara is the UX, the UI, the elements,
   the layout, the model picker and every chat-box element; the **palette** stays Cedia's own - the
   same theme the IDE window uses. So the port copies Synara's composition and structure rather
   than moving its colours onto this window, and the agent window is deliberately not repainted
   with a second palette (the extension clears any it wrote earlier, `apps/macos/src/extension.ts`).
3. **Vendored, not submoduled**: the pieces we need (about 2-3k lines: `ChatComposerFooter.tsx`,
   `ProviderModelPicker.tsx`, `ComposerModelPicker*.tsx`, `ModelStarButton.tsx`,
   `ComposerEnvironmentPicker.tsx`, `ComposerEffortSliderCard.tsx`, `ChatEmptyStateHero.tsx`) are
   copied into a Cedia-owned folder with their original headers, and the MIT notice is added to this
   repository's third-party notices. A submodule would drag in their Effect-based toolchain and
   contracts, which is the second-owner risk this point exists to avoid.
4. **Elements with no data are still left out**: Kanban and Pull requests have no OMP surface, and
   the permission control waits for OMP's `permission` command shape (measured 2026-09-19: the bridge
   has `permission` and `cedia_native_permission`). Both are tracked in §10 rather than faked.

### 3.3 Colour tokens and the parity gate

Two authoritative sources, both recorded in
[`evidence/ui-cursor-parity-lock-2026-09-14/`](evidence/ui-cursor-parity-lock-2026-09-14/):

1. **The theme file Cursor ships** —
   `/Applications/Cursor.app/Contents/Resources/app/extensions/theme-cursor/themes/cursor-dark-color-theme.json`,
   named `Cursor Dark Anysphere v0.0.3`. Values are read from the file, not from a screenshot.
2. **CUA/AX capture of the Cursor Agents window** (1224×768 logical, Cursor 3.20.17, dark) for
   the geometry and IA the theme file does not carry.

Dark palette (from the theme file — authoritative):

| Key | Cursor value | Used in Cedia as |
|---|---|---|
| `editor.background` | `#181818` | `--cedia-bg` (main/transcript) |
| `sideBar/activityBar/statusBar/titleBar/panel/editorWidget/terminal/tabsBackground` | `#141414` | `--cedia-panel` |
| `tab.activeBackground`, `dropdown.background` | `#181818` | raised panel surfaces |
| `foreground` | `#F0F0F0` | `--cedia-text` |
| muted (`statusBar.foreground` 60%) | `#F0F0F099` | `--cedia-muted` |
| `panel.border`/`sideBar.border`/`input.border` | `#F0F0F013` | `--cedia-border`, `--cedia-control-border` |
| `focusBorder` | `#F0F0F026` | `--cedia-focus` |
| `button.background` / `badge.background` | `#81A1C1` / `#88C0D0` | `--cedia-accent` / badge |
| `list.activeSelectionBackground` / `list.hoverBackground` | `#F0F0F01E` / `#F0F0F011` | `--cedia-selected-bg` / `--cedia-hover-bg` |
| `textLink.foreground` | `#81A1C1` | `--cedia-link` |
| `input.background` | `#F0F0F00A` | `--cedia-input` |
| `editor.selectionBackground` / `editor.lineHighlightBackground` | `#40404099` / `#262626` | editor selection/highlight |

**Invariant that must hold:** chrome (`#141414`) is **darker** than the editor/transcript
(`#181818`). This is what separates Cursor from the Code-OSS default (chrome `#191A1B`, lighter
than editor `#121314`). The full mapping lives in `apps/macos/src/cedia-theme.ts`
(`CEDIA_DARK_ANCHORS`, `CEDIA_WORKBENCH_COLORS`).

Light palette (added 2026-09-14 after a runtime check — Cursor on this machine runs in light,
while Cedia was forcing dark chrome over a light workbench, which was a real parity gap; Cursor
ships five themes: `cursor-dark`, `cursor-dark-hc`, `cursor-dark-midnight`, `cursor-light`,
`cursor-light-colorblind`):

| Key | Cursor Light value | Used in Cedia as |
|---|---|---|
| `editor.background` | `#FCFCFC` | `--cedia-bg` |
| `sideBar/activityBar/statusBar/titleBar/panel/editorWidget/terminal/tabsBackground` | `#F3F3F3` | `--cedia-panel` |
| `foreground` | `#141414` | `--cedia-text` |
| `descriptionForeground` | `#141414BD` | `--cedia-muted` |
| `panel.border`/`sideBar.border` | `#14141414` | `--cedia-border` |
| `input.border` | `#14141433` | `--cedia-control-border` |
| `focusBorder` | `#14141433` | `--cedia-focus` |
| `button.background` / hover | `#2778C1` / `#246AAB` | `--cedia-accent` |
| `textLink.foreground` | `#0064B0` | `--cedia-link` |
| `list.activeSelectionBackground` / `list.hoverBackground` | `#14141414` | `--cedia-selected-bg` / `--cedia-hover-bg` |
| `input.background` | `#FCFCFC` | `--cedia-input` |
| `editor.lineHighlightBackground` | `#EAEAEA` | editor highlight |

**Light invariant:** chrome `#F3F3F3` (243) is still **darker** than editor `#FCFCFC` (252) — the
relationship is not inverted. The palette is selected from `window.activeColorTheme.kind` via
`cediaThemeKindFromVscode()` and repainted on `onDidChangeActiveColorTheme`.

**Follow the OS like the reference does:** Cursor sets `window.autoDetectColorScheme`, so its
chrome follows the machine's light/dark setting. Cedia sets it too, but only when the user has
not set it themselves (checked with `globalValue === undefined`, not truthiness, so a deliberate
`false` is never overridden). The `dark-hc`, `light-colorblind` and `midnight` palettes were
added later on 2026-09-14 — see §11 for their status.

**First screen without a folder:** the Agents window can start with no folder open, and then it
cannot write workspace settings. The palette used to be skipped entirely, leaving the first
screen (New task) in engine colours. Fixed by falling back to global scope when there is no
folder, plus `isCediaWorkbenchPalette()` to distinguish the palette Cedia wrote from values the
user set, so Cedia's own footprint is not read back as "the user chose this" and repainting stops.
Verified at runtime: the first screen gets `#F3F3F3` / `#FCFCFC`.

**Agent design tokens of the reference** (measured from the real bundle, 2026-09-14). Cursor ships
its agent-window design system inside `workbench.desktop.main.js` as 405 CSS custom properties
named `--cursor-*`, so Cedia's tokens can be compared directly instead of guessed from a
screenshot:

| Group | Reference token | Value | Cedia | Match |
|---|---|---|---|---|
| font-size | `--cursor-font-size-xs/sm/base/lg` | 11/12/13/14 | `--cedia-font-*` | ✅ |
| line-height | `--cursor-line-height-*` | 14/16/18/22 | `--cedia-lh-*` | ✅ |
| height | `--cursor-height-*` | 20/24/28/32 | `--cedia-height-*` | ✅ |
| radius | `--cursor-radius-xs/sm/base/lg/xl/2xl/3xl/4xl/full` | 2/4/6/8/12/14/16/18/9999 | `--cedia-radius-*` | ✅ |
| control radius | `--cursor-radius-base` | 6 | `--cedia-control-radius` | ✅ |
| composer surface | `--conversation-surface-border-radius` → `radius-xl` | **12** | `--cedia-composer-radius` | changed 10 → **12** |
| conversation type | `--conversation-font-size` → `font-size-lg` | 14 | `--cedia-font-lg` (transcript body) | ✅ |
| focus ring (dark) | `--cursor-stroke-focused` = `--cursor-focus` 15% | `#F0F0F026` | palette `focusBorder` | ✅ exact |
| spacing | `--cursor-spacing-1/1-5/2/2-5/3/4…` | 4,6,8,10,12,16,20,24,28,32,40,44,48 | `--cedia-space-*` | ✅ (Cedia names by px, reference by step) |
| duration | `--cursor-duration-instant/fast/normal/slow` | 50/100/150/200 | `--cedia-motion-*` | corrected to match |
| easing | `--cursor-easing-out-cubic` | `cubic-bezier(0.215, 0.61, 0.355, 1)` | `--cedia-motion-curve` | corrected to match |

**Motion correction (fixing a regression from the previous pass):** an earlier pass changed the
motion tokens to equal `DEFAULT_MOTION_TOKENS` in `ui-a11y.ts` so the two sources agreed
(instant 0, drawer 180/120, curve `cubic-bezier(.2,0,0,1)`) — but that set is **not** the
reference's. The reference values are instant 50, feedback 100, surfaceIn 150, surfaceOut 100,
drawerIn 200, drawerOut 150, curve `cubic-bezier(0.215,0.61,0.355,1)` (`--cursor-easing-out-cubic`).
Both `ui-a11y.ts` and the CSS fallbacks in `webview.ts` were corrected to the reference values.
`--cursor-easing-out-quint` (`cubic-bezier(0.16,1,0.3,1)`) is kept as `MOTION_CURVE_STRONG` for
a future emphasis transition, with no unused CSS. D15's intent still holds (mode switch commits
at 0ms, reduced-motion zeroes durations, no decorative motion); use this table for the numbers.

**Agent surface colour (checked 2026-09-14 — confirmed no change needed):** the reference sets
`--cursor-sidebar` = `--cursor-editor` = `#181818` and `--cursor-chrome` = `#141414` in dark,
which looks like the agent sidebar should be `#181818` (lighter than Cedia's). But the code that
actually paints the surface reads
`r.style.background = "var(--glass-chat-surface-background, var(--cursor-bg-chrome))"` — i.e.
**`--cursor-bg-chrome` = `#141414`**, the same as the `sideBar.background` Cedia uses.
`--cursor-sidebar` has no consumer that paints the chat surface. Cedia therefore keeps its current
value, and this question is closed.

**Inactive/unfocused state (fixed 2026-09-14):** the reference theme does not declare
`statusBar.inactiveBackground`, so its status bar keeps its colour when the window is unfocused —
but the engine Cedia pins ships its own default themes (`Light 2026` / `Dark 2026`) that **do**
declare it, so Cedia once showed the engine colour (`#FAFAFD`) instead of the palette colour in
an unfocused window. Fixed by adding the inactive/unfocused keys the engine declares and the
reference does not (`statusBar.inactiveBackground`, `statusBar.inactiveForeground`,
`activityBar.inactiveForeground`, `panelTitle.inactiveForeground`) to all five palettes. Verified
at runtime: the IDE window's light status bar reads `rgb(243,243,243)` across its full width
(previously `rgb(250,250,253)`).

**Shell scale audit (2026-09-14):** every px value in the shell's CSS was checked against the
reference's scales **by property kind** (radius against radius scale, type against type scale)
and off-scale values were fixed: `border-radius: 11px` (`.attention`) → `var(--cedia-radius-full)`
(a pill badge); `border-radius: 5px` (`.pane-chip`, `.pane-draft`) →
`var(--cedia-control-radius)`; `border-radius: 1px` (`.pane-chip` chevron) →
`var(--cedia-radius-xs)`. A test enforcing the invariant that no border-radius escapes the scale
`[0,2,4,6,8,12,14,16,18,9999]` lives in `apps/macos/test/webview.test.ts`.

**Composer geometry (corrected 2026-09-14).** Cursor names its prompt-input tokens directly, so
they compare one-to-one:

| Measured | Reference token | Value | Cedia | Result |
|---|---|---|---|---|
| radius (expanded) | `--prompt-input-border-radius-expanded` | `radius-4xl` = **18px** | `--cedia-composer-radius` | changed 10 → 12 → **18** |
| editor min-height | `--prompt-input-editor-min-height` | `spacing-9` = **36px** | `--cedia-composer-editor-min` | was 44px → 36px |
| editor max-height | `--prompt-input-editor-max-height` | **200px** | `--cedia-composer-editor-max` | was 180px → 200px |
| editor padding | `--prompt-input-editor-padding` | `spacing-2 spacing-3` = **8px 12px** | `.composer textarea` | was 12px all round |

**18px confirmed by measurement, not just by token:** that token has two definitions (default
`radius-4xl` = 18, variant `embedded` = `radius-base` = 6), so the real corner curvature was
measured from the reference window — the composer box's left edge insets 14px at the topmost row
and reaches the inner edge about 18 rows down, which matches r≈18 (first-row inset formula
r−√(r−0.25): r=18→13.8, r=16→12.0, r=12→8.6, r=6→3.6). The composer's real size in the reference
window (1710×1073) is **604×104px**, centred in the main pane with ~424px margins.

**Still open (needs a picture to decide):** the shell's headings use `font-size: 18px;
line-height: 26px` (`.task-title`, `.empty strong`, `.settings-page h2`), but the reference's type
scale is only xs/sm/base/lg = 11/12/13/14 and `--conversation-font-size` is also 14 — there is no
18px step. Changing headings to 14px is a visible change, so it stays unfixed until an image
comparison is possible.

**Open items that must not be changed without evidence:**

- **The agent window's chrome reads ~7 units darker than its theme.** A colour-accurate capture of
  the real reference window (`screencapture -l <windowid>`) reads sidebar `rgb(236,237,238)` and
  composer surface `rgb(245,245,246)` while the transcript area reads `rgb(252,252,252)` =
  `#FCFCFC` **exactly** (no shift). The delta is therefore in the chrome, not the whole window,
  and it is **not** a colour-management shift as previously believed (that explanation was
  withdrawn). The cause is unconfirmed — the light `--cursor-*` values are set at runtime and
  cannot be read from the bundle, and fitting an overlay formula to both surfaces does not agree —
  so the palette is **not** changed. The provable method: read the values the reference sets at
  runtime, or compare two windows in one same-scale image. (Measurement note: Computer Use
  screenshots are shifted ~7 per channel — never use them for colour comparison.)
- `--cursor-accent` = `#599CE7` (blue) while the reference's VS Code theme sets
  `button.background` dark = `#81A1C1` (grey-blue) and light = `#2778C1` (blue). The agent UI's
  accent and the theme's accent therefore disagree with each other; Cedia uses the theme file's
  value. A capture of a real button is needed before deciding.
- `--conversation-block-gap` = `0px` and `--conversation-text-inset` = `0px` (one definition
  each) but **no consumer was found in the bundle**, so the reference's effective message-block
  spacing cannot be concluded; Cedia uses its own spacing.

**The gate (retired 2026-09-20).** The external cross-check (`check:cursor-parity`) read another
product's installed theme files; CEDIA owns its palette now, so the script is deleted. What it
once caught stays pinned by a test: the dark palette had set `titleBar.inactiveForeground` to
`#F0F0F05C` (36%) instead of `#F0F0F099` (60%). Token truth lives in
`apps/macos/src/cedia-theme.ts` and is locked by `apps/macos/test/cedia-theme.test.ts` with no
external reference.

### 3.4 Geometry, type, radius and motion tokens

From the capture plus locked implementations:

| Token | Parity value | Note |
|---|---|---|
| sidebar width | **180px** (min 160, max 360) | ≈14.5% of the 1224px window in the capture |
| list/task row height | **28px** (`--cursor-height-base`) | what the reference really uses: `--ui-sidebar-menu-button-min-height` and `--ui-tray-row-min-height` = `height-base` (28) with row `padding-top/bottom` = 0. The earlier 22px came from an uncertain-scale capture; OCR measurement of the real reference window gives ~31px pitch (28 + ~3px unexplained) |
| sidebar icon | **13px** (`--ui-sidebar-action-icon-size` = spacing-3-25) | was 12px |
| type roles xs/sm/base/lg | **11 / 12 / 13 / 14 px** | line-height 14 / 16 / 18 / 22 |
| task/page heading | 18/26/600 | |
| code | 13/20 | tool output, terminal, diff hunks |
| transcript/composer column | **437px** | ≈435px measured in the capture (41.8% of the main pane) |
| header | min 46px | |
| gutter | 24 / 16 / 12px | ≥900 / 620–899 / <620 |
| control radius / card / composer | **6 / 8 / 10px** | `--cedia-control-radius` = 6px |
| radius scale | 2 / 4 / 6 / 8 / 12 / 14 / 16 / 18 / full | |
| spacing scale | 4 / 6 / 8 / 10 / 12 / 16 / 20 / 24 / 28 / 32 / 40 / 44 / 48 | |
| motion (default token) | instant 0, feedback 100, surfaceIn 150, surfaceOut 100, drawerIn 180, drawerOut 120 ms | curve `cubic-bezier(.2, 0, 0, 1)`; §3.3 supersedes these numbers with the reference's |

### 3.5 Real sidebar IA (locked from the reference capture)

New Chat / Search / Automations / Customize are icon-prefixed rows · no persistent search field
and no scope chips in the sidebar · one Projects heading with a trailing `+` · a New Project row ·
a Repositories heading ending in filter buttons, followed by repo groups and task rows (status
dot, title, worktree icon, relative time) · a compact inline selector row above the composer
(project / branch / environment, each with a chevron) · the home column, mode pills and idea rows
share one left edge · idea rows are icon + title + muted description with a divider per row.

**Superseded for the Agents window (2026-09-19).** The rows above are *Cursor*'s Agents window —
the reference §3 locks for the IDE window. The Agents window's sidebar is the Synara port's now
(`apps/web/src/components/Sidebar.tsx` at `3333343`): `Search` is an icon button in the sidebar's
header rather than a row, the primary navigation is `New thread` / `Automations` (the reference's
`Kanban` and `Pull requests` have no OMP source), and `Projects` is a header whose trailing action
is `Add project`. Cursor's `Customize` row and `Repositories` section are gone from that window;
both commands stay registered, so the command palette and the IDE window still reach them. §9's
"The Agents window's sidebar is the reference's" carries the receipt.

## 4. CEDIA-owned surfaces (driven by OMP)

CEDIA's own design; they live in the same window:

- approvals/questions per OMP's schema (select/multi-select/input/editor + scope/cwd/tool)
- plan/goals/queue/subagent lineage + token budget
- models/providers/MCP/skills/hooks catalog exactly as OMP advertises it
- worktree/branch bring-back receipt + artifacts (MIME/hash/buildId)
- honest-unavailable states (e.g. `Run in Cloud`, `Automations` with no backend) → disabled + reason

## 5. Deliberate differences (recorded, not missing work)

| Item | Retired reference | CEDIA | Reason |
|---|---|---|---|
| harness | Anysphere engine | **OMP** | our product |
| Tab / cloud / private models | yes | no | out of scope |
| touch / control target | smaller | ≥32px desktop / ≥44pt mobile | accessibility floor |
| focus ring (high contrast) | transparent | `#F0F0F066` | focus must be visible |
| missing capability | available | disabled + reason | honesty marker |
| syntax token colours in the IDE | retired reference theme | Code-OSS default | licensing |
| status bar in the agent window | no status bar in the reference agent window | slim bundle-drawn bar (host · model · session · branch) with `statusBar.*` tokens | **decided 2026-09-22:** both windows carry a status bar (§3 decision 5); symmetry with the IDE outranks the reference's omission |
| terminal roles | one terminal concept | agent terminals = host PTY registry, rendered by the bundle in both windows; workbench integrated terminal = the user's private dev shell, upstream behaviour untouched | **decided 2026-09-22:** one agent-PTY owner (host) without replacing the workbench's terminal stack (§3 decision 6) |
| git surfaces | reference's own integrated git UI | host git service = single implementation behind every Cedia git surface; stock SCM view stays as an upstream Code-OSS feature | **decided 2026-09-22:** one git implementation Cedia owns, without deleting an upstream feature users rely on (§3 decision 7) |
| theme settings in the agent window | reference ships theme packs/mode picker | follows `workbench.colorTheme` read-only; changing theme happens in the IDE | **decided 2026-09-22:** one theme authority (§3 decision 3) |
| icon language | one set across both windows (workbench codicons) | the agent bundle (and its dock embed) draws the port's own icon set; the IDE workbench keeps codicons | icons are *elements*, and §3.4 (2026-09-19) locks elements to the composition CEDIA took; unifying sets would restyle the port for no behavioural gain — recorded so the difference is a decision, not drift |
| Agents-window panel controls | no Show Panel / Toggle Side Panel; the panel header carries `Enter Full Screen` + `Hide Apps` | keeps the inherited `Show Panel` (hidden by `0026`) and `Toggle Side Panel` | **decided 2026-09-17: keep the current panel.** Removing the toggle and adding the reference's `Hide Apps` / `Enter Full Screen` is a real change to shared layout actions; the user chose to keep what works today rather than chase these three controls. Revisit only if the panel is rebuilt (section 7's React pass). |
| terminal rendering in the IDE | xterm.js | **xterm.js** | decided 2026-09-17: replacing the workbench renderer drags the xterm-specific addons (image, ligatures, search, serialize, the terminal API) out with it for no user-visible gain. Recorded here rather than left as open work; the engine work goes to the surface Cedia owns (the iOS WebView terminal), gated by the corpus in `apps/macos/src/terminal-conformance.ts`. |
| the panel's tab group | a native editor tab group named `Tabs` | Cedia's own launcher strip (patch `0017`), with the native group hidden | the native `.tabs-container` (`role=tablist`) still exists in the Agents window and is `display:none`; `cedia-apps-strip` draws the same four entries (Changes / Browser / Terminal / File) plus the `+`. Decided 2026-09-17: keep Caret's strip, so the reference's `tab group Tabs` has no counterpart by design rather than by omission. |
| in-app editor view vs the IDE window | a third editing surface inside the agent window (`?view=editor`, `EditorWorkspaceView`) | **agent window + IDE window only (decided 2026-09-20):** the in-app editor view is preview chrome, not a Code-OSS editor — no LSP, debug, extensions or real undo — so it is not offered as a surface. Real file work lives in the IDE window (header `IDE` button, Environment `Open in <editor>`, bridge `openIde {path, line}`); the agent window keeps chat plus the right-dock panes. The header `Editor view` toggle and the Environment `Editor view` row are gone, and item 53 (closed 2026-09-20) deleted the `?view=editor` route, `EditorWorkspaceView`, its state and the editor rail outright; dock file edits open in the IDE window through `openInPreferredEditor` → bridge `openIde {path}`. |

Deviation values that must stay different from Cursor, each requiring a receipt, because they are
CEDIA's accessibility floor rather than missing work. Never remove one to make a number match:

| Item | Retired reference | CEDIA | Reason |
|---|---|---|---|
| touch target (iPhone) | — | ≥44pt | platform HIG; applies to S14/S15 |
| desktop primary control | smaller | ≥32×32 | hit area, not the drawn image |
| `Run in Cloud` pill | absent | disabled pill | honest unavailable-capability marker |
| Thai label wrapping | — | wraps without clipping | locale rule; the only surviving Thai concern, since documentation itself is English now |
| high-contrast `focusBorder` | transparent | `#F0F0F066` | focus perimeter must be visible; the reference relies on other indicators |
| high-contrast `statusBar.border` | transparent | `#F0F0F01a` | separation must not depend on shadow |
| high-contrast **light** | theme does not exist | uses the light palette | the retired reference ships no HC-light; not a failure |

## 6. SSOT (one responsibility, one live path)

| Responsibility | SSOT | Forbidden |
|---|---|---|
| Agents window identity + bridge | the base's window (patch `0056`) + `apps/macos/src/agent-window-main.ts` | a second hand-drawn shell/webview beside the bundle, a second renderer |
| agent surface in both windows (sidebar/composer/transcript/dock) | `apps/macos/agent-window/src/cedia-adapter.ts` → host `/v1` → OMP; the native `chatSessionsProvider` path retires (§10 item 56) | a second provider path or renderer per window |
| IDE | the normal workbench | wrapping the IDE in our shell |
| execution/transcript | OMP | a second daemon or agent loop |
| host/lifecycle/journal/relay | `apps/host/**` | a second host |
| theme authority | `workbench.colorTheme` → `apps/macos/src/cedia-theme.ts` (+ `cedia-theme.test.ts`), mirrored to the bundle | theme packs or a second palette in the agent window |
| window chrome policy (zoom/traffic lights/menus/status bar) | one main-process module for both windows (§10 item 55) | per-window one-off patches |
| keybindings | `Cedia/User/keybindings.json` | a second chord table or resolver in the bundle |
| model selection state | host `GET /v1/models` + session `set_model` | a second picker state |
| project creation | host `POST /v1/projects` | a second project store |
| git (every Cedia surface) | the host git service | a second git implementation (the stock SCM view is upstream, §5) |
| agent terminal PTY | the host PTY registry, rendered by the bundle in both windows | a second agent PTY |
| layout/token knowledge | `apps/macos/src/cedia-theme.ts` + `cedia-theme.test.ts` | hardcoding outside tokens |
| edits inside `desktop/` | `patches/desktop/*.patch` + digests in `manifest.json` | editing the checkout without capturing a patch |

### 6.1 Patch mechanism constraints (measured, not theoretical)

`prepare-desktop.ts` proves "already applied" with `git apply --reverse --check` **per patch**,
plus a whole-set stamp (`desktop/.prepared.json`, ignored) carrying the manifest digest.
Four structural consequences, each hit in practice:

1. **A new patch that edits a file created by an earlier patch cannot verify.** If a later patch
   touches a file a previous patch *created* (e.g. `0021` creates `agentHomeUtilityEditor.ts`),
   the creator's reverse-check fails because the file no longer matches its post-image. Fold that
   work back into the patch that creates the file. **A patch that only edits base files can be a
   separate patch normally** (`0027` editing `editorTabsControl.ts` and `0028` editing
   `build/next/index.ts` both pass).
2. **`git apply` writes the worktree, not the index.** After applying earlier patches, `git diff`
   still compares against the base commit (a base-relative diff), which does not match the state
   the patch will really be applied to. This stays invisible until files are shared: when
   `sessions.common.main.ts` was also edited by `0005`, the apply failed because the patch tried
   to delete an import `0005` had already removed. **`git apply --index` the earlier patches
   before re-cutting.**
3. **Re-cut from the tree only for files that patch itself creates.** Files an earlier patch
   already edited, or a later patch will edit, must keep their original hunks instead of a
   regenerated section. Real case: `0022` creates `agentHomeNav.ts` but also edits
   `sessions.desktop.main.ts`, which `0023`/`0024` edit further — regenerating the whole file
   list from the working tree pulls `0023`/`0024`'s work in, and those two then fail to apply.

4. **Overlapping patches defeat per-patch reverse-check, so the stamp owns idempotency.** A later
   patch may rewrite lines an earlier patch added (0011's model-picker block was extended by
   0043/0045): on a fully patched tree that earlier patch then fails *both* reverse-check (its
   post-image is gone) and forward-check (its pre-image is gone), and no per-patch proof can
   pass. `prepare-desktop.ts` therefore skips the loop entirely when `.prepared.json` matches
   the manifest digest, and writes the stamp only after a full successful apply. Reset
   (`git checkout -- .` + `git clean -fd -e node_modules -e .build`, then re-run) deletes the
   stamp with everything else, so a reset tree always re-prepares from the base.

### 6.2 Retirement ledger

| Artifact | Retire when | Status |
|---|---|---|
| `apps/macos/src/webview.ts` + `TASK_WEBVIEW_CSS` + the tests bound to the shell | S3 | **unreachable at runtime (measured 2026-09-22)** — the dock is `agent-ide-webview.ts` loading `agent-ui/ide.html`; `CediaTaskViewProvider` is never passed to `registerWebviewViewProvider`. Delete per §10 items 10/63 |
| `scripts/shell-render-fixture.ts` | with `webview.ts` | **delete with `webview.ts` (corrected 2026-09-22)** — the shell it renders is no longer any window's UI; parity checks capture the live bundle window instead |
| `caretComposer` view + its `caretAgents` activity-bar container | 2026-09-17 | **retired** — a second agent surface for one window; the dock is the only Cedia view left |
| the `caret.agentsShell` editor + `openAgentsShellEditor()` + the `.caret-shell` document | 2026-09-17 | **retired** — the shell-in-an-editor-column route the Agents window already refused to mount |
| `scripts/shell-render-fixture.ts` | with `webview.ts` | **kept on purpose**: the shell it renders is still the live IDE dock, and headless render is how the open AX/DOM parity check (§10 item 16) measures it |
| `patches/desktop/0002` + context key `caret.agentsWindow` + chrome hiding on mode switch | S1 | **retired** (replaced by `0008`; context key removed from the extension) |
| drift of `agentWorkbenchActions.ts` edited in the checkout without a patch | S1 | **retired 2026-09-17** — the whole `src/vs/workbench/contrib/agentWorkbench/` island is recorded as a `removals` entry, and patch `0034` drops its one import; nothing in `desktop/` registers it any more |
| the fork's `caret.openAgentsWindow` command that still opens the `caretComposer` webview | S3 | **retired 2026-09-17** (patch `0034`): the command, its `caret.openIde` twin, the mode service behind them and the context key `caretWorkbenchShell` all went with the island. The one remaining route is `cedia.showAgents` → `workbench.action.openAgentsWindow`. |
| the Agents window mounting Cedia's shell editor (`caret.agentsShell`) inside itself | S3 | **deleted 2026-09-17**: it stopped mounting on 2026-09-14, and the editor, the fallback panel and the `window.caret-shell` document are now gone from the extension too. What is left of S3 is `webview.ts` + `TASK_WEBVIEW_CSS` + the shell-bound tests (the dock). |
| the Agents-window architecture note | immediately | **deleted** — it had been reduced to a redirect stub |
| Copilot provider in the sessions workbench | 2026-09-14 | removed by `patches/desktop/0005` |
| native sessions workbench UI (27 patches) + its pinning tests | 2026-09-20 | **retired** — no window renders `sessions.html` since `0056`; manifest holds 29 (`0005` restored: build-load-bearing), see §9 |

### 6.3 Tree audit (2026-09-15)

The whole tree was scanned (excluding `desktop/`, which is the base's build output) with these
results:

| Group | Status | Evidence / what remains |
|---|---|---|
| **Cedia's webview shell** — `apps/macos/src/webview.ts` (2,836 lines), `TASK_WEBVIEW_CSS`, the `caretComposer`/`cediaComposerDock` views, the `caret.agentsShell` custom editor, the restricted-mode stub, `scripts/shell-render-fixture.ts` and ~8 shell-bound test files | **not all dead code — this corrects an earlier note (2026-09-15)**: it really is no longer mounted in the *Agents window* since 2026-09-14, but in the *IDE window* the shell is still a live dock — a `cediaDock` container → the `cediaComposerDock` view, the `cedia.focusDock` command (`extension.ts:4006`), and `focusAgentSurface()` sending `focus_composer`/`focus_search`/`focus_task` plus `prefill` from IDE-side actions (add selection to composer, inline edit) all land in those views ⇒ **deleting the set now would cut working features** (there is no way to send a message into the Agents window's composer from the extension instead) | Two mandatory preconditions remain: (1) ~~move the token source to `cedia-theme.ts`~~ **done 2026-09-15** — 76 tokens live in `CEDIA_TOKENS`/`cediaTokenCss()` in `cedia-theme.ts` and `cedia-theme.test.ts` locks them (no external gate since 2026-09-20), no longer bound to the shell's CSS; (2) `webview.ts` can be deleted once an IDE-side replacement for the dock exists, which is **S4/S2 work, not S3** — until then `rg "webview.ts\|TASK_WEBVIEW_CSS"` is not 0 and **S3 has not passed its exit gate** |
| The four kickoff-pack documents (parity spec 2.0, backlog CSV, golden-state template, kickoff prompt) | **deleted 2026-09-16** | Superseded by this plan in full |
| Brand/icon work left in the working tree (`assets/brand/**`, iOS icons, `scripts/lib/app-icon.ts`, `scripts/build-cedia.ts`) | **not committed** (from another session) | `scripts/build-cedia.ts` in the working tree imports `scripts/lib/app-icon.ts`, which is still untracked — keeping this work means committing the whole set together, otherwise HEAD and the tree disagree |
| `.DS_Store` (2 tracked files + untracked) | **cleaned** (2026-09-15) | Files removed and `.DS_Store`, `.vscode/`, `.commandcode/` added to `.gitignore` |
| `patches/desktop/0002` + `0004` | retired | No patch files remain in `patches/desktop/` and the manifest has no entries (recorded in `patches/desktop/README.md`) |
| Copilot/Claude/Codex providers in desktop | removed | `patches/desktop/0005`–`0007` + the 18 `removals` entries in the manifest |
| **OMP runtime gate** — exact `omp/18.1.18` comparison in `apps/host/src/service.ts`, three smokes and `prepare-omp-runtime.ts` | **fixed (2026-09-15)**: `isSupportedOmpVersion()` in `packages/omp-adapter/src/types.ts` accepts the baseline or a newer patch in the same minor (accepting this machine's `18.1.22`) and rejects other minors, older versions or non-version strings. The host still probes with the same env it spawns with; `prepare-omp-runtime` still pins exactly because it builds the shipped artifact | Receipt [`evidence/s2-omp-version-gate-2026-09-15/`](evidence/s2-omp-version-gate-2026-09-15/) · the repo's smokes pass against a real OMP 18.1.22 · `apps/host` is green across the set |
**Re-audited 2026-09-17.** The shell row above is a 2026-09-15 snapshot; the current state is §6.2.
What that pass found, and what this one changed:

- gone: the `caretComposer` view and its `caretAgents` container, the `caret.agentsShell` editor, the
  `*.caret-shell` document and the `window.caret-shell` fallback panel, `agentsWindowOpenMode()`, the
  duplicate `caret.openTask` command, and `desktop/`'s `contrib/agentWorkbench` island (13 files);
- gone with no replacement needed: `artifact-filters`, `artifact-lineage`, `markdown-table`,
  `settings-hits` and `transcript-find` — five modules whose only importer was their own test;
- still live on purpose: the dock (`webview.ts` + `TASK_WEBVIEW_CSS` + shell-bound tests) and
  `scripts/shell-render-fixture.ts`, which renders that dock headlessly for the open AX/DOM check.

Receipt: [`evidence/dead-code-retirement-2026-09-17/`](evidence/dead-code-retirement-2026-09-17/).

## 7. React for the Agents surfaces (decided 2026-09-15)

**"Is Cursor fully React?" — answered from evidence (2026-09-15): no.** Both
`workbench.desktop.main.js` (IDE) and `workbench.glass.main.js` (Agents) still contain VS Code
workbench components (`EditorPart` 18/15, `StatusbarPart` 2/2, `TitlebarPart` 2/2, `QuickInput`
7/12 occurrences) ⇒ the chrome, editor and sidebar are still TypeScript + DOM, not React. React
*is* bundled into the whole app (`esm-jsx-runtime` 704 occurrences in the IDE bundle, 1462 in
glass) and **the Agents window uses it most heavily** — real React components appear in the glass
bundle (minified jsx aliases, `Trigger`, icon buttons). The correct target is therefore
**React islands inside the workbench**, not rewriting the workbench — which is what R1/R2 did, and
what the reference itself does. (Whether the reference's IDE window uses much React is neither
measured nor needed: the IDE is upstream Code-OSS that we do not author.)

The user asked for "React like Cursor" and proposed Untitled UI React as the component set. Those
are two separate questions, because the evidence says they are not the same thing.

### 7.1 Measured facts

- The reference builds agent UI with **real React**: `out/vs/workbench/react-runtime/` (react +
  react-dom + jsx runtime, 248K) and its Apps panel is a React component — a **fixed** pane
  switcher (`changes`/`browser`/`terminal`/`file`) plus a `+` button with
  `aria-label="Open new tab menu"`. Details in
  [`evidence/cursor-agent-window-architecture-2026-09-15/`](evidence/cursor-agent-window-architecture-2026-09-15/).
- Our checkout: `desktop/node_modules` already had `react` + `react-dom` **18.3.1**, but as an
  indirect dependency, and `src/vs/sessions/**` contained no React at all (0 files; the only
  React imports in `src/vs` are under `workbench/test/**/componentFixtures/*`). The base
  `package.json` declares no react/tailwind/aria.
- Untitled UI React (the component page the user supplied) states it is "Built with React Aria
  v1.20 and styled with Tailwind CSS 4.3" and has both free/open-source and a "Get PRO" tier.

### 7.2 Decisions

1. **Use React for the Agents surfaces: yes.** It matches the reference and is the only route
   that really closes the panel/sidebar gaps listed in §10. The right starting point is a pane
   whose model and view are already separated (`appsPanelModel.ts` + `agentHomeUtilityEditor.ts`):
   replace the view layer with `createRoot` and let React render from the existing model.
2. **Do not import all of Untitled UI into the parity surface**, because:
   - Cursor does not use Untitled UI — importing it makes Caret *less* like the thing it promised
     to match: `cedia-theme.test.ts` locks the palette from `CEDIA_TOKENS`/`CEDIA_WORKBENCH_COLORS`,
     while Untitled UI brings its own spacing/radius/font scales ⇒ every component would be
     restyled back into our tokens anyway (you get React Aria's a11y and structure, not its look).
   - Tailwind 4 in the workbench renderer means a global preflight colliding with workbench CSS;
     that has to be scoped before anything else.
   - react/react-dom must become **production dependencies** of the fork and enter
     ThirdPartyNotices ⇒ a licensing/release task, not just an import.
   - What is worth borrowing from Untitled UI is the *pattern* (component structure, states,
     React Aria's a11y), assembled from our tokens — not its scales.
3. **Do not touch the deliberate deviations** in §5 (`harness = OMP`, no Cursor Tab/cloud, touch
   targets ≥32px/≥44pt, visible focus ring, missing capability → disabled + reason, IDE syntax
   colours).

### 7.3 Slice order

| Slice | Work | Verified by |
|---|---|---|
| R1 | Make React a production dependency of the fork + one React root in `src/vs/sessions/**` (the Apps panel pane), rendering from the existing `IAppsPanelModel` | `node build/next/index.ts transpile` + open `--agents` and see the pane still work |
| R2 | Move the pane switcher to React per the reference spec (Changes · Browser · Terminal · File + `+`) with React Aria states/shortcuts | AX/DOM comparison with the reference + parity gate |
| R3 | Sidebar Projects/Repositories/Search as the same React surface | AX/DOM comparison with the reference + parity gate |
| R4 | Re-evaluate Untitled UI concretely: which components earn their place, and how many restyle into `CEDIA_TOKENS` | the parity gate must not regress |

**Status**: R1, R2 and R3 all landed by 2026-09-15 — see §9 for the receipts. R4 has not started
and is the only React item still open; note that the JSX setup added on 2026-09-16 (§9, item 10)
removes the main cost R4 was meant to evaluate, so R4 is now a question about component
*sourcing*, not about build capability.

## 8. Execution plan

| Step | Work | Owner | Exit evidence |
|---|---|---|---|
| **S1 Remove Copilot, open the real window** (done) | S1a unregister Copilot (provider/harness/auth) · S1b delete the dead Copilot/Claude/Codex code · S1c route to the base's window (patch `0008`), retire patch `0002` + its context key, make the base tolerate a missing `defaultChatAgent` (patch `0009`) | root | The Agents window really mounts (title `Agents`, workbench + sidebar + composer); no Copilot gate/sign-in; no `Session Type: Copilot`; the IDE window boots normally; the bundle registers no Selection/Go/Terminal in the Agents window |
| **S2 Cedia's provider** | Register our own `chatSessionsProvider`; list sessions from the host; send work through the host to OMP; no other provider | root | **Met**: the extension activates in the Agents window, the provider reads the host, `patches/desktop/0010` bridges items into `ISessionsProvidersService`, the sidebar shows real host sessions and opens a chat, `provideChatSessionContent()` returns a `requestHandler` → `runTurn()` (startSession → `sendCommand(promptRequest)` → poll events → stream markdown/tool progress → abort on cancel), and the model picker reads OMP's catalogue (`get_available_models`/`get_state`/`set_model`). What remains is listed in §10. |
| **S3 Delete the duplicate** | Remove the webview shell + CSS + the shell-bound tests; move capability still in use to the native side | root | `rg "webview.ts|TASK_WEBVIEW_CSS"` has no remaining users; the suite passes |
| **S4 Close parity §3** | Build every component in §3 and measure the real geometry/colour | root + reviewer | Capture at the same viewport/theme + every §3 row passing |
| **S5 Mobile continuity** | The iPhone as a projection of the same session (relay/approval/replay) | root | Receipt: real iPhone + cellular |

### Desktop completion slices (opened 2026-09-17)

§10's desktop items are four independent slices. Each one closes the same way, which is now a
proven loop rather than a hope: change the fork, `cd desktop && npx gulp vscode-darwin-arm64-min`
(~3 min), `CEDIA_HOST_NODE=~/.caret-tools/node-v24.18.0-darwin-arm64/bin/node bun run package:mac`
(~12 s), launch with `--agents --remote-debugging-port=9333`, capture with
`scripts/agents-chrome-inventory.ts`. The first one (navigation copy, patch `0035`) has been
through it.

| Slice | What it takes | Closes when |
|---|---|---|
| **D1 New Chat creates a draft** | **Piece 1 landed and verified 2026-09-17.** Cedia's provider now returns a real draft: `createNewSession` builds an `ExtensionSession` over `getNewChatSessionResource('caret.omp')` (an untitled chat of Caret's session type) with the workspace the caller asked for, and `resolveWorkspace` answers for that folder instead of only the window's own. Clicking the Agent Home's `New Chat` now opens an empty Caret chat - `[ChatModelSelection] sessionKey="caret.omp:/untitled-<uuid>"` in the window log, and the screenshot `evidence/dead-code-followup-decisions-2026-09-17/caret-agents-draft-state.png` shows the `New task` composer over an empty transcript. What is left: (2) the draft has no workspace picker, because the provider advertises `supportsLocalWorkspaces = false`, and the extension's `newChatSessionItemHandler` still creates in the first non-archived project rather than the folder the user chose; (3) in the draft state the Apps panel shows only `Changes` where the reference shows `Changes`/`Browser`/`Terminal`/`File`, so the panel's session-scoped tabs are not offered before a session exists; (4) the reference's starter cards. | the draft also carries the user's chosen folder into the created session, and the panel offers the same four entries in the draft as in a session |
| **D2 Accessible names for the splitters and the tab group** | **Splitters done** (patches `0036` + `0037`, verified in a rebuilt app): `Sash` can carry a name, and the two boundaries the reference names are named at their owners - the sidebar and auxiliary-bar boundaries in the IDE window's `layout.ts`, and in the Agents window's own layout (`sessions/browser/workbench.ts`, which is a separate implementation) the sidebar boundary plus the editor part's left edge, which is where this window's Apps panel starts. A sash is matched to a part by measured geometry because the grid keeps no handle to the sashes it creates. **What remains is the tab group** (`tab group Tabs` in the reference), a separate editor-part surface. | splitter entries: the capture now reads `splitter Resize sidebar` and `splitter Resize panel`, matching the reference exactly (shared 15, missing 26). Closing this row needs the named tab group only. |
| **D3 The dock becomes native (S3)** | `webview.ts` (2,836 lines) + `TASK_WEBVIEW_CSS` + the shell-bound tests are the IDE window's agent surface today. §7 already decided React for these surfaces; the dock has to move before the shell can be deleted, and `cedia.focusDock` + the `prefill` handoffs have to keep working through the move. | `rg "webview.ts|TASK_WEBVIEW_CSS"` finds no remaining users and the suite passes (§8 S3's own exit gate) |
| **D4 Composer modes, then the chips** | The reference's `Plan New Idea` / `Multitask` are CTAs on a real mode state (measured 2026-09-17). Caret needs the mode in the composer first, mapped to something OMP actually does (a plan-first turn over `ompPlan`; parallel subagents per §10 item 8), and the `High` effort popup needs a provider config action. | the chips exist and change what a turn does, or they stay unrendered by decision (§10 item 11) |
| **D5 `--cedia-*` at the workbench level** | The extension cannot write CSS into the workbench DOM, so the token layer relies on CSS fallbacks a test pins. A workbench contribution has to own the variables, and its values have to come from `cedia-theme.ts` — generated into the patch the way the brand icon is generated into the bundle. | the workbench DOM carries the `--cedia-*` variables and the parity check reads them from there instead of from fallbacks |
## 9. Landed work ledger (append-only registry, no authority over §3-§8)

This section records what landed and when, with a receipt for each. It is a registry, not a spec:
if an entry contradicts §3, §5, §6 or §8, **those sections win** and the entry is what to fix.
Append new entries at the end; never rewrite an old one except to correct a factual error, and
say in the entry that you corrected it.

### S1a/S1b/S1c (2026-09-14) — Copilot removal

- `patches/desktop/0003` — product.json: allowlists `chatSessionsProvider`, removes
  `defaultChatAgent` (the source of the welcome/sign-in flow), removes Copilot from
  `trustedExtensionAuthAccess` and `builtInExtensionsEnabledWithAutoUpdates`. `product.json` now
  contains no Copilot references (`grep -c copilot` = 0).
- `patches/desktop/0005` — stops loading the Copilot chat session provider (desktop + web entry).
- `patches/desktop/0006` — removes all harness registrations (Copilot/Claude/Codex) plus the BYOK
  proxy, the Claude/Codex proxies, the pending-edit provider and Copilot API wiring;
  `providerConfigurations` is `[]`; `npm run typecheck-client` = 0 errors.
- `patches/desktop/0007` — removes the last production references to the Copilot harness (the
  Copilot-schema picker family, `sessionPluginBundler.ts`'s Copilot import, and the
  remote-agent-host contribution's load of the deleted picker).
- S1b deleted `node/{copilot,claude,codex}` (920 files), the whole `platform/agentHost/test` tree,
  `sessions/contrib/providers/copilotChatSessions`, and the picker families bound to
  Copilot/Claude/Codex schemas. The deletions are kept as **`removals` in
  `patches/desktop/manifest.json`** (18 entries) applied by `scripts/prepare-desktop.ts` rather
  than as a multi-megabyte deletion patch, so the list stays reviewable and every path is still
  tracked and confined to the checkout.
- **Reproduction proved**: restoring all files (102 Copilot files) → `bun scripts/prepare-desktop.ts`
  (7 patches + 18 removals) → the same Copilot-free tree, with `npm run typecheck-client` = 0 errors.
- **Correcting an earlier note**: an earlier summary said "the window is blank as expected because
  Caret's provider is not written yet". **Wrong.** The window was blank because the **workbench
  did not boot** after `patches/desktop/0003` removed `defaultChatAgent` from product.json — the
  base read it without an undefined guard in two places: `toDefaultAccountConfig()`
  (`workbench/services/accounts/browser/defaultAccount.ts`) and a module-level
  `assertDefined(product.defaultChatAgent, …)` in `welcomeOnboarding` (the latter killed the
  **entire IDE window**). Evidence: renderer exceptions captured over CDP —
  `Cannot read properties of undefined (reading 'chatExtensionId')` and
  `Onboarding requires a default chat agent product configuration.` The AX finding that the word
  `Copilot` was absent was therefore an artefact of nothing mounting, not proof of a clean surface.
- `patches/desktop/0009` — makes the `defaultChatAgent` readers tolerate its absence (accounts,
  extension gallery/deprecation, pack-uninstall, composer welcome copy, onboarding) without
  changing behaviour when product.json has a value.
- `patches/desktop/0008` — removes `Selection`/`Go`/`Terminal` from the Agents window's
  `src/vs/sessions/browser/parts/menubar.contribution.ts`; the IDE window keeps its menu set
  (verified in the real built bundle: `"mSelection"`/`"mGo"`/`"mTerminal"` are 0 occurrences in
  `out/vs/sessions/sessions.desktop.main.js` and still present in the workbench bundle).
- Routing: `apps/macos/src/extension.ts#openAgentsWindow` calls
  `workbench.action.openAgentsWindow` (the base's window, opened with `--agents`); it no longer
  switches mode in the existing window and no longer opens a webview.
- After rebuilding, the Agents window really mounts with title `Agents`, and its whole innerText
  contains no `Copilot`.
- **Measured twice** (same machine, same build, fresh profile, `--remote-debugging-port`):

| Window | time to first window | workbench mounted | steady RSS (sum over processes) |
|---|---|---|---|
| Agents (`--agents`) | 1.65s | 1.80s | 721MB / 7 processes |
| IDE | 1.48s | 1.61s | 642MB / 8 processes |

  Method note: RSS is the sum of every process's RSS in that profile (shared pages counted more
  than once). It compares Caret's two windows to each other, not to any other application.
- **Remaining naming debt**: 15 files whose names contain "copilot" but which are not the harness
  (`copilotCliConfig`, `copilotHome`, `copilotManagedSettings`, `copilotToolIds`, and the
  slash-command and prompt-syntax compat helpers). They register nothing and gate nothing.

### S2 provider and bridge (2026-09-14)

- `apps/macos/src/chat-sessions-map.ts` — a pure projection (uri/session item/turn plans/command)
  with 14 test cases in `apps/macos/test/chat-sessions-map.test.ts` (fixtures only, no provider).
- `apps/macos/src/chat-sessions.ts` — registers the participant + `createChatSessionItemController`
  + `registerChatSessionContentProvider`; feeds history from `state.ts`'s `applyEvent`; sends work
  with the `prompt` command through `CaretHostClient` and streams by reading events from a cursor
  (aborting when the token is cancelled). OMP still owns execution and transcript.
- `patches/desktop/0003` adds `chatParticipantPrivate` to `extensionEnabledApiProposals` and
  **`sessionsWindowAllowedExtensions: ["caret.caret"]`** — genuinely required: without the
  allow-list, an extension with `main` + contributed `views` is disabled in the Agents window
  (`extensionEnablementService#_isDisabledBySessionsWindow`).
- `patches/desktop/0010` — `contrib/providers/extensionSessions/browser/extensionSessionsProvider.contribution.ts`
  is a general bridge: it reads `IChatSessionsService.getChatSessionItems()` and exposes them as an
  `ISessionsProvider` (the model the sidebar actually uses), sending work with
  `chatService.sendRequest`, so no third-party provider is needed; registered in
  `sessions.desktop.main.ts`. Fail-safe: if items cannot be read, the provider returns an empty
  list and logs a warning — the window does not break.
- Not advertised, and therefore not shown as buttons: rename/archive/delete/fork/side-chat/
  multi-chat and the model picker (`capabilities` = false and `getModelPickerOptions` disables all)
  — these wait for the OMP binding to finish, per §5's "missing capability → disabled + reason".
- **Verified** (packaged app + `--agents` + CDP): the sidebar shows
  `treeitem: caret-ui-acceptance, 1` (grouped by the session's real workspace) and
  `treeitem: New task, updated 2 days ago, State: Completed`; clicking opens that session's chat
  view in the Agents window with a full composer and welcome — no errors in the exthost log and no
  read-only banner (the element exists in the DOM but is `display:none`).
- Receipts: [`evidence/agents-window-boot-2026-09-14/`](evidence/agents-window-boot-2026-09-14/),
  [`evidence/agents-window-sessions-2026-09-14/`](evidence/agents-window-sessions-2026-09-14/),
  [`evidence/agents-window-sessions-bridge-2026-09-14/`](evidence/agents-window-sessions-bridge-2026-09-14/).

### S2 live turn through the host API (2026-09-15)

- `smoke:omp:live` (`scripts/omp-live-turn.ts`) fires one real turn through the same path the
  Agents window uses (host HTTP API → `startSession` → command `prompt` → OMP → event stream),
  getting the exact instructed answer in 3.4s over 184 frames ending with `agent_end` and the
  command `completed`. Receipt: [`evidence/s2-live-turn-2026-09-15/`](evidence/s2-live-turn-2026-09-15/).
- **What the receipt corrected**: OMP does **not** send `prompt_result` for a real turn —
  `prompt_result` is reserved for a prompt that is scheduled but does not invoke the agent
  (`upstream/omp/docs/rpc.md` §9). The turn terminator is `agent_end` + `message_end`, and `start`
  **emits a new incarnation every time** (`service.ts:134`), so the post-start value must be used;
  the app side already did the right thing (`chat-sessions.ts:487-491`).

### S2 live turn from the on-screen composer (2026-09-16)

Receipt: [`evidence/s2-agents-window-live-turn-2026-09-16/`](evidence/s2-agents-window-live-turn-2026-09-16/).

- **Gate 1 (closed)**: `ChatServiceImpl.sendRequest` refuses every request with no *default agent*
  for its location (upstream that agent is Copilot Chat's participant, removed in S1), so every
  click ended at `sendRequest No default agent for location panel` before reaching Caret's
  provider. Fixed by making `caret.omp` the default agent: `patches/desktop/0003` adds the
  `defaultChatParticipant` proposal for `caret.caret`, `apps/macos/package.json` declares
  `isDefault: true` + `modes`, and `apps/macos/src/chat-sessions.ts` runs the real turn from the
  participant handler (`runTurn`, the same path as the session content provider). After a rebuild
  and repackage, the `No default agent contributed` symptom at boot disappeared and requests
  reached the Agents window's transcript.
- **Gates 2+3 (closed, 2026-09-16)**: Caret registers its own language model provider from OMP's
  catalogue (`apps/macos/src/omp-language-models.ts`, vendor `caret-omp`), because the extension
  host always attaches `vscode.ChatRequest.model` for a handler
  (`extHostChatAgents2.getModelForRequest`) and can only resolve models belonging to the
  requesting extension. Three things had to agree: (i) `patches/desktop/0010` declares the vendor
  descriptor (`deltaLanguageModelChatProviderDescriptors`), otherwise
  `Chat model provider uses UNKNOWN vendor caret-omp`; (ii) the picker identifier must be
  `<vendor>/<id>` to match what the extension host builds (`getVendorFromModelIdentifier`), hence
  the prefix in `0010` (sessions bridge) and `0011` (chat widget), with the extension stripping it
  before writing `set_model`; (iii) the provider must announce itself
  (`onDidChangeLanguageModelChatInformation`) because `registerLanguageModelProvider` does not
  resolve on its own — after announcing, the workbench logs
  `[LM] Resolved language models for vendor caret-omp` and the chip can pick a model.
  `patches/desktop/0003` adds the `chatProvider` proposal for `caret.caret`.
- **Result**: a prompt typed into the Agents window's composer (built and packaged from this
  revision) reached OMP and the answer flowed back into the transcript — evidence: a
  `Caret participant turn for session 94e8b9bd-…` line in the Caret channel, the session journal
  (`user: 'Reply with exactly this and nothing else: caret-ui-turn-ok-2'` /
  `assistant: 'caret-ui-turn-ok-2'`), and the transcript showing `Sent 11:23 AM` → `Completed 11:23 AM`.
- **Earlier same-day attempt** (`evidence/s2-live-turn-window-2026-09-16/`): typing worked (text
  landed in `.view-line`, Send became enabled, `.chat-submit-button` had no `disabled`) but
  **submit was never dispatched** — a CDP trusted click on the button (confirmed by a listener
  that `mousedown`/`click` reached the element), a CDP click on `.action-label`, and a real
  `Return` through Computer Use all produced no request to the extension, no new `prompt` command
  on the host, and the session still at 9, so **no provider credit was spent**. The important
  finding was that a session **with no turns** shows the base's welcome (`Build with Agent` /
  `Generate Agent Instructions`) rather than Caret's chat view; that was the real S2 blocker, not
  OMP or credentials. Chronology note: this attempt (10:18) happened *before* the 11:23 default
  participant work above. What remains true from it: **a session with 0 events still shows the
  base's welcome, not Caret's chat view.** Measurable test constraint: Monaco in this window uses
  the **EditContext API**, so `Input.insertText` and `Input.dispatchKeyEvent` cannot enter text —
  real keys through Computer Use are required, and the window must be raised to frontmost in the
  *same call* as the action (proved to work). `sky.paste` fails with a clipboard timeout when the
  app is not frontmost.

### OMP version gate (2026-09-15)

The old gate compared `omp/18.1.18` exactly in `apps/host/src/service.ts`, three smokes and
`prepare-omp-runtime.ts`. `isSupportedOmpVersion()` in `packages/omp-adapter/src/types.ts` now
accepts the baseline or a newer patch in the same minor (accepting this machine's `18.1.22`) and
rejects other minors, older versions, or non-version strings. The host still probes with the same
env it spawns with; `prepare-omp-runtime` still pins exactly because it builds the shipped
artifact. Receipt: [`evidence/s2-omp-version-gate-2026-09-15/`](evidence/s2-omp-version-gate-2026-09-15/).

### S4 slice 1 — Cursor copy and the IDE header (2026-09-14)

- `patches/desktop/0015` (7 files, all under `src/vs/sessions/**`, so the IDE window is untouched):
  the composer placeholder is reduced to Cursor's single string, the header entry point becomes
  `IDE` (both the action this window registers and the hover widget), the sidebar button
  `New` → `New Chat`, and `sessions.developerJoy.enabled` defaults `true` → `false` (the pet
  button leaves the window).
- **Verified** (dev build + `--agents` + CDP DOM): the window text begins with `IDE`, there is no
  `Open in VS Code`/`Open in Editor`, the composer shows `Plan, Build, / for skills, @ for context`
  with `Pitch your idea` gone, the sidebar reads `New Chat ⌘N`, and the pet element remains in the
  DOM but `hidden` at size 0. Receipt:
  [`evidence/s4-agents-cursor-copy-2026-09-14/`](evidence/s4-agents-cursor-copy-2026-09-14/).
- **External corroboration**: `cursor.com/docs` confirms the product really has two windows — the
  Agents Window (opened from the editor with `Cmd+Shift+P → Open Agents Window`) and the IDE
  (`→ Open IDE`), and "you can switch back to the editor anytime, or have both open
  simultaneously" ([/docs/agent/agents-window](https://cursor.com/docs/agent/agents-window)) ⇒ our
  two-window architecture matches the source product.

### S4 slice 2 — Agents window chrome (2026-09-14)

- `patches/desktop/0016` (3 files, `src/vs/sessions/**` only): removes the `Sessions` label from
  the sidebar (Cursor has no name for this pane — the element stays because it is the flex spacer
  the header actions and find widget use), removes the `Run` button and its permanently disabled
  `Run Task is not available for this session type` placeholder from `Menus.TitleBarCenterRight`
  (the command stays in the palette and on F5), and makes this window's model picker report
  `isSessionsWindow: true` — without it the core picker treated an empty catalogue as Copilot's
  sign-in gate and the chip read `Models, sign in to use Copilot`.
- **Verified** (dev build + `--agents` + CDP DOM, fresh profile): the sidebar starts with
  `New Chat ⌘N` and has no `Sessions`; the title bar has no `Run Task…` (the IDE entry moved to
  x948); the whole window has 0 aria-labels containing `Copilot`; the chip reads `Models, Auto`
  and is still `disabled` (no real model in that profile ⇒ the base's fallback, not a claim of
  readiness); the IDE window (launched without `--agents`) still boots normally. Receipt:
  [`evidence/s4-agents-cursor-chrome-2026-09-14/`](evidence/s4-agents-cursor-chrome-2026-09-14/).

### S4 slice 3 — right panel wording and composer microphone (2026-09-14)

- `patches/desktop/0017` names the panel controls per §3.2 (`Enter Full Screen` /
  `Exit Full Screen` / `Hide Apps` on both the editor-title and empty-group toolbar sides) and
  hides the editor watermark in this window only via `browser/media/workbench.css` (the reference
  has none; it targets the watermark element rather than its wrapper, because the wrapper also
  hosts the panel toolbar §3.2 requires).
- `patches/desktop/0018` renames the composer microphone to `Start voice input` per §3.2.
- **Verified** (fresh profile + CDP): watermark `display:none` (was flex 272×859), toolbar reads
  `Hide Apps` (was `Close Editor Area`), mic aria is `Start voice input`; both patches stay inside
  `src/vs/sessions/**` and have tests pinning their text + digest. Receipt:
  [`evidence/s4-agents-app-panel-2026-09-14/`](evidence/s4-agents-app-panel-2026-09-14/).

### S4 slice 4 — Customize moves into the sidebar (2026-09-14)

`patches/desktop/0019` changes the default of `chat.agentSessions.customizationEntryPoints`
(`product.quality !== 'stable'` → `false`), because that setting *is* the base's existing choice
between "composer/header" and "Agents window sidebar", and §3 lists `Customize` in the sidebar.
**Verified** (fresh profile + CDP): `.sessions-customize-trigger` in the composer is 0×0 in a
`display:none` slot while `.agent-sessions-customizations-section` in the sidebar shows 129px with
a `Customizations` heading. It is the only patch that touches `src/vs/workbench/**`, so it is
deliberately a one-line configuration default, and every consumer of the setting lives under
`src/vs/sessions/**` (the IDE window is untouched). Receipt:
[`evidence/s4-customize-sidebar-2026-09-14/`](evidence/s4-customize-sidebar-2026-09-14/).

### S4 slice 5 — the pet does not mount when the easter egg is off (2026-09-14)

`patches/desktop/0020` changes three places under `src/vs/sessions/**` (no core file), because
*registering the host* is what actually creates the pet (DOM, listeners, timers, a11y nodes) and
unregistering can only park an already-created one: `chatView.ts` ANDs the setting into the
host-preference observable, `newChatInput.ts` registers from an autorun that tracks the setting,
and `newChatWidget.ts` only mounts the aquarium toggle while it is on.
**Verified** (fresh profile + CDP): `[class*=chat-pet]` = 0 nodes, `[class*=aquarium]` = 0 nodes,
and the strings `chat-pet`/`aquarium` do not appear in `body.innerHTML` at all (before, an overlay
and a 0×0 toggle button lingered). No automated DOM test exists in this repo (it would need the
desktop component-fixture infrastructure) — recorded as a gap. The 1710×1073 geometry check was
not possible in that pass: the renderer exposes no resize API and `Browser.getWindowForTarget`
over Electron's CDP does not answer, so it needs a manual run. Receipt:
[`evidence/s5-pet-unmounted-2026-09-14/`](evidence/s5-pet-unmounted-2026-09-14/).

### Agent Home sprint, slices 1-5 (2026-09-14 → 2026-09-15)

- **Slice 1** — `patches/desktop/0021` replaces the empty right-hand editor group with a **Caret
  utility pane** holding four launcher cards (Changes/Browser/Terminal/File), each invoking a real
  command Caret already had (`newChangesTab`, `newBrowserTab`, `toggleTerminal`, `quickOpen`), and
  sets the three column proportions per the reference (sidebar 255px, utility 22.5%) plus the
  608px centred composer. **Verified** (dev build + CDP on a real window): sidebar 255×861,
  centre 853 (59.4%), utility 324 (22.6% against the reference's 22.5%), composer 608×86 centred,
  cards 2×2 at 1153/1290 × 350/487 sized 129×129, no editor tab strip and no blank canvas.
  Note: the two reference screenshots the brief named were not supplied as files, so the recorded
  measurement in `docs/caret-ui-reference-baseline.json` was used as the baseline, and vision
  checking was impossible that pass (the image tool answered HTTP 429). Receipt:
  [`evidence/agent-home-visual-2026-09-14/`](evidence/agent-home-visual-2026-09-14/).
- **Slice 2** — `patches/desktop/0022` does the title bar, sidebar and column proportions:
  (1) `SessionsTitleBarContribution` is no longer mounted, so the 448px-wide `Show Sessions`
  widget leaves the middle of the title bar (that file is loaded only by the Sessions workbench,
  so the IDE never had this widget); (2) the sidebar gains the reference navigation — full-width
  New Chat/Search/Automations/Customize rows, a Projects section (a real `New Project` row and a
  `+` in the header), and a Repositories section built from the real workspace folders with a
  filter that reveals a working input — ending there, per the reference; every row calls an
  existing command, and `.agent-sessions-header-row` and `.agent-sessions-customizations-section`
  are removed from the DOM; (3) the sidebar/utility shares become the reference proportions
  (15.625% / 22.51%); (4) the utility pane draws no header/toolbar/divider in the empty home
  (title strip `display:none`, rect 0×0). **Verified** (dev build `VSCODE_DEV=1` + CDP):
  command-centre width = 0, the four nav rows in order, no detached Customizations, no old New
  Chat button, cards 75×60 CSS (150×120 captured against the reference's 148×120), the filter
  toggle really opens/focuses/resets, and divider ratios 15.669%/22.563% against 15.625%/22.510%
  ⇒ 321/1586 captured against 320/1587. Receipt:
  [`evidence/agent-home-visual-2026-09-14/receipt-slice-b1.json`](evidence/agent-home-visual-2026-09-14/receipt-slice-b1.json).
- **Slice B1 — launcher cards corrected once the real screenshot arrived (2026-09-15)**: the user
  supplied real screenshots of Cursor's Agents and IDE windows (3420×2224 = CSS 1710×1112 at DPR 2),
  measured with `scripts/image-ocr.swift` + `scripts/png-pixel-probe.py` (the vision model still
  answered 429), and the cards were **wrong**: the reference has 121×96 CSS cards with 13px gaps
  (grid 255×205), not 75×60/7. The spec's numbers (148×120 captured at 2048×1331) were the *same
  image downscaled from 3420 to 2048*, not device pixels of a 2x display
  (148 × 3420/2048 = 247 device px = 123.5 CSS). After fixing `agentHomeNav.css` and re-measuring
  at the same window size: cards 121×96 with 13px gaps in a 255×205 grid, sidebar 267 CSS (the
  reference's 267 exactly), utility starting at 1321 against the reference's 1325 — 4 CSS from the
  workbench's right gutter consuming 1706 of 1710. So both the share and the card size now match.
  A discovered conflict was also closed: the reference has **no** Getting Started card and **no**
  profile/settings row, while the spec draft required them — **the user chose Cursor's rendering**,
  so both blocks were removed (the ability to open a folder remains in the `New Project` row, the
  Projects `+` and the Repositories add button) and a test pins their absence.
- **Slice 3 — composer starters (2026-09-15)**: `patches/desktop/0023` gives the empty home the
  starter rows below the composer card. Caret already owns that surface (`INewSessionComposer`
  renders prompt options and inserts the chosen prompt with its placeholder selected) but the base
  only showed them from the `sessions.onboarding.newSessionViewV3` onboarding tour, behind a
  Copilot experiment flag and a "no recent sessions" trigger, so the Agents window never showed
  them; the patch attaches the controller directly and **writes no new copy** — the three starters
  are the base's existing strings (implement a feature / fix a bug / fix CI) exported from the file
  that owned them rather than copied. CSS takes the card to the reference's 104px height (103.5)
  and puts the starters below it, one line each. **Verified** (dev build + CDP): card 608×104,
  three starter rows of 28px each 12px below the card. Receipt:
  [`evidence/agent-home-visual-2026-09-14/receipt-composer-starters.json`](evidence/agent-home-visual-2026-09-14/receipt-composer-starters.json).
- **Slice 4 — composer context row (2026-09-15)**: `patches/desktop/0024` adds the two chips the
  reference puts beside the Agent Home workspace picker. The **branch chip** reads
  `session.workspace.folders[0].gitRepository.branchName` (the same value the base's own session
  actions read) and clicking it runs the base's real
  `sessionsViewPane.agentHost.copySessionBranchName` command, so it copies the branch name rather
  than implying a selection Caret cannot make; it is not rendered when there is no branch. The
  **runtime chip** reads `This Mac` only while no remote agent host is connected
  (`IAgentHostConnectionsService.connections`), the truthful reading of the single execution target
  Caret offers, and it is a label rather than a button because there is no target picker to open.
  **Verified** (dev build + CDP): the `This Mac` chip is 83×24 in the picker row (608×24 at y=292),
  the composer card is 608×104, and there are three starter rows. Receipt:
  [`evidence/agent-home-visual-2026-09-14/receipt-context-row.json`](evidence/agent-home-visual-2026-09-14/receipt-context-row.json).
  Still unverified live: the branch chip (the test profile has no workspace open in the Agents
  window, and the IDE→Agents handoff launch did not boot in the available time — recorded as "not
  done", not as "passed"). Still missing: the `High` effort chip (needs a provider config action,
  the same S2 gap as the model picker) and the `Plan New Idea`/`Multitask` chips (no such concept
  exists in the code; it needs a new composer mode). The reference also draws a chevron on the
  chip; Caret uses an icon and no chevron.
- **Slice 5 — title bar regions (2026-09-15)**: `patches/desktop/0025` moves the buttons as the
  user instructed and to match the reference: **left** = [Toggle Side Bar][Go Back][Go Forward]
  (previously back/forward came first), **right** = [IDE][Show Panel][Toggle Side Panel]
  (previously IDE was rightmost). It edits `browser/parts/titlebarPart.ts` (mounting nav into
  `.titlebar-left` and open-in-VS-Code into `.titlebar-right`) and
  `browser/parts/media/titlebarpart.css` (order 1/2 on the left, 1/2/3 on the right).
  **Verified** (dev build + CDP): left `Toggle Side Bar @84, Go Back @112, Go Forward @135`; right
  `IDE @1337, Show Panel @1365, Toggle Side Panel @1388`. Receipt:
  [`evidence/agent-home-visual-2026-09-14/receipt-titlebar-regions.json`](evidence/agent-home-visual-2026-09-14/receipt-titlebar-regions.json).
  **Important**: the first half of this work (mounting the toolbars into left/right) had been
  sitting in the desktop checkout with **no patch covering it** — a scan of all 51 dirty files in
  `src/vs/sessions` found exactly these two files uncovered ⇒ the patch also closes a
  reproducibility hole (previously `prepare-desktop` on a clean checkout produced a title bar
  without this placement). Still open: the reference has no Show Panel/Toggle Side Panel buttons
  at all, but ours do because they use layout actions shared with the IDE (removing them needs a
  decision about how much the Agents window may hide).
- **Investigation into why Terminal/Browser/File did not open as right-hand tabs (2026-09-15)**:
  the user asked for the three cards to open as tabs in the right pane (they were landing in the
  bottom panel). Findings:
  - The Terminal card called `workbench.action.terminal.toggleTerminal`, measured landing in
    `.part.panel` at `[225,600,1211,296]` (the bottom) — real.
  - **Structural cause**: the Agents window **pins** the `terminal.integrated.defaultLocation`
    setting to `'view'` with `readOnly` in
    `src/vs/workbench/contrib/terminal/common/terminalConfiguration.ts`
    (`agentsWindow: { default: 'view', readOnly: true }`) — that setting is the "terminal becomes
    an editor tab" switch, but the file is core (outside `src/vs/sessions/**`).
  - Switching the card to `workbench.action.terminal.createTerminalEditor` (the real command that
    creates a terminal in the editor area) produced **no terminal at all** — editor group had 1
    group, 0 tabs, no terminal element ⇒ the sessions workbench's terminal surface does not
    support the editor location.
  - The card was therefore **reverted to `toggleTerminal`** so it does not die, and patch 0021 +
    manifest + tests were recomputed.
  - **Option (A) tried and insufficient** (the user chose A): changing
    `agentsWindow: { default: 'view' }` → `'editor'` in core and then measuring three commands
    live showed `toggleTerminal` still landing in the panel (`terminalInPanel: true`, panel
    `[225,600,1211,296]`) while `terminal.new` and `createTerminalEditor` created **no terminal at
    all** (panel `[0,0,0,0]`, editor group 1 with 0 tabs, `.terminal-outer-container` 0) ⇒ the
    limiting factor is not the setting but the sessions workbench's terminal integration, which
    only allows creation as a view (panel). Both changes were reverted (core back to `'view'`, card
    back to `toggleTerminal`) to return to the last verified state — the route that will work is
    (B) or a new surface in the right pane.
  - Browser (`NEW_BROWSER_TAB_COMMAND_ID`) and File (`workbench.action.quickOpen`) were **not
    checked live** in that pass (the harness hung after clicking Browser) — File presumably already
    lands in the right editor group because quickOpen opens in the active editor group.
- **Route B: all causes found (2026-09-15)** — using the command palette driven by CDP trusted
  keyboard to fire real commands in the running window:
  - `Terminal: Create New Terminal` **works** → the panel appears at `[225,600,1211,296]` with a
    terminal inside ⇒ creation + profile/cwd are fine.
  - `Terminal: Create New Terminal in Editor Area` → **nothing happens** (panel `[0,0,0,0]`, no
    tab, no `.terminal-outer-container`, no error or log).
  - `Terminal: Create New Terminal in Editor Area to the Side` → the **editor group resizes**
    (322 → 444 wide) but **no terminal renders** ⇒ creation begins but the terminal editor pane is
    never shown.
  - The pane is genuinely registered in this entry: `terminal.all.js` → `terminal.contribution.js`
    registers `EditorPaneDescriptor(TerminalEditor)` + serializer + `ITerminalEditorService`.
  - **Structural cause**: the Agents window locks the panel to the bottom **in code**, not by
    setting — `src/vs/sessions/browser/workbench.ts` returns `Position.BOTTOM` from
    `getPanelPosition()`, `setPanelPosition()` is a no-op, `getPanelAlignment()` is `'justify'`, and
    the **grid is hard-coded** by putting `panelNode` as the second child of the right column
    (`data: [topRightSection, panelNode]`) ⇒ even `View: Move Panel Right` does nothing (confirmed
    live), and `workbench.panel.defaultLocation` is pinned to
    `agentsWindow: { default: 'bottom', readOnly: true }` too.
  - **Conclusion**: "move the panel to the right" is not a setting question (it would mean
    rebuilding the sessions grid, risking the column proportions just calibrated), but the route
    that matches Cursor is to **host the terminal in our own right-hand pane**, because
    `ITerminalInstance.attachToElement(container)` exists (`terminal.ts:1286`,
    `terminalInstance.ts:1066`) — exactly what Cursor does (a `zsh` tab in the right pane) and
    entirely within `src/vs/sessions/**`.
  - All experiments were **reverted** (both the pin and `getPanelPosition`), returning the tree to
    the last verified state (23 patches, 55 pass, ci-validate OK).
- **D: Apps panel strip — one strip, one tab per instance (2026-09-15)**:
  - **The terminal really lives in the right pane**: `AgentHomeUtilityEditor` creates its own
    instance with `ITerminalService.createTerminal({})` and calls
    `ITerminalInstance.attachToElement(container)` ⇒ the Terminal card (and the `+` card) opens
    **one tab per instance** in the panel's strip rather than the bottom panel (measured live:
    2 `zsh` tabs, 2 xterms, 1 active container sized 322×788, `.part.panel` width 0 throughout; the
    active instance's buffer read `echo apps-tab-ok` → `apps-tab-ok`).
  - **"Tabs do not line up" fixed at the cause**: previously, as soon as a Browser tab existed the
    editor group drew its own title strip (upper row) while the panel drew its own (lower row), so
    Browser sat one row above the terminal. Now the panel draws the pane's **single strip**
    (`:has(> .editor-container .caret-apps-panel) > .title { display:none }`) ⇒ every control sits
    on one row at top 42 with height 24 (Review, Browser, Terminal, File, `zsh` ×2, `+`, toggle),
    and when a real editor tab is active (e.g. Browser) the panel is not in the DOM so only the
    group's strip remains (`Apps | Browser`, top 36).
  - **`workbench.editor.showTabs` for the Agents window = `multiple`** (was `none`, which forced a
    single label) because the reference panel is a tab group; changed in
    `apps/macos/src/workbench-mode.ts` + `extension.ts`, with a guard against reading Caret's own
    value back as the IDE's layout (`AGENTS_EDITOR_SHOW_TABS`).
  - **The first entry became `Review`** as the user specified (the same surface as the old Changes
    tab, `NEW_CHANGES_TAB_COMMAND_ID`), with `Browser`/`Terminal`/`File` as before. Entries in the
    strip are icon + tooltip because the column is 322px wide (the reference is wide enough for
    labels); the same entry's label form is the card in the empty body.
  - **Toggle Pinned Summary** (after Codex): a pin button at the end of the strip toggling a
    summary bar above the body, reading the **real session** from `ISessionsService.activeSession`
    (title/status/branch) and saying `No active session` plainly when the page has none.
  - **Show Apps command** (`caret.agentHome.showApps`): the base only had the hide half
    (`Hide Apps`), so opening Browser/File over the panel left no way back. It is now invocable from
    the palette, and selecting the `Apps` tab in the group's strip also returns (confirmed live
    that the terminal survives and still takes input).
  - **Column proportions unchanged**: the right column stays 324px (22.6%) — the share is
    recomputed only when the *container size* changes, because on first open the layout is not yet
    settled and the share was computed from the old width, coming out at 30% (430px); dragging the
    sash is not overridden.
  - Receipt: [`evidence/agent-home-apps-panel-2026-09-15/`](evidence/agent-home-apps-panel-2026-09-15/)
    (with screenshot) · 570 pass, ci-validate OK.
- **D2: everything in one strip + a choosable `+` + browser fitted to the pane (2026-09-15)**:
  - **`+` = the reference's `Open new tab menu`**: it opens a picker for Review / Browser /
    Terminal / File (previously `+` created only a terminal).
  - **Browser is a tab in our own pane**: `IBrowserViewWorkbenchService` → `IBrowserViewModel`, with
    the pane owning the overlay bounds (`model.layout({ windowId, x, y, width, height, zoomFactor,
    cornerRadius })` from each tab's container rect on every layout, plus `setVisible` per active
    tab and `setEditorVisible`) ⇒ the page **fits the pane** (measured container
    `[1113, 72, 322, 791]` against pane `x=1112 width=324`; the previous editor-tab route let the
    page spill outside the pane).
  - **No URL bar in the hosted view yet**: opening a browser tab asked for an address once and then
    called `model.loadURL()`; in-page links and redirects keep working. Full chrome would mean
    mounting `BrowserUrlBarWidget` into the pane (recorded in the receipt).
  - **Confirmed live**: `+` → Browser → `example.com` produced a tab named `Example Domain` in the
    panel's strip (the group still had the single `Apps` tab, no separate Browser tab) and
    `.part.panel` width 0.
- **D3: entry and `+` share one path (2026-09-15)** — the user reported that Browser still lived
  inside the app rather than in the same strip as terminal and file. Cause: the **Browser icon in
  the strip** still ran the sessions command that opens a real editor tab in the group (only the
  `+` route hosted it in the pane). Fixed by making the entry and `+` call the same `runLauncher`:
  an entry the pane can host itself (Browser, Terminal) opens in the pane as one tab per instance.
  Measured live: all on one row at top 42 with height 24 — `Review · Browser · Terminal · File ·
  zsh · Browser · + · pin`; the group still had the single `Apps` tab, `.part.panel` width 0, and
  the browser container `[1113, 72, 322, 791]`. Note: `Review` and `File` still opened real editor
  tabs in the group at that point (hosting a diff/text editor in the pane is a separate body of
  work).
- **D4: browser "not working" = a tab with no URL + the `+` menu in the middle of the screen
  (2026-09-15)** — the user reported "browser is not working (still show only tab)" and "the `+`
  button appears in the middle of the screen".
  - **Cause 1**: the option list used `IQuickInputService.pick`, a window-centred overlay ⇒
    replaced with `IContextMenuService.showContextMenu` anchored to the button (measured live:
    button `[1379, 42, 24, 24]`, menu `[1241, 90, 162, 106]`, items
    `Review / Browser / Terminal / File`), sharing the entry's action set.
  - **Cause 2 (the real reason for "I only see a tab")**: if the user cancelled the address prompt,
    the old code still created a tab with no URL ⇒ an empty pane that looks like a broken browser.
    Now cancelling or leaving it empty **disposes the view and creates no tab at all**.
  - **Confirmed the view really renders** with a window capture compositing the overlay
    (`screencapture -l`) plus a pixel probe: the pane's upper zone contained 10,806 px of
    `rgb(48,48,48)` page text on a `rgb(238,238,238)` ground while the lower zone was uniform; the
    renderer read back `model.visible=true` and bounds
    `{windowId:1, x:1113, y:72, width:322, height:791}`.
  - 570 pass, ci-validate OK · receipt + screenshot `apps-panel-browser-rendering-pixels.png`.
- **D5: instances moved out of the pane + the browser gets its own address bar (2026-09-15)** —
  the user reported that `+` still could not open a browser.
  - **`IAppsPanelModel`** (`contrib/home/browser/appsPanelModel.ts`) is a window-scoped singleton:
    the pane attaches the instances' DOM while shown and detaches it when it goes away, rather than
    owning them ⇒ terminals and browsers survive closing/reopening or switching the pane (before,
    the pane owned them and disposed them with itself). A newly created instance becomes the active
    tab (otherwise a terminal that was never shown never opens its xterm).
  - **The dialog is gone** — a browser tab has **its own address bar** (back / forward / reload /
    address + Enter), so pressing Browser is immediately usable. Overlay size follows the address
    bar: view `[1113, 105, 322, 758]`.
  - **Confirmed live**: `+` → Browser produced a tab with an address bar → typing `example.com` +
    Enter changed the title to `Example Domain`, bounds `{windowId:1,x:1113,y:105,width:322,
    height:758}`, `visible=true`; zsh and Example Domain sat on the same row; the group still had
    the single `Apps` tab; collapsing/expanding the side pane kept both tab and page.
  - **Correcting an earlier note**: the tabs disappearing mid-session were caused by an agent
    relaunching the dev build with a fresh `--user-data-dir`, not by the layout closing the pane.
  - 570 pass, ci-validate OK · screenshot `apps-panel-browser-address-bar.png`.
### R1 + R2 close-out (2026-09-15)

Landed and **confirmed with typecheck + the real built output + the repo suite** (no part of it was
confirmed on screen, because an app cannot be left open across tool calls in that environment):

1. `react`/`react-dom` 18.3.1 are real dependencies of the fork (+ `@types/react`,
   `@types/react-dom`).
2. **The Apps panel strip is 100% React** — rail (`mountAppsLauncherRail`), instance tabs
   (`mountAppsTabStrip`), `+` + summary toggle (`mountAppsStripActions`), summary panel
   (`mountAppsSummary`) and empty-state cards (`mountAppsEmptyState`). The pane keeps only each
   tab's "body", the address bar, the context menu and the model. Evidence: the built output
   contains all five mounts and `agentHomeUtilityEditor.js` no longer contains the strip markup the
   pane used to build.
3. **Vocabulary matches the reference**: the first entry is `Changes`, and `+` carries
   `aria-label="Open new tab menu"` (patch 0027 turns `Add Tab` into `Open new tab menu` in the
   Agents window only, using `IsSessionsWindowContext`; the IDE keeps the original wording).
4. **One geometry for the strip**: a single `--caret-apps-control-size` + `--caret-apps-gap`
   across the whole row (previously 24×26 / 24 / 22×22 mixed, so browser and terminal tabs did not
   share a baseline).
5. **The token layer covers the Agents window**: the CSS reads `var(--caret-*, <fallback>)` and a
   test enforces that every fallback equals the real value in `CARET_TOKENS`. The extension cannot
   write CSS into the workbench DOM, so the real injection has to happen at the workbench level
   (not done yet).
6. **Pane switcher semantics (corrected to match the code, 2026-09-15)**: currently **every entry
   opens its own instance** — the rail and the `+` menu choose from the same app set, and pressing
   an entry again is how a second terminal/browser is opened. (An earlier version made the rail a
   pane selector that reused an open instance, which read as "nothing happened"; the user confirmed
   on screen that opening a new one is the correct behaviour.) So converting to the reference's
   single fixed pane switcher is not "a small wiring job" but the same class of structural work as
   item (1).
7. Bugs typecheck caught along the way: `Action` taking a `ThemeIcon` instead of a CSS class (icons
   in the `+` menu never appeared), an unused import, and the browser tab not showing a page (the
   model's `visible` started `false` and the pane never set it back).

**Next steps in order of impact** (correcting an earlier claim that `changes`/`file` active state
was "a small wiring job" — **it is not**, verified 2026-09-15): our `changes`/`file` ran
`workbench.action.agentSessions.newChangesTab` / quick open from `contrib/editor/browser/
addTabActions.ts`, i.e. **add-tab actions that open managed editor tabs**, so those two were never
panes of the Apps panel at all, and marking them active was a *side effect* of structural work
rather than a standalone task. The order was therefore:

1. **Make the panel's four entries switch panes inside the panel** (Changes/Browser/Terminal/File
   as real panes of the panel, matching the reference) — the genuine remaining structural piece,
   and the reason the S4 receipt still said our panel was "editor group, not the reference's
   fixed-tab panel" → landed 2026-09-16, see "pane switcher" and "changes/file as panes" below.
2. **R3 sidebar Projects/Repositories/Search as React** (the largest remaining item) → landed
   2026-09-15, see below.
3. The composer (reasoning popup `High` + the project/branch/`This Mac` row) → context chips landed
   2026-09-16.
4. Injecting `--caret-*` at the workbench level.
5. **Comparing AX/DOM against the reference**, never done yet and the real decider for "identical".

**A real hazard encountered**: files under `desktop/src/vs/sessions/contrib/home/browser/` were
being edited from several directions during that round (edits that were not mine broke patches
mid-flight twice) ⇒ always re-read the latest state before editing that group, and never revert
work you did not do.

### Patch drift closed + the user's theme reaching the Agents window (2026-09-15)

Receipt: [`evidence/agent-window-theme-profile-2026-09-15/`](evidence/agent-window-theme-profile-2026-09-15/).

1. **`prepare-desktop` was red before this round** because the checkout had drifted past three
   files (`agentHomeUtilityEditor.ts`, `agentHomeUtility.css`, `build/next/index.ts`) ⇒ `0021` was
   re-cut from the checkout (not reverted, because that state is what the user had confirmed on
   screen) and `0028` was added for React inlining. The correct re-cut procedure is in §6.1 (it
   requires `--index`).
2. **`0027` went back to being a normal patch** — it edits the base's `editorTabsControl.ts`, not a
   file `0021` creates, so it does not hit the reverse-check limitation (this corrects an earlier
   note in §6.1 that said to withdraw 0027).
3. **The theme needs two layers fixed, not one**:
   (a) **Why the theme was not registered**: `canExecuteOnSessionsWindow()` disables every
   extension with `main`/`browser` ⇒ a theme that also has its own settings section (Catppuccin
   pairs `configuration` with `themes`) is not registered in that window. The escape hatch upstream
   provides is `extensions.supportAgentsWindow`.
   (b) **Where that window reads settings from**: *not* `profiles/builtin/agents/settings.json` as
   first assumed — `AGENTS_WINDOW_PROFILE_FLAGS.settings = true` makes that profile use the default
   profile's `settingsResource`, and nothing reads the file in the `agents` profile (confirmed on
   the real app: an override placed there left the theme stock). What the window actually reads is
   its own workspace file (`agentSessionsWorkspace` = `User/agent-sessions.code-workspace`, which
   the sessions workbench already uses to write `chat.disableAIFeatures`).
   ⇒ `syncAgentsWindowTheme()` writes to that workspace file both on activate and on settings
   change: theme keys + the user's `extensions.supportAgentsWindow` + the list of extensions that
   *provide the user's selected theme* (matching both id and label), without hardcoding names. See
   the receipt for detail.
4. **Confirmed**: `prepare-desktop` = 26 patches/18 removals · applying the whole set to a clean
   worktree reproduces the checkout for every source file · `bun run typecheck` · `ci-validate` ·
   `cursor-parity-check` (340 keys, 0 mismatches) · suite 734 pass · `workbench-mode.test.ts` 20
   pass · **on screen (CDP)**: the Agents window ran
   `Catppuccin-catppuccin-vsc-themes-mocha-json` (`--vscode-editor-background: #1e1e2e`) and the
   Apps panel still matched the brief (4-entry rail, readable `+` menu, two rail presses producing
   two instance tabs).
5. **Remaining**: the theme in the light slot and live theme switching with both windows open. The
   earlier "must tell the user" case (Latte in the dark slot) is gone because the carry overwrites
   with the user's real values each round — but Caret never touches the values in the user's own
   `settings.json`.
6. **R3 landed (2026-09-15)**: the sidebar navigation is a React surface like the Apps panel.
   `agentHomeNav.ts` keeps "model + wiring" (which rows exist, what command each runs, filter
   open/close, and which rows to hide because which workspace folder is a repository, plus the
   delegated context menu), while `agentHomeNavReact.ts` owns the markup. The seam is
   `onRow`/`onAction`/`onFilterInput` with the pane holding a `Map<string, () => void>`, and every
   class name is unchanged ⇒ CSS, tokens and the parity gate see no difference. Confirmed on screen
   (CDP): the rows match the reference, `Projects` has a `New Project` action, `Repositories` has a
   filter toggle with `aria-expanded=false` plus `Add Repository` and an empty note, and pressing
   the toggle really opens the input. Receipt:
   [`evidence/r3-sidebar-react-surface-2026-09-15/`](evidence/r3-sidebar-react-surface-2026-09-15/).
   Not yet confirmed: that profile had no workspace folder, so filtering rows was not exercised
   (toggle/input work), nor was drag-reordering project groups. R4 has not started.
7. **Two bugs the user hit (same round, 2026-09-15)**: (a) "cannot open another browser tab from
   `+`" — the `+` did create a new instance correctly, but the **rail** still reused because the
   workbench bundle in the app was the 21:21 build while the source had changed at 21:49, and
   `--package` only rebuilds the Caret extension ⇒ the fix is
   `node build/next/index.ts bundle --minify` + copying `desktop/out-vscode` over `app/out/` and
   packaging again (writing after sealing requires re-signing). (b) The user icon in the top-right
   of the Agents window is the sessions workbench's account widget, and Caret has no account to
   show there ⇒ patch `0029` sets `when: ContextKeyExpr.false()`. Both confirmed on screen (the
   rail/`+` does add tabs and the new tab is the shown one · the widget is gone).
8. **A bug a DOM probe cannot see (2026-09-16)**: (a) `+` could not open a second browser tab — the
   previous round concluded "the `+` menu is fine" because the probe fired through **CDP, which
   injects into the renderer**, while the browser screen is a **native view painted over the DOM**
   ⇒ a real click hits the page, not the menu. Fix: `0021` (`agentHomeUtilityEditor.ts`) hides the
   hosted page before opening the menu (`hideBrowserForPopup`) and restores it on `onHide`
   (`restoreAfterPopup` → `applyActiveTab`). (b) The "installation appears to be corrupt"
   notification on every launch did not come from copying bundles but from all 10
   `product.json.checksums` entries being wrong since the app was assembled (even files nobody
   touched) ⇒ `scripts/build-caret.ts --package` recomputes checksums against the real files before
   signing, and they must be **sha256 base64 with the `=` stripped**, because
   `ChecksumService.checksum` uses `digest('base64').replace(/=+$/, '')`. Confirmed with a real
   mouse (Computer Use): `+`→Browser twice in a row gave 4 → 5 tabs, and the new window showed no
   corruption notification. Receipt:
   [`evidence/apps-panel-popup-over-native-view-2026-09-15/`](evidence/apps-panel-popup-over-native-view-2026-09-15/).
   **Durable lesson**: anything the pane paints as DOM over its own bounds (menus, dropdowns) must
   be tested with real input only — a renderer-level probe cannot see a native page. Check any
   future popup (pinned summary, etc.) the same way.
9. **Pinned summary (2026-09-16)**: **Cursor has no such feature at all** — its bundle contains
   `Open new tab menu` but no `Toggle Pinned Summary`/`summary-pinned`, and §4 classifies this
   surface as Caret's own (inspired by Codex). The Codex app could not be inspected (Computer Use
   refused `com.openai.codex`), so nothing is claimed about its window. **Decision: not a floating
   window** — the SSOT is one owner of execution/transcript and windows are projections, so an
   always-on-top overlay would add new lifecycle (mode switches, host restart, display changes) and
   would need native work on macOS; the case it would help (watching the summary while in the IDE)
   is already the dock's job. What pinning really needs to do is "survive the pane being recreated"
   ⇒ `summaryPinned` + `toggleSummaryPinned()` moved into `IAppsPanelModel` and the pane mirrors
   from the model (`applySummaryPinned`, called from `renderTabs` so it applies on pane creation
   too), folded into patch `0021`. Receipt:
   [`evidence/pinned-summary-model-state-2026-09-16/`](evidence/pinned-summary-model-state-2026-09-16/).
   Not yet confirmed: the path where the pane is genuinely torn down could not be reproduced
   (toggling the side panel and opening a File card both left the panel element alive — the tag
   survived both routes), so this is confirmed by structure and on-screen behaviour rather than by
   an observed teardown.
10. **Closing the remaining parity queue (user-approved 2026-09-16)**: keep all §5 deviations, skip
    what only Cursor has (Tab/cloud/subagent/private model) and work the queue 1-4.
    **Item 1 done**: the composer's context chips are React (`agentHomeContextRowReact.ts`) ⇒ every
    Agent Home surface Caret authors and renders is now **entirely React** (Apps panel, sidebar nav,
    context chips), while the starter rows belong to the base and the pane scaffolding is
    necessarily DOM (container/terminal attach/native bounds). This also corrects an earlier review:
    `agentHomePromptOptions.ts` and `agentHomeUtilityInput.ts` **create no DOM at all** (the first
    is a controller into the base's API, the second is an `EditorInput`) ⇒ the React gap was
    genuinely one file. Folded into patch `0024`. Receipt:
    [`evidence/context-row-react-surface-2026-09-16/`](evidence/context-row-react-surface-2026-09-16/).
    Not yet confirmed: the branch chip (that session had no branch, so only the runtime chip was
    visible) and the React root re-mounting when the composer rebuilds itself (the guard works, but
    a rebuild was not forced).
    **Item 2 done (JSX)**: `src/tsconfig.json` sets `jsx: react-jsx`, includes `.tsx` and excludes
    the diffing fixtures (new patch `0030`); `build/next/index.ts` sets esbuild `jsx: 'automatic'`
    and inlines `react/jsx-runtime` as well (folded into `0028`); and
    `agentHomeContextRowReact.tsx` is written in JSX as proof ⇒ new components can now be written
    the way the reference does it. Confirmed: typecheck-client clean, the bundle has no external
    `react/jsx-runtime` import left, the window loads and the JSX component really renders, suite
    593 pass (with a new test covering the JSX config).
    **Item 3 slice 1 done**: the Apps panel strip is a real pane switcher matching the reference —
    `runLauncher(launcher, mode: 'reuse' | 'new')` separates the two halves explicitly: a strip
    entry is `reuse` (switch to the existing pane + mark active), the `+` menu is `new` (add an
    instance), and the empty-state card is `new`. They share one path so the two halves cannot
    interpret "Browser" differently, which is what had happened before. Confirmed on screen: the
    first rail press on Browser gave 1 tab and marked it active, a second press still 1 tab
    (switching panes, not adding), and `+` → Browser gave 2 tabs ⇒ matching the reference behaviour.
    Receipt: [`evidence/panel-pane-switcher-2026-09-16/`](evidence/panel-pane-switcher-2026-09-16/).
    Not yet confirmed: the pane actually visible after switching was read from tab state + rail
    marks rather than from the native overlay (no real-mouse run), and **`changes`/`file` were still
    editor-group tabs**, which is the rest of item 3.
11. **Item 3b done (2026-09-16): `changes`/`file` are real panes of the panel.** Those two entries
    used to run commands (`newChangesTab`, quick open) ⇒ their surface appeared as an editor-group
    tab, and in an empty window the command opened nothing at all ⇒ the two buttons looked dead.
    Now all four entries are `hosted`: `createChanges()`/`createFiles()` are single-instance (one
    active session, one workspace ⇒ a second tab would repeat the same content) and the pane hosts
    **the base's own surfaces** — Changes = `ChangesViewPane` (inside a `PaneView`; `pane.render()`
    must be called manually because there is no view container to do it), File = `EmptyFileEditor`
    (empty state + the Files tab's Search Files). The file tree itself remains the base's Files
    view, because `IExplorerService.registerView()` has a single `view` slot and a second explorer
    inside the panel would take it from the window. **Bug found during verification**: the rail
    mark was updated in `renderTabs` (a model change), so switching to an already-open pane did not
    re-mark it → moved to `applyActiveTab`.
    Confirmed with a **real mouse** (Computer Use, path-targeted): the Agents window's AX shows four
    rail toggle buttons + `Open new tab menu` + `Toggle Pinned Summary`, and the menu bar has no
    Selection/Go/Run/Terminal · `+` → File/Changes produced a pane in the panel with the rail
    marked, switching the rail back and forth added no tab, `+` → Browser twice (the menu opening
    over the hosted page) gave 1 then 2 tabs, and switching the rail between the hosted pane and
    the hosted browser worked in both directions · CDP confirmed the editor group still had the
    single `Apps` tab and the title strip was still `display:none` ⇒ no Changes/File tabs in the
    group any more · gates: `prepare-desktop` (28/18), `desktop-patch-set.test.ts` (apply per
    manifest then byte-compare with the checkout), typecheck-client, `apps/macos/test` 594 pass,
    typecheck, cursor-parity (340 keys, 0 mismatches), ci-validate · the `0021` needle that pinned
    the old `commandId` was replaced with a hosted-pane needle and `0021`'s digest was re-cut with
    it. Receipt:
    [`evidence/apps-panel-changes-file-panes-2026-09-16/`](evidence/apps-panel-changes-file-panes-2026-09-16/).
    Not yet confirmed: any **picture** (vision returned HTTP 429 for both the sky screenshot and the
    window capture ⇒ nobody "looked" at either pane; colour, type and spacing are unmeasured) · the
    File pane is an empty state + Search Files, not a tree · the Changes pane is a changes view,
    not a multi-diff ⇒ **it remains an open question what the reference puts under the `Changes`
    entry** (AX only yielded the entry's name) · nothing was run against a real session with
    changes (there was no session that round, and the base showed an `Agent Host failed to start`
    banner that predates this round).
12. **The model picker's open question is closed (2026-09-16)** — "is OMP not advertising models,
    or did our bridge lose them?" Answer: **OMP advertises 6 models and the bridge's normaliser was
    correct, but there was no OMP process to ask when the read happened.** Measured through the
    host API: a session the host has not started answers `not_dispatched` ("Start or reconcile the
    OMP session before sending commands" — the host's own guard) ⇒ an empty snapshot ⇒ an honestly
    disabled picker. After `POST /start`, `ack.data.models` gave 6 rows (`cursor-agent` ×1,
    `openai-completions` ×2, `openai-responses` ×1, `openai-codex-responses` ×2) and
    `get_login_providers` gave 72 rows. A second bug surfaced: starting **changes the incarnation**
    ⇒ a command sent with the old incarnation got HTTP **409 `stale_incarnation`**.
    Fixed in `apps/macos/src/chat-sessions.ts` (`snapshotWithOmpRuntime`): read the catalogue once,
    and if it is `not_dispatched`, start the session **once** and re-read with the incarnation the
    start returned (host down = do not start and stay empty; start failure = fall back to the
    refused answer ⇒ still honestly disabled). This is used by both the registration/draft probe and
    the session-open path, and `fetchOmpModelSnapshot` gained a `catalog` option so the successful
    path does not ask twice ⇒ there is no second path for the catalogue (OMP's RPC still owns it;
    nothing reads `omp models`/`models.db`).
    Confirmed: 3 new unit tests (refused→start→retry with the new incarnation; warm→no start and
    exactly one catalogue call; host down→no start) · suite 740 pass (was 737) · typecheck clean ·
    a live host with 3 sessions answers the catalogue (before the fix only 1, the manually started
    one) · **on screen (packaged app)**: opening a session gave a picker of `139×22`,
    `disabled: false`, label `DeepSeek V4.1 Flash`, and a **real mouse** click opened a menu with
    `Search models` + a `Current model` mark + the 6 catalogue rows.
    The cost paid: a window that has never sent a prompt starts one OMP process to read the
    picker (the same process the first prompt would have started). Receipt:
    [`evidence/omp-model-catalog-2026-09-16/`](evidence/omp-model-catalog-2026-09-16/).
    Not yet confirmed: the composer in draft state (no session open) is still `0×0` and disabled —
    that is the new-chat widget's condition, not the catalogue's; a fresh install with no session is
    still honestly empty (showing a model before there is work would need a read path not tied to a
    session, such as a host-owned route), and this round did not press a model and verify that
    `set_model` actually writes.
13. **The "connection" icon was removed + an audit of the Agents window chrome (2026-09-16)**: the
    user reported that the top-right icon (on the right-panel side, "connection") does not work.
    CDP identified it exactly: `li.action-item.tunnel-host-toggle` at 1386,7 with aria-label
    **"Allow connections from other machines"**, which `SessionsTunnelHostTitlebarContribution`
    appends to `Menus.TitleBarRightLayout` and which runs
    `executeToggleRemoteConnections(..., { authenticationProviderId: 'github' })` — a remote tunnel
    requiring GitHub sign-in, which this fork does not ship ⇒ it opened a flow that cannot finish.
    Fixed with **new patch `0031`** (a base file no other patch touches, so it stands alone per
    §6.1): `when: ContextKeyExpr.false()` + removal of the import that only the old gate used +
    manifest digest + a paragraph in `patches/desktop/README.md` + a new needle test. The
    declaration and view item stay registered, exactly as in `0029`.
    **Drift repaired along the way**: `prepare-desktop` was red beforehand (`integrity mismatch:
    0003`) because `0003`/`0010` had been re-cut a second time in the working tree after their
    digests were updated. Updating the digests to match the real files gave **29 patches / 18
    removals** passing + `desktop-patch-set.test.ts` reproducing.
    Confirmed: typecheck-client 0 errors · typecheck · ci-validate · parity (340 keys, 0
    mismatches) · suite 749 pass (1 failure = `menus-contract.test.ts`, which needs an `rg` binary
    this machine lacks) · on screen (real packaged app): before `.tunnel-host-toggle` = 1 → after =
    **0**, `codicon-radio-tower` = 0, no aria-label containing "connection"; that row is left with
    `Toggle Side Panel · Show Apps · IDE`; the IDE window still boots normally. Receipt:
    [`evidence/agents-no-remote-connections-2026-09-16/`](evidence/agents-no-remote-connections-2026-09-16/).
    **Chrome audit still open (each needs a decision, not a silent hide)**: this window's composer
    still shows Copilot-chat concepts above a harness that does not implement them —
    **`Configure Tools…`** (the base's tool set, "applied globally for all chat sessions that use
    the default agent" ⇒ no effect on OMP), the **Permission picker** (`Default permissions /
    Allow all / Autopilot` ⇒ a different model from OMP's approvals per §4), and the **`Agent` mode
    picker** (`Configure Custom Agents…`, with no surface) · and the sidebar list still has an empty
    `Chats` group ("No chats") that the reference does not have (there is a setting,
    `sessions.list.showEmptyDefaultGroups`). Each must be either wired to OMP, hidden, or
    disabled with a reason (§5).

14. **The base Agent Host is no longer started, so the "Agent Host failed to start" banner is gone
    (2026-09-16)**: the user reported that the banner appears every time the window opens ("why
    failed? we use OMP and it worked already?"). It was never about OMP: the Agents window starts
    the base **Agent Host** utility process (the host for the Copilot/Claude/Codex harnesses) at
    restore, and that process cannot boot because S1 removed the Copilot services its node-side
    graph still requires — the log says it plainly:
    `[AgentHost:stderr] [createInstance] agentHostCustomizationEnablementService depends on
    copilotApiService which is NOT registered`, then `AgentHostProcessManager: agent host terminated
    with code 1, giving up after 5 restarts`, and the renderer turns that into
    "The Agent Host failed to start. Restart the application to try again."
    `AgentBranchNameGenerator`, `agentHostPullRequestOperationHandler` and
    `agentHostCommitOperationHandler` are the remaining required Copilot injections; booting the
    process again would mean restoring the layer the plan removes.
    Fixed with **new patch `0032`**: `AgentHostPrewarmContribution` no longer starts the host (the
    prewarmer class, the enablement autorun and the assignment-context forwarding are gone; the
    contribution stays registered with the reason in a comment), and the base's own suite for that
    contribution now pins the Caret contract ("does not start the agent host while enabled").
    Confirmed: `prepare-desktop` 30/18 · patch-set test reproduces the checkout · typecheck-client
    0 errors (the unused prewarmer symbols had to go for that) · typecheck · parity · ci-validate ·
    suite 754 pass (1 environmental failure: `menus-contract.test.ts` needs `rg`) ·
    **on screen, twice**: `main.log` carries **0** agent-host lines (no process is spawned) and the
    window has no element or notification matching `/Agent Host|failed to start/i`. Receipt:
    [`evidence/agents-no-base-agent-host-2026-09-16/`](evidence/agents-no-base-agent-host-2026-09-16/).
15. **Delete chat in the session list (2026-09-16)**: the user asked for delete alongside the
    existing Archive, and the base already owned the whole flow (menu item
    `sessionsViewPane.deleteSession` gated on `sessionSupportsDelete`, plus the
    "Are you sure you want to delete this session? This action cannot be undone." dialog) — what was
    missing were three pieces behind it: the host (`DELETE /v1/sessions/:id`, `DurableStore.deleteSession`
    with cascaded commands/events, `CaretHost.deleteSession` stopping the runtime and removing
    `sessions/<id>` + `artifacts/<id>`; a session worktree is deliberately left on disk), the
    extension (`CaretHostClient.deleteSession`, command `caret.session.delete`, declared as
    "Delete Chat"), and the bridge (`0010`: `supportsDelete: true` +
    `deleteSession`/`deleteSessions` executing that command and refreshing the list).
    Confirmed: host tests 26 pass (row + commands + events gone, transcript and artifact directories
    removed, second delete is `not_found`) · `prepare-desktop` 30/18 (0010 re-cut) · typechecks ·
    suite · parity · ci-validate · **on screen (packaged app, scratch sessions created through the
    host API)**: the row menu now reads `… Archive · Delete… · Create Group`, the dialog appears,
    confirming shows "Deleted 1 chat.", that row disappears while its sibling in the same group
    stays, and the host record plus `sessions/<id>` are gone. Receipt:
    [`evidence/agents-session-delete-2026-09-16/`](evidence/agents-session-delete-2026-09-16/).

16. **Terminal conformance corpus + Ghostty VT evaluation (2026-09-16)**: the terminal was
    the one surface with no tests at all, and the user asked what Ghostty could add to it.
    The answer was measured, not guessed. **Landed:** an engine-agnostic corpus
    (`apps/macos/src/terminal-conformance.ts`, 12 cases: OSC 633/133, OSC 8, `CSI ?2026`,
    Thai combining marks, CJK width, box drawing, DECSC/DECRC, scroll region + reverse
    index, erase+CR, alternate-screen round trip, ZWJ emoji recorded only), adapters in
    `scripts/lib/terminal-engines.ts`, the report `bun run check:terminal`, and the gate
    `apps/macos/test/terminal-conformance.test.ts` that holds every required case against
    the engine the workbench ships (xterm.js `6.1.0-beta.302`, the version `desktop`
    pins; added as a root devDependency so the corpus runs the real engine).
    **Measured** against `@coder/libghostty-vt-node` `0.1.0-beta.0` (libghostty-vt, MIT,
    darwin-arm64 prebuild, Node 24): at the chunk size a PTY actually delivers (8 KiB)
    **131.1 MB/s vs xterm's 5.1 MB/s (25.7×)**; **1.63 MB vs 7.27 MB RSS per live
    terminal**; xterm wins the rare visible-text read (5.7 ms vs 46.7 ms per 1000) and
    has no structured-snapshot API at all (ghostty: 0.475 ms per snapshot with cells).
    Behavioural parity: **12/12 on both engines**. Caveats: the binding is beta and
    upstream's C API is untagged/unstable (pin the commit), no Windows prebuild, and the
    visible terminal is untouched — the workbench still renders xterm.js, as Cursor does.
    Receipt: [`evidence/terminal-vt-spike-2026-09-16/`](evidence/terminal-vt-spike-2026-09-16/).

### The Copilot-flavoured composer controls are gone (2026-09-16)

Receipt: [`evidence/agents-chrome-decisions-2026-09-16/`](evidence/agents-chrome-decisions-2026-09-16/).

The four chrome decisions the audit left open are decided and landed. `Configure Tools…` (the
base's tool set for the default agent), the permission picker (manual / allow all / autopilot —
the Copilot permission model, while this window's approvals come from OMP) and the
`Configure Custom Agents…` entry in the mode menu are scoped out of the Agents window with
`IsSessionsWindowContext.toNegated()`: patch `0033`, three base files no earlier patch owns, each
with the reason in a comment; the IDE window keeps all three, and two of them also gate the
action's `precondition` so a command-palette entry is disabled rather than dead. The sidebar's
empty `Chats` group is a setting instead of a patch — the extension writes
`sessions.list.showEmptyDefaultGroups: false` into the Agents window's own workspace file beside
the theme keys. Confirmed with the packaged app on a scratch profile: the sidebar lists
`Automations · cedia · New task` with no `Chats`/`No chats` group; the composer's chips are
`Local · Agent · DeepSeek V4.1 Flash` with no `Configure Tools…` and no permission picker anywhere
in the window; the mode menu lists only `Agent`; the IDE window still boots. Gates:
`prepare-desktop` 31/18, the patch-set test, typecheck-client, typecheck, parity (340 keys / 0
mismatches), the suites and ci-validate.

### Caret follows the OMP line: the baseline is a floor, not a pin (2026-09-16)

Receipts: [`evidence/omp-version-floor-2026-09-16/`](evidence/omp-version-floor-2026-09-16/) (the
policy change) and [`evidence/omp-18-2-envelope-probe-2026-09-16/`](evidence/omp-18-2-envelope-probe-2026-09-16/)
(why it was needed).

This machine's stock OMP moved to `omp/18.2.1`, the gate accepted `18.1.x` only, and `apps/host`
therefore refused the runtime the user actually has — their instruction was not to pin it. The
predicate now accepts the baseline or anything newer (later patch, later minor, later major) and
refuses anything older or malformed by name; `OMP_SUPPORTED_MAJOR_MINOR` is deleted rather than
left as a second, contradicting policy. What carries the weight a version number cannot is the
runtime's own `ready` frame — the protocol versions it speaks and the Caret bridges it advertises
are capability-gated, so a runtime without them degrades honestly per command — plus the three
contract suites, which are now the acceptance test for any newer release and were all run green
against the machine's stock 18.2.1 (`omp-smoke` exit 0 with `"version": "omp/18.2.1"` in its
receipt, `omp-g1-smoke` exit 0, `omp-ui-smoke` exit 0). A Caret build still packages a runtime it
contract-tested when it was built; the floor governs the runtime a user points Caret at, and
`patches/omp/` still applies to the 18.1 source, so a stock 18.2.1 keeps those bridge surfaces
off. The earlier `s2-omp-version-gate-2026-09-15` receipt stays as the record of the policy it
described; this supersedes it.

### The host keeps a terminal checkpoint (2026-09-16)

Receipt: [`evidence/host-terminal-checkpoint-2026-09-16/`](evidence/host-terminal-checkpoint-2026-09-16/).

First slice of §10 item 27. The mobile renderer replays a bounded chunk history (4 MiB / 4096
chunks), so after a trim or a reconnect there is nothing to restore the screen from and it can
only ask OMP for a redraw. The host is the one process that sees every `caret_terminal_*` frame,
so it now keeps the screen there: `TerminalStateRegistry`
(`apps/host/src/terminal-state.ts`) holds one headless terminal per virtual terminal with
libghostty-vt, fed from the same hook that records events, with the clients' sequence rules
(duplicates ignored; a gap marks `historyIncomplete` instead of pretending the bytes were seen;
a reopen keeps the screen and follows the new size; a close keeps the final screen readable).
`GET /v1/sessions/:id/terminals` publishes them as `TerminalCheckpoint`
(`packages/protocol`), and a `caret_terminal_resize` applies only after OMP acknowledges it. The
engine is optional: without the package the host keeps nothing and the session runs as before.
OMP still owns the PTY.

Confirmed: registry tests plus a real-engine test that fails when the platform prebuild is
missing (6 pass) · the route contract (honest `{ terminals: [] }`, 404 for an unknown session,
checkpoint passed through) · `bun scripts/build-caret.ts` marks the native addon external, ships
it beside the host bundle (verified to load under plain Node from the shipped copy) and throws
when the platform prebuild is missing · licence notices added for Ghostty and the binding ·
`bun scripts/omp-virtual-ui-smoke.ts` against real OMP (scripted loopback model, no provider
credentials) passes with a new check `host-terminal-checkpoint-matches-omp-frames` — the
checkpoint matches the negotiated open frame and shows the terminal's real output. Suite 776
(1 environmental failure), typecheck clean, ci-validate CI-OK.

**Client half landed the same day** (receipt:
[`evidence/mobile-terminal-checkpoint-2026-09-16/`](evidence/mobile-terminal-checkpoint-2026-09-16/)):
the mobile renderer now consumes the route when its bounded history was trimmed —
`terminalCheckpointSeed` turns the grid into terminal bytes, the coordinator seeds from it
instead of requesting an OMP redraw (advancing its watermark to the checkpoint's sequence so
live output continues), the renderer document suppresses the "history expired" notice when a
seed follows, and `App.tsx` fetches the checkpoint through the session-scoped API client.
Confirmed: `bun run test:mobile` 146 pass (141 before) with new cases for the seed bytes, the
seed-vs-recovery decision and the fallback, plus the document notice behaviour; repo typecheck
clean, suite 776 (1 environmental), ci-validate CI-OK. The iOS `tsc --noEmit` keeps two
pre-existing failures in untouched test files, recorded rather than fixed here.

**Still open (the rest of item 27):** no device receipt yet (the closure asks for a real
iPhone over the relay), the checkpoint carries text but not cell styles, and the React mount
wiring has no component test.

### Model roles on the model picker (2026-09-16)

Receipt: [`evidence/model-roles-surface-2026-09-16/`](evidence/model-roles-surface-2026-09-16/).

The user runs several models through OMP. OMP already owns the whole role system (`modelRoles`,
`modelTags`, `cycleOrder`, `modelRoleStorage`; nine built-in roles plus custom ones) and drives it
from the TUI carousel, but **no RPC command exposed it**: the command set is 46 types and held only
`set_model`, `cycle_model`, `get_available_models`, `set_thinking_level` and `cycle_thinking_level`,
with `get_state` reporting just `model` and `thinkingLevel`. A host could only read `config.yml`
itself and reimplement OMP's layer resolution — the divergence that caused the model-picker bug —
so the surface was added to Caret's pinned OMP patch instead, and OMP keeps ownership through its
own `setModelRole`/`getModelRoleProvenance`.

- `patches/omp/0001-caret-rpc-bridges.patch` — `caret_get_model_roles` and `caret_set_model_role`,
  plus `RpcReadyFrame.caretModelRolesVersion: 1`. The projection unions `getKnownRoleIds` with the
  configured roles, leads with `cycleOrder`, lists only roles that resolve to a model, and reports
  the provenance layer per role.
- `packages/omp-adapter` — both commands in `CARET_UI_COMMAND_TYPES`, gated per capability so a
  runtime carrying one bridge does not accept the other's command.
- `apps/macos/src/chat-sessions-map.ts` / `chat-sessions.ts` — `normalizeOmpModelRoles`,
  `rolesByModelSelector`, `annotateModelsWithRoles`, `modelRoleLabel`, the request builders, and
  `fetchOmpModelRoles`; the option catalog annotates the rows the picker already shows.

Verified over the real prepared runtime with the user's own configuration: `cycleOrder
[smol, default, slow]`; roles `smol`=openai-codex/gpt-5.6-luna, `default`=commandcode/deepseek-v4.1-flash,
`slow`=openai-codex/gpt-6-astra, `plan`=opencode-go/muse-spark-1.3-contributor, all `source: global`.
A same-value write round-tripped and left `config.yml` byte-identical. The rows the picker now shows,
produced by the same projection the extension calls:

```
Grok 4.6                            cursor
DeepSeek V4.1 Flash (Command Code)  commandcode · Default
Muse Spark 1.3 Contributor          opencode-go · Architect
DeepSeek V4.1 Flash                 opencode-go
GPT-5.6-Luna                        openai-codex · Fast
GPT-6-Astra                         openai-codex · Thinking
```

The user's stock OMP binary advertises no marker and refuses the command, so a patch command is
never sent to stock OMP. Ten new test cases cover cycle-order filtering, `@role` alias resolution,
ambiguous-id refusal, honest-empty and request shape; two mutation checks prove the suite fails when
the cycle filter or the alias resolution is broken. Gates: typecheck clean, 775 pass / 1 pre-existing
environmental failure, ci-validate CI-OK, cursor-parity 340 keys / 0 mismatches.

**Seen on screen** (packaged app, `--agents`, fresh profile): the app logged `Caret session option
catalog: 6 model(s) advertised by OMP, 4 role(s) configured`, and the open model picker rendered the
roles beside the model names — `DeepSeek V4.1 Flash (Command Code)`**Default**, `GPT-5.6-Luna`**Fast**,
`GPT-6-Astra`**Thinking**, `Muse Spark 1.3 Contributor`**Architect**, with `Grok 4.6` carrying none.
Screenshot: `evidence/model-roles-surface-2026-09-16/model-picker-roles.png`.

**A mistake this round made and caught**: the first implementation put the labels in the
chat-session option group's item `description`, which the API documents as tooltip-only. The RPC
surface, the projection and the tests all passed while **the user-visible label rendered nowhere**;
only opening the packaged window and reading the picker's DOM showed it (no `title`/`aria-label`
carried the role words). The labels now travel on the language-model rows as
`LanguageModelChatInformation.detail` — the field the picker draws beside the model name — the dead
option-group annotation was deleted rather than left behind, and an existing test caught the row
shape change. Recorded because it is the failure mode §11 gate 2 exists to prevent: a value can be
measured, unit-tested and still invisible.

**Assignment surface**: `caret.models.configureRoles` (`Caret: Configure Model Roles...`) lists the
roles OMP reports and assigns or clears one through the host — the same `caret_set_model_role`
command. Exercised against the real runtime through the same helpers the command imports: it reports
`Fast=openai-codex/gpt-5.6-luna`, `Default=commandcode/deepseek/deepseek-v4.1-flash`,
`Thinking=openai-codex/gpt-6-astra`, `Architect=opencode-go/muse-spark-1.3-contributor` (all
`global`) and builds `{"role":"smol","modelId":"openai-codex/gpt-5.6-luna"}`.

**Why it is a command and not a composer chip** (investigated, not assumed): the chat-session
option-group API documents **0-2 groups**, and in the Agents window the composer renders only the
`models` group — the sessions bridge projects that one group into the dedicated model picker, and no
other group becomes a chip. With 5 groups produced (the extension log said
`Caret input state: 5 group(s) for draft (models + 4 role group(s))`) the composer still showed only
caret / Agent / model / Default permissions. An inline chip therefore needs a desktop patch; the
command reaches the same host surface without one. Two dead ends were tried and disproved first
(provider options never seed a session option and are filtered out; input state does seed, and the
groups still do not render), and the disproved projection plus its tests were **deleted** rather than
left behind — the bundle no longer contains them.

**Not confirmed**: the command was not driven from the running window, because this window's inputs
are EditContext-based (synthetic CDP keys/text do not reach the palette) and Screen Recording is not
granted for the Computer Use path. Its data path and payload are verified against the runtime
instead. That is §10.

**A bug this surface had, found by using it (2026-09-16)**: clearing roles reported success and the
same session read back an empty list, but a **fresh process still saw all four roles** and
`config.yml` was byte-identical with an unchanged mtime. Cause: OMP persists a role through
`Settings.setModelRole` → `#queueSave()`, which is **debounced by 100 ms**; the handler answered
immediately, so a client that exits on the ack closed before the timer fired and the write was lost.
Nothing in the ack distinguished "saved" from "queued". The handler now awaits
`session.settings.flush()` before answering, so `success` means the write landed. This is the failure
the earlier same-value round-trip could not catch — a no-op write makes a lost save invisible — and
it took using the feature on the user's own config to expose it.

**Patch hazard hit again**: the first re-cut failed `prepare-omp-runtime`'s reverse-check because
files were edited after the patch was cut. Re-cutting from `upstream/omp` after the last edit, then
verifying both `git apply --reverse --check` against the working tree and `git apply --check` on a
clean worktree of the pinned commit, is the procedure that works — the same constraint §6.1 records
for `patches/desktop`.

### Zen's free stealth model in OMP (2026-09-16)

The user asked for OpenCode Zen's new `union-alpha` ("Union Alpha Free") to show in OMP. The row
already listed — zen is `dynamicModelsAuthoritative`, so the credential's live list replaces the
bundled slice — but OMP's catalog routes a gateway-first id it carries no pin for to
`openai-completions`, which the gateway answers 500; `/v1/messages` is the lane that works. No pin
exists in the pinned revision or in upstream main (`60c9a115b2` pins `muse-spark-`, `minimax-m3`,
`gpt-6-astra` for zen — not this id), and §6 keeps `patches/omp` for surfaces OMP cannot expose
rather than catalog policy, so the route was fixed where the file already scopes providers: one
`models:` row on the real `opencode-zen` id in `~/.omp/agent/models.yml` (the free tier's
`x-opencode-session` gate is satisfied only for the exact `opencode-go`/`opencode-zen` ids, so a
custom provider id would lose it). Verified with a real turn through the pinned runtime —
`--model opencode-zen/union-alpha -p …` answered `caret-union-ok` — and against the live config
through OMP's own registry: 71 zen rows with `union-alpha` on `anthropic-messages`, every other row
keeping its route. Receipt:
[`evidence/opencode-zen-union-alpha-2026-09-16/`](evidence/opencode-zen-union-alpha-2026-09-16/).
The go twin stays a dead row; that is §10.

### The dead code around the shell is gone (2026-09-17)

The user asked whether the tree still carries dead code — the chrome shell we no longer use, and the
things that conflict with each other. Three kinds came out of it, and each one is now either gone or
recorded as staying.

- **Five modules no production code called.** `artifact-filters`, `artifact-lineage`,
  `markdown-table`, `settings-hits` and `transcript-find` were reachable only from their own test
  files; the shell draws the same behaviour inline (`webview.ts:495` has the markdown-table
  separator rule `markdown-table.ts` also had, and `settings-hits`/`artifact-filters` are
  re-implemented at `webview.ts:1428`/`1915`). They were the residue of the pre-SSOT `D`/`A` item
  set, which no longer exists anywhere in `docs/` or `backlog/`. Deleted with their five test files.
- **One agent surface per window, not two.** `caretComposer` (with its `caretAgents` activity-bar
  container), the `caret.agentsShell` custom editor, its `*.caret-shell` document and the
  `window.caret-shell` fallback panel are gone; the paths that used to reveal them now reveal the
  dock instead (`revealAgentSurface()` → `caretComposerDock.focus`). The dock itself is
  untouched — it is still the live IDE-window surface, so `webview.ts` and S3 stay exactly as §10
  item 10 now states.
- **The conflicting third route in `desktop/`.** `src/vs/workbench/contrib/agentWorkbench/` was a
  self-contained island (13 files) whose only live effect was two command-palette entries:
  `caret.openAgentsWindow`, which mounted the retired `caretComposer` webview, and `caret.openIde`,
  which recorded a mode flag nothing read (`caretWorkbenchShell` appears in no `when` clause).
  Removed as a manifest `removals` entry plus patch `0034` for its single import line. Opening the
  Agents surface is now one route: `caret.showAgents` → `workbench.action.openAgentsWindow`.
- **One duplicated palette entry.** `caret.openTask` and `caret.showAgents` were the same handler
  with two titles; `caret.openTask` is gone.

Verification: `apps/macos/test` 611 pass / 0 fail, `bun run typecheck` 0 errors,
`desktop` `tsc --project src/tsconfig.json` 0 errors, `npm run compile-client` exit 0 with
`caret.openAgentsWindow` = 0 occurrences in the rebuilt `out/` bundle (it was present in the
previous one), `prepare-desktop.ts` = 32 patches / 19 removals, `desktop-patch-set.test.ts` rebuilds
from the pinned base and finds no drift, `check:repo` and `check:cursor-parity` green. Receipt:
[`evidence/dead-code-retirement-2026-09-17/`](evidence/dead-code-retirement-2026-09-17/).

### The decision pass: what Cursor actually does, and what Caret chose (2026-09-17)

The user asked what they had to decide, then answered. Each one is now a fact in §5/§10 or a change
in the tree, so a later session does not re-derive it:

- **The Agent Host is gone from the window's decision surface.** `0032` gained a second half: the
  desktop DI shim returns the base's `NullAgentHostService` for the local branch, so asking for that
  host yields one sentence instead of a utility process that dies on boot and a
  "failed to start" banner. 25 injection sites stay; nothing enables agent-host features, so none
  resolves the client eagerly. §10 item 22 closed.
- **The IDE window keeps its dock, and the Agents window keeps its panel.** Measured for the first
  time: Cursor's IDE window has a live chat surface too (`workbench.panel.aichat`,
  `workbench.panel.aichat.view`, a `Hide Chat` command) beside the buttons that open the Agents
  window (`workbench.agentsWindowButton.enabled`); so the dock is parity, not surplus.
  The reference's Agents-window chrome is `Hide Sidebar` plus `Enter Full Screen` / `Hide Apps` in
  the panel header — no Show Panel or Toggle Side Panel — and the user chose to keep Caret's current
  panel regardless. Both are recorded in §5.
- **The composer's mode chips are measured, not guessed.** The reference has real modes, not
  decoration: `Plan New Idea ⇧Tab` and `Multitask` are CTAs on a mode state (`composerMode.multitask`,
  `cycleMode`, `changeToAsk`/`changeToDebug`/`changeToMultitask`), each mode carrying its own
  placeholder and description. They stay unrendered in Caret until a mode exists whose Plan and
  Multitask paths map to real OMP behaviour. §10 item 11 states the closure.
- **The terminal decision is split.** The workbench keeps xterm.js (recorded in §5); only the iOS
  WebView terminal is still open. §10 item 30.
- **Two things are deliberately left alone.** The Copilot-named helper files are referenced, not
  dead (§10 item 26 now carries the counts), and `opencode-go/union-alpha` stays a visible dead row
  rather than Caret inventing catalog policy (§10 item 31).
- **The AX/DOM comparison has a tool.** `scripts/agents-chrome-inventory.ts` parses the captured
  reference tree into a control inventory, captures the Caret side over CDP, and reports the
  reference controls that Caret lacks; it exits non-zero on any. §10 item 16 carries the remaining
  half — nobody has run it against a live window yet.
- **The AX/DOM comparison has now run once** (later the same day): a packaged Caret was launched with
  `--agents --remote-debugging-port=9333` and captured. Reference 45 controls, Caret 30, shared 12;
  the 33 the reference has and Caret does not split into 26 empty-draft *state* (Caret's window sat
  on a chat and `New Chat` did not move it), 3 already-decided deviations and 4 real differences
  (two labels, two missing accessible names). §10 item 16 carries the closure.
- **`.omp/` is not repository content.** A byte-identical copy of the global
  `~/.omp/agent/config.yml` (provider credentials included) had been left in the tree; it is removed
  and ignored, with `.omp/config.yml` — the one file OMP reads at project scope — excepted so a
  shared project config stays committable. `.agents/AGENTS.md` is committed, because
  `~/.agents/AGENTS.md` is a symlink into this repository and that file is the shared policy.

Receipt: [`evidence/dead-code-followup-decisions-2026-09-17/`](evidence/dead-code-followup-decisions-2026-09-17/).

### Desktop parity: the sessions navigation says what the reference says (2026-09-17)

The chrome comparison's four non-state differences included two that were only wording: the fork's
sessions navigation carried `Go Back One Session` / `Go Forward One Session` as its tooltip - which
is what the accessibility tree exposes as the control's name - where the reference's are `Go Back` /
`Go Forward`. Patch `0035-caret-sessions-nav-copy.patch` sets both to the reference's words.

Verified in a rebuilt app rather than by inspection, the first time this project has closed a
desktop change that way: `npx gulp vscode-darwin-arm64-min` rebuilt the workbench and the app bundle
(3.1 min), `CARET_HOST_NODE=... bun run package:mac` overlaid the Caret extension, runtime and icon
and re-signed, and a fresh `capture` on the running window reads `shared 13, renamed 1, absent by
decision 3` - the two labels are now exact matches. The toolchain traps that cost time are recorded
in [`evidence/dead-code-followup-decisions-2026-09-17/first-live-capture.md`](evidence/dead-code-followup-decisions-2026-09-17/first-live-capture.md):
`upstream/omp` was a stale worktree whose `/private/tmp` parent had been cleaned, so the packaging
step could not resolve the pinned OMP source, and the packaging step needs `CARET_HOST_NODE`.
### Delete reaches the dock too (2026-09-17)

§10 item 24 was the last asymmetry between the two agent surfaces: the Agents window's session list
could delete a chat (the host route and the extension path landed with patch `0010`), while the dock
in the IDE window offered Archive and nothing else. The dock's session row menu now carries `Delete`,
which posts the new `delete_session` message; the extension asks first — the host delete removes the
record and the transcript it wrote, so the modal reads `Delete "<title>"? This action cannot be
undone.` — and then calls the same `deleteChatSessions` the list uses, so there is one delete path
with two front doors rather than two implementations.

Verified: `bun test apps/macos/test` 621 pass / 0 fail with the new
`ide-native-workbench.test.ts` case pinning the menu item, the parser, the message type and the
confirmation; `bun run typecheck` 0 errors; `bun run build` puts `delete_session` in
`dist/mac-extension/out/extension.js`. Receipt:
[`evidence/dead-code-followup-decisions-2026-09-17/`](evidence/dead-code-followup-decisions-2026-09-17/).

### A sash can carry a name (2026-09-17)

D2's first half. `Sash` set no `role`, no `aria-label` and no `aria-valuenow` at all, so no divider in
the workbench reached the accessibility tree with a name - which is why the comparison's two
`splitter` entries in §10 item 16 were missing rather than merely renamed. Patch `0036` adds
`ISashOptions.ariaLabel`: when a caller sets it, the sash becomes a labelled `separator` with its
orientation; when nobody sets it, the sash is byte-for-byte the element it was, so this touches a
component every split view in the app uses without changing any of them.

Verified by the proven loop: fork `tsc` 0 errors, `npx gulp vscode-darwin-arm64-min` rebuilt the
bundle (2.98 min), `package:mac` re-signed the app, and a capture on the running window reads the
same inventory as before the change (`shared 13, renamed 1, absent by decision 3`, 25 Caret
controls) - the one line that differs is the model picker reading `Claude Sonnet 4` instead of `No
models available`, because the rebuilt runtime now answers with the operator's catalogue.

What is left of D2 is the naming decision recorded in §8: the parts carry no accessible name, so
`Resize sidebar` / `Resize panel` have to be attached either explicitly at the two boundaries in
`layout.ts` or through a name the parts expose and the grid derives from.
### The two splitters have the reference's names (2026-09-17)

D2's second half. Patch `0036` had given `Sash` the ability to carry an accessible name; `0037` uses
it at the two boundaries the reference names. The owners are not the same in both windows, which is
what made this take three attempts: the IDE window is laid out by `src/vs/workbench/browser/layout.ts`
(the parts grid from `SerializableGrid.deserialize`), while the Agents window is a **separate layout
implementation** in `src/vs/sessions/browser/workbench.ts` - and in that window the right-hand Apps
panel is the editor part's own group, so its boundary is the editor part's left edge, not an auxiliary
bar that does not exist there.

A sash is matched to a part by measured geometry (the sash whose centre sits on the part's edge),
because the grid creates the sash elements and keeps no handle to them. Naming happens after a layout
pass, not at construction: at construction the parts have no boxes yet, which is why the first attempt
silently named nothing.

Verified in a rebuilt app through the proven loop (fork `tsc`, `gulp vscode-darwin-arm64-min`, 
`package:mac`, launch, capture): the capture gained `splitter Resize sidebar` and `splitter Resize
panel`, and the comparison now reads **shared 15, renamed 1, absent by decision 3, missing 26** - the
reference's two splitter entries are exact matches instead of misses. Receipt:
[`evidence/dead-code-followup-decisions-2026-09-17/chrome-report-after-splitter-names.txt`](evidence/dead-code-followup-decisions-2026-09-17/chrome-report-after-splitter-names.txt).
### A Caret session greets you in Caret's words (2026-09-17)

§10 item 3's first half. A session with 0 events showed the base's welcome - `Build with Agent` /
`Generate Agent Instructions` - because `chatWidget` reads the welcome copy from the session *type's*
contribution (`chatWidget.ts:1680`) and falls back to the base's text when the provider supplies
none. Caret's `chatSessions` entry now carries `welcomeTitle: Caret` and a `welcomeMessage` that names
OMP, so the empty chat greets a Caret user in Caret's words.

One deliberate omission: `welcomeTips` exists in the extension point and in the service interface but
**no code in this fork renders it** (`rg welcomeTips src/vs` finds the two declarations and nothing
else), so Caret ships nothing into that field rather than adding contribution data no one reads. A
test pins both halves - the copy is Caret's, and the inert field stays empty.

Verified: `bun test apps/macos/test` 622 pass / 0 fail, `bun run typecheck` 0 errors, and the copy is
present in the packaged bundle's own `extensions/caret/package.json` (checked by reading it out of
`Caret.app`). On-screen rendering was not exercised: the window has no 0-event session to show, and
creating one is D1's work.
### New Chat opens a real Caret draft (2026-09-17)

D1's first piece, and the end of the dead button §10 item 1a recorded. The base already owns
untitled drafts: `getNewChatSessionResource(type)` builds `<type>:/untitled-<uuid>`, and the first
Send runs `chatServiceImpl._materializeUntitledSession` -> `createNewChatSessionItem` -> Caret's
`newChatSessionItemHandler`. What was missing was a provider willing to hand one back: Caret's
`createNewSession` returned the newest contributed session or threw, and `resolveWorkspace` refused
any folder the window's own workspace file did not list - which is every host project folder, since
the Agents window's workspace file lists none of them. Both changed in patch `0010`: the draft is an
`ExtensionSession` over the untitled resource with the asked-for workspace, and the provider answers
for a folder it is handed (with the agent host gone it is the only provider, so it owns every folder
it is asked about).

Verified in a rebuilt app, three ways: the window log shows `[ChatModelSelection]` initialising
`caret.omp:/untitled-<uuid>` right after the click, the screenshot in this directory shows the empty
`New task` composer, and a capture in that state produced the fair comparison the plan has been
waiting for. That capture also exposed a new difference: in the draft the Apps panel offers only
`Changes`, where the reference offers `Changes`/`Browser`/`Terminal`/`File`.

### The draft's first Send becomes its transcript (2026-09-18)

Receipt: [`evidence/d1-draft-send-in-place-2026-09-18/`](evidence/d1-draft-send-in-place-2026-09-18/).

The rest of D1's first piece: sending from the New Chat composer now creates the host session and
turns that composer into the session's transcript, in the same pane, with the composer's model pick
carried into creation. Four stacked defects had to go first, each measured on screen: the bridge
threw because `SessionsManagement.sendRequest` discards the draft before every send; an unrun chat
never had a chat model loaded, so `chatService.sendRequest` threw `Unknown session`; the draft
resource carries the session *type* as its scheme (`caret.omp:/untitled-…`) while the extension's
content provider answers for the item scheme (`caret`), so a draft could not resolve at all; and the
send carried no resolvable model, so the extension host refused it with `Language model unavailable`
before Caret's participant ran.

The mechanism is now the base's own new-session flow, which is the closest thing Code-OSS's sessions
window has to the reference's "the composer *is* its conversation": `createNewSession` hands back an
untitled draft, `prepareNewSession` creates the host session when the user commits (seeding it with
the draft's options) and returns the session the window adopts, and `sendRequest` runs on the real
session instead of materializing one mid-send. The reference's own internals are not available to a
fork of Code-OSS (its bundle has no sessions-window machinery at all; a composer carries its own id,
its bubbles and its model from the start), so the target is its behaviour, and the receipt records
both the measurement and what is left.

One stub had to change with it: `NullAgentHostService.rootState` now answers with an empty state
instead of throwing (patch `0032`). It is a state read, not an action, and the sessions window's
chat view reads it while it is being constructed, so throwing there aborted the construction and
left the composer on screen. Actions still throw.

Verified in a rebuilt app: `[data-bound-chat-resource]` is the created session's resource, the chat
view is mounted on it, the session content reads the prompt plus the running turn, and the window
logs no errors. 786 tests, both typechecks, `check:repo`, and the desktop patch set (patches `0010`
and `0032` re-cut) are green.

### Terminal checkpoints carry cell styles (2026-09-18)

Item 27's "cell styles in the checkpoint" piece. The host's headless checkpoint carried text and a
cursor only, so a phone that seeded its xterm.js renderer from it got a colourless screen, even
though `@coder/libghostty-vt-node`'s `snapshot({ includeCells: true })` already reports bold,
italic, underline and palette-resolved `#rrggbb` foreground/background per cell
(`native/terminal.cc:466-480`). `TerminalCheckpoint` gained an optional `runs` list
(`TerminalCheckpointRun`); the host's `snapshots()` asks for cells and merges only contiguous cells
whose style is identical (bounded at 5000 runs); and `terminalCheckpointSeed` paints a styled row
run by run — explicit cursor positions, a reset before every run, then reset-and-clear to the end —
while a checkpoint without runs stays byte-identical to before. The live run found a real bug the
fixtures had pinned: a cursor move does not clear SGR state, so a style-less run inherited the
previous colour and a partial SGR kept the previous foreground; the seed now resets before each run.
Receipt: [`evidence/terminal-checkpoint-styles-2026-09-18/`](evidence/terminal-checkpoint-styles-2026-09-18/)
(README, the portable `live-check.ts`, and its output).

Verified: `bun test apps/host/test/terminal-state.test.ts` 10 pass / 0 fail; `cd apps/ios && bun
test` 156 pass / 0 fail; `bun run test` 858 tests / 1 fail (the standing environmental `rg`; not
code); both typechecks clean; the live check drives the real native addon through the registry into
a real `@xterm/headless` terminal and reads the cells back (`LIVE-OK`), run from the repo root.
What remains of item 27: the real-iPhone-over-relay receipt and the mount-wiring component test
(the iOS project has no component renderer dependency; the coordinator/seed logic is covered).

### The phone recovers from a rotated incarnation (2026-09-18)

The mobile half of item 39. The host rotates a session's incarnation when a process starts (another
device, or after crash recovery), but the iOS client kept the old one: `CaretApi.request` threw a
bare `Error("Caret host request failed (409)")` and discarded the host's `{ error: { code, message } }`
body, `catchUp` refreshed events and pending UI but never the session record, and every refused send
was marked an unknown outcome. Now `request()` throws a `CaretHostError` carrying status, code and
message; a new pure `commandFailurePlan` classifies a refusal (`stale_incarnation` and
`session_starting` refresh-and-retry once, `recovery_required` surfaces the Reconcile state,
everything else stays the existing unknown path); `catchUp` re-reads the session record and
dispatches a new `session_refresh` action that swaps only the record — the mounted transcript,
cursor, pending UI and draft are preserved, unlike the task-switching `session` action; and a
refused command is marked `not_dispatched` (the host refuses before claiming, so nothing ran) and
resent once with a fresh command id after the refresh. A failed start now refreshes and reports
`recovery_required` as an actionable state instead of "offline".

Verified: `apps/ios` typecheck clean; `cd apps/ios && bun test` 154 pass / 0 fail (new api error
shape, reducer refresh-vs-switch contrast, the full classification table and App-source wiring
needles); root `bun run test` 853 pass / 1 fail (standing environmental `rg`; not code);
`bun run typecheck` clean; `ci-validate` OK. Not verified: the device receipt item 23 owes — the
reconnect path has no real-iPhone-over-relay run yet.

### Host startup no longer lies and no longer blocks (2026-09-18)

An audit of the session lifecycle (item 39) found three defects, all fixed. `#startSession` wrote
`status: "running"` before OMP existed (the 10 s version probe plus the 20 s ready wait), so a host
death in that window made `recoverPending` force `recovery_required` on a task that never ran a
turn, and clients read "running" while nothing was running; the start now rotates only the
incarnation and lets `agent_start` own `running` and the ready path own `idle`. Commands sent while
a start is in flight used to be claimed and persisted as terminal `not_dispatched` with "Start or
reconcile…" (replaying forever); with no row yet they now get a transient 409 `session_starting`,
and the same command id can be sent again once the session is ready, while an idempotent replay of
an existing row still returns that row. The synchronous `execFileSync` version probe became an
awaited `execFile` with the same timeout/env, so a slow launcher no longer freezes every other
session's HTTP and command work.

Verified: `bun run test` 851 pass / 1 fail (standing environmental `rg`; not code), including four
new host tests: no `running` during a delayed start and `idle` after it, the transient 409 with no
persisted row and a successful resend of the same id, replay during a start, and a read served
while a slow probe runs; falsification re-ran the three pins against the pre-fix code and they
failed. `bun run typecheck` clean; `ci-validate` OK. What remains in item 39 is the mobile half:
the iOS client never refreshes the selected session's incarnation, and the iOS API layer discards
the host's 409 code/message, so a phone stays stuck after a host restart or another client's
switch (audited 2026-09-18; no device receipt yet).

### OMP presentations render in the dock and the native chat (2026-09-18)

`presentationFromEnvelope` kept only url/instructions/title, so every `notify`, `setStatus`,
`setWidget`, `setTitle` and `set_editor_text` presentation OMP sent vanished (the dock drew only
open-URL cards and the native transcript drew nothing). The projection now validates and carries
each method's own fields (`notifyType`, `statusKey`/`statusText`, `widgetKey`/`widgetLines`/
`widgetPlacement`, `text`) with conditional spreads, dropping malformed or unknown methods; the
dock's `renderPresentations` renders all six with dataset attributes for severity/key, and the
native `runTurn` surfaces the two that fit a transcript (`notify` as `info`/`warning`, `open_url`
as a markdown link), seeded so an already-open turn does not replay history and deduped by
presentation id so an unchanged frame is not re-emitted.

Verified: `bun test apps/macos/test` 657 pass / 1 fail (standing environmental `rg`; not code),
including per-method projection/drop cases, the notify dedupe and open-URL markdown fixtures, and
webview needles for all six branches; `bun run typecheck` clean; `ci-validate` OK. Not verified: no
live receipt (no computer-use runtime in this session). What remains in item 37: the browser bridge
and URI schemes (recorded there with their reasons).

### The model picker survives a boot race and names a stale pick (2026-09-18)

Two model-picker defects from the sweep (items 2 and 5a(d)). The boot catalogue fetch sends
`get_available_models` with the session's incarnation; when the host had refreshed the session in
between, its stale-incarnation guard threw `Refresh the task before submitting this command` and the
catch treated *any* throw as a host failure, leaving the picker empty until something else resolved
it. `snapshotWithOmpRuntime` now detects that failed send, re-reads the session once (logging the old
and new incarnation) and retries the same command, bounded to two sends before the honest empty
snapshot. Separately, a composer pick the live catalogue no longer advertises was dropped silently:
the option group now carries a `description` naming the remembered model and saying the host's
current model is shown instead (the picker renders group descriptions as its tooltip,
`chatSessionPickerActionItem.ts:66,243`), plus one log line.

Verified: `bun test apps/macos/test` 654 pass / 1 fail (standing environmental `rg`; not code),
including fixtures for the retry (`["inc-1","inc-2"]`, no `startSession`), the bounded double
failure, the stale-pick description and the live-pick regression guard; `bun run typecheck` clean;
`ci-validate` OK. The race itself is timing-dependent, so the retry is verified by fixture rather
than by a reproduced boot.

### The packaged shell carries a Caret stamp (2026-09-18)

The packaged `product.json` recorded the pinned *upstream* revision only, so nothing could tell
whether the desktop shell inside `Caret.app` matched `patches/desktop`: a `--package` after a patch
landed silently re-stamped the same identity over an older shell. `scripts/build-caret.ts` now
stamps a `caret` field on every package (patch-set digest, base revision, patch count, `packagedAt`,
sha256 of both shell bundles and the Caret extension), and the `--package` path refuses to run while
either shell bundle is older than the newest patch file (the gate that turns today's silent mismatch
into a failed build). `bun run check:packaged` (`scripts/check-packaged-shell.ts`) re-reads the
stamp, re-verifies the patch files' own sha256 through `scripts/lib/patch-set-digest.ts`, compares
the artifact hashes and reports freshness as a separate line, so an existing app can be audited
without rebuilding.

Verified: `bun test scripts/lib` 31 pass / 0 fail (15 new cases: digest order sensitivity, tampered
patch rejection, freshness table); `bun run typecheck` clean; `ci-validate` OK; against the installed
app the check reports the honest FAIL (`carries no caret stamp: this package predates it and must be
repackaged`) with exit 1. Not verified: no `--package` run in this session, so the gate and the
stamp have no real-package receipt yet — item 40 stays implemented, not closed until one passes.

**Closed 2026-09-18** with the real-package receipt and a durable end to the two-Caret problem. A
full rebuild (`npx gulp vscode-darwin-arm64-min`, 3.2 min) rewrote both shell bundles after every
patch, `CARET_HOST_NODE=… bun run package:mac` stamped the app, and `bun run check:packaged` is
green end to end: patch-set `f0185d43e73f`, 35 patches, base `ea1912fd`, and the sessions,
workbench and extension hashes all match the stamp. The same session closed the half this item
recorded but did not fix. `gulp electron` extracts an incomplete dev Electron shell to
`desktop/.build/electron/Caret.app` with no app payload and none of the Caret surfaces, and because
the packaging task is told to build from the same `build/lib/electron.ts` config, both it and
`VSCode-darwin-arm64/Caret.app` shipped `com.caret.editor` — two apps called "Caret" for
LaunchServices, Spotlight and Finder, with the OS free to open the broken one. Two wrong turns were
taken and reverted before landing: moving the dev identity into the shared config gave the
*packaged* app `.dev` too (the two `Info.plist` files were byte-identical), and only renaming the
shell still left two things called "Caret". The end state is one Caret: `scripts/lib/app-icon.ts#removeDevBundle`
unregisters and deletes the dev shell from `scripts/build-caret.ts`'s `--desktop` block, refusing
unless the bundle sits under `desktop/.build` and lacks the `sessions.desktop.main.js` payload that
only a real Caret carries, so a mis-resolved path cannot remove the package. Verified: after a
`--desktop` build the dev shell is gone and `VSCode-darwin-arm64/Caret.app` is untouched at
`com.caret.editor`; the running window is the packaged binary; `removeDevBundle` on the packaged
path returns false and leaves it on disk. The dev shell now exists only while `code.sh` runs.
Receipt: [`evidence/packaged-shell-stamp-2026-09-18/`](evidence/packaged-shell-stamp-2026-09-18/).

### iOS typecheck is green (2026-09-18)

`apps/ios/tsconfig.json` carried four `App.tsx` errors and two test-file errors since the mobile
work landed: a zero-argument `useRef` (React 19 typing), `state.session.id` without a null guard,
the iOS-only `onSelectionChange` prop the bundled react-native typings omit, a
`Partial<ActivityInboxItem>` union spread, and a mutable fixture typed `as const`. Fixed:
`useRef<string | undefined>(undefined)`, a guarded `state.session?.id`, a typed `SelectionAwareText`
wrapper that declares the runtime-only prop once (used by the tool card and message rows), overrides
narrowed to `ActivityInboxUiRequest`, and the fixture annotated `ProductDensity` instead of a const
assertion. No behavior change.

Verified: `bunx tsc --noEmit -p apps/ios/tsconfig.json` clean; `cd apps/ios && bun test` 146 pass /
0 fail across 21 files; root `bun run typecheck` clean; `ci-validate` OK. The device half of item 41
still belongs to item 23.

### OMP's skills reach the dock's catalog rows (2026-09-18)

OMP advertises skills as slash commands carrying `source: "skill"` (`rpc-types.ts:151-158`;
`available-commands.ts:59-67`), but `normalizeSlashCommands` dropped `source` and the dock's
`Skills/rules/hooks/commands` section was built without a skills collection, so it always rendered
the honest `skill:none` fallback. `SlashCommandOption` now carries `source`, a pure
`skillsFromSlashCommands` derives the collection, and `currentSettingsRows` passes it. The same
change reserves the generic JSON picker for genuinely unstructured OMP commands: `ompControls` no
longer offers `get_available_models`, `get_login_providers`, `get_available_commands` and
`get_state`, which all have dedicated Caret surfaces. MCP servers and hooks are deliberately
untouched: OMP's RPC exposes no such surface (research 2026-09-18), so their `none advertised`
fallbacks remain honest; rendering them needs new Caret patch commands and the
`chatSessionCustomizationProvider` proposal (new §10 item 43).

Verified: `bun test apps/macos/test` 650 pass / 1 fail (standing environmental `rg`; not code),
including new cases for source normalization, the skills derivation, the picker filter and a bind
case proving `skill:<name>` replaces `skill:none`; `bun run typecheck` clean; `ci-validate` OK.
Still open from item 36: MCP/hooks collections (blocked on an OMP RPC surface) and the native
Customize surface (item 43).

### Tool calls render as real cards in the native chat (2026-09-18)

`emitEntryUpdate` labelled a tool row with one progress line and `historyFromState` replayed only a
backticked name, so arguments and results never reached the native transcript. Both paths now build
a `ChatToolInvocationPart` from the row: the live stream pushes it with `enablePartialUpdate` (the
API's "update the previous call with this id" flag) on every change, and history pushes a completed
card, with `toolSpecificData = { input, output }` (the shape `extHostTypeConverters.ts:3071-3077`
converts to `kind: 'simpleToolInvocation'`, which `chatToolInvocationPart.ts` renders as collapsible
input/output sections). The card builder is pure and fixture-tested (`toolCardFromEntry` in
`chat-sessions-map.ts`) and clamps args to 1200 and output to 4000 characters with an explicit
truncation marker.

Verified: `bun test apps/macos/test` 647 pass / 1 fail (standing environmental `rg`; not code),
including card-state cases, the clamp, a live `runTurn` fixture asserting the partial-update card
and its completion, and a history fixture asserting the rendered card; `bun run typecheck` clean;
`ci-validate` OK. The stub's `ChatResponseTurn2` now keeps its constructor arguments, which replaced
a test-local subclass whose `instanceof` broke when the suite ran in file order. Not verified: no
live receipt (no computer-use runtime in this session). What the card work does not cover: edit
diffs (needs a tool-to-URI mapping for `ChatResponseMultiDiffPart`), thinking (the reducer
deliberately drops thinking blocks from transcript text) and subagent transcripts (items 8/11) —
§10 item 35 stays implemented, not closed.

### Composer attachments reach OMP (2026-09-18)

The native path sent `request.prompt` only, so every composer attachment was dropped at the
extension→OMP boundary even though the desktop bridge forwards `attachedContext`. `runTurn` now
reads `request.references`: image references (the workbench delivers them as
`ChatReferenceBinaryData` with `mimeType` + `data(): Uint8Array`,
`extHostTypeConverters.ts:3481-3681`) become OMP's own `images: ImageContent[]` (base64) on the
`prompt` command, and non-image references contribute their label (`name`, else `fsPath`, else
`path`) to a short `Attached context:` block appended to the message so a file or symbol attachment
is at least named rather than silently dropped. A reference whose `data()` rejects is skipped
without failing the turn. `streamingBehavior` stays unthreaded (item 11's mode work).

Verified: `bun test apps/macos/test` 641 pass / 1 fail (standing environmental `rg`; not code),
including fixture tests for the mapping and a `runTurn` case asserting the prompt payload carries
`images: [{ type: "image", data: "AQID", mimeType: "image/png" }]`; `bun run typecheck` clean;
`ci-validate` OK; `check:cursor-parity` OK. Not verified: no live receipt (no computer-use runtime
in this session) — §10 item 34 stays implemented, not closed.

### Native approvals are answered in the Agents window (2026-09-18)

The native path ignored pending `caret_ui` frames, so an OMP tool permission raised mid-turn was
answerable only from the IDE dock and the broker timed it out. `runTurn` now drains
`state.uiRequests` after each event page and presents each pending request as the workbench's
blocking `questionCarousel` (proposed `chatParticipantAdditions`), then sends the mapped answer
through the host's existing `/ui` route. The mapping is a pure, fixture-tested pair in
`chat-sessions-map.ts` (`uiQuestionFromRequest` / `uiAnswerValue`): confirm becomes Allow / Deny /
one scoped option per `scopes` entry with the dock's own wording, select and multi_select carry OMP's
options (labels from `optionDetails`), input/editor become text questions. Two request kinds are
deliberately not collected natively: `password` (the native input is not masked) and `schemaform`
(untrusted form HTML); both emit a warning pointing at the Caret composer instead of silently
dropping the request. The answer mapper unwraps the workbench's real answer shape
(`{ selectedValue }` / `{ selectedValues }`, option values stringified to `"true"`/`"false"` by
`ChatResponseQuestionCarouselPart.from`), so a real click maps to the same host answer the dock
sends.

Verified: `bun test apps/macos/test` 635 pass / 1 fail (the standing environmental `rg` failure; not
code), including six mapping cases and a `runTurn` fixture whose page carries a `caret_ui` frame:
the carousel is shown once with the request's id, `sendUiResponse` carries the token and `true`, and
a request already resolved (`status: "timeout"`) is never rendered. `bun run typecheck` clean,
`ci-validate` OK, `check:cursor-parity` OK. Not verified: no live receipt (no computer-use runtime
in this session) — §10 item 32 stays implemented, not closed.

### Live streaming carries in-place updates (2026-09-18)

The native path's `runTurn` emitted only the transcript rows an event page *appended*, while the
reducer updates existing message and tool rows in place (`state.ts` replaces the entry object for an
update without changing the array length). Text and tool status that arrived as updates to a row
already on screen never reached the live view. `runTurn` now keeps the last-sent entry per id and
emits a changed row with only its delta (`chat-sessions.ts`, `emitEntryUpdate`): message text is
emitted as the difference from what was already sent, a tool card is re-emitted only when its name,
status or output changed, and a rewrite of already-streamed text is logged instead of replayed
because the native stream cannot retract markdown.

Verified: `bun test apps/macos/test` 628 pass / 1 fail (the standing environmental `rg` failure in
`menus-contract.test.ts`; not code), including two new fixture cases that pin the streaming deltas
and the tool re-emit; `bun run typecheck` clean; `ci-validate` OK. Not verified: no live-window
receipt (no computer-use runtime in this session), so §10 item 33 stays implemented, not closed.

### The Apps panel stays the pane while a session is open (2026-09-18)

The Agents window's right pane is the Caret Apps panel, and Caret's strip is that pane's only tab
group (§3.2 records the decision; the native tab group stays hidden). The window's own session tabs
- the managed Changes multi-diff and the empty Files placeholder - are opened into that same single
editor group (`SINGLE_PANE_SCENARIOS.md`), and the panel's contribution opened it only while the
group was empty. Opening an existing session therefore replaced the panel with the base tab strip,
and since Terminal only exists inside the panel (the sessions workbench has no terminal editor),
the window read as the build without the terminal.

The panel now claims the pane whenever the group's active tab is one of those window-owned tabs, or
the group has no tab at all. It opens under `suppressEditorPartAutoVisibility()`, so claiming a pane
never reveals one; it skips a hidden editor area (a detail-only collapse, or the whole side pane
shut) and the classic layout; a real file or search editor the user opened is left alone; and
`Show Apps` records an explicit user hide so the rule does not silently undo it.
`singlePaneDockedTabsCoordinator.ts` additionally counts the group's session tabs without the
panel, so a session that opens into a group whose only tab is the panel still gets its managed
Changes/Files defaults (patch `0039`; the contribution change is inside patch `0021`, the patch
that creates it, because a later patch to a file another patch creates breaks that patch's own
reverse-check).

Verified on the packaged build (patch set `74c6ca5cbb28`, 36 patches, `bun run check:packaged`
green; `npx gulp vscode-darwin-arm64-min` 3.15 min, then `bun run package:mac`): cold launch, the
empty draft, and an existing session opened from the sidebar each show the strip
`Changes · Browser · Terminal · File` plus `Open new tab menu` in the right pane, and clicking
Terminal in that session gives `tab (selected) zsh` with the prompt `pond@CEDIA-M cedia %` there.
`bun run test` 881 pass / 0 fail (97 files); `bun run typecheck` clean;
`bun test apps/macos/test/desktop-patch-set.test.ts` 0 fail;
`bun test apps/macos/test/ide-native-workbench.test.ts` 67 pass (the patch-text pin for `0021`);
`node scripts/ci-validate.mjs` CI-OK. Not verified: the Hide Apps / detail-only transitions were
not re-measured.
Receipt: [`evidence/apps-panel-stays-with-session-2026-09-18/`](evidence/apps-panel-stays-with-session-2026-09-18/).

### The Agents home leads with the mark, and the picker's rows carry their provider's mark (2026-09-18)

The reference apps open a draft with the product mark and a question above the composer, and the user
asked for that shape and for the model picker to show which provider runs each model. Two Caret-owned
patches carry it. `0042` adds `caretHomeHero.css` and renders a 30px Caret mark plus the heading
`What should we build in caret?` as the first child of the Agent Home composer column, scoped so an
in-session composer and the web-only no-agent-host body keep their own layout; the mark is built
through the SVG namespace rather than `innerHTML`, because this document requires a TrustedHTML
assignment there and a throw took the whole home down (measured: the composer rendered nothing, and
`Failed to set the 'innerHTML' property on 'Element': This document requires 'TrustedHTML'
assignment` in `renderer.log`). `0041` teaches the picker's own provider-identity heuristic the
providers the Agents window actually runs (Cursor, OpenRouter, OpenCode, Command Code) with the same
shapes the extension's own dock picker uses, and patch `0011` copies each row's `statusIcon` off the
model Caret registered for the same id, so a row shows the provider's mark instead of the one
generic sparkle every provider used to share.

Verified on the packaged build (patch set with `0042`, `bun run check:packaged` green;
`npx gulp vscode-darwin-arm64-min` 5.2 min, then `bun run package:mac`): the empty draft shows the
mark and the heading with the composer beneath it, and the picker draws the globe on the OpenRouter
rows and the Claude mark on the Cursor row. `bun run test` 896 pass / 0 fail (98 files);
`bun test apps/macos/test/desktop-patch-set.test.ts` 0 fail; `node scripts/ci-validate.mjs` CI-OK.
Not verified: the provider split itself, which item 46 tracks.
Receipt: [`evidence/agents-home-hero-and-provider-marks-2026-09-18/`](evidence/agents-home-hero-and-provider-marks-2026-09-18/).

### The reference agent window's Tailwind surface is scoped and proven (2026-09-19)

Step 0 of the Synara port (`evidence/synara-ui-port-2026-09-19/NEXT-SESSION.md`). `0048` takes the
reference's Tailwind v4 entry and token sheet into
`src/vs/sessions/contrib/home/browser/caretUi/`, compiles them with
`scripts/synara-ui/build-css.ts` into a checked-in stylesheet whose every selector sits under
`[data-caret-surface]`, and mounts a throwaway probe in the empty Agent Home that renders three
vendored primitives (`Skeleton`, `Kbd`, `Empty`) under that root. The same patch extends the
bundler's inline plugin, so the ported components' bare imports (`class-variance-authority`,
`tailwind-merge`, and their transitive `clsx`) resolve inside the renderer the way React already
did. This was the port's riskiest step because Tailwind's preflight resets the whole document, which
in a window that shares a stylesheet with the Code-OSS chrome would have restyled the IDE.

Verified on the packaged build (patch set `6326cb538fa6`, 45 patches, `bun run check:packaged`
green; `npx gulp vscode-darwin-arm64-min` 3.15 min, then `bun run package:mac`): the empty draft
shows the probe with the ported tokens and primitives in both workbench themes, read back through
the accessibility tree as `text Synara surface ⌘K tokens scoped` / `text Empty` / `text Ported
primitive`. The acceptance was measured rather than argued: the same tree built without the
surface's import produces a sessions stylesheet identical to the shipped one except for the
25,476-byte surface block, the 458 bytes of hoisted legal comments and one blank line; the IDE
window's `workbench.desktop.main.js` is byte-identical to the shell that shipped before this change
and carries no `data-caret-surface`. `bun test apps/macos/test/synara-ui-css.test.ts` (4 assertions)
recompiles the sources and fails on drift, on any rule escaping the surface, on a global keyframe
name, or on the React root and the stylesheet disagreeing about the attribute. `bun run test` 900
pass / 0 fail (99 files); `bun run typecheck` clean; `node scripts/ci-validate.mjs` CI-OK;
`bun test apps/macos/test/desktop-patch-set.test.ts` 0 fail.
Receipt: [`evidence/synara-ui-port-2026-09-19/`](evidence/synara-ui-port-2026-09-19/).

### The reference's own hero replaces Caret's stand-in (2026-09-19)

Step 1a of the Synara port. `0049` vendors the reference's `ChatEmptyStateHero` (its element tree and
classes, minus the brand mark) and mounts the reference's presentation through Caret's seam -
`caretUi/caretSynaraSurface.tsx` owns the React root and the `[data-caret-surface]` attribute the
compiled stylesheet is scoped by, and `newChatWidget.ts`, which renders the home, mounts it and
pushes it the draft's project name from its own workspace picker. The copy is the owner's:
`What are we building in` over the selected project, in the reference's own typography. `0042` was
re-cut by this step: the stand-in mark and heading it introduced, and the CSS rules that sized them,
are gone, leaving the anchor stylesheet that places the home's first flex item above the composer.
The reference's colour tokens stay scoped to the surface and are not mapped onto the workbench
palette yet, and no Synara logo or wordmark is taken.

Verified on the packaged build (patch set `76af779d8b78`, 46 patches, `bun run check:packaged`
green; `npx gulp vscode-darwin-arm64-min` 3.3 min, then `bun run package:mac`): the empty draft
shows the question and `cedia` under it, read back through the accessibility tree as `heading What
are we building in` / `text cedia`, in the dark workbench theme (the state the build was captured
in; the surface's light half is the token sheet the step 0 probe rendered in light). The IDE window's
`workbench.desktop.main.js` is identical to the previous build's once every numeric literal is
removed - the only differences are NLS message indices, which shift because the stand-in string left
the program. `bun run test` 900 pass / 0 fail (99 files); `bun run typecheck` clean;
`node scripts/ci-validate.mjs` CI-OK; `bun test apps/macos/test/desktop-patch-set.test.ts` 0 fail.
Receipt: [`evidence/synara-ui-port-2026-09-19/`](evidence/synara-ui-port-2026-09-19/).

### The composer's evidence chips wear the reference's chrome (2026-09-19)

Step 1b, first half. `0050` takes the reference's composer-toolbar class strings
(`caretUi/composerChrome.ts`, from its `composerPickerStyles.ts`) and pins the two runtime-injected
`--color-*` tokens those classes read (`caretUi/themeRuntimeTokens.css`, at the values the
reference's own theme derivation produces for its default theme - the second token layer its
`index.css` does not carry). Caret's branch and runtime chips now render with them, so the row above
the composer is the reference's capsule-trigger typography and hover fill rather than Caret's own
chip stylesheet; the icons stay Caret's codicons at the reference's sizes, because the reference's
are resolved from a Vite asset path the workbench cannot serve. The step also fixed the runtime
chip's condition: `0024` read "runs here" as `!hasRemoteTarget && (no session || providerId ===
'local-agent-host')`, which is false for a draft served by the extension's own provider - the
ordinary case - so the chip was absent whenever a draft was registered. It is `!hasRemoteTarget`
now, which is what the chip claims.

Verified on the packaged build (patch set `e4dd22ca632c`, 47 patches, `bun run check:packaged`
green; `npx gulp vscode-darwin-arm64-min` 3.35 min, then `bun run package:mac`): the empty draft's
row reads `cedia · Caret · This Mac`, the chip read back through the accessibility tree as
`container Runs on this Mac` / `text This Mac`, and `0048` and `0024` were re-cut for the artifact,
`VENDORED.md` and the chips' React. Receipt:
[`evidence/synara-ui-port-2026-09-19/`](evidence/synara-ui-port-2026-09-19/).

### The Agent Home's composer row is the reference's (2026-09-19)

Step 1b, second half. `0051` puts the reference's `ChatComposerFooter` row inside the home's composer
card: React owns the row's classes, layout and send button (`ui/button.tsx` vendored whole with Base
UI, plus its spinner and the send glyph drawn from the reference's own `arrow-up.svg`), while
Caret's controls are appended into the row's two slots - the attach `+` leading, and the config
toolbar (the model picker, until step 2 replaces it), the voice controls and the loading spinner in
the picker-controls slot ahead of the send button - so their workbench action lifecycles survive.
The base send button is hidden in this composer. Four upstream branches are dropped because Caret
has no source for their state (interaction mode, sidebar action, plan follow-up, pending-user-input
and voice-recorder twins), and `onSubmit` replaces the `<form>` submit; `VENDORED.md` lists each.

Verified on the packaged build (patch set `8ec8ce49561c`, 48 patches, `bun run check:packaged`
green; `npx gulp vscode-darwin-arm64-min` 3.4 min, then `bun run package:mac`): the row renders
inside the card as `+` leading and `DeepSeek V4.1 Flash · mic · send`, and the send button's state
follows the composer - the accessibility tree reads `button (disabled) Send message` on an empty
draft and `button Send message` after a keystroke. The click itself was not exercised: sending
starts a real OMP turn. Receipt:
[`evidence/synara-ui-port-2026-09-19/`](evidence/synara-ui-port-2026-09-19/).

### The Agent Home's model control is the reference's picker (2026-09-19)

Step 2 of the Synara port. `0052` vendors the reference's picker pieces - `composerPickerStyles.ts`
(its whole picker/panel class vocabulary), `composerPickerSize.ts`, `surfaceStyles.ts`,
`ui/input.tsx`, `ModelStarButton.tsx`, and the panel geometry in `composerPickerPanel.css` - and
composes them in `caretUi/modelPicker.tsx`: the trigger is `ComposerModelMenuTrigger`'s markup and
classes, the panel is `ComposerPickerMenuPopup`'s shell, the rows are `ui/menu`'s radio items with
the reference's option classes, and the star is vendored whole, fed by Caret's own catalogue (one
group per provider, the provider travelling on each row's `detail`) and its pinned-model store.
`0047`'s action-widget picker is retired with it: `caretModelPicker.ts` is gone and
`rg caretModelPicker` is 0.

The step's first attempt was reverted with a measured blocker, and the way through it is the step's
main finding: Base UI's portalled menu is reachable through the accessibility tree and never
appears on screen in this window (`document.body` and the workbench element as the portal target
both, with the positioner's z-index raised above the workbench's layers), and rendering the
positioner inline is unsupported (`Base UI error #32`, which takes the whole home down). The panel
is therefore an in-tree overlay placed by Caret - an absolutely positioned element inside the
composer's row, carrying the reference's panel, option and label classes plus the `data-slot`
attributes its stylesheet keys off - which is how the workbench paints its own overlays; the card
and its bottom row are not allowed to clip it (`caretComposerFooter.css`). Caret's own workspace
picker is the control that proved the capture honest: it paints in the same screenshots in which
the portalled menu did not.

Verified on the packaged build (patch set `35298d1f6dd8`, 49 patches, `bun run check:packaged`
green; `npx gulp vscode-darwin-arm64-min` 3.5 min, then `bun run package:mac`): the trigger paints
in the footer, the panel paints under it with its search field, the `commandcode` provider group,
the model rows and their stars, and a row's pick reaches the draft - the trigger read
`DeepSeek V4 Flash`, went to `Claude Fable 5`, and came back. The panel's rows are deliberately not
read from the accessibility tree (only `text field (settable) Search models` reaches it); they are
read from the screenshot. `bun run test` 900 pass / 0 fail (99 files); `bun run typecheck` clean;
`bun test apps/macos/test/desktop-patch-set.test.ts` 0 fail.
Receipt: [`evidence/synara-ui-port-2026-09-19/`](evidence/synara-ui-port-2026-09-19/).

### The reference's palette reaches Caret's own composer card (2026-09-19)

Step 2b of the Synara port, and the owner's decision about colours: the agent window takes the
reference's palette first and stays unbound to the workbench's, while the IDE window keeps Cursor's.
Two things were missing behind that.

**The tokens were the reference's fallback, not its palette.** The vendored token sheet is what the
reference paints *before* hydration; the values it actually renders with are written at runtime by
`theme/theme.logic.ts` from the active chrome theme. `caretUi/themeRuntimeTokens.css` now pins that
layer - 37 names, dark and light - at the values that derivation produces, including two steps that
are easy to get wrong by hand: the contrast curve makes `normalizeContrastStrength(0)` **negative**
(`0/100 + (0 - 60)/60 * 0.7 = -0.7` for dark), so `--color-text-foreground-secondary` is `0.58`
rather than `0.65`; and `--background` is the theme's "surface under" (`#161616`), not the theme's
surface (`#181818`), which is `--color-background-surface` and what the column, the sidebar and
`--card` are painted with.

**The card was still the base's.** `caretUi/composerSurfaceTokens.css` vendors the reference's
raised-chrome family (`--surface-border` with its strength knob, `--composer-stacked-border`,
`--composer-radius`, the `--composer-glass-*` trio) from its `index.css`, and
`contrib/chat/browser/media/caretComposerSurface.css` applies the reference's own recipe to the
workbench's `.new-chat-input-area`: the 1.2rem radius, the outline, the 55 % glass fill, the shadow
in both variants, and the blur on a `::before` rather than on the card (a `backdrop-filter` on the
element would make it a containing block for the ported picker panel anchored inside it). The
base's focus ring is kept, on the reference's own `--app-composer-focus-border`.

The palette needed a second root to reach a card the port does not own. The compiled stylesheet's
token rules (everything the compiler emits on `:root`/`:host`) now match `[data-caret-tokens]` as
well as `[data-caret-surface]`, and `newChatWidget.ts` sets that attribute on the home column so
Caret's own chrome around the composer reads the reference's colours. Widening the *surface* root
instead was not an option: the same stylesheet carries Tailwind's preflight, which would reset every
workbench element inside the column. `apps/macos/test/synara-ui-css.test.ts` asserts both roots and
that nothing beyond a token or an inherited-text default is scoped to the token root.

Verified on the packaged build (patch set `792af80a88b4`, 50 patches, `bun run check:packaged`
green; `npx gulp vscode-darwin-arm64-min` 3.45 min, then `bun run package:mac`), measured from the
screenshot rather than argued: the card's corner radius reads ~19 px against the base's 8 (the
straight edge is reached 12 rows below the top edge, upstream's `1.2rem`), its fill is `#1c1c1e`
over the column's `#191a1d` where the base painted the workbench theme's opaque `#202122`, its
outline reads `rgba(255, 255, 255, 0.04)` where the base's was `#333536`, and the picker panel's
surface is `#1d1d1d` rather than the fallback sheet's `#101010`. The in-session composer is
untouched, measured in the same run: its card still fills `#202123` with the base's radius and
outline. `bun run test` 900 pass / 0 fail (99 files); `bun run typecheck` clean;
`node scripts/ci-validate.mjs` CI-OK; `bun test apps/macos/test/desktop-patch-set.test.ts` 0 fail.
Receipt: [`evidence/synara-ui-port-2026-09-19/`](evidence/synara-ui-port-2026-09-19/).

### The Agent window has the reference's Environment panel (2026-09-19)

Step 3, first half. `0054` adds a title-bar control beside `IDE` (`Menus.TitleBarCenterRight`) that
toggles the reference's `EnvironmentPanel`, and mounts the card where the reference puts it: an
overlay pinned to the chat column's top-right (`absolute inset-y-0 right-0` on a `p-3` wrapper). The
open state lives in `ICaretEnvironmentPanelService` because the control is a menu action and the card
is a DOM host, and neither can see the other
(`contrib/home/browser/caretEnvironmentPanel.contribution.ts`).

What is the reference's: the card itself - the overlay wrapper, `ENVIRONMENT_PANEL_SURFACE_CLASS_NAME`
with `ENVIRONMENT_PANEL_MOTION_CLASS`, the title row, the `p-1.5` content column, and the
section/row primitives vendored whole in `caretUi/environmentRow.tsx` (`EnvironmentRow`,
`EnvironmentRowBody`, `EnvironmentPanelTitle`, `EnvironmentSectionDivider`,
`EnvironmentLabeledSection`) with `caretUi/environmentPanelStyles.ts`. What is Caret's: the
composition and the rows this window can back - `Changes` (creates the Apps panel's Changes pane and
reveals the panel that owns it), `Local` (this Mac, or the connected remote host), the session's
branch (copies it, as the composer's branch chip does), `Repository` (the draft's folder) and
`Editor` -> `Open in IDE`. A row with no action renders as text rather than as a button, so nothing
here claims to be a control it is not (§11 gate 4).

Rows the reference has that this window cannot back are left out rather than drawn empty:
`Commit & push` and `Local Servers` (the git extension's actions and the host's terminals are not
reachable from this window's renderer), `Usage` (the account's usage has no renderer surface), and
the Recap / Pinned / Pull requests / Sidechats / Automations / Studio outputs sections (no source at
all). Item 50 carries the same list.

Verified on the packaged build (patch set `661275570093`, 51 patches, `bun run check:packaged`
green; `npx gulp vscode-darwin-arm64-min` 3.8 min, then `bun run package:mac`): the control paints
beside `IDE` and reads back through the accessibility tree as `toggle button Environment`; opening it
paints the card with `text Environment` / `button Changes` / `text Local` / `text Repository` /
`text cedia` / `text Editor` / `button Open in IDE`; pressing the `Changes` row selects the Apps
panel's own Changes pane (`toggle button Description: Changes, Value: 1`,
`tab (selected) Description: Changes`). `bun run test` 900 pass / 0 fail (99 files); `bun run
typecheck` clean; `bun test apps/macos/test/desktop-patch-set.test.ts` 0 fail.
Receipt: [`evidence/synara-ui-port-2026-09-19/step3-environment-panel-light.png`](evidence/synara-ui-port-2026-09-19/step3-environment-panel-light.png).

One honest note from the run: this build's first cold start showed the composer's model control as
`No models available`. That is the boot race item 2 of §10 already records, not this step - the same
build relaunched loaded the full catalogue (`commandcode` group, its rows and their stars), and the
trigger read `DeepSeek V4 Flash`. It is written down so the next session does not read it as a
regression.

### Step 5 measured: the reference's permission chip has nothing to set here (2026-09-19)

Step 5 of the port, and the answer is that this window must not draw the control. Measured in the
current tree, not assumed:

- The reference's composer row carries a permission chip whose levels *are* its agent's approval
  policy (`Full access` and the rest). Caret's agent is OMP, and OMP exposes no such level to set:
  `rg -i "approvalPolicy|permissionMode|autoApprove" apps/ packages/` is 0, and Caret's host registers
  exactly three bridges - `caret_editor`, `caret_native_editor` and `caret_native_permission`
  (`apps/host/src/service.ts` 205-215) - none of which sets one.
- Approval is a **per-call choice the agent owns**. `#nativePermission` (`apps/host/src/service.ts`
  511) validates the request's own option list (`allow_once` / `allow_always` / `reject_once` /
  `reject_always`), hands it to the surface as an `extension_ui_request` with `method: "select"`, and
  resolves with the option the user picks (120 s timeout). `apps/macos/src/approval-view.ts` and
  `chat-sessions-map.ts` render exactly those choices in the Agents window, which is the landed path
  (§9, "Native approvals are answered in the Agents window", 2026-09-18). "Always allow" is one of
  OMP's own options, so the policy lives with the agent, not in a Caret control.
- The only way to give this window a *real* chip would be to auto-answer OMP's requests on the
  user's behalf, which is a new capability with its own security decision rather than a port. A chip
  showing a level it cannot set would be a control with nothing behind it - §11 gate 4.

So item 49's permission half and item 51's `Permission (Full access)` row close as **not portable**
with this measurement as the receipt, and the composer row keeps `+`, model, effort, voice and send.

### Step 3 closed: the `+` extras panel has one row here, so it is left out (2026-09-19)

Step 3's second half, measured rather than assumed. The reference's `ComposerExtrasPanel` is one flat
"Add" list, and each of its rows against Caret's sources:

| Reference row | Caret's source | Verdict |
|---|---|---|
| `Add files` (attachments) | Caret's own attach control, already one click in the footer's leading slot | Available, but the panel would add a menu step in front of it |
| Frontmost app window (with an app-snap list) | None - there is no app-snapshot service in this window | Left out |
| `Goal` (`/goal` insert) | None - the field exists in no Caret surface | Left out |
| `Plan` / `Debug` interaction-mode toggles | None - OMP advertises no chat modes (same measurement as the hidden `Agent` chip) | Left out |
| `Fast mode` toggle | None - no runtime-capability descriptor is published for it | Left out |

Porting the panel as it exists here would therefore replace a one-click attach with a menu holding a
single row, which is worse for the user and no closer to the reference's behaviour. The reference's
`ComposerExtrasTrigger` and `ComposerExtrasPanel` stay unported until a second row has a source;
item 49's "row order" note covers what the row does keep. Item 51's table is updated below.

### The reasoning control is the reference's, in the reference's place (2026-09-19)

`0055-caret-synara-effort-control.patch` (renamed from `...-effort-chip`), with `0048`, `0051` and
`0052` re-cut. The step removed the separate chip an earlier pass had put in the composer row and
rebuilt the control where the reference keeps it: the trigger's muted `statusLabel`
(`ComposerModelMenuTrigger.tsx`) and one `<Trait> … <value> ›` row in the picker panel's footer
(`ComposerModelPickerTraitRows.tsx`'s `TraitRow`), whose options are the model's ladder. The
reference's composer footer renders no effort control of its own - `contextMeter`, the picker, voice
and the submit button - so `caretUi/modelPicker.tsx` (inside `0052`) draws both pieces, the row
expanding its levels inline because upstream's `MenuSub` popup is portalled like the panel was, and
the search matches a row's name, id and provider as `buildProviderTabRows` does. The trigger also
carries the reference's own label, `Change model and reasoning`. `0055` is the workbench wiring: the
group's published level is the chip's selection, the footer re-reads its groups when they arrive,
and the control is drawn only when the group's model is the model the composer is showing.

**The ladder's row now resolves.** The extension asked `ompModelRowForPick(snapshot,
snapshot.selectedModelId)` for the current model and got nothing, because
`deepseek/deepseek-v4.1-flash` is advertised by both `openrouter` and `commandcode`: measured
`selected='deepseek/deepseek-v4.1-flash' row=none ladder=none`. `currentModelFromOmpState` now keeps
`data.model.provider` and the `thinkingLevel` beside it, `projectOmpModelSnapshot` uses the provider
as the tie-break, and the snapshot carries `selectedModelProvider` / `selectedThinkingLevel`, so the
line reads `reasoning for 'commandcode:deepseek/deepseek-v4.1-flash' -> none` (that row advertises
no ladder) and `reasoning for 'cursor:claude-4.6-opus-high' -> minimal/low/medium/high` for a model
that has one.

Verified on the packaged build (`npx gulp vscode-darwin-arm64-min` 11 min under load, then
`bun run package:mac`, `bun run check:packaged` green, personal launcher): the trigger reads back as
`button Change model and reasoning`; with the host on `cursor/claude-4.6-opus-high` and the draft
showing that model the trigger reads `Claude Opus 4.6 1M Reasoning`, and the panel's footer paints
`Effort … Reasoning ›`, which expands to `Minimal / Low / Medium / High`. Receipts:
[`evidence/synara-ui-port-2026-09-19/item49-effort-trait-row-light.png`](evidence/synara-ui-port-2026-09-19/item49-effort-trait-row-light.png)
and [`…/item49-effort-levels-light.png`](evidence/synara-ui-port-2026-09-19/item49-effort-levels-light.png).
`bun run test` 902 pass / 0 fail (99 files); `bun run typecheck` clean; `node scripts/ci-validate.mjs`
CI-OK; `bun test apps/macos/test/desktop-patch-set.test.ts` green.

**Measured, and left open for item 49: a draft's pick never reaches the extension.** The
write-through now logs every change it receives (`Caret session option change: <resource>
<optionId>=<value>`), and driving the picker on an untitled draft produced no line - for the model
pick or for the reasoning pick - and choosing `High` left the trigger's status label unchanged. The
workbench's option store needs a chat session record for the resolved resource
(`chatSessions.contribution.ts` `updateSessionOptions`), and the options that seed a drafted session
come from that same store (`extensionSessionsProvider.prepareNewSession` passes
`initialSessionOptions: getSessionOptions(draft.resource)`), so the missing piece is the draft's
record rather than this control. That is the gap item 5 already records for the draft's model pick;
the persistence half of item 49 stays open on it.

### The Agents window's sidebar is the reference's (2026-09-19)

Step 4, `0022-caret-agent-home-chrome-navigation.patch` re-cut: the four files that patch creates
(`agentHomeNav.ts`, `agentHomeNavReact.ts`, its contribution and its stylesheet) now draw Synara's
sidebar rather than Cursor's. The two plans' sidebars are different surfaces and both statements
were right: §3.5 locked its IA from a **Cursor** capture, and §3 is the *IDE window's* Cursor-parity
contract, while this window's reference is Synara. Read from the reference's source
(`apps/web/src/components/Sidebar.tsx`, `sidebarNavOrdering.ts`, `sidebarRowStyles.ts`,
`SidebarIconButton.tsx` at `3333343`):

- `Search` is a **header icon button** (`SidebarIconButton size="header"` = `size-6 rounded-md`) in a
  short header row (`flex items-center gap-1 pt-0 pb-1 pr-2.5 pl-1.5`), beside the surface picker -
  it is not one of the primary navigation rows;
- the primary navigation block (`px-1.5 pt-1 pb-1.5`, rows `gap-0.5`) reads `New thread` /
  `Kanban` / `Pull requests` / `Automations`, each row `min-h/h-[1.75rem]` (28px) with `px-2 py-0.5`
  in a `rounded-md` box;
- `Projects` is a section header (`h-7`, 12px, normal weight, muted) whose toolbar hangs off the
  right: expand/collapse all, a sort menu, `Add project`;
- it has no `Customize` row and no `Repositories` section: its project list *is* the repository
  list.

What landed: `headerActions: [Search]`; rows `New thread` / `Automations`; one `Projects` section
whose action is `Add project` (`caret.project.add`); the header rendered as
`.caret-agent-home-nav-header` with a `.caret-agent-home-nav-header-action` per action; and the
reference's geometry in `agentHomeNav.css` - the header row's padding and 24px button box, 28px rows
with 8px/2px padding, the group's `4px 6px 6px` block padding, a 20px section action, and a
normal-weight muted section label. The `entries` / `filter` / `filterEmpty` machinery the removed
`Repositories` section owned is gone with it.

Cursor's `Customize` row and `Repositories` section are removed from this window, and neither
command was unregistered: the IDE window keeps its Customizations view and both stay reachable from
the command palette, so a row went rather than a feature. The parity test now pins their absence.
`Kanban` and `Pull requests` stay out for want of a source, and the reference's `Pinned` block,
`Chats` section, section sort menu and footer `Settings` row are not drawn either; the project and
thread rows below the header are the sessions tree this window already stacks there.

Verified on the packaged build (patch set `2568f3148462`, 52 patches, `npx gulp
vscode-darwin-arm64-min` 9 min then `bun run package:mac`, `bun run check:packaged` green, personal
launcher): the sidebar's accessibility tree reads `button Search`, `button New thread`,
`button Automations`, `text Projects`, `button Add project` and then the project groups and their
task rows, with no `Customize`, no `Repositories` and no repository filter. `bun run test` 902 pass
/ 0 fail (99 files); `bun run typecheck` clean; `node scripts/ci-validate.mjs` CI-OK; `bun test
apps/macos/test/desktop-patch-set.test.ts` 0 fail.
Receipt: [`evidence/synara-ui-port-2026-09-19/step4-sidebar-light.png`](evidence/synara-ui-port-2026-09-19/step4-sidebar-light.png).

### A draft's picks reach the session, and OMP (2026-09-19)

Item 49's second half, and the cause was outside the port: **a draft had no chat session record, so
the workbench's option store refused every write for it.** `ChatSessionsService.updateSessionOptions`
looks the resource up in its own `_sessions` map and returns `false` without one, and nothing in this
window ever resolved a session for `caret.omp:/untitled-…` - `getOrCreateChatSession` is called by the
base when it opens a session, by rename, and by the base agent provider, none of which a Caret draft
goes through. So the composer's model pick was refused and reverted (the renderer log said
`[extensionSessions] model selection was not accepted; restored previous model.` on every draft), and
`extensionSessionsProvider.prepareNewSession`'s
`initialSessionOptions: getSessionOptions(draft.resource)` was always `undefined`, which is why the
effort control's pick reached the created session as nothing.

The fix folds into `0010`: `createNewSession` resolves the draft's session, which is what opens the
option store for it. No host session is created - Caret's content provider answers a draft resource
with an empty shell - and the record is per draft. Measured live on patch set `b1b478a4fbc5`: the
extension log carries the write-through with the draft's own resource
(`Caret session option change: caret.omp:///untitled-684f71a5-… reasoning=high`), the trigger and
the panel footer show the level (`DeepSeek V4.1 Flash High`, `Effort  High  ›`), and the session
created by sending that draft has OMP's own transcript recording both writes -
`model_change cursor/claude-4.6-opus-high` and `thinking_level_change high`. The verification created
one session on this machine (title `hi`); a real turn was the only way to read the host's record of
the two writes. `bun run test` 902 pass / 0 fail; `bun run typecheck` clean;
`node scripts/ci-validate.mjs` CI-OK; `bun test apps/macos/test/desktop-patch-set.test.ts` 0 fail;
`bun run check:packaged` green.
Receipts: [`evidence/synara-ui-port-2026-09-19/item49-draft-effort-high-light.png`](evidence/synara-ui-port-2026-09-19/item49-draft-effort-high-light.png).

The race that fix first left is closed in the same patch: the composer mounts while the draft's
record resolution is still in flight, so its first write (the remembered model) was refused and
reverted - one warning per new draft. The provider now holds that promise (`_draftOptionStore`) and
retries the refused write once the store exists, keeping the honest revert only for a resource it
does not own. Measured on the same build: a fresh draft logs no `model selection was not accepted`
line, and the remembered model lands afterwards (`… models=caret-omp/deepseek-v4.1-flash`), so the
draft's store and the model the window shows agree.

### A sent message can be edited and replayed on OMP's own rewind (2026-09-20)

The user asked whether a message they sent could be rewound. OMP's own answer is `/branch`, aliased
`/rewind` (`Rewind to a previous message, keeping the old path as a branch`), whose RPC form is
`branch { entryId }` -> `session.branch(entryId)`: the conversation is cut at that **user** message,
the abandoned path stays in the session tree, and the original text comes back to be resubmitted.
That is the whole of what the harness offers - its `checkpoint`/`rewind` **tools** are context
compaction for the model (`intermediate checkpoint messages removed from active context`), not a
workspace snapshot - so the agent window now does exactly that and nothing more.

Three gaps had to close, and the first two were the reason the window offered nothing at all:

1. **`turnId: null` on every message.** Synara gates its `Edit message` button on
   `resolveLatestTailUserMessageEditTarget`, which needs the tail from the latest user message to
   belong to exactly one turn; with no turn ids it always answered `missing-turn-metadata`.
   Measured before: zero `Edit message` controls in the live window. The adapter now maps each
   transcript entry to the prompt command that owns it (`turnIdsByEntry`), measured after: one.
2. **The command was unimplemented.** `dispatch` ended in `unsupported(type)` for
   `thread.message.edit-and-resend`. It now resolves the message's index among the session's user
   messages, reads OMP's own rewind points (`get_branch_messages` -> `{entryId, text}`), branches,
   and resubmits. Counting is deliberate: the composer rewrites what it sends, so stored and visible
   text differ.
3. **A rewind has to replace the transcript, not extend it.** Caret's transcript is a projection of
   an append-only journal while OMP's session is a tree, so replaying the journal would show exactly
   the messages the user rewound past. `resyncTranscript` swaps the transcript for OMP's own
   `get_messages` answer at the current cursor. OMP also points the session at a **new file** on a
   branch (verified: `2026-09-20T05-15-35-613Z_01a0bd3d….jsonl`, new incarnation), which the host's
   existing `branch` case already followed.

Found and fixed while measuring the same code path: the host records a `caret_command` **twice**
(acknowledged, then with its result after the turn ends), and reading the second record as "a turn
started" put a finished task back into `running` - the window showed `Thinking` after the answer had
arrived, offered `Steer` instead of `Send`, and queued everything typed. The command's own `status`
is the discriminator now.

Also landed here: archived projects leave the sidebar. The host answers `/v1/projects` with archived
rows (a client that offers *restore* needs them) and this projection dropped the flag, so a
smoke-test project archived on 2026-09-12 still appeared on every launch.

Receipt (live, packaged app, same task): edit the tail message -> journal reads
`branch {"entryId":"b4ffd9f0"}` -> `get_messages` -> `prompt {"message":"Reply with exactly:
caret-rewind-ok"}` -> the answer renders; the abandoned tail is gone from the window and still
present in OMP's previous session file. `bun test apps/macos/agent-window/test/adapter.test.ts`
24 pass / 0 fail (4 new cases: turn ids, the ack discriminator, workspace metadata, and the rewind
sequence), agent-window `typecheck` clean, `bun run check:packaged` green.

### Archived threads have a bulk delete (2026-09-20)

The owner asked for a "delete all" for archived threads. Archived threads already had a home in the
window - Settings -> Archived lists them per project with per-row Restore/Delete - so this is one
control, not a new surface: the panel now carries the count and a `Delete all` button beside it,
using the panel's own `deleteArchivedThreadsFromClient` and its children-before-parents order, with
the same confirm-before-destroy rule as the single-row path. The change is a **Caret addition to a
vendored file** and is recorded in `apps/macos/agent-window/upstream.json` adaptations, because
re-vendoring must not silently drop it.

Receipt (live, packaged app): Settings -> Archived renders `2 archived threads` + `Delete all`, and
pressing it raises `Permanently delete 2 archived threads? / This will remove the threads and their
conversation history forever.`; cancelling leaves both rows in place. The destructive path itself was
not exercised against the owner's store.

### Onboarding drops the agent and appearance steps (2026-09-20)

The owner runs OMP as the only harness and takes the appearance from the IDE theme, so the
first-run tour no longer asks either question: the `providers` step ("Choose your agents") and
the `theme` step ("Pick an appearance") are out of `ONBOARDING_STEPS`, and the tour reads
welcome → tour → project → done with the step counter following the array. The done summary
keeps theme out and reports only the added projects. `ProvidersStep.tsx`,
`ProviderConnectTerminal.tsx` and `ThemeStep.tsx` had no other importers and are deleted; the
`useTheme` hook, `CODE_THEME_OPTIONS` and the Settings appearance panels stay because the app
still renders themes, it just no longer chooses one during setup. The tour's agents card is
rewritten OMP-only ("Run OMP in one workspace") since the old card promised every provider.

Receipt: `rg` finds no `ProvidersStep`/`Choose your agents`/`Pick an appearance` under the web
source; agent-window `vite build` clean, `bun test test/` 57 pass / 0 fail, vendor `tsc`
clean.

### Agent theme follows the IDE theme pack (2026-09-20)

The snapshot channel already carried the IDE's `workbench.colorTheme` name into the agent
(`syncAgentsWindowTheme` → snapshot file → bootstrap/poll), but `useTheme` only ever applied
its light/dark mode and accent tints: the agent kept rendering its own stored theme pack, so
picking Catppuccin in the IDE visibly did nothing. `packForIdeThemeName` (new in
`theme.logic.ts`, next to the pack catalog) maps the IDE name onto the closest pack —
Catppuccin/Dracula/GitHub/Gruvbox/Monokai/Night Owl/Nord/Solarized/Tokyo Night and friends,
stock VS Code themes to VS Code Plus — gated by `isCodeThemeAvailable` for the snapshot's
variant, and `stateForHostTheme` applies it as a transient overlay: unknown names keep the
stored pack, and the Settings choice still rules wherever no host snapshot exists.

Receipt: `ide-theme-pack.test.ts` 5 pass (exact/decorated names, case folding, variant
gating, unknown-name fallback); agent-window suite 62 pass / 0 fail; vendor `tsc` clean;
`vite build` clean.

### Native sessions UI retired (2026-09-20)

27 desktop patches served only the native sessions workbench UI, which no window renders
since `0056` loads the standalone agent bundle (`vs/cedia/agent/index.html`) instead of
`sessions.html`: `0008`, `0010`, `0015`-`0018`, `0020`-`0026`, `0029`, `0031`,
`0035`, `0039`, `0042`, `0048`-`0055` are deleted (backup in `/tmp/retired-patches` and git
objects; `0007` and `0037` kept surgically reduced to their platform/workbench hunks).
`0005` was deleted and then restored in the same pass: its import trims are what keep the
sessions entries compiling against the `removals` list, and the gulp build fails without
it — runtime-dead is not build-dead, and the desktop build (not just `prepare-desktop`)
is the proof that matters. The manifest holds the 29 that remain (workbench-shared
chat/model-picker stack, platform, product identity, agent-window bridge, zoom/chrome).
The deleted patches edited code paths no rendered surface executes. Companion cleanup in
the same pass: `agent-home-project-menu` and `synara-ui-css` tests (pinned deleted
sources), 15 patch-pinning blocks in `ide-native-workbench.test.ts` (one repaired for
surviving `0011`), a duplicated helper suite inside that file that never parsed, and a
test-isolation fix (`agent-window-main` fixture now uses an empty tmp stateDir instead of
the real user dir).

Receipt: clean-tree `prepare-desktop` applies 28 + 19 removals, re-run idempotent via
stamp; root suite 967 pass / 1 fail (the pre-existing theme-handoff test, in-progress
before this change); iOS 156/156; relay/store/service green; `ci-validate` CI-OK;
`Cedia.app` repackaged, signed, `check:packaged` green, cold-launched with host serving.
Provider path verdict (traced this pass): the bundle reads sessions only through the
native bridge straight to the host (`adapter.sessions()` → `/v1/sessions`), never through
`chatSessionsProvider`. The provider registration and draft-flow handlers in the extension
(`newChatSessionItemHandler`, `applyDraftModelChoice`, draft option reads) are dormant at
runtime; the projection library (`chat-sessions-map.ts`, imported by the adapter) and the
workbench chat participant (IDE inline flows) stay live. Slimming the dormant half, with
its unit-test rescope, is the next extension workstream — deliberately not folded into this
patch retirement. `0028`'s React-inlining config is inert (no `.tsx` consumer left).

### Editor-view entry points retired, stale setup copy cleaned (2026-09-20)

Two windows, not three: the chat header's `Editor view` toggle (`viewModeAction` in
`SingleChatSurface.tsx`) is gone, and with it the Environment panel's `Editor view` row
(`onOpenEditorView` now resolves null; the `Open in <editor>` picker stays). The
`?view=editor` route, `EditorWorkspaceView`, `editorViewState` and the dock's file-edit
handoff into it are untouched in this pass — they still render for deep links and dock
edits, they are just no longer offered anywhere, and their full retirement is §10 item 53.
Same pass cleans the copy the onboarding landing left stale: the dialog header comment, the
Settings welcome-tour replay description and its search keywords (no more "provider
selection, appearance"), and the Environment Editor-section description plus its search
index (no more "in-app editor view"). The tour's agents card was already OMP-only and the
gateway card's external MCP pairing is a real surface, so both stay.

Receipt: `rg` finds no `Choose your agents` / `Pick an appearance` / `in-app editor view` /
`handleOpenEditorView` / `label: "Editor view"` under the web source; agent-window suite 62
pass / 0 fail, root `tsc` + vendor `tsc` clean, `vite build` clean.

### In-app editor view deleted, dock edits open in the IDE (2026-09-20)

Closes §10 item 53. `?view=editor` no longer parses (`diffRouteSearch.ts` drops `view` /
`editorFilePath`), and the whole surface is deleted: `EditorWorkspaceView.tsx`,
`WorkspaceFileEditorPane.tsx`, `WorkspaceFileDiffEditorPane.tsx`, `editorViewState.ts`,
`lib/editorCenterMode.ts`, the editor state/handlers/render branch in `SingleChatSurface`,
`presentationMode` + the editor rail + `editorChatControls` + `onNewEditorChat` in
`ChatView`, `viewModeAction` passthrough in `ChatThreadSurfacePrimitives`, `EditorRailTabs`
and the rail-tab state in `ChatHeader`, `onOpenEditorView` plumbing in the Environment
panel/section, the `isEditorView` branch in `_chat.tsx`, and the `EDITOR_CHAT_PANE_SCOPE_ID`.
The dock diff pane's `onEditFile` now calls `openInPreferredEditor` (preferred editor from
server config, persisted) → bridge `openIde {cwd, path}`, so a dock file edit lands in the
IDE window's real editor. Deliberately kept: the dock file *preview* and its lightweight
in-pane editing (`WorkspaceFilePreview` + `useWorkspaceFileEditorBuffer`), the OMP approval
`method: "editor"` (unrelated inline-edit request kind), and `whatsNew` changelog history.

Receipt: `rg` finds no `EditorWorkspaceView` / `editorViewState` / `editorCenterMode` /
`stripEditorViewSearchParams` / `viewModeAction` / `onOpenEditorView` / `editorFilePath` /
`isEditorRail` under the web source; agent-window `tsc` + vendor `tsc` clean, `bun test
test/` 62 pass / 0 fail, `vite build` clean; `apps/macos/test` 706 pass / 1 fail, the one
failure being the pre-existing theme-handoff test recorded before this change. Still owed:
one live receipt from a packaged build showing a dock file edit landing in the IDE window's
real editor (the bridge path is implemented and typechecked, but no GUI run exercised it
this pass); it rides the next `package:mac` + `check:packaged` run.

### Cmd+K opens the search palette, theme switching included (2026-09-20)

The sidebar search button already advertised `⌘K`, but the chord did nothing: the server
sends an empty keybindings list and `DEFAULT_SHORTCUT_FALLBACKS` had no `sidebar.search`
entry. The palette itself was already complete — thread/project/action search plus theme
mode commands (`setTheme`) and the code-theme catalogue (`setCodeThemeId`) behind the
`theme`/`appearance` keywords — so the fix is one fallback binding: `sidebar.search` on
`mod+k` under `whenModChordAllowed` (fires from a focused terminal on macOS where xterm
never sees Cmd; yields `Ctrl+K` to the shell on Linux/Windows). No existing binding uses
`mod+k`.

Receipt: new `src/keybindings.search.test.ts` 3 pass (mac/Linux resolution incl. the
terminal-focus split, theme rows surfacing for `theme`/`catppuccin` queries, and the
`shift+mod+p` IDE-parity chord); agent-window `tsc` + vendor `tsc` clean, `bun test test/`
62 pass / 0 fail, `vite build` clean.

Follow-up the same day: `⇧⌘P` opens the same palette, for IDE muscle memory. The agent
window is a standalone renderer with no native command palette, so the chord is free (the
only other `shift+p` chords in the app are different keys, and `mod+p` stays the workspace
file search). It lands as a second `sidebar.search` fallback ahead of the `⌘K` entry —
label resolution reads bindings from the end, so tooltips keep showing `⌘K` while both
chords dispatch to the same palette.

### Onboarding tour goes responsive for the narrow IDE dock (2026-09-20)

The tour popup is an 800×540 frame that reads fine in the full agent window but squeezes
in the IDE dock (~650px): the welcome 3-column tiles, the tour's 220px tab column, the
`px-8` shell inset and the done step's `px-[120px]` padding. Same shared bundle in both
places (`isIdeEmbeddedRuntime` only hides the thread sidebar), so the fix is responsive
layout, not a second UI: tiles stack below `md`, the tour tablist becomes a horizontal
scroll row, insets drop to `px-5`, the done padding collapses, and the hero body centers
via child auto-margins so stacked content stays reachable when it scrolls. Wide screens
render exactly as before.

Receipt: agent-window `tsc` + vendor `tsc` clean, `vite build` clean (class-only change,
no logic touched).

### IDE dock stops swallowing file opens, gains a thread switcher (2026-09-20)

Two gaps the review against Cursor's IDE panel found, both fixed in the shared bundle (no
visual copy, same tokens). (1) Dead-end clicks: `RightDock` never mounts in the embedded
dock, yet `dockFileOpener` claimed every file open and wrote into the hidden dock store —
transcript file links, turn-diff files and palette `⌘P` file search all went nowhere
visible. New `resolveIdeFileOpenTarget` (absolute-path resolution with traversal guard,
unit-tested) routes embedded file opens straight to the native editor via the existing
`openInPreferredEditor` → bridge `openIde` path; directories keep the external fallback.
(2) No way to reach an existing thread from the dock: the header already had embedded-only
`New task` / `Agents Window` buttons, and now carries a history menu with the current
project's recent threads (same sidebar ordering, max 8) navigating through the normal
route path. The header's own `ResizeObserver` compact mode (< 700px) and the composer's
container/wrap rules already cover narrow widths, so no new disclosure system was needed.

Receipt: `lib/workspaceFileOpener.test.ts` 5 pass; agent-window `tsc` + vendor `tsc`
clean, `bun test test/` 62 pass / 0 fail, `vite build` clean. Still owed: live dock
receipts from a packaged build (file link → IDE editor, history menu switch).

### Agent-window scope cut, wave 0 — unbacked settings sections (2026-09-22)

First slice of §10 item 60 (owner scope rule §3.B: a surface renders iff OMP or the host
backs it). The Settings screen kept sections whose server RPCs this window never backs —
AppSnap, Worktrees, Skills, Usage and the external-MCP/integrations section, plus the Profile
stats half (the search index lost 80 entries; the taxonomy lost 5 section ids and the empty
integrations nav group). The remaining panels are untouched in place: Profile is now the
local identity editor only (name/handle/avatar from `profile/localIdentity.ts`, stats RPCs
untouched in the adapter), Appearance keeps one read-only "Following the IDE" row, the App
section's `setAppIcon`/`customTitleBar` rows are gone with their dead bridge methods, and
the release-history entry point no longer mounts the Synara changelog dialog. Sidebar
follow-ups in the same wave: Kanban/Pull-requests nav ids and their rows, the project
"Open in Kanban" entry and the per-project Pull-requests button are gone from the type so
persisted orders normalize them away; Automations stays as the §4 honest-unavailable row.
`nativeApi.ts` no longer imports the Synara WebSocket backend — a missing `window.nativeApi`
reads undefined and `ensureNativeApi()` throws loudly instead of opening a second data path
(the pane-level device-frame socket keeps its own factory and is untouched).

Receipt: agent-window `tsc` + vendor `tsc` clean, `vite build` clean, `bun test test/`
70 pass / 0 fail.

### Dead code sweep after v0.1.0 (2026-09-20)

Full-tree audit (importer graph over `apps`/`packages`/`scripts`, package.json script
targets, live-doc cross-pointers) found exactly two dead items, both left by the native
sessions-UI retirement: root `check:cedia-ui` pointed at `scripts/cedia-ui-check.ts`,
which no longer exists, and `scripts/synara-ui/build-css.ts` had no callers, a deleted
guard test, and inputs under gitignored `desktop/` — removed the script line and the
file. Everything else cleared: no zero-importer source files, no `caret` product
identity outside toolchain/machine/migration/frozen history, no Cursor-as-authority
language in live docs, no second harness, all package.json script targets resolve.

Receipt: `ci-validate` CI-OK; uncommitted in the worktree (2 files) pending compush.

### Agent-window scope cut, wave 1 — egress, dead routes, Synara art (2026-09-22)

Second slice of §10 item 60, on top of wave 0 above (same §3.B scope rule: a surface
renders iff OMP or the host backs it).

- **No `trysynara` egress left in code.** The feedback POST surface is deleted end to end:
  `feedback.ts`, `feedbackDialogStore.ts`, `FeedbackDialog.tsx`, the root dialog mount and
  function, the sidebar "Send feedback" item + store hook, the palette action, the `/feedback`
  slash command (definitions, both handler branches, the shared
  `packages/shared BUILT_IN_COMPOSER_SLASH_COMMANDS` literal, the composer-menu label case),
  and the dead `settings.usage` shortcut (keybinding entry, shortcuts-sheet row, sidebar
  keydown handler, palette action). What remains are outbound *links* only — help-menu Docs,
  onboarding-tour `docsHref`, profile share-card URL — carried by the §10 item 60 copy/link
  sweep together with the ~85-file Synara copy sweep.
- **Changelog/What's New cut.** `__root.tsx` lost `GlobalWhatsNewSurface` and its imports;
  the sidebar help menu no longer renders the "What's new" group, the "Full changelog" item or
  `ReleaseHistoryDialog` (menu = Customize sidebar / Keybindings / Docs); the Settings About
  row's release-history entry point was cut with wave 0. `whatsNew/*` is now unreferenced at
  runtime.
- **Safari vault + AppSnap mounts cut** from `__root.tsx` (dialog, onboarding wrapper,
  coordinator) with their imports; their component files remain for the dead-code sweep.
- **Dead routes deleted**: `_chat.kanban.*`, `_chat.pull-requests.*`, `_chat.plugins` and
  `components/kanban/KanbanView.tsx`. `routeTree.gen.ts` is regenerated by
  `@tanstack/router-plugin`, now **wired into `vite.config.ts`** (dep added to the workspace),
  so future route changes regenerate on build instead of hand-editing a generated file — the
  regeneration diff was audited to contain only these three routes (plus import ordering).
  Space-switch lands on the space home (reads `Project.spaceId` from the store) instead of a
  Kanban board; recent-views lost the `plugins` kind across logic/store/switcher;
  `routeProjectId` now resolves null (no `:projectId` route exists).
- **Automations is §4 honest-unavailable**: the sidebar descriptor renders the row
  `disabled` with a reason ("No automation backend in Cedia yet") and never navigates;
  `SidebarNavItemDescriptor`/`SidebarPrimaryAction` gained `disabled`/`disabledReason` (the
  reason is the label's `title`).
- **Synara public art gone**: `favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png`,
  `apple-touch-icon.png`, `synara.png`, `synara-logo.svg` deleted; `index.html` icons
  `cedia.svg`.
- **`deviceFrameSource.ts`**: the WebSocket fallback is deleted — factory-or-throw (both
  bootstraps install `__cediaNativeDeviceFrameSource` before the bundle boots; a missing
  factory is a loud broken-install error, never a second data path).
- **`upstream.json` matches the tree**: `apps/server` (imported by the host device service)
  and the three vendored test files are listed `included`; the false `apps/server` entry is
  gone from `excluded`.

Receipt: vendor + root `tsc` clean; agent-window `bun test test/` 70 pass / 0 fail; `vite
build` clean (route tree regenerated and audited); root suite 969 pass / 2 fail — both the
documented pre-existing pair (`menus-contract` needs the `rg` binary; the
`ide-native-workbench` theme-handoff test, recorded pre-existing since 2026-09-20);
`ci-validate` CI-OK.

Still inside item 60 after this wave: the Synara copy/link sweep (Docs/tour/share links
above), the now-unreferenced component files (`whatsNew/*`, `AppSnap*`, vault/Safari
components, `components/kanban` remainder) for the dead-code sweep, wave-0's unused-import
residue in `_chat.settings.tsx` (noUnusedLocals is off), and the **Studio/Spaces cut —
assessed at 23+ files**, woven into project creation, chat-send workspace
(`prepareChatSendWorkspace`), and the route `space` search param (`useRouteSpaceSync`), so it
is its own wave sequenced after item 59 rather than folded here. The item 60 close condition
still owed: the fresh-profile walk through every sidebar row and settings section showing no
dead state.

### Composer attachments, mentions, skills and compaction are real (2026-09-22)

Closes §10 items 61 and 62 (one slice — both edit `cedia-adapter.ts`).

**61 — attachments/mentions reach OMP on the bundle path.** The two hard-throws in
`thread.turn.start` are gone; the turn now folds composer input the way the native path
proved it (§10 item 34): image bytes travel in OMP's own `images[]` on
`prompt`/`steer`/`follow_up`, and every other reference becomes a labelled
`Attached context` block — file names, mention paths as *path references* (OMP's agent
reads the files itself, matching the native "path references only" precedent in
`mention-context.ts`), and assistant-selection text. Bytes are read where they live: the
live draft's `File`, a queued turn's `File`, or the persisted IndexedDB blob
(AppSnap/reload-hydration window); a missing blob **fails the turn loudly** instead of
dropping the image silently. Companion fix in `composerSend.ts`:
`stageUploadComposerAttachments` no longer POSTs bytes to the nonexistent Synara
attachment server when `window.nativeApi` is installed — it stages the composer's local
ids (the old path could never succeed in Cedia, so every attachment send died at staging
before dispatch, and shipping bytes to a third-party route would have violated the scope
rule anyway).

**62 — skills/slash and compaction forward the pinned RPC.** `listCommands`/`listSkills`
both read OMP's `get_available_commands` and split rows by `source` (skill rows → skills
with `enabled: true`; everything else → commands), `getComposerCapabilities` flips
`supportsSkillDiscovery` / `supportsNativeSlashCommandDiscovery` / `supportsThreadCompaction`,
and `compactThread` sends OMP's `compact` against a started session with real failure
statuses surfaced. Discovery is honest about context: no `threadId`, or no host session,
means an empty list and **no RPC fired**. Two recorded deviations: `set_auto_compaction`
has no UI surface in the bundle, so it is not wired (the plan's wording listed it beside
`compact`); the sessionless `listSkillsCatalog` stays empty (no session to ask).

Receipt: root + vendor `tsc` clean; agent-window `bun test test/` **76 pass / 0 fail** —
6 new adapter cases (image bytes land as `images[]` base64, file/mention labels, missing
bytes refused, capability bits, source split, no-session emptiness + compact send and
missing-session failure) plus 2 staging-bypass cases in the new
`test/attachment-staging.test.ts`; `vite build` clean; root suite 969 pass / 2 fail —
both the documented pre-existing pair (`menus-contract` needs `rg`; the
`ide-native-workbench` theme-handoff test); `ci-validate` CI-OK. Still owed per plan: the
**packaged-run receipts** — one image pasted in the agent composer arriving in the OMP
turn, `/` completing a real skill, and a compaction run from the UI.

### One window-chrome policy and the bundle status bar (2026-09-22)

Closes §10 item 55 (half in the desktop checkout, half in the bundle).

**Desktop half — the base already shares the policy, so the work was proving it.**
Both windows are one `CodeWindow` class (`windowImpl.ts:784` the only
`new BrowserWindow`); title-bar policy is the shared `defaultBrowserWindowOptions`
in `windows.ts:210-215` (`titleBarStyle: hidden` whenever the setting is not native —
no per-window branch); zoom defaults are shared (`zoomLevelToZoomFactor` on the same
window settings); menus are the global `Menubar` service (`menubar.ts`) fed by each
focused renderer — the sessions renderer registers the base's own sessions menu set
(`sessions/browser/parts/menubar.contribution.ts`: File/Edit/Selection/View/Go/Terminal/Help/Preferences)
through `NativeMenubarControl`, so patch `0002`'s retirement stays correct and **no
per-window menu-hiding patch remains alive**. Patch surgery per §6.1: the live
checkout's three chrome patches were diffed hunk-by-hunk against `0056`/`0057`/`0058`
and each live hunk maps 1:1 (0056 bridge + URL fork + single-window reuse; 0057
navigation owner; 0058 zoom handlers + traffic-light geometry) — no orphan drift, no
re-cut needed. `desktop-patch-set.test.ts` passes against the live tree (byte-identical
mirror), so "shared zoom behaviour and menu source by construction" is already true
and stays pinned.

**Bundle half — the status bar is new.** `components/cediaStatusBar.tsx` (Cedia-owned,
recorded in `upstream.json` adaptations) reads the focused thread through the vendor
store selectors and paints host · model · session · branch on the shared
`statusBar.*` tokens — model via `resolveThreadModelSummary` (same label the sidebar
hover card shows), session from the adapter's `sessionStatus` projection
(error/connecting honest), branch from the thread, host `live` (the bridge is
installed or the route tree would not render). `_chat.tsx` mounts it at the foot of
the content column under every route; hidden in the IDE dock (the IDE owns its own
bar) and null without a thread. Deviation recorded: no new main-process chrome
module was created — the policy the item asked to extract is already one shared
code path in the base, so a Cedia module would have been a second owner of the
same decision.

Receipt: root + vendor `tsc` clean; agent-window `bun test test/` **82 pass / 0 fail**
(6 new status-bar value cases in `test/cedia-status-bar.test.ts` incl. the
`statusBar.*` token contract); `vite build` clean; `desktop-patch-set.test.ts` green;
root suite 969 pass / 2 fail — both the documented pre-existing pair; `ci-validate`
CI-OK. Still owed per plan: the **measured-on-screen receipt** — the agent status
bar photographed with live values in a packaged run (rides the next `package:mac`
with items 54/60/61/62).

## 10. Open work (the only authoritative list of what is not done)

Anything not listed here is either done (§9) or out of scope (§5). Each item states what closes it.

> Superseded-reading rule (2026-09-20): this list was written against the native sessions
> workbench UI. Items whose close condition names a mechanism that no longer renders —
> the workbench draft/option store (`_draftOptionStore`, draft picks), the native composer
> and model picker, the Apps-panel strip, nav/session rows, chrome inventory against
> reference captures — cannot close as written now that the Agents window runs the
> standalone bundle (`0056`). They stay listed so their product gaps are not lost, but the
> next session must restate each touched item against the bundle (adapter → host API)
> before working it, not execute the native steps. Items about OMP, host, relay, iOS and
> the IDE workbench read unchanged.

**S2 — provider completeness**

1b. **Rewind to *any* user message, not just the tail** (§9, 2026-09-20, landed the tail case).
    OMP's `branch { entryId }` already does the work; what is missing is a way to choose the message.
    Synara renders a per-message `Revert to this message` control, but it is gated on checkpoint turn
    counts from turn diffs (`getTurnDiff` is unsupported here, the projection reports `checkpoints:
    []`) and it dispatches `thread.checkpoint.revert`, so pointing it at the rewind needs a small,
    recorded adaptation of the vendored app: give it the message -> entry id map the adapter already
    reads, and dispatch a branch that does not resubmit. The open UX question is the composer: OMP's
    TUI puts the rewound text back in the editor, while Synara's draft is renderer state, so either
    the command result carries the text to a renderer path or the rewind leaves the composer empty.
    Closes with one receipt: rewind to a message in the middle of a task, on screen.
1c. **Restoring the workspace files with the rewind is outside OMP.** Cursor's rewind also reverts
    the code the agent changed; OMP offers no per-turn file state (its `checkpoint`/`rewind` tools are
    context compaction, and `/branch` keeps the old path as a branch rather than undoing files), and
    the layer that had it upstream is not vendored. Closes only by building a per-turn file snapshot
    of Cedia's own and projecting turn diffs; until then the window must not imply files come back.
1d. **A thread the window treats as temporary is deleted, not archived, when it is disposed.**
    Synara's `useTemporaryThreadLifecycle` dispatches `thread.delete` for a disposed temporary thread
    that has a server session, and Cedia's host removes the record and its transcript. Observed
    2026-09-20: a `New task` thread present in the host store earlier the same day is gone, with the
    remaining rows archived at the moment the window was reopened. Either Cedia's projection must
    never mark a thread temporary, or the adapter must refuse `thread.delete` for a thread the user
    can still open. Closes with a receipt showing a temporary draft's session surviving a window
    restart, and a decision recorded for the case where the user really did want it gone.

1. Tool calls, permissions, approvals, attachments, images, abort/steer and multi-turn have none
   of them been exercised on the Agents-window path. Close by running a turn that produces a tool
   call and a permission prompt from the on-screen composer, with a receipt.
1a. ~~**The Agents window's `New Chat` does nothing, and it is the reason the empty draft is
    unreachable**~~ **Closed 2026-09-18.** The nav row resolves because the provider now answers
    `resolveWorkspace` for any folder it is handed (patch `0010`, 2026-09-17), and the draft it hands
    back now behaves as an uncreated session should: the first Send creates the host session and the
    composer becomes its transcript. See §9's two entries (2026-09-17, 2026-09-18) and
    [`evidence/d1-draft-send-in-place-2026-09-18/`](evidence/d1-draft-send-in-place-2026-09-18/).
    What that work leaves open is listed on the D1 row below rather than here.
2. The provider-level catalogue fetch at start can lose a race with a host refresh
   (`Cedia could not list OMP models: Refresh the task before submitting this command`), leaving
   the option-group picker empty at boot. The language-model provider resolving later masked it, but
   a retry was needed. **Closed 2026-09-18** (§9, "The model picker survives a boot race and names a
   stale pick"): a refused catalogue send re-reads the session once and retries with the live
   incarnation, bounded to two sends. The race is timing-dependent, so closure rests on the fixture
   evidence rather than a reproduced boot.
3. ~~A session with **0 events** still shows the base's welcome (`Build with Agent` /
   `Generate Agent Instructions`) instead of Cedia's chat view.~~ **Half closed 2026-09-17**: the
   chat widget reads `welcomeTitle` / `welcomeMessage` from the session *type's* contribution
   (`chatWidget.ts:1680`, `chatSessionsService.getChatSessionContribution`) and falls back to the
   base's copy when the provider supplies none, so Cedia's `chatSessions` entry now carries its own
   (`Cedia` / "Cedia runs your task with **OMP** on this Mac…"). The contribution ships in the
   packaged app, checked by reading `extensions/cedia/package.json` inside the bundle, and a test
   pins the copy. **Not done:** the reference's empty state is interactive starter cards, which this
   welcome surface does not render (the `welcomeTips` field exists in the extension point and in the
   service interface but no code in this fork reads it, so Cedia deliberately ships nothing into it);
   those starters are the Agent Home's own surface (patch `0023`) and belong to wherever the empty
   draft lands (D1). On-screen rendering was not exercised because this window has no 0-event session
   to show - creating one is D1.
4. The composer in draft state (no session) is `0×0` and disabled. Showing a model before there is
   work needs a read path not tied to a session, e.g. a host-owned route.
5. Choosing a model in the picker and verifying that `set_model` actually writes has not been done.
   (Distinct from model *roles*, which were added and seen on screen on 2026-09-16 — see §9.) **Half
   closed 2026-09-18:** a *draft's* pick now reaches the host through
   `newChatSessionItemHandler` -> `applyDraftModelChoice` (unit-tested, and seen live reporting
   honestly for a stale pick), and that is the pick that matters for a session's first turn. What is
   still unverified is the live write for an *existing* session, plus the picker's handling of a
   remembered model OMP no longer advertises. Receipt:
   [`evidence/d1-draft-send-in-place-2026-09-18/`](evidence/d1-draft-send-in-place-2026-09-18/).
5a. **D1's remaining pieces, now that the draft's Send works.** (a) the draft has no workspace
   picker: the provider advertises `supportsLocalWorkspaces = false` and the extension's
   `newChatSessionItemHandler` still creates in the first non-archived project rather than the folder
   the user chose; (b) in the draft state the Apps panel offers only `Changes` where the reference
   offers `Changes`/`Browser`/`Terminal`/`File`;    (c) the reference's starter cards on an empty draft;
   (d) **done 2026-09-18** (§9, "The model picker survives a boot race and names a stale pick"): a
   remembered pick the catalogue no longer advertises is resolved against the live catalogue, named
   in the option group's description, and the host's current model is shown instead; (a)-(c) remain.
   Receipt:
   [`evidence/d1-draft-send-in-place-2026-09-18/`](evidence/d1-draft-send-in-place-2026-09-18/).
5b. **Headless CLI parity with OMP (landed 2026-09-21, unit-verified).** `cedia-host`
   now drives sessions, turns (`send`/`steer`/`follow-up`/`abort`), approvals, events,
   review, files, projects, models and providers from the terminal with JSON output, and the
   generic `rpc` verb forwards all 42 canonical RPC command types through the host's existing
   command bridge (`apps/host/src/cli-client.ts`, `apps/host/test/cli-client.test.ts` 12 pass;
   host suite 129 pass). Still owed: one live run against a running host with a real OMP turn
   (incarnation addressing, `--wait` settlement and chunked-response dereference on the wire),
   plus IDE palette wiring for the daily verbs. The OMP-side slash commands that are TUI-only
   (e.g. `marketplace`, `ssh`, `stats` display) stay reachable only through `rpc` where OMP
   exposes them as RPC; anything OMP keeps TUI-local is out of scope until it does.

**Model roles (opened 2026-09-16, see §9)**

6. `cedia.models.configureRoles` assigns roles, but it has not been driven from the running window
   (EditContext inputs defeat synthetic keys; Screen Recording is not granted). Close by invoking it
   with real input and capturing the result. An **inline** role chip needs a desktop patch to render
   a second option group, which the base does not do today.
7. `cycleOrder` is read but not enforced by any Cedia control, and path-scoped `enabledModels` was
   never exercised.
8. `task.agentModelOverrides` (per-subagent routing) and the `advisor` runtime are untouched
   surfaces.
9. The role tooltip wording (`Roles: Fast`) was not visually verified; only the row detail was.

**S3 — remove the webview shell**

10. What is left is exactly the dock: `webview.ts` (2,836 lines), `TASK_WEBVIEW_CSS`, the
    `cediaComposerDock` view, its restricted-mode renderer and the ~8 shell-bound tests. They can
    only be deleted once an IDE-side replacement for the dock's capability exists
    (`cedia.focusDock`, `focusAgentSurface()` and the `prefill` handoffs from IDE actions). Until
    then `rg "webview.ts|TASK_WEBVIEW_CSS"` is not 0 and S3's exit gate is open. **Corrected
    2026-09-22:** the replacement already exists — the dock is `agent-ide-webview.ts` loading
    `agent-ui/ide.html`, and `CediaTaskViewProvider` is never passed to
    `registerWebviewViewProvider` — so the gate is deletable now; execution is item 63. **Closed
    2026-09-17, out of this item:** the `caretComposer` view and its `caretAgents` container, the
    `caret.agentsShell` editor, the fallback panel, the duplicate `caret.openTask` command and the
    fork's `caret.openAgentsWindow`/`caret.openIde` island are gone — those were the *second*
    agent surface for one window, not the dock. The same pass deleted the unreachable
    new-window path they belonged to (`openCaretAgentsWindow`, `writeCaretAgentsWorkspace`,
    `serializeCaretAgentsWorkspace`): nothing called it, and `cedia.showAgents` already opens the
    window through the base's own command. `CEDIA_AGENTS_WORKSPACE` recognises `cedia-agents.code-workspace` (kept since a build before
    2026-09-17 could have left that file on disk); a pre-rename `caret-agents.code-workspace`
    left on disk is orphaned — no shipped build reads it.

**S4 — remaining parity**

11. The composer still lacks the `High` reasoning popup and the `Plan New Idea`/`Multitask` chips.
    **The reasoning half is landed and unit-verified 2026-09-18** (extension-side, no shell patch):
    the chip is the second session option group, `reasoning`, built by
    `thinkingPickerGroupFromParams` from OMP's own `get_state` answer for the session's *current*
    model (`fetchOmpThinking` -> `thinkingFromOmpState`), so it follows a model change instead of
    offering one model's ladder to another, and it publishes nothing at all when OMP advertises
    none — the same rule `thinking-params.ts` already keeps for the dock, which forbids inventing
    Fast/High. Picking one is applied through `set_thinking_level` only after re-checking that OMP
    still advertises that level for that model. `bun run test` 885 pass / 0 fail, typecheck clean,
    `bun run check:packaged` green. **Not yet verified live**: on the window measured right after
    packaging no Reasoning control appeared, which is the honest-disabled path because that
    session's model advertised no levels; the positive path needs a model whose `get_state`
    advertises a ladder, and the `High` wording stays Cursor's until the levels OMP reports are
    compared with it.
   The effort chip needs a provider config action (the same S2 gap as the model picker). **The two
   mode chips are now measured, not guessed** (2026-09-17, from the reference's own AX tree and its
   bundled composer): the reference has a real mode system, not decorative chips —
   `Plan New Idea ⇧Tab` and `Multitask` are calls to action attached to a mode state
   (`composerMode.multitask`, `cycleMode`, `changeToAsk`/`changeToDebug`/`changeToMultitask`), and
   each mode carries its own placeholder and description (`Coordinate tasks` /
   `Orchestrate multiple subagents in parallel` for Multitask, `Ask questions` /
   `Answer questions without making edits` for Ask; the window's own placeholder reads
   `Plan, Build, / for skills, @ for context`, Cedia already copies). Closes with a composer
   mode in Cedia whose Plan path maps to a real OMP behaviour (a plan-first turn over `ompPlan`) and
   whose Multitask path maps to parallel subagents (§10 item 8); until both exist the chips stay
   unrendered, because a chip that changes nothing is the fake button §5 forbids.
12. The reference's chip draws a chevron; Cedia uses an icon and no chevron.
13. What the reference puts under the `Changes` entry is unknown (AX only gives the entry name), and
   our Changes pane is a changes view rather than a multi-diff, and the File pane is an empty state
   + Search Files rather than a tree. A real session with changes has never been used to verify
   either.
14. The reference has no Show Panel / Toggle Side Panel buttons in this window; ours do because they
    share layout actions with the IDE. **Decided 2026-09-17: keep the current panel** — the user
    chose not to remove the toggle or add the reference's `Hide Apps` / `Enter Full Screen` to the
    panel header. Recorded as a deviation in §5 rather than left open; it becomes live again only if
    the panel is rebuilt (§7's React pass).
15. `--cedia-*` is not injected at the workbench level (the extension cannot write CSS into the
    workbench DOM), so the token layer currently relies on CSS fallbacks that a test pins.
16. **AX/DOM comparison: run for the first time 2026-09-17, still not a verdict.** It is the real
    decider for "identical" (§11 gate 2). The tool is `scripts/agents-chrome-inventory.ts`
    (`reference` / `compare <file>` / `capture <debugPort> [--empty-draft] [--write <file>]`), and it
    has now been run against a live window: reference 45 controls, Caret 30, shared 12 — the dumps
    and the classification are in
    [`evidence/dead-code-followup-decisions-2026-09-17/first-live-capture.md`](evidence/dead-code-followup-decisions-2026-09-17/first-live-capture.md).
    Of the 33 reference controls Caret lacks, 26 are empty-draft *state* (the reference capture is an
    empty draft, Caret's window sat on a chat, and `New Chat` in the sidebar did not move it), 3 are
    recorded deviations (`Enter Full Screen`, `Hide Apps` per item 14; the `Account menu` per patch
    `0029`), and 4 are real differences worth a decision: `Hide Sidebar` is `Toggle Side Bar` in
    Caret, `Go Back`/`Go Forward` are `Go Back One Session`/`Go Forward One Session`, and Caret's
    splitters and tab group carry no accessible name where Cursor's are `Resize panel`/`Resize
    sidebar`/`Tabs`. Closes with: the same state on both sides (start from why the sidebar's
    `New Chat` does not reach an empty draft in that window), one normalisation pass over the two
    capture vocabularies (the AX capture merges a row's text children into its parent button), and a
    re-capture from the next packaged build.
    **Normalised the same day** (hidden elements excluded, shortcut tails stripped, recorded
    deviations and renamed pairs split out of the failure list — a test pins the substring-match
    false positive that forced the stricter rule): the report now reads shared 11, renamed 3, absent
    by decision 3, missing 28. Of the 28, 24 are the empty-draft state and 4 are real — the two
    wording differences, the unnamed splitters and tab group, and one reference duplicate. Why the
    state is unreachable in that window was probed too: `New Chat` is Cedia's own Agent Home nav row
    and the window had adopted a read-only session from the host, so nothing in that state offers a
    fresh draft.
    **Closed except for the state, verified in rebuilt apps** (same day): patch `0035` gives the
    sessions navigation the reference's own words, and patches `0036`+`0037` name the two splitters
    (`shared 15, renamed 1, absent by decision 4, missing 25`). Of what is left, 24 entries are the
    empty-draft *state* (D1 - the reference capture is an empty draft and Caret's window adopts a
    session instead) and one is the capture artifact the AX tree creates by merging a row's text
    (`Projects New Project` against Cedia's `New Project`). The last reference-only entry, the
    `Tabs` tab group, is now a recorded deviation in §5, not a miss: Cedia draws its own launcher
    strip and hides the native group. Closes when both windows can be captured in the same state,
    which is D1's work.

**Chrome decisions (closed 2026-09-16, see §9)**

18-21. All four Copilot-flavoured controls are decided and hidden in the Agents window —
    `Configure Tools…`, the Permission picker, `Configure Custom Agents…` and the empty `Chats`
    group. Receipt: `evidence/agents-chrome-decisions-2026-09-16/`. **Still open from that work**:
    the mode menu's `Ask / Edit / Agent` modes are unverified as to whether they change anything OMP
    does (the real mode work is the reference's `Plan`/`Build` chips, item 11 above), and the IDE
    window's copies of these controls were not exercised on screen because its chat is disabled by
    default in this fork.

**Agent Host (Cedia does not run it)**

22. ~~`0032` stops the window from starting the base Agent Host, but the client and the
    `IAgentHostService` singleton registration are untouched.~~ **Closed 2026-09-17** by the first of
    its two options: the desktop DI shim now returns the base's `NullAgentHostService` for the local
    branch, so a surface that asks gets one sentence
    (`Cedia ships no agent host: OMP is the only harness this build runs.`) instead of a utility
    process that dies on boot. The remote branch is untouched. The 25 injection sites that made
    "remove the Copilot services the node graph still requires" the expensive option stay as they
    are; nothing enables agent-host features in this build, so none of them resolves the client
    eagerly. `0032` carries both halves.

**S5 — mobile**

23. Not started. The iPhone is a projection of the same session (relay/approval/replay) and needs a
    receipt from a real iPhone on cellular.
    **The dev-loop route was evaluated 2026-09-18** ([`evidence/ios-vm-evaluation-2026-09-18/`](evidence/ios-vm-evaluation-2026-09-18/)):
    a virtual iPhone (`Lakr233/vphone-cli`, MIT, Apple Virtualization.framework plus Apple's PCC
    research VM) can run real iOS userland with a jailbreak, take a build through its `.ipa` Install
    menu, and be driven from the host through SSH, VNC and a control socket that returns screenshots
    per action — enough to carry the *engineering* half of this item and of items 27, 30, 39 and 41.
    It has no cellular radio, so it cannot produce the receipt this item states, and it needs a
    Recovery-mode SIP/AMFI change on the host that only the machine's owner can make. Either the
    clause stays and a physical iPhone still closes it, or it is relaxed to "real iOS on a virtual
    device" and recorded as a §5 deviation with that reason. **Decided 2026-09-18: option 1.** The
    clause stays, the virtual iPhone is the development and E2E loop only, and a physical iPhone
    still closes this item. Host readiness was measured the same day (evidence above): macOS 26.6.2
    on an M3 with Homebrew and a non-nested host pass, while three things gate the setup — Xcode with
    the iOS SDK (only Command Line Tools is installed), the Recovery-mode SIP/AMFI relaxation, and
    disk headroom (38 GB free against multi-GB IPSWs plus a VM bundle). The first two are the
    machine owner's to do; everything after them can be driven from here.

**Sessions**

24. ~~Delete is Agents-window-only: the shell (the IDE window's Cedia composer) session menu still
    offers Archive and no Delete, although the host route now exists.~~ **Closed 2026-09-17**: the
    dock's session row menu offers a `Delete` item that posts `delete_session`, the extension
    confirms first (`Delete "<title>"? This action cannot be undone.`) and then runs the same
    `deleteChatSessions` path the Agents window's list uses, so both surfaces delete through one
    route. The webview parser, the message type and the extension case are pinned by
    `ide-native-workbench.test.ts` ("offers the same Delete in the dock's session menu").

**Repository hygiene**

25. The brand/icon work in the working tree (`assets/brand/**`, iOS icons, `scripts/lib/app-icon.ts`,
    `scripts/build-cedia.ts`) is uncommitted and must be committed as one set, otherwise HEAD and
    the tree disagree.
26. Copilot-named helper files that are not the harness remain as naming debt. **Checked 2026-09-17:
    they are not dead code.** `copilotManagedSettings` is referenced by 35 files, `copilotCliEventsUri`
    by 18, `copilotCliConfig` by 12, and only two files have no importer at all
    (`src/typings/copilot-api.d.ts`, a type-only declaration, and
    `src/vs/sessions/copilot-customizations-spec.md`, a spec). Decided: keep them, because renaming
    referenced upstream files is rebase churn that buys nothing, and the files that die with the
    Agent Host (item 22) leave with it. Re-count before any rename pass.

**Terminal (Ghostty VT)**

The evaluation and the corpus are landed (§9 item 16). These two items are what the numbers
opened; each states what closes it.

27. **Serialized terminal state on the host/mobile path.** *(Both halves landed 2026-09-16 — §9,
    "The host keeps a terminal checkpoint" and its client half in `evidence/mobile-terminal-checkpoint-2026-09-16/`:
    the host keeps the screen, serves `GET /v1/sessions/:id/terminals`, and the phone seeds its
    renderer from it instead of asking OMP for a redraw.)* **Cell styles landed 2026-09-18** (§9,
    "Terminal checkpoints carry cell styles", receipt
    [`evidence/terminal-checkpoint-styles-2026-09-18/`](evidence/terminal-checkpoint-styles-2026-09-18/)):
    the checkpoint carries styled runs and the seed paints true-colour SGR, verified live against
    the real native addon and a real xterm.js terminal. What is left: a receipt from a real iPhone
    over the relay (the closure the item always stated) and a component test for the mount wiring
    (no component renderer dependency in the iOS project; the coordinator/seed logic is tested).
    Keep OMP as the PTY owner: the host keeps state, it does not start a second shell.
**OMP runtime line**

29. **Closed 2026-09-16** (§9, "Cedia follows the OMP line"): the baseline is a floor, not a pin,
    so a runtime newer than `18.1.18` runs and a newer-than-baseline release is judged by its
    `ready` frame and the three contract suites rather than by its number. The surviving work is
    different and smaller: `patches/omp/` still applies to the 18.1 source, so a *shipped*
    runtime update — building and contract-testing a newer patched OMP and refreshing
    `docs/UPSTREAM-LOCK.md` — is what a Cedia release must do when it adopts a newer OMP, and a
    stock newer runtime keeps the Cedia bridge surfaces off until then.
30. **Renderer decision for the terminal Cedia owns.** **Split decided 2026-09-17.**
    The workbench half is closed: the IDE window keeps xterm.js, recorded as a deviation in §5,
    because replacing it drags the xterm-specific addons (image, ligatures, search, serialize, the
    terminal API) out with it for no user-visible gain while Cursor parity is the goal. What is still
    open is the half Cedia renders itself, the iOS WebView terminal
    (`apps/ios/src/components/VirtualTerminal.tsx`, xterm.js 6.0.0 bundled into the document):
    it closes with a candidate engine passing every required case in the corpus
    (`apps/macos/src/terminal-conformance.ts`, report attached) and the mobile terminal switched with
    a real-device receipt.

**Model catalogue (opened 2026-09-16)**

31. ~~`opencode-go/union-alpha` is a dead row in the picker.~~ **Decided 2026-09-17: leave the row,
    take no action in Cedia.** The facts are unchanged (OMP routes the gateway-first id to chat
    completions, which Zen answers 500, and its `/messages` lane did not answer within 100 s, while
    the same model on `opencode-zen` was put on the working route by operator config — §9, "Zen's
    free stealth model in OMP"), and any gateway model published after the pin lands the same way.
    Hiding the row would be Cedia inventing catalog policy, which the plan forbids in `patches/omp`;
    the working twin is already reachable. Act only on a deliberate OMP pin bump whose upstream
    catalog carries the pin.

**Cursor/Codex-parity sweep (opened 2026-09-18, after a read-only recheck of Cursor 3.20.21 on this Mac)**

A fresh audit of the native Agents-window path, the OMP command surface and the build chain produced
these items. The recheck against §3-§8 found no contradiction with what is already written, and it
deliberately leaves these owners alone: item 16 owns the chrome inventory (its state half was D1, now
landed), item 11 owns the composer's `High`/`Plan New Idea`/`Multitask` chips, items 14 + §5 own the
panel controls and the `Run in Cloud`/`Automations` honest-unavailable states, items 6-9 own model
roles and subagent routing, and items 27/30 + §5 own the terminal (no item below touches that work).
Codex-class behaviour (plan/goal/subagent/approval schema/MCP catalogue) is §4's OMP-own surface, so
those items close against OMP's advertised contract, not against a Cursor measurement.

32. **The native path can hang on approvals.** The Agents-window provider never rendered `cedia_ui`
    (approval/question/presentation) frames and had no answer path, so an approval raised mid-turn
    was only answerable from the dock and the broker otherwise timed it out (pre-fix
    `apps/macos/src/chat-sessions.ts:655-762`; broker `apps/host/src/service.ts:477-508`).
    **Implemented and unit-verified 2026-09-18** (§9, "Native approvals are answered in the Agents
    window"): pending interactive requests are presented as the native blocking carousel and
    answered through `sendUiResponse`; `password`/`schemaform` are reported instead of collected.
    What remains for closure is the runtime receipt — one real tool-permission turn from the
    on-screen composer in a packaged build.
33. **Live streaming loses in-place updates.** `runTurn` emitted only rows appended by a page
    (pre-fix `chat-sessions.ts:704-710`) while the reducer updates existing message/tool rows in
    place (`state.ts:531-562,565-611`), so text that arrives as an update to a row already emitted
    never reached the live view. **Implemented and unit-verified 2026-09-18** (§9, "Live streaming
    carries in-place updates"): changed rows are emitted as deltas and two fixture tests pin it.
    What remains for closure is the runtime half — one live turn in a packaged build showing text
    arriving after the row's first paint (that session had no computer-use runtime).
34. **Attachments die at the extension→OMP boundary.** The bridge forwards `attachedContext`, but
    the provider's handlers passed `request.prompt` only and the map built `{ message: prompt }`
    (pre-fix `chat-sessions.ts:382,603`; `chat-sessions-map.ts:186-187`), so images/context were
    silently dropped. **Implemented and unit-verified 2026-09-18** (§9, "Composer attachments reach
    OMP"): images become OMP's `images` on the `prompt` command and non-image references append a
    labelled `Attached context:` block; `streamingBehavior` remains item 11's work. What remains for
    closure is the runtime receipt — paste an image in a packaged build and see the turn carry it.
    Item 5a(a) covers the draft's *workspace* choice, a different value.
35. **Native tool work is opaque.** `emitEntry` rendered a tool name as progress and replay showed
    names only, so args, results, diffs and thinking had no native rendering (pre-fix
    `chat-sessions.ts:635-639,754-762`). **Implemented and unit-verified 2026-09-18 for args and
    results** (§9, "Tool calls render as real cards in the native chat"): live turns push a
    partial-update `ChatToolInvocationPart` with collapsible input/output and history replays a
    completed card. What remains open: edit diffs (`ChatResponseMultiDiffPart` needs a tool-to-URI
    mapping), thinking (the reducer drops thinking blocks on purpose) and subagent transcripts
    (items 8/11); the runtime receipt is one real turn in a packaged build whose tool output is
    visible on screen.
36. **Settings/discovery stay shallow.** MCP/skills/hooks row builders existed but no collection was
    passed, and most OMP controls were a generic JSON picker
    (`apps/macos/src/settings-catalog-rows.ts:69-142`, `extension.ts:2691-2696`). This is §4's
    "catalog exactly as OMP advertises", not Cursor parity. **Half closed 2026-09-18** (§9, "OMP's
    skills reach the dock's catalog rows"): skills are derived from OMP's own `source: "skill"`
    slash commands and the JSON picker omits commands with dedicated UI. What remains: MCP servers
    and hooks have no OMP RPC surface at all (item 43), and the Agents window's Customize surface is
    not fed (`chatSessionCustomizationProvider`).
37. **OMP surfaces still unreachable from any UI**: the browser bridge is supplied as `false`
    (`extension.ts:1377,2474`) and `set_host_uri_schemes` installs no host implementation
    (`packages/omp-adapter/src/host.ts:69-110`; `service.ts:179-197`). **Presentations closed
    2026-09-18** (§9, "OMP presentations render in the dock and the native chat"): the dock renders
    all six methods with their fields, and the native transcript surfaces `notify` and `open_url`.
    The remaining two stay open with their reasons: (a) the browser bridge needs a live
    browser-handle consumer, and Cedia's browser lives in the renderer (the Apps panel), so wiring
    it means a desktop patch plus CDP plumbing to the host — a feature, not a flag; (b) URI schemes
    need a concrete consumer before registering one, because a scheme with no reader would be the
    fake capability §5 forbids. Each closes with its runtime consumer and a live receipt.
38. **No task-level checkpoint/rollback.** Editor edits keep per-buffer undo and Keep/Take Back, but
    there is no task-wide Bring Back; the terminal checkpoint is screen state, not a file snapshot
    (`packages/protocol/src/index.ts:53-75`; items 27/30 stay as they are). Closes with a
    file-snapshot contract the host owns plus a receipt.
39. **Host lifecycle hardening.** A session became command-addressable before host init finished, and
    lifecycle fencing, recovery semantics and mobile reconnect are not production-ready
    (`apps/host/src/service.ts:100-131`). **Host half closed 2026-09-18** (§9, "Host startup no
    longer lies and no longer blocks"): the startup status lie, the durable `not_dispatched` for
    commands sent during a start, and the event-loop-blocking version probe are fixed and pinned.
    **Mobile half implemented and unit-verified 2026-09-18** (§9, "The phone recovers from a
    rotated incarnation"): the host's 409 code/message survives into a typed `HostError`,
    `catchUp` refreshes the session record without resetting the mounted task, and a refused command
    refreshes and retries once. What remains for closure is the receipt the item always asked for:
    a real iPhone over the relay reconnecting after a host restart or another device's start
    (feeds item 23).
40. **Packaging can ship a stale desktop shell.** The stamp recorded the upstream revision, not the
    Cedia patch-set digest (`scripts/build-cedia.ts:60-72,132-150`), so a rebuild could silently keep
    an older shell. **Implemented and unit-verified 2026-09-18** (§9, "The packaged shell carries a
    Caret stamp"): every `--package` writes a `cedia` stamp (patch-set digest + shell/extension
    hashes), refuses to package a shell older than the newest patch, and `bun run check:packaged`
    audits an existing app. What remains for closure is the real receipt: one repackaged app whose
    `check:packaged` run is green.
    Found 2026-09-18 while answering why an old build kept appearing: the `--desktop` flow produces
    an incomplete dev Electron shell at `desktop/.build/electron/Cedia.app` that carries the *same*
    bundle id (`com.cedia.editor`) and name as the packaged app, so LaunchServices can resolve
    "Cedia" to the shell (no app payload, none of the Cedia surfaces) instead of the packaged
    bundle. The shell was unregistered and removed locally, leaving one registered bundle; the
    durable fix is a distinct dev bundle identity or excluding the shell from registration.
    **Closed 2026-09-18.** One rebuilt and repackaged app has a green `bun run check:packaged`
    (patch-set `f0185d43e73f`, 35 patches, both shell hashes and the extension hash matching the
    stamp), and the two-Caret problem is fixed for good by making a desktop build leave one Cedia.
    The dev Electron shell `gulp electron` extracts has no app payload and none of the Caret
    surfaces, and it can share the packaged app's identifier because both build from the same
    `build/lib/electron.ts` config, so it cannot be told apart by id alone (renaming it still left
    two things called "Cedia"). `scripts/lib/app-icon.ts#removeDevBundle` now unregisters and
    deletes it from the `--desktop` block, guarded by the `desktop/.build` path and the absence of
    the real `sessions.desktop.main.js` payload; the dev shell exists only while `code.sh` runs.
    Receipt: [`evidence/packaged-shell-stamp-2026-09-18/`](evidence/packaged-shell-stamp-2026-09-18/).
41. **iOS typecheck is red** (`apps/ios/App.tsx:444,1259,1886,1889`), so S5's mobile work cannot
    claim a clean build. **Half closed 2026-09-18** (§9, "iOS typecheck is green"): `apps/ios`
    typecheck and its 146 tests are green. What remains is the device receipt item 23 needs.
42. **Re-baseline §3 to the installed Cursor.** The local app is now 3.20.21 while §3's contract says
    3.20.17; and now that D1 makes the empty draft reachable, the chrome inventory (item 16) needs
    one same-state re-capture from a packaged build to close its last clause. Closes with the
    re-measured contract diff and the normalised chrome report.
43. **MCP servers and hooks have no OMP RPC surface, and the Agents window's Customize counts are
    not fed.** Research 2026-09-18: no OMP command or event carries MCP server status or the hook
    list (`upstream/omp/packages/coding-agent/src/modes/rpc/rpc-types.ts:28-120`), so §4's
    "MCP/skills/hooks catalog exactly as OMP advertises it" cannot render them; and
    `registerChatSessionCustomizationProvider` (proposal `chatSessionCustomizationProvider`,
    `vscode.proposed.chatSessionCustomizationProvider.d.ts:217-229`) has no Caret provider, so the
    Customize toolbar counts (`desktop/src/vs/sessions/contrib/sessions/browser/customizationsToolbar.contribution.ts:86-119`)
    stay empty. Closes with (a) Cedia patch commands in `patches/omp/` that expose MCP server
    status and the hook list, wired through `packages/omp-adapter/src/types.ts` and the host
    allowlist, and (b) a Cedia customization provider for the types OMP can actually report
    (Skills/Instructions/Prompts; MCP is core-only per `ChatSessionCustomizationType`). Each half
    needs its own receipt.

44. ~~**The Apps panel disappears when a session is open, which reads as "the build without the
    terminal".**~~ **Closed 2026-09-18.** The defect was measured first
    ([`evidence/apps-panel-session-state-2026-09-18/`](evidence/apps-panel-session-state-2026-09-18/)):
    cold start and the empty draft showed the four-pane strip `Changes · Browser · Terminal · File`
    with a real `zsh` tab, and opening an existing session replaced that panel with the base tab
    strip, whose `Open new tab menu` offered only `Browser` and `Search`. The item's first proposed
    shape — a separate editor group beside the chat — is not available in this window: the
    single-pane layout allows exactly one editor group and rejects programmatic group creation
    (`SINGLE_PANE_SCENARIOS.md`). The landed fix is the second shape, driven from the panel side:
    the panel is the pane and claims it back from the window's own session tabs (see §9's entry
    and [`evidence/apps-panel-stays-with-session-2026-09-18/`](evidence/apps-panel-stays-with-session-2026-09-18/)).
    `Show Apps` (`cedia.agentHome.showApps`, `Ctrl+Command+I`) remains the explicit hide/show.

45. **A live turn ran a model the composer never showed, and its provider failure was never
    rendered.** Found 2026-09-18 while starting item 1's live receipts, on the packaged build at
    patch set `74c6ca5cbb28`, right after item 44 landed. The draft's pill read `DeepSeek V4.1
    Flash`; the session the send created recorded `model_change {model: "cursor/claude-4.6-opus-high"}`
    and an assistant message `provider: "cursor"`, `api: "cursor-agent"`, `stopReason: "error"`,
    `errorClassificationMessage: "Connect error resource_exhausted: Error"` with `ERROR_RATE_LIMITED`
    ("You're out of usage") — and the window showed an empty chat with the session row reading
    `Completed`, so the user sees a silent no-op instead of either the model they chose or the
    provider's own message. Two defects, both extension-side: (a) `fetchGlobalOmpModelSnapshot`
    (`apps/macos/src/chat-sessions.ts:281-297`) probes the first non-archived session, whose
    `selectedModelId` is the bare `claude-4.6-opus-high` that OMP's `get_state` reports while
    `get_available_models` lists it as `cursor/claude-4.6-opus-high`, so
    `modelPickerGroupFromSnapshot` (`chat-sessions-map.ts:499-513`) publishes no `selected`,
    `applyDraftModelChoice` (`chat-sessions.ts:154-179`) cannot resolve a provider and leaves OMP's
    own default running (extension log: `Cedia kept the host's current model: the picked model
    'claude-4.6-opus-high' is not in OMP's catalogue.`); (b) `emitEntryUpdate`
    (`chat-sessions.ts:881-908`) renders entry text or a tool card, so an error-terminated assistant
    message with empty content renders nothing. **Implemented and unit-verified 2026-09-18** (no
    shell patch: both halves live in `apps/macos/src`, and `bun run test` is 883 pass / 0 fail with
    `bun run typecheck` clean at patch set `74c6ca5cbb28`): `ompModelRowForPick` matches a pick by
    exact id and then by a unique provider-qualified suffix (an ambiguous suffix matches nothing),
    `projectOmpModelSnapshot`/`modelPickerGroupFromSnapshot` use it so a bare `get_state` id still
    marks its catalogue row, `resolveOmpModelPickProvider` can derive the provider of such a pick,
    `applyDraftModelChoice` sends the resolved row's own spelling, and a failed entry with no text
    renders the provider's own message (`entryFailureText`). **The transcript half is closed
    2026-09-18**: the same rate-limited turn, on the re-packaged build, now paints the transcript
    with `**Caret stopped this turn.** Connect error resource_exhausted: Error [... ERROR_RATE_LIMITED
    ... "You're out of usage ..."]` instead of an empty chat (live receipt in the evidence below).
    The session row is still not honest about it: three minutes after that error the sidebar read
    `In Progress` where the first run read `Completed`, because the row follows the host session's
    status rather than the turn's ending, and that status belongs to the host to correct.
    **What remains is the whole model affordance**, and it is now measured rather than suspected.
    The composer's control is the workbench's own language-model picker, fed by the providers the
    user has installed (its list read `Auto, openrouter` / `Claude Opus 4.6 1M, cursor` /
    `DeepSeek V4.1 Flash, opencode-go` marked *Current model* / `DeepSeek V4.1 Flash (Command Code),
    commandcode` / `Muse Spark 1.3 Contributor, opencode-go`), so the pick only means anything if it
    is written to the host. That is now wired — `ompModelForPickedLanguageModel` resolves the
    attached model against OMP's catalogue and the participant handler, which is the path a
    submitted prompt actually takes, applies it before `runTurn` and prints an honest line when OMP
    does not run that model. But the live run shows the attached model is `claude-4.6-opus-high`
    (what Cedia published from OMP's `get_state`) while the pill and the picker's *Current model*
    marker both say `DeepSeek V4.1 Flash`, so the user's pick never reaches the request and the
    marker itself is stale; the turn kept running the rate-limited `cursor/claude-4.6-opus-high`.
    Closes desktop-side: make the composer's model control reflect and honour the provider's
    published selection, or stop presenting a model control whose pick has no effect — Cursor's
    Agents composer carries no model pill at all (re-measured 2026-09-18, same empty-draft state),
    so "no pill" is a legitimate end state and the rule in question is §11 gate 4 (honest states),
    not a parity measurement. This blocks items 1, 32, 33, 34 and 35, which all close with a
    successful live turn, and until the control is honest a user cannot choose a working model from
    this window at all. Receipt:
    [`evidence/native-turn-live-receipts-2026-09-18/`](evidence/native-turn-live-receipts-2026-09-18/).
    **Re-measured 2026-09-18 (fifth pass in that receipt), which corrects the fourth pass.** The
    pick is *not* decorative: it is a workbench selection (`[ChatModelSelection] event=set-model
    surface="workbench" widgetViewKind="quick" model="cedia-omp/deepseek/deepseek-v4.1-flash"`), it
    writes nothing at pick time, and it reaches the host **when the prompt is sent** — the
    participant turn applies it, and the host journal then holds `model_change
    {model: "openrouter/deepseek/deepseek-v4.1-flash"}`. So the model the composer shows is the model
    the turn runs, and the same turn's failure (`provider: "openrouter"`, `stopReason: "error"`)
    painted the transcript as `**Caret stopped this turn.** 401 User not found.` — a third failure
    shape for the half closed above. What remains is narrower than "the pick has no effect": the
    pick's id resolved to a provider this machine has no credentials for, because
    `ompModelRowForPick` returns the *first* exact id match and `deepseek/deepseek-v4.1-flash` is
    advertised by both `openrouter` and `commandcode` (`~/.omp/agent/models.yml`), with nothing in
    the composer's featured list to tell the two rows apart. Closes with (a) `ompModelRowForPick`
    refusing an id that names more than one provider unless OMP's own answers single one out — an
    authenticated provider, or the qualifier in the pick — and saying so in the transcript the way
    `applyRequestedModel` already does for an unknown model, and (b) the composer showing which
    provider a row means (the option group already carries it as each item's `description`). An
    attempted bridge-side fix (adopting the host's published model as the session's model) was
    reverted: it changed nothing the live run showed and could clobber a confirmed pick.
    **Landed 2026-09-18 (extension only, no desktop patch):** `ompModelRows`
    (`apps/macos/src/chat-sessions-map.ts`) gives every advertised model a row identity that survives
    the workbench keeping one row per identifier — the first row of a model id keeps OMP's own id, and
    every later row takes its provider-qualified selector, with the provider appended to a label two
    providers would otherwise share. Registered rows and the option-group items are both built from it.
    Live on the repackaged build: `873 advertised by OMP` / `873 rows after collapsing OMP's duplicate
    ids`, zero `already registered. Skipping.` warnings where the same class of run produced about
    twenty, and the picker now offers `DeepSeek V4.1 Flash (Command Code)` — a row that did not exist in
    it before. Choosing it and sending recorded `model_change
    {model: "commandcode/deepseek/deepseek-v4.1-flash"}` and completed the turn
    (`assistant commandcode ... stop | caret-live-ok`), the first turn this window has completed since
    the item opened. What remains here: the item-specific live receipts for item 1 and items 32-35 on
    this working path, and provider grouping, which is unreachable for registered rows (groups come from
    the models configuration file, not the extension API) and belongs with the Cedia-owned picker work
    in items 5-9.

46. **The Agents-window picker cannot tell OMP's providers apart, so its provider tabs collapse into
    one.** Measured 2026-09-18 on the packaged build (patch set with `0040`-`0044`): the rows the
    picker receives are the registered vendor rows (`vendor: 'cedia-omp'`, no `modelGroup`), so
    `getProviderGroupForModel` has nothing finer than the vendor's display name (`Caret`) to group
    and badge by — every row reads `Caret` and the tab bar holds one tab. Cedia's own projection
    (`getCediaSessionOptionModels`, patch `0011`) is the only side that knows the provider, and the
    field it reads does not survive: `apps/macos/src/chat-sessions.ts` records that an option item's
    `description` is tooltip-only. Closes by publishing the provider through the documented
    `IChatSessionProviderOptionItem.modelMetadata.vendor` — the field the base's own session picker
    reads (`chatSessionPickerActionItem.ts:173`) — in `modelPickerGroupFromSnapshot`, and reading
    `item.modelMetadata?.vendor ?? item.description ?? item.detail` in the projection. Receipt:
    [`evidence/agents-home-hero-and-provider-marks-2026-09-18/`](evidence/agents-home-hero-and-provider-marks-2026-09-18/).
47. **The reasoning chip beside the model picker never appears, and not because nothing renders it.**
    The extension publishes the `reasoning` option group only from OMP's answer for a *host session*
    (`apps/macos/src/chat-sessions.ts:555`), and only when that answer carries a ladder
    (`thinkingFromOmpState` accepts `thinkingLevels` / `thinking_levels` / `availableThinkingLevels` /
    `available_thinking_levels`). OMP does track levels — the host journals hold 23
    `thinking_level_change` events, `thinkingLevel: "high"` for `openrouter/aion-labs/aion-2.0` and
    `null` for `commandcode/deepseek/deepseek-v4.1-flash` — so the ladder exists for some models and
    the field the extension reads is not the one OMP answers with. Live check: a session switched
    from `DeepSeek V4.1 Flash (Command Code)` to `Aion-2.0` left the composer with only `Models`.
    Closes by capturing OMP's raw `get_state` answer and either reading the ladder from the field it
    really uses, or recording that OMP publishes no ladder and keeping the chip honest-disabled.
    Receipt:
    [`evidence/agents-home-hero-and-provider-marks-2026-09-18/`](evidence/agents-home-hero-and-provider-marks-2026-09-18/).

48. **The Agents window's model control is Cedia's own picker now; what remains is its detail.**
    **Landed 2026-09-19:** the base's picker cannot be shaped like the reference — it groups and
    badges by a vendor or a `modelGroup` the extension API cannot set, and the option-group store is
    empty before a session exists (measured across five patch cycles) — so `0047` replaces it in the
    Agents window with `cediaModelPicker.ts`: one row per OMP provider (its mark, name and model
    count) whose submenu is that provider's models, drawn through the platform's action widget. The
    provider travels on each row's `detail` (`"<roles> · <provider>"`, `omp-language-models.ts`),
    which is the one free-form line every picker receives. Live:
    [`evidence/agents-home-hero-and-provider-marks-2026-09-18/caret-own-provider-picker.png`](evidence/agents-home-hero-and-provider-marks-2026-09-18/).
    What remains: the per-provider model list needs the search field and per-row star the reference
    has (`hardbeat920/monocode`, MIT, `src/chrome/ModelPicker.tsx` is the licence-clean reference the
    owner supplied), the list should not overflow the composer's bottom edge, and the trigger's own
    mark/label still come from the base's button. Closes with that polish and its live receipt.
    **Superseded in part by the Synara port's step 2**, whose first attempt (2026-09-19) vendored
    the reference's picker primitives and rendered its trigger, search field, provider groups and
    rows from Cedia's catalogue, then reverted the whole slice because the panel never painted:
    Base UI's portalled menu is reachable through the accessibility tree and invisible on screen
    (`document.body` and the workbench element as the portal target both measured), an inline
    positioner throws `Base UI error #32`, and Cedia's own in-tree overlay paints in the same
    screenshots. The next attempt places the panel in the workbench tree
    (`Menu.Portal` into the composer's widget element with `positionMethod="absolute"`, or the
    action-widget host).
    **Closed 2026-09-19** by that second attempt (§9, "The Agent Home's model control is the
    reference's picker"): `0052` retires this picker rather than polishing it, so the search field,
    the per-row star, the provider groups and the trigger all arrive as the reference's own
    components, and the list's overflow is `composerPickerSize.ts`'s capped submenu height.
49. **The composer has no permission control and no reasoning chip, and its row order is not the
    reference's.** The reference reads `+`, permission, model, effort. Measured 2026-09-19: `+` is
    the base's attach control and the model control is present; the permission level is deliberately
    absent (patch `0033` hides the Copilot permission picker in this window because its levels are
    Copilot's policy, and OMP's own approvals are item 32-35 work); the reasoning ladder is parsed
    and published but reaches no draft (see the receipt's second pass). Closes with the picker port
    in item 48 carrying all four controls in that order, the effort control driven by the ladder
    `normalizeOmpModels` already parses, and the permission control either fed by an OMP policy
    surface or left out with the reason recorded. Receipt:
    [`evidence/agents-home-hero-and-provider-marks-2026-09-18/`](evidence/agents-home-hero-and-provider-marks-2026-09-18/).
    **Effort chip - re-measured 2026-09-19, and the gap is the option store, not the UI.** The
    chip's slot already exists and is visible: `newChatInput.ts` mounts
    `createNewSessionControlToolbar` into `.new-chat-session-controls` inside
    `.new-chat-bottom-container` (`newChatInput.ts` 823-825), and `chatWidget.css` 120 shows that
    container (`display: flex`, not hidden). The extension already publishes the ladder for the
    catalogue's current model through `provideChatSessionProviderOptions`
    (`apps/macos/src/chat-sessions.ts` 678-690). What is missing is the step between them: a pristine
    draft's option store holds nothing, so the toolbar draws no item. Next session's first move is
    therefore a **probe, not a port**: log the groups `provideChatSessionProviderOptions` returns and
    the groups the store holds for the draft's session type (the base keys it by the content
    provider's type, `caret` vs `cedia.omp`), then fix whichever side drops the group - and the chip
    then appears in the composer's own control row with no new React.
    **Effort - landed 2026-09-19 as the reference draws it, and the open half is now named.** §9's
    "The reasoning control is the reference's, in the reference's place" records the step: `0055`
    (with `0048`/`0051`/`0052` re-cut) removes the separate chip and draws the level where the
    reference draws it - the trigger's muted `statusLabel` and the picker panel's `Effort` trait row,
    expanding OMP's ladder inline - and the extension now resolves the current model's row with the
    provider `get_state` names, which is what made a ladder reach the window at all (`row=none`
    before it, `reasoning for '…' -> minimal/low/medium/high` after). Verified live, with receipts.
    **Closed 2026-09-19.** What the item was waiting on: a draft's own pick did not reach the
    extension - the write-through log stayed silent for an untitled draft - because the workbench's
    option store refuses every write for a resource it has no chat session record for
    (`chatSessions.contribution.ts` `updateSessionOptions`), and those options are exactly what seed
    the session at creation (`prepareNewSession` -> `getSessionOptions(draft.resource)`). The fix is
    one call in `createNewSession` (`extensionSessionsProvider.contribution.ts`, `0010`): resolve the
    draft's session when the draft is created, which opens the store. §9's "A draft's picks reach the
    session, and OMP" carries the measurements - the extension log's
    `Caret session option change: cedia.omp:///untitled-… reasoning=high`, the trigger and footer
    showing `High`, and OMP's own transcript recording `model_change
    cursor/claude-4.6-opus-high` and `thinking_level_change high` for the session the draft became.
    The race the fix first left (the composer's first write, before the record resolved) closed with
    item 52 the same day.
    **Permission half closed 2026-09-19 as not portable** (§9, "Step 5 measured: the reference's
    permission chip has nothing to set here"): OMP exposes no approval level - it asks per tool call
    with its own option list, which this window already answers - so a chip here would either
    auto-answer OMP's requests (a new capability, not a port) or be a control with nothing behind it.
    The `+` extras panel stays closed with it; see §9's
    "Step 3 closed" entry for why one row is not worth a menu.
50. **The window has no Environment popover.** The owner asked for a top-right control between `IDE`
    and the panel toggle that opens the reference's Environment sheet: `Changes`, `Local`, the
    branch, `Commit & push`, `Local Servers`, a usage row, the repository link and an `Editor` group.
    Cedia's data for that already exists per session (the workspace folder and branch in the base's
    session state, the host's terminals for Local Servers, the session's own git status for
    `Commit & push`, and the account's usage through the host), but the sheet itself is unbuilt.
    Closes with the control and the sheet, each row reading live state rather than a placeholder, and
    a live receipt. Receipt:
    [`evidence/agents-home-hero-and-provider-marks-2026-09-18/`](evidence/agents-home-hero-and-provider-marks-2026-09-18/).
    **Half closed 2026-09-19** (`0054`, §9, "The Agent window has the reference's Environment
    panel"): the control is in the title bar beside `IDE` and the sheet is the reference's own card -
    `Changes`, `Local`, the branch, `Repository` and the `Editor` group all read live state and act
    on it. What this window cannot back is left out rather than faked: `Commit & push` and
    `Local Servers` (the git extension's actions and the host's terminals are not reachable from this
    renderer), `Usage` (no renderer surface for the account's usage), and the reference's Recap /
    Pinned / Pull requests / Sidechats / Automations / Studio outputs sections. The remaining half of
    step 3 is the composer-side surface - the reference's environment picker and the `+` extras
    panel - which is tracked in item 51's table below.

51. **Adopt the reference agent window's look end to end.** The owner asked for the whole surface of
    the reference app (Synara) in Cedia's window - side panel, environment sheet, model picker,
    effort, permission and the remaining elements - while leaving the right panel
    (`Changes · Browser · Terminal · File`, landed in item 44) as it is. What that means concretely,
    and what each element needs to stay honest:

    | Element | Data it must read | State |
    |---|---|---|
    | Side panel: brand row, New thread, Kanban, Pull requests, Automations, Projects with session rows, Chats | **Landed 2026-09-19** (§9): the header holds `Search` as an icon button and the primary navigation is the reference's `New thread` / `Automations`, with Cursor's `Customize` row and `Repositories` section removed (their commands stay registered). Kanban and Pull requests have no surface — OMP reports no board and no PR list through the RPC Cedia uses — and the reference's project *rows* are the sessions tree this window already stacks below the header, so the trees themselves are unchanged | Two reference rows left out for want of a source; the rest is the reference's |
    | Composer evidence rows: `folder`, `Local`, `branch` chips above the card and a `Temporary` marker | The workspace picker, the host's environment, the session's git branch, and the draft's persistence all exist in the base's session state | Available now |
    | Composer row: `+`, permission, model, effort, voice, send | `+`, voice, the reference's model picker and the reference's footer row are in place (`0051`-`0052`). Effort is no longer a control of its own: `0055` draws it where the reference does - the trigger's status label and the picker panel's `Effort` trait row - and a draft's pick now reaches the session and OMP (item 49 closed) | Six of six on this window's side; permission is not portable (§9) |
    | Model picker: provider rail, search, per-row star, fixed size | Cedia's catalogue with the provider on each row; stars are the base's pinned-model store (`getPinnedModelIds`), which Caret's picker does not use yet | Available now (`0047` is the first cut) |
    | Environment sheet (top-right, between `IDE` and the panel toggle) | `Changes`, `Local`, branch, `Commit & push`, `Local Servers`, usage, repository, `Editor` - each backed by the base's session/git state, the host's terminals, and the account | Item 50 |
    | Permission (`Full access`) | **Closed 2026-09-19 as not portable** (§9, "Step 5 measured: the reference's permission chip has nothing to set here"): OMP has no approval level to set - it asks per tool call with its own options, which this window already answers (`apps/host/src/service.ts` 511, `apps/macos/src/approval-view.ts`) | Not ported; reason recorded |

    **Source settled 2026-09-19**: the reference app is open source after all —
    `github.com/Emanuele-web04/synara`, MIT (`Copyright (c) 2026 T3 Tools Inc.` and Emanuele Di
    Pietro), cloned at `3333343` and measured in
    [`evidence/synara-ui-port-2026-09-19/`](evidence/synara-ui-port-2026-09-19/README.md). Its UI is
    React + Tailwind v4 + shadcn (287 files under `components/chat`, 46 primitives under
    `components/ui`, its own token sheet), so the port takes that presentation layer into Caret's
    agent-window React surface with Cedia's adapter mapping OMP data onto its props. The boundary is
    fixed there too: `apps/desktop` (Electron main), `apps/server`, `packages/contracts` and every
    provider adapter stay out, because taking them would create a second execution owner and a second
    provider-auth path. Each element lands as its own verified build; the session handoff is
    [`evidence/synara-ui-port-2026-09-19/NEXT-SESSION.md`](evidence/synara-ui-port-2026-09-19/NEXT-SESSION.md).
    Earlier work on this surface, with its live receipts, is in
    [`evidence/agents-home-hero-and-provider-marks-2026-09-18/`](evidence/agents-home-hero-and-provider-marks-2026-09-18/).
    **Step 0 landed 2026-09-19** (`0048`, §9): the Tailwind surface compiles into the sessions
    stylesheet scoped to `[data-cedia-surface]`, and the ported primitives render under the
    window's React. **Step 1a landed 2026-09-19** (`0049`, §9): the reference's own hero is in the
    empty home, with the owner's copy (`What are we building in` over the draft's project) and no
    Synara logo or wordmark. **Step 1b landed 2026-09-19** (`0050`, `0051`, §9): the evidence chips
    wear the reference's toolbar chrome and its composer footer row sits inside the home's card.
    **Step 2 landed 2026-09-19** (`0052`, §9): the model control is the reference's picker over
    Cedia's catalogue, with `0047`'s own picker retired. **Step 2b landed 2026-09-19** (`0053`, §9):
    the owner's colour decision is in force — the agent window reads the reference's runtime palette
    and its composer card wears the reference's raised-chrome recipe, while the IDE window keeps
    Cursor's. What remains is the environment sheet and the composer extras, the sidebar, and
    permission — steps 3-5 of
    [`NEXT-SESSION.md`](evidence/synara-ui-port-2026-09-19/NEXT-SESSION.md). **Step 3's first half
    landed 2026-09-19** (`0054`, §9): the environment panel. **Effort landed 2026-09-19** (`0055`,
    §9): the reasoning control sits where the reference keeps it — the trigger's status label and
    the picker panel's `Effort` trait row — over the ladder of the model the composer is showing;
    its draft-side persistence closed with item 49. **Step 4 landed 2026-09-19** (`0022`, §9): the
    Agents sidebar is the reference's. Nothing in this workstream is left open: the composer extras,
    the environment picker and permission are closed with reasons (§9, and items 49 and 51), and the
    rough edge that fix first left (one refused write per draft) closed with item 52.

52. ~~**A new draft's first model write is still refused, and the pick it carries is reverted.**~~
    **Closed 2026-09-19** (§9, "A draft's picks reach the session, and OMP"). Found while closing
    item 49: the draft is created and its composer mounted in the same turn, so
    `SessionModelSelection`'s first write (the remembered model) reached the option store before the
    asynchronous `getOrCreateChatSession` call in `extensionSessionsProvider.createNewSession` had
    made its record, and was refused and rolled back - one
    `model selection was not accepted` warning per new draft. The provider now keeps that promise
    (`_draftOptionStore`) and retries the refused write once the store exists, reverting only for a
    resource it does not own. Verified live: a fresh draft logs no `not accepted` line, and the
    remembered model lands after the record exists, so the draft's store and the model the window
    shows agree.

53. ~~**Retire the `?view=editor` route and `EditorWorkspaceView` once dock file edits hand off
    to the IDE.**~~ **Closed 2026-09-20** (§9, "In-app editor view deleted, dock edits open in
    the IDE"). §9 (2026-09-20) removed every offered entry point, but the route, the view
    (`components/EditorWorkspaceView.tsx`), its persisted state (`editorViewState.ts`), the
    route param (`diffRouteSearch.ts`, `-chatThreadRoute.logic.ts`), the editor rail
    (`presentationMode="editor"`, `onNewEditorChat`, `onNavigateToThread`'s view-preserving
    branch) and the dock's edit handoff (`handleEditDiffFileInEditorView`,
    `handleEditDiffFileFromDock`) still exist for deep links and dock edits. Closes by routing
    dock file edits through the existing `openIde {cwd, path, line}` bridge (already implemented
    in `CediaIdeAgentProvider.openIde`), deleting the route/view/state/rail above, and proving it
    with the agent-window suite + `vite build` plus a live receipt showing a dock file edit
    landing in the IDE window's real editor. Until then the route stays as an unadvertised
    fallback, not an offered surface (§5).

**Spec execution (opened 2026-09-22, from the §3.A/§3.B lock).** Each item closes with a receipt
from a packaged build unless stated otherwise. Items 54-64 are the work this lock adds;
items 65-67 are same-day follow-ups from the full-repository architecture review (host,
extension and patch-stack internals) and do not depend on the two-window contract.
**Execution order:** 54 + 60 first (bundle/extension files only, no desktop-patch rebuild, no
shared files) → 55 (re-cuts patches `0057`/`0058`, so it owns the §6.1 patch loop alone) → 57,
58, 59, 63 (independent of each other; 63a needs no prerequisite — the surface is already
unreachable) → 61 + 62 as one slice or coordinated (both edit `cedia-adapter.ts`) → 56 (only
after its residual-consumer check) → 64 last (its receipt rides the next `package:mac` build).
Receipts batch through packaged builds per §9 practice; coordinate on `cedia-adapter.ts` and
`patches/desktop/` the way §6.1 requires. Items 65-67 are internal-health work: 65 (host) any
time; 67 (patch stack) after 56 settles `0033`'s fate; 66 (extension split) only after 63's
deletions so dead code is not carried across.

54. **One theme authority end to end.** The agent window's Settings → Appearance keeps a
    read-only "following the IDE theme" status only; `ThemePackEditor`, the pack catalog and the
    mode picker are cut (§3.B). `AGENT_THEME_COLOR_KEYS` extends to the full `cedia-theme.ts`
    anchor set and the bundle maps those anchors onto its `--color-*` layer, so Synara's
    composition paints over Cedia's palette everywhere (chips, panels, settings — not just the
    composer card). Closes when one `workbench.colorTheme` change repaints both windows
    together, with no agent-side theme-editing UI anywhere, receipt from a packaged run.

55. **One window-chrome policy.** Zoom, traffic lights, title-bar and menu policy move into a
    single main-process module used by both `BrowserWindow`s (patches `0057`/`0058` re-cut onto
    it), and the agent window gains the slim status bar of §3.B (host · model · session ·
    branch, `statusBar.*` tokens). Closes when both windows share zoom behaviour and menu
    source by construction (no per-window patch), and the agent status bar is measured on
    screen with live values.

56. **One model-selection state; retire the native chat surface.** After a residual-consumer
    check (quick-access/palette entries that still resolve the participant), retire the
    workbench LM-picker/provider path: `chat-sessions.ts`, the vendor cluster in
    `chat-sessions-map.ts`, `omp-language-models.ts`, and patches `0011`/`0013`/`0014`/
    `0040`-`0047` — together with the registration surfaces that exist only for it: the
    `chatSessions`/`chatParticipants` contributions and `enabledApiProposals` entries in
    `apps/macos/package.json`, and the proposal-allowlist rows in patch `0003`
    (`chatSessionsProvider`, `chatParticipantPrivate`, `defaultChatParticipant`; its
    Copilot-identity removals stay). This also **supersedes §10 items 45-49**, which were
    written against the native renderer — restate them per the §10 head rule before touching
    either side. Host `GET /v1/models` + `set_model` with the bundle picker becomes the only
    model control (§3.A). Closes when `registerCediaChatSessions` and those patches are gone,
    the suite is green, and a model change from either window is demonstrably one code path.

57. **One keybinding system.** The bundle's keybinding section reads and writes the real
    `Cedia/User/keybindings.json` through the extension bridge (today: path advertised, list
    empty, write rejected — `cedia-adapter.ts:253-258, 1471, 1516`); the bundle's private chord
    defaults sheet is deleted; `backlog/command-map.md`'s CONFLICT-GATE gains the agent-surface
    `when` vocabulary. Closes when a binding edited in the agent window appears in the workbench
    and vice versa, plus one conflict-gate run.

58. **Host git service is the single git implementation.** Build the 16 throwing methods
    (`native-git.ts:51-87`: stage/unstage/pull/stash/worktree/PR preparation/…) on the host git
    service so every Cedia git surface (right-dock Git pane, review, worktree receipts,
    Environment rows) reads one implementation; the stock SCM view stays as the §5 upstream
    feature. Closes when the pane's disabled actions run against a real repo with a receipt, and
    no Cedia surface shells out independently.

59. **One project-creation flow.** `CreateProjectDialog` / `project.create` → host
    `POST /v1/projects` (+ `/v1/workspace-suggestion`) is the only Cedia project flow; IDE entry
    points register through it when a Cedia surface needs the project; dead sources
    (`provisionFromGitHub`) stay cut. Closes when a project created in either window is visible
    in both from the same host record.

60. **Agent-window scope cut (§3.B rule).** Remove the surfaces with no OMP/host source:
    routes/nav for Kanban, Pull requests, Plugins, Studio, Spaces; Settings sections AppSnap,
    Safari vault/cookie import, Profile stats, Usage, Worktrees; the feedback POST to
    `trysynara.com` and its dialog; the Synara `whatsNew` changelog/release history; Synara
    public art (favicon / apple-touch / `synara.*`) and the ~85-file Synara copy/link sweep;
    rebuild `upstream.json` from the actual tree (it wrongly excludes `apps/server`, which the
    host imports, and the vendored test trio); make the `nativeApi.ts` and
    `deviceFrameSource.ts` WebSocket fallbacks **throw** so a missing `window.nativeApi` can
    never open a second data path. Closes when a fresh-profile run through every sidebar row and
    settings section shows no dead state, no `trysynara` egress, and `upstream.json` matches the
    tree.

61. **Composer attachments and mentions reach OMP on the bundle path.** Today
    `thread.turn.start` throws on attachments/mentions (`cedia-adapter.ts:1288-1289`) while the
    native path already proved the payload (§10 item 34): images → `prompt.images[]`, other
    references → labelled attached context; `@` refs resolve through the files bridge. Closes
    when an image pasted in the agent composer arrives in the OMP turn (packaged-run receipt).

62. **Skills/slash and compaction are real, not fakes.** `listCommands`/`listSkills` forward
    `get_available_commands` (rows with `source: "skill"` → skills; flip
    `supportsSkillDiscovery`), and `compactThread` forwards `compact`/`set_auto_compaction`
    (flip `supportsThreadCompaction`); both commands are already in the pinned RPC
    (`cedia-adapter.ts:1453-1457`). Closes when `/` in the composer completes a real skill and a
    compaction runs from the UI, receipts included.

63. **Extension consolidation (the surgery the decisions authorize).** (a) delete the
    unreachable task shell — `webview.ts`, `messages.ts`'s dead union half,
    `CediaTaskViewProvider`'s webview half, `cloneStateForWebview`, and the shell-bound tests —
    after extracting the live pieces (status bar, context keys); (b) one bridge contract module:
    channel string, envelope and kind union imported by `agent-window-main.ts`,
    `agent-ide-webview.ts` and the bundle, with `activeSession`/`openAgents` moved into the
    shared handler and the `.catch(() => undefined)` swallows removed; (c) fix the silent
    guarded-send (`#state.selectedModel` is never set in production, so refusals reach zero
    views) by feeding it from `refreshOmpState` and routing refusals to `showWarningMessage`;
    (d) restrict `agent-window-files.ts` `projects.writeFile` to the editor-bridge guards so no
    surface writes workspace files outside OMP turns and the guarded editor bridge. Closes when
    `rg "webview.ts|TASK_WEBVIEW_CSS"` has no users, a test asserts the two bridge-kind sets are
    equal, an inline-edit refusal is visible on screen, and the suites are green.

64. **Terminal convergence receipt (decision 8's terminal pair).** The pair is converged by
    topology — the dock renders the same bundle, whose Terminal pane talks to the host PTY
    registry — but no receipt has ever exercised it: the dock's Terminal pane has never run in a
    packaged build. Closes when a packaged run opens a terminal from the IDE dock, runs a
    command, and the screen is served by the host's PTY registry/checkpoint route (one registry,
    two windows), receipt attached.

65. **Host hardening (architecture review 2026-09-22).** Five measured gaps in `apps/host`:
    (a) the events table is **unbounded** while `store.ts:1-8` documents a "bounded journal" —
    fork hydration journals full `get_messages` payloads, so the projection drifts toward a
    second transcript on disk; add per-session retention (byte/count cap with a
    `historyTruncated` marker like `TerminalCheckpoint`) or stop journaling hydration frames,
    and fix the doc either way; (b) `service.ts` (~709 lines) owns ~10 concerns — split along
    its existing seams (OMP lifecycle / command dispatch + idempotency / permission + editor
    bridges / fork-sidechat-terminals) behind a thin `CediaHost` façade so router and tests do
    not churn; (c) wire shapes are re-declared in four places (`relay/protocol.ts` `Json` vs
    `protocol`, adapter-local `CediaProject/Session/Event/Command`, the extension-UI request
    union in four partial views) — converge on `packages/protocol` so approval shapes cannot
    drift silently; (d) the security perimeter is untested — add Origin-reject / Host-header /
    413 tests to `http.test.ts`, a host-level `remote.ts` test (pair offer, disable stops
    relay, identity file 0600), and a router test for `workspace-suggestion`; (e) iOS reads
    models/providers through the per-session command envelope while agent window and CLI use
    sessionless `/v1/models` + `/v1/providers` — converge iOS on the sessionless routes or
    record why a phone must start a session. Closes when: the journal cap lands with the doc
    matching, each shape has exactly one definition in `packages/protocol` with importers, the
    five new perimeter tests are green, and iOS lists models without a started session (or the
    deviation is recorded in §5).

66. **Split `extension.ts` (4,234 lines), only after item 63's deletions.** Extract
    host-connection/polling, the ~45 command registrations, the editor-surface
    (marks/lenses/actions), review-surface, selection-send and status/context-key code into
    modules; `activate()` becomes a ~100-line wiring root. Running it before 63 would carry the
    dead webview half across. Closes when `apps/macos/src/extension.ts` is ≤800 lines of
    wiring, the command registry is enumerable from one module, `bun run test
    apps/macos/test` + `bun run typecheck` are green, and no behavior changes (the suite is the
    receipt).

67. **Patch-stack hygiene.** (a) Retire the three patches the README itself calls inert
    (`0019`, `0027`, `0028`) — manifest + digest work only; (b) rewrite
    `patches/desktop/README.md` from `0036` onward: it stops at the `0034` era, still describes
    retired `0010` as operative, and never documents `0036`-`0047` or the topology-defining
    `0056`-`0059`; (c) re-count the README's "15 Copilot-named helpers" claim (item 26 owes the
    same count) so the number is measured, not repeated; (d) decide patch `0033`'s
    sessions-window gates together with item 56's retirement — its IDE-window behavior must
    stay. Closes when the manifest holds ≤26 entries with `prepare-desktop` green from a clean
    base, the README describes every patch in the manifest, and the helper count is measured.

## 11. Acceptance criteria: "CEDIA owns its workspace"

The project claims its workspace contract when every criterion below passes. Each is binary and
has a stated method, so there is no room for a judgement call.

1. **Tokens** — `apps/macos/test/cedia-theme.test.ts` pins every token value with no external
   reference gate.
2. **Surfaces** — every row of §3.A exists in the IDE window and every row of §3.B in the agent
   window, and its geometry and colour are measured from the real DOM or compositor at the
   stated viewport and theme. Looking at it is not measurement, and a single screenshot is not a
   pass. Colour must be compared with the §3.1 method (full-screen capture, or theme-file values
   verified against a full-screen capture); `screencapture -l` alone is invalid. The §3.B scope
   rule is the honesty half: a row with no backing must be absent or a §4 disabled+reason entry,
   never an empty, error or third-party state.
3. **SSOT** — one responsibility has exactly one live path (§6) **and the retirement ledger (§6.2)
   is empty**.
4. **Honest states** — everything not yet possible is disabled with a reason; there are no fake
   buttons.

## 12. Risks that affect whether the result will really match

| Risk | Effect if unaddressed | Mitigation |
|---|---|---|
| The base's Agents window is bound to Copilot (harness + auth gate + `node/copilot/**`) | The window opens but stalls at sign-in with none of our sessions | S1 must remove every Copilot provider first; prove with AX that no gate remains. **Closed 2026-09-14.** |
| Caret's provider was not written | An empty, unusable window | Do S2 before S3/S4. **Closed 2026-09-14/16 for the basic path; see §10.** |
| IDE syntax token colours are still Code-OSS (licensing) | The IDE will not match Cursor with code open | Decide the licensing question or author our own token palette |
| Some geometry has token ≠ rendered value (e.g. sidebar row 30 vs 28) | The numbers look right but the eye sees a difference | Trust the rendered value and record it in §3.1 |
| Two tasks on the same repo | Duplicated, overwritten or colliding rebuilds | Clear per-file ownership and one task at a time (see §6) |
| A DOM-level probe cannot see native overlays (browser pages, menus over them) | "Verified" states that a real click invalidates | Test anything painted over native bounds with real input only (§9 item 8) |
| The image tool is unavailable, so nothing is checked visually | Colour/type/spacing drift goes unnoticed while the numbers are "measured" | Treat vision as a required check, not a nice-to-have; a picture is the only way to close §11 gate 2 fully |

**Short answer:** the spec matches Cursor at the level of information architecture, structure,
behaviour and colour tone, and the SSOT is settled. "The result will look the same" is **not**
guaranteed until §11 gate 2 passes — the AX/DOM comparison is the decisive check and it has never
been run. Everything the plan claims is verified is listed with a receipt in §9; everything else is
listed in §10.
## 13. Evidence index

Every receipt under `docs/maintenance/evidence/` is listed exactly once: either inline in §9
(where it backs a specific landed claim) or in this index. A receipt that appears nowhere is a
defect, because an unindexed run is a run whose result nobody can find.

**Agents window and Agent Home parity (2026-09-15/16)**

| Receipt | What it records |
|---|---|
| [`agent-home-ide-entry-2026-09-15`](evidence/agent-home-ide-entry-2026-09-15/) | The IDE entry opens an editor window and returns to it (patch `0015` correction) |
| [`agent-home-no-bottom-panel-2026-09-15`](evidence/agent-home-no-bottom-panel-2026-09-15/) | The Agents window has no bottom panel |
| [`agent-home-project-menu-2026-09-15`](evidence/agent-home-project-menu-2026-09-15/) | The project row right-click menu matches the reference |
| [`agent-home-project-remove-2026-09-15`](evidence/agent-home-project-remove-2026-09-15/) | Remove Project really removes the row, and the desktop patch set applies from the pinned base |
| [`agent-home-sidebar-projects-2026-09-15`](evidence/agent-home-sidebar-projects-2026-09-15/) | The sidebar's Projects section is the reference's header, and projects stay the session groups |
| [`agent-home-window-parity-2026-09-15`](evidence/agent-home-window-parity-2026-09-15/) | No bottom panel, one IDE entry, a real New Project and the user's own theme, together |
| [`agents-show-apps-removed-2026-09-16`](evidence/agents-show-apps-removed-2026-09-16/) | The `Show Apps` title-bar icon removed: it could only close a panel that was already the active editor |
| [`apps-panel-browser-search-2026-09-15`](evidence/apps-panel-browser-search-2026-09-15/) | The Apps panel's address bar searches, not just navigates |
| [`apps-panel-browser-suggest-2026-09-15`](evidence/apps-panel-browser-suggest-2026-09-15/) | The address bar completes what is typed, from the search engine |
| [`s4-apps-panel-browser-visible-2026-09-15`](evidence/s4-apps-panel-browser-visible-2026-09-15/) | A `+`-opened browser tab is actually visible |
| [`caret-host-lifetime-2026-09-15`](evidence/caret-host-lifetime-2026-09-15/) | Caret stops when it is closed: the host no longer outlives the app |
| [`react-agent-surface-decision-2026-09-15`](evidence/react-agent-surface-decision-2026-09-15/) | The evidence behind §7's React decision |
| [`model-roles-surface-2026-09-16`](evidence/model-roles-surface-2026-09-16/) | OMP's configured model roles appear on the model picker rows; the read/write surface added to the pinned OMP patch |
| [`agents-chrome-decisions-2026-09-16`](evidence/agents-chrome-decisions-2026-09-16/) | The four Copilot-flavoured composer controls decided and hidden in the Agents window |

**OMP native tool smokes (2026-09-13)**

All of these run a real OMP subprocess against the pinned patched runtime with temporary fixtures
and no provider credentials, and record `paidModelCalls` and `sourceRevision`.

| Receipt | What it records |
|---|---|
| [`omp-rpc-2026-09-12`](evidence/omp-rpc-2026-09-12/) | Provider-free probe of the installed OMP binary; source of the RPC inventory |
| [`omp-native-permission-2026-09-13`](evidence/omp-native-permission-2026-09-13/) | The native permission ClientBridge (`bun run smoke:omp:permissions`) |
| [`omp-native-editor-2026-09-13`](evidence/omp-native-editor-2026-09-13/) | The native editor bridge |
| [`omp-native-ast-2026-09-13`](evidence/omp-native-ast-2026-09-13/) | The native AST tool path |
| [`omp-native-ast-headless-2026-09-13`](evidence/omp-native-ast-headless-2026-09-13/) | The AST path in headless mode |
| [`omp-native-ast-headless-reject-2026-09-13`](evidence/omp-native-ast-headless-reject-2026-09-13/) | The headless AST path rejecting an invalid request |
| [`omp-virtual-ui-2026-09-13`](evidence/omp-virtual-ui-2026-09-13/) | Virtual TUI transport (`CARET_RPC_VIRTUAL_UI=1`) against the dev launcher |
| [`omp-o11-2026-09-13`](evidence/omp-o11-2026-09-13/) | The O11 command set |

**Desktop shell and parity passes (2026-09-12 → 2026-09-14)**

| Receipt | What it records |
|---|---|
| [`mac-build-2026-09-12`](evidence/mac-build-2026-09-12/) | A clean Mac baseline build of the retained Code-OSS fork |
| [`mac-packaged-startup-2026-09-13`](evidence/mac-packaged-startup-2026-09-13/) | Packaged startup checks (extension activated, upstream agent host not started, no missing WASM) |
| [`packaged-caret-2026-09-13`](evidence/packaged-caret-2026-09-13/) | The packaged Caret.app runtime, with the OMP and host hashes |
| [`packaged-cedia-2026-09-13`](evidence/packaged-cedia-2026-09-13/) | The packaged Cedia.app structural verification (post-rename) |
| [`packaged-shell-2026-09-13`](evidence/packaged-shell-2026-09-13/) | Packaged verification of the spec-aligned Agents shell (after the D01/D02/C01 restore) |
| [`portable-runtime-2026-09-13`](evidence/portable-runtime-2026-09-13/) | The portable runtime, including a relocated path containing a space |
| [`ui-cursor-parity-2026-09-13`](evidence/ui-cursor-parity-2026-09-13/) | Agents shell parity pass 1: sidebar IA and empty-draft composition against measured Cursor |
| [`ui-parity-sweep-2026-09-14`](evidence/ui-parity-sweep-2026-09-14/) | Parity sweep: Agents window against §3 plus IDE window boot and cleanliness |
| [`ui-process-2026-09-13`](evidence/ui-process-2026-09-13/) | UI plan process: local implementation |
| [`ui-shell-runtime-2026-09-13`](evidence/ui-shell-runtime-2026-09-13/) | UI shell packaged runtime: chrome fix, window review, Copilot error attribution |
| [`d19-ca-2026-09-13`](evidence/d19-ca-2026-09-13/) | Behavioural gap fixes CA-01..CA-06 (composer gating, pairing entry, first Files open, non-Git review, task-actions menu, idle composer) plus a packaged rebuild |

**IDE-native shell work (2026-09-14)**

| Receipt | What it records |
|---|---|
| [`ide-native-shell-2026-09-14`](evidence/ide-native-shell-2026-09-14/) | Why the packaged app did not behave like Cursor on a rebuilt bundle, and what fixed it |
| [`ide-native-agents-first-2026-09-14`](evidence/ide-native-agents-first-2026-09-14/) | Why the app looked unchanged, and what makes the first screen match the reference |
| [`ide-native-cursor-palette-2026-09-14`](evidence/ide-native-cursor-palette-2026-09-14/) | Why the window still read as upstream VS Code, and the measured chrome fix |
| [`ide-native-agent-mark-2026-09-14`](evidence/ide-native-agent-mark-2026-09-14/) | The agent mark in the packaged app editor |

**S2 picker and binding (2026-09-14)**

| Receipt | What it records |
|---|---|
| [`s2-composer-picker-2026-09-14`](evidence/s2-composer-picker-2026-09-14/) | Composer prompt path and the OMP model picker binding in the native window |
| [`s2-picker-binding-2026-09-14`](evidence/s2-picker-binding-2026-09-14/) | The picker lists the OMP catalogue with zero Copilot surfaces |
| [`s2-writethrough-login-2026-09-14`](evidence/s2-writethrough-login-2026-09-14/) | A picker choice reaches the host as `set_model`; auth awareness from OMP terminal logins |

**S3**

| Receipt | What it records |
|---|---|
| [`s3-shell-retired-in-agents-window-2026-09-14`](evidence/s3-shell-retired-in-agents-window-2026-09-14/) | The legacy webview shell no longer mounts inside the native Agents window |

**Runtime, mobile and relay (2026-09-12/13)**

| Receipt | What it records |
|---|---|
| [`g0-omp-2026-09-12`](evidence/g0-omp-2026-09-12/) | The G0 adapter smoke against installed OMP |
| [`g1-omp-2026-09-12`](evidence/g1-omp-2026-09-12/) | The adapter against installed OMP 18.1.18 from the pinned source |
| [`mobile-build-2026-09-13`](evidence/mobile-build-2026-09-13/) | Expo build checks: dependency check, tests, typecheck, web export, iOS prebuild; native build and device acceptance **not run** |
| [`mobile-terminal-browser-2026-09-13`](evidence/mobile-terminal-browser-2026-09-13/) | A desktop-Chromium run of the terminal browser fixture — **not** an iPhone or cellular run |
| [`mobile-terminal-recovery-2026-09-13`](evidence/mobile-terminal-recovery-2026-09-13/) | Mobile test and typecheck state; native iPhone verification **not run** |
| [`remote-gateway-2026-09-12`](evidence/remote-gateway-2026-09-12/) | Continuity gaps reproduced without changing production code |

**External reading**

| Receipt | What it records |
|---|---|
| [`external-orca-review-2026-09-16`](evidence/external-orca-review-2026-09-16/) | A reading of `stablyai/orca` against this plan, with observations separated from inferences. **It has no authority**: it is input, not a requirement |

**Hazard for every receipt above**: one that records a *negative* or *not-run* result (mobile device
acceptance, vision checks that answered 429, a probe that could not observe a native overlay) is
exactly as valuable as a passing one. Never read a receipt as a pass unless it says `pass`, and
never delete one because its result was inconvenient.

## 14. CEDIA rename ledger (opened 2026-09-20)

Product and plan are CEDIA. Runtime identifiers below are still `caret`-branded in the tree and
migrate in the order listed; docs describe them factually until each row lands. Never edit a
`.patch` file's contents just to rename: re-cut per §6.1 and refresh the manifest digests.

| Row | Current tree truth | Target | Status |
|---|---|---|---|
| docs + SSOT | `CEDIA-PLAN.md`, `AGENTS.md`, READMEs, handoff | CEDIA owned product, no Cursor authority | **done 2026-09-20** |
| identifier graph | `backlog/requirement-graph.json` paths + spec field | identifiers only, frozen | **done 2026-09-20** |
| package + command IDs | `@caret/*`, `caret.*` commands | `@cedia/*`, `cedia.*` with tests | **done 2026-09-20** |
| OS-visible brand | `com.caret.app`, `caret` scheme, `Caret Safe Storage`, icons, build/launch scripts | CEDIA brand | **done 2026-09-20** (remote repo rename stays a user action) |
| desktop patches | 27 native-UI patches retired 2026-09-20 | 29 remain, apply + idempotent re-run + desktop build proven; 0060 folded into 0003 earlier | **done 2026-09-20** |
| token-check tooling | `check:cursor-parity` script name | retired 2026-09-20; truth in `cedia-theme.test.ts` | **done 2026-09-20** |
| checkout dir + remote | `/Users/pond/caret` on branch `main` | `/Users/pond/cedia` + remote rename (remote stays a user action) | **done 2026-09-20 locally** |
