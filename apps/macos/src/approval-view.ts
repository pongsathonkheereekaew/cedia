import type { CediaUiRequest, UiInteractiveMethod, UiSelectOptionDetail } from "../../../packages/protocol/src/ui.ts";
import type { ApprovalStatus } from "./approval-runtime.ts";

export type { ApprovalStatus };

export interface ApprovalViewInput {
	readonly token: string;
	readonly requestId?: string;
	readonly sessionId?: string;
	readonly incarnation?: string;
	readonly method: string;
	readonly cwd?: string;
	readonly tool?: string;
	readonly target?: string;
	readonly timeout?: number;
	readonly receivedAt?: number;
	readonly status?: ApprovalStatus;
}

export interface ApprovalBindingView {
	readonly sessionId?: string;
	readonly incarnation?: string;
	readonly connection?: string;
}

export function approvalDisplayStatus(request: ApprovalViewInput, current: ApprovalBindingView, now = Date.now()): ApprovalStatus {
	if (request.status && request.status !== "pending") return request.status;
	if (request.sessionId && current.sessionId && request.sessionId !== current.sessionId) return "stale";
	if (request.incarnation && current.incarnation && request.incarnation !== current.incarnation) return "stale";
	if (typeof request.timeout === "number" && request.timeout > 0 && typeof request.receivedAt === "number" && now >= request.receivedAt + request.timeout) {
		return "timeout";
	}
	return "pending";
}

export function approvalCanSubmit(status: ApprovalStatus, connection?: string): boolean {
	if (status !== "pending") return false;
	return connection === "connected" || connection === "running";
}

/**
 * The control a native approval surface draws.  Derived from the wire union, so
 * a method OMP can send and this file does not know about is a compile error
 * here; `unsupported` names a method that never reached the union (an older
 * cached envelope, a defensive caller passing a plain string).
 */
export type ApprovalFieldKind = CediaUiRequest["method"] | "unsupported";

/** Every interactive method, mapped to the control that answers it. */
const APPROVAL_FIELD_KINDS: Readonly<Record<UiInteractiveMethod, ApprovalFieldKind>> = {
	confirm: "confirm",
	select: "select",
	input: "input",
	editor: "editor",
};

export function approvalFieldKind(method: string): ApprovalFieldKind {
	// Own-key lookup rather than a switch with a default: a method added to the
	// wire union without a control here fails to compile.
	return Object.prototype.hasOwnProperty.call(APPROVAL_FIELD_KINDS, method) ? APPROVAL_FIELD_KINDS[method as UiInteractiveMethod] : "unsupported";
}

export function approvalDefaultFocus(dangerous?: boolean): "cancel" | "submit" {
	return dangerous === true ? "cancel" : "submit";
}

export function approvalNeedsExpand(value: string | undefined, limit = 80): boolean {
	return typeof value === "string" && value.length > limit;
}

export function approvalIdentityLines(request: ApprovalViewInput): readonly string[] {
	const lines = [
		`Request ${request.requestId || request.token}`,
		request.method ? `Method ${request.method}` : "",
		request.tool ? `Tool ${request.tool}` : "",
		request.target ? `Target ${request.target}` : "",
		request.cwd ? `cwd ${request.cwd}` : "",
		request.sessionId ? `Session ${request.sessionId}` : "",
		request.incarnation ? `Incarnation ${request.incarnation}` : "",
	];
	return lines.filter((line) => line.length > 0);
}

export const APPROVAL_OFFLINE_LINE = "Waiting for host";
export const APPROVAL_REQUIRED_REASON = "This field is required.";

export interface ApprovalOptionRow {
	readonly value: string;
	/** OMP's select options are plain strings, so they are their own labels. */
	readonly label: string;
	readonly description?: string;
}

export function approvalOptionRows(
	options: readonly string[] | undefined,
	details?: readonly UiSelectOptionDetail[],
): readonly ApprovalOptionRow[] {
	if (!options) return [];
	const rows: ApprovalOptionRow[] = [];
	for (let index = 0; index < options.length; index++) {
		const value = options[index]!;
		if (value.length === 0) continue;
		const description = details?.[index]?.description;
		rows.push({
			value,
			label: value,
			...(typeof description === "string" ? { description } : {}),
		});
	}
	return rows;
}

export function approvalTimeoutRemaining(timeout?: number, receivedAt?: number, now?: number): number | undefined {
	if (typeof timeout !== "number" || timeout <= 0 || typeof receivedAt !== "number") return undefined;
	return Math.max(0, receivedAt + timeout - (now ?? Date.now()));
}

export function approvalTimeoutLine(remainingMs: number | undefined): string {
	if (remainingMs === undefined) return "";
	if (remainingMs <= 0) return "Expired";
	return `Expires in ${Math.ceil(remainingMs / 1000)}s`;
}

export function approvalOfflineLine(connection?: string): string | undefined {
	if (connection === "connected" || connection === "running" || connection === "online") return undefined;
	return APPROVAL_OFFLINE_LINE;
}

export function approvalSubmitBlockedReason(input: {
	readonly method: string;
	readonly required?: boolean;
	readonly value?: string | boolean;
}): string | undefined {
	if (input.method === "confirm" || input.value === true) return undefined;
	if (input.required !== true) return undefined;
	const kind = approvalFieldKind(input.method);
	if (kind === "input" || kind === "editor") {
		return typeof input.value === "string" && input.value.trim().length > 0 ? undefined : APPROVAL_REQUIRED_REASON;
	}
	if (kind === "select") {
		return typeof input.value === "string" && input.value.length > 0 ? undefined : APPROVAL_REQUIRED_REASON;
	}
	return undefined;
}

export function approvalFocusTarget(input: { readonly dangerous?: boolean; readonly invalid?: boolean }): "cancel" | "submit" | "control" {
	return input.invalid === true ? "control" : approvalDefaultFocus(input.dangerous);
}
