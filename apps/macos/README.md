# Cedia Mac integration

This package contains the Code-OSS extension and main-process bridges plus the
Synara-derived agent bundle. The standalone Agents window and compact IDE Agent Chat
use that shared bundle and the CEDIA host adapter. See the authoritative
[architecture and direction review](../../docs/maintenance/CEDIA-PLAN.md) for ownership,
retirement of the older task webview, and unverified integration work.

OMP owns execution and conversation history; the CEDIA host manages its application
lifecycle and transport. The UI does not hold provider credentials or execute arbitrary
webview-supplied commands. File, diff, terminal, and settings actions use their registered
extension or main-process bridges. Commands keep their original IDs across reconnect and an unknown
outcome is shown for explicit reconciliation instead of being replayed.

Run the package checks from the repo root:

```sh
bun test apps/macos/test
bunx tsc --noEmit -p apps/macos/tsconfig.json
```

The extension build supplies the VS Code SDK and bundles `src/extension.ts`;
the repository can still typecheck the pure API, reducer, message, and bridge
modules without VS Code installed. Package checks are not packaged-window evidence.
