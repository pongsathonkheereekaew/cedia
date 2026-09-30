# Survey (O07 `/agents` + `/hub`: no slash carrier by upstream design, senders done)

Closes the verification the gate reasons still owed: the lifecycle senders are built and
live-proven, and the two slash commands themselves were traced to their actual dispatch.

## Actual dispatch (source + live probe, 2026-09-25)

- Both commands are `handleTui`-only in `upstream/.../slash-commands/builtin-session.ts`:
  `/agents` calls `showAgentsDashboard()`, `/hub` calls `showAgentHub()` — alternate-screen
  TUI overlays with no RPC/headless carrier by upstream design.
- Live probe (direct RPC client, virtual terminal negotiated exactly as the host does it,
  dead model endpoint): `/agents` and `/hub` answer in milliseconds with
  `agentInvoked: false` — no hang, no turn, and nothing rendered anywhere. Unlike bare
  `/move` (which wedges the turn and earned a menu guard), these fail silent, so no
  `headless-slash.ts` entry: there is no wedge to fence, only a no-op.
- Composer funnel checked: `normalizeSlashCommands`/`isHeadlessHangSlashCommand` live in
  `apps/macos/src/state.ts` (IDE window); the agent-window Synara composer has no slash
  funnel of its own in `apps/macos/agent-window/src`. No menu change made in this slice.

## Coverage consequence (no greenwashing)

- The senders the old reasons claimed missing (kill/revive/focus) are now Cedia senders,
  live-proven this week — the gate reasons for both rows were rewritten to say so, with
  the exact remainder: the dashboard's per-agent model/prewalk/advisor config surface
  and the hub section tabs. Collab guest stays O08/D1-excluded.
- Both rows stay `integration_missing` (still 5 gaps): the config surface does not exist,
  and settling without it would be relabelling. The Agents panel is recorded as the
  functional carrier for the lifecycle core, not as the dashboard.
