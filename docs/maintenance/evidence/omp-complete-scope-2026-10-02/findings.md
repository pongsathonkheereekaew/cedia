# OMP 18.4.8 audit regen — 2026-10-02

Dated planning inventory for the live pin. CEDIA-PLAN.md is the only product
specification; §2.8 defines scope, §8.2 defines the implementation packets and
§10 owns unfinished work. No deployment, model request or runtime acceptance
was performed by this regen (unit and live-fixture settings proofs live with
the settings work, not here).

## Source identity

- OMP 18.4.8 base: `717f97f4d22b3d65c4a4eef6a744255d46f4d1a6`.
- Manifest patch: `patches/omp/0003-cedia-rpc-bridges-18.4.8.patch`,
  SHA-256 `897510ed8c30406c869f82024d5da4e55e4f0eafbb72a2b9a4e5f3dac2efcad9`.
- Regenerated from the previous dated audit with
  `scripts/regen-omp-audit-1848.ts` (same method as the 18.4.3 regen, carried
  forward row-for-row; only genuinely new source records gain rows).
- `verify.py` passes: 1,117 planning mappings, 23 source hashes, all exact.

## Delta since 2026-09-29 (18.4.3 → 18.4.8)

Upstream evolution, not Cedia changes. Nothing was removed.

- Settings +6 (522 total): `modelPresets`, `display.subagentLivePreview`,
  `input.bareExitOnEmptySession`, `input.bareSlashCommands`, `ratchet.enabled`,
  `browser.tern`. Families follow their TUI areas (models, appearance,
  interaction, tools-and-extensions).
- Slash +2 (84 total): `/ratchet` (unattended eval hillclimb, O07) and
  `/modelpreset` (role-model preset save/switch, O03, with list/save/switch/
  delete subcommands). Both have text/ACP handlers, so they ride the prompt
  path like every reachable command.
- RPC +3 (64 total): `remove_queued_message` and `promote_queued_message`
  (targeted queue surgery, O01) and `set_cache_warming` (transient warming
  override, O03). CLI, launch flags, tools, SDK, events, host frames and
  extension UI methods are unchanged.
- Coverage rows 1,101 → 1,117. New rows carry `implementationVerified: false`;
  mapping to Cedia dispositions happens in the coverage gate, not here.

## Cedia patch content at this pin

The manifest patch adds the settings service used by the Settings
destination: `settings.keys.describe`, `settings.unset`, `settings.mutate`
and `settings.reset.preview` operations, schema metadata (label, help,
default, env), provenance and stored-versus-effective reads, global and
project scopes, and the taskless `CEDIA_SETTINGS_SERVICE` entry. These are
`cedia_control` operations, not `RpcCommand` members, so the RPC inventory
above is unaffected by them.

## What this does not claim

- New coverage rows are inventoried, not implemented: `ratchet` and
  `modelpreset` execute through the prompt path but have no dedicated Cedia
  panels; `remove/promote_queued_message` need the queue surface to address
  single rows (queued under item 70); `set_cache_warming` is served
  persistently through the `providers.cacheWarming` setting.
- `verify.py` checks source names and hashes plus mapping completeness. It is
  not the handler/renderer/runtime coverage the O12 packet requires.
