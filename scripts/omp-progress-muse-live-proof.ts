/**
 * One-turn live proof that an OMP agent's native `todo` result reaches CEDIA progress.
 *
 * The runner uses one isolated scratch project/state directory and OMP's existing profile. It
 * checks the exact Muse model and provider auth before dispatch, sends one prompt without retry,
 * and requires both the journaled OMP `tool_execution_end` frame and the host progress projection
 * to contain the same runtime-authored task list. It does not execute the task or launch Cedia.app.
 *
 * Run: bun scripts/omp-progress-muse-live-proof.ts
 */
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

import { startHostServer } from "../apps/host/src/server.ts";
import { OMP_BASELINE_VERSION, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { attestOmpRuntime } from "./lib/omp-runtime-integrity.ts";

const MODEL_PROVIDER = "opencode-go";
const MODEL_ID = "muse-spark-1.3-contributor";
const MODEL = `${MODEL_PROVIDER}/${MODEL_ID}`;
const ROOT = resolve(import.meta.dir, "..");
const TODO_TIMEOUT_MS = 180_000;
const TASK = "CEDIA_O07_LIVE_TODO_PROOF";

type RecordValue = Record<string, unknown>;

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP Muse progress proof failed: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message: string): RecordValue {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`OMP Muse progress proof failed: ${message}`);
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

const requested = process.env.CEDIA_OMP_PATH ?? process.env.CEDIA_OMP_BINARY ?? "dist/omp/omp";
const executable = requested.includes("/")
	? resolve(requested)
	: (process.env.PATH ?? "").split(delimiter).map(directory => join(directory, requested)).find(Boolean) ?? requested;
check(process.env.HOME !== undefined, "OMP's native-auth profile has a home directory");
const attestation = attestOmpRuntime(ROOT, executable);
check(attestation.sourceVerified === true, "the pinned OMP runtime is source-attested before any provider turn");
const version = execFileSync(executable, ["--version"], { encoding: "utf8", timeout: 20_000 }).trim();
check(isSupportedOmpVersion(version), `the OMP runtime is ${OMP_BASELINE_VERSION} or later (${version})`);

const scratch = await mkdtemp(join(tmpdir(), "cedia-o07-todo-live-"));
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
	const project = started.host.store.createProject({ path: projectPath, name: "O07 Muse progress proof" });
	const session = started.host.createSession(project.id, "O07 Muse progress proof");
	await started.host.startSession(session.id);
	const incarnation = started.host.store.getSession(session.id)?.incarnation;
	check(typeof incarnation === "string" && incarnation.length > 0, "the isolated OMP task has an incarnation");

	await waitFor(
		async () => route("GET", `/v1/sessions/${session.id}/model-state`),
		response => response.status === 200 && record(response.body, "model-state").available === true,
		45_000,
		"the isolated OMP session to finish startup",
	);
	const selected = await route("POST", `/v1/sessions/${session.id}/commands`, {
		commandId: "o07-todo-live-select-model",
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

	const initial = record((await route("GET", `/v1/sessions/${session.id}/progress`)).body, "initial progress");
	check(initial.state === "available" && Array.isArray(initial.phases) && initial.phases.length === 0, "the live OMP task starts with an honest empty todo list");
	const prompt = `Use the native todo tool exactly once to initialize one phase named "O07 live proof" with exactly one task named "${TASK}". Do not do the task or use any other tool. After the todo call, reply exactly TODO_PROOF_DONE.`;
	const promptResponse = await route("POST", `/v1/sessions/${session.id}/commands`, {
		commandId: "o07-todo-live-prompt",
		incarnation,
		command: "prompt",
		payload: { message: prompt },
	});
	check(promptResponse.status === 200, `the single todo prompt was accepted (${promptResponse.status})`);
	promptDispatched = true;
	result.providerTurnDispatched = true;
	result.userPromptCommands = 1;

	const observed = await waitFor(
		async () => {
			const progressResponse = await route("GET", `/v1/sessions/${session.id}/progress`);
			const events = started!.host.store.readEvents(session.id, 0, 500).events;
			const todoEvent = events.find(event => {
				const frame = record(event.frame, "journal frame");
				return frame.type === "tool_execution_end" && frame.toolName === "todo";
			});
			return { progressResponse, todoEvent };
		},
		value => value.progressResponse.status === 200 && value.todoEvent !== undefined,
		TODO_TIMEOUT_MS,
		"the live OMP todo tool result and CEDIA progress projection",
	);
	const progressResponse = observed.progressResponse;
	const progress = record(progressResponse.body, "progress after native todo call");
	const phases = progress.phases;
	check(progress.state === "available" && Array.isArray(phases) && phases.length === 1, "the host projects one live runtime-authored phase");
	const phase = record((phases as unknown[])[0], "live todo phase");
	check(phase.name === "O07 live proof" && Array.isArray(phase.tasks) && phase.tasks.length === 1, "the host projection preserves the requested phase and single task");
	const task = record((phase.tasks as unknown[])[0], "live todo task");
	const frame = record(observed.todoEvent!.frame, "OMP todo tool result frame");
	const toolResult = record(frame.result, "OMP todo tool result");
	const details = record(toolResult.details, "OMP todo tool details");
	result.todoToolEventObserved = true;
	result.todoToolEventSequence = observed.todoEvent!.sequence;
	result.projectedTaskContentMatches = task.content === TASK;
	result.projectedTaskStatus = typeof task.status === "string" ? task.status : "invalid";
	result.todoToolEventPhasesMatch = Array.isArray(details.phases) && JSON.stringify(details.phases) === JSON.stringify(phases);
	check(
		task.content === TASK && task.status === "in_progress",
		"the live agent-created todo task reaches the host with OMP's auto-started status",
	);
	check(
		result.todoToolEventPhasesMatch === true,
		"the CEDIA progress snapshot matches the phases in OMP's own todo tool result",
	);
	result.projectedPhaseCount = 1;
	result.projectedTask = TASK;
	result.progressRevision = progress.revision;
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
