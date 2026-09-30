/**
 * Pure data helpers for the OMP F coverage gate.
 *
 * The dated OMP audit is deliberately kept as JSON.  This module turns the five
 * audit files into one stable `(kind, name)` record set and compares it with a
 * separately supplied Cedia surface.  It does not read files or start a runtime;
 * the CLI owns those side effects and passes the resulting data here.
 */

export const OMP_COVERAGE_FAMILIES = [
	"O01",
	"O02",
	"O03",
	"O04",
	"O05",
	"O06",
	"O07",
	"O08",
	"O09",
	"O10",
	"O11",
	"O12",
] as const;

export type OmpCoverageFamily = (typeof OMP_COVERAGE_FAMILIES)[number];
/**
 * The plan's per-operation dispositions (§2.2's list) plus the two states a checker needs.
 *
 * `integrated` is the plan's own word for an operation Cedia really carries; the four settled
 * states below it are how a record stops being an F gap without pretending it was implemented.
 * `integration_missing` and `unmapped` block F.
 */
export type OmpDisposition =
	| "integrated"
	| "dependency_unavailable"
	| "platform_presentation_equivalent"
	| "owner_only"
	| "explicitly_excluded"
	| "integration_missing";

/** The mapping kinds emitted by the audit's verify.py expected-set check. */
export type OmpCoverageKind =
	| "rpc"
	| "setting"
	| "slash"
	| "slash-alias"
	| "slash-subcommand"
	| "cli"
	| "cli-alias"
	| "launch-flag"
	| "tool"
	| "tool-alias"
	| "dynamic-tool"
	| "extension-ui"
	| "host-frame"
	| "event"
	| "sdk";

export interface OmpAuditConfigCli {
	readonly settings?: readonly OmpAuditSetting[];
	readonly slashCommands?: readonly OmpAuditSlashCommand[];
	readonly cliCommands?: readonly OmpAuditCliCommand[];
	readonly launchFlags?: OmpAuditLaunchFlags;
	readonly [key: string]: unknown;
}

export interface OmpAuditSetting {
	readonly path: string;
	readonly [key: string]: unknown;
}

export interface OmpAuditSlashCommand {
	readonly name: string;
	readonly aliases?: readonly string[];
	readonly subcommands?: readonly (string | { readonly name?: string })[];
	readonly [key: string]: unknown;
}

export interface OmpAuditCliCommand {
	readonly name: string;
	readonly aliases?: readonly string[];
	readonly [key: string]: unknown;
}

export interface OmpAuditLaunchFlags {
	readonly string?: readonly string[];
	readonly optional?: readonly string[];
	readonly boolean?: readonly string[];
	readonly [key: string]: unknown;
}

export interface OmpAuditRpc {
	readonly commands?: readonly { readonly name: string; readonly [key: string]: unknown }[];
	readonly extensionUiMethods?: readonly { readonly method: string; readonly [key: string]: unknown }[];
	readonly hostBridgeFrames?: readonly (string | { readonly type?: string; readonly name?: string; readonly [key: string]: unknown })[];
	readonly sessionEvents?: { readonly sourceUnion?: readonly string[]; readonly [key: string]: unknown };
	readonly [key: string]: unknown;
}

export interface OmpAuditTools {
	readonly registry?: {
		readonly builtin?: readonly { readonly name: string; readonly [key: string]: unknown }[];
		readonly hidden?: readonly { readonly name: string; readonly [key: string]: unknown }[];
		readonly aliases?: Readonly<Record<string, unknown>>;
		readonly [key: string]: unknown;
	};
	readonly dynamic?: readonly { readonly name: string; readonly [key: string]: unknown }[];
	readonly [key: string]: unknown;
}

export interface OmpAuditSdk {
	readonly entries?: readonly { readonly name: string; readonly [key: string]: unknown }[];
	readonly [key: string]: unknown;
}

export interface OmpAuditCoverageRow {
	readonly kind: string;
	readonly name: string;
	readonly family: string;
	readonly [key: string]: unknown;
}

export interface OmpAuditCoverage {
	readonly rows?: readonly OmpAuditCoverageRow[];
	readonly sources?: Readonly<Record<string, string>>;
	readonly [key: string]: unknown;
}

export interface OmpAuditInputs {
	readonly configCli: OmpAuditConfigCli;
	readonly rpc: OmpAuditRpc;
	readonly tools: OmpAuditTools;
	readonly sdk: OmpAuditSdk;
	readonly coverage: OmpAuditCoverage;
}

/** One audited source record, with the family supplied by coverage.json when present. */
export interface OmpAuditedRecord {
	readonly kind: string;
	readonly name: string;
	readonly family?: string;
	readonly source?: string;
}

/** One Cedia-side mapping.  A missing entry means there is no Cedia disposition at all. */
export interface OmpCediaEntry {
	readonly kind: string;
	readonly name: string;
	readonly family?: string;
	readonly disposition: OmpDisposition;
	readonly reason?: string;
	readonly handler?: string;
	readonly presentation?: string;
	/**
	 * The test that proves this mapping (§8.2: the descriptor table stores test/receipt IDs).
	 * A mapping without one is an assertion, so the coverage report carries it to the reader.
	 */
	readonly test?: string;
}

export interface OmpCediaSurfaceInput {
	readonly entries?: readonly OmpCediaEntry[];
	/** Convenience shorthands for the adapter registries. */
	readonly rpcCommands?: readonly string[];
	readonly cediaUiCommands?: readonly string[];
	readonly settings?: readonly string[];
}

export interface OmpCoverageGap {
	readonly kind: string;
	readonly name: string;
	readonly family?: string;
	readonly disposition: "unmapped" | OmpDisposition;
	readonly reason: string;
}

/** Dispositions that still block F: an operation with no settled answer yet. */
export const OMP_BLOCKING_DISPOSITIONS: ReadonlySet<string> = new Set(["unmapped", "integration_missing"]);

export type OmpCoverageIssueKind =
	| "unmapped"
	| "orphan"
	| "duplicate"
	| "family_invalid"
	| "family_mismatch"
	| "stale_source"
	| "source_missing"
	| "unclassified"
	| "runtime_mismatch";

export interface OmpCoverageIssue {
	readonly kind: OmpCoverageIssueKind;
	readonly recordKind?: string;
	readonly name: string;
	readonly family?: string;
	readonly message: string;
}

export interface OmpCoverageRowReport {
	readonly kind: string;
	readonly name: string;
	readonly family?: string;
	readonly disposition: "unmapped" | OmpDisposition;
	readonly reason?: string;
	readonly handler?: string;
	readonly presentation?: string;
	readonly test?: string;
}

export interface OmpRuntimeCapabilities {
	readonly settings?: readonly (string | { readonly path?: string; readonly apply?: string })[];
	/** The runtime ready frame projection of accepted RPC command names, when available. */
	readonly rpcCommands?: readonly string[];
	/** `cedia_get_capabilities` or `capabilities.get` descriptor rows. */
	readonly capabilities?: readonly { readonly id: string; readonly state?: string }[];
	/** Whether a second `capabilities.get` read matched `cedia_get_capabilities` byte-for-byte. */
	readonly capabilityTableMatches?: boolean;
}

export interface OmpCoverageOptions {
	/** Actual hashes for files listed by coverage.sources.  Undefined means the file is absent. */
	readonly sourceHashes?: Readonly<Record<string, string | undefined>>;
	/** Tracked OMP patch paths are intentionally different from the stock audit hash. */
	readonly sourceExemptions?: ReadonlySet<string> | readonly string[];
	readonly runtime?: OmpRuntimeCapabilities;
}

export interface OmpCoverageReport {
	readonly audited: readonly OmpAuditedRecord[];
	readonly cedia: readonly OmpCediaEntry[];
	readonly rows: readonly OmpCoverageRowReport[];
	readonly gaps: readonly OmpCoverageGap[];
	readonly issues: readonly OmpCoverageIssue[];
	readonly integrityPass: boolean;
	readonly complete: boolean;
}

const fatalIssueKinds: ReadonlySet<OmpCoverageIssueKind> = new Set([
	"orphan",
	"duplicate",
	"family_invalid",
	"stale_source",
	"unclassified",
	"runtime_mismatch",
]);

const array = <T>(value: readonly T[] | undefined): readonly T[] => (Array.isArray(value) ? value : []);

/**
 * An SDK operation Cedia reaches through an audited RPC command it actually sends.
 *
 * §2.8 forbids reaching an operation by starting an SDK session, so an SDK entry is only
 * `integrated` when the same operation has a Cedia path over RPC. `rpcCommand` names the audited
 * command, and the verifier below refuses a link Cedia's own adapter does not send, so the table
 * cannot claim a path that stopped existing.
 */
/**
 * How Cedia carries an audited RPC command that its own sources do not call.
 *
 * The audit lists the commands the runtime accepts; a row is only `integrated` when the *operation*
 * has a Cedia path. `via` names that path and `verifyOmpRpcPaths` checks it against the audit, so a
 * link cannot claim a slash command the audit does not mark reachable or a settings path the schema
 * does not define. `command` means Cedia's adapter sends that other command for the same operation.
 */
export interface OmpRpcOtherPath {
	/** The audited RPC command that has no Cedia caller of its own. */
	readonly name: string;
	readonly via: "command" | "slash" | "setting";
	/** The other command, the slash command, or the settings path that carries the operation. */
	readonly value: string;
	readonly reason: string;
}

/**
 * The RPC commands Cedia carries through another path, each checked by `verifyOmpRpcPaths`.
 *
 * Measured 2026-09-24: these are the audited commands with no call site anywhere in Cedia's own
 * sources. Every entry names the Cedia surface that carries the same operation instead of leaving
 * the row integrated because the transport happens to accept the name.
 */
export const OMP_RPC_VIA_OTHER_PATH: readonly OmpRpcOtherPath[] = [
	{ name: "cycle_model", via: "slash", value: "model", reason: "The model picker changes the model through `set_model`; the audit marks `/model` reachable over the prompt path for a model change asked for as a command." },
	{ name: "set_fast_mode", via: "slash", value: "fast", reason: "The audit marks `/fast` reachable over the prompt path; Cedia's composer sends reachable slash commands as text." },
	{ name: "set_todos", via: "slash", value: "todo", reason: "The audit marks `/todo` reachable over the prompt path." },
	{ name: "abort_retry", via: "slash", value: "retry", reason: "The audit marks `/retry` reachable over the prompt path." },
	{ name: "get_session_stats", via: "slash", value: "stats", reason: "The audit marks `/stats` reachable over the prompt path." },
	{ name: "export_html", via: "slash", value: "export", reason: "The audit marks `/export` reachable over the prompt path." },
	{ name: "set_session_name", via: "slash", value: "rename", reason: "The audit marks `/rename` reachable over the prompt path." },
	{ name: "cycle_thinking_level", via: "command", value: "set_thinking_level", reason: "The effort picker sets the level through the audited `set_thinking_level` command rather than cycling it." },
	{ name: "set_steering_mode", via: "setting", value: "steeringMode", reason: "The runtime's own `steeringMode` setting is writable through Cedia's OMP settings surface (§6.4)." },
	{ name: "set_follow_up_mode", via: "setting", value: "followUpMode", reason: "The runtime's own `followUpMode` setting is writable through Cedia's OMP settings surface (§6.4)." },
	{ name: "set_interrupt_mode", via: "setting", value: "interruptMode", reason: "The runtime's own `interruptMode` setting is writable through Cedia's OMP settings surface (§6.4)." },
	{ name: "set_auto_compaction", via: "setting", value: "compaction.enabled", reason: "Auto-compaction is the runtime's own `compaction.enabled` setting, writable through Cedia's OMP settings surface." },
	{ name: "set_auto_retry", via: "setting", value: "retry.enabled", reason: "Auto-retry is the runtime's own `retry.enabled` setting, writable through Cedia's OMP settings surface." },
	{ name: "get_last_assistant_text", via: "command", value: "get_messages", reason: "Cedia reads the task's own transcript through the audited `get_messages` command, which is where the last assistant response comes from." },
];

/**
 * The audited RPC commands Cedia does not carry at all, with the packet that owes each one.
 *
 * These stay gaps: the transport accepts the name, and no Cedia surface performs the operation.
 */
export const OMP_RPC_UNCARRIED: readonly { readonly name: string; readonly packet: string; readonly reason: string }[] = [
	{ name: "get_subagent_messages", packet: "O07", reason: "A subagent's own transcript has no Cedia view yet." },
	{ name: "bash", packet: "O11", reason: "The runtime's session bash mode is separate from the host user shell and the IDE terminal, and Cedia has no control for it; the `bash` tool inside a turn is a different path." },
	{ name: "abort_bash", packet: "O11", reason: "Stopping that session bash mode has no Cedia control because starting it has none." },
];

/** Check every non-call path against the audit, so a link cannot name something that is not there. */
export function verifyOmpRpcPaths(
	links: readonly OmpRpcOtherPath[],
	inputs: {
		readonly auditedRpcCommands: ReadonlySet<string>;
		readonly reachableSlashCommands: ReadonlySet<string>;
		readonly settingsPaths: ReadonlySet<string>;
		readonly cediaAdapterSource?: string;
	},
): readonly OmpCoverageIssue[] {
	const issues: OmpCoverageIssue[] = [];
	for (const link of links) {
		if (inputs.auditedRpcCommands.has(link.name) === false) {
			issues.push({ kind: "unclassified", name: link.name, message: `RPC path link names '${link.name}', which the dated audit does not record as an RPC command.` });
			continue;
		}
		if (link.via === "slash" && !inputs.reachableSlashCommands.has(link.value)) {
			issues.push({ kind: "unclassified", name: link.name, message: `RPC path link claims /${link.value}, which the audit does not mark reachable over the prompt path.` });
			continue;
		}
		if (link.via === "setting" && !inputs.settingsPaths.has(link.value)) {
			issues.push({ kind: "unclassified", name: link.name, message: `RPC path link claims the setting '${link.value}', which the runtime's schema does not define.` });
			continue;
		}
		if (link.via === "command") {
			const source = inputs.cediaAdapterSource;
			if (source === undefined) {
				issues.push({ kind: "source_missing", name: link.name, message: `RPC path link '${link.name}' claims Cedia sends '${link.value}', but Cedia's adapter source was not readable.` });
				continue;
			}
			if (!source.includes(`"${link.value}"`)) {
				issues.push({ kind: "unclassified", name: link.name, message: `RPC path link '${link.name}' claims Cedia sends '${link.value}', which the adapter no longer sends.` });
			}
		}
	}
	return issues;
}

export interface OmpSdkSourceLink {
	/** The SDK method name exactly as the audit records it. */
	readonly name: string;
	/** The audited RPC command that carries the same operation. */
	readonly rpcCommand: string;
	/** When present, this SDK operation is carried by the checked path named below. */
	readonly via?: "command" | "slash" | "setting";
	/** Reachable slash command or runtime setting path used by `via`. */
	readonly value?: string;
}

/**
 * An SDK operation Cedia carries in the window without asking OMP to retarget a live session.
 *
 * This is deliberately a separate link kind: a task navigation changes the selected Cedia
 * task, while each task keeps its own host-owned OMP runtime. It therefore has no `rpcCommand`.
 * Both the navigation source and its behavioral receipt are checked so a stale table cannot turn
 * the absence of an RPC carrier into a green mapping.
 */
export interface OmpSdkWindowLocalLink {
	/** The SDK method name exactly as the audit records it. */
	readonly name: string;
	/** Repo-relative source that selects a task in the Cedia window. */
	readonly source: string;
	/** Source markers that identify the task lookup and local state replacement. */
	readonly sourceNeedles: readonly string[];
	/** Behavioral receipts that prove the selected tasks retain independent owners. */
	readonly testFiles: readonly { readonly path: string; readonly needles: readonly string[] }[];
	readonly reason: string;
}

/** The audited SDK operation carried by Cedia's window-local task navigation. */
export const OMP_SDK_VIA_WINDOW_LOCAL: readonly OmpSdkWindowLocalLink[] = [
	{
		name: "switchSession",
		source: "apps/macos/src/provider-projects.ts",
		sourceNeedles: ["async selectSession", "client.getSession(id)", 'type: "reset"'],
		testFiles: [
			{
				path: "apps/macos/agent-window/test/native-handoff.test.ts",
				needles: ["window-local task navigation keeps each task runtime distinct without an OMP retarget command"],
			},
			{
				path: "apps/host/test/service.test.ts",
				needles: ["keeps both task runtimes independently owned while window-local navigation changes the selected task"],
			},
			{
				path: "apps/macos/test/workbench-mode.test.ts",
				needles: ["uses window-local task selection while keeping each durable runtime identity distinct"],
			},
		],
		reason: "Cedia selects another durable task in the window; each task keeps its own host-owned OMP runtime, so navigation never sends switch_session, abort, or a retarget command.",
	},
];

/**
 * The SDK operations Cedia carries over RPC today.
 *
 * Every one of these is a literal command name in a Cedia client source;
 * `verifyOmpSdkSourceLinks` fails if that stops being true. The adapter source is the default
 * client, while `cediaSourceTexts` lets a native provider surface prove a command it owns.
 */
export const OMP_SDK_VIA_RPC: readonly OmpSdkSourceLink[] = [
	{ name: "prompt", rpcCommand: "prompt" },
	{ name: "steer", rpcCommand: "steer" },
	{ name: "followUp", rpcCommand: "follow_up" },
	{ name: "abort", rpcCommand: "abort" },
	{ name: "setModel", rpcCommand: "set_model" },
	{ name: "setThinkingLevel", rpcCommand: "set_thinking_level" },
	{ name: "branch", rpcCommand: "branch" },
	{ name: "compact", rpcCommand: "compact" },
	{ name: "getAvailableModels", rpcCommand: "get_available_models" },
	{ name: "getContextUsage", rpcCommand: "get_state" },
];

/**
 * SDK methods whose operation is carried by a checked Cedia path other than a direct RPC call.
 *
 * Slash links rely on the audit marking the command reachable over RPC/ACP and on Cedia's adapter
 * sending the prompt path. Settings links rely on the audited runtime schema and on the adapter's
 * `/v1/omp/settings` route. Keeping these links beside the RPC links lets one verifier reject a
 * stale audit path or a removed Cedia client surface instead of turning a semantic guess into an
 * available SDK record.
 */
export const OMP_SDK_VIA_OTHER_PATH: readonly OmpSdkSourceLink[] = [
	{ name: "setFastMode", rpcCommand: "set_fast_mode", via: "slash", value: "fast" },
	{ name: "setTodoPhases", rpcCommand: "set_todos", via: "slash", value: "todo" },
	// `/retry` runs the session's own `retry()` (builtin-lifecycle.ts), and Cedia's composer sends a
	// reachable slash command as text, so the retry operation is carried that way. `abortRetry` - the
	// *cancel* of a scheduled retry - is deliberately not credited to that same carrier: the gate
	// credits one audited command to one SDK operation, and Cedia has no separate cancel-retry control
	// (its Stop is the session's own `abort`, which is already the carrier for the `abort` row).
	{ name: "retry", rpcCommand: "abort_retry", via: "slash", value: "retry" },
	// The base prompt is rebuilt by OMP itself: its own settings listener answers a change to
	// `browser.enabled`/`computer.enabled` by rebuilding the prompt and re-applying the tools, and the
	// host's `set_host_tools` handshake drives the same rebuild. Both paths are Cedia's, so this names
	// the settings surface with the audited host-tools command that grounds it.
	{ name: "refreshBaseSystemPrompt", rpcCommand: "set_host_tools", via: "setting", value: "browser.enabled" },
	{ name: "getSessionStats", rpcCommand: "get_session_stats", via: "slash", value: "stats" },
	{ name: "exportToHtml", rpcCommand: "export_html", via: "slash", value: "export" },
	{ name: "setSessionName", rpcCommand: "set_session_name", via: "slash", value: "rename" },
	{ name: "getLastAssistantText", rpcCommand: "get_last_assistant_text", via: "command", value: "get_messages" },
	// Cycling the model is the operation behind `/model`: the audit marks that command reachable over
	// the prompt path, and Cedia's composer sends a reachable slash command as text. The picker's own
	// direct selection is the `setModel` row above, so this carries the cycling operation only.
	{ name: "cycleModel", rpcCommand: "cycle_model", via: "slash", value: "model" },
	{ name: "setAutoCompactionEnabled", rpcCommand: "set_auto_compaction", via: "setting", value: "compaction.enabled" },
	{ name: "setAutoRetryEnabled", rpcCommand: "set_auto_retry", via: "setting", value: "retry.enabled" },
];

/**
 * An audited SDK operation performed by an audited slash command's own handler.
 *
 * Some SDK operations have no audited RPC command and no registered `cedia_control`
 * operation, but the terminal command that performs them IS reachable over the prompt path:
 * Cedia's composer sends the slash text, and the runtime's own handler runs the SDK method.
 * A row here is settled while the audit marks the command reachable and the adapter still
 * sends the prompt path — the same two facts that settle the slash row itself. This table is
 * deliberately small: most slash-performed operations have an audited RPC command and belong
 * in `OMP_SDK_VIA_OTHER_PATH` instead.
 */
export interface OmpSdkViaSlash {
	/** The SDK method name exactly as the audit records it. */
	readonly name: string;
	/** The audited slash command whose handler performs the operation. */
	readonly slash: string;
}

export const OMP_SDK_VIA_SLASH: readonly OmpSdkViaSlash[] = [
	// Arming prewalk outside startup is what `/prewalk` does: it resolves `@smol`, checks for
	// a configured auth, and calls the session's own `armPrewalk` (builtin-modes.ts). No
	// audited RPC names the operation, so the reachable command itself is the carrier.
	{ name: "armPrewalk", slash: "prewalk" },
	// Reading the async job snapshot is what `/jobs` does: its handler calls the session's own
	// `getAsyncJobSnapshot` and renders the running/recent rows (builtin-session.ts). Same
	// position: the command is the carrier, and the composer is where Cedia sends it.
	{ name: "getAsyncJobSnapshot", slash: "jobs" },
	// Refreshing MCP tools is what `/mcp reload` (and reconnect/enable/disable) does: the controller rediscovers through its own manager and calls the session's own
	// `refreshMCPTools(manager.getTools())` (mcp-command-controller.ts `reloadServers`). No
	// audited RPC names the operation, so the reachable command itself is the carrier. Cedia
	// never synthesizes the discovery-produced array; the runtime's own handler supplies it.
	{ name: "refreshMCPTools", slash: "mcp" },
	// Switching to a named model for this session only is what `/switch <model>` does: it
	// resolves the selector and calls the session's own `setModelTemporary` (builtin-modes.ts
	// `/switch` handle). No audited RPC names the operation, so the reachable command itself
	// is the carrier. The bare form only reports the current model; the with-args form is the
	// carrier, proven live to take effect with no turn and no provider call.
	{ name: "setModelTemporary", slash: "switch" },
	// Relocating the session to an existing directory is what `/move <path>` does: the
	// headless handler (`relocateHeadlessSession` in builtin-lifecycle.ts) calls the
	// session's own `moveSession`, which renames the session file under the destination.
	// No audited RPC names the operation, so the reachable command itself is the carrier.
	// The bare form hangs on its overlay cancel path and stays fenced; the with-args form
	// is the carrier, proven live to relocate with no turn and no provider call.
	{ name: "moveSession", slash: "move" },
];

/**
 * An SDK operation Cedia reaches through an operation the pinned runtime registers.
 *
 * `cedia_control` is the plan's home for behaviour that has no direct RPC command, so a link here
 * is settled against the table the running runtime itself advertises rather than against a Cedia
 * literal that could keep describing a surface the runtime no longer has.
 */
/**
 * An SDK operation that is OMP's own behaviour rather than a client operation.
 *
 * Some of the audited SDK surface is plumbing a client never asks for: a capture OMP runs inside its
 * own turn, an internal prompt rebuild its settings listener triggers. Those are real, but they are
 * not a Cedia surface waiting to be built, and inventing a control for them would duplicate OMP's
 * own flow. A row here therefore carries a disposition, a reason and *source evidence* - the file
 * and the literals that must still be there - so the claim cannot outlive the code it describes.
 */
export interface OmpSdkDisposition {
	readonly name: string;
	readonly disposition: OmpDisposition;
	readonly reason: string;
	readonly presentation: string;
	/** A repo-relative source file and the literals that must still appear in it. */
	readonly evidence: { readonly file: string; readonly needles: readonly string[] };
}

/**
 * The SDK operations Cedia does not expose as controls, each with the code that proves why.
 *
 * These are deliberately few. A row belongs here when the operation runs as part of OMP's own flow
 * and no client can meaningfully request it separately, or when Cedia carries the same operation
 * through a different OMP entry point the runtime itself owns (a session created at runtime start
 * rather than by an in-session call, for example) and the Cedia source below proves that path.
 */
export const OMP_SDK_DISPOSITIONS: readonly OmpSdkDisposition[] = [
	{
		name: "abortRetry",
		disposition: "platform_presentation_equivalent",
		reason:
			"Cancelling a scheduled retry is part of OMP's own abort flow: `AgentSession.abort()` (and disposal) calls `abortRetry()`, so Cedia's Stop - the runtime's own `abort` command - is what carries it. There is no separate Cedia control because there is no separate user action: the owner stops the run, and the runtime cancels whatever retry it had scheduled.",
		presentation:
			"Cedia's composer Stop sends the runtime's own `abort`, which cancels a scheduled retry as part of aborting the run.",
		evidence: {
			file: "upstream/omp/packages/coding-agent/src/session/agent-session.ts",
			needles: ["abortRetry(): void {", "this.abortRetry();"],
		},
	},
	{
		name: "runAutolearnCapture",
		disposition: "platform_presentation_equivalent",
		reason:
			"OMP runs an auto-learn capture itself during a turn, outside the primary loop, and its tools are gated by `autolearn.enabled` - the setting Cedia's settings destination owns. There is no client operation to expose, and the capture writes the managed skills and rules the agent then carries.",
		presentation:
			"Cedia's OMP settings destination owns `autolearn.enabled`; the capture itself runs inside the runtime's own turn.",
		evidence: {
			file: "upstream/omp/packages/coding-agent/src/session/agent-session.ts",
			needles: ["async runAutolearnCapture(capture", "#autolearnCaptureAbortController"],
		},
	},
	{
		name: "buildDisplaySessionContext",
		disposition: "platform_presentation_equivalent",
		reason:
			"The runtime builds this context itself: it is the projection the provider boundary hands a session, called inside OMP when a turn needs it, and no client asks for it separately. Cedia renders the task's transcript from the runtime's own session events, so a client operation for the builder would duplicate OMP's own flow.",
		presentation:
			"Cedia renders the task's transcript from the runtime's own session events; the runtime builds its display context internally.",
		evidence: {
			file: "upstream/omp/packages/coding-agent/src/session/session-provider-boundary.ts",
			needles: ["buildDisplaySessionContext(): SessionContext {"],
		},
	},
	{
		name: "buildTranscriptSessionContext",
		disposition: "platform_presentation_equivalent",
		reason:
			"Same rule as the display context: the transcript context is built by the runtime when it needs one - compaction, a transcript export, a provider boundary call - not on a client request. Cedia reads the runtime's own transcript instead.",
		presentation:
			"Cedia reads the runtime's own transcript through `get_messages` and the registered `history.transcript` operation instead of asking for a context object.",
		evidence: {
			file: "upstream/omp/packages/coding-agent/src/session/session-provider-boundary.ts",
			needles: ["buildTranscriptSessionContext("],
		},
	},
	{
		name: "fork",
		disposition: "platform_presentation_equivalent",
		reason:
			"Cedia's Fork is the same operation through a different OMP entry point: the host starts the pinned runtime with OMP's own `--fork`, which copies the source session journal and artifacts into the fork, so the fork exists as a real runtime with its own transcript rather than as an in-session call. A second, in-session fork would give one operation two owners.",
		presentation:
			"Cedia's Fork action (the task row's own Fork, `POST /v1/sessions/:id/fork`, and the Sidechat panel that uses the same mechanism) starts the forked task's runtime with `--fork`.",
		evidence: {
			file: "apps/host/src/service.ts",
			needles: ["\"--fork\""],
		},
	},
	{
		name: "extensionRunner",
		disposition: "platform_presentation_equivalent",
		reason:
			"The extension runner is OMP's own in-process bus: the session holds it, controllers draw commands and renderers from it, and its hook emissions run inside OMP's own turn flow. No client asks the runner for anything separately — its observable effects already surface (extension commands through `get_available_commands` and the `available_commands_update` push, extension tools through the tool catalog), so a Cedia control for the handle itself would duplicate OMP's own flow.",
		presentation:
			"Cedia never touches the runner handle; extension commands reach the composer menu and extension tools reach the Tool catalog panel, both drawn from the runtime's own registry.",
		evidence: {
			file: "upstream/omp/packages/coding-agent/src/session/agent-session.ts",
			needles: ["#extensionRunner", "this.#extensionRunner = config.extensionRunner"],
		},
	},
	{
		name: "subscribeCommandMetadataChanged",
		disposition: "platform_presentation_equivalent",
		reason:
			"Command metadata stays fresh without a client poll: rpc-mode subscribes to the session's own metadata changes itself and emits an `available_commands_update` frame, and Cedia's task state applies that frame to `slashCommands`, so the composer's command menu follows OMP rather than a cached list. There is no Cedia control because there is no user action: the runtime pushes, Cedia applies.",
		presentation:
			"Cedia's task state applies the runtime's `available_commands_update` frame to `slashCommands` (apps/macos/src/state.ts#applyFrame), so the composer menu follows OMP's command metadata.",
		evidence: {
			file: "upstream/omp/packages/coding-agent/src/modes/rpc/rpc-mode.ts",
			needles: ["subscribeCommandMetadataChanged", "available_commands_update"],
		},
	},
	{
		name: "subscribe",
		disposition: "platform_presentation_equivalent",
		reason:
			"rpc-mode owns the forwarding subscription itself: every session event is forwarded to the RPC client, and Cedia applies each frame through its typed session-event registry and frame reducer. There is no client-side subscribe because the runtime subscribes itself; a second Cedia subscription would be a second owner of the same stream.",
		presentation:
			"Cedia applies every forwarded session event frame (transcript, tools, queue, lifecycle); the runtime owns the subscription that forwards them.",
		evidence: {
			file: "upstream/omp/packages/coding-agent/src/modes/rpc/rpc-mode.ts",
			needles: ["session.subscribe(event => {", "sessionEvents.forward({"],
		},
	},
	{
		name: "subscribeRunState",
		disposition: "platform_presentation_equivalent",
		reason:
			"The run-state listener registry serves lifecycle owners that must observe running/idle transitions; its in-tree subscriber is the global agent lifecycle, which Cedia deliberately does not join (a caller-supplied registry would misreport cancels against an unrelated global ref). Cedia reads running/idle from OMP's turn boundaries and its queue projection instead.",
		presentation:
			"Cedia reads run state from OMP's turn boundaries and the queue panel, not from the global lifecycle registry.",
		evidence: {
			file: "upstream/omp/packages/coding-agent/src/session/agent-session.ts",
			needles: ["subscribeRunState(listener", "#runStateListeners"],
		},
	},
	{
		name: "sendCustomMessage",
		disposition: "platform_presentation_equivalent",
		reason:
			"Internal injection for mode-context and continuation messages inside flows Cedia already drives through registered operations (goal.set, plan.set and plan.review steer context while streaming); every owner submission enters through prompt, steer or follow_up, so a client operation for the injector would duplicate the flows that own it.",
		presentation:
			"Mode-context and continuation injection rides inside the goal/plan operations Cedia drives; owner turns enter through prompt, steer or follow_up.",
		evidence: {
			file: "upstream/omp/packages/coding-agent/src/session/agent-session.ts",
			needles: ["async sendCustomMessage", "async sendGoalModeContext"],
		},
	},
	{
		name: "sendUserMessage",
		disposition: "platform_presentation_equivalent",
		reason:
			"Extension-originated injection inside OMP's own turn flow: extensions loaded in the runtime may schedule follow-up work while a prompt runs, and the runtime's own per-prompt tracker attributes it so the host's agentInvoked accounting stays exact. Cedia never injects outside prompt, steer and follow_up, so there is no Cedia caller for this injector.",
		presentation:
			"Extension follow-up work is attributed to the running prompt by the runtime's own tracker; owner submissions travel prompt, steer or follow_up.",
		evidence: {
			file: "upstream/omp/packages/coding-agent/src/modes/rpc/rpc-prompt-results.ts",
			needles: ["RpcExtensionUserMessageTracker", "pi.sendUserMessage() or pi.sendMessage()"],
		},
	},
	{
		name: "beginDispose",
		disposition: "platform_presentation_equivalent",
		reason:
			"The synchronous disposal guard inside OMP's own teardown: it marks the session disposed so new work is rejected immediately, and dispose() runs it first on the runtime's own shutdown paths. It is never a client operation — Cedia ends a session by closing the runtime client through its host lifecycle.",
		presentation:
			"Disposal guards run on OMP's own shutdown paths when the runtime stops; Cedia ends a session by closing the client.",
		evidence: {
			file: "upstream/omp/packages/coding-agent/src/session/agent-session.ts",
			needles: ["beginDispose(): void {", "eval starts throw, queued asides are dropped"],
		},
	},
	{
		name: "dispose",
		disposition: "platform_presentation_equivalent",
		reason:
			"Terminal in-process teardown — listeners removed, writes flushed, agent disconnected, owned jobs drained — on OMP's own shutdown paths (keypress shutdown, SIGTERM/SIGHUP, uncaught exception). Cedia ends a session by closing the runtime client through its host lifecycle and never invokes disposal itself.",
		presentation:
			"Cedia ends a session by closing the runtime client; in-process teardown is OMP's own shutdown flow.",
		evidence: {
			file: "upstream/omp/packages/coding-agent/src/session/agent-session.ts",
			needles: ["dispose(options: AgentSessionDisposeOptions", "Remove all listeners, flush pending writes"],
		},
	},
	{
		name: "activeToolExecutionUpdates",
		disposition: "platform_presentation_equivalent",
		reason:
			"The unpersisted display-result snapshot a TUI focus rebuild replays after reconstructing persisted transcript state. Headless Cedia never rebuilds focus: live tool progress arrives as tool_execution frames on the wire, which the tool cards already render, so the snapshot has no Cedia reader.",
		presentation:
			"Tool progress reaches Cedia as tool_execution frames on the wire and renders on the tool cards, not through the focus-rebuild snapshot.",
		evidence: {
			file: "upstream/omp/packages/coding-agent/src/session/agent-session.ts",
			needles: ["activeToolExecutionUpdates(): readonly", "Focus rebuilds replay these"],
		},
	},
	{
		name: "initializeCodeMode",
		disposition: "platform_presentation_equivalent",
		reason:
			"Code Mode is applied by OMP's own startup and settings flow: the SDK path initializes it once when the session starts on a Code Mode model, and the session re-reconciles it whenever the code-mode setting changes. No client initializes it separately — the restricted direct surface and namespaces snapshot exist before the first provider turn without any client call.",
		presentation:
			"Cedia sessions start with the runtime's own Code Mode surface already applied; there is no client operation to initialize it.",
		evidence: {
			file: "upstream/omp/packages/coding-agent/src/session/agent-session.ts",
			needles: ["initializeCodeMode(): Promise<void> {", "reconcileCodeMode().catch"],
		},
	},
	{
		name: "reload",
		disposition: "platform_presentation_equivalent",
		reason:
			"The session-reload action in the extension command-context table, invoked by extension, ACP and TUI hosts — never by Cedia. Cedia resumes sessions by starting runtimes (archive/restore) and never reloads inside one, so a client operation for the reload would duplicate a host Cedia does not use.",
		presentation:
			"Cedia resumes a task by starting its runtime (archive/restore Continue); nothing reloads a live session in place.",
		evidence: {
			file: "upstream/omp/packages/coding-agent/src/session/agent-session.ts",
			needles: ["reload: async () => {", "await this.reload();"],
		},
	},
	{
		name: "hasPendingAsyncWork",
		disposition: "platform_presentation_equivalent",
		reason:
			"The quiescence barrier the task executor polls inside OMP's own turn flow to tell a scheduling pause from terminal completion. Cedia observes turn outcomes at boundaries; polling the barrier from outside would duplicate the executor instead of reading it.",
		presentation:
			"Cedia reads turn outcomes from OMP's turn boundaries and its turn projection; the barrier that holds a turn open stays inside the executor.",
		evidence: {
			file: "upstream/omp/packages/coding-agent/src/session/agent-session.ts",
			needles: ["hasPendingAsyncWork(): boolean {", "return this.#hasPendingAsyncWake();"],
		},
	},
	{
		name: "settleAsyncWork",
		disposition: "platform_presentation_equivalent",
		reason:
			"Draining owner-scoped async work inside OMP's own turn completion: the task executor calls it and loops while the quiescence barrier holds, delivering queued results as follow-up turns. It runs as part of finishing a turn, not as a client operation.",
		presentation:
			"Async results arrive through OMP's own follow-up turns; Cedia never drains the queue itself.",
		evidence: {
			file: "upstream/omp/packages/coding-agent/src/session/agent-session.ts",
			needles: ["async settleAsyncWork(): Promise<void> {", "waitForOwnerJobs"],
		},
	},
	{
		name: "getWorkPoolYieldItems",
		disposition: "platform_presentation_equivalent",
		reason:
			"The live pooled-turn yield contract the executor installs at run start and the yield tool enforces during a turn: the executor sets the items from launch options, reinstalls them around prompt races, the pool clears them when retiring idle workers, and the yield tool reads them to decide which pooled items a turn may submit. A client reading or replacing that contract has no user action behind it — turn outcomes already reach Cedia through its turn projection.",
		presentation:
			"Pooled-turn results arrive through OMP's own turns and Cedia's turn projection; Cedia never reads or replaces the yield contract itself.",
		evidence: {
			file: "upstream/omp/packages/coding-agent/src/session/agent-session.ts",
			needles: ["getWorkPoolYieldItems(): readonly WorkPoolYieldItem[] {", "return this.#workPoolYieldItems;"],
		},
	},
	{
		name: "setWorkPoolYieldItems",
		disposition: "platform_presentation_equivalent",
		reason:
			"Installing or clearing the pooled-turn yield contract is the executor's and the pool scheduler's own work — at run start, around prompt races, and when retiring idle workers — and the setter rebuilds the provider prompt as part of it. A Cedia control supplying its own items would corrupt the contract the yield tool enforces, so there is no client operation to expose.",
		presentation:
			"Cedia starts and resumes tasks through its own session lifecycle; the yield contract inside a pooled run stays with the executor that owns it.",
		evidence: {
			file: "upstream/omp/packages/coding-agent/src/session/agent-session.ts",
			needles: ["setWorkPoolYieldItems(items: readonly WorkPoolYieldItem[]): Promise<void> {", "this.#workPoolYieldItems = applied;"],
		},
	},
	{
		name: "deliverIrcMessage",
		disposition: "platform_presentation_equivalent",
		reason:
			"Agent-to-agent delivery inside OMP's own runs: the IRC bus calls it to inject a message into a recipient session or wake it with a real turn. No client addresses the bus — Cedia sees the conversation through transcripts, tool cards and the Agents roster instead.",
		presentation:
			"Agent messages travel inside OMP's runs; Cedia renders transcripts, tool calls and the subagent roster, never the bus.",
		evidence: {
			file: "upstream/omp/packages/coding-agent/src/session/agent-session.ts",
			needles: ["deliverIrcMessage(msg: IrcMessage)", "return this.#irc.deliver(msg);"],
		},
	},
	{
		name: "drainPendingIrcInboxMessages",
		disposition: "platform_presentation_equivalent",
		reason:
			"The inbox read behind the agents' own IRC tool: an agent surfaces and consumes its pending records before automatic injection, mid-turn. The tool call itself renders on Cedia's tool cards like every other tool; the drain behind it is not a separate client operation.",
		presentation:
			"IRC tool calls render on Cedia's tool cards; the inbox drain behind them stays inside the turn.",
		evidence: {
			file: "upstream/omp/packages/coding-agent/src/session/agent-session.ts",
			needles: ["drainPendingIrcInboxMessages(agentId: string", "this.#irc.drainInboxMessages(agentId, opts)"],
		},
	},
	{
		name: "waitForIrcReplies",
		disposition: "platform_presentation_equivalent",
		reason:
			"Waiting out the IRC replies a session still owes its peers (auto-replies, wake-turn relays), observed by the bus after delivery. Peers hold their stop verdict on it inside OMP's own flow; no client waits on it separately.",
		presentation:
			"Reply obligations settle inside OMP's runs; Cedia observes the resulting turns, not the wait.",
		evidence: {
			file: "upstream/omp/packages/coding-agent/src/session/agent-session.ts",
			needles: ["waitForIrcReplies(): Promise<void> {", "this.#irc.waitForReplies()"],
		},
	},
];

/** Read each disposition's evidence file and assert the literals are still there. */
export function verifyOmpSdkDispositions(
	dispositions: readonly OmpSdkDisposition[],
	inputs: { readonly readFile: (path: string) => string | undefined; readonly auditedSdkNames?: ReadonlySet<string> },
): readonly OmpCoverageIssue[] {
	const issues: OmpCoverageIssue[] = [];
	for (const row of dispositions) {
		if (inputs.auditedSdkNames !== undefined && !inputs.auditedSdkNames.has(row.name)) {
			issues.push({ kind: "orphan", recordKind: "sdk", name: row.name, message: `SDK disposition '${row.name}' is absent from the dated SDK audit.` });
			continue;
		}
		const text = inputs.readFile(row.evidence.file);
		if (text === undefined) {
			issues.push({ kind: "source_missing", name: row.name, message: `SDK disposition '${row.name}' names '${row.evidence.file}', which could not be read.` });
			continue;
		}
		for (const needle of row.evidence.needles) {
			if (!text.includes(needle)) {
				issues.push({
					kind: "unclassified",
					name: row.name,
					message: `SDK disposition '${row.name}' claims '${needle}' in ${row.evidence.file}, which is no longer there.`,
				});
			}
		}
	}
	return issues;
}

export interface OmpSdkViaOperation {
	/** The SDK method name exactly as the audit records it. */
	readonly name: string;
	/** The registered operation id, as the runtime's own capability table publishes it. */
	readonly operation: string;
}

/**
 * The SDK operations Cedia carries over a registered `cedia_control` operation.
 *
 * Measured 2026-09-24: each names the runtime's own goal-mode surface, whose handlers drive
 * `AgentSession.getGoalModeState`/`setGoalModeState` and the session's `GoalRuntime`.
 */
export const OMP_SDK_VIA_OPERATION: readonly OmpSdkViaOperation[] = [
	{ name: "getGoalModeState", operation: "goal.get" },
	{ name: "setGoalModeState", operation: "goal.set" },
	{ name: "goalRuntime", operation: "goal.set" },
	// Entering a goal steers its context into work in flight: the Cedia goal bridge's own
	// `startGoal` (backing `goal.set`/`goal.replace`) runs the session's
	// `sendGoalModeContext({ deliverAs: "steer" })` while streaming, exactly as `/goal` does.
	{ name: "sendGoalModeContext", operation: "goal.set" },
	// Plan and vibe mode are one surface in Cedia: the composer strip reads both states through
	// `plan.get`, drives both mode transitions through `plan.set`, and answers the plan review the
	// runtime holds through `plan.review` (plan §8.2 O07).
	{ name: "getPlanModeState", operation: "plan.get" },
	{ name: "setPlanModeState", operation: "plan.set" },
	{ name: "sendPlanModeContext", operation: "plan.set" },
	{ name: "preparePlanForReview", operation: "plan.review" },
	{ name: "getVibeModeState", operation: "plan.get" },
	{ name: "setVibeModeState", operation: "plan.set" },
	{ name: "sendVibeModeContext", operation: "plan.set" },
	// The task's progress is the runtime's own todo phases. Cedia reads them through the registered
	// `progress.get` operation (the same list `get_state` and the `todo` tool's result carry), which
	// keeps one command from standing in for two unrelated operations in the RPC table.
	{ name: "getTodoPhases", operation: "progress.get" },
	// The queue the owner's own submissions sit in while a turn runs. The window's queue panel
	// reads it through the registered `queue.get` and removes from it through `queue.drop`, which
	// are the session's own `getQueuedMessages`/`popLastQueuedMessage`/`clearQueue` (§8.2 O01);
	// Cedia keeps no second queue, so a row here cannot outlive the registration it names.
	{ name: "getQueuedMessages", operation: "queue.get" },
	{ name: "popLastQueuedMessage", operation: "queue.drop" },
	{ name: "clearQueue", operation: "queue.drop" },
	// The context window is OMP's own accounting: the drawer reads the runtime's breakdown through
	// `context.get`, strips images through `context.drop-images` (the session's own `dropImages`) and
	// cancels active maintenance through `context.abort-compaction` (the session's own
	// `abortCompaction`), which answers the state that follows (§8.2 O09).
	{ name: "getContextBreakdown", operation: "context.get" },
	{ name: "dropImages", operation: "context.drop-images" },
	{ name: "abortCompaction", operation: "context.abort-compaction" },
	// Python runs one-shot through the session's shared kernel, answered when it finishes, is
	// aborted, or the kernel refuses it. The dispatcher runs the exec in the background (like
	// `bash`) so the abort is read while code still runs; display-output bytes never cross.
	{ name: "executePython", operation: "python.exec" },
	{ name: "abortEval", operation: "python.abort" },
	// Reducing stored context is the runtime's own strategies, reached through `context.shake`.
	{ name: "shake", operation: "context.shake" },
	// Memory is the session's own backend: its two session states are read through `memory.get` and
	// the backend is applied through `memory.apply` (the session's own `applyMemoryBackend`). The
	// projection carries shape rather than content, so a row here cannot publish a memory row.
	{ name: "getMnemopiSessionState", operation: "memory.get" },
	{ name: "getHindsightSessionState", operation: "memory.get" },
	{ name: "applyMemoryBackend", operation: "memory.apply" },
	// Provider usage is OMP's own snapshot: the Usage panel reads the reports the auth storage
	// fetches, with an amount the provider did not report left absent rather than zeroed.
	{ name: "fetchUsageReports", operation: "usage.get" },
	// Saved resets: OMP lists each stored account and spends one only when the owner's own confirmed
	// request names it. The automatic paths stay off under Cedia's policy layer, not here.
	{ name: "listResetCredits", operation: "credits.get" },
	{ name: "redeemResetCredit", operation: "credits.redeem" },
	// The advisor is the session's own second model; Cedia reads its state and spend, switches it,
	// reads its transcript, and writes its `WATCHDOG.yml` roster through four registered operations
	// (plan §8.2 O07). A config write validates the raw text strictly before touching disk, then
	// re-discovers the merged roster and applies it without a restart — the `/advisor configure`
	// save path without the terminal overlay.
	{ name: "setAdvisorEnabled", operation: "advisor.set" },
	{ name: "applyAdvisorConfigs", operation: "advisor.config.set" },
	{ name: "getAdvisorStatusOverview", operation: "advisor.get" },
	{ name: "getAdvisorStats", operation: "advisor.get" },
	{ name: "formatAdvisorHistoryAsText", operation: "advisor.history" },
	// O02's history reads and the two owner-only reset operations. Each one delegates to the
	// session's own method through a registered `cedia_control` operation, and the surface the owner
	// sees is the composer Context panel's History section (plan §8.2 O02).
	{ name: "getCheckpointState", operation: "history.state" },
	{ name: "getLastCompletedRewind", operation: "history.state" },
	{ name: "formatSessionAsText", operation: "history.transcript" },
	{ name: "resetSessionContext", operation: "context.reset" },
	{ name: "freshSession", operation: "session.fresh" },
	// O03's remaining state: the effort the picker must show honestly (what is configured and what
	// the runtime auto-resolved), the service-tier override, and the provider's own OAuth accounts.
	// Each delegates to the session's own method through a registered `cedia_control` operation.
	{ name: "configuredThinkingLevel", operation: "model.state.get" },
	{ name: "autoResolvedThinkingLevel", operation: "model.state.get" },
	{ name: "setServiceTierFamily", operation: "model.service-tier.set" },
	{ name: "listCurrentProviderOAuthAccounts", operation: "auth.accounts.list" },
	{ name: "pinCurrentProviderOAuthAccount", operation: "auth.account.pin" },
	// The session tree: Cedia's Tree surface reads the runtime's own tree through `tree.get` and
	// moves the active branch through `tree.navigate`, which is the session's own `navigateTree`
	// (without the terminal picker's `allowAskReopen`, because Cedia is not that picker).
	{ name: "navigateTree", operation: "tree.navigate" },
	// O06's discovery half: the catalog probe reads the session's own registry metadata through
	// `tools.catalog.get` (the same `getAllToolInfos()` the extension API publishes) beside its
	// activation state (the session's own `getActiveToolNames()`), so dynamic-tool rows can be
	// classified as present or absent instead of guessed (plan §8.2 O06).
	{ name: "getAllToolInfos", operation: "tools.catalog.get" },
	{ name: "getActiveToolNames", operation: "tools.catalog.get" },
	// O06's management half: the Tool catalog panel's enable/disable toggles drive the session's
	// own activation path through `tools.active.set`, which answers the catalog that follows so the
	// panel re-reads what the runtime applied instead of assuming the request (plan §8.2 O06).
	{ name: "setActiveToolsByName", operation: "tools.active.set" },
	// O06's refresh half: the Tool catalog panel's `Refresh` re-runs the session's own skill
	// rediscovery through `tools.refresh-skills`, which answers the catalog that follows (plan §8.2 O06).
	{ name: "refreshSkills", operation: "tools.refresh-skills" },
	// Prewalk arming is the session's own state: Cedia reads it through the registered
	// `prewalk.state.get` operation for the composer status chip (plan §8.2 O07).
	{ name: "getPrewalkState", operation: "prewalk.state.get" },
	// Promoting a side answer forks the session file through the session's own branch path:
	// Cedia's Side-question panel promotes the held answer through the registered `btw.branch`
	// operation and the host adopts the branched file it names (plan §8.2 O02).
	{ name: "branchFromBtw", operation: "btw.branch" },
	// Activating a role is the session's own application path: Cedia resolves the named role
	// through the session's own role cycle and applies it through its own role application,
	// answering the model that followed, for the Settings model-roles section (plan §8.2 O03).
	{ name: "applyRoleModel", operation: "model.roles.apply" },
	// Code Mode's direct partition and prelude flags are the session's own getters: Cedia reads
	// them through the registered `tools.codemode.get` operation for the Tool catalog panel's
	// Code Mode section, carrying names and one boolean each and never prelude sources (plan §8.2 O06).
	{ name: "getCodeModeDirectToolNames", operation: "tools.codemode.get" },
	{ name: "getEvalPreludes", operation: "tools.codemode.get" },
];

/**
 * An audited OMP command Cedia sends from its own host, with the file that sends it.
 *
 * A caller is named rather than assumed: the row is only `integrated` while that file really
 * contains the command. A command whose only claim is that the transport accepts it stays a gap.
 */
export interface OmpRpcCediaCaller {
	readonly name: string;
	/** Repo-relative source that sends the command. */
	readonly caller: string;
}

/**
 * The audited commands Cedia's host sends directly.
 *
 * Measured 2026-09-24: the host's OMP progress projection seeds a task's subagent table with the
 * runtime's own `get_subagents` answer, so the operation is carried by a Cedia caller rather than
 * by a client-side reconstruction of it.
 */
export const OMP_RPC_VIA_CEDIA_CALLER: readonly OmpRpcCediaCaller[] = [
	// The session shell: Cedia's composer Shell panel runs one command at a time through the
	// session's own foreground bash (`apps/host/src/omp-bash.ts` sends the audited commands
	// directly, like the terminal's bash mode does) and cancels through `abort_bash`.
	{ name: "bash", caller: "apps/host/src/omp-bash.ts" },
	{ name: "abort_bash", caller: "apps/host/src/omp-bash.ts" },
	{ name: "get_subagents", caller: "apps/host/src/omp-progress.ts" },
	// The child transcript: Cedia's Agents view opens one agent's transcript through the runtime's own
	// paged command, from the session file the roster names (`apps/host/src/omp-agents.ts`).
	{ name: "get_subagent_messages", caller: "apps/host/src/omp-agents.ts" },
	// Cedia's own URI scheme, handed to the runtime with the reader behind it (`cedia://artifact/…`
	// over the host's content-addressed artifact store) and verified against the runtime's answer.
	{ name: "set_host_uri_schemes", caller: "apps/host/src/service.ts" },
];

/** Prove each named caller still sends the command it is credited with. */
export function verifyOmpRpcCediaCallers(
	links: readonly OmpRpcCediaCaller[],
	inputs: { readonly sourceTexts: ReadonlyMap<string, string | undefined> },
): readonly OmpCoverageIssue[] {
	const issues: OmpCoverageIssue[] = [];
	for (const link of links) {
		const text = inputs.sourceTexts.get(link.caller);
		if (text === undefined) {
			issues.push({ kind: "source_missing", name: link.name, message: `RPC caller '${link.caller}' could not be read for ${link.name}.` });
			continue;
		}
		if (!text.includes(`"${link.name}"`)) {
			issues.push({ kind: "unclassified", name: link.name, message: `RPC caller '${link.caller}' no longer sends '${link.name}'.` });
		}
	}
	return issues;
}

/**
 * An SDK operation Cedia carries with an audited RPC command it sends from a named file.
 *
 * The SDK links above read Cedia's renderer sources. A session-lifecycle operation can have its
 * only real caller in the host - the process that owns the runtime - so the same rule applies to
 * that caller instead: the file is re-read and must still contain the command literal, and the
 * command must be one the dated audit records as an RPC command.
 */
export interface OmpSdkCediaCaller {
	readonly name: string;
	/** The audited RPC command that carries the same operation. */
	readonly rpcCommand: string;
	/** Repo-relative source that sends the command. */
	readonly caller: string;
}

/**
 * The audited SDK operations Cedia carries from a host caller rather than a renderer.
 *
 * Measured 2026-09-24: the native provider-review surface asks the runtime for a new session that
 * names the parent it continues, which is the session's own `newSession()`; a session Cedia merely
 * observes switching inside one runtime has no caller here and stays a gap.
 *
 * The host's runtime handshake sends the audited `set_host_tools` command
 * (`apps/host/src/service.ts`), and rpc-mode answers that command by running the session's own
 * `refreshRpcHostTools` (`upstream/omp/packages/coding-agent/src/modes/rpc/rpc-mode.ts`), so the
 * refresh is the handshake itself and has no separate Cedia control.
 */
export const OMP_SDK_VIA_CEDIA_CALLER: readonly OmpSdkCediaCaller[] = [
	{ name: "newSession", rpcCommand: "new_session", caller: "apps/macos/src/provider-review.ts" },
	// The audited `bash` command runs the session's own `executeBash` with default options
	// (no chunk streaming over this path); `abort_bash` is its `abortBash`. Both are sent by
	// the host shell projection, never reconstructed.
	{ name: "executeBash", rpcCommand: "bash", caller: "apps/host/src/omp-bash.ts" },
	{ name: "abortBash", rpcCommand: "abort_bash", caller: "apps/host/src/omp-bash.ts" },
	{ name: "refreshRpcHostTools", rpcCommand: "set_host_tools", caller: "apps/host/src/service.ts" },
];

/** Prove each named caller still sends the command it carries, against the dated audit. */
export function verifyOmpSdkCediaCallers(
	links: readonly OmpSdkCediaCaller[],
	inputs: {
		readonly auditedRpcCommands: ReadonlySet<string>;
		readonly auditedSdkNames?: ReadonlySet<string>;
		readonly sourceTexts: ReadonlyMap<string, string | undefined>;
	},
): readonly OmpCoverageIssue[] {
	const issues: OmpCoverageIssue[] = [];
	for (const link of links) {
		if (inputs.auditedSdkNames !== undefined && !inputs.auditedSdkNames.has(link.name)) {
			issues.push({ kind: "orphan", recordKind: "sdk", name: link.name, message: `SDK caller '${link.name}' is absent from the dated SDK audit.` });
			continue;
		}
		if (!inputs.auditedRpcCommands.has(link.rpcCommand)) {
			issues.push({ kind: "unclassified", name: link.name, message: `SDK caller '${link.name}' names '${link.rpcCommand}', which the dated audit does not record as an RPC command.` });
			continue;
		}
		const text = inputs.sourceTexts.get(link.caller);
		if (text === undefined) {
			issues.push({ kind: "source_missing", name: link.name, message: `SDK caller '${link.caller}' could not be read for ${link.name}.` });
			continue;
		}
		if (!text.includes(`"${link.rpcCommand}"`)) {
			issues.push({ kind: "unclassified", name: link.name, message: `SDK caller '${link.caller}' no longer sends '${link.rpcCommand}'.` });
		}
	}
	return issues;
}

/**
 * Prove every operation link against the table the running runtime advertises.
 *
 * A link is valid only while the runtime reports the operation as `available`: if the registration
 * table stops carrying it, the record returns to being a gap instead of staying integrated because
 * a Cedia file still mentions the name.
 */
export function verifyOmpSdkOperationLinks(
	links: readonly OmpSdkViaOperation[],
	inputs: { readonly availableOperations: ReadonlySet<string> | undefined },
): readonly OmpCoverageIssue[] {
	if (inputs.availableOperations === undefined) {
		return links.map(link => ({
			kind: "source_missing" as const,
			name: link.name,
			message: `Operation link '${link.name}' claims '${link.operation}', but no live runtime table was readable.`,
		}));
	}
	const issues: OmpCoverageIssue[] = [];
	for (const link of links) {
		if (!inputs.availableOperations.has(link.operation)) {
			issues.push({
				kind: "unclassified",
				name: link.name,
				message: `Operation link claims '${link.operation}', which the live runtime table does not report as available.`,
			});
		}
	}
	return issues;
}

/**
 * Prove every SDK source link: the audited RPC command exists, and Cedia really carries it.
 *
 * Direct links require the command literal in one of Cedia's client sources. Other-path links also
 * prove the audited slash/settings path and then require the adapter's prompt/settings surface
 * marker. A link whose command or carrying path is no longer present is reported as an unclassified
 * issue rather than quietly left out of the gap list.
 */
export function verifyOmpSdkSourceLinks(
	links: readonly OmpSdkSourceLink[],
	inputs: {
		readonly auditedRpcCommands: ReadonlySet<string>;
		/** SDK method names present in the dated audit; absent names are stale table entries. */
		readonly auditedSdkNames?: ReadonlySet<string>;
		readonly reachableSlashCommands?: ReadonlySet<string>;
		readonly settingsPaths?: ReadonlySet<string>;
		readonly cediaAdapterSource?: string;
		/** Additional Cedia client sources, such as the native OMP provider view. */
		readonly cediaSourceTexts?: readonly string[];
	},
): readonly OmpCoverageIssue[] {
	const issues: OmpCoverageIssue[] = [];
	const adapterSource = inputs.cediaAdapterSource;
	const sourceParts = [inputs.cediaAdapterSource, ...(inputs.cediaSourceTexts ?? [])].filter((source): source is string => typeof source === "string");
	const source = sourceParts.length > 0 ? sourceParts.join("\n") : undefined;
	for (const link of links) {
		if (inputs.auditedSdkNames !== undefined && !inputs.auditedSdkNames.has(link.name)) {
			issues.push({ kind: "orphan", recordKind: "sdk", name: link.name, message: `SDK link '${link.name}' is absent from the dated SDK audit.` });
			continue;
		}
		if (!inputs.auditedRpcCommands.has(link.rpcCommand)) {
			issues.push({
				kind: "unclassified",
				name: link.name,
				message: `SDK link names '${link.rpcCommand}', which the dated audit does not record as an RPC command.`,
			});
			continue;
		}
		if (link.via !== undefined) {
			if (link.value === undefined || link.value.length === 0) {
				issues.push({ kind: "unclassified", name: link.name, message: `SDK path link '${link.name}' does not name a carrying ${link.via} path.` });
				continue;
			}
			const pathIssues = verifyOmpRpcPaths([{
				name: link.rpcCommand,
				via: link.via,
				value: link.value,
				reason: `SDK method '${link.name}' uses this checked path`,
			}], {
				auditedRpcCommands: inputs.auditedRpcCommands,
				reachableSlashCommands: inputs.reachableSlashCommands ?? new Set(),
				settingsPaths: inputs.settingsPaths ?? new Set(),
				...(adapterSource === undefined ? {} : { cediaAdapterSource: adapterSource }),
			}).map(issue => ({ ...issue, name: link.name }));
			if (pathIssues.length > 0) {
				issues.push(...pathIssues);
				continue;
			}
			if (adapterSource === undefined) {
				issues.push({ kind: "source_missing", name: link.name, message: `SDK path link '${link.name}' claims Cedia carries '${link.rpcCommand}', but Cedia client source was not readable.` });
				continue;
			}
			const surfaceNeedle = link.via === "command"
				? `"${link.value}"`
				: link.via === "slash" ? '"prompt"' : "/v1/omp/settings";
			if (!adapterSource.includes(surfaceNeedle)) {
				const surface = link.via === "command" ? `RPC '${link.value}'` : link.via === "slash" ? "prompt path" : "settings surface";
				issues.push({ kind: "unclassified", name: link.name, message: `SDK path link '${link.name}' claims the ${link.via} path '${link.value}', but Cedia no longer sends ${surface}.` });
			}
			continue;
		}
		if (source === undefined) {
			issues.push({
				kind: "source_missing",
				name: link.name,
				message: `SDK link '${link.name}' claims the RPC command '${link.rpcCommand}', but Cedia client source was not readable.`,
			});
			continue;
		}
		if (!source.includes(`"${link.rpcCommand}"`)) {
			issues.push({
				kind: "unclassified",
				name: link.name,
				message: `SDK link '${link.name}' claims the RPC command '${link.rpcCommand}', which Cedia's adapter no longer sends.`,
			});
		}
	}
	return issues;
}

/**
 * Prove every window-local SDK link against readable Cedia source and durable behavior receipts.
 *
 * Unlike RPC and slash links, these rows intentionally have no runtime command to inspect. The
 * source markers must still identify task navigation, and each receipt marker must remain in its
 * named test file; missing or stale evidence is an integrity issue rather than a silent mapping.
 */
export function verifyOmpSdkWindowLocalLinks(
	links: readonly OmpSdkWindowLocalLink[],
	inputs: {
		/** SDK method names present in the dated audit; absent names are stale table entries. */
		readonly auditedSdkNames?: ReadonlySet<string>;
		readonly readFile: (path: string) => string | undefined;
	},
): readonly OmpCoverageIssue[] {
	const issues: OmpCoverageIssue[] = [];
	for (const link of links) {
		if (inputs.auditedSdkNames !== undefined && !inputs.auditedSdkNames.has(link.name)) {
			issues.push({ kind: "orphan", recordKind: "sdk", name: link.name, message: `SDK window-local link '${link.name}' is absent from the dated SDK audit.` });
			continue;
		}
		const source = inputs.readFile(link.source);
		if (source === undefined) {
			issues.push({ kind: "source_missing", name: link.name, message: `SDK window-local link '${link.name}' names '${link.source}', which could not be read.` });
			continue;
		}
		let sourceFailed = false;
		for (const needle of link.sourceNeedles) {
			if (source.includes(needle)) continue;
			issues.push({ kind: "unclassified", name: link.name, message: `SDK window-local link '${link.name}' claims '${needle}' in ${link.source}, which is no longer there.` });
			sourceFailed = true;
		}
		if (sourceFailed) continue;
		for (const testFile of link.testFiles) {
			const test = inputs.readFile(testFile.path);
			if (test === undefined) {
				issues.push({ kind: "source_missing", name: link.name, message: `SDK window-local link '${link.name}' names behavioral receipt '${testFile.path}', which could not be read.` });
				continue;
			}
			for (const needle of testFile.needles) {
				if (test.includes(needle)) continue;
				issues.push({ kind: "unclassified", name: link.name, message: `SDK window-local link '${link.name}' claims behavioral receipt '${needle}' in ${testFile.path}, which is no longer there.` });
			}
		}
	}
	return issues;
}

/**
 * Prove every SDK-via-slash link: the SDK method is audited, the slash command the audit
 * marks reachable over the prompt path, and Cedia's adapter still sends the prompt path that
 * carries it. A slash the audit stops marking reachable, or an adapter that stops sending
 * prompts, returns the row to being a gap instead of leaving it settled on memory.
 */
export function verifyOmpSdkViaSlash(
	links: readonly OmpSdkViaSlash[],
	inputs: {
		/** SDK method names present in the dated audit; absent names are stale table entries. */
		readonly auditedSdkNames?: ReadonlySet<string>;
		readonly reachableSlashCommands?: ReadonlySet<string>;
		readonly cediaAdapterSource?: string;
	},
): readonly OmpCoverageIssue[] {
	const issues: OmpCoverageIssue[] = [];
	for (const link of links) {
		if (inputs.auditedSdkNames !== undefined && !inputs.auditedSdkNames.has(link.name)) {
			issues.push({ kind: "orphan", recordKind: "sdk", name: link.name, message: `SDK slash link '${link.name}' is absent from the dated SDK audit.` });
			continue;
		}
		if (inputs.reachableSlashCommands === undefined || !inputs.reachableSlashCommands.has(link.slash)) {
			issues.push({ kind: "unclassified", name: link.name, message: `SDK slash link '${link.name}' claims /${link.slash}, which the audit does not mark reachable over the prompt path.` });
			continue;
		}
		if (inputs.cediaAdapterSource === undefined) {
			issues.push({ kind: "source_missing", name: link.name, message: `SDK slash link '${link.name}' claims the prompt path, but Cedia client source was not readable.` });
			continue;
		}
		if (!inputs.cediaAdapterSource.includes('"prompt"')) {
			issues.push({ kind: "unclassified", name: link.name, message: `SDK slash link '${link.name}' claims the prompt path, but Cedia no longer sends it.` });
		}
	}
	return issues;
}

function keyOf(kind: string, name: string): string {
	return `${kind}\u0000${name}`;
}

function add(records: OmpAuditedRecord[], kind: string, name: unknown, source?: string): void {
	if (typeof name !== "string" || name.length === 0) return;
	records.push({ kind, name, ...(source === undefined ? {} : { source }) });
}

/** Build the expected source record set exactly as the dated audit verifier does. */
export function buildAuditedRecordSet(input: OmpAuditInputs): readonly OmpAuditedRecord[] {
	const records: OmpAuditedRecord[] = [];
	for (const row of array(input.rpc.commands)) add(records, "rpc", row.name, typeof row.source === "string" ? row.source : undefined);
	for (const row of array(input.configCli.settings)) add(records, "setting", row.path, typeof row.source === "string" ? row.source : undefined);
	for (const row of array(input.configCli.slashCommands)) {
		add(records, "slash", row.name, typeof row.source === "string" ? row.source : undefined);
		for (const alias of array(row.aliases)) add(records, "slash-alias", alias, typeof row.source === "string" ? row.source : undefined);
		for (const subcommand of array(row.subcommands)) {
			const subName = typeof subcommand === "string" ? subcommand : subcommand?.name;
			if (typeof subName === "string" && subName.length > 0) add(records, "slash-subcommand", `${row.name} ${subName}`, typeof row.source === "string" ? row.source : undefined);
		}
	}
	for (const row of array(input.configCli.cliCommands)) {
		add(records, "cli", row.name, typeof row.source === "string" ? row.source : undefined);
		for (const alias of array(row.aliases)) add(records, "cli-alias", alias, typeof row.source === "string" ? row.source : undefined);
	}
	const flags = input.configCli.launchFlags;
	for (const type of ["string", "optional", "boolean"] as const) for (const flag of array(flags?.[type])) add(records, "launch-flag", flag);
	for (const row of array(input.tools.registry?.builtin)) add(records, "tool", row.name, typeof row.source === "string" ? row.source : undefined);
	for (const row of array(input.tools.registry?.hidden)) add(records, "tool", row.name, typeof row.source === "string" ? row.source : undefined);
	for (const alias of Object.keys(input.tools.registry?.aliases ?? {})) add(records, "tool-alias", alias);
	for (const row of array(input.tools.dynamic)) add(records, "dynamic-tool", row.name, typeof row.source === "string" ? row.source : undefined);
	for (const row of array(input.rpc.extensionUiMethods)) add(records, "extension-ui", row.method, typeof row.source === "string" ? row.source : undefined);
	for (const row of array(input.rpc.hostBridgeFrames)) {
		const name = typeof row === "string" ? row : row.type ?? row.name;
		add(records, "host-frame", name, typeof row === "object" && typeof row.source === "string" ? row.source : undefined);
	}
	for (const name of array(input.rpc.sessionEvents?.sourceUnion)) add(records, "event", name);
	for (const row of array(input.sdk.entries)) add(records, "sdk", row.name, typeof row.source === "string" ? row.source : undefined);
	return records;
}

/** Alias used by callers that prefer the shorter name. */
export const buildAuditRecords = buildAuditedRecordSet;

/** Normalize the Cedia implementation inputs without reading source or performing I/O. */
export function buildCediaRecordSet(input: OmpCediaSurfaceInput | readonly OmpCediaEntry[]): readonly OmpCediaEntry[] {
	if (Array.isArray(input)) return (input as readonly OmpCediaEntry[]).map(entry => ({ ...entry }));
	const surface = input as OmpCediaSurfaceInput;
	const entries: OmpCediaEntry[] = [...array(surface.entries)].map(entry => ({ ...entry }));
	for (const name of array(surface.rpcCommands)) if (typeof name === "string") entries.push({ kind: "rpc", name, disposition: "integrated", handler: "packages/omp-adapter/src/client.ts#request" });
	for (const name of array(surface.cediaUiCommands)) if (typeof name === "string") entries.push({ kind: "rpc", name, disposition: "integrated", handler: "packages/omp-adapter/src/client.ts#requestCedia" });
	for (const name of array(surface.settings)) if (typeof name === "string") entries.push({ kind: "setting", name, disposition: "integrated", handler: "apps/host/src/omp-settings.ts#readOmpSettingsValue" });
	return entries;
}

/** Paths whose recorded hash differs from an existing file's hash. Missing files are separate. */
export function staleSourcePaths(
	recorded: Readonly<Record<string, string>> | undefined,
	actual: Readonly<Record<string, string | undefined>>,
): readonly string[] {
	return Object.keys(recorded ?? {}).filter(path => actual[path] !== undefined && actual[path] !== recorded![path]).sort();
}

export const sourceHashMismatches = staleSourcePaths;

function namesFor(input: OmpAuditInputs, kind: string): readonly string[] {
	return buildAuditedRecordSet(input).filter(record => record.kind === kind).map(record => record.name);
}

function runtimeRows(input: OmpAuditInputs, runtime: OmpRuntimeCapabilities): OmpCoverageIssue[] {
	const issues: OmpCoverageIssue[] = [];
	const check = (kind: string, expected: readonly string[], actual: readonly string[] | undefined): void => {
		if (actual === undefined) return;
		const expectedSet = new Set(expected);
		const actualSet = new Set(actual);
		for (const name of expectedSet) if (!actualSet.has(name)) issues.push({ kind: "runtime_mismatch", recordKind: kind, name, message: `Live runtime is missing audited ${kind} ${name}` });
		for (const name of actualSet) if (!expectedSet.has(name)) issues.push({ kind: "runtime_mismatch", recordKind: kind, name, message: `Live runtime exposes an unaudited ${kind} ${name}` });
		if (actual.length !== actualSet.size) issues.push({ kind: "runtime_mismatch", recordKind: kind, name: kind, message: `Live runtime returned duplicate ${kind} names` });
	};
	check("setting", namesFor(input, "setting"), runtime.settings?.flatMap(entry => typeof entry === "string" ? [entry] : typeof entry.path === "string" ? [entry.path] : []));
	check("rpc", namesFor(input, "rpc"), runtime.rpcCommands);
	if (runtime.capabilityTableMatches === false)
		issues.push({ kind: "runtime_mismatch", name: "capabilities.get", message: "Live capabilities.get disagrees with cedia_get_capabilities" });
	return issues;
}

/** Compare audit, Cedia mappings, source hashes and optional live runtime evidence. */
export function compareOmpCoverage(
	audit: OmpAuditInputs | readonly OmpAuditedRecord[],
	cediaInput: OmpCediaSurfaceInput | readonly OmpCediaEntry[],
	options: OmpCoverageOptions = {},
): OmpCoverageReport {
	const audited = Array.isArray(audit) ? [...(audit as readonly OmpAuditedRecord[])] : [...buildAuditedRecordSet(audit as OmpAuditInputs)];
	const cedia = [...buildCediaRecordSet(cediaInput)];
	const rows: OmpCoverageRowReport[] = [];
	const gaps: OmpCoverageGap[] = [];
	const issues: OmpCoverageIssue[] = [];

	const auditCounts = new Map<string, number>();
	for (const record of audited) auditCounts.set(keyOf(record.kind, record.name), (auditCounts.get(keyOf(record.kind, record.name)) ?? 0) + 1);
	for (const [key, count] of auditCounts) {
		if (count <= 1) continue;
		const separator = key.indexOf("\u0000");
		issues.push({ kind: "duplicate", recordKind: key.slice(0, separator), name: key.slice(separator + 1), message: `Audit contains ${count} records with the same kind and name` });
	}
	const cediaCounts = new Map<string, number>();
	for (const entry of cedia) cediaCounts.set(keyOf(entry.kind, entry.name), (cediaCounts.get(keyOf(entry.kind, entry.name)) ?? 0) + 1);
	for (const [key, count] of cediaCounts) {
		if (count <= 1) continue;
		const separator = key.indexOf("\u0000");
		issues.push({ kind: "duplicate", recordKind: key.slice(0, separator), name: key.slice(separator + 1), message: `Cedia surface contains ${count} mappings with the same kind and name` });
	}

	const isRecordAudit = !Array.isArray(audit);
	const auditInput = isRecordAudit ? (audit as OmpAuditInputs) : undefined;
	const coverageRows: readonly OmpAuditCoverageRow[] = isRecordAudit ? array(auditInput?.coverage.rows) : [];
	const coverageMap = new Map<string, OmpAuditCoverageRow[]>();
	for (const row of coverageRows) {
		const key = keyOf(row.kind, row.name);
		const rowsForKey = coverageMap.get(key) ?? [];
		rowsForKey.push(row);
		coverageMap.set(key, rowsForKey);
	}
	const auditedKeys = new Set(audited.map(record => keyOf(record.kind, record.name)));
	for (const [key, mapped] of coverageMap) {
		if (mapped.length > 1) {
			const separator = key.indexOf("\u0000");
			issues.push({ kind: "duplicate", recordKind: key.slice(0, separator), name: key.slice(separator + 1), message: `coverage.json contains ${mapped.length} mappings with the same kind and name` });
		}
		if (!auditedKeys.has(key)) {
			const separator = key.indexOf("\u0000");
			issues.push({ kind: "orphan", recordKind: key.slice(0, separator), name: key.slice(separator + 1), family: mapped[0]?.family, message: "coverage.json maps a record that is absent from the audited registries" });
		}
	}

	const cediaMap = new Map<string, OmpCediaEntry[]>();
	for (const entry of cedia) {
		const key = keyOf(entry.kind, entry.name);
		const entriesForKey = cediaMap.get(key) ?? [];
		entriesForKey.push(entry);
		cediaMap.set(key, entriesForKey);
		if (entry.family !== undefined && !isOmpCoverageFamily(entry.family)) issues.push({ kind: "family_invalid", recordKind: entry.kind, name: entry.name, family: entry.family, message: `Cedia mapping uses invalid O-family ${entry.family}` });
		if (!auditedKeys.has(key)) issues.push({ kind: "orphan", recordKind: entry.kind, name: entry.name, family: entry.family, message: "Cedia mapping has no audited OMP record" });
	}

	for (const record of audited) {
		const key = keyOf(record.kind, record.name);
		const mapped = coverageMap.get(key) ?? [];
		const family = mapped[0]?.family;
		if (mapped.length === 0) issues.push({ kind: "unclassified", recordKind: record.kind, name: record.name, message: "The audit registry record has no coverage.json O-family classification" });
		else if (!isOmpCoverageFamily(family)) issues.push({ kind: "family_invalid", recordKind: record.kind, name: record.name, family, message: `Audit mapping uses invalid O-family ${family}` });

		const implementation = cediaMap.get(key) ?? [];
		const disposition = implementation[0]?.disposition ?? "unmapped";
		const reason = implementation[0]?.reason;
		rows.push({
			kind: record.kind,
			name: record.name,
			...(family === undefined ? {} : { family }),
			disposition,
			...(reason === undefined ? {} : { reason }),
			...(implementation[0]?.handler === undefined ? {} : { handler: implementation[0].handler }),
			...(implementation[0]?.presentation === undefined ? {} : { presentation: implementation[0].presentation }),
			...(implementation[0]?.test === undefined ? {} : { test: implementation[0].test }),
		});
		if (implementation.length === 0) {
			issues.push({ kind: "unmapped", recordKind: record.kind, name: record.name, family, message: "No Cedia implementation mapping exists" });
			gaps.push({ kind: record.kind, name: record.name, family, disposition: "unmapped", reason: "No Cedia implementation mapping exists" });
		} else if (OMP_BLOCKING_DISPOSITIONS.has(implementation[0]!.disposition)) {
			gaps.push({ kind: record.kind, name: record.name, family, disposition: implementation[0]!.disposition, reason: reason ?? "Cedia has not implemented this audited record" });
		}
		if (implementation[0]?.family !== undefined && family !== undefined && implementation[0].family !== family)
			issues.push({ kind: "family_invalid", recordKind: record.kind, name: record.name, family: implementation[0].family, message: `Cedia family ${implementation[0].family} disagrees with audited family ${family}` });
	}

	if (auditInput !== undefined && options.sourceHashes !== undefined) {
		const exempt = options.sourceExemptions instanceof Set ? options.sourceExemptions : new Set(options.sourceExemptions ?? []);
		for (const path of staleSourcePaths(auditInput.coverage.sources, options.sourceHashes)) if (!exempt.has(path)) issues.push({ kind: "stale_source", name: path, message: `Audit source hash no longer matches ${path}` });
		for (const path of Object.keys(auditInput.coverage.sources ?? {}).sort()) if (options.sourceHashes[path] === undefined && !exempt.has(path)) issues.push({ kind: "source_missing", name: path, message: `Audit source file is missing: ${path}` });
	}
	if (auditInput !== undefined && options.runtime !== undefined) issues.push(...runtimeRows(auditInput, options.runtime));

	return {
		audited,
		cedia,
		rows,
		gaps,
		issues,
		integrityPass: issues.every(issue => !fatalIssueKinds.has(issue.kind)),
		complete: issues.every(issue => !fatalIssueKinds.has(issue.kind)) && gaps.length === 0,
	};
}

export const isOmpCoverageFamily = (value: unknown): value is OmpCoverageFamily =>
	typeof value === "string" && (OMP_COVERAGE_FAMILIES as readonly string[]).includes(value);

export const isIntegrityIssue = (issue: OmpCoverageIssue): boolean => fatalIssueKinds.has(issue.kind);

/** Descriptive aliases for consumers that call the two sides an audit and an implementation surface. */
export const buildImplementationRecordSet = buildCediaRecordSet;
export const compareCoverage = compareOmpCoverage;
