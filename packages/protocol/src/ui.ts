/**
 * Cedia's host↔client extension-UI contract.
 *
 * Wire shapes are copied from OMP v18.4.3 at
 * `packages/coding-agent/src/modes/rpc/rpc-types.ts` (pinned by
 * `upstream-lock.json`).  That RPC can send exactly four interactive methods —
 * `select`, `confirm`, `input`, `editor` — six fire-and-forget presentation
 * rows and `cancel`.  Declaring them once here is what stops the host, the Mac
 * task surface and the phone from drifting apart: an interactive request naming
 * a method outside this union is a protocol violation every client must state,
 * never a shape it guesses at and never a request it drops.  (Presentation rows
 * are notices, not questions, so a client simply does not render one it does
 * not know.)
 */

/** Positional presentation metadata for one select option. */
export interface UiSelectOptionDetail {
	readonly description?: string;
}

/** Interactive requests that require an explicit host answer. */
export interface SelectUiRequest {
	readonly id: string;
	readonly method: "select";
	readonly title: string;
	readonly options: readonly string[];
	readonly optionDetails?: readonly UiSelectOptionDetail[];
	readonly timeout?: number;
}

export interface ConfirmUiRequest {
	readonly id: string;
	readonly method: "confirm";
	readonly title: string;
	readonly message: string;
	readonly timeout?: number;
}

export interface InputUiRequest {
	readonly id: string;
	readonly method: "input";
	readonly title: string;
	readonly placeholder?: string;
	readonly timeout?: number;
}

/** OMP's editor method carries no `timeout`: it is never settled on a clock. */
export interface EditorUiRequest {
	readonly id: string;
	readonly method: "editor";
	readonly title: string;
	readonly prefill?: string;
	readonly promptStyle?: boolean;
}

/**
 * Every interactive request OMP can send.  There is no `password`,
 * `multi_select` or `schemaform` method on the wire, so a client that renders
 * one is rendering a request that cannot arrive.
 */
export type CediaUiRequest = SelectUiRequest | ConfirmUiRequest | InputUiRequest | EditorUiRequest;

export type UiInteractiveMethod = CediaUiRequest["method"];

/**
 * The interactive methods, as a lookup table rather than a list: adding a
 * member to {@link CediaUiRequest} without adding it here is a compile error.
 */
export const UI_INTERACTIVE_METHODS: Readonly<Record<UiInteractiveMethod, true>> = {
	select: true,
	confirm: true,
	input: true,
	editor: true,
};

/**
 * Whether a raw frame method names an interactive request.  Own-key lookup, so
 * an inherited property name (`toString`) is never mistaken for a method.
 */
export function isUiInteractiveMethod(method: string): method is UiInteractiveMethod {
	return Object.prototype.hasOwnProperty.call(UI_INTERACTIVE_METHODS, method) && UI_INTERACTIVE_METHODS[method as UiInteractiveMethod] === true;
}

/**
 * The presentation methods: notices a client renders without answering anything.
 *
 * Each one has a real parser in the task reducer, so a row carries the fields it
 * declares instead of arriving as an anonymous frame.  A method outside this
 * union is not a presentation Cedia knows, and saying so is what keeps an
 * unknown row from being rendered as if it had been understood.
 */
export const UI_PRESENTATION_METHODS: Readonly<Record<UiPresentationMethod, true>> = {
	notify: true,
	setStatus: true,
	setWidget: true,
	setTitle: true,
	set_editor_text: true,
	open_url: true,
};

export type UiPresentationMethod = "notify" | "setStatus" | "setWidget" | "setTitle" | "set_editor_text" | "open_url";

export function isUiPresentationMethod(method: string): method is UiPresentationMethod {
	return Object.prototype.hasOwnProperty.call(UI_PRESENTATION_METHODS, method) && UI_PRESENTATION_METHODS[method as UiPresentationMethod] === true;
}

/** How Cedia carries one extension-UI method the pinned OMP can send (§8.2 O05). */
export type UiMethodClass = "interactive" | "presentation" | "cancellation";

/**
 * Every extension-UI method, with the class that says which Cedia path carries it.
 *
 * The coverage gate reads this table instead of its own list: a method Cedia has
 * not classified is a gap, and a classification can never disagree with the
 * parsers above because adding a member here without one is a compile error.
 */
export const UI_METHOD_CLASSES: Readonly<Record<string, UiMethodClass>> = {
	...Object.fromEntries(Object.keys(UI_INTERACTIVE_METHODS).map(method => [method, "interactive" as const])),
	...Object.fromEntries(Object.keys(UI_PRESENTATION_METHODS).map(method => [method, "presentation" as const])),
	// OMP cancels an outstanding request or element by id; Cedia carries it as the host's
	// server-cancel notification, which clears the matching pending request.
	cancel: "cancellation",
};

export function uiMethodClass(method: string): UiMethodClass | undefined {
	return Object.prototype.hasOwnProperty.call(UI_METHOD_CLASSES, method) ? UI_METHOD_CLASSES[method] : undefined;
}

/**
 * The one sentence both clients show when a request names a method OMP cannot
 * send, so the Mac and the phone state the same reason instead of one of them
 * dropping the request.
 */
export function unsupportedUiMethodMessage(method: string): string {
	return `Cedia cannot show this request: the host sent unsupported method "${method}"; OMP can send ${Object.keys(UI_INTERACTIVE_METHODS).join(", ")}.`;
}

export interface UiNotifyPresentation {
	readonly id: string;
	readonly method: "notify";
	readonly message: string;
	readonly notifyType?: "info" | "warning" | "error";
}

export interface UiStatusPresentation {
	readonly id: string;
	readonly method: "setStatus";
	readonly statusKey: string;
	readonly statusText?: string;
}

export interface UiWidgetPresentation {
	readonly id: string;
	readonly method: "setWidget";
	readonly widgetKey: string;
	readonly widgetLines?: readonly string[];
	readonly widgetPlacement?: "aboveEditor" | "belowEditor";
}

export interface UiTitlePresentation {
	readonly id: string;
	readonly method: "setTitle";
	readonly title: string;
}

export interface UiEditorTextPresentation {
	readonly id: string;
	readonly method: "set_editor_text";
	readonly text: string;
}

export interface UiOpenUrlPresentation {
	readonly id: string;
	readonly method: "open_url";
	readonly url: string;
	readonly launchUrl?: string;
	readonly instructions?: string;
}

/** Presentation rows are fire-and-forget; they never receive a response. */
export type CediaUiPresentationRequest =
	| UiNotifyPresentation
	| UiStatusPresentation
	| UiWidgetPresentation
	| UiTitlePresentation
	| UiEditorTextPresentation
	| UiOpenUrlPresentation;

/** One live interactive request, as the host records it into a `cedia_ui` frame. */
export interface UiInteractiveEvent {
	readonly kind: "interactive";
	/** Opaque token supplied to `respond`/`cancel`, never the upstream id. */
	readonly token: string;
	readonly request: CediaUiRequest;
}

export interface UiPresentationEvent {
	readonly kind: "presentation";
	readonly request: CediaUiPresentationRequest;
}

/** Settled states a client can hold for a request it has not answered. */
export type PendingUiStatus = "pending" | "stale" | "timeout" | "responded_elsewhere" | "cancelled" | "approved" | "denied";

/** One unanswered request, as the host serves it and both clients hold it. */
export interface PendingUiRequest extends UiInteractiveEvent {
	readonly sessionId?: string;
	readonly incarnation?: string;
	readonly cwd?: string;
	readonly tool?: string;
	readonly target?: string;
	readonly status?: PendingUiStatus;
	readonly receivedAt?: number;
}

/**
 * Parsing one raw envelope either yields a pending request or states why not —
 * never a bare `undefined` — so a client can tell an unrelated frame apart from
 * a request it must refuse out loud.  A refusal names the method exactly when
 * the method is what was wrong.
 */
export type UiRequestParseResult =
	| Readonly<{ ok: true; request: PendingUiRequest }>
	| Readonly<{ ok: false; reason: "unknown-method"; method: string }>
	| Readonly<{ ok: false; reason: "not-interactive" | "malformed" }>;

/**
 * Read the positional option metadata of one `select`.  `undefined` means the
 * value is not the shape OMP sends, so the caller refuses the request instead of
 * guessing which description belongs to which option.  Both clients read it
 * here, which is what stops them disagreeing about the same envelope.
 */
export function parseUiSelectOptionDetails(value: unknown, optionCount: number): readonly UiSelectOptionDetail[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || value.length !== optionCount) return undefined;
	const rows: UiSelectOptionDetail[] = [];
	for (const item of value) {
		if (typeof item !== "object" || item === null || Array.isArray(item)) return undefined;
		// A property of an `unknown` element is unreachable with `typeof`/`in`, so
		// this named cast is the one place the field can be read; it is checked next.
		const row: { readonly description?: unknown } = item as { readonly description?: unknown };
		if (row.description !== undefined && typeof row.description !== "string") return undefined;
		rows.push(typeof row.description === "string" ? { description: row.description } : {});
	}
	return rows;
}
