# Slice (O02 bare/missing-target `/move`: answered headless, fence removed)

Root cause, traced to the dispatcher (not assumed): RPC prompts starting with `/`
route through `executeBuiltinSlashCommand` (TUI dispatcher, `handleTui` wins) whenever
the virtual terminal is negotiated — which the Cedia host always does. Bare `/move`
therefore reached `handleMoveCommand(undefined)` → the path-autocomplete overlay
(`showHookCustom`) → waited on a TUI interaction RPC has no terminal for. With-args
skipped the overlay, which is why only the bare form hung; a missing-target form hung
one step later on the create-directory confirm overlay, and either wedge poisoned
every later prompt in the session (proven by probe ordering).

## The fix (pinned patch, TUI-untouched)

`rpc-mode.ts` prompt dispatch answers the ACP handler's own texts before the TUI
dispatcher runs, only in RPC mode: bare → `Usage: /move <path>`; unquoted-empty →
same; non-directory target → `Not a directory:` / `Directory does not exist:` after a
`stat` against the session cwd (mirroring `builtin-lifecycle.ts` line for line). A
verified existing directory still flows through and relocates. The terminal never
executes this dispatcher, so its overlay/create flows are byte-identical.

## Proof (all live, prepared runtime `omp/18.1.18`, virtual UI negotiated as the host does)

- Ordered probe in one session: bare → 0.001s usage; missing dir → 0.001s
  not-a-directory; existing dir → 0.117s relocate. No cascade, no hang, texts observed
  on `command_output` frames.
- `scripts/omp-move-smoke.ts` still green on the re-derived patch (relocation, rename
  not copy, no turn, no provider call).
- Fence removed: `HEADLESS_HANG_SLASH_COMMANDS` emptied (mechanism kept), protocol
  tests updated, `/move` back in the composer menu, move-smoke docstring corrected.

## Coverage consequence

`slash move` flips to `integrated` through the normal gate rule (reachable over rpc,
no hang entry): the prompt path is its carrier, handler cited as
`executeBuiltinSlashCommand (via --mode rpc-ui prompt)`. Gap count **2** (was 3):
O02 sdk 1 (`switchSession`, open per owner order, no retarget feature) and O10 cli 1
(`browser-relay`, unselected path). `moveSession` via with-args was already settled
and is untouched.
