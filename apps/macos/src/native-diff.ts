/** Native Code-OSS diff review for a task workspace.
 *
 * The review panel in the webview renders hunks itself, but Code-OSS already
 * ships a real diff editor (`vscode.diff`) with side-by-side/inline toggle,
 * next/previous change, and revert. This module holds the pure part: the
 * virtual-document identity for the "original" side and the decision about
 * whether a native diff is honest to open at all. Keeping it free of the
 * `vscode` import lets it be unit tested.
 */

export const NATIVE_DIFF_SCHEME = "cedia-review";

export interface NativeDiffDocId {
	/** Git revision used for the original side, e.g. `HEAD`. */
	readonly ref: string;
	/** Workspace-relative path with forward slashes. */
	readonly path: string;
}

/** Build the id stored in the content provider map for one original side. */
export function encodeReviewDocId(doc: NativeDiffDocId): string {
	const path = doc.path.split("/").map(encodeURIComponent).join("/");
	return `${NATIVE_DIFF_SCHEME}:/${encodeURIComponent(doc.ref)}/${path}`;
}

/** Read back an id produced by {@link encodeReviewDocId}. */
export function decodeReviewDocId(value: string): NativeDiffDocId | undefined {
	const prefix = `${NATIVE_DIFF_SCHEME}:/`;
	if (!value.startsWith(prefix)) return undefined;
	const rest = value.slice(prefix.length);
	const slash = rest.indexOf("/");
	if (slash <= 0) return undefined;
	const ref = decodeURIComponent(rest.slice(0, slash));
	const path = rest.slice(slash + 1).split("/").map(decodeURIComponent).join("/");
	if (!ref || !path) return undefined;
	return { ref, path };
}

export interface NativeDiffPlanInput {
	/** Workspace-relative path shown in the diff title. */
	readonly path: string;
	/** Git advertised a binary file; a text diff would be misleading. */
	readonly binary?: boolean;
	/** The revision has no version of this path (new or untracked file). */
	readonly missingOriginal: boolean;
}

export type NativeDiffPlan =
	| { readonly open: true; readonly title: string; readonly missingOriginal: boolean }
	| { readonly open: false; readonly reason: string };

export const NATIVE_DIFF_BINARY_REASON =
	"Git reports this file as binary. Cedia opens text diffs only; use the Changes list for the summary.";

export function nativeDiffPlan(input: NativeDiffPlanInput): NativeDiffPlan {
	if (input.binary) return { open: false, reason: NATIVE_DIFF_BINARY_REASON };
	return {
		open: true,
		title: reviewDiffTitle(input.path, input.missingOriginal),
		missingOriginal: input.missingOriginal,
	};
}

/** Diff editor title. States plainly which two sides are being compared. */
export function reviewDiffTitle(path: string, missingOriginal: boolean): string {
	return `${path} (${missingOriginal ? "new file" : "HEAD"} ↔ Working Tree)`;
}

/** Whether a raw file body is binary for diff purposes. */
export function looksBinary(content: string): boolean {
	return content.includes("\u0000");
}

/** Virtual document scheme for the *pre-edit* side of a Cedia-applied edit. */
export const AGENT_EDIT_DIFF_SCHEME = "cedia-agent-edit";

/** Read-only "before Cedia" document id for one edited document. The document
 * uri is percent-encoded so it stays a single path segment and a
 * parse/toString round trip returns the id the diff command asked for. */
export function encodeAgentEditDocId(documentUri: string): string {
	return `${AGENT_EDIT_DIFF_SCHEME}:/${encodeURIComponent(documentUri)}`;
}

/** Read back the edited document uri from {@link encodeAgentEditDocId}. */
export function decodeAgentEditDocId(value: string): string | undefined {
	const prefix = `${AGENT_EDIT_DIFF_SCHEME}:/`;
	if (!value.startsWith(prefix)) return undefined;
	const encoded = value.slice(prefix.length);
	if (!encoded) return undefined;
	try {
		const documentUri = decodeURIComponent(encoded);
		return documentUri.includes(":") ? documentUri : undefined;
	} catch {
		return undefined;
	}
}

/** Diff title for reviewing exactly what Cedia changed in one file. */
export function agentEditDiffTitle(path: string): string {
	return `${path} (before Cedia ↔ after Cedia)`;
}

/** Only refs Cedia itself produces may leave the extension for the host's
 * revision read. Anything else falls back to HEAD so a crafted path can never
 * become an arbitrary revision. */
export function safeReviewRef(ref: string): string {
	return /^[A-Za-z0-9._/-]{1,128}$/.test(ref) && !ref.startsWith("-") ? ref : "HEAD";
}

export interface ReviewTargetInput {
	/** Workspace-relative path, or undefined when nothing is targeted. */
	readonly relativePath?: string;
	/** Open project / task workspace root. */
	readonly cwd?: string;
	/** Git advertised this path as binary. */
	readonly binary?: boolean;
	/** The path does not exist in the compared ref (new or untracked file). */
	readonly missingOriginal?: boolean;
}

export type ReviewTargetDecision =
	| { readonly open: true; readonly path: string; readonly title: string }
	| { readonly open: false; readonly reason: string };

export const REVIEW_NO_WORKSPACE_REASON = "Open a project before reviewing a file.";
export const REVIEW_OUTSIDE_WORKSPACE_REASON = "That file is outside this task workspace.";

/** Decide whether a review diff can be opened for the given target. Pure so
 * the editor command, keybinding, and Explorer menu all share one rule. */
export function resolveReviewTarget(input: ReviewTargetInput): ReviewTargetDecision {
	if (!input.cwd) return { open: false, reason: REVIEW_NO_WORKSPACE_REASON };
	const path = input.relativePath?.replace(/\\/g, "/") ?? "";
	if (!path || path.startsWith("/") || path.split("/").includes("..")) {
		return { open: false, reason: REVIEW_OUTSIDE_WORKSPACE_REASON };
	}
	const plan = nativeDiffPlan({ path, binary: input.binary === true, missingOriginal: input.missingOriginal === true });
	if (!plan.open) return { open: false, reason: plan.reason };
	return { open: true, path, title: plan.title };
}
