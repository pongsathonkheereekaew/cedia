# Choose the integrated editing and IDE boundary

Parent: [Choose a coherent Synara-based OMP workspace](../../../docs/maintenance/CEDIA-PLAN.md#wayfinder-map-choose-a-coherent-synara-based-omp-workspace)
Label: wayfinder:grilling
Type: grilling
Status: resolved
Assignee: current owner conversation (Codex)
Blocked by: none

## Question

Does the owner need file browsing, editing, diff review, and terminal access inside the
AI workspace, or also full IDE capabilities such as language-aware navigation/refactoring,
debugging, and an extension ecosystem? The window arrangement is tracked separately in
[Choose the AI and IDE window arrangement](05-window-arrangement.md).

The owner prefers integrated IDE support if its cost is reasonable, while AI work remains
the main surface and OMP the sole harness. Compare Synara's existing editing surface with
the additional integration and maintenance implied by a full IDE. Do not assume an embedded
editor provides a complete IDE or that a separate editor is already the chosen solution.

## Comments

This question was made explicit by the owner's follow-up. Zed is a possible external editor;
neither embedding Zed nor maintaining a Code-OSS fork has been selected.

- 2026-09-23: asked the owner to choose the required integrated editing level: file editing,
  diff, terminal and Git; language services as well; or debugging and a VS Code-level extension
  ecosystem. Awaiting that answer; no application-base decision is implied.
- Upstream's [Workspace editor and diffs](https://www.trysynara.com/docs/features/workspace-editor)
  documents an in-app editor with syntax highlighting, autosave, undo/redo, conflict handling,
  and Git/turn diff scopes. This establishes an existing editing surface to assess. It does
  not establish language-server, debugger, or extension-platform parity.

### Resolution — 2026-09-23

The owner explicitly selected a full IDE in the live conversation. Required capabilities
include language services, autocomplete, definition navigation, debugging, and an extension
ecosystem, alongside file editing, diff review, and terminals. AI remains the primary
workflow, with OMP the sole harness and model/provider changes occurring within OMP.

A basic file editor does not fulfill this requirement. The implementation base has not
been chosen; Synara's advertised file/editor surface is not evidence of full IDE parity.
The one-window versus two-window arrangement has graduated into the linked question ticket.
