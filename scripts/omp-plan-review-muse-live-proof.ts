/**
 * Bounded live proof of the OMP plan-review path through the CEDIA host.
 *
 * This uses an isolated scratch project/state directory and the owner's existing OMP profile.
 * It checks the exact Muse model and provider auth before dispatch, asks the plan-mode runtime
 * to submit one proposal, verifies the host projection, then cancels it by default. Pass
 * `--interactive-review` to inspect the generated proposal before choosing approve or cancel;
 * approval must complete in the same isolated scratch project. No packaged Cedia app or IDE is launched.
 *
 * Run: bun scripts/omp-plan-review-muse-live-proof.ts
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

import { startHostServer } from "../apps/host/src/server.ts";
import { OMP_BASELINE_VERSION, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { attestOmpRuntime } from "./lib/omp-runtime-integrity.ts";

const MODEL_PROVIDER = "opencode-go";
const MODEL_ID = "muse-spark-1.3-contributor";
const MODEL = `${MODEL_PROVIDER}/${MODEL_ID}`;
const ROOT = resolve(import.meta.dir, "..");
const REVIEW_TIMEOUT_MS = 180_000;
const interactiveReview = process.argv.includes("--interactive-review");

type RecordValue = Record<string, unknown>;

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP Muse plan-review proof failed: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message: string): RecordValue {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`OMP Muse plan-review proof failed: ${message}`);
	}
	return value as RecordValue;
}

async function waitFor<T>(
	read: () => Promise<T>,
	predicate: (value: T) => boolean,
	timeoutMs: number,
	label: string,
): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	let value = await read();
	while (!predicate(value) && Date.now() < deadline) {
		await new Promise(resolveDelay => setTimeout(resolveDelay, 500));
		value = await read();
	}
	if (!predicate(value)) throw new Error(`Timed out waiting for ${label}; no retry will be sent`);
	return value;
}

async function decideReview(review: RecordValue): Promise<"approve" | "cancel"> {
	if (!interactiveReview) return "cancel";
	console.log("\n--- OMP plan proposal (inspect before deciding) ---");
	console.log(`Title: ${String(review.title ?? "")}`);
	console.log(typeof review.planContent === "string" ? review.planContent : "<missing plan text>");
	console.log("--- end proposal ---");
	const readline = createInterface({ input: process.stdin, output: process.stdout });
	try {
		const answer = (await readline.question("Type approve to approve this scratch-only plan; anything else cancels: "))
			.trim()
			.toLowerCase();
		return answer === "approve" ? "approve" : "cancel";
	} finally {
		readline.close();
	}
}

const requested = process.env.CEDIA_OMP_PATH ?? process.env.CEDIA_OMP_BINARY ?? "dist/omp/omp";
const executable = requested.includes("/")
	? resolve(requested)
	: (process.env.PATH ?? "").split(delimiter).map(directory => join(directory, requested)).find(Boolean) ?? requested;
check(process.env.HOME !== undefined, "OMP's native-auth profile has a home directory");
if (interactiveReview) check(process.stdin.isTTY === true && process.stdout.isTTY === true, "interactive approval is attached to a terminal");
const attestation = attestOmpRuntime(ROOT, executable);
check(attestation.sourceVerified === true, "the pinned OMP runtime is source-attested before any provider turn");
const version = execFileSync(executable, ["--version"], { encoding: "utf8", timeout: 20_000 }).trim();
check(isSupportedOmpVersion(version), `the OMP runtime is ${OMP_BASELINE_VERSION} or later (${version})`);

const scratch = await mkdtemp(join(tmpdir(), "cedia-o07-plan-live-"));
const projectPath = join(scratch, "project");
const stateDir = join(scratch, "host");
await mkdir(projectPath, { recursive: true });

let started: Awaited<ReturnType<typeof startHostServer>> | undefined;
let promptDispatched = false;
const result: RecordValue = {
	model: MODEL,
	version,
	runtimeAttested: attestation.sourceVerified,
	providerTurnDispatched: false,
};

const safeError = (error: unknown): string => {
	const message = error instanceof Error ? error.message : String(error);
	return message.replaceAll(scratch, "<scratch>").replaceAll(homedir(), "<home>").slice(0, 500);
};

try {
	started = await startHostServer({
		stateDir,
		port: 0,
		ompExecutable: executable,
		virtualUi: true,
		ompArgs: ["--no-skills", "--no-rules", "--no-extensions"],
		ompEnv: {
			HOME: homedir(),
			PI_NO_PTY: "1",
			PI_NOTIFICATIONS: "off",
			CEDIA_NODE: process.execPath,
		},
	});
	const ownerToken = started.auth.ownerToken;
	const route = (method: string, path: string, body?: unknown) =>
		started!.router({ method, path, token: ownerToken, ...(body === undefined ? {} : { body }) });
	const project = started.host.store.createProject({ path: projectPath, name: "O07 Muse plan review proof" });
	const session = started.host.createSession(project.id, "O07 Muse plan review proof");
	await started.host.startSession(session.id);
	const incarnation = started.host.store.getSession(session.id)?.incarnation;
	check(typeof incarnation === "string" && incarnation.length > 0, "the isolated OMP task has an incarnation");

	const modelReady = await waitFor(
		async () => route("GET", `/v1/sessions/${session.id}/model-state`),
		response => response.status === 200 && record(response.body, "model-state").available === true,
		45_000,
		"the isolated OMP session to finish startup",
	);
	check(modelReady.status === 200, "the isolated session is ready before model selection");
	const selected = await route("POST", `/v1/sessions/${session.id}/commands`, {
		commandId: "o07-plan-live-select-model",
		incarnation,
		command: "set_model",
		payload: { provider: MODEL_PROVIDER, modelId: MODEL_ID },
	});
	check(selected.status === 200, `the host accepted explicit ${MODEL} selection before a turn`);
	const selectedState = record((await route("GET", `/v1/sessions/${session.id}/model-state`)).body, "selected model state");
	const selectedModel = record(selectedState.model, "selected model");
	check(
		selectedState.available === true && selectedModel.provider === MODEL_PROVIDER && selectedModel.id === MODEL_ID,
		`the effective model reads back exactly as ${MODEL}`,
	);
	const providerResponse = await route("GET", "/v1/providers");
	check(providerResponse.status === 200, "OMP provider auth metadata is readable before dispatch");
	const providers = record(providerResponse.body, "provider response").providers;
	check(Array.isArray(providers), "OMP returned provider auth metadata");
	const provider = providers.map(value => record(value, "provider row")).find(value => value.id === MODEL_PROVIDER);
	check(provider?.authenticated === true && provider.available === true, "opencode-go is available and authenticated before spend");
	result.modelSelected = true;
	result.providerAuthenticated = true;

	const planReady = await waitFor(
		async () => route("GET", `/v1/sessions/${session.id}/plan`),
		response => response.status === 200 && record(response.body, "plan state").state === "available",
		30_000,
		"the negotiated OMP plan bridge",
	);
	check(planReady.status === 200, "the host exposes OMP's native plan bridge");
	const entered = await route("POST", `/v1/sessions/${session.id}/plan`, {
		commandId: "o07-plan-live-enter",
		incarnation,
		op: "enter",
	});
	check(entered.status === 200, `OMP accepted plan mode (${entered.status})`);
	const enteredBody = record(entered.body, "plan-enter response");
	check(enteredBody.changed === true && record(enteredBody.plan, "active plan").enabled === true, "the runtime entered its own plan mode");

	const prompt = "Prepare a tiny plan for replying to the user with a two-sentence summary of the word 'pinecone'. Use the plan proposal workflow and submit the finished plan through xd://propose for review. Do not create or edit project files. After approval, return the two-sentence summary without using any more tools.";
	const promptResponse = await route("POST", `/v1/sessions/${session.id}/commands`, {
		commandId: "o07-plan-live-propose",
		incarnation,
		command: "prompt",
		payload: { message: prompt },
	});
	check(promptResponse.status === 200, `the single plan-proposal prompt was accepted (${promptResponse.status})`);
	promptDispatched = true;
	result.providerTurnDispatched = true;
	result.userPromptCommands = 1;

	const reviewResponse = await waitFor(
		async () => route("GET", `/v1/sessions/${session.id}/plan`),
		response => {
			if (response.status !== 200) return false;
			const body = record(response.body, "plan review projection");
			return body.state === "available" && body.review !== null && body.review !== undefined;
		},
		REVIEW_TIMEOUT_MS,
		"the live model's held plan review",
	);
	const reviewBody = record(reviewResponse.body, "plan review response");
	const review = record(reviewBody.review, "held plan review");
	check(reviewBody.state === "available", "the host reports a live plan review");
	check(Number.isSafeInteger(review.reviewId), "the plan review has OMP's review id");
	check(typeof review.title === "string" && review.title.trim().length > 0, "the live proposal has a title");
	check(typeof review.planFilePath === "string" && review.planFilePath.startsWith("local://"), "the proposal points to OMP's session-local plan artifact");
	check(typeof review.planContent === "string" && review.planContent.trim().length > 0, "the host projected the plan text written by the live model");
	check(review.truncated === false && String(review.planContent).length <= 64 * 1024, "the bounded review projection contains the complete short plan");
	result.reviewObserved = true;
	result.reviewId = review.reviewId;
	result.reviewTitlePresent = true;
	result.reviewPlanChars = String(review.planContent).length;
	result.reviewPlanSha256 = createHash("sha256").update(String(review.planContent)).digest("hex");

	const decision = await decideReview(review);
	result.reviewDecision = decision;
	const beforeDecisionEvents = started.host.store.readEvents(session.id, 0, 500).events;
	const afterSequence = beforeDecisionEvents.at(-1)?.sequence ?? 0;
	check(typeof afterSequence === "number" && Number.isSafeInteger(afterSequence), "the event cursor is known before deciding the proposal");
	const decided = await route("POST", `/v1/sessions/${session.id}/plan`, {
		commandId: `o07-plan-live-${decision}-review`,
		incarnation,
		op: "review.decide",
		reviewId: review.reviewId,
		decision,
	});
	check(decided.status === 200, `the owner submitted the ${decision} decision (${decided.status})`);
	const decidedBody = record(decided.body, "review-decision response");
	check(decidedBody.changed === true && decidedBody.review === null, `${decision} closes the review and returns the runtime snapshot`);
	const finalPlanResponse = await route("GET", `/v1/sessions/${session.id}/plan`);
	const finalPlan = record(finalPlanResponse.body, "final plan state");
	check(finalPlanResponse.status === 200 && finalPlan.review === null, "the host no longer exposes a pending review after the decision");
	if (decision === "approve") {
		let completedEvents: ReturnType<typeof started.host.store.readEvents>["events"];
		try {
			completedEvents = await waitFor(
				async () => started!.host.store.readEvents(session.id, afterSequence, 500).events,
				events => events.some(event => {
					const frame = record(event.frame, "event frame");
					return frame.type === "agent_end" && frame.isTerminal !== false;
				}),
				REVIEW_TIMEOUT_MS,
				"OMP to finish its post-approval turn",
			);
		} catch (error) {
			const sessionStatus = started.host.store.getSession(session.id)?.status ?? "missing";
			const recentFrames = started.host.store.readEvents(session.id, afterSequence, 100).events.map(event => {
				const frame = record(event.frame, "stored event frame");
				return {
					sequence: event.sequence,
					type: typeof frame.type === "string" ? frame.type : "unknown",
					...(typeof frame.toolName === "string" ? { toolName: frame.toolName } : {}),
				};
			});
			result.approvalDiagnostics = { sessionStatus, recentFrames };
			throw new Error(`${error instanceof Error ? error.message : String(error)}; session=${sessionStatus}; recentFrames=${JSON.stringify(recentFrames)}`);
		}
		const completedEvent = completedEvents.find(event => {
			const frame = record(event.frame, "event frame");
			return frame.type === "agent_end" && frame.isTerminal !== false;
		});
		check(completedEvent !== undefined, "OMP reported a terminal agent_end after approval");
		result.approvalTurnCompleted = true;
		result.approvalTurnEndSequence = completedEvent.sequence;
		check((await readdir(projectPath)).length === 0, "the approved plan completed without changing the scratch project");
	} else {
		result.reviewCancelled = true;
	}
	result.reviewContent = "not retained";
	console.log(JSON.stringify({ result: "ok", ...result, runtime: attestation }));
} catch (error) {
	result.result = promptDispatched ? "failed-after-one-prompt-no-retry" : "stopped-before-provider-turn";
	result.error = safeError(error);
	console.log(JSON.stringify({ ...result, runtime: attestation }));
	process.exitCode = 1;
} finally {
	await started?.close();
	await rm(scratch, { recursive: true, force: true });
}
