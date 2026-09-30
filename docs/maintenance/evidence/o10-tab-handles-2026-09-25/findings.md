# Slice (O10 tab-handle contract: attach/resolve/invalidate, fixture-verified)

The Cedia half of the §8.2 O10 bridge that needs no browser, no extension, and no user
action: task-scoped opaque tab handles with the exact invalidation races the plan names.
New `apps/host/src/omp-browser-tabs.ts` (pure, no routes) plus
`apps/host/test/omp-browser-tabs.test.ts` (6 pass), typecheck clean.

## Contract (matches the selected browser owner)

- Only agent-controlled tabs attach; user-browser tabs are refused at attach time with
  `User browser tabs are never attachable; only agent-controlled tabs` — the plan's
  user/agent tab separation is enforced at issuance, not documented.
- Handles are opaque (`bt_` + 128-bit random; embed no tab id) and task-scoped: resolving
  from another task is denied with its own reason.
- Invalidation retires handles, never silently repoints them: navigation away, tab close,
  and task end each carry a distinct reason, so a stale handle fails honestly instead of
  acting on the wrong page. A later attach after navigation stays live.
- Fixture tab refs (plain `{tabId, taskId, kind, url}` objects) verify every path above;
  no WebContents, Electron, or Chrome was involved.

## Deliberately not in this slice (next steps named, not claimed)

- Binding real WebContents tabs to these handles (runtime patch op + host routes +
  adapter), driving navigate/read/interact/capture through a handle, screenshot/result
  routing, reconnect, and packaged proof against a visible tab — the §8.2 O10 remainder.
- The `browser-relay` CLI row stays open: there is still no OMP action through a handle,
  and the user's own extension install (for the relay path, if ever selected over
  Cedia-owned tabs) remains a future user action, never a silent one. No provider
  spend, no credentials, no profile changes in this slice.
