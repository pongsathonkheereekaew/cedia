# Choose the audience, upstream feature scope, and release policy

Parent: [Choose a coherent Synara-based OMP workspace](../../../docs/maintenance/CEDIA-PLAN.md#wayfinder-map-choose-a-coherent-synara-based-omp-workspace)
Label: wayfinder:grilling
Type: grilling
Status: resolved
Assignee: current owner conversation (Codex)
Blocked by: none

## Question

Is CEDIA for personal use or distribution, should applicable Synara feature coverage include
future upstream features, and should stable use wait until integration is ready before
adopting an upstream update or enabling a feature?

## Comments

The owner answered the first breadth-first interview round with 1A, 2B, 3A on 2026-09-23,
and clarified that features should be opened or added only once support is ready.

### Resolution — 2026-09-23

- Audience: personal use first. Public distribution is not an initial requirement.
- Feature scope: follow every Synara feature that is applicable to the OMP-only product,
  including future upstream features. This is not limited to a handpicked subset of the
  current UI; it also does not authorize other harnesses or promise automatic feature parity.
- Release policy: retain the working version until the new integration is supported and
  verified, then adopt the update or enable/add the feature. Do not break working OMP/IDE
  behavior merely to match upstream's latest version. No parallel experimental release
  channel was selected as the daily-use policy.

The exact readiness checks and whether pending features appear as disabled placeholders
remain separate acceptance/settings decisions. This answer does not authorize installing,
publishing, or switching the application base.


### Update installation clarification — 2026-09-23

The owner chose notification plus explicit manual installation of a validated CEDIA update
in the recovery/update/terminal round. Plan §8 owns this policy; it does not reopen the
accepted pin/test/defer upstream policy or authorize an update in this planning session.
