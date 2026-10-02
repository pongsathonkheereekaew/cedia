# OMP config/CLI scope evidence (2026-10-02)

Inspected from local `upstream/omp` at `717f97f4d22b3d65c4a4eef6a744255d46f4d1a6` plus the manifest patch. The machine-readable companion [config-cli.json](./config-cli.json) is exhaustive; this note records the count and the delta only. See [findings.md](./findings.md) for the regen method.

## Inventory result

- **522** settings paths (+6 since 2026-09-29, none removed).
- **84** built-in slash commands (+2: `ratchet`, `modelpreset`), 8 aliases, 125 declared subcommands.
- **50** top-level CLI commands, 6 aliases, **66** launch flags: unchanged since 2026-09-29.

## Settings ownership and write routes (unchanged)

Precedence and routes are as recorded in the previous audit. Cedia additions at
this pin: the settings service answers schema metadata (label, help, default,
env), provenance and stored-versus-effective reads, global and project scopes,
`unset`/`mutate`/`reset.preview` operations and a taskless configuration-only
entry (`CEDIA_SETTINGS_SERVICE=1`) that loads no execution session.
