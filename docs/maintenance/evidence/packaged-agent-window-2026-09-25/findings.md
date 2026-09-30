# Slice (packaged Agents window): native smoke green on the shipped artifact

A packaged verification run of the current tree — the thing almost every recent slice
leaves open as "no packaged capture". No product code changed; the artifact and its
proof are the deliverable.

## Build

- `CEDIA_HOST_NODE=/Users/pond/.caret-tools/node-v24.18.0-darwin-arm64/bin/node bun run package:mac`
  (the variable is mandatory: without it the build stops at
  `Set CEDIA_HOST_NODE to the Node 24 executable to bundle`).
- Result: `VSCode-darwin-arm64/Cedia.app`, ad-hoc signed, patch set `086d31f75d36`
  (18 patches) over upstream `ea1912fd6a05`, identity `1.138.0+ea1912fd6a05`.
- `bun run check:packaged`: every check OK (patch digest, base revision, patch count,
  sessions/workbench/native-main/extension shells, Agent Window assets, newest-patch
  freshness for `0062-cedia-quit-decision`).

## Native smoke (`bun scripts/agent-window-smoke.ts --native`)

`Agent Window UI smoke passed: dist/agent-window-native-smoke` against the packaged app:
new task, first Send creating the host session in place, transcript restore across reload,
second task preserving durable identity, `Open in IDE` handoff to the right project and
return without duplicating the window. `result.json`: `ok true`, 0 provider calls, 0
renderer errors, IDE target cwd correct, two windows after return.

Captures: `home.png`, `conversation.png`, `restored.png`, `returned-from-ide.png`. The
packaged window renders the sidebar, task transcript, composer with model picker, Shell
panel with Bash/Python toggle, and Usage/Saved-resets panels. Panels whose backend the
fixture runtime does not advertise (Plan, Progress, Advisor, Tree, Tool catalog) show
their honest absence states — the fixture OMP stub advertises no capability bridge, so
absence (not fake content) is the correct rendering there.

## Still open

Packaged captures of the newest live-backend surfaces (Tree, History, provider Accounts,
service tiers, MCP catalog rows, Shell execution) all need a session against a real
bridge-advertising runtime rather than the fixture stub; login cycle, background launch
and crash/adoption paths still have no receipt from any slice.
