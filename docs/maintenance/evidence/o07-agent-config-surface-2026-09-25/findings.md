# Slice (O07 per-agent config, full vertical: runtime → host → adapter → UI)

The last functional remainder behind the `/agents` + `/hub` rows is built: the hub
property strip (enable/disable + model/prewalk/advisor overrides) as Cedia's Config
section, with the hub's own persist semantics end to end. No production behavior was
faked: the parked/configured states come from the runtime's real paths throughout.

## Why a dedicated op (not the PATCH settings route)

The four keys (`task.disabledAgents`, `task.agentModelOverrides`, `task.agentPrewalk`,
`task.agentAdvisor`) carry no `ui` block in the runtime schema, so Cedia's PATCH route
disposition is `advanced` (403). They are hub-written through `settings.set` directly —
hence `agents.config.list` + `agents.config.set`, following the `model.roles.apply`
precedent. Effects are global-layer like the hub's; the session-scoped durable envelope
carries command identity and replay only.

## What was built

- Runtime (pinned patch, regen + re-prepare): `cedia-agents-config-bridge.ts`
  (`listCediaAgentConfigs` = discovery + effective config, `setCediaAgentConfig` =
  sorted disabled rebuild + whole-map persist omitting empties + flush, unknown names
  refused `Unknown agent: <name>`); `agents.config.list`/`agents.config.set`
  descriptors + operations + validators in the capability table; rpc-mode wiring through
  the session's own settings and cwd. Pin test now 73 ops.
- Host: owner-only durable `POST .../agents/config` (strict body, stale-incarnation
  guard, controller 403, replay, unavailable-with-reason) and controller-visible
  `GET .../agents/config`; strict parsers in `omp-agents.ts`.
- Adapter: `getAgentConfigs`/`configureAgent` + native binding; renderer
  `parseCediaAgentConfigsAnswer`/`parseCediaAgentConfigAnswer`, configs query,
  `serverAgentsConfigMutationOptions` (invalidates roster + configs on success).
- UI: Roster/Config section tabs in the Agents panel; per-row Configure expansion
  (Enabled checkbox, three override fields, empty clears) behind an outcome-stating
  confirm, panel-level error/busy states.

## Proof

- Upstream bridge tests 4 pass; upstream `check:types` clean; root `typecheck` clean.
- Pin test on the prepared runtime 10 pass (73 ops incl. the two new rows).
- Extended `scripts/omp-agents-smoke.ts` green: list answers the discovery table,
  set writes through hub semantics, readback, clear, unknown-agent refusal + replay,
  400s, owner-only 403s — no provider call anywhere.
- Host suite 443 pass; agent-window surface tests 16 pass (tabs, config rows,
  strict parsers, mutation key).

## Coverage consequence

`/agents` + `/hub` settle as `platform_presentation_equivalent` (reasons name the exact
coverage): the dashboard/hub functional core — roster, transcripts, kill, revive, focus,
per-agent config, section tabs — is Cedia's Agents panel + live strip. The commands stay
handleTui-only with no headless carrier by design; collab guest stays O08/D1-excluded.
Gap count **3** (was 5): O02 sdk 1, O02 slash 1, O10 cli 1. Still open by owner order:
switchSession (no retarget feature); real-provider park+revive; packaged/window-live
capture of the new Config section.
