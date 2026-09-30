# Choose the AI and IDE window arrangement

Parent: [Choose a coherent Synara-based OMP workspace](../../../docs/maintenance/CEDIA-PLAN.md#wayfinder-map-choose-a-coherent-synara-based-omp-workspace)
Label: wayfinder:grilling
Type: grilling
Status: resolved
Assignee: current owner conversation (Codex)
Blocked by: 04-editor-boundary.md

## Question

For the confirmed full-IDE requirement, should the primary AI workspace and IDE occupy
two windows of one CEDIA application, or must they share a single window with switchable
or split views? Detailed task/project/worktree handoff acceptance belongs to
[Define complete OMP support and same-task remote control](03-acceptance-boundary.md).

The choice concerns product experience, not a requirement to rewrite an editor. OMP stays
the sole harness. A separate independently configured editor application has not been accepted
as satisfying integrated IDE support. Compare the existing two-window Code-OSS foundation
with the additional shell and layout work a single-window experience may require.

## Comments

Opened after the owner explicitly selected full IDE capabilities. The existing build's
two-window structure is evidence of a reusable path, not a decision for the new direction.

### Resolution — 2026-09-23

The owner explicitly chose **one application with two windows, with a workflow like Cursor**.
The AI workspace is primary; the second window provides the full IDE capabilities already
chosen in the editing-boundary ticket. Launching a separately configured editor application
does not fulfill this selected product shape.

Cursor is the workflow reference for the window arrangement. This answer does not reinstate
Cursor visual parity: the previously stated Synara-led appearance and complete application
experience remain the desired direction. OMP remains the sole harness; model/provider
selection stays within OMP.

This resolves the window arrangement only. The application-base ticket still evaluates how
to integrate Synara's application capabilities, the full IDE, and OMP while managing upstream
updates. Exact cross-window state and remote-control acceptance remain to be specified.
