# Establish OMP collab capabilities for CEDIA remote control

Parent: [Choose a coherent Synara-based OMP workspace](../../../docs/maintenance/CEDIA-PLAN.md#wayfinder-map-choose-a-coherent-synara-based-omp-workspace)
Label: wayfinder:research
Type: research
Status: resolved
Assignee: omp_collab_readiness (research agent for the owner conversation)
Blocked by: none

## Question

What does OMP collab already provide for controlling the same running Mac session from a
web client or native iPhone client, and what would CEDIA still need? Verify the vendored
revision and current official upstream evidence separately, including hosting/link/auth,
guest permissions, prompt/steer/queue/abort, approvals/questions, model changes, reconnect,
and transcript ownership. Distinguish implementation from independently tested behavior.

## Comments

The owner explicitly highlighted OMP collab when selecting both web and iPhone clients.
The existing checkout contains `upstream/omp/packages/collab-web`. Do not introduce a second
execution owner or deploy a relay as part of this read-only investigation.

### Resolution — 2026-09-23

OMP collab already shares the host's running session through an encrypted relay with
full-control and view-only guests. The Mac remains the execution owner. Writable guests
can send prompts, interrupt, control exposed subagents, and answer select/editor requests.
The existing guest protocol does not provide host model changes or complete CEDIA project,
worktree, IDE, and device management. Guest prompts during streaming use steer semantics,
so collab alone does not establish the owner's separate Send/queue and Steer requirement.

Use collab as an integration candidate, not proof that the selected remote experience is
complete or a decision to replace the existing CEDIA relay. A mobile web client exists;
a dedicated iPhone client and real cellular acceptance are not established. Production
relay hosting availability and the difference between the vendored revision and current
upstream must remain explicit in the application-base decision.

Evidence: [OMP collab capabilities and limits](../../../docs/maintenance/evidence/omp-collab-research-2026-09-23/findings.md).
Local isolated tests are supporting evidence only, not packaged CEDIA or physical-device
verification. The acceptance interview continues in the parent decision ticket.
