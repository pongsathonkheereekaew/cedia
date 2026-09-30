/**
 * Live proof that Cedia can steer OMP browser tools onto its own endpoint and back
 * (plan §8.2 O10, steering half only — no Electron, no tabs, no driving).
 *
 * `browser.cdpUrl` carries a `ui` block in the runtime schema, so the existing
 * owner-only PATCH settings route writes it; empty clears it (upstream treats empty
 * as unset and falls through to its own browser launch). Proves: key inventory marks
 * it editable, write lands, readback matches, clear restores the default, controller
 * writes are refused. The per-thread CDP endpoint behind the URL is proven by the
 * fixture suites (`cdp-tab-endpoint`, `agent-window-browser`).
 *
 * Run: bun scripts/omp-browser-steer-smoke.ts
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP browser steer smoke failed: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`OMP browser steer smoke failed: ${message}`);
	return value as Record<string, unknown>;
}

const requested = process.env.CEDIA_OMP_PATH ?? process.env.CEDIA_OMP_BINARY ?? "dist/omp/omp";
const executable = requested.includes("/") ? resolve(requested) : requested;
const version = execFileSync(executable, ["--version"], { encoding: "utf8", timeout: 20_000 }).trim();
check(isSupportedOmpVersion(version), `the runtime is the pinned ${OMP_BASELINE_VERSION} or later (${version})`);

const modelsYaml = `providers:
  probe:
    baseUrl: http://127.0.0.1:9/v1
    auth: none
    api: openai-completions
    models:
      - id: probe-model
        name: Probe
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`;

const hostStateDir = await mkdtemp(join(tmpdir(), "cedia-steer-state-"));
const hostProfileDir = await mkdtemp(join(tmpdir(), "cedia-steer-profile-"));
const hostWorkDir = await mkdtemp(join(tmpdir(), "cedia-steer-work-"));
await writeFile(join(hostProfileDir, "models.yml"), modelsYaml, { mode: 0o600 });
const started = await startHostServer({
	stateDir: hostStateDir,
	port: 0,
	ompExecutable: executable,
	virtualUi: true,
	ompEnv: { HOME: hostProfileDir, PI_CODING_AGENT_DIR: hostProfileDir, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
});
try {
	const owner = started.auth.ownerToken;
	const project = started.host.store.createProject({ path: hostWorkDir, name: "Steer smoke" });
	const session = started.host.createSession(project.id, "Steer smoke");
	await started.host.startSession(session.id);

	const keys = record(
		(await started.router({ method: "GET", path: "/v1/omp/settings/keys", token: owner })).body as unknown,
		"keys body",
	);
	const cdp = ((keys as { keys?: Record<string, unknown>[] }).keys ?? []).find(key => key.path === "browser.cdpUrl") as Record<string, unknown> | undefined;
	check(cdp !== undefined && (cdp as { disposition?: string }).disposition === "editable", "the inventory marks browser.cdpUrl editable");

	const read0 = (await started.router({ method: "GET", path: "/v1/omp/settings/value?path=browser.cdpUrl", token: owner })).body as Record<string, unknown>;
	console.log(`NOTE reading an unset browser.cdpUrl answers ${JSON.stringify(read0).slice(0, 120)} (unset has no value to project; steering writes first)`);
	const revision = String((keys as { settingsRevision?: unknown }).settingsRevision ?? "");
	check(revision.length > 0, "the inventory carries the settings revision a write names");

	const endpoint = "http://127.0.0.1:19999";
	const written = record(
		(
			await started.router({
				method: "PATCH",
				path: "/v1/omp/settings",
				token: owner,
				body: { path: "browser.cdpUrl", value: endpoint, expectedRevision: revision },
			})
		).body as unknown,
		"write body",
	);
	check((written as { value?: unknown }).value === endpoint, `steering onto the agent endpoint writes (${endpoint})`);

	const readback = record(
		(await started.router({ method: "GET", path: "/v1/omp/settings/value?path=browser.cdpUrl", token: owner })).body as unknown,
		"readback body",
	);
	check((readback as { value?: unknown }).value === endpoint, "the steered endpoint reads back");
	const revision2 = String((readback as { settingsRevision?: unknown }).settingsRevision ?? "");
	check(revision2.length > 0 && revision2 !== revision, "the write produced a new settings revision");

	const cleared = record(
		(
			await started.router({
				method: "PATCH",
				path: "/v1/omp/settings",
				token: owner,
				body: { path: "browser.cdpUrl", value: "", expectedRevision: revision2 },
			})
		).body as unknown,
		"clear body",
	);
	check((cleared as { value?: unknown }).value === "", "clearing restores the default (empty steers nothing)");

	const controller = await started.router({
		method: "PATCH",
		path: "/v1/omp/settings",
		token: (await started.auth.issue("steer-controller")).token,
		body: { path: "browser.cdpUrl", value: endpoint },
	});
	check(controller.status === 403, `steering is owner-only (${controller.status})`);
} finally {
	await started.close();
}

await Promise.all([
	rm(hostStateDir, { recursive: true, force: true }),
	rm(hostProfileDir, { recursive: true, force: true }),
	rm(hostWorkDir, { recursive: true, force: true }),
]);
console.log(JSON.stringify({ ok: true, version }));
