# Full-board triage: why each remaining gap needs a build, a design, or an owner — 2026-09-25

This receipt records a triage pass over all 40 remaining coverage gaps. Nothing below
settles a row; each entry names the verified mechanism that keeps it open and the
packet that owns it, so the next turn does not re-spend exploration proving the same
negatives. §10 item 70 owns status. No provider request was made.

## Verified this turn (code-read, not inferred)

- **No unwired operation exists for any gap.** The pinned patch registers 36
  `cedia_control` operations; every one the host does not already call belongs to
  a landed surface. Every future slice therefore needs patch + host + surface
  together — there is no host-only wiring slice left.
- **O12/O08 are owner-blocked by content, not by queue order.** `auth-broker`
  runs a credential vault service, `auth-gateway` is a credential forward proxy,
  `share` uses an external encrypted link, `tiny-models` downloads model assets,
  `update` self-installs under a running app, and O08 joins external collab rooms.
  Each needs a security/adoption qualification only the owner gives; no agent
  turn can supply it.
- **Work pools are AgentHub territory.** Pools are created explicitly per owner
  (`WorkPoolRegistry.create`) for background-agent coordination
  (`task/workpool.ts`, `structured-subagent.ts`, `tools/yield.ts`) — not per
  turn — so `getWorkPoolYieldItems` / `setWorkPoolYieldItems` wait on the
  AgentHub/job-controls build with `/tan`.
- **Code mode stays genuinely open.** Sessions engage it at startup on a Codex
  Code Mode model, which a Cedia picker selection can in principle reach, so
  `getCodeModeDirectToolNames` / `getEvalPreludes` are triggerable getters with
  no Cedia reader — not dead code.
- **`/guided-goal` runs an interview flow, `/loop` is an auto-resubmit mode**
  with count/duration/`--until` gating, `/btw` is an ephemeral overlay whose
  durable sidechat fork is a different persistence semantic, and the
  `/extensions` dashboard persists MCP enable/disable — none has a Cedia
  counterpart surface today.

## Addenda (verified after the first pass)

- **No env-var path for extension roots.** The runtime reads extension paths
  from settings files and CLI flags only; no `*XTENSION*` environment input
  exists in its sources. The host therefore cannot smuggle roots through its
  per-session `ompEnv`, closing the last patch-free avenue — a roots path
  needs a runtime change, a host session option, or both.
- **SSH stays O11-owned, not excludable.** The O11 packet explicitly owns SSH
  readiness discovery plus configure/start/stop through the owning service, so
  the `ssh` CLI row cannot be excluded as superseded-by-Tailscale unilateraly;
  Tailscale selection (50A) covers the remote transport, not the execution
  environment.

## Addendum: packaged catalog capture is fixture-blocked

Both agent-window smokes (browser and native) drive the UI against the
`agent-window-omp` fixture runtime, which has no MCP/extension discovery — so
no packaged run of those smokes can show an `mcp__` or extension row no matter
what the panel renders. A packaged catalog proof needs a new harness (real host
+ real runtime + MCP fixture under the packaged UI), not an extension of the
existing smokes. Faking the row inside the fixture would prove rendering only,
which unit tests already cover.

## Standing verdicts (confirmed, not re-litigated)

- Builds required: O06 extension management + `refreshMCPTools` op + code-mode
  readers; O02 btw/cleanse/omfg/tan workflows (+`branchFromBtw` behind btw);
  O03 `applyRoleModel` (role assignment unbuilt); O05/O10/O11 dynamic subsystems
  (image, TTS, browser, computer); O07 agents/hub/loop/prewalk/Advisor-remainder
  surfaces; O11 work pools; O02 `moveSession` relocation (host-owned placement
  forbids it — pinned by test) and `switchSession` (needs a window-local link
  kind the gate does not have: every SDK link shape (`OMP_SDK_VIA_RPC`, other-path
  slash/setting/command) requires an audited rpcCommand and task navigation sends none,
  so carrying it needs optional-rpcCommand links — a core gate redesign for the O02
  packet, not a mapping).
- Decided and unchanged: O03 `setModelTemporary` (no second version; stays open
  by the one-command-one-operation rule), O02 placement (host-owned).

## Evidence (this revision and build)

- `bun run check:omp-coverage`: integrity PASS, gap count **40** (unchanged).
- `git diff --check`: clean.
