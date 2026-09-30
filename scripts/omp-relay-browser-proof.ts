/**
 * Packaged Cedia → OMP Eval → Browser Relay proof on a temporary local fixture tab.
 *
 * A local canned model emits one fixed eval call. The call selects only the
 * fixture's exact title via app.target, clicks its local button, reads the
 * resulting marker, and releases the OMP browser handle. No external provider
 * is contacted and no unrelated browser tab is read or changed.
 *
 * Requires the owner-installed OMP extension and its already-running loopback
 * relay. The script opens and closes its own fixture tab through that relay.
 */
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import puppeteer from "/Users/pond/cedia/upstream/omp/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";
import { OMP_BASELINE_VERSION, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP relay browser proof failed: ${message}`);
	console.log(`OK   ${message}`);
}
function record(value: unknown, message: string): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`OMP relay browser proof failed: ${message}`);
	return value as Record<string, unknown>;
}

const root = resolve(import.meta.dir, "..");
const relayUrl = process.env.CEDIA_BROWSER_RELAY_URL ?? "http://127.0.0.1:9224";
const requested = process.env.CEDIA_OMP_PATH ?? process.env.CEDIA_OMP_BINARY ?? "dist/omp/omp";
const executable = requested.includes("/") ? resolve(requested) : requested;
const version = execFileSync(executable, ["--version"], { encoding: "utf8", timeout: 20_000 }).trim();
check(isSupportedOmpVersion(version), `runtime is pinned OMP ${OMP_BASELINE_VERSION} (${version})`);

const relayVersion = await fetch(`${relayUrl}/json/version`, { signal: AbortSignal.timeout(3_000) });
check(relayVersion.ok, `owner-installed relay is connected (${relayVersion.status})`);
const descriptor = record(await relayVersion.json(), "relay descriptor is an object");
check(typeof descriptor.webSocketDebuggerUrl === "string", "relay advertises its local CDP socket");

const fixtureTitle = `CEDIA O10 Relay Fixture ${Date.now().toString(36)}`;
let fixtureClicks = 0;
let modelRequests = 0;
let interrupted = false;
const onInterrupt = () => { interrupted = true; };
process.on("SIGINT", onInterrupt);
const fixture = createServer((req, res) => {
	if (req.method === "POST" && req.url === "/clicked") {
		fixtureClicks++;
		res.writeHead(204).end();
		return;
	}
	if (req.method !== "GET" || req.url !== "/") {
		res.writeHead(404).end();
		return;
	}
	res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(
		`<!doctype html><title>${fixtureTitle}</title><main><h1>Local O10 fixture</h1>` +
		`<button id="run" onclick="document.body.dataset.result='clicked';fetch('/clicked',{method:'POST'})">Run fixture action</button></main>`,
	);
});
await new Promise<void>((ready) => fixture.listen(0, "127.0.0.1", ready));
const fixtureAddress = fixture.address();
check(fixtureAddress !== null && typeof fixtureAddress === "object", "local fixture server bound");
const fixtureUrl = `http://127.0.0.1:${fixtureAddress.port}/`;

const relayBrowser = await puppeteer.connect({ browserURL: relayUrl, protocolTimeout: 20_000 });
let fixturePage: Awaited<ReturnType<typeof relayBrowser.newPage>> | undefined;
let host: Awaited<ReturnType<typeof startHostServer>> | undefined;
let app: any;
let stub: Server | undefined;
const scratch = await mkdtemp(join(tmpdir(), "cedia-o10-relay-"));
const output = join(root, "dist/o10-relay-browser-proof");
const profile = join(scratch, "omp-profile");
const state = join(scratch, "host-state");
const work = join(scratch, "project");
await Promise.all([mkdir(profile, { recursive: true }), mkdir(work, { recursive: true }), mkdir(output, { recursive: true })]);

try {
	fixturePage = await relayBrowser.newPage();
	await fixturePage.goto(fixtureUrl, { waitUntil: "load" });
	check((await fixturePage.title()) === fixtureTitle, "created a dedicated fixture tab over the existing relay");

	stub = createServer((req, res) => {
		if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
			res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "fixture-only route" }));
			return;
		}
		let body = "";
		req.on("data", (chunk: Buffer) => {
			body += chunk.toString();
			if (Buffer.byteLength(body) > 1_000_000) req.destroy(new Error("fixture model request exceeded bound"));
		});
		req.on("end", () => {
			const request = record(JSON.parse(body), "model request is an object");
			check(request.stream === true, "runtime requested a streamed completion from the local fixture");
			modelRequests++;
			check(modelRequests <= 2, "fixture model stayed within the two-response turn budget");
			let responseEvent: Record<string, unknown>;
			let finishReason: string;
			if (modelRequests === 1) {
				const tools = Array.isArray(request.tools) ? request.tools : [];
				check(tools.some((tool) => record(record(tool, "tool row").function, "tool function").name === "eval"), "OMP advertised its eval tool");
				const code = [
					`const tab = await browser.open({ name: "cedia-o10-relay-proof", app: { relay: true, target: ${JSON.stringify(fixtureTitle)} } });`,
					`const selectedTitle = await tab.title();`,
					`if (selectedTitle !== ${JSON.stringify(fixtureTitle)}) throw new Error("selected an unexpected relay tab");`,
					`await tab.click("#run");`,
					`const marker = await tab.evaluate("document.body.dataset.result || 'missing'");`,
					`if (marker !== "clicked") throw new Error("fixture action did not land");`,
					`await browser.close({ name: "cedia-o10-relay-proof" });`,
					`print(JSON.stringify({ selectedTitle, marker }));`,
				].join("\n");
				responseEvent = { role: "assistant", tool_calls: [{ index: 0, id: "cedia-o10-eval", type: "function", function: { name: "eval", arguments: JSON.stringify({ language: "js", title: "Drive the named local relay fixture", code }) } }] };
				finishReason = "tool_calls";
			} else {
				responseEvent = { role: "assistant", content: "Local relay fixture action complete." };
				finishReason = "stop";
			}
			const id = "cedia-o10-relay-fixture-turn";
			const events = [
				{ id, object: "chat.completion.chunk", created: 1, model: "cedia-o10-relay-fixture", choices: [{ index: 0, delta: responseEvent, finish_reason: null }] },
				{ id, object: "chat.completion.chunk", created: 1, model: "cedia-o10-relay-fixture", choices: [{ index: 0, delta: {}, finish_reason: finishReason }] },
				"[DONE]",
			];
			res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
			res.end(events.map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`).join(""));
		});
	});
	await new Promise<void>((ready) => stub!.listen(0, "127.0.0.1", ready));
	const stubAddress = stub.address();
	check(stubAddress !== null && typeof stubAddress === "object", "canned model bound to loopback only");
	const modelPort = stubAddress.port;

	await writeFile(join(profile, "models.yml"), `providers:\n  cedia-o10-fixture:\n    baseUrl: http://127.0.0.1:${modelPort}/v1\n    auth: none\n    api: openai-completions\n    models:\n      - id: cedia-o10-relay-fixture\n        name: Cedia O10 local relay fixture\n        api: openai-completions\n        reasoning: false\n        input: [text]\n        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}\n        contextWindow: 128000\n        maxTokens: 4096\n`);
	await writeFile(join(profile, "config.yml"), `browser:\n  enabled: true\n  relay: true\n  relayUrl: ${relayUrl}\ntools:\n  approvalMode: yolo\n  approval:\n    browser: allow\n`);
	await writeFile(join(work, "fixture.txt"), "O10 relay proof workspace\n");
	execFileSync("git", ["init"], { cwd: work, stdio: "ignore" });
	execFileSync("git", ["add", "fixture.txt"], { cwd: work, stdio: "ignore" });
	execFileSync("git", ["-c", "user.email=fixture@cedia", "-c", "user.name=Cedia Fixture", "commit", "-m", "fixture"], { cwd: work, stdio: "ignore" });

	host = await startHostServer({
		stateDir: state,
		port: 0,
		ompExecutable: executable,
		ompEnv: { HOME: scratch, PI_CODING_AGENT_DIR: profile, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off", PATH: `${dirname(executable)}${delimiter}/usr/bin${delimiter}/bin` },
	});
	const project = host.host.store.createProject({ path: work, name: "O10 relay proof fixture" });
	const session = host.host.createSession(project.id, "O10 relay proof");
	await host.host.startSession(session.id);
	app = await createRequire(join(root, "desktop/package.json"))("playwright")._electron.launch({
		executablePath: join(root, `VSCode-darwin-${process.arch}/Cedia.app/Contents/MacOS/Cedia`),
		args: ["--user-data-dir", join(scratch, "cedia-profile"), "--password-store=basic", "--use-inmemory-secretstorage", "--skip-welcome", "--skip-release-notes"],
		env: { ...process.env, CEDIA_STATE_DIR: state, CEDIA_HOST_NODE: process.execPath },
		timeout: 45_000,
	});
	const window = await app.firstWindow();
	await window.getByText("O10 relay proof fixture", { exact: true }).first().waitFor({ timeout: 30_000 });
	check(true, "fresh packaged Cedia adopted the isolated proof host");

	const incarnation = (host.host.store.getSession(session.id) as { incarnation: string }).incarnation;
	const sent = await host.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/commands`,
		token: host.auth.ownerToken,
		body: { commandId: "cedia-o10-relay-fixture-turn", incarnation, command: "prompt", payload: { message: "Use the eval tool to act only on the specifically named local fixture tab." } },
	});
	check(sent.status === 200, `packaged session accepted the fixture turn (${sent.status})`);

	const deadline = Date.now() + 60_000;
	let commandStatus: string | undefined;
	while (Date.now() < deadline) {
		if (interrupted) throw new Error("Proof interrupted by owner");
		const command = host.host.store.listCommands(session.id).find((entry) => entry.commandId === "cedia-o10-relay-fixture-turn");
		commandStatus = command?.status;
		if (command && ["completed", "failed", "cancelled"].includes(command.status)) break;
		await new Promise((resolveWait) => setTimeout(resolveWait, 200));
	}
	check(commandStatus === "completed", `packaged OMP turn completed (${commandStatus ?? "missing"})`);
	check(fixtureClicks === 1, `prelude clicked only the named local fixture (${fixtureClicks} accepted click)`);
	const driven = await fixturePage.evaluate(() => document.body.getAttribute("data-result"));
	check(driven === "clicked", "the selected relay tab reflects the action result");
	const tabs = await (await fetch(`${relayUrl}/json/list`)).json() as Array<{ title?: string; url?: string }>;
	check(tabs.some((tab) => tab.title === fixtureTitle && tab.url === fixtureUrl), "relay target remains the named fixture until proof teardown");

	await writeFile(join(output, "result.json"), JSON.stringify({
		ok: true,
		revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
		ompVersion: version,
		packaged: true,
		relay: "owner-installed loopback extension",
		selectedTitle: fixtureTitle,
		fixtureUrl,
		fixtureClicks,
		commandStatus,
		modelRequests,
		externalProviderRequests: 0,
	}, null, 2));
	console.log(`O10 relay browser proof passed: ${output}`);
} finally {
	try { await app?.close(); } catch { /* owned proof process */ }
	try { await host?.close(); } catch { /* owned proof host */ }
	if (stub?.listening) await new Promise<void>((ready) => stub!.close(() => ready()));
	try { await fixturePage?.close(); } catch { /* only the proof-created relay tab */ }
	await relayBrowser.disconnect().catch(() => {});
	try { await new Promise<void>((ready) => fixture.close(() => ready())); } catch { /* fixture already closed */ }
	await rm(scratch, { recursive: true, force: true });
	process.off("SIGINT", onInterrupt);
}
