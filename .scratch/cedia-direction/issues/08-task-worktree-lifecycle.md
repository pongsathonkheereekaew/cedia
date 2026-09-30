# Define isolated task workspaces and result integration

Parent: [Choose a coherent Synara-based OMP workspace](../../../docs/maintenance/CEDIA-PLAN.md#wayfinder-map-choose-a-coherent-synara-based-omp-workspace)
Label: wayfinder:grilling
Type: grilling
Status: resolved
Assignee: current owner conversation (Codex)
Blocked by: none

## Question

For tasks with separate Git worktrees, what are the starting revision, treatment of local
uncommitted edits, review/commit/integration behavior, and archive/cleanup lifecycle? How
should explicit IDE handoff preserve the selected task's project/worktree identity and
handle unsaved editor work? Define non-Git behavior separately rather than pretending
worktrees apply to every folder.

## Comments

### Confirmed interview decisions — round 3, 2026-09-23

- The owner chose 8A: concurrent tasks in one Git repository get separate worktrees, so
  each task edits its own files and changes can be integrated later. This settles workspace
  isolation, not starting-branch selection, automatic commits, merging, pushing, or cleanup.
- The owner chose 9B: switching the selected AI task leaves the IDE on its current work.
  An explicit Open in IDE action takes the IDE to the requested task's project/worktree.
  Merely inspecting another task must not retarget the IDE or disrupt current code work.

Worktree creation details and integration remain design questions. This interview does
not authorize creating worktrees or changing the current checkout.

### Confirmed interview decisions — round 4, 2026-09-23

The owner answered 10A, 11A, 12B:

- New Git tasks default to the project's configured primary branch, such as `main`.
  The user can choose a different starting branch before execution. The selected commit
  and worktree must be attributable to the task; fetching or pulling is not implicitly
  authorized by this default. Treatment of uncommitted edits is still a separate question.
- On completion, present the result summary and diff for review. Commit, merge, and push
  are explicit user actions or follow an explicit instruction for that particular task;
  they are not automatic consequences of a successful agent turn or passing checks.
- Archiving permits automatic cleanup of a task's worktree only after its changes are
  integrated and no outstanding edited/new files remain. Retain conversation history and
  the task's result record. Unintegrated or dirty worktrees remain available.

These are product behavior decisions, not permission to mutate the present checkout.
Concrete cleanup checks must account for active tasks, open IDE work, unsaved buffers,
and files Git does not report by default; the word clean alone is not proof of no user data.
Branch deletion and restore after cleanup remain open. Non-Git behavior is settled below.

### Confirmed interview decisions — round 5, 2026-09-23

The owner answered 13A, 14A, 15A:

- New tasks normally start from the chosen branch's commit. Offer an explicit option to
  bring current uncommitted changes, with selection of the files to copy into the new
  worktree. Preserve the source files; do not silently move, commit, or include those edits.
  Any patch/copy conflict must be visible rather than silently dropping requested changes.
- Before an explicit IDE workspace switch would displace unsaved files, present
  Save / Discard / Cancel. Cancel preserves the current workspace. Editor Auto Save policy
  remains a separate setting; the handoff must not silently discard buffers.
- Non-Git folders are supported directly and clearly identify that worktree isolation is
  unavailable. Permit only one CEDIA file-mutating task at a time for that folder; do not
  silently initialize Git or pretend a separate worktree exists. This is CEDIA task
  coordination, not a claim of exclusive access against external applications.

### Confirmed interview decisions — round 11, 2026-09-23

The owner answered A, A, A to questions 31, 32, 33:

- IDE files default to explicit Save (Command-S); Auto Save remains an optional setting.
  Agent edits must not silently discard the user's unsaved buffer. The precise conflict
  interaction still needs definition; this choice does not establish a file-write lock.
- Completed work presents a summary and Review action in chat. An explicit Review opens
  the diff in the IDE for that task, respecting the existing Save / Discard / Cancel
  workspace-switch rule. Completion alone does not retarget or steal focus from the IDE.
- Terminal-created OMP sessions may continue in their original directory even when it is
  not an isolated worktree. Clearly mark the shared-directory condition and prevent CEDIA
  from starting another file-mutating task in that same directory concurrently. Do not
  silently move the session, create a replacement worktree, or duplicate its execution
  owner. This is an exception for continuity of existing sessions, not a reversal of
  separate worktrees for new concurrent Git tasks created through CEDIA.

External terminal tools can still modify shared files; CEDIA's coordination does not
establish a machine-wide filesystem lock. Running CLI attachment and ownership transfer
remain capability-verification work under the acceptance decision.

### Confirmed interview decisions — round 15, 2026-09-23

The owner answered A, A, A to questions 43, 44, 45:

- Keep the task branch when eligible Archive cleanup removes its worktree. Branch deletion
  requires a separate explicit action; retained branches need not clutter the active task UI.
- Continue on an archived task restores a workspace from that task's last recorded revision
  and continues the original conversation. Do not silently substitute the current primary
  branch. Offer starting a new task separately. Keep the recorded revision recoverable rather
  than relying only on a mutable branch name; if the required data is unavailable, report
  that limitation instead of claiming restoration. This restores saved workspace data, not
  previously running processes or discarded/unrecorded state.
- Archive is unavailable while the task is running. The owner must wait for completion or
  explicitly stop it before archiving. Archive does not implicitly stop or hide running work.

The original cleanup prerequisites still apply: integrated changes, no outstanding files,
no active execution or terminal use of that worktree, and no displaced unsaved IDE work.
Restoration and cleanup require implementation evidence. The outstanding user-facing
unsaved-buffer conflict interaction remains part of the workspace decision.

### Resolution — round 16, 2026-09-23

The owner chose 46A: when the user's unsaved buffer conflicts with an AI-modified disk
file, preserve both versions and present a comparison for explicit selection or manual
integration. Do not automatically merge, overwrite either version, or silently save.

Together with the recorded choices above, this resolves the intended task/worktree,
IDE handoff, review, archive, and restore behavior. The application-base and acceptance
decisions consume this contract; implementation feasibility and runtime verification are
still required and are not claimed by resolving this interview ticket.
