# O06 stale slash selection and extension reload boundary — 2026-09-28

## Result

This slice closes stale selected-command dispatch and live command-catalog projection. It does not
implement TypeScript extension hot add/remove. The pinned OMP runtime still constructs one
`ExtensionRunner` from the startup-loaded extension set; `/reload-plugins` refreshes
discovery-backed commands and does not replace that runner or detach its registered tools and
event handlers. O06/F remains open for the same-session extension lifecycle.

## Implemented behavior

- The host maintains the per-session catalog from OMP `available_commands_update` frames and exposes
  it as `cediaSlashCommands` on the shared task snapshot. The typed optional field is part of the
  `OrchestrationThread` contract.
- The Agent Window consumes the catalog from `orchestration.onThreadEvent`, the stream it actually
  subscribes to. It invalidates OMP command discovery on the first snapshot for a task (to reconcile
  any still-fresh query cache) and on subsequent catalog content changes. Unchanged catalog content
  does not trigger repeated invalidation.
- Selecting an OMP-native composer command carries a `cediaSelectedSlashCommand` marker with the
  turn. Manually typing slash-prefixed text does not attach the marker and remains ordinary prompt
  text.
- The host checks a marked selection against its current catalog before claiming a new durable
  command. OMP checks the selected token against the current owner-side command registries before
  expanding or starting the prompt. Unknown, mismatched, or removed selected commands are refused
  before provider dispatch. Idempotent replay of an already accepted host command retains its prior
  receipt semantics.
- A rejected composer submission keeps the selected-command marker for a retry; an accepted send
  clears it. A menu-selected command cannot enter the local queued-turn snapshot or be converted
  into a running turn's `steer`/`follow_up` RPC. Both paths fail visibly before a command RPC or
  draft reservation; ordinary slash text typed by the user keeps its existing behavior.
- The selected-command marker now belongs to the persisted shared Mac draft. The same draft
  revision carries it to the other window and survives renderer reload; changing the first slash
  token clears it. Menu insertion's synchronous prompt and marker updates coalesce in the shared
  draft bridge before its 160 ms host write. A restored or second-window send therefore retains
  the selection for host validation.

## Verification

- `bun test ./apps/host/test/service.test.ts -t "stale selected slash command"`: passed; rejection
  happens before a durable prompt receipt, while an unmarked literal slash prompt remains dispatchable.
- `bun test ./apps/macos/agent-window/test/omp-slash-dispatch.test.ts`: passed; selected metadata is
  forwarded, literal slash text remains unmarked, and running-turn dispatch is refused rather than
  downgraded to model text.
- `bun test ./apps/macos/agent-window/test/selected-slash-provenance.test.ts ./apps/macos/agent-window/test/omp-slash-dispatch.test.ts`:
  passed (8 tests); rejection/retry, local queue refusal, and manual-slash boundaries are pinned.
- After draft-owned provenance landed, `bun test apps/macos/agent-window/test/shared-ui-draft.test.ts apps/macos/agent-window/test/selected-slash-provenance.test.ts apps/macos/agent-window/test/omp-slash-dispatch.test.ts`:
  passed (18 tests, 67 assertions), including host-revision serialization and fresh-renderer
  hydration of the marked draft. Root reran `bun run typecheck`, `bun run check:repo`, and
  `git diff --check`; all passed.
- `bun test ./apps/macos/agent-window/test/adapter.test.ts -t "projects pushed command catalogs"`:
  passed; the subscribed `onThreadEvent` receives both the added catalog and the later removal.
- `bun run --cwd apps/macos/agent-window typecheck`: passed for the main and vendored TypeScript
  projects.
- `bun run --cwd upstream/omp/packages/coding-agent check:types`: passed.
- `bun test ./upstream/omp/packages/coding-agent/test/agent-session-prompt-dispatch-race.test.ts ./upstream/omp/packages/coding-agent/test/rpc-skill-command.test.ts ./upstream/omp/packages/coding-agent/test/agent-session-configured-extensions.test.ts`:
  passed (15 tests; exact paths run from the `upstream/omp` checkout).

Final pinned-runtime evidence after patch refresh and preparation:

- Source revision: `00085d4e7dfdcfbf302c122fa2682b410a0f43d1`.
- Source tree: `e344dee590d1a5f945fcfc6147d869fe6b891172`.
- Patch SHA-256: `0fc8d8331544d63b4d2f13d68a377732c48a6c768b4c6bb07b00c53644107af8`.
- Patch manifest SHA-256: `6695a01357a97f2db68f6c57e7f12a10d51498bc7c3cec37bad6b7061620aaf1`.
- Development launcher SHA-256: `f78a41a46ca6f76240f4e0c6c07dcc9b6537823babbe97cc5872cdc435a1c107`.
- Native addon SHA-256: `05774ec09950a150b7c1cce63359bd26ed6d3eecc44a6261e09e9403371e7869`.
- `bun run check:repo`: passed (`CI-OK`, 818 doc links).
- `bun run check:omp-coverage`: passed (1,041 audited records mapped; zero fatal issues).
- `bun run prepare:omp` and `attestOmpRuntime`: passed, `sourceVerified: true`.
- `git diff --check`: passed.

Do not interpret a file-backed command reload or a stable startup extension as proof of TypeScript
runner teardown/rebuild. No provider request was needed for these checks.

## Remaining lifecycle work

Hot add/remove requires an OMP-owned transactional extension lifecycle that validates a candidate,
quiesces and tears down the old runner and its captured registrations, rebuilds dependent tool/event
bindings, and publishes the new command catalog only after commit. Failed candidate setup must retain
the old usable state. This work is separate from rejecting stale selections.

The draft-owned marker covers reload and the shared-window path in the fixture tests above. A
packaged two-renderer interleave has not yet been captured; D/F runtime acceptance remains open.

No commit, push, package, Keychain, signing, relay deployment, paid service or device action was
performed for this receipt.
