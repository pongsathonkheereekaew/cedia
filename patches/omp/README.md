# Cedia OMP runtime patch

Baseline: OMP 18.4.3, revision in `manifest.json` (floor 18.1.18), original MIT notice retained in `docs/upstream-notices/omp-LICENSE.txt`. The `0001` patch is the frozen 18.1.18 record; `0002` is the active rebased patch the manifest selects for the pinned revision.

The consolidated patch keeps the OMP harness and native tools in OMP. It adds opt-in virtual TUI transport and a structured native permission ClientBridge. Stock behavior remains selected when the corresponding environment flags are absent.

Run `bun scripts/prepare-omp-runtime.ts` to verify/apply the patch and prepare `dist/omp/omp`. This is a development launcher using the pinned source checkout, Bun, and the installed version-specific native addon; it is not a signed standalone release binary. The command fails if the pin or patch hash differs or local source cannot accept/recognize the patch. It does not replace the globally installed OMP binary.

`CEDIA_OMP_PATH=<absolute dist/omp/omp>` selects this runtime for a new Cedia host process. `CEDIA_RPC_VIRTUAL_UI=1` enables virtual TUI negotiation; `CEDIA_RPC_NATIVE_BRIDGE=1` enables the permission bridge. Existing host processes keep their current runtime until stopped and restarted deliberately.

The permission bridge preserves OMP's explicit auto-approve settings and typed permission outcomes. It currently supplies the permission capability only. Native dirty-buffer read/write/edit parity, TUI-only command integration, and full core conformance remain separate acceptance work; this patch alone does not certify them.

## Capability contract (plan §8.2 O04)

The runtime advertises `cediaCapabilitiesVersion: 1` in its ready frame and answers two
operations. Both ship unconditionally and stay inert unless a client uses them:

- `cedia_get_capabilities` answers the runtime's own descriptor table plus the
  `capabilityRevision` that identifies exactly that table. A descriptor says which plan family
  it belongs to, its scope and apply policy, the surfaces it serves, its principal, and the OMP
  source module that owns the behaviour. `state` is the honest three-way answer: `available`
  means a registered handler really runs it, while `dependency_unavailable` and
  `integration_missing` carry the reason it does not.
- `cedia_control` runs one operation by id. The id is looked up in the static table in
  `packages/coding-agent/src/modes/rpc/cedia-capability-bridge.ts`, so a payload can never name
  JavaScript, an executable or source text: an unknown operation is refused before any handler
  runs, and each registered operation validates its own payload (in this generation every one of
  them is a read that takes none). A caller that names a `capabilityRevision` other than the live
  one is refused rather than silently refreshed.

Two of the registered operations cover OMP's settings schema: `settings.keys.list` answers the
schema's own inventory — path, type, credential marker, UI presence and tab, whether a path
can be written into a project layer (only `modelRoles` can; every other path is a global-layer
value), and, for an `enum` path, the values that same schema accepts — and never a value; `settings.get` reads one effective value with `configured` saying
whether a layer set it or the schema default is in effect. A path the schema does not define is
refused before any handler runs, and a path the runtime marks as a credential answers its state
with `redacted: true` and no value, the same rule native `omp config` listing follows. A value too
large to hand a client is refused with `tooLarge` rather than sent truncated.

The registered operations delegate to the same projections the direct `cedia_*` commands answer
with, and the table cannot advertise an operation that has no handler: the ready check and the
dispatcher read one list. Authorization is not decided here - this runtime has exactly one
transport client - so a descriptor declares its `principal` and the embedding host, which knows
whether a caller is the owner or a controller, enforces it.

`packages/coding-agent/test/cedia-capability-bridge.test.ts` pins the table, the payload and
revision refusals; `packages/omp-adapter/test/cedia-capabilities.test.ts` proves the same
contract against the prepared runtime; `scripts/omp-capabilities-smoke.ts` proves the host path
end to end with no provider traffic.

## Turn bridge (plan §2.4)

The turn bridge is always advertised (`cediaTurnBridgeVersion` in the ready frame) and is inert
unless a client uses it, so stock behavior is unchanged:

- `prompt`, `steer`, `follow_up` and `abort_and_prompt` accept an optional `cediaIntentId`. The
  identity is carried on the user message (so it is persisted with the session) and the session
  adopts the submission that starts a run, steering before follow-ups, exactly as its own queue
  drains.
- `agent_start`, `turn_start`, `turn_end` and `agent_end` name that submission as
  `cediaIntentId`. A client that never names a turn sees the same frames it saw before.
- `cedia_turn_queue` answers `{ current?: { intentId? }, queued: [{ intentId?, kind, position }] }`
  — which submission is running and which are waiting, in OMP's own drain order, with the
  identities a client supplied. Entries are listed even when unnamed, so positions stay truthful.

- `cedia_pending_model` takes `{ revision, provider?, modelId?, thinkingLevel? }`, validates the
  selection immediately, holds it, and reports the revision as `pending` in `cedia_turn_queue`
  until OMP commits it at its next dequeue/start boundary; `applied` then names the committed
  revision and the model, or the reason it could not be committed. The ordinary `set_model`
  keeps its existing immediate meaning, so a client that never sends a revision is unaffected.
  The commit happens inside the session's awaited `beforeQueuedMessageDequeue` hook and at the
  top of `prompt()` - the agent does not await its listeners, so adopting a change at
  `turn_start` could race the turn's own model request.

`scripts/omp-turn-bridge-smoke.ts` proves all of that against this runtime with a local model
endpoint that never answers: no provider request leaves the machine and each run ends with an
explicit abort. The bridge reports what OMP did; it does not authorize anything by itself.
