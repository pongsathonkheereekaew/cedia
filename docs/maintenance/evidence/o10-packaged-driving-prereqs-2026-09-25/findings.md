# Recon (O10 packaged Electron driving: exact prerequisites, not attempted)

Driving a real tab needs the packaged app rebuilt from this tree, then Electron
launch + IPC attach + puppeteer against the real debugger. Checked, not run:

1. `--package` refuses a tampered checkout: `readPatchSet` re-verifies every patch
   sha256, and the desktop set is mid-flight by another slice (modified
   `patches/desktop/manifest.json` + `README.md`, plus unmanifested new
   `0060/0061/0062-*.patch`). Packaging now would fail the integrity gate or ship
   half-done patches into the shared `Cedia.app`. Untouched for that reason.
2. The render break (`window-transcript-render-2026-09-25`) still stands — suspect
   files unchanged — so even a packaged run could not yet observe an OMP-driven turn.
3. Free-tier model still silent (7th consecutive zero-frame turn, plain prompt):
   model-driven verification stays unavailable; no further quota burned.
4. What IS ready: per-thread endpoint + attach/detach/status wired to the real
   `webContents.debugger` path (fixture-proven), puppeteer-compat proven against
   OMP's own client, steering + guard + precedence warnings in the bundle.

When the patch set settles and the render break reconciles, the remaining steps are:
`build-cedia.ts --package`, launch, attach a visible tab, drive it with upstream
puppeteer-core through the served endpoint. No gap change claimed here.
