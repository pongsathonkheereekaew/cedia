# O06 packaged reload unblock — 2026-10-01

## Result

PASS. The packaged-reload boundary recorded in
[`o06-packaged-reload-boundary-2026-10-01`](../o06-packaged-reload-boundary-2026-10-01/findings.md)
is now implemented and qualified: the host accepts an operator-only extra
`--trusted-extension` (`HostOptions.extraTrustedExtensions`, set from
`CEDIA_EXTRA_TRUSTED_EXTENSIONS`), so a packaged proof has an injectable,
reloadable extension path without touching the session-lock overlay.

Full A→B→rollback→removal on a staged scratch Cedia.app (installed app never
launched), OMP 18.4.8 standalone, zero provider calls, same OMP PID and same
host incarnation throughout, no renderer errors:

- Generation A command/provider/model load at startup through the packaged owner.
- Rewrite to B + `/reload-plugins` completes; B atomically replaces A in the
  command, provider/model and tool catalogs; baselines preserved.
- Throwing candidate surfaces as failure and the journal row carries the
  candidate error; last-good B retained without partial registration.
- Deleting the fixture file + `/reload-plugins` completes; catalog cleared,
  baselines preserved. (A placeholder comment without a factory export fails
  validation instead of unloading — removal must unlink.)
- Stale selected slash for the removed command is refused with 409 before dispatch.
- Whole sequence caused no turn or tool call.

Receipt-level vs terminal-level failure surfaced once: on the standalone
binary the candidate failure reports synchronously at receipt time, while the
dev launcher reports it as a failed terminal state. The proof accepts either
but requires the journal row to carry the candidate error, so a refused
admission cannot masquerade as a rollback.

Artifacts: `dist/packaged-reload-proof/2026-10-01T13-53-19-869Z/` (ignored
runtime dir; `result.json` + Login Item shim). Runner:
`scripts/omp-packaged-reload-proof.ts`, which now also reinstalls the current
source standalone binary, host CLI and lock extension into the staged app
(non-portable extension builds carry no `runtime/` payload).

## Limits

Packaged proof used the CEDIA host CLI over HTTP against the staged app's
bundled host; interactive standalone/ACP concurrent reload and live
shared-source provider replacement remain open per the boundary note.
