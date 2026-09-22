/** One bridge contract for the agent surface in both windows (item 63b).
 *
 * The channel string, the envelope, and the request-kind union used to live in
 * three places — `agent-window-main.ts` (handler), `agent-ide-webview.ts` (dock)
 * and the bundle's per-file `CEDIA_AGENT_CHANNEL` constants — with no test
 * asserting they agree. This module is the single import: the main-process
 * handler, the IDE dock provider, and the bundle all reference these names, and
 * `bridge-contract.test.ts` asserts the two kind sets (handler cases vs bundle
 * sends) stay equal.
 */

export const AGENT_WINDOW_CHANNEL = "vscode:cediaAgent";

/** Every `input.kind` the main-process handler accepts. */
export const BRIDGE_REQUEST_KINDS = [
	"panel",
	"bootstrap",
	"theme",
	"request",
	"pickFolder",
	"openIde",
	"uiDraft",
	"openExternal",
	"getZoomFactor",
	"zoom",
	"keybindings",
	"activeSession",
] as const;

export type BridgeRequestKind = (typeof BRIDGE_REQUEST_KINDS)[number];

const BRIDGE_KINDS: Readonly<Record<string, true>> = Object.fromEntries(
	BRIDGE_REQUEST_KINDS.map(kind => [kind, true as const]),
);

export function isBridgeRequestKind(value: unknown): value is BridgeRequestKind {
	return typeof value === "string" && Boolean(BRIDGE_KINDS[value]);
}

/** Every `input.kind` the bundle (agent window + IDE dock) sends. */
export const BUNDLE_SEND_KINDS = [
	"bootstrap",
	"activeSession",
	"request",
	"panel",
	"pickFolder",
	"uiDraft",
	"openIde",
	"openExternal",
	"getZoomFactor",
	"zoom",
	"keybindings",
	"theme",
] as const;

export type BundleSendKind = (typeof BUNDLE_SEND_KINDS)[number];
