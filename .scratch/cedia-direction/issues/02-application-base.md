# Choose the application base and an upstream strategy

Parent: [Choose a coherent Synara-based OMP workspace](../../../docs/maintenance/CEDIA-PLAN.md#wayfinder-map-choose-a-coherent-synara-based-omp-workspace)
Label: wayfinder:grilling
Type: grilling
Status: claimed
Assignee: current owner conversation (Codex)
Blocked by: 01-upstream-readiness.md, 03-acceptance-boundary.md, 04-editor-boundary.md, 05-window-arrangement.md, 06-branding-settings-boundary.md, 07-audience-upstream-policy.md

## Question

Given OMP as the sole-harness requirement, Synara's complete application experience as the desired
main workspace, same-task remote control, and a full IDE in a second window of the same app,
should CEDIA retain its current Code-OSS base, adopt Synara with a bounded OMP integration,
or wait for upstream? What maintenance burden and temporary gaps will the owner accept?

Compare actual verified availability and integration ownership. Do not assume that the
existence of an ACP provider makes every OMP feature available or that a roadmap promises
a release date. A separate Synara-plus-Zed installation does not satisfy the selected
one-application/two-window product shape. No replacement is authorized by this ticket.

## Comments

- Correction from the owner's explicit latest answer on 2026-09-23: full IDE capabilities
  are required, including language services, debugging, and an extension ecosystem. A basic
  in-app file editor does not satisfy this requirement. Evaluate retaining the existing
  Code-OSS workbench as well as the integration cost of adding a full IDE to a Synara base.
  Account for updates to both application and IDE dependencies; a narrow Synara fork alone
  is not established as sufficient. No automatic upstream feature parity is promised.
- The owner subsequently selected one application with two windows and a Cursor-like
  workflow. Retaining the existing Code-OSS window foundation is now a directly relevant
  option; this does not by itself choose the application-services or OMP transport boundary.

This is a human-in-the-loop decision. Research can inform it but cannot resolve it on the
owner's behalf. Implementation and migration are outside this ticket.

### Candidate direction for owner review — after interview round 16

The behavior interview now supports comparing three directions, without yet resolving the
remaining acceptance and settings prerequisites:

- Retain the Code-OSS/Electron IDE and two-window foundation. Rework the Synara/OMP
  integration and shared settings boundary, reusing suitable upstream application behavior
  and services rather than treating renderer-only API stubs as complete feature support.
  Select one owner per application responsibility and keep OMP as the sole execution owner.
  This is the recommended candidate to detail and validate first, not a promise that the
  current adapter can implement every applicable upstream feature unchanged.
- Make a full Synara fork the application base and integrate a full Code-OSS IDE into that
  product. This requires proof of window/process/service integration; merely bundling two
  independent apps does not satisfy the selected shape. Upstream compatibility is not automatic.
- Defer new integration work until upstream OMP/remote support is released and verified,
  retaining the current working build meanwhile. A future release still needs evaluation
  against the full IDE, native iPhone, shared settings, and single-session requirements.

Owner selection would choose which direction to detail next, not authorize implementation
or remove the need for a concrete service-ownership and capability acceptance mapping.

### Confirmed direction — question 49, 2026-09-23

The owner selected A: retain the CEDIA/Code-OSS application and two-window foundation;
redesign the Synara–OMP integration and shared settings boundary. The selected direction
preserves the goal of complete applicable Synara workflows, OMP-only execution, a full IDE,
and same-task remote control. It does not freeze the current adapter or its unsupported stubs.

This settles which direction to detail. The ticket remains open for service ownership,
integration feasibility, and upstream maintenance/acceptance mapping. The concrete boundary
proposal lives in the authoritative plan's §2.1; this ticket records the decision rationale.
The alternative full-Synara-base and wait-first paths are not the selected design direction.


### Planning consolidation draft — 2026-09-23

The owner instructed the agent to start the detailed consolidation. The concrete draft is
in the canonical plan: §2.2–§2.3 ownership/capabilities and §8 upstream intake/sequence. Existing owner answers remain
accepted; newly proposed technical boundaries/defaults await review. This record links
rationale to that single contract and does not duplicate its requirements. Tailscale is now selected and the behavior interview is complete. Concrete technical
boundaries/defaults await design review; implementation feasibility/dependency gates remain
explicit in the canonical plan. No application implementation,
deployment or current runtime acceptance is implied, and this HITL ticket is not closed merely
because the document was written.
