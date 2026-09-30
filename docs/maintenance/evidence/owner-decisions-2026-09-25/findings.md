# Owner decision register: the 13 rows only the owner can close

Thirteen coverage rows sit behind owner policy, not engineering: external services,
credential posture, transport selection, and update strategy. No slice can close them
without the owner deciding first — a reclassification without approval would be gate
greenwashing, and the plan names each one as separately qualified for exactly this
reason. This register batches the asks with a draft answer each so the owner can
approve, amend, or reject per group.

## How approval works

The owner replies naming group IDs (D1–D5) with approve/amend/reject each. On approval
the root reclassifies those rows (expected: `explicitly_excluded` with the stated
reason), re-runs the gate to verify the count moves exactly as predicted, and records
the decision here. Anything amended gets reworded first; anything rejected stays open
with its current reason. Expected effect if the whole register is approved as drafted:
gaps 35 → 22 (O08 7, O11 ssh 1, O12 5).

## D1 — public-room collaboration (7 rows)

Rows: `cli join`, `slash collab`, `slash join`, `slash leave`,
`slash-subcommand collab view/status/stop`.
Question: qualify joining/hosting public OMP rooms, or declare the product
Tailscale-only and exclude public rooms?
Draft: EXCLUDE all seven. The plan already selects Tailscale as the remote transport
(R6) and keeps loopback-owner API restrictions; public relay rooms contradict that
posture and would each need their own hostile-origin, expiry, revocation and
deduplication qualification (the R6/R7 gates). `leave` goes with the set: there is no
room to leave once rooms are out. Revisit only if a room concept arrives over the
selected transport with its own qualification.

## D2 — SSH remote access (1 row)

Rows: `cli ssh`.
Question: build SSH host configuration/access, or confirm Tailscale-only remote?
Draft: CONFIRM Tailscale-only and exclude. R6 names the gateway; a second remote
access mechanism doubles the hostile-host, key-handling and revocation surface for no
planned scenario.

## D3 — credential vault broker (1 row)

Rows: `cli auth-broker`.
Question: qualify running a credential vault service, or exclude?
Draft: EXCLUDE. OMP keeps provider auth and Cedia never copies credentials (product
auth boundaries); a vault service would centralize exactly what the boundary keeps
distributed.

## D4 — credential forward proxy (1 row)

Rows: `cli auth-gateway`.
Question: qualify forwarding credentials to remotes, or exclude?
Draft: EXCLUDE, same posture as D3: forwarding vault credentials outward contradicts
the provider-auth boundaries, and the Tailscale path authenticates devices, not
forwarded secrets.

## D5 — maintenance bundle (3 rows: share, update, tiny-models)

Rows: `cli share`, `cli update`, `cli tiny-models`.
Question per row: adopt/qualify, build, or exclude?
Draft, `share`: EXCLUDE — the plan does not adopt encrypted-external-link sharing as a
service; remote access rides Tailscale, not links.
Draft, `update`: EXCLUDE OMP's own updater permanently — it must never install
underneath a running app (safety invariant, already stated) — and record that Cedia
updates ship as full packaged releases, so no auto-update surface is owed.
Draft, `tiny-models`: EXCLUDE — local model provisioning is owned elsewhere and
unqualified; revisit only with a local-model strategy decision.

## Explicitly not in this register

- Build-gated rows (O02 slash flows and SDK without carriers, O03 roles, O06
  extensions/getters, O07 prewalk/hub/agents/loop, O10 browser/computer, O06 custom
  pattern, O02 moveSession): proceed as engineering when capacity allows; no owner
  policy blocks them.
- Hardware/network rows needing physical resources (physical iPhone, tailnet device,
  provider credentials, login/background-launch/crash receipts): need resources and
  hands, not decisions; tracked under item 70 and §11.
- `browser-relay` (O10 cli): build-gated on the O10 browser subsystem, grouped with
  the browser/computer dynamics — not an owner decision.

## Decision (2026-09-25, owner reply in thread)

- D1 APPROVE: exclude public-room/relay collaboration for this baseline; Tailscale
  session control is out of scope of the exclusion.
- D2 AMEND then approve: exclude only the `ssh` CLI verb and building SSH
  remote-access integration this round; not a blanket ban on SSH tooling.
- D3 APPROVE: exclude `auth-broker`; provider auth stays with OMP.
- D4 APPROVE: exclude `auth-gateway`; Tailscale authenticates devices, not
  forwarded secrets.
- D5 APPROVE all three: exclude `share` and `tiny-models`; forbid OMP's own
  updater from changing the pinned runtime (safety invariant); runtime updates
  ship as CEDIA packaged releases.
- O07: owner orders kill/revive/focus built as a full vertical (runtime → host →
  UI), OMP keeps owning the agent lifecycle; each command's outcome specified,
  tested-vs-provider-live-proof separated.
- switchSession: stays an open gap with its reason; no session-retarget feature;
  never counted integrated without a real usage path.

Applied: the 13 rows reclassified to `explicitly_excluded` with the decision,
date and group in each reason. Gate verified: integrity PASS, gaps 18 -> 5
(switchSession, bare move, agents, hub, browser-relay). No further questions
asked on these groups per owner instruction.
