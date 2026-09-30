import {
	type OmpFrame,
	type RpcCediaPlanData,
	type RpcCediaPlanReview,
	type RpcCediaPlanState,
	type RpcCediaPlanWorkflow,
	type RpcCediaVibeState,
} from "../../../packages/omp-adapter/src/types.ts";

export type CediaPlanCommand =
	| { readonly op: "read" }
	| { readonly op: "enter"; readonly workflow?: RpcCediaPlanWorkflow; readonly planFilePath?: string }
	| { readonly op: "exit"; readonly paused?: boolean; readonly confirm?: boolean }
	| { readonly op: "vibe.enter" }
	| { readonly op: "vibe.exit" }
	| {
			readonly op: "review.decide";
			readonly reviewId: number;
			readonly decision: "approve" | "refine" | "cancel";
			readonly preserveContext?: boolean;
			readonly compactBeforeExecute?: boolean;
			readonly feedback?: string;
		};

export type OmpPlanCommandRequest = CediaPlanCommand & {
	readonly commandId: string;
	readonly incarnation: string;
};

export type OmpPlanState = RpcCediaPlanState;
export type OmpVibeState = RpcCediaVibeState;
export type OmpPlanReview = RpcCediaPlanReview;

export type OmpPlanSnapshot =
	| {
			readonly state: "available";
			readonly revision: number;
			readonly plan: OmpPlanState | null;
			readonly vibe: OmpVibeState;
			readonly review: OmpPlanReview | null;
		}
	| { readonly state: "unavailable"; readonly reason: string };

export type OmpPlanCommandOutcome = RpcCediaPlanData;
export type OmpPlanCommandResult =
	| (Extract<OmpPlanSnapshot, { readonly state: "available" }> & { readonly changed: boolean; readonly reason?: string })
	| { readonly state: "unavailable"; readonly reason: string; readonly changed: false };

/** A live OMP client with the native plan bridge negotiated in its ready frame. */
export type OmpPlanClient = {
	readonly phase: string;
	readonly readyFrame?: Record<string, unknown>;
	readonly requestCedia: (
		command: "cedia_plan",
		payload: Record<string, unknown>,
	) => Promise<{ readonly data?: unknown }>;
};

export const NO_OMP_PLAN_RUNTIME_REASON = "No OMP runtime is running; Cedia cannot read or control this task's plan mode.";
export const NO_OMP_PLAN_BRIDGE_REASON = "The live OMP runtime does not advertise the Cedia plan bridge.";

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
	return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
	const keys = new Set(allowed);
	for (const key of Object.keys(value)) if (!keys.has(key)) throw new TypeError(`${label} has an unknown field ${key}`);
}

function boolean(value: unknown, label: string): boolean {
	if (typeof value !== "boolean") throw new TypeError(`${label} must be a boolean`);
	return value;
}

function text(value: unknown, label: string): string {
	if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
	return value;
}

function integer(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative integer`);
	return value;
}

export function parseOmpPlanState(value: unknown): OmpPlanState {
	const item = record(value, "OMP plan state");
	exact(item, ["enabled", "paused", "planFilePath", "workflow", "reentry"], "OMP plan state");
	if (item.workflow !== "parallel" && item.workflow !== "iterative") throw new TypeError("OMP plan workflow is unsupported");
	const planFilePath = item.planFilePath === undefined ? undefined : text(item.planFilePath, "OMP plan file path");
	return {
		enabled: boolean(item.enabled, "OMP plan enabled marker"),
		paused: boolean(item.paused, "OMP plan paused marker"),
		...(planFilePath === undefined ? {} : { planFilePath }),
		workflow: item.workflow,
		reentry: boolean(item.reentry, "OMP plan reentry marker"),
	};
}

export function parseOmpVibeState(value: unknown): OmpVibeState {
	const item = record(value, "OMP vibe state");
	exact(item, ["enabled"], "OMP vibe state");
	return { enabled: boolean(item.enabled, "OMP vibe enabled marker") };
}

export function parseOmpPlanReview(value: unknown): OmpPlanReview {
	const item = record(value, "OMP plan review");
	exact(item, ["reviewId", "title", "planFilePath", "planContent", "truncated", "createdAt"], "OMP plan review");
	return {
		reviewId: integer(item.reviewId, "OMP plan review id"),
		title: text(item.title, "OMP plan review title"),
		planFilePath: text(item.planFilePath, "OMP plan review file path"),
		planContent: text(item.planContent, "OMP plan review content"),
		truncated: boolean(item.truncated, "OMP plan review truncation marker"),
		createdAt: integer(item.createdAt, "OMP plan review creation time"),
	};
}

/** Parse strict data returned by `cedia_plan`. */
export function parseOmpPlanData(value: unknown): OmpPlanCommandOutcome {
	const item = record(value, "OMP plan response");
	exact(item, ["plan", "vibe", "review", "changed", "reason"], "OMP plan response");
	const plan = item.plan === null ? null : parseOmpPlanState(item.plan);
	const review = item.review === null ? null : parseOmpPlanReview(item.review);
	const reason = item.reason === undefined ? undefined : text(item.reason, "OMP plan reason");
	return {
		plan,
		vibe: parseOmpVibeState(item.vibe),
		review,
		changed: boolean(item.changed, "OMP plan changed marker"),
		...(reason === undefined ? {} : { reason }),
	};
}

/** Parse the projection shape persisted for a host plan command receipt. */
export function parseOmpPlanCommandResult(value: unknown): OmpPlanCommandResult {
	const item = record(value, "Cedia plan command result");
	if (item.state === "unavailable") {
		exact(item, ["state", "reason", "changed"], "Cedia plan unavailable result");
		if (item.changed !== false) throw new TypeError("Cedia plan unavailable result must be unchanged");
		return { state: "unavailable", reason: text(item.reason, "Cedia plan unavailable reason"), changed: false };
	}
	if (item.state !== "available") throw new TypeError("Cedia plan result state is unsupported");
	exact(item, ["state", "revision", "plan", "vibe", "review", "changed", "reason"], "Cedia plan available result");
	const revision = integer(item.revision, "Cedia plan revision");
	if (revision < 1) throw new TypeError("Cedia plan revision must be positive");
	const reason = item.reason === undefined ? undefined : text(item.reason, "Cedia plan reason");
	return {
		state: "available",
		revision,
		plan: item.plan === null ? null : parseOmpPlanState(item.plan),
		vibe: parseOmpVibeState(item.vibe),
		review: item.review === null ? null : parseOmpPlanReview(item.review),
		changed: boolean(item.changed, "Cedia plan changed marker"),
		...(reason === undefined ? {} : { reason }),
	};
}

function responseData(value: unknown): unknown {
	if (value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "data")) return (value as { data?: unknown }).data;
	return value;
}

/** Read native plan state from one already-running OMP client. */
export async function readOmpPlan(client: OmpPlanClient): Promise<OmpPlanCommandOutcome> {
	const response = await client.requestCedia("cedia_plan", { command: { op: "read" } });
	return parseOmpPlanData(responseData(response));
}

/** Apply one native plan operation and validate the returned state. */
export async function applyOmpPlan(client: OmpPlanClient, command: CediaPlanCommand): Promise<OmpPlanCommandOutcome> {
	const response = await client.requestCedia("cedia_plan", { command });
	return parseOmpPlanData(responseData(response));
}

/**
 * One per-session native plan projection. OMP remains the owner: this class only caches the
 * last state the runtime returned or streamed, and never starts a session to satisfy a read.
 */
export class OmpPlan {
	#client: OmpPlanClient | undefined;
	#plan: OmpPlanState | null | undefined;
	#vibe: OmpVibeState | undefined;
	#review: OmpPlanReview | null | undefined;
	#revision = 0;
	#unavailableReason: string;

	constructor(options: { readonly client?: OmpPlanClient; readonly unavailableReason?: string } = {}) {
		this.#client = options.client;
		this.#unavailableReason = options.unavailableReason ?? NO_OMP_PLAN_RUNTIME_REASON;
	}

	setClient(client: OmpPlanClient | undefined): void {
		this.#client = client;
		if (!client) this.#clearUnavailable(NO_OMP_PLAN_RUNTIME_REASON);
	}

	/** Seed from `cedia_plan {command:{op:"read"}}` when the session has already started. */
	async seed(): Promise<void> {
		const client = this.#client;
		if (!client || client.phase !== "ready") {
			this.#clearUnavailable(NO_OMP_PLAN_RUNTIME_REASON);
			return;
		}
		if (client.readyFrame?.cediaPlanVersion !== 1) {
			this.#clearUnavailable(NO_OMP_PLAN_BRIDGE_REASON);
			return;
		}
		try {
			this.#set(await readOmpPlan(client));
		} catch (error) {
			this.#clearUnavailable(error instanceof Error ? error.message : String(error));
		}
	}

	/** Fold one raw streamed plan frame into the cache. Malformed frames are ignored. */
	update(frame: unknown): void {
		if (!frame || typeof frame !== "object" || Array.isArray(frame)) return;
		const type = (frame as Record<string, unknown>).type;
		try {
			if (type === "cedia_plan_state") {
				const item = record(frame, "OMP plan state frame");
				exact(item, ["type", "payload"], "OMP plan state frame");
				const payload = record(item.payload, "OMP plan state frame payload");
				exact(payload, ["plan", "vibe"], "OMP plan state frame payload");
				const plan = payload.plan === null ? null : parseOmpPlanState(payload.plan);
				const vibe = parseOmpVibeState(payload.vibe);
				this.#setState(plan, vibe, this.#review ?? null);
				return;
			}
			if (type === "cedia_plan_review") {
				const item = record(frame, "OMP plan review frame");
				exact(item, ["type", "payload"], "OMP plan review frame");
				this.#setReview(parseOmpPlanReview(item.payload));
				return;
			}
			if (type === "cedia_plan_review_closed") {
				const item = record(frame, "OMP plan review closed frame");
				exact(item, ["type", "payload"], "OMP plan review closed frame");
				const payload = record(item.payload, "OMP plan review closed frame payload");
				exact(payload, ["reviewId", "decision", "reason"], "OMP plan review closed frame payload");
				integer(payload.reviewId, "OMP plan review id");
				if (payload.decision !== "approve" && payload.decision !== "refine" && payload.decision !== "cancel") throw new TypeError("OMP plan review decision is unsupported");
				if (payload.reason !== undefined) text(payload.reason, "OMP plan review close reason");
				if (this.#review === undefined || this.#review === null || this.#review.reviewId !== payload.reviewId) return;
				this.#setReview(null);
			}
		} catch {
			// Runtime frames are untrusted. A malformed frame must never poison a valid cache.
		}
	}

	snapshot(): OmpPlanSnapshot {
		if (this.#plan === undefined || this.#vibe === undefined || this.#review === undefined) return { state: "unavailable", reason: this.#unavailableReason };
		return { state: "available", revision: this.#revision, plan: this.#plan, vibe: this.#vibe, review: this.#review };
	}

	/** Dispatch through OMP and update the cache from its acknowledged state. */
	async apply(command: CediaPlanCommand): Promise<OmpPlanCommandOutcome> {
		const client = this.#client;
		if (!client || client.phase !== "ready") throw new Error(NO_OMP_PLAN_RUNTIME_REASON);
		if (client.readyFrame?.cediaPlanVersion !== 1) throw new Error(NO_OMP_PLAN_BRIDGE_REASON);
		const outcome = await applyOmpPlan(client, command);
		this.#set(outcome);
		return outcome;
	}

	#clearUnavailable(reason: string): void {
		this.#plan = undefined;
		this.#vibe = undefined;
		this.#review = undefined;
		this.#unavailableReason = reason;
	}

	#set(outcome: OmpPlanCommandOutcome): void {
		this.#setState(outcome.plan, outcome.vibe, outcome.review);
	}

	#setState(plan: OmpPlanState | null, vibe: OmpVibeState, review: OmpPlanReview | null): void {
		this.#plan = plan;
		this.#vibe = vibe;
		this.#review = review;
		this.#revision += 1;
		this.#unavailableReason = "";
	}

	#setReview(review: OmpPlanReview | null): void {
		this.#review = review;
		this.#revision += 1;
		if (this.#plan !== undefined && this.#vibe !== undefined) this.#unavailableReason = "";
	}
}

export type OmpPlanFrame = OmpFrame;
