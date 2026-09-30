/**
 * Live proof of Cedia's own host URI scheme against the pinned runtime (plan §8.2 O05, item 37).
 *
 * The scheme is only honest with a reader behind it, so this run proves both halves against the
 * real runtime and a real host:
 *
 * 1. a task starts on the prepared `omp/18.1.18`, which means the runtime installed the scheme the
 *    host registered - the host treats a missing scheme in the runtime's own answer as a failure, so
 *    a started session is a verified acceptance rather than an assumption;
 * 2. the bytes behind `cedia://artifact/<sha256>` are the captured ones: the smoke changes the
 *    workspace file after capturing it and reads the artifact back through the host's own route, so
 *    the immutable copy is what answers.
 *
 * The `host_uri_request` frame path itself is covered by `apps/host/test/host-uri.test.ts`, which
 * drives the dispatcher with the runtime's own frame shape. No model endpoint answers here, so no
 * provider request leaves the machine.
 *
 * Run: bun scripts/omp-host-uri-smoke.ts
 */
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP host URI smoke failed: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`OMP host URI smoke failed: ${message}`);
	return value as Record<string, unknown>;
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

const requested = process.env.CEDIA_OMP_PATH ?? process.env.CEDIA_OMP_BINARY ?? "dist/omp/omp";
const executable = requested.includes("/")
	? resolve(requested)
	: ((process.env.PATH ?? "")
			.split(delimiter)
			.map(dir => join(dir, requested))
			.find(candidate => candidate) ?? requested);
check(await exists(executable), `OMP runtime is present at ${executable}`);
const version = execFileSync(executable, ["--version"], { encoding: "utf8", timeout: 20_000 }).trim();
check(isSupportedOmpVersion(version), `the runtime is the pinned ${OMP_BASELINE_VERSION} or later (${version})`);

const held: Server = createServer(() => {
	/* never responds: no provider call in this run may complete */
});
await new Promise<void>(ready => held.listen(0, "127.0.0.1", () => ready()));
const address = held.address();
const port = address !== null && typeof address === "object" ? (address as { port: number }).port : 0;
check(port > 0, "fixture listener bound");

const hostStateDir = await mkdtemp(join(tmpdir(), "cedia-host-uri-state-"));
const hostProfileDir = await mkdtemp(join(tmpdir(), "cedia-host-uri-profile-"));
const hostWorkDir = await mkdtemp(join(tmpdir(), "cedia-host-uri-work-"));
await writeFile(
	join(hostProfileDir, "models.yml"),
	`providers:
  cedia-host-uri-fixture:
    baseUrl: http://127.0.0.1:${port}/v1
    auth: none
    api: openai-completions
    models:
      - id: cedia-host-uri-fixture-model
        name: Cedia host URI smoke fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`,
);
await writeFile(join(hostWorkDir, "receipt.txt"), "captured before the change", { mode: 0o600 });

try {
	const started = await startHostServer({
		stateDir: hostStateDir,
		port: 0,
		ompExecutable: executable,
		virtualUi: true,
		ompEnv: { HOME: hostProfileDir, PI_CODING_AGENT_DIR: hostProfileDir, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
	});
	try {
		const owner = started.auth.ownerToken;
		const project = started.host.store.createProject({ path: hostWorkDir, name: "Host URI smoke" });
		const session = started.host.createSession(project.id, "Host URI smoke");

		const captured = await started.router({
			method: "POST",
			path: `/v1/sessions/${session.id}/artifacts`,
			token: owner,
			body: { path: "receipt.txt" },
		});
		check(captured.status === 200 || captured.status === 201, `the artifact route captured the file (${captured.status})`);
		const receipt = record(record(captured.body).receipt ?? captured.body, "artifact receipt");
		const sha256 = String(receipt.sha256 ?? "");
		check(/^[a-f0-9]{64}$/.test(sha256), `the capture is content-addressed (${sha256.slice(0, 12)}…)`);

		// The task starts on the runtime; the host verifies the runtime installed the scheme it
		// registered, so reaching a live session here is the acceptance proof.
		await started.host.startSession(session.id);
		check(true, "the runtime installed Cedia's host URI scheme (a refused scheme fails the start)");

		// The workspace copy changes; the artifact is what the scheme serves.
		await writeFile(join(hostWorkDir, "receipt.txt"), "changed after the capture", { mode: 0o600 });
		const readBack = await started.router({
			method: "GET",
			path: `/v1/sessions/${session.id}/artifacts/${sha256}`,
			token: owner,
		});
		const chunk = record(readBack.body, "artifact chunk");
		const text = Buffer.from(String(chunk.data ?? ""), "base64").toString("utf8");
		check(text === "captured before the change", "the captured bytes are what the artifact answers, not the edited file");

		const notOwner = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/artifacts/${sha256}` });
		check(notOwner.status === 401 || notOwner.status === 403, `the artifact route stays owner-only (${notOwner.status})`);
	} finally {
		await started.close();
	}
} finally {
	await Promise.all([
		rm(hostStateDir, { recursive: true, force: true }),
		rm(hostProfileDir, { recursive: true, force: true }),
		rm(hostWorkDir, { recursive: true, force: true }),
		new Promise<void>(close => held.close(() => close())),
	]);
}

console.log(JSON.stringify({ ok: true, version }, null, 2));
