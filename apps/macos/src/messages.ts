/** Native actions the extension exposes as commands (item 63a keeps this half).
 *
 * The task-shell message union (`WebviewMessage` + `parseWebviewMessage`) is deleted
 * with the hand-drawn shell — the dock renders the shared bundle through
 * CediaIdeAgentProvider now, and the bridge contract owns those kinds. This module
 * keeps only the `NativeAction` discriminant the command handlers still take.
 */

export type NativeAction = "files" | "diff" | "terminal" | "settings" | "browser" | "preview" | "artifacts" | "pair" | "devices" | "host_settings";
