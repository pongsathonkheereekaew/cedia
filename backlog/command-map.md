# Cedia — Command / Shortcut Map (H01)

Status: historical identifier/conflict baseline and implementation notes, not a
separate product policy or open-work list. Current shortcut requirements and readiness
are owned by [CEDIA-PLAN.md](../docs/maintenance/CEDIA-PLAN.md), especially §10 items 57/69.
The older revision and Cursor-reference gates below retain their original evidence scope;
they do not override the owner's current shortcut choices or create new prerequisites.

## Recorded baseline priority policy

1. Inside Cedia-owned surfaces (Agents Window, composer, review panels),
   Cedia commands bind `when`-clause context keys scoped to that surface.
2. Never overwrite an upstream global command with a floating binding;
   collisions resolve by narrowing context, not by replacing upstream chords.
3. Tooltip shows the shortcut but is never the only accessible name; Stop and
   Send are distinct labels/accessibility names with deterministic state
   transitions (idle → sending → queued/running → completed/failed); repeat
   press during acknowledgment reuses the original request (UI-SPEC).
4. Escape closes the topmost popover first and must never cancel a run
   implicitly; Tab/Escape/word-accept in Tab follow the user's keybinding
   setting (TAB-02).

## Known conflicts (from J6/K2 — all `pending-runtime`)
| # | Conflict | Sources | Resolution procedure |
|---|---|---|---|
| C-01 | Queue/steer shortcuts differ across agent-overview rollout versions | agent overview (multiple rollouts) | Record source/build/surface per variant; test on the one verified reference build; keep exactly its behavior |
| C-02 | Shortcut reference uses different Return/queue bindings than the overview | `docs/reference/keyboard-shortcuts.md` (`a0e368a9e2dcd80f`) vs agent overview | Same as C-01; Return behavior is reference-gated, keep `pending-runtime` |
| C-03 | `Cmd/Ctrl+K` collides with upstream chord starter | UI-SPEC | Cedia inline-edit binding scoped to editor-text-focus + Cedia-session context; upstream chord untouched elsewhere |
| C-04-evidence | upstream default CONFIRMED at pinned `3e078a3`: `keybindings: { primary: KeyMod.CtrlCmd \| KeyMod.Shift \| KeyCode.KeyD }` for `workbench.view.debug` (`src/vs/workbench/contrib/debug/browser/debug.contribution.ts:459`) — static read 2026-09-10 | Cedia MUST NOT bind bare Cmd/Ctrl+Shift+D globally; runtime CONFLICT-GATE still open |
| C-04 | `Cmd/Ctrl+Shift+D` collides with upstream Debug view | UI-SPEC | Same scoping rule as C-03; verify against F01 keybinding dump |
| C-05 | ACP question/plan requests BLOCK; desktop async questions let work continue | ACP docs vs agent overview | Separate semantics, never one handler: blocking bridge (ACP) vs async interaction (desktop); cancel cleans the waiter (PX-23/24) |
| C-06 | `@` picker vs `/` picker vs model picker behaviors | UI-SPEC | `@` = refs w/ preview; `/` = one-shot skill vs persistent mode; model picker splits engine/provider/model + unavailable reason, never silently retasks |

## Agent-surface `when` vocabulary (item 57; Cedia-owned)

The bundle's keybinding section reads and writes the real
`Cedia/User/keybindings.json` through the extension bridge
(`apps/macos/src/agent-window-keybindings.ts`: file I/O, key grammar,
`when` grammar, resolution into `ResolvedKeybinding`-shaped rows). Valid
context keys are exactly `terminalFocus`, `terminalOpen`,
`terminalWorkspaceOpen`, `terminalWorkspaceTerminalOnly`,
`terminalWorkspaceTerminalTabActive`, `terminalWorkspaceChatTabActive`,
`isMac` (plus `true`/`false` literals for parked rows) — the context the
bundle dispatch sites build (`useChatKeyboardShortcuts`,
`useDiffChangeNavigationShortcuts`, thread-jump hints). Anything else is an
invalid entry with a named issue, never silently false: an unknown identifier
would be invisible forever, the same defect class `menus-contract` guards on
the workbench side.

## Historical runtime gates (not the current open-work list)

- [ ] F01-DUMP: default keybinding set + command list extracted from pinned
  Code-OSS revision; C-03/C-04 verified against real upstream chords.
- [ ] G-VIS-02-MAP: menu/shortcut/settings-path/event-trace map from the one
  verified Cursor build; C-01/C-02 resolved to exactly one behavior each.
- [ ] CONFLICT-GATE: automated check that no Cedia binding shadows an
  upstream/global command outside its surface context (runs in CI from M1).

These unchecked baseline gates are not evidence that the current shortcut contract passes.
Current acceptance criteria and unfinished work live only in the plan.
