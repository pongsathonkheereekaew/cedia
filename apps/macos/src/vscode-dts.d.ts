/// <reference path="../../../desktop/src/vscode-dts/vscode.d.ts" />
/// <reference path="../../../desktop/src/vscode-dts/vscode.proposed.chatParticipantAdditions.d.ts" />
/// <reference path="../../../desktop/src/vscode-dts/vscode.proposed.chatProvider.d.ts" />

/**
 * The desktop checkout owns the pinned VS Code API declarations. Keeping this
 * reference local lets the package typecheck without adding a second SDK or
 * making the control repository depend on a marketplace package.
 */
