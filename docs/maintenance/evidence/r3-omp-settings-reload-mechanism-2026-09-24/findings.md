# Omp settings: what the pinned runtime actually does when a value changes — 2026-09-24

This receipt records the mechanism behind §6.4's "show effective source/scope and
restart/reload timing". It is the evidence for the per-key classification that is still open, not
the classification itself: no key is claimed to apply at a particular moment here.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a46bbd10eb` (the pinned OMP checkout is
  `upstream/omp` at `00085d4e7dfdcfbf302c122fa2682b410a0f43d1` plus the tracked patch).
- Read-only inspection of `packages/coding-agent/src/config/settings.ts`,
  `modes/rpc/rpc-mode.ts` and `modes/rpc/cedia-capability-bridge.ts`. No source changed for this
  receipt.

## Measured facts

1. **One process-wide instance.** `Settings.init()` assigns a module-level `globalInstance` and
   loads once (`#load()`); `loadIsolated`/`loadReadOnly` exist for tooling. There is no file
   watcher: nothing re-reads `config.yml` on change.
2. **A Cedia write is live in the writing process.** `settings.set` in `rpc-mode.ts` calls
   `session.settings.set(path, value)` on that live instance and then `flush()`. `Settings.set`
   writes the value into the `#global` layer, calls `#rebuildMerged()`, queues the save, runs a
   per-path hook and fires effective-change listeners. The merged view and `#resolvedCache` are
   rebuilt immediately, so the *next* `settings.get(path)` in that process returns the new value.
3. **Reads happen when the consumer asks.** `get(path)` resolves from `#merged` (or the schema
   default) at call time. Every one of the 498 schema paths appears literally somewhere in
   `packages/**` (measured: 498/498), so no path is invisible to a call-site search.
4. **Reload is almost never automatic.** `reloadFromDisk()` has exactly one caller in the whole
   package (`session/structured-subagent.ts:268`). An edit made by another process - the native
   `omp config` CLI, or a second Cedia host - is therefore invisible to a running session until it
   reloads or restarts.
5. **OMP declares side effects for 13 keys.** `SETTING_HOOKS` has 13 entries
   (`theme.dark`, `theme.light`, `symbolPreset`, `colorBlindMode`, `tui.hyperlinks`,
   `provider.appendOnlyContext`, `providers.maxInFlightRequests`, `secrets.enabled`,
   `hindsight.bankId`, `hindsight.bankIdPrefix`, `hindsight.scoping`, `extendedContext`,
   `worktree.base`). Those are the paths where a change triggers work at the moment it is set, and
   the same table is replayed on every merged rebuild.
6. **Live-change listeners are rare.** `onEffectiveChange` has two subscribers
   (`agent-session.ts` for the eval prelude and the idle-close setting). Everything else reads
   when it needs the value.

## What this means for the open classification

A write through Cedia's own route updates the running process at once; whether the *behaviour*
changes at that moment depends on the consumer, and the four buckets §6.4 names come from three
observable properties instead of a guess:

- the path has a hook (13 keys) - work happens at the moment of the write;
- the path is read from a per-turn/use-time call site - the next turn sees it;
- the path is read while some subsystem is built (a constructor, a registry builder, session
  start) - that subsystem has to be rebuilt;
- the change came from another process and no reload ran - only a new session sees it.

A first mechanical pass over the 498 paths found 325 with only use-time read sites, 91 with at
least one read inside a constructor or init-like symbol, and 82 whose value is reached through a
computed accessor rather than a literal `.get("<path>")`. That pass is a *search*, not a
classification: the init-like hits include test files and TUI-only components that never run under
Cedia's `--mode rpc-ui`, and the computed-accessor group needs its own reading. It is recorded here
because it narrows the work, not because it proves any key's timing.

## Not done here

- No per-key `immediate`/`turn_boundary`/`reload`/`new_session` classification is claimed, and the
  `omp.settings` capability stays unqualified on that basis. §10 item 70 still names this as the
  remaining half of O04.
- The TUI-only paths (`statusLine.*`, `tui.*`, `display.*` and similar) need a deliberate answer
  about what their timing means for a headless RPC session before they can be classified.
