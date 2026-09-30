# R1 renderer boundary: host error codes did not survive Electron's IPC — 2026-09-24

This receipt records a real defect found while verifying the O04 settings surface: every typed
host refusal reached the renderer as an anonymous `Error`, so no renderer consumer could read
the code it was written to switch on. It was measured, not inferred. §10 item 70 owns status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with this and the other open slices.
- New: `apps/macos/agent-window/src/host-error-codes.ts`.
- Changed: `apps/macos/src/agent-window-main.ts`,
  `apps/macos/agent-window/src/cedia-adapter.ts`, and their tests.

## The measurement

The pinned runtime is Electron 42.10.0 (`desktop/.build/electron/version`). That exact build
was unpacked from the local download cache into a scratch directory and run against a probe app
whose `ipcMain.handle` threw `class HostHttpError extends Error` carrying `status` and `code`.
The renderer reported what it actually received:

```
PROBE_RESULT {"typed":{"isError":true,"name":"Error",
  "message":"Error invoking remote method 'probe': HostHttpError: The effective settings moved",
  "ctor":"Error","code":null,"status":null,"ownKeys":[],"allProps":["stack","message"]}, ...}
```

Only the message crosses. `name`, `code`, `status` and every own property are gone, and the
message is `Error invoking remote method '<channel>': <name>: <text>`. The probe app and its
scratch Electron were removed afterwards; the packaged application was not launched for this.

## Why that mattered

The code this transport had flattened is exactly what several renderer paths act on:
`omp_settings_stale_revision` is what lets the settings row offer `Refresh and retry` before
retrying a write, and `worktree_required` / `shared_folder_busy` / `unknown_base_ref` are what
the new-task surface reads. Those branches could never run in the real application, and the
user saw Electron's `Error invoking remote method '…'` wrapper as the text. The unit tests did
not catch it because they used a fake bridge that rejected with a property-bearing error; the
gap was in the transport between the two, which only a real Electron run exposes.

## What changed

- `apps/macos/agent-window/src/host-error-codes.ts` is the one module both halves import:
  `tagCediaHostErrorMessage(code, message)` writes the code into the message as
  `[cedia-code:<code>] <host words>`, and `readCediaHostError(message)` recovers the code and
  strips Electron's `Error invoking remote method '…': ` prefix, the error name segment and the
  tag, leaving the host's own words untouched.
- The main process tags only the application-request channel: a `HostHttpError` with a code is
  rethrown with the tagged message, and an error without a code is rethrown unchanged.
- The renderer's `adapter.request()` is the single funnel every renderer-side application
  request already passes through, so the code is restored there as a property on a
  `CediaHostError` with a clean message. An untagged error is returned as-is: no code is
  invented and no message is rewritten beyond the transport noise.

## Verification

```
bun test apps/macos/agent-window/test/host-error-codes.test.ts   # round trip + untouched error
bun test apps/macos/agent-window/test/omp-settings-adapter.test.ts
bun test apps/macos/test/agent-window-main.test.ts               # live host, tagged refusal
bun test apps/macos/agent-window/test                           # 130 pass, 0 fail
bun test packages/omp-adapter packages/relay apps/host apps/macos/test scripts/lib
                                                                 # 1102 pass, 0 fail
bun run --cwd apps/macos/agent-window typecheck                  # clean
bun run build:agent                                              # the renderer bundles the new module; assets written to dist/agent-window
git diff --check                                                 # clean
```

The round-trip test builds the main process's tagged error, wraps it in the exact Electron
message shape measured above, and asserts the decoder returns
`omp_settings_stale_revision` with `The effective settings moved…` and no transport noise. The
handler test drives the real loopback host through `createAgentWindowHandler` and asserts a
missing project rejects with `[cedia-code:not_found] Project not found`.

## Not done here

- Only the application-request channel is tagged. Other `kind`s (`uiDraft`, panels, the shared
  draft bridge) keep today's behaviour; the slices that use them already translate typed host
  errors into data in the main process (`{ status: "conflict" }` and similar), which is the
  other valid shape for this boundary.
