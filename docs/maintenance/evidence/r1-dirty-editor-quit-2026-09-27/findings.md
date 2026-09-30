# Packaged dirty-editor Quit wiring — 2026-09-27

This is a D lifecycle implementation slice under CEDIA-PLAN §10 item 70. It does not accept D/W/N/F.

## Change

- Code-OSS publishes `IWorkingCopyService.dirtyWorkingCopies.length` from each IDE workbench renderer on initial load and dirty-state changes. The IPC payload is a count only; no file name or content crosses the boundary.
- The CEDIA main process accepts the count only from a registered non-Agents workbench main frame, aggregates by WebContents, and removes a sender's value when it is destroyed. If an older Code-OSS build does not supply the trusted-sender predicate, the reader ignores all dirty-count IPC.
- The pre-Quit lifecycle reads that aggregate, so the existing Stop-and-Quit/Cancel decision can include unsaved IDE work. The workbench remains the owner of Save/Don't Save/Cancel on window close.
- Desktop patch `0063-cedia-dirty-editor-count.patch` and its manifest hash carry the Code-OSS half. The pinned OMP runtime is unchanged.
- The packaged Send-race driver now selects its pre-registered task rather than creating an unbound draft, so Open in IDE targets the scratch project. This corrects the proof driver only; its IDE dock was still restricted/blank and the simultaneous two-renderer race remains unproven.

## Verification at this revision

- Source revision: `0676dd70d54e429b5a72c98cb3f22a646bbd10eb` with an intentionally dirty worktree. No commit, push or reset.
- `bun test apps/macos/test/app-lifecycle.test.ts apps/macos/test/desktop-patch-set.test.ts`: 29 pass, 0 fail, including a red-then-green test that untrusted IPC is ignored when the main-process sender predicate is absent.
- Desktop client typecheck and patch-set application/drift check passed. `git diff --check` passed.
- `bun scripts/prepare-desktop.ts` applied 19 patches. The pinned `vscode-darwin-arm64-min` build completed, then `CEDIA_HOST_NODE=... bun run package:mac` completed. `bun run check:packaged` passed: packaged at 2026-09-27T05:15:26.175Z, patch digest `e1901f7eb472…`, 19 patches, all shell and asset hashes matched.
- `bun run smoke:lifecycle-packaged` passed on isolated scratch state: three boots, graceful quit with no surviving scratch app/host process, relaunch and SIGKILL adoption. It does not create an unsaved IDE buffer.
- `bun run check:omp-coverage --require-complete` still fails only on O02 `switchSession`; integrity passes at 1,041/1,041 mappings.

## Remaining runtime gate

An attempted packaged proof of the actual dirty-buffer count did not reach its IDE window: Playwright's Electron attach returned zero windows and `firstWindow()` closed. A direct scratch Cedia launch stayed alive, so this is an automation/window-discovery failure, not evidence for or against the new IPC path. The temporary probe was removed and its owned process was stopped. A packaged IDE edit followed by the actual pre-Quit dialog and Cancel is still required. The two-renderer simultaneous Send race and an answering-model approval/`confirm` click also remain open. Login/background launch, real-state crash/adoption and paired-client repeats retain their separate gates.
