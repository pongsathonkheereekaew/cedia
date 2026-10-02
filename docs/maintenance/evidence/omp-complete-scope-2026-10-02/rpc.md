# OMP RPC completeness evidence (2026-10-02)

Inspected from local `upstream/omp` at `717f97f4d22b3d65c4a4eef6a744255d46f4d1a6` plus the manifest patch. The machine-readable companion [rpc.json](./rpc.json) lists all named operations. See [findings.md](./findings.md) for the regen method.

## Inventory result

- **64** named `RpcCommand` operations (+3 since 2026-09-29, none removed):
  `remove_queued_message` and `promote_queued_message` (targeted queue surgery,
  O01) and `set_cache_warming` (transient warming override, O03).
- Extension UI methods (11), host-frame kinds (7) and session events (28):
  unchanged.

`remove/promote_queued_message` address single queued rows, which Cedia's
drop-last/all surface cannot name; they are queued as O01 queue-surface work
under item 70. `set_cache_warming` is served persistently through the audited
`providers.cacheWarming` setting, which the session consumes live.
