/**
 * Public protocol types for the Cedia OMP adapter.
 *
 * The command names below are intentionally copied as a small, dependency-free
 * contract from OMP v18.4.3:
 * `packages/coding-agent/src/modes/rpc/rpc-types.ts`
 * at commit `fc671eba383f2a7208500836673b485c0dc7073d` (2026-09-29).
 *
 * We do not import OMP's private package types.  Keeping this boundary local
 * means Cedia can run on Node and can detect protocol drift at startup.
 */

/** OMP RPC transport version selected by the adapter after negotiation. */
export const OMP_RPC_PROTOCOL_VERSION = 2 as const;

/**
 * The OMP release the adapter contract was last written and run against.
 *
 * It is a floor, not a pin. Cedia follows OMP: every later release is accepted (see
 * {@link isSupportedOmpVersion}), and what a runtime can actually do is read from its own
 * `ready` frame instead of guessed from its version string. The Cedia bridges are
 * capability-gated there - `cediaUiVersion`, `cediaTerminalVersion`, `cediaModelRolesVersion`,
 * `cediaAuthVersion`, the editor and native bridges - so a runtime without them, such as a stock OMP, degrades
 * honestly instead of failing. The contract suites (`scripts/omp-smoke.ts`,
 * `scripts/omp-ui-smoke.ts`, `scripts/omp-g1-smoke.ts`) are the acceptance test for any release
 * newer than this one, and a Cedia build packages a runtime it contract-tested when it was
 * built.
 */
export const OMP_BASELINE_VERSION = "18.4.3" as const;

/**
 * Whether a runtime that reports `version` is one Cedia may drive: the baseline, or anything
 * newer - including a newer minor and a newer major.
 *
 * The baseline is the release the contract was written against, so anything older is refused by
 * name: it was never tested. Anything newer is accepted because a version string cannot tell
 * Cedia what a runtime does, while the `ready` frame can, and that is what the adapter asks:
 * the protocol versions the runtime speaks and the Cedia bridges it carries. A user who updates
 * OMP past the number Cedia was tested at should get a working window whose features are the
 * ones their runtime advertises, not a composer that fails before the first prompt; a release
 * that really did change the envelope is caught by the contract suites and by the adapter's
 * request-level checks, not by refusing its number. Malformed output is refused as well: the
 * version string is the only thing Cedia knows about the binary before it spawns it.
 */
export function isSupportedOmpVersion(version: string): boolean {
	const match = /^omp\/(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
	if (!match) {
		return false;
	}
	const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
	const [baseMajor, baseMinor, basePatch] = OMP_BASELINE_VERSION.split(".").map(Number) as [number, number, number];
	if (major !== baseMajor) {
		return major > baseMajor;
	}
	if (minor !== baseMinor) {
		return minor > baseMinor;
	}
	return patch >= basePatch;
}

/** Maximum UTF-8 bytes in one physical JSONL frame, including its newline. */
export const MAX_RPC_FRAME_BYTES = 1024 * 1024;

/** Maximum UTF-8 bytes in one logical frame after protocol-v2 reassembly. */
export const MAX_RPC_REASSEMBLED_BYTES = 64 * 1024 * 1024;

/**
 * Canonical OMP RPC command identifiers (42 entries).
 *
 * Keep this tuple in source order so a diff against the pinned OMP source is
 * straightforward and so consumers can expose a deterministic capability
 * manifest.
 */
export const RPC_COMMAND_TYPES = [
	"negotiate_protocol",
	"prompt",
	"steer",
	"follow_up",
	"remove_queued_message",
	"promote_queued_message",
	"abort",
	"abort_and_prompt",
	"new_session",
	"get_state",
	"set_fast_mode",
	"get_available_commands",
	"set_todos",
	"set_host_tools",
	"set_host_uri_schemes",
	"set_subagent_subscription",
	"get_subagents",
	"get_subagent_messages",
	"set_model",
	"cycle_model",
	"get_available_models",
	"set_thinking_level",
	"cycle_thinking_level",
	"set_steering_mode",
	"set_follow_up_mode",
	"set_interrupt_mode",
	"compact",
	"set_auto_compaction",
	"set_cache_warming",
	"set_auto_retry",
	"abort_retry",
	"bash",
	"abort_bash",
	"get_session_stats",
	"export_html",
	"switch_session",
	"branch",
	"get_branch_messages",
	"get_last_assistant_text",
	"set_session_name",
	"handoff",
	"get_messages",
	"get_messages_page",
	"get_entries",
	"get_tree",
	"open_session",
	"set_event_filter",
	"get_available_thinking_levels",
	"get_login_providers",
	"login",
] as const;

export type RpcCommandType = (typeof RPC_COMMAND_TYPES)[number];

/** Opt-in commands of Cedia's separately pinned OMP UI patch, never stock OMP claims. */
export const CEDIA_UI_COMMAND_TYPES = [
	"cedia_terminal_negotiate",
	"cedia_terminal_input",
	"cedia_terminal_resize",
	"cedia_get_model_roles",
	"cedia_set_model_role",
	"cedia_get_auth_providers",
	"cedia_set_api_key",
	"cedia_logout",
	"cedia_turn_queue",
	"cedia_pending_model",
	"cedia_goal",
	"cedia_plan",
	"cedia_get_capabilities",
	"cedia_control",
] as const;
export type CediaUiCommandType = typeof CEDIA_UI_COMMAND_TYPES[number];

/**
 * Cedia's capability contract (plan §8.2 O04).
 *
 * Mirrored from the runtime's own `rpc-types.ts` the same way the other Cedia
 * bridges are: the adapter declares the wire shape it consumes instead of
 * importing OMP's private package types, and the host validates what it reads.
 */
export type RpcCediaCapabilityFamily =
	| "O01"
	| "O02"
	| "O03"
	| "O04"
	| "O05"
	| "O06"
	| "O07"
	| "O08"
	| "O09"
	| "O10"
	| "O11"
	| "O12";

export type RpcCediaCapabilityState = "available" | "dependency_unavailable" | "integration_missing";

export interface RpcCediaCapabilityDescriptor {
	id: string;
	family: RpcCediaCapabilityFamily;
	state: RpcCediaCapabilityState;
	scope: "session" | "project" | "global" | "device";
	apply: "immediate" | "turn_boundary" | "reload" | "new_session";
	surfaces: ("agent" | "ide" | "web" | "iphone")[];
	principal: "owner" | "controller";
	bridgeVersion: number;
	schemaVersion: number;
	source: string;
	ompRevision: string;
	receipt?: string;
	reason?: string;
}

/** What `cedia_get_capabilities` answers. */
export interface RpcCediaCapabilitiesData {
	bridgeVersion: number;
	schemaVersion: number;
	capabilityRevision: string;
	ompRevision: string;
	capabilities: RpcCediaCapabilityDescriptor[];
}

/** What `cedia_control` answers inside the response `data`. */
export interface RpcCediaControlData {
	operation: string;
	capabilityRevision: string;
	result: unknown;
}

/**
 * Cedia's view of OMP's turn queue (plan §2.4).
 *
 * `current` names the submission whose turn is running and the model OMP is actually using for
 * it; `queued` lists the submissions waiting, in OMP's own drain order (steering first). An
 * entry without an `intentId` is a real queued message that no client named.
 */
/**
 * What OMP answers when Cedia hands it a pending model/effort change (§2.4): the revision it
 * accepted and when. The change itself is committed at the runtime's next turn boundary and
 * reported through {@link RpcCediaTurnQueueData.applied}.
 */
export interface RpcCediaPendingModelRequest {
	revision: number;
	provider?: string;
	modelId?: string;
	thinkingLevel?: string | null;
}

export interface RpcCediaTurnQueueData {
	current?: { intentId?: string; model?: { provider: string; id: string; name?: string }; thinkingLevel?: string };
	queued: { intentId?: string; kind: "steer" | "followUp"; position: number }[];
	/** The change OMP is holding for the next turn, if any. */
	pending?: { revision: number; acceptedAt: string };
	/** The latest change OMP committed at a turn boundary, or why it could not. */
	applied?: { revision: number; model?: { provider: string; id: string; name?: string }; thinkingLevel?: string; appliedAt: string; error?: string };
}

/**
 * OMP's own goal record (plan §8.2 O07). Mirrored rather than imported, the way the other Cedia
 * bridges are: the host validates what it reads instead of trusting a private package shape.
 */
export interface RpcCediaGoalRecord {
	id: string;
	objective: string;
	/** OMP's vocabulary: `budget-limited` is its own state, not a synonym for paused. */
	status: "active" | "paused" | "budget-limited" | "complete" | "dropped";
	tokenBudget?: number;
	tokensUsed: number;
	timeUsedSeconds: number;
	createdAt: number;
	updatedAt: number;
}

/** What OMP answers for any goal operation: the whole of its goal state after the operation. */
export interface RpcCediaGoalData {
	enabled: boolean;
	mode?: "active" | "exiting";
	reason?: "completed";
	goal: RpcCediaGoalRecord | null;
	/** Set by `set`/`replace`, which dispatch the objective as a turn as `/goal` does. */
	startedTurn?: boolean;
}

/** Native OMP plan/vibe mode state projected by the Cedia plan bridge (O07). */
export type RpcCediaPlanWorkflow = "parallel" | "iterative";

export type RpcCediaPlanCommand =
	| { op: "read" }
	| { op: "enter"; workflow?: RpcCediaPlanWorkflow; planFilePath?: string }
	| { op: "exit"; paused?: boolean; confirm?: boolean }
	| { op: "vibe.enter" }
	| { op: "vibe.exit" }
	| {
			op: "review.decide";
			reviewId: number;
			decision: "approve" | "refine" | "cancel";
			preserveContext?: boolean;
			compactBeforeExecute?: boolean;
			feedback?: string;
		};

/** Short alias matching the frozen Cedia wire contract name. */
export type CediaPlanCommand = RpcCediaPlanCommand;

export interface RpcCediaPlanState {
	enabled: boolean;
	paused: boolean;
	planFilePath?: string;
	workflow: RpcCediaPlanWorkflow;
	reentry: boolean;
}

export interface RpcCediaVibeState {
	enabled: boolean;
}

export interface RpcCediaPlanReview {
	reviewId: number;
	title: string;
	planFilePath: string;
	planContent: string;
	truncated: boolean;
	createdAt: number;
}

/** Data returned by `cedia_plan` after any command, including a read. */
export interface RpcCediaPlanData {
	plan: RpcCediaPlanState | null;
	vibe: RpcCediaVibeState;
	review: RpcCediaPlanReview | null;
	changed: boolean;
	reason?: string;
}

/** A JSON object accepted as the body of an RPC command. */
export type RpcPayload = Record<string, unknown>;

type EmptyPayload = Record<string, never>;

/**
 * Command payloads mirror the stable fields in OMP's `RpcCommand` union.  The
 * nested model/session/tool values intentionally remain dependency-free JSON
 * shapes; OMP owns their detailed schemas.
 */
export interface RpcCommandPayloadMap {
	negotiate_protocol: { protocolVersion: number };
	prompt: { message: string; images?: unknown[]; streamingBehavior?: "steer" | "followUp"; cediaIntentId?: string; cediaSelectedSlashCommand?: string };
	steer: { message: string; images?: unknown[]; cediaIntentId?: string };
	follow_up: { message: string; images?: unknown[]; cediaIntentId?: string };
	remove_queued_message: { message: string; queue: "steering" | "followUp" };
	promote_queued_message: { message: string };
	abort: EmptyPayload;
	abort_and_prompt: { message: string; images?: unknown[]; cediaIntentId?: string };
	new_session: { parentSession?: string };
	get_state: EmptyPayload;
	set_fast_mode: { enabled: boolean };
	get_available_commands: EmptyPayload;
	set_todos: { phases: unknown[] };
	set_host_tools: { tools: RpcHostToolDefinition[] };
	set_host_uri_schemes: { schemes: RpcHostUriSchemeDefinition[] };
	set_subagent_subscription: { level: RpcSubagentSubscriptionLevel };
	get_subagents: EmptyPayload;
	get_subagent_messages: { subagentId?: string; sessionFile?: string; fromByte?: number };
	set_model: { provider: string; modelId: string };
	cycle_model: EmptyPayload;
	get_available_models: EmptyPayload;
	set_thinking_level: { level: string };
	cycle_thinking_level: EmptyPayload;
	set_steering_mode: { mode: "all" | "one-at-a-time" };
	set_follow_up_mode: { mode: "all" | "one-at-a-time" };
	set_interrupt_mode: { mode: "immediate" | "wait" };
	compact: { customInstructions?: string };
	set_auto_compaction: { enabled: boolean };
	set_cache_warming: { mode: "off" | "streaming" | "idle" };
	set_auto_retry: { enabled: boolean };
	abort_retry: EmptyPayload;
	bash: { command: string };
	abort_bash: EmptyPayload;
	get_session_stats: EmptyPayload;
	export_html: { outputPath?: string };
	switch_session: { sessionPath: string };
	branch: { entryId: string };
	get_branch_messages: EmptyPayload;
	get_last_assistant_text: EmptyPayload;
	set_session_name: { name: string };
	handoff: { customInstructions?: string };
	get_messages: EmptyPayload;
	get_messages_page: { cursor?: string; limit?: number };
	get_entries: { since?: string };
	get_tree: EmptyPayload;
	open_session: { sessionDir: string };
	set_event_filter: { events: string[] | null };
	get_available_thinking_levels: EmptyPayload;
	get_login_providers: EmptyPayload;
	login: { providerId: string };
}

export type RpcCommandPayload<C extends RpcCommandType> = RpcCommandPayloadMap[C];

/** A command frame as written to OMP stdin. */
export type RpcCommandFrame<C extends RpcCommandType = RpcCommandType> = {
	id: string;
	type: C;
} & RpcPayload;

/** OMP's successful response/ACK frame. */
export interface RpcSuccessResponse<C extends RpcCommandType = RpcCommandType> {
	id?: string;
	type: "response";
	command: C;
	success: true;
	data?: unknown;
	[key: string]: unknown;
}

/** OMP's failed response/ACK frame. */
export interface RpcFailureResponse {
	id?: string;
	type: "response";
	command: string;
	success: false;
	error: string;
	code?: string;
	[key: string]: unknown;
}

export type RpcResponse<C extends RpcCommandType = RpcCommandType> =
	| RpcSuccessResponse<C>
	| RpcFailureResponse;

/** The value returned by `request`; terminal agent events arrive separately. */
export type RpcAck<C extends RpcCommandType = RpcCommandType> = RpcSuccessResponse<C>;

export interface RpcReadyFrame {
	type: "ready";
	protocolVersion: 1;
	supportedProtocolVersions: readonly number[];
	maxFrameBytes: number;
	maxReassembledFrameBytes: number;
	[key: string]: unknown;
}

export interface RpcChunkFrame {
	type: "rpc_chunk";
	chunkId: string;
	index: number;
	count: number;
	byteLength: number;
	data: string;
	[key: string]: unknown;
}

export interface RpcExtensionUIResponseValue {
	type: "extension_ui_response";
	id: string;
	value: string;
}

export interface RpcExtensionUIResponseConfirm {
	type: "extension_ui_response";
	id: string;
	confirmed: boolean;
}

export interface RpcExtensionUIResponseCancelled {
	type: "extension_ui_response";
	id: string;
	cancelled: true;
	timedOut?: boolean;
}

export type RpcExtensionUIResponse =
	| RpcExtensionUIResponseValue
	| RpcExtensionUIResponseConfirm
	| RpcExtensionUIResponseCancelled;

export interface RpcHostToolUpdate {
	type: "host_tool_update";
	id: string;
	partialResult: unknown;
}

export interface RpcHostToolResult {
	type: "host_tool_result";
	id: string;
	result: unknown;
	isError?: boolean;
}

export interface RpcHostUriResult {
	type: "host_uri_result";
	id: string;
	content?: string;
	contentType?: "text/markdown" | "application/json" | "text/plain";
	notes?: string[];
	immutable?: boolean;
	isError?: boolean;
	error?: string;
}

export type RpcClientSideFrame =
	| RpcExtensionUIResponse
	| RpcHostToolUpdate
	| RpcHostToolResult
	| RpcHostUriResult;

export interface RpcHostToolDefinition {
	name: string;
	label?: string;
	description: string;
	parameters: Record<string, unknown>;
	hidden?: boolean;
	loadMode?: "discoverable" | "eager";
}

export interface RpcHostUriSchemeDefinition {
	scheme: string;
	description?: string;
	writable?: boolean;
	immutable?: boolean;
}

export type RpcSubagentSubscriptionLevel = "off" | "progress" | "events";

/** Every decoded JSON object emitted by OMP, including unknown future frames. */
export type OmpFrame = Record<string, unknown>;

export type OmpFrameListener = (frame: OmpFrame) => void;

export interface OmpRpcClientStartOptions {
	/** OMP executable or an absolute path selected by the caller (default `omp`). */
	executable?: string;
	/** Extra OMP CLI arguments appended after the enforced `--mode rpc-ui`. */
	args?: readonly string[];
	cwd?: string;
	/** Complete child environment when supplied; otherwise inherits process.env. */
	env?: NodeJS.ProcessEnv;
	/** Maximum time waiting for OMP's supported `ready` frame. */
	readyTimeoutMs?: number;
	/** Default time waiting for a command ACK. */
	requestTimeoutMs?: number;
	/** Grace period before SIGTERM and then SIGKILL during close. */
	shutdownGraceMs?: number;
	/** Tail size retained from stderr for diagnostics. */
	stderrLimitBytes?: number;
	/** Receives startup frames before `start` resolves. */
	onFrame?: OmpFrameListener;
}

export interface OmpRequestOptions {
	timeoutMs?: number;
	/** Called synchronously before enqueueing; lets a durable host bind the wire ID. Throwing prevents dispatch. */
	onRequestId?: (id: string) => void;
}
