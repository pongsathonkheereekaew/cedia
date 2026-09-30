# #1166 differential: upstream ACP adapter vs CEDIA RPC owner — 2026-09-26

Source-read comparison of upstream's Beta OMP integration
(`apps/server/src/provider/Layers/OmpAdapter.ts`, ~2.4k lines at release
`a33435c`, ref verified) against CEDIA's pinned-runtime RPC ownership.
Research only: no product code changed, no gap change (stays **2**),
no provider involvement. §10 item 70 owns status.

## The two designs

- Upstream runs OMP as one provider among many (Codex, Claude, Pi,
  OpenCode, …) inside Synara's AgentGateway. Sessions spawn an `omp` child
  (binaryPath setting defaulting to `"omp"`) spoken to over ACP
  (`@agentclientprotocol/sdk`), wrapped in a gateway session lease with
  exit watcher, MCP-server injection and Effect process runtime; resume,
  elicitation-form client capabilities and per-transport debug markers
  included. Model discovery shells out to `omp models --json` (TTL-cached
  per binary+agentDir) and then reads file-backed `modelRoles` itself,
  mirroring OMP's own precedence (override `PI_CODING_AGENT_DIR` → ambient
  env → `<home>/<PI_CONFIG_DIR|".omp">/agent`; `config.yml` then
  `config.yaml`, first load wins, read failure stops fallback; project
  layer wins per role).
- CEDIA drives the pinned runtime (omp/18.1.18) through its own rpc-ui
  owner: `cediaCapabilitiesVersion`/`cedia_control` registered operations
  (73 descriptors live), owner-only host routes, per-session projections.
  The launcher resolves the pinned runtime path rather than PATH `omp`.

## Auth parity (confirmed, not assumed)

Both sides leave credentials with OMP: upstream's own empty-catalog error
reads "Run `omp` to authenticate so ~/.omp credentials exist", and CEDIA
never holds provider credentials (owner-only reads, ambient store). No
credential-duplication gap on either side for OMP.

## Verdict: no switch justification

Nothing in the ACP adapter outperforms the RPC owner on CEDIA's axes: the
ACP transport buys multi-provider uniformity CEDIA explicitly rejects;
session lease/reaper semantics duplicate what the host already owns
(identity, turn intents, archive/restore); permission mapping duplicates
the OMP approval answering already surfaced. Replacing the owner would
trade 73 live-verified operations for a Beta-gated second executor with
no CEDIA-window, remote, or iPhone parity. The RPC owner stays.

## Reusable material (bounded, future slices only)

- Role-precedence documentation (global/project layers, yml/yaml order,
  first-wins, failure-stops-fallback): verify CEDIA's roles read already
  matches it through OMP's own path — a check, not a port.
- Empty-catalog error copy ("Run `omp` to authenticate…"): candidate
  wording for CEDIA's honest-absence states where a runtime is missing.
- Discovery TTL cache: considered and NOT adopted — CEDIA resolves the
  catalogue live at send (D1/item-5a honesty rule); a cache would trade a
  real staleness refusal for speed.
- ACP conformance/mock scripts: not applicable to the rpc-ui owner.

## Preserved

- D1–D5, deferred voice, `switchSession` open, single OMP
  execution/transcript/auth owner, no ACP migration, no OMP pin change.
  Pin unchanged. Nothing committed; uncommitted tree preserved
  (`git diff --check` clean).
