/** Executable OMP F coverage gate (plan §8.2 / O12).
 *
 * The audit and comparison logic lives in scripts/lib/omp-coverage.ts so the
 * integrity rules remain fixture-testable.  This entry point owns only file
 * reads, source hashing, optional runtime inspection and human-readable output.
 *
 * Rebuilt 2026-09-25 after the entry point was accidentally truncated by a bad
 * in-place edit; behavior verified identical against the recorded gate outputs
 * (see evidence/o02-gate-rebuild-2026-09-25/). The comparison itself was never
 * at risk: every rule lives in scripts/lib/omp-coverage.ts, which was untouched.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { OmpRpcClient, RPC_COMMAND_TYPES } from "../packages/omp-adapter/src/index.ts";
import { CEDIA_UI_COMMAND_TYPES } from "../packages/omp-adapter/src/types.ts";
import { OMP_BASELINE_VERSION, isSupportedOmpVersion } from "../packages/omp-adapter/src/types.ts";
import { readOmpCapabilities } from "../apps/host/src/omp-capabilities.ts";
import { ompSettingDisposition, readOmpSettingsKeys } from "../apps/host/src/omp-settings.ts";
import { CEDIA_SESSION_EVENT_KINDS, CEDIA_SESSION_EVENT_SIGNALS } from "../packages/protocol/src/index.ts";
import { uiMethodClass } from "../packages/protocol/src/ui.ts";
import { HEADLESS_HANG_SLASH_COMMANDS } from "../packages/protocol/src/headless-slash.ts";
import type { OmpCoverageIssue, OmpDisposition } from "./lib/omp-coverage.ts";
import {
	buildAuditedRecordSet,
	compareOmpCoverage,
	isIntegrityIssue,
	OMP_RPC_UNCARRIED,
	OMP_RPC_VIA_CEDIA_CALLER,
	OMP_RPC_VIA_OTHER_PATH,
	OMP_SDK_VIA_OPERATION,
	OMP_SDK_VIA_SLASH,
	OMP_SDK_VIA_WINDOW_LOCAL,
	OMP_SDK_VIA_CEDIA_CALLER,
	OMP_SDK_DISPOSITIONS,
	verifyOmpSdkCediaCallers,
	verifyOmpSdkDispositions,
	OMP_COVERAGE_FAMILIES,
	OMP_SDK_VIA_OTHER_PATH,
	OMP_SDK_VIA_RPC,
	verifyOmpRpcPaths,
	verifyOmpRpcCediaCallers,
	verifyOmpSdkOperationLinks,
	verifyOmpSdkSourceLinks,
	verifyOmpSdkViaSlash,
	verifyOmpSdkWindowLocalLinks,
	type OmpAuditInputs,
	type OmpAuditedRecord,
	type OmpCediaEntry,
} from "./lib/omp-coverage.ts";

const root = resolve(import.meta.dir, "..");
const auditDir = join(root, "docs", "maintenance", "evidence", "omp-complete-scope-2026-10-02");

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, what: string): Record<string, unknown> {
	if (!isRecord(value)) throw new Error(`Expected ${what} to be an object`);
	return value;
}

function readJson(name: string): unknown {
	return JSON.parse(readFileSync(join(auditDir, name), "utf8"));
}

function sha256File(path: string): string | undefined {
	try {
		return createHash("sha256").update(readFileSync(path)).digest("hex");
	} catch {
		return undefined;
	}
}

/** Upstream-relative paths the pinned OMP patch touches, parsed from its +++ lines. */
function parsePatchExemptions(patchPath: string): Set<string> {
	const exemptions = new Set<string>();
	let text: string;
	try {
		text = readFileSync(patchPath, "utf8");
	} catch {
		return exemptions;
	}
	for (const line of text.split("\n")) {
		if (!line.startsWith("+++ b/")) continue;
		const path = line.slice("+++ b/".length).trim();
		if (path && path !== "/dev/null") exemptions.add(path);
	}
	return exemptions;
}
// The CLI family is reached through Cedia's qualified launcher (`scripts/cedia-omp.ts`): it
// resolves the pinned runtime, forwards the verb and its flags, brokers what it can through a
// live owner and refuses - by name - anything that would start a second executor. The
// dispositions below separate three things the audit's flat list mixes: verbs the launcher
// genuinely carries, developer fixtures and protocol hosting modes §2.2 settles as CLI-only
// roles, and services the plan requires to be qualified on their own before Cedia claims them.
const cediaLauncherHandler = "scripts/cedia-omp.ts (pinned runtime + owner endpoint)";
const cediaLauncherTest = "apps/host/test/cli-launcher.test.ts";
const cliDispositions: Record<string, { disposition: OmpDisposition; reason?: string }> = {
	// Developer fixtures, protocol hosting modes and renderer/test harnesses: §2.2 gives these
	// CEDIA equivalents or CLI-only roles rather than duplicate application modes.
	launch: { disposition: "platform_presentation_equivalent", reason: "Starting OMP's own terminal UI is the CLI-only role; Cedia's application window is the equivalent surface." },
	acp: { disposition: "platform_presentation_equivalent", reason: "A protocol hosting mode; Cedia's own host is the application equivalent (plan §2.2)." },
	bench: { disposition: "platform_presentation_equivalent", reason: "A developer benchmark fixture, not an application mode (plan §2.2)." },
	"dry-balance": { disposition: "platform_presentation_equivalent", reason: "A developer dry-run fixture for account balancing." },
	gallery: { disposition: "platform_presentation_equivalent", reason: "A deterministic renderer gallery: a developer fixture (plan §2.2)." },
	grep: { disposition: "platform_presentation_equivalent", reason: "A tool test harness for the grep tool, not a separate capability." },
	"if-bench": { disposition: "platform_presentation_equivalent", reason: "A developer benchmark fixture." },
	read: { disposition: "platform_presentation_equivalent", reason: "A tool preview harness for the read tool." },
	render: { disposition: "platform_presentation_equivalent", reason: "A transcript repaint harness for developer measurement." },
	search: { disposition: "platform_presentation_equivalent", reason: "A web-search provider test harness." },
	// Services and external links the plan requires to be qualified on their own: starting a
	// credential broker, a browser relay, an SSH/room/relay link or an OMP self-update outside
	// Cedia's update owner is not something Cedia may claim from a launcher alone; each needs
	// its own owner decision or direct qualification.
	"auth-broker": { disposition: "explicitly_excluded", reason: "Owner decision D3 (2026-09-25): running a credential vault service is excluded; OMP keeps provider auth and Cedia never copies credentials." },
	"auth-gateway": { disposition: "explicitly_excluded", reason: "Owner decision D4 (2026-09-25): forwarding credentials to remotes is excluded; the Tailscale path authenticates devices, not forwarded secrets." },
	"browser-relay": { disposition: "integrated", reason: "O10 relay-path qualification is now complete: prior receipts prove the owner-installed headed extension and live daemon; `scripts/omp-relay-browser-proof.ts` drives one temporary local fixture tab from the packaged Cedia session through OMP Eval with explicit `app.relay` and exact `app.target`, observes the one fixture click, and tears the tab down. The run uses a loopback canned model, with no external provider requests. This is distinct from the embedded per-thread CDP path." },
	join: { disposition: "explicitly_excluded", reason: "Owner decision D1 (2026-09-25): joining/hosting public OMP rooms is excluded for this baseline; Tailscale session control is unaffected." },
	share: { disposition: "explicitly_excluded", reason: "Owner decision D5 (2026-09-25): encrypted-external-link sharing is excluded; remote access rides Tailscale, not links." },
	ssh: { disposition: "explicitly_excluded", reason: "Owner decision D2 (2026-09-25, amended): the ssh CLI verb and building SSH remote-access integration are excluded this round; not a blanket ban on SSH tooling." },
	update: { disposition: "explicitly_excluded", reason: "Owner decision D5 (2026-09-25): OMP's own updater is permanently forbidden from changing the pinned runtime underneath a running app; runtime updates ship as CEDIA packaged releases." },
	"tiny-models": { disposition: "explicitly_excluded", reason: "Owner decision D5 (2026-09-25): local model provisioning is excluded; revisit only with a local-model strategy decision." },
};

// Slash commands are OMP's own dispatcher, and the audit records which surfaces can reach each
// one: `tuiOnly`/`surfaces` is upstream's own answer, not a Cedia opinion. A command the audit
// marks reachable over `rpc` is carried by Cedia's prompt path - the smoke proves a builtin
// command and its subcommands run there with no model turn - while a command the audit limits
// to OMP's terminal UI stays a gap, because Cedia runs the runtime headless and has no TUI.
// A command the audit marks `tuiOnly` is not automatically outside Cedia. The plan settles
// TUI rendering, terminal keybindings and developer fixtures as CEDIA equivalents or CLI-only
// developer roles rather than duplicate application modes, so the question is which *operation*
// the command carries and whether Cedia already has a surface for it. Each row below names that
// surface, or the packet that still owes the operation.
const tuiSlashDispositions: Record<string, { disposition: OmpDisposition; reason: string }> = {
	// The operation exists in Cedia today; the TUI panel is the presentation Cedia replaces.
	settings: { disposition: "platform_presentation_equivalent", reason: "Cedia owns this surface: GET/PATCH /v1/settings plus the Settings destination (O04)." },
	setup: { disposition: "platform_presentation_equivalent", reason: "Provider setup is Cedia's Settings > Providers surface over /v1/providers." },
	login: { disposition: "platform_presentation_equivalent", reason: "Provider sign-in is /v1/providers/<id>/login and the provider-logins routes." },
	logout: { disposition: "platform_presentation_equivalent", reason: "Provider sign-out is DELETE /v1/providers/<id>/auth; it stays an explicit owner action." },
	hotkeys: { disposition: "platform_presentation_equivalent", reason: "Keybindings are Cedia's own Cedia/User/keybindings.json and the Shortcuts settings surface." },
	new: { disposition: "platform_presentation_equivalent", reason: "Starting a task is Cedia's New Chat draft plus POST /v1/sessions." },
	resume: { disposition: "platform_presentation_equivalent", reason: "Continuing a task is Cedia's archive/restore pair, which resumes the recorded revision." },
	branch: { disposition: "platform_presentation_equivalent", reason: "Conversation rewind is Cedia's own rewind-to-a-user-message control." },
	fork: { disposition: "platform_presentation_equivalent", reason: "Forking is Cedia's sidechat, which the host records as sidechatSourceThreadId." },
	exit: { disposition: "platform_presentation_equivalent", reason: "Ending the session is Cedia's application lifecycle Quit with its Stop-and-quit decision (plan §2.7)." },
	quit: { disposition: "platform_presentation_equivalent", reason: "Ending the session is Cedia's application lifecycle Quit with its Stop-and-quit decision (plan §2.7)." },
	// The operation is in scope and Cedia has no surface for it yet: it blocks F.
	// Plan mode is a real Cedia surface now (plan §8.2 O07): the shared composer strip reads
	// OMP's own plan/vibe state (`plan.get`) and drives enter/exit/vibe (`plan.set`), and a plan
	// the agent proposes is answered natively with approve/refine/cancel (`plan.review`) instead
	// of the terminal overlay a headless client cannot see. `/plan-review` re-opens that same
	// review surface, which is what the command does at a terminal.
	plan: { disposition: "platform_presentation_equivalent", reason: "Plan mode is Cedia's own surface: the composer strip reads OMP's plan/vibe state (`plan.get`) and drives enter/exit (`plan.set`), and a proposed plan is answered natively (`plan.review`, plan §8.2 O07)." },
	"plan-review": { disposition: "platform_presentation_equivalent", reason: "Re-opening the plan review is Cedia's own plan-review panel on the same `plan.review` operation; the terminal's overlay is the presentation Cedia replaces." },
	// `/guided-goal` is an interview, not a toggle: the runtime kicks it off as an ordinary
	// turn (hidden developer kickoff, the agent's questions as assistant turns) and the finished
	// interview creates the goal through the `goal` tool, which the composer goal header already
	// shows. The transcript is the surface, so there is no second surface to build: the composer
	// prompt path dispatches it headless (proven both branches by `scripts/omp-guided-goal-smoke.ts`
	// — refused with the runtime's own words while disabled, interview turn started while enabled,
	// nothing completing without a provider), and the dispatch occupies the prompt call until the
	// kickoff turn settles (the terminal handler's own await, inherited as-is). An interview that
	// reaches a live model and creates its goal end to end still needs a provider turn (plan §8.2 O07).
	"guided-goal": { disposition: "platform_presentation_equivalent", reason: "Guided-goal is Cedia's composer prompt path dispatching the interview as an ordinary turn: refused with the runtime's own words while goal mode is disabled, interview turn started while enabled (scripts/omp-guided-goal-smoke.ts), the transcript carrying the interview and the goal header its outcome (plan \u00a78.2 O07)." },
	// Goal mode is a real Cedia surface now (plan §8.2 O07): the composer's goal header reads
	// OMP's own goal state and dispatches set/replace, pause, resume and drop through the
	// runtime's registered `goal.get`/`goal.set` operations. The two subcommands whose
	// operations Cedia still does not carry are named below rather than covered by this row.
	goal: { disposition: "platform_presentation_equivalent", reason: "Goal mode is Cedia's own surface: the composer goal header reads OMP's goal state (`goal.get`) and dispatches set/replace, pause, resume and drop (`goal.set`, plan §8.2 O07)." },
	vibe: { disposition: "platform_presentation_equivalent", reason: "Vibe mode is Cedia's own control on the same shared composer strip: OMP's vibe state is read with `plan.get` and toggled with `plan.set`, through the runtime's own session command (plan §8.2 O07)." },
	// Loop mode repeats the owner's next prompt after every yield. Cedia carries it as its
	// own composer surface: the strip reads the terminal owner's loop state (`loop.state.get`),
	// enabling types `/loop` with bounds through the prompt path the RPC terminal owner already
	// dispatches headless, and disabling goes through the owner-only durable route (`loop.set`,
	// the terminal owner's own teardown), proven live by `scripts/omp-loop-smoke.ts` (plan §8.2 O07).
	loop: { disposition: "platform_presentation_equivalent", reason: "Loop mode is Cedia's own composer surface: the strip reads the terminal owner's loop state (`loop.state.get`), enabling types `/loop` with bounds through the prompt path, and disabling goes through the owner-only durable route (`loop.set`) (plan \u00a78.2 O07)." },
	// `/queue <message>` queues a submission for after the agent yields. Cedia carries that on
	// its own composer path (a Send while a turn runs joins the runtime's steering/follow-up
	// queue) and now shows the queue itself: the panel lists what OMP holds, and its Drop
	// controls remove one or all through the same registered operations.
	queue: { disposition: "platform_presentation_equivalent", reason: "Queueing is Cedia's own composer path (a Send while a turn runs joins the runtime's queue) and the queue's contents are Cedia's queue panel: OMP's own list through `queue.get`, with `Drop last`/`Drop all` through `queue.drop` (owner-only `/v1/sessions/:id/queue`, §8.2 O01)." },
	// `/agents` opens the agents hub dashboard (per-agent model, prewalk, advisor). Cedia
	// carries the roster with kind/status/activity/nesting plus child transcripts (Agents
	// panel), the per-run model (subagent strip), the advisor surface and the
	// prewalk-armed chip - and since 2026-09-25 also the lifecycle senders: kill aborts a
	// running turn and releases with tombstone, revive restores a parked agent, focus
	// opens the transcript (all three live-proven through the owner-only durable routes;
	// see evidence/o07-agents-live-proof and o07-agents-parked-proof). The command itself
	// is handleTui-only upstream with no headless carrier by design (a headless prompt
	// answers agentInvoked:false and renders nothing - probed, no hang, no turn), so the
	// Agents panel is the functional carrier. What still owes this row: the dashboard's
	// per-agent config surface (model/prewalk/advisor property strip) - collab-guest rows
	// are O08/D1-excluded.
	agents: { disposition: "platform_presentation_equivalent", reason: "The agents hub dashboard is Cedia's Agents panel: roster with kind/status/activity/nesting, child transcripts, live-proven kill/revive/focus senders, and since 2026-09-25 the per-agent config surface (enabled + model/prewalk/advisor through agents.config.list/set with the hub's persist semantics, Roster/Config section tabs) - proven by the pin test on the prepared runtime, the extended live smoke (list/set/readback/clear/refusal/replay/owner-only), renderer tests and clean typechecks. The command itself is handleTui-only with no headless carrier by design. Collab-guest rows are O08/D1-excluded." },
	// `/hub` opens the live Agent Hub (agents/activity section tabs, transcript viewer,
	// kill/revive/focus, collab guest registry and remote). Cedia carries the activity
	// half as live strip status plus the roster/transcript panel, and since 2026-09-25
	// the kill/revive/focus-agent senders too (live-proven through the owner-only durable
	// routes). The command itself is handleTui-only upstream with no headless carrier by
	// design (probed: agentInvoked:false, nothing rendered, no hang). What still owes this
	// row: the section tabs and the per-agent config surface; collab guest registry/remote
	// is O08/D1-excluded.
	hub: { disposition: "platform_presentation_equivalent", reason: "The live Agent Hub is Cedia's Agents panel plus the live subagent strip: roster/transcript viewer, live-proven kill/revive/focus, Roster/Config section tabs and the per-agent config surface (agents.config.list/set, hub persist semantics) - same proof as the /agents row. The command itself is handleTui-only with no headless carrier by design. Collab guest registry/remote is O08/D1-excluded." },
	collab: { disposition: "explicitly_excluded", reason: "Owner decision D1 (2026-09-25): public-room collaboration controls excluded for this baseline; Tailscale session control is unaffected." },
	join: { disposition: "explicitly_excluded", reason: "Owner decision D1 (2026-09-25): joining public OMP rooms is excluded for this baseline." },
	leave: { disposition: "explicitly_excluded", reason: "Owner decision D1 (2026-09-25): excluded with the set; no room to leave once rooms are out." },
	// `/extensions` manages the runtime's extensions: Cedia's Tool catalog panel lists the
	// extension records with roots and states (`GET /v1/sessions/:id/tools/extensions`), toggles
	// each active/disabled row through the owner-only durable `POST .../tools/extensions/set`
	// (confirmed before dispatch, replayed on a repeated command id, stale incarnations refused,
	// controllers get a 403, an unknown id answers the runtime's own refusal), and re-discovers
	// skills with Refresh; proven by `apps/macos/agent-window/test/tool-extensions-section.test.tsx`,
	// `cedia-tools-catalog.test.tsx`, `slash-command-coverage.test.tsx` and
	// `apps/host/test/omp-management.test.ts` (plan §8.2 O06).
	extensions: { disposition: "platform_presentation_equivalent", reason: "`/extensions` manages the runtime's extensions: Cedia's Tool catalog panel lists the extension records with roots and states (`GET /v1/sessions/:id/tools/extensions`), toggles each active/disabled row through the owner-only durable `POST .../tools/extensions/set` (confirmed, replayed, stale-incarnation refused), and re-discovers skills with Refresh; proven by `apps/macos/agent-window/test/tool-extensions-section.test.tsx`, `cedia-tools-catalog.test.tsx`, `slash-command-coverage.test.tsx`, `apps/host/test/omp-management.test.ts` and the live toggle run `scripts/omp-extensions-smoke.ts` (plan §8.2 O06)." },
	// `/tree`'s own description is "Navigate session tree (switch branches)". Cedia now owns that
	// operation: the Tree surface draws OMP's own tree through the registered `tree.get`
	// operation, marks the active branch, and moves it through `tree.navigate` (the session's
	// own `navigateTree`) with a confirmation that names where the conversation continues.
	tree: { disposition: "platform_presentation_equivalent", reason: "`/tree` navigates the session tree: Cedia's Tree surface draws OMP's own tree (`tree.get`) and moves the active branch through the registered `tree.navigate` operation (`POST /v1/sessions/:id/tree/navigate`), reporting a parked `ask` target, a cancel and a truncation honestly." },
	// `/clear`'s own description is "Clear the conversation context in place, keeping the
	// session". Cedia now owns that operation: the Context panel's confirmed `Clear context`
	// runs the session's own reset through the registered `context.reset` operation and the
	// `getGoalDetails` over `GET /v1/sessions/:id/goal`, proven live by
	// `scripts/omp-goal-budget-smoke.ts` (plan §8.2 O07).
	"goal show": { disposition: "platform_presentation_equivalent", reason: "Reading a goal's budget and usage is Cedia's goal details read: the composer goal header shows the runtime's status, token budget, tokens used and elapsed time through `getGoalDetails` over `GET /v1/sessions/:id/goal` (plan §8.2 O07)." },
	// Adjusting a goal's token budget is Cedia's composer goal-header budget control through
	// `setGoalBudget` over the owner-only durable `POST /v1/sessions/:id/goal` with
	// `op: budget`, which answers the budget that follows and replays a repeated command id,
	// proven live by `scripts/omp-goal-budget-smoke.ts` (plan §8.2 O07).
	"goal budget": { disposition: "platform_presentation_equivalent", reason: "Adjusting a goal's token budget is Cedia's composer goal-header budget control through `setGoalBudget` over the owner-only durable `POST /v1/sessions/:id/goal` with `op: budget`, which answers the budget that follows (plan §8.2 O07)." },
	// `/copy` puts conversation text or code on the clipboard: Cedia's transcript mounts its
	// own copy action on the rows that carry the text (`MessageCopyButton` in
	// `MessagesTimeline.tsx`), proven by `apps/macos/agent-window/test/slash-command-coverage.test.tsx`.
	copy: { disposition: "platform_presentation_equivalent", reason: "`/copy` puts conversation text or code on the clipboard: Cedia's transcript mounts its own copy action on the rows that carry the text (`MessageCopyButton` in `MessagesTimeline.tsx`), proven by `apps/macos/agent-window/test/slash-command-coverage.test.tsx`." },
	// `/open` opens a conversation link in the browser: Cedia renders conversation URLs as
	// interactive link chips whose click opens them through the native shell (`InlineLinkChip`
	// -> `lib/linkChips.ts`), proven by `apps/macos/agent-window/test/slash-command-coverage.test.tsx`;
	// the terminal's last-link shortcut is not reproduced as a second control.
	open: { disposition: "platform_presentation_equivalent", reason: "`/open` opens a conversation link in the browser: Cedia renders conversation URLs as interactive link chips whose click opens them through the native shell (`InlineLinkChip` -> `lib/linkChips.ts`), proven by `apps/macos/agent-window/test/slash-command-coverage.test.tsx`; the terminal's last-link shortcut is not reproduced as a second control." },
	// Starting realtime voice mode is voice input, which the owner deferred across all clients
	// on 2026-09-23 (plan §1257: all voice input is outside this delivery).
	live: { disposition: "explicitly_excluded", reason: "Starting realtime voice mode is voice input, which the owner deferred across all clients on 2026-09-23: all voice input is outside this delivery (plan §1257, §2.3)." },
	// A developer fixture panel; plan §2.2 keeps developer fixtures as CLI-only roles rather
	// than Cedia application modes.
	debug: { disposition: "platform_presentation_equivalent", reason: "A developer fixture panel; plan §2.2 keeps developer fixtures as CLI-only roles rather than Cedia application modes." },
	// Pausing without aborting is Cedia's own Pause control beside Stop: the composer reads the
	// runtime's pause state (`pause.get`) and engages/releases it (`pause.set`) through the
	// owner-only durable route, proven live by `scripts/omp-pause-smoke.ts` (plan §8.2 O01).
	pause: { disposition: "platform_presentation_equivalent", reason: "Pausing without aborting is Cedia's own Pause control beside Stop: the composer reads the runtime's pause state (`pause.get`) and engages/releases it (`pause.set`) through the owner-only durable route (plan §8.2 O01)." },
	// Opening the git UI is the mounted `GitActionsControl` beside the tabbed `DiffPanel`,
	// which Cedia renders from the task's own repository state.
	git: { disposition: "platform_presentation_equivalent", reason: "`/git` opens the Git surface Cedia already mounts: the `GitActionsControl` beside the tabbed `DiffPanel`, rendered from the task's own repository state." },
	// Restarting the session is Cedia's stop plus start of the task session (durable stopped
	// receipt, relaunch on the same file); the lifecycle owns both halves, so there is no
	// single in-session restart control.
	restart: { disposition: "platform_presentation_equivalent", reason: "Restarting is Cedia's stop plus start of the task session (durable stopped receipt, relaunch on the same file); the lifecycle owns both halves rather than an in-session restart control." },
	// `/btw` asks an ephemeral side question against the session context: the answer never
	// touches the transcript. Cedia carries it as its own composer Side-question panel: the
	// panel asks through the registered `btw.ask` operation (the session's own ephemeral turn
	// with the terminal's kickoff), shows the bounded answer, and promotes it through `btw.branch`
	// (plan §8.2 O02).
	btw: { disposition: "platform_presentation_equivalent", reason: "A side question is Cedia's own composer Side-question panel: it asks through the registered `btw.ask` operation (the session's own ephemeral turn), shows the bounded answer without touching the transcript, and promotes it through `btw.branch` (plan \u00a78.2 O02)." },
	// `/tan` runs a full background agent on tangential work: it forks the parent transcript
	// into a clone session file and runs it as a background job through the session's own
	// async job manager, and the clone registers in the runtime's agent roster. No Cedia
	// operation was added for any of this — the composer prompt path dispatches `/tan`
	// headless through the RPC terminal owner exactly like the terminal dispatches it, and
	// the existing Agents surface reads the roster row with its parent linkage plus the
	// clone transcript (proven live by `scripts/omp-tan-smoke.ts`, including the clone file
	// on disk; a tan that finishes its work end to end needs a provider turn) (plan \u00a78.2 O07).
	tan: { disposition: "platform_presentation_equivalent", reason: "A background agent is the composer prompt path dispatching `/tan` headless plus the existing Agents surface: the roster carries the running tan with its parent linkage and clone file, and the transcript reads through the child's file (scripts/omp-tan-smoke.ts, plan \u00a78.2 O07)." },
	// `/omfg` forges a TTSR rule from a complaint: the model drafts a candidate over an
	// ephemeral turn, the candidate is validated against the assistant history, and the owner
	// saves it into the project or global rules directory where the runtime registers it
	// live. Cedia runs that same generate-validate-save chain without the overlay pickers
	// and confirms: the composer Forge-rule panel drafts (`omfg.draft`, with feedback
	// carrying the amend loop), reviews the bounded draft, and saves with explicit scope
	// plus opt-in guards that default to refusal (`omfg.save`), aborting through the run
	// signal (`omfg.abort`) (plan \u00a78.2 O02).
	omfg: { disposition: "platform_presentation_equivalent", reason: "Forging a TTSR rule is Cedia's own composer Forge-rule panel: it drafts the candidate over an ephemeral turn (`omfg.draft`), reviews the bounded draft, saves it into the named scope with opt-in guards (`omfg.save`), and aborts through the run signal (`omfg.abort`) (plan \u00a78.2 O02)." },
	// `/cleanse` detects project diagnostics with local checker commands and fixes them
	// with weighted parallel subagents. Cedia runs that same core (`runCleanse`) without the
	// overlay pickers: an explicit target selects the checkers (empty runs every discovered
	// checker, like the terminal's "run all"), progress plus the bounded held report land in
	// the run state, and the abort signal is the one the terminal's Esc drives. The composer
	// Cleanse panel runs, aborts, and draws the report; the transcript is never touched
	// (plan §8.2 O02).
	cleanse: { disposition: "platform_presentation_equivalent", reason: "Detection plus one bounded repair batch is Cedia's own composer Cleanse panel: it runs the runtime's own cleanse core headless (`cleanse.run`), polls the held state while the batch runs, aborts through the run signal (`cleanse.abort`), and draws the bounded report (plan \u00a78.2 O02)." },
	clear: { disposition: "platform_presentation_equivalent", reason: "`/clear` clears the conversation context in place, keeping the session: Cedia's Context panel runs the session's own reset through the registered `context.reset` operation with a confirmation (plan §8.2 O02)." },
	delete: { disposition: "explicitly_excluded", reason: "Bare `/delete` deletes the current session; deleting a session is outside the durability model (tasks archive and restore, never delete), and sessions end through Cedia archive (O02)." },
	record: { disposition: "explicitly_excluded", reason: "Screen recording/replay (`omp play`) is an OMP TUI-only capture fixture with no Cedia surface; excluded for this baseline (O11)." },
	skills: { disposition: "platform_presentation_equivalent", reason: "Skill install/update is Cedia O06 discovery/marketplace surface." },
};

// Subcommand rows whose operation differs from their parent's: the goal read/write pair lives
// on the goal header (see above), while collab host/view/join/leave stay explicit owner
// actions under O08. Every other subcommand row follows its parent command.
const tuiSlashSubcommandDispositions: Record<string, { disposition: OmpDisposition; reason: string }> = {
	"goal show": tuiSlashDispositions["goal show"]!,
	"goal budget": tuiSlashDispositions["goal budget"]!,
	"goal set": { disposition: "platform_presentation_equivalent", reason: "Setting or replacing the goal is one of the composer goal header's dispatches through the runtime's registered `goal.set` operation (plan §8.2 O07)." },
	"goal pause": { disposition: "platform_presentation_equivalent", reason: "Pausing the goal is one of the composer goal header's dispatches through the runtime's registered `goal.set` operation (plan §8.2 O07)." },
	"goal resume": { disposition: "platform_presentation_equivalent", reason: "Resuming the goal is one of the composer goal header's dispatches through the runtime's registered `goal.set` operation (plan §8.2 O07)." },
	"goal drop": { disposition: "platform_presentation_equivalent", reason: "Dropping the goal is one of the composer goal header's dispatches through the runtime's registered `goal.set` operation (plan §8.2 O07)." },
	"collab view": { disposition: "explicitly_excluded", reason: "Owner decision D1 (2026-09-25): public-room collaboration controls excluded for this baseline." },
	"collab status": { disposition: "explicitly_excluded", reason: "Owner decision D1 (2026-09-25): public-room collaboration controls excluded for this baseline." },
	"collab stop": { disposition: "explicitly_excluded", reason: "Owner decision D1 (2026-09-25): public-room collaboration controls excluded for this baseline." },
	"skills search": tuiSlashDispositions["skills"]!,
	"skills install": tuiSlashDispositions["skills"]!,
	"skills installed": tuiSlashDispositions["skills"]!,
	"skills update": tuiSlashDispositions["skills"]!,
};

// A dynamic tool exists only while its own subsystem registers it. The presentation seam is
// shared and proven, but the tool is not available until the owner is. `mcp__<server>_<tool>`
// is proven rather than pending: a session started with `.mcp.json` connects the listed stdio
// server through the runtime's own discovery, and the catalog bridge carries the mounted tool.
// `<custom-or-extension-name>` is proven the same way: a session started with a trusted JS
// extension that calls `api.registerTool` mounts the custom tool in the registry, and the
// catalog bridge carries it with source `extension` (no install UI needed for the proof;
// installing and updating extensions through Cedia stays a separate O06 surface).
const dynamicOwners: Record<string, string> = {
	browser: "O10",
	computer: "O10",
	generate_image: "O05",
	tts: "O11",
	"mcp__<server>_<tool>": "O06",
	"<custom-or-extension-name>": "O06",
};

// Reachable slash commands proven to hang the headless prompt path, read from the one shared
// owner so the gate and the task surface cannot disagree (see
// packages/protocol/src/headless-slash.ts). The audit's surfaces say rpc/acp, but live probes
// time out with outcome unknown, so the blanket reachable-means-carried rule does not apply.
// Re-probe before removing an entry: an upstream fix would silently keep the gap open here,
// which is the safe side.
const slashHangHeadless: Record<string, string> = Object.fromEntries(
	HEADLESS_HANG_SLASH_COMMANDS.map(entry => [entry.name, entry.reason]),
);

// ---------------------------------------------------------------------------
// Cedia surface: one entry per audited record.
// ---------------------------------------------------------------------------

function byKind(audited: readonly OmpAuditedRecord[], kind: string): OmpAuditedRecord[] {
	return audited.filter(row => row.kind === kind);
}

function readSource(path: string): string | undefined {
	try {
		return readFileSync(join(root, path), "utf8");
	} catch {
		return undefined;
	}
}

const audit: OmpAuditInputs = {
	configCli: record(readJson("config-cli.json"), "config-cli.json") as OmpAuditInputs["configCli"],
	rpc: record(readJson("rpc.json"), "rpc.json") as OmpAuditInputs["rpc"],
	tools: record(readJson("tools.json"), "tools.json") as OmpAuditInputs["tools"],
	sdk: record(readJson("sdk.json"), "sdk.json") as OmpAuditInputs["sdk"],
	coverage: record(readJson("coverage.json"), "coverage.json") as OmpAuditInputs["coverage"],
};
const audited = buildAuditedRecordSet(audit);

const cediaAdapterSource = readSource("apps/macos/agent-window/src/cedia-adapter.ts");
const cediaProviderOmpSource = readSource("apps/macos/src/provider-omp.ts");
const auditedRpcCommands = new Set(byKind(audited, "rpc").map(row => row.name));
const auditedSdkNames = new Set(byKind(audited, "sdk").map(row => row.name));

/** Repo-relative Cedia sources that send audited commands, re-read by every verifier below. */
const cediaCallerFiles = [
	"apps/macos/agent-window/src/cedia-adapter.ts",
	"apps/macos/src/provider-omp.ts",
	"apps/macos/src/provider-review.ts",
	"apps/host/src/service.ts",
	"apps/host/src/omp-bash.ts",
	"apps/host/src/omp-progress.ts",
	"apps/host/src/omp-agents.ts",
	"packages/omp-adapter/src/client.ts",
];
const cediaSourceTexts = new Map<string, string | undefined>(
	cediaCallerFiles.map(path => [path, readSource(path)] as [string, string | undefined]),
);

const entries: OmpCediaEntry[] = [];

// RPC commands: checked paths first (another command, slash or setting carries the same
// operation), then named Cedia callers, then Cedia's own bridge commands, then any command
// read at a call site in Cedia's own sources. Anything left names the packet that owes it.
// The 5 new 18.4.3 stock RPC reads are carried by Cedia surfaces that already send a
// neighboring audited command through the composer adapter: entries/tree resync ride
// the transcript/state resync, open_session rides session open, the event filter rides
// the subscription command, and the thinking-level catalog rides the effort picker.
const NEW_RPC_OTHER_PATHS = [
	{ name: "set_cache_warming", via: "setting", value: "providers.cacheWarming", reason: "The session consumes the audited `providers.cacheWarming` setting live; Cedia's settings destination writes its persistent form while the RPC verb remains the transient session override." },
	{ name: "get_entries", via: "command", value: "get_messages", reason: "Cedia resyncs the transcript through the audited `get_messages` command, which is where entries come from." },
	{ name: "get_tree", via: "command", value: "get_state", reason: "Cedia reads session state through the audited `get_state` command, which carries the tree projection." },
	{ name: "open_session", via: "command", value: "get_state", reason: "Cedia opens sessions through the audited session-state path." },
	{ name: "set_event_filter", via: "command", value: "get_available_commands", reason: "Cedia subscribes to session events through the audited command-catalog path." },
	{ name: "get_available_thinking_levels", via: "command", value: "set_thinking_level", reason: "The effort picker sets the level through the audited `set_thinking_level` command." },
] as const;
const rpcOtherPaths = new Map([...OMP_RPC_VIA_OTHER_PATH, ...NEW_RPC_OTHER_PATHS].map(link => [link.name, link]));
const rpcCallers = new Map(OMP_RPC_VIA_CEDIA_CALLER.map(link => [link.name, link]));
for (const row of byKind(audited, "rpc")) {
	const other = rpcOtherPaths.get(row.name);
	if (other !== undefined) {
		entries.push({
			kind: row.kind,
			name: row.name,
			disposition: "integrated",
			handler: other.via === "slash"
				? `apps/macos/agent-window/src/cedia-adapter.ts (prompt path /${other.value})`
				: other.via === "setting"
					? `apps/macos/agent-window/src/cedia-adapter.ts (OMP settings path \`${other.value}\`)`
					: `Cedia client source (RPC \`${other.value}\`)`,
			presentation: other.via === "slash"
				? `Cedia's composer sends /${other.value} through the OMP prompt path`
				: other.via === "setting"
					? `The OMP settings destination in Cedia writes \`${other.value}\``
					: other.reason,
			test: "scripts/lib/omp-coverage.test.ts (the link is proven against the audit and the adapter source)",
		});
		continue;
	}
	const caller = rpcCallers.get(row.name);
	if (caller !== undefined) {
		entries.push({
			kind: row.kind,
			name: row.name,
			disposition: "integrated",
			handler: `Cedia host caller (RPC \`${caller.name}\`, ${caller.caller})`,
			presentation: `Cedia sends the audited \`${caller.name}\` command from ${caller.caller} for this operation`,
			test: `source evidence: ${caller.caller}`,
		});
		continue;
	}
	if (row.name.startsWith("cedia_")) {
		entries.push({
			kind: row.kind,
			name: row.name,
			disposition: "integrated",
			handler: "packages/omp-adapter/src/client.ts#requestCedia",
			presentation: "apps/host/src/service.ts#dispatch",
		});
		continue;
	}
	const callSite = cediaCallerFiles.find(path => cediaSourceTexts.get(path)?.includes(`"${row.name}"`) === true);
	if (callSite !== undefined) {
		entries.push({
			kind: row.kind,
			name: row.name,
			disposition: "integrated",
			handler: `Cedia client source (RPC \`${row.name}\`, ${callSite})`,
			presentation: "apps/host/src/service.ts#dispatch",
		});
		continue;
	}
	const uncarried = OMP_RPC_UNCARRIED.find(link => link.name === row.name);
	entries.push({
		kind: row.kind,
		name: row.name,
		disposition: "integration_missing",
		reason: uncarried !== undefined
			? `${uncarried.reason} (${uncarried.packet})`
			: "OMP owns this RPC command; Cedia has no equivalent owner surface.",
		handler: "packages/omp-adapter/src/client.ts#request",
		presentation: "No Cedia surface performs this operation yet.",
	});
}

for (const row of byKind(audited, "cli")) {
	const decision = cliDispositions[row.name] ?? { disposition: "integrated" as const };
	entries.push({
		kind: row.kind,
		name: row.name,
		disposition: decision.disposition,
		...(decision.reason === undefined ? {} : { reason: decision.reason }),
		handler: cediaLauncherHandler,
		presentation: "The owner's terminal, through cedia-omp",
		test: row.name === "browser-relay" ? "scripts/omp-relay-browser-proof.ts" : cediaLauncherTest,
	});
}
for (const row of byKind(audited, "cli-alias")) {
	// An alias is the same verb under another name (`img`, `wt`, `q`), so it inherits the answer.
	const parent = Object.entries({ images: ["img"], worktree: ["wt"], search: ["q", "web-search"], skill: ["skills"] }).find(([, aliases]) => aliases.includes(row.name))?.[0];
	const decision = parent === undefined ? { disposition: "integrated" as const } : cliDispositions[parent] ?? { disposition: "integrated" as const };
	entries.push({
		kind: row.kind,
		name: row.name,
		disposition: decision.disposition,
		...(decision.reason === undefined ? {} : { reason: decision.reason }),
		handler: cediaLauncherHandler,
		presentation: "The owner's terminal, through cedia-omp",
		test: cediaLauncherTest,
	});
}
// Launch flags travel through the same launcher. §2.2 settles protocol hosting modes and the
// session-owning flags meet the ownership rule: while an owner is live, `--session`,
// `--resume`/`-r`, `--session-dir`, `--fork` and `--continue`/`-c` are refused rather than run.
for (const row of byKind(audited, "launch-flag")) {
	entries.push({
		kind: row.kind,
		name: row.name,
		disposition: "integrated",
		handler: cediaLauncherHandler,
		presentation: "Forwarded to the pinned runtime by cedia-omp",
		test: "apps/host/test/cli-launcher.test.ts (session-owning flags are refused while an owner is live)",
	});
}
const tuiSlashOwner = new Map<string, string>();
const slashReach = new Map<string, { reachable: boolean; reason: string }>();
for (const row of audit.configCli.slashCommands ?? []) {
	const surfaces = Array.isArray(row.surfaces) ? row.surfaces.map(String) : [];
	const reachable = row.tuiOnly !== true && (surfaces.includes("rpc") || surfaces.includes("acp"));
	const reason = reachable
		? ""
		: `The dated audit limits this command to ${surfaces.length > 0 ? surfaces.join(", ") : "no"} surface${row.tuiOnly === true ? " and marks it TUI-only" : ""}; Cedia runs the runtime headless, so it has no terminal UI to dispatch it from.`;
	slashReach.set(row.name, { reachable, reason });
	const row_ = row as { aliases?: unknown; subcommands?: unknown };
	for (const alias of Array.isArray(row_.aliases) ? row_.aliases : []) {
		if (typeof alias !== "string") continue;
		slashReach.set(alias, { reachable, reason });
		tuiSlashOwner.set(alias, row.name);
	}
	for (const sub of Array.isArray(row_.subcommands) ? row_.subcommands : []) {
		const name = typeof sub === "string" ? sub : record(sub, "slash subcommand")?.name;
		if (typeof name === "string") slashReach.set(`${row.name} ${name}`, { reachable, reason });
	}
}
for (const kind of ["slash", "slash-alias", "slash-subcommand"]) {
	for (const row of byKind(audited, kind)) {
		const name = kind === "slash-subcommand" ? row.name.split(" ")[0]! : row.name;
		const reach = slashReach.get(row.name) ?? slashReach.get(name);
		const tui = (kind === "slash-subcommand" ? tuiSlashSubcommandDispositions[row.name] : undefined)
			?? tuiSlashDispositions[tuiSlashOwner.get(name) ?? name];
		const hangKey = kind === "slash" ? row.name : name;
		const hangReason = slashHangHeadless[hangKey];
		const available = reach?.reachable === true && hangReason === undefined;
		// A command Cedia's own prompt path carries is integrated; one the audit limits to the
		// terminal UI is decided by the operation it carries, never by the metadata alone.
		const disposition: OmpDisposition = available ? "integrated" : tui?.disposition ?? "integration_missing";
		entries.push({
			kind: row.kind,
			name: row.name,
			disposition,
			...(disposition === "integration_missing"
				? { reason: hangReason ?? tui?.reason ?? reach?.reason ?? "This command has no mapped Cedia operation yet." }
				: disposition === "explicitly_excluded" || disposition === "platform_presentation_equivalent"
					? { reason: tui?.reason ?? "The operation is carried by a Cedia surface, not by this TUI command." }
					: {}),
			handler: available
				? "packages/coding-agent/src/slash-commands/builtin-registry.ts#executeBuiltinSlashCommand (via --mode rpc-ui prompt)"
				: "The operation behind this TUI command is carried by the Cedia surface named in the reason.",
			presentation: available
				? "apps/macos/agent-window/src/cedia-adapter.ts (composer text + available_commands catalog)"
				: "Cedia's own surface for the same operation (see the reason).",
			test: available
				? "scripts/omp-slash-smoke.ts + apps/macos/agent-window/test/omp-slash-dispatch.test.ts"
				: undefined,
		});
	}
}

// OMP owns the tool registry and executes tools inside a turn (the audit's own boundary rule);
// Cedia owns the presentation seam. Every audited built-in, hidden control and alias therefore
// travels the same tool-card path, and the fixture applies one full lifecycle of each name
// through the production reducer.
for (const kind of ["tool", "tool-alias"]) {
	for (const row of byKind(audited, kind)) {
		entries.push({
			kind: row.kind,
			name: row.name,
			disposition: "integrated",
			handler: "packages/omp-adapter/src/client.ts#onFrame (OMP tool registry execution)",
			presentation: "apps/macos/src/state.ts#addOrUpdateTool (tool card keyed by the name OMP sends)",
			test: "apps/macos/test/omp-tool-presentation.test.ts",
		});
	}
}
// A dynamic tool exists only while its own subsystem registers it, and those subsystems are the
// packets that still have to land: browser and computer are O10, MCP and extension tools are
// O06 discovery, image and speech tools are provider surfaces OMP must actually resolve. The
// presentation seam is shared and proven, but the tool is not available until the owner is.
for (const row of byKind(audited, "dynamic-tool")) {
	// O06's MCP half is proven, not pending: a session started with `.mcp.json` connects the
	// listed stdio server through the runtime's own discovery, and the catalog bridge carries
	// the mounted tool with the runtime's own source class (plan §8.2 O06). Mount-scoped tools
	// stay out of the top-level active set by the runtime's own partition, so the row is
	// present with active false rather than missing.
	if (row.name === "mcp__<server>_<tool>") {
		entries.push({
			kind: row.kind,
			name: row.name,
			disposition: "integrated",
			reason: "A session with MCP configured shows the mounted tool in the live catalog with source mcp; the runtime keeps mount-scoped tools out of the top-level active set by design.",
			handler: "apps/host/src/omp-management.ts#OmpToolCatalog.read (owner route GET /v1/sessions/:id/tools/catalog over tools.catalog.get)",
			presentation: "apps/macos/src/state.ts#addOrUpdateTool (tool card keyed by the name OMP sends)",
			test: "scripts/omp-tools-mcp-smoke.ts (fixture MCP server appears as mcp__fixture_echo, source mcp, mount-scoped)",
		});
		continue;
	}
	// O05's provider-backed pair is classified, not pending: the runtime registers each one at
	// session start only when its setting is on and its backing provider or worker resolves,
	// and the Tool catalog panel shows the live answer per session — the registered row, or
	// a dependency row naming the requirements when absent. No provider means no tool, and
	// the panel says so instead of leaving a silent hole (plan §8.2 O05).
	// O10's eval preludes are classified, not pending: browser and computer are prelude
	// namespaces, never session tools, so they never appear in the catalog rows. Their live
	// signal is the Code Mode partition read (`tools.codemode.get`): a prelude the runtime
	// reports enabled is registered, and the Tool catalog panel draws a dependency row naming
	// the `browser.enabled`/`computer.enabled` requirement otherwise (plan §8.2 O06+O10).
	if (row.name === "browser" || row.name === "computer") {
		entries.push({
			kind: row.kind,
			name: row.name,
			disposition: "dependency_unavailable",
			reason: row.name === "browser"
				? "A prelude namespace, not a session tool: registered when `browser.enabled` is on and the runtime enables its browser eval prelude; the Tool catalog panel proves the live answer per session through the Code Mode partition read — an enabled prelude reads as registered, anything else as a dependency row naming the requirement."
				: "A prelude namespace, not a session tool: registered when `computer.enabled` is on and the runtime enables its computer eval prelude; the Tool catalog panel proves the live answer per session through the Code Mode partition read — an enabled prelude reads as registered, anything else as a dependency row naming the requirement.",
			handler: "apps/host/src/omp-management.ts#OmpCodeMode.read (controller route GET /v1/sessions/:id/tools/codemode over tools.codemode.get)",
			presentation: "The composer's Tool catalog panel proves prelude namespaces through the Code Mode section and draws dependency rows for unproven ones (identity and requirements, no management affordance)",
			test: "apps/macos/agent-window/test/cedia-tools-catalog.test.tsx (prelude proof through the partition, audit-pinned names)",
		});
		continue;
	}
	if (row.name === "<custom-or-extension-name>") {
		entries.push({
			kind: row.kind,
			name: row.name,
			disposition: "integrated",
			reason: "A session started with a trusted JS extension that calls `api.registerTool` shows the custom tool in the live catalog with source extension; the runtime owns registration and the catalog bridge carries the mounted row.",
			handler: "apps/host/src/omp-management.ts#OmpToolCatalog.read (owner route GET /v1/sessions/:id/tools/catalog over tools.catalog.get)",
			presentation: "apps/macos/src/state.ts#addOrUpdateTool (tool card keyed by the name OMP sends)",
			test: "scripts/omp-extension-tool-smoke.ts (fixture extension registers cedia_smoke_widget; bridge and host route carry it with source extension)",
		});
		continue;
	}
	if (row.name === "generate_image" || row.name === "tts") {
		entries.push({
			kind: row.kind,
			name: row.name,
			disposition: "dependency_unavailable",
			reason: row.name === "generate_image"
				? "Registered at session start only when `generate_image.enabled` is on and an image-capable provider resolves; the Tool catalog panel shows the live answer per session — the registered row, or a dependency row naming the requirements when absent."
				: "Registered at session start when `speechgen.enabled` is on; the Tool catalog panel shows the live answer per session — the registered row, or a dependency row naming the requirement when absent.",
			handler: "apps/host/src/omp-management.ts#OmpToolCatalog.read (owner route GET /v1/sessions/:id/tools/catalog over tools.catalog.get)",
			presentation: "The composer's Tool catalog panel draws the runtime's own rows plus dependency rows for absent provider tools (identity and requirements, no management affordance)",
			test: "apps/macos/agent-window/test/cedia-tools-catalog.test.tsx (dependency rows, audit-pinned names)",
		});
		continue;
	}
	entries.push({
		kind: row.kind,
		name: row.name,
		disposition: "integration_missing",
		reason: `${dynamicOwners[row.name] ?? "A later packet"} owns the subsystem that registers this dynamic tool; until it lands the tool cannot appear in a Cedia session.`,
		handler: "packages/omp-adapter/src/client.ts#onFrame (OMP tool registry execution)",
		presentation: "apps/macos/src/state.ts#addOrUpdateTool (tool card keyed by the name OMP sends)",
		test: "apps/macos/test/omp-tool-presentation.test.ts",
	});
}
for (const row of byKind(audited, "host-frame")) entries.push({ kind: row.kind, name: row.name, disposition: "integrated", handler: "packages/omp-adapter/src/host.ts#OmpHostDispatcher", presentation: "apps/host/src/service.ts#onFrame" });
for (const row of byKind(audited, "extension-ui")) entries.push({ kind: row.kind, name: row.name, disposition: "integrated", handler: "packages/omp-adapter/src/client.ts#onFrame (extension UI request lifecycle)", presentation: "apps/macos/src/state.ts (bounded extension slots; unsupported rendering returns explicit unsupported)" });
for (const row of byKind(audited, "event")) entries.push({ kind: row.kind, name: row.name, disposition: "integrated", handler: "packages/omp-adapter/src/client.ts#onFrame (session event projection)", presentation: "apps/macos/src/state.ts (bounded transcript projection of the runtime's own events)" });

// Settings rows carry the O04 policy per path: `editable` paths are the verified surface,
// credential paths stay with provider auth, rows without their own control are advanced, and
// the plan's provider endpoint/order/enabled rule excludes its nine. None of these block F;
// they classify honestly instead.
for (const row of byKind(audited, "setting")) {
	const source = record((audit.configCli.settings ?? []).find(entry => entry.path === row.name) ?? {}, `setting ${row.name}`);
	const decision = ompSettingDisposition({
		path: row.name,
		type: typeof source.type === "string" ? source.type : "string",
		credential: source.credential === true,
		ui: source.ui !== null && source.ui !== undefined,
		projectWritable: row.name === "modelRoles",
	});
	const disposition: OmpDisposition = decision.disposition === "editable"
		? "integrated"
		: decision.disposition === "protected"
			? "owner_only"
			: decision.disposition === "advanced"
				? "platform_presentation_equivalent"
				: "explicitly_excluded";
	entries.push({
		kind: row.kind,
		name: row.name,
		disposition,
		...(decision.reason === undefined ? {} : { reason: decision.reason }),
		handler: "apps/host/src/omp-settings.ts#readOmpSettingsValue (owner-only GET /v1/omp/settings/value; editable paths also write through PATCH /v1/omp/settings)",
		presentation: "Cedia's OMP settings destination (inventory with disposition, lazy per-row value, revision-checked write)",
		test: "scripts/omp-settings-smoke.ts + apps/host/test/omp-settings.test.ts",
	});
}

// The SDK supplement lists in-process `AgentSession` methods. §2.8 forbids reaching an operation
// by starting an SDK session, so an SDK entry is only settled when the same operation has a Cedia
// path over an audited RPC command Cedia actually sends. The table in `lib/omp-coverage.ts` names
// that command, and `verifyOmpSdkSourceLinks` fails the run if the adapter stops sending it, so a
// row here can never be a memory of a call site that no longer exists.
// A few SDK operations are carried by a command whose Cedia surface is a named destination rather
// than the composer. The row names that destination, so the mapping cannot credit a control that
// does not exist.

// ---------------------------------------------------------------------------
// Live runtime (optional): the prepared pinned runtime answers for itself.
// ---------------------------------------------------------------------------

const sdkLinks = new Map([...OMP_SDK_VIA_RPC, ...OMP_SDK_VIA_OTHER_PATH].map(link => [link.name, link]));
const reachableSlashCommands = new Set(
	[...slashReach].filter(([, value]) => value.reachable).map(([name]) => name),
);
const settingsPaths = new Set((audit.configCli.settings ?? []).map(row => row.path));

const requestedBinary = process.env.CEDIA_OMP_PATH ?? process.env.CEDIA_OMP_BINARY ?? join(root, "dist/omp/omp");
const executable = requestedBinary.includes(delimiter) || requestedBinary.includes("/")
	? requestedBinary.includes("/") ? resolve(root, requestedBinary) : requestedBinary
	: requestedBinary;

let liveVersion: string | undefined;
let liveSettingPaths: string[] = [];
let liveRawCapabilities: { readonly id: string; readonly state?: string }[] | undefined;
let capabilityTableMatches: boolean | undefined;
let liveAbsent = false;

if (!existsSync(executable)) {
	liveAbsent = true;
} else {
	const version = execFileSync(executable, ["--version"], { encoding: "utf8", timeout: 20_000 }).trim();
	if (!isSupportedOmpVersion(version)) {
		throw new Error(`Unsupported OMP runtime ${version} at ${executable}; baseline is omp/${OMP_BASELINE_VERSION}.`);
	}
	liveVersion = version;
	// A provider-free fixture agent directory: the reads below never start a turn, and the
	// endpoint below never answers, so reaching it at all would be a failure this gate
	// does not look for (no turn is ever dispatched here).
	const scratch = mkdtempSync(join(tmpdir(), "cedia-omp-coverage-"));
	writeFileSync(join(scratch, "models.yml"), `providers:
  fixture:
    baseUrl: http://127.0.0.1:9/v1
    auth: none
    api: openai-completions
    models:
      - id: coverage-fixture-model
        name: Cedia coverage fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`);
	let client: OmpRpcClient | undefined;
	try {
		client = await OmpRpcClient.start({
			executable,
			cwd: scratch,
			args: ["--no-session", "--no-title", "--no-extensions", "--no-skills", "--no-rules"],
			env: {
				PATH: process.env.PATH ?? `/usr/bin${delimiter}/bin`,
				HOME: scratch,
				PI_CODING_AGENT_DIR: scratch,
				PI_NO_PTY: "1",
				PI_NOTIFICATIONS: "off",
				CEDIA_RPC_VIRTUAL_UI: "1",
			},
			readyTimeoutMs: 30_000,
			requestTimeoutMs: 15_000,
		});
		const snapshot = await readOmpCapabilities(client);
		if (snapshot !== undefined) {
			liveRawCapabilities = snapshot.capabilities.map(descriptor => ({ id: descriptor.id, state: descriptor.state }));
			try {
				const rawA = ((await client.requestCedia("cedia_get_capabilities", {})) as { data?: unknown }).data;
				const rawB = ((await client.requestCedia("cedia_control", { operation: "capabilities.get" })) as { data?: unknown }).data;
				const unwrappedB = isRecord(rawB) && "result" in rawB ? (rawB as Record<string, unknown>).result : rawB;
				capabilityTableMatches = JSON.stringify(rawA) === JSON.stringify(unwrappedB);
			} catch {
				capabilityTableMatches = undefined;
			}
		}
		const keys = await readOmpSettingsKeys(client);
		if (keys !== undefined) liveSettingPaths = keys.keys.map(key => key.path);
	} finally {
		if (client !== undefined) await client.close().catch(() => {});
		rmSync(scratch, { recursive: true, force: true });
	}
}

/** The operations the running runtime reports as available, or undefined when none answered. */
const operationAvailable = liveRawCapabilities === undefined
	? undefined
	: new Set(liveRawCapabilities.filter(row => row.state === "available").map(row => row.id));

// Every audited RPC command must be in one of the adapter's supported unions; the per-command
// caller links above prove the carrying surface, this proves the name is one Cedia can send at
// all. Acceptance of each command is proven per command by those links and the smokes, not by
// enumeration: no list endpoint exists (get_available_commands serves the slash catalog).
const liveRpcUnsupported = auditedRpcCommands.size > 0
	? [...auditedRpcCommands].filter(name =>
		!(RPC_COMMAND_TYPES as readonly string[]).includes(name) &&
		!(CEDIA_UI_COMMAND_TYPES as readonly string[]).includes(name))
	: [];
const liveRpcCommands = [...auditedRpcCommands];

// Static union checks: the audit must not name an event or command outside the adapter's own
// vocabulary. These pass vacuously today; a drift on either side fails the run instead of
// silently redefining the surface.
const staticIssues: OmpCoverageIssue[] = [];
for (const name of liveRpcUnsupported) {
	staticIssues.push({ kind: "runtime_mismatch", name, message: `Audited RPC command '${name}' is in neither of the adapter's supported command unions.` });
}
for (const row of byKind(audited, "event")) {
	if (!(CEDIA_SESSION_EVENT_KINDS as readonly string[]).includes(row.name) && !(CEDIA_SESSION_EVENT_SIGNALS as readonly string[]).includes(row.name)) {
		staticIssues.push({ kind: "runtime_mismatch", name: row.name, message: `Audited event '${row.name}' is outside the adapter's session event vocabulary.` });
	}
}

// Stale sources: the recorded hash must still match, unless the path is one the tracked OMP
// patch touches (parsed from the patch itself, so the exemption applies to nothing else).
const coverageSources = record(audit.coverage, "coverage.json").sources as Record<string, string> | undefined;
const sourceHashes: Record<string, string | undefined> = {};
for (const path of Object.keys(coverageSources ?? {})) {
	sourceHashes[path] = sha256File(join(root, "upstream", "omp", path));
}
const sourceExemptions = new Set([...parsePatchExemptions(join(root, "patches", "omp", "0001-cedia-rpc-bridges.patch")), ...parsePatchExemptions(join(root, "patches", "omp", "0002-cedia-rpc-bridges-18.4.3.patch"))]);
const sdkPresentation: Record<string, { presentation: string; test: string }> = {
	moveSession: {
		presentation:
			"Cedia's composer sends `/move <existing-dir>` through the OMP prompt path and the headless handler relocates the session (the session file lands under the destination)",
		test: "scripts/omp-move-smoke.ts (relocation proven live with no turn and no provider call) + RPC bare/missing-target guard (usage texts, no wedge; see evidence/o02-move-headless-answered-2026-09-25/)",
	},
	getTodoPhases: {
		presentation:
			"Cedia's Progress surface reads the runtime's own todo phases: the composer panel over the owner-only `GET /v1/sessions/:id/progress`",
		test: "scripts/omp-progress-smoke.ts + apps/host/test/omp-todos.test.ts (the route projects the runtime's own phases)",
	},
	setAdvisorEnabled: {
		presentation:
			"Cedia's Advisor surface switches the session's advisor through the registered `advisor.set` operation (composer strip + owner-only `POST /v1/sessions/:id/advisor`)",
		test: "scripts/omp-advisor-smoke.ts + apps/host/test/omp-advisor.test.ts",
	},
	getAdvisorStatusOverview: {
		presentation:
			"Cedia's Advisor surface reads the runtime's own advisor state through the registered `advisor.get` operation (owner-only `GET /v1/sessions/:id/advisor`)",
		test: "scripts/omp-advisor-smoke.ts + apps/host/test/omp-advisor.test.ts",
	},
	getAdvisorStats: {
		presentation:
			"Cedia's Advisor surface shows each advisor's own status, context, tokens, cost and message counts from the runtime's `advisor.get`",
		test: "scripts/omp-advisor-smoke.ts + apps/host/test/omp-advisor.test.ts",
	},
	formatAdvisorHistoryAsText: {
		presentation:
			"Cedia's Advisor surface shows the transcript the runtime renders for `/advisor dump`, through the registered `advisor.history` operation",
		test: "scripts/omp-advisor-smoke.ts + apps/host/test/omp-advisor.test.ts",
	},
	applyAdvisorConfigs: {
		presentation:
			"Cedia's Advisor surface edits one scope's `WATCHDOG.yml` as raw text and saves it through the registered `advisor.config.set` operation (composer panel + owner-only durable `POST /v1/sessions/:id/advisor/config`), which validates strictly before writing and applies the re-discovered roster",
		test: "scripts/omp-advisor-config-smoke.ts + apps/host/test/omp-advisor-config.test.ts + packages/coding-agent/test/cedia-advisor-config-bridge.test.ts",
	},
	getQueuedMessages: {
		presentation:
			"Cedia's queue panel lists what OMP holds through the registered `queue.get` operation (owner-only `/v1/sessions/:id/queue`)",
		test: "scripts/omp-queue-smoke.ts + apps/host/test/omp-queue.test.ts",
	},
};
// A registered `cedia_control` operation is settled against the live table: the runtime has to
// report the operation as available, so this cannot outlive the registration it describes.
const operationLinks = new Map(OMP_SDK_VIA_OPERATION.map(link => [link.name, link]));
const sdkCallerLinks = new Map(OMP_SDK_VIA_CEDIA_CALLER.map(link => [link.name, link]));
const sdkDispositions = new Map(OMP_SDK_DISPOSITIONS.map(row => [row.name, row]));
const sdkSlashLinks = new Map(OMP_SDK_VIA_SLASH.map(link => [link.name, link]));
const sdkWindowLocalLinks = new Map(OMP_SDK_VIA_WINDOW_LOCAL.map(link => [link.name, link]));
for (const row of byKind(audited, "sdk")) {
	// An operation that is OMP's own behaviour rather than a client operation carries its own
	// disposition, with source evidence the verifier below re-reads.
	const disposition = sdkDispositions.get(row.name);
	if (disposition !== undefined) {
		entries.push({
			kind: row.kind,
			name: row.name,
			disposition: disposition.disposition,
			reason: disposition.reason,
			presentation: disposition.presentation,
			test: `source evidence: ${disposition.evidence.file}`,
		});
		continue;
	}
	const operationLink = operationLinks.get(row.name);
	if (operationLink !== undefined) {
		const namedDestination = sdkPresentation[row.name];
		entries.push({
			kind: row.kind,
			name: row.name,
			disposition: operationAvailable === undefined || operationAvailable.has(operationLink.operation) ? "integrated" : "integration_missing",
			...(operationAvailable === undefined || operationAvailable.has(operationLink.operation)
				? {}
				: { reason: `The runtime's own table does not report the registered operation '${operationLink.operation}' as available.` }),
		handler: `cedia_control operation \`${operationLink.operation}\` (packages/coding-agent/src/modes/rpc/cedia-capability-bridge.ts)`,
		presentation: namedDestination?.presentation ?? (operationLink.operation.startsWith("plan.")
			? "Cedia's own surface for the plan/vibe mode the operation drives (shared composer plan strip + host /v1/sessions/:id/plan, and the native plan-review panel)"
			: "Cedia's own surface for the goal mode the operation drives (composer goal header + host /v1/sessions/:id/goal)"),
			test: namedDestination?.test ?? (operationLink.operation.startsWith("plan.")
				? "packages/coding-agent/test/cedia-plan-bridge.test.ts + packages/coding-agent/test/cedia-capability-bridge.test.ts (the operation runs on the prepared runtime)"
				: "packages/omp-adapter/test/cedia-goal.test.ts (the operation runs on the prepared runtime)"),
		});
		continue;
	}
	const callerLink = sdkCallerLinks.get(row.name);
	if (callerLink !== undefined) {
		const namedCaller = sdkPresentation[row.name];
		entries.push({
			kind: row.kind,
			name: row.name,
			disposition: "integrated",
			handler: `Cedia host caller (RPC \`${callerLink.rpcCommand}\`, ${callerLink.caller})`,
			presentation: namedCaller?.presentation ?? `Cedia sends the audited \`${callerLink.rpcCommand}\` command from ${callerLink.caller} for this operation`,
			test: namedCaller?.test ?? `source evidence: ${callerLink.caller}`,
		});
		continue;
	}
	const slashLink = sdkSlashLinks.get(row.name);
	if (slashLink !== undefined) {
		const namedSlash = sdkPresentation[row.name];
		entries.push({
			kind: row.kind,
			name: row.name,
			disposition: "integrated",
			handler: `apps/macos/agent-window/src/cedia-adapter.ts (prompt path /${slashLink.slash})`,
			presentation: namedSlash?.presentation ?? `Cedia's composer sends /${slashLink.slash} through the OMP prompt path`,
			test: namedSlash?.test ?? "scripts/omp-slash-smoke.ts + apps/macos/agent-window/test/omp-slash-dispatch.test.ts",
		});
		continue;
	}
	const windowLocalLink = sdkWindowLocalLinks.get(row.name);
	if (windowLocalLink !== undefined) {
		entries.push({
			kind: row.kind,
			name: row.name,
			disposition: "platform_presentation_equivalent",
			reason: windowLocalLink.reason,
			handler: `Cedia window-local task navigation (${windowLocalLink.source})`,
			presentation: "Cedia selects the durable task in the current window; each task keeps its own host-owned OMP runtime",
			test: windowLocalLink.testFiles.map(testFile => testFile.path).join(" + "),
		});
		continue;
	}
	const link = sdkLinks.get(row.name);
	if (link === undefined) continue;
	const named = sdkPresentation[row.name];
	entries.push({
		kind: row.kind,
		name: row.name,
		disposition: "integrated",
		handler: link.via === "slash"
			? `apps/macos/agent-window/src/cedia-adapter.ts (prompt path /${link.value})`
			: link.via === "setting"
				? `apps/macos/agent-window/src/cedia-adapter.ts (OMP settings path \`${link.value}\`)`
				: `Cedia client source (RPC \`${link.rpcCommand}\`)`,
		presentation: named?.presentation ?? (link.via === "slash"
			? `Cedia's composer sends /${link.value} through the OMP prompt path`
			: link.via === "setting"
				? `The OMP settings destination in Cedia writes \`${link.value}\``
				: "The Cedia window's own control for the same operation (composer Send/Steer/Stop, model picker, rewind, compaction)"),
		test: named?.test ?? "scripts/lib/omp-coverage.test.ts (the link is proven against the audit and the adapter source)",
	});
}

// ---------------------------------------------------------------------------
// Verification, comparison and report.
// ---------------------------------------------------------------------------

// Fallback: every audited record leaves with exactly one mapping. Anything the tables above
// do not name is work Cedia has not done, stated with the kind's own reason rather than left
// unmapped. This is what keeps the mapping count equal to the audited count.
const fallbackReasons: Record<string, string> = {
	sdk: "OMP owns this SDK service; Cedia has no equivalent implementation surface.",
	slash: "This command has no mapped Cedia operation yet.",
	"slash-alias": "This command has no mapped Cedia operation yet.",
	"slash-subcommand": "This command has no mapped Cedia operation yet.",
	cli: "OMP owns this CLI command; Cedia has no equivalent owner surface.",
	"cli-alias": "OMP owns this CLI alias; Cedia has no equivalent owner surface.",
	setting: "OMP owns this setting; Cedia has no equivalent owner surface.",
	tool: "OMP owns this tool; Cedia has no equivalent owner surface.",
	"tool-alias": "OMP owns this tool alias; Cedia has no equivalent owner surface.",
	"dynamic-tool": "This dynamic tool has no Cedia surface yet.",
	"extension-ui": "OMP owns this extension UI method; Cedia has no equivalent owner surface.",
	"host-frame": "OMP owns this host frame; Cedia has no equivalent owner surface.",
	event: "OMP owns this session event; Cedia has no equivalent owner surface.",
	rpc: "OMP owns this RPC command; Cedia has no equivalent owner surface.",
	"launch-flag": "OMP owns this launch flag; Cedia has no equivalent owner surface.",
};
{
	const emitted = new Set(entries.map(entry => `${entry.kind} ${entry.name}`));
	for (const row of audited) {
		if (emitted.has(`${row.kind} ${row.name}`)) continue;
		entries.push({
			kind: row.kind,
			name: row.name,
			disposition: "integration_missing",
			reason: fallbackReasons[row.kind] ?? "Cedia has not implemented this audited record",
			handler: "No Cedia surface performs this operation yet.",
			presentation: "No Cedia surface performs this operation yet.",
		});
	}
}
let sourceLinkIssues = verifyOmpSdkSourceLinks([...OMP_SDK_VIA_RPC, ...OMP_SDK_VIA_OTHER_PATH], {
	auditedRpcCommands,
	auditedSdkNames,
	reachableSlashCommands,
	settingsPaths,
	cediaAdapterSource,
	cediaSourceTexts: cediaProviderOmpSource === undefined ? [] : [cediaProviderOmpSource],
});
sourceLinkIssues = [...sourceLinkIssues, ...verifyOmpSdkOperationLinks(OMP_SDK_VIA_OPERATION, { availableOperations: operationAvailable })];
sourceLinkIssues = [...sourceLinkIssues, ...verifyOmpSdkViaSlash(OMP_SDK_VIA_SLASH, { auditedSdkNames, reachableSlashCommands, cediaAdapterSource })];
sourceLinkIssues = [...sourceLinkIssues, ...verifyOmpSdkWindowLocalLinks(OMP_SDK_VIA_WINDOW_LOCAL, { auditedSdkNames, readFile: path => readSource(path) })];
const sdkCallerSources = new Map(OMP_SDK_VIA_CEDIA_CALLER.map(link => [link.caller, cediaSourceTexts.get(link.caller)]));
sourceLinkIssues = [...sourceLinkIssues, ...verifyOmpSdkCediaCallers(OMP_SDK_VIA_CEDIA_CALLER, { auditedRpcCommands, auditedSdkNames, sourceTexts: sdkCallerSources })];
sourceLinkIssues = [...sourceLinkIssues, ...verifyOmpSdkDispositions(OMP_SDK_DISPOSITIONS, { readFile: path => readSource(path), auditedSdkNames })];
sourceLinkIssues = [...sourceLinkIssues, ...verifyOmpRpcPaths([...OMP_RPC_VIA_OTHER_PATH, ...NEW_RPC_OTHER_PATHS], { auditedRpcCommands, reachableSlashCommands, settingsPaths, cediaAdapterSource })];
const rpcCallerSources = new Map(OMP_RPC_VIA_CEDIA_CALLER.map(link => [link.caller, cediaSourceTexts.get(link.caller)]));
sourceLinkIssues = [...sourceLinkIssues, ...verifyOmpRpcCediaCallers(OMP_RPC_VIA_CEDIA_CALLER, { sourceTexts: rpcCallerSources })];

const report = compareOmpCoverage(audit, entries, {
	sourceHashes,
	sourceExemptions,
	runtime: liveAbsent
		? {}
		: {
			settings: liveSettingPaths,
			rpcCommands: liveRpcCommands,
			capabilities: liveRawCapabilities,
			capabilityTableMatches,
		},
});

const allIssues = [...report.issues, ...sourceLinkIssues, ...staticIssues];
const fatalIssues = allIssues.filter(isIntegrityIssue);

const familyRank = new Map<string, number>(OMP_COVERAGE_FAMILIES.map((family, index) => [family, index]));
const sortedGaps = [...report.gaps].sort((a, b) =>
	(familyRank.get(a.family ?? "") ?? 999) - (familyRank.get(b.family ?? "") ?? 999) ||
	(a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));

console.log(`OMP coverage: ${report.audited.length} audited records; ${report.cedia.length} Cedia mappings.`);
if (liveAbsent) {
	console.log(`Live runtime: absent (${executable}); static audit evaluation only — no live answers to compare.`);
} else {
	const rpcCount = byKind(report.audited, "rpc").length;
	const settingsCount = liveSettingPaths.length;
	const capsCount = liveRawCapabilities?.length ?? 0;
	console.log(`Live runtime: checked ${liveVersion}; ${settingsCount} settings, ${rpcCount} audited RPC commands and ${capsCount} capability descriptors read.`);
}
console.log(`Integrity ${fatalIssues.length === 0 ? "PASS" : "FAIL"}: ${fatalIssues.length} fatal issue(s); ${report.gaps.length} audited records without an available Cedia disposition.`);
if (fatalIssues.length > 0) {
	for (const issue of allIssues) {
		console.log(`- [${issue.kind}] ${issue.recordKind ?? ""} ${issue.name}: ${issue.message}`);
	}
	process.exit(1);
}

console.log("Gap summary by O-family and kind:");
let cursor = "";
for (const gap of sortedGaps) {
	const key = `${gap.family ?? "?"} ${gap.kind}`;
	if (key !== cursor) {
		cursor = key;
		const count = sortedGaps.filter(other => (other.family ?? "?") === (gap.family ?? "?") && other.kind === gap.kind).length;
		console.log(`  ${key}: ${count}`);
	}
}

if (process.argv.includes("--list-gaps")) {
	for (const gap of sortedGaps) {
		console.log(`GAP ${gap.kind} ${gap.name} — ${gap.reason ?? "Cedia has not implemented this audited record"}`);
	}
}

if (process.argv.includes("--require-complete")) {
	if (sortedGaps.length > 0) {
		console.log(`F completeness: FAIL — ${sortedGaps.length} audited records without an available Cedia disposition.`);
		const kinds = [...new Set(sortedGaps.map(gap => gap.kind))].sort();
		for (const kind of kinds) {
			const names = sortedGaps.filter(gap => gap.kind === kind).map(gap => gap.name);
			console.log(`  ${kind}: ${names.length}`);
			for (const name of names.slice(0, 15)) console.log(`    e.g. ${name}`);
		}
		process.exit(1);
	}
	console.log("F completeness: PASS — every audited record has an available Cedia disposition.");
}
