# Establish upstream OMP and remote-control readiness

Parent: [Choose a coherent Synara-based OMP workspace](../../../docs/maintenance/CEDIA-PLAN.md#wayfinder-map-choose-a-coherent-synara-based-omp-workspace)
Label: wayfinder:research
Type: research
Status: resolved
Assignee: synara_upstream_status (research agent for the current owner conversation)
Blocked by: none

## Question

As of 2026-09-23, what does Synara actually release or implement for OMP and for controlling
the same Mac task from a phone/another computer, and what remains a proposal or maintainer
intention without a delivery date? Distinguish provider startup from broader OMP capability
coverage and documented web access from verified approval/reconnect/mobile behavior.

## Comments

- Research started during the destination interview. Evidence will be recorded in
  [upstream findings](../../../docs/maintenance/evidence/synara-direction-research-2026-09-23/findings.md).
  No runtime or network-exposure acceptance is implied by source inspection.

### Resolution — 2026-09-23

Synara's latest observed release is v0.9.1; OMP is not landed on observed main or released.
The active proposal is [Add Oh My Pi as a first-class provider](https://github.com/Emanuele-web04/synara/pull/1166),
which supersedes the old OMP stack, reports extensive author-run desktop checks, but remains
open and conflicting. No current dated maintainer delivery commitment was found.

Remote web access, pairing, and reconnect/replay plumbing exist in upstream documentation
and source. Same-running-Mac-task control from a phone, including approvals, has not been
independently exercised here. SSH remote execution is a separate requirement.

See the linked findings for sources, observed revisions, proposed capability coverage, and
limitations. This resolves the upstream-status investigation only; it does not certify a
runtime or select an application base.
