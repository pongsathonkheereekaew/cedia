/**
 * Deterministic native bridge proof: the packaged app's per-thread CDP endpoint
 * drives a visible tab (plan §8.2 O10, packaged half — no provider, no model turn).
 *
 * Flow on the real packaged Cedia.app (scratch profile, scratch state dir):
 * open a tab on a local fixture page through the real panel bridge ->
 * attach it through the real agent bridge (loopback-only URL asserted) ->
 * drive it with OMP's own puppeteer-core 25.3.0 through the scoped endpoint
 * (discovery, DOM read, laid-out boxes, click interaction, pixels) ->
 * detach / close / cross-task denial per the recorded contract.
 *
 * What this proves: the native bridge (endpoint + attach + isolation). What it
 * does NOT prove: model-driven OMP browser tool use (needs an answering model),
 * live settings steering on the packaged session (covered on the prepared
 * runtime by scripts/omp-browser-steer-smoke.ts), thread-switch auto-clearing
 * (fixture-covered). No provider calls anywhere by construction.
 *
 * Run: bun scripts/omp-packaged-browser-proof.ts
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startHostServer } from "../apps/host/src/server.ts";
import puppeteer from "/Users/pond/cedia/upstream/omp/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";

const root = resolve(import.meta.dir, "..");
const { chromium, _electron } = createRequire(join(root, "desktop/package.json"))("playwright");

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP packaged browser proof failed: ${message}`);
	console.log(`OK   ${message}`);
}
function record(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("OMP packaged browser proof failed: expected an object");
	return value as Record<string, unknown>;
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const marker = `packaged-tab-marker-${Date.now().toString(36)}`;
const scratch = await realpath(await mkdtemp(join(tmpdir(), "cedia-pb-")));
const output = join(root, "dist/packaged-browser-proof");
await mkdir(output, { recursive: true });

// Local fixture page: no network, no user data, unmistakable markers.
const fixture = Bun.serve({
	port: 0, hostname: "127.0.0.1",
	fetch: () => new Response(
		`<!doctype html><html><head><title>Cedia Browser Proof</title></head><body>` +
		`<h1 id="marker">${marker}</h1>` +
		`<button id="flip" onclick="document.getElementById('flipped').textContent='flipped-ok'">flip</button>` +
		`<div id="flipped"></div></body></html>`,
		{ headers: { "content-type": "text/html" } }),
});
const fixtureUrl = `http://127.0.0.1:${fixture.port}/`;

// Project + session through the script-owned host (mirrors agent-window-smoke);
// no turn is ever sent, so the fixture OMP runtime never boots and no provider
// is involved. The packaged app adopts this state dir like the native smoke.
const projectPath = join(scratch, "project");
await mkdir(projectPath);
await writeFile(join(projectPath, "hello.txt"), "Browser proof fixture\n");
execFileSync("git", ["init"], { cwd: projectPath, stdio: "ignore" });
execFileSync("git", ["add", "hello.txt"], { cwd: projectPath, stdio: "ignore" });
execFileSync("git", ["-c", "user.email=fixture@cedia", "-c", "user.name=Cedia Fixture", "commit", "-m", "fixture"], { cwd: projectPath, stdio: "ignore" });
const host = await startHostServer({
	stateDir: join(scratch, "host"),
	ompExecutable: join(root, "apps/macos/test/fixtures/agent-window-omp"),
	ompEnv: { CEDIA_NODE: process.execPath },
});
const project = host.host.store.createProject({ path: projectPath, name: "Browser proof fixture" });
const session = host.host.createSession(project.id, "Browser proof task");
const threadId = session.id;
const otherThread = `browser-proof-other-${Date.now().toString(36)}`;
check(typeof threadId === "string" && threadId.length > 0, `real host-owned session id (${threadId.slice(0, 8)}…)`);

const browser = await _electron.launch({
	executablePath: join(root, `VSCode-darwin-${process.arch}/Cedia.app/Contents/MacOS/Cedia`),
	args: ["--user-data-dir", join(scratch, "profile"), "--password-store=basic", "--use-inmemory-secretstorage", "--skip-welcome", "--skip-release-notes"],
	env: { ...process.env, CEDIA_STATE_DIR: join(scratch, "host"), CEDIA_HOST_NODE: "/Users/pond/.caret-tools/node-v24.18.0-darwin-arm64/bin/node" },
	timeout: 45_000,
});
const page = await browser.firstWindow();
const errors: string[] = [];
page.on("pageerror", (error: Error) => errors.push(error.message));
try { await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 500))); } catch { /* harness */ }

async function bx<T>(method: string, input: unknown): Promise<T> {
	return await page.evaluate(async ([m, i]: [string, unknown]) => {
		const api = (window as unknown as { nativeApi: { browser: Record<string, (input: unknown) => Promise<unknown>> } }).nativeApi;
		if (!api?.browser || typeof api.browser[m as string] !== "function") throw new Error(`native browser api missing: ${m}`);
		return await api.browser[m as string](i) as T;
	}, [method, input] as never);
}
const tabsOf = (state: unknown): { id: string; url?: string; title?: string }[] => {
	const tabs = record(state).tabs;
	check(Array.isArray(tabs), "browser state carries a tabs array");
	return (tabs as unknown[]).map(t => {
		const row = record(t);
		check(typeof row.id === "string", "tab carries an id");
		return { id: row.id as string, url: row.url as string | undefined, title: row.title as string | undefined };
	});
};

try {
	await page.getByText("Browser proof fixture", { exact: true }).first().waitFor({ timeout: 30_000 });
	check(true, "packaged app adopted the script-owned host state");

	// 1. Open a tab through the real panel bridge.
	const opened = await bx<unknown>("open", { threadId, initialUrl: fixtureUrl });
	const tabs = tabsOf(opened);
	check(tabs.length >= 1, `panel opened with a tab (${tabs.length})`);
	const tabId = tabs.find(t => (t.url ?? "").startsWith("http://127.0.0.1"))?.id ?? (tabs.at(-1)?.id as string);
	check(typeof tabId === "string" && tabId.length > 0, `workspace tab identified (${tabId.slice(0, 8)}…)`);

	// 2. Driver-supplied layout bounds (same setPanelBounds method the renderer
	// calls on layout; headless has no renderer layout pass, so the driver
	// stands in with explicit on-screen bounds — recorded, not hidden).
	await bx("setPanelBounds", { threadId, bounds: { x: 0, y: 0, width: 1280, height: 800 } });
	check(true, "panel bounds set through the real layout method");

	// 3. Attach through the real agent bridge; assert the loopback-only boundary
	// (no 0.0.0.0/LAN exposure, no app-wide CDP, no user Chrome involved).
	// Attaching before load completes is intended: the debugger session is
	// independent of navigation.
	const attached = await bx<{ cdpUrl: string; tabId: string }>("agentAttach", { threadId, tabId });
	check(/^http:\/\/127\.0\.0\.1:\d+\/?$/.test(attached.cdpUrl), `endpoint is loopback-only (${attached.cdpUrl})`);
	check(attached.tabId === tabId, "attach answers the requested tab");
	const attachedAgain = await bx<{ cdpUrl: string }>("agentAttach", { threadId, tabId });
	check(attachedAgain.cdpUrl === attached.cdpUrl, "re-attach is idempotent (same URL)");
	const cdpUrl = attached.cdpUrl.replace(/\/$/, "");

	// 4. Wait for load through CDP itself (the arbiter), then verify that the
	// native browser row catches up with the document title.
	const pupEarly = await puppeteer.connect({ browserURL: cdpUrl });
	let docTitle = "", readyState = "";
	try {
		for (let i = 0; i < 30 && docTitle !== "Cedia Browser Proof"; i++) {
			await sleep(500);
			const pages = await pupEarly.pages();
			const pg = pages.find(p => (p.url() ?? "").startsWith("http://127.0.0.1")) ?? pages[0];
			if (!pg) continue;
			try {
				docTitle = String(await pg.evaluate(() => document.title));
				readyState = String(await pg.evaluate(() => document.readyState));
			} catch { /* tab still committing */ }
		}
	} finally {
		await pupEarly.disconnect();
	}
	check(docTitle === "Cedia Browser Proof", `fixture DOM loaded (title via CDP, readyState=${readyState})`);
	let rowTitle = "";
	for (let i = 0; i < 20 && rowTitle !== docTitle; i++) {
		const state = record(await bx("getState", { threadId }));
		const rows = state.tabs as { id: string; title: string }[];
		rowTitle = rows.find(row => row.id === tabId)?.title ?? "";
		if (rowTitle !== docTitle) await sleep(250);
	}
	check(rowTitle === docTitle, `browser row shows the document title (${rowTitle})`);

	// 5. Discovery lists exactly our tab: no IDE/devtools/other-thread leakage.
	const listed = await (await fetch(`${cdpUrl}/json/list`)).json() as unknown[];
	check(Array.isArray(listed) && listed.length === 1, `endpoint lists exactly one tab (${listed.length})`);
	check(String(record(listed[0]).url ?? "") === fixtureUrl, "listed tab is the fixture tab (exact URL)");
	check(String(record(listed[0]).title ?? "") === docTitle, "endpoint discovery shows the document title");

	// 6. Drive with OMP's own puppeteer-core through the scoped endpoint.
	try { await (page as unknown as { bringToFront: () => Promise<void> }).bringToFront(); } catch { /* best effort */ }
	const pup = await puppeteer.connect({ browserURL: cdpUrl });
	try {
		const pages = await pup.pages();
		check(pages.length >= 1, `puppeteer sees the tab page (${pages.length})`);
		const target = pages.find(p => (p.url() ?? "").startsWith("http://127.0.0.1")) ?? pages[0];
		check((target?.url() ?? "").startsWith("http://127.0.0.1"), `puppeteer page is the fixture tab (${target?.url()})`);
		const readMarker = await target.evaluate(() => document.getElementById("marker")?.textContent ?? "");
		check(readMarker === marker, "DOM read through the endpoint matches the fixture marker");
		const rect = await target.evaluate(() => {
			const el = document.getElementById("marker");
			if (!el) return { w: 0, h: 0 };
			const r = el.getBoundingClientRect();
			return { w: r.width, h: r.height };
		}) as { w: number; h: number };
		check(rect.w > 0 && rect.h > 0, `marker is laid out visibly (${rect.w}x${rect.h})`);
		await target.click("#flip");
		const flipped = await target.evaluate(() => document.getElementById("flipped")?.textContent ?? "");
		check(flipped === "flipped-ok", "click interaction through the endpoint mutates the DOM");
		const shot = await target.screenshot({ encoding: "binary" }) as Uint8Array;
		const png = shot[0] === 0x89 && shot[1] === 0x50 && shot[2] === 0x4e && shot[3] === 0x47;
		check(png && shot.length > 6000, `tab pixels captured (${shot.length} bytes PNG)`);
		await writeFile(join(output, "tab-screenshot-bytes.txt"), String(shot.length));
	} finally {
		await pup.disconnect();
	}

	// 7. Endpoint status names the tab while attached.
	const status = await bx<{ attached: boolean; tabs: { tabId: string }[] }>("agentEndpoint", { threadId });
	check(status.attached === true && status.tabs.some(t => t.tabId === tabId), "endpoint status names the attached tab");

	// 8. Cross-task denial: another thread cannot touch this tab, and its own
	// endpoint never lists it.
	let refused = "";
	try { await bx("agentAttach", { threadId: otherThread, tabId }); } catch (error) { refused = String(error); }
	check(refused.includes("Unknown browser tab"), `foreign-thread attach refused (${refused.slice(0, 80)})`);
	const otherStatus = await bx<{ attached: boolean; tabs: unknown[] }>("agentEndpoint", { threadId: otherThread });
	check(otherStatus.attached === false && (otherStatus.tabs ?? []).length === 0, "foreign thread sees no tabs");
	const otherOpened = await bx<unknown>("open", { threadId: otherThread, initialUrl: fixtureUrl });
	const otherTabs = tabsOf(otherOpened);
	const otherTabId = otherTabs.at(-1)?.id as string;
	const otherAttached = await bx<{ cdpUrl: string }>("agentAttach", { threadId: otherThread, tabId: otherTabId });
	const otherListed = await (await fetch(`${otherAttached.cdpUrl.replace(/\/$/, "")}/json/list`)).json() as unknown[];
	check(otherListed.length === 1, "second thread endpoint lists exactly one tab");
	const otherEntry = record(otherListed[0]);
	const otherEntryId = String(otherEntry.webSocketDebuggerUrl ?? otherEntry.id ?? "");
	check(!otherEntryId.includes(encodeURIComponent(tabId)) && !otherEntryId.endsWith(`/${tabId}`), "no first-thread tab id leaks into the second endpoint");
	await bx("agentDetach", { threadId: otherThread, tabId: otherTabId });
	await bx("closeTab", { threadId: otherThread, tabId: otherTabId });
	check(true, "second thread cleaned up");

	// 9. Detach closes the endpoint: further discovery must refuse.
	const detached = await bx<{ attached: boolean }>("agentDetach", { threadId, tabId });
	check(detached.attached === false, "detach answers not-attached");
	const afterDetach = await bx<{ attached: boolean; tabs: unknown[] }>("agentEndpoint", { threadId });
	check(afterDetach.attached === false && (afterDetach.tabs ?? []).length === 0, "endpoint status empty after detach");
	let closed = false;
	try { await fetch(`${cdpUrl}/json/list`); } catch { closed = true; }
	check(closed, "endpoint socket closed after last detach");

	// 10. Close invalidation: a closed tab can never be (re)attached.
	const reopened = await bx<unknown>("newTab", { threadId, url: fixtureUrl });
	const tabId2 = tabsOf(reopened).at(-1)?.id as string;
	await bx("agentAttach", { threadId, tabId: tabId2 });
	await bx("closeTab", { threadId, tabId: tabId2 });
	let unknownTab = "";
	try { await bx("agentAttach", { threadId, tabId: tabId2 }); } catch (error) { unknownTab = String(error); }
	check(unknownTab.includes("Unknown browser tab"), `closed tab refuses attach (${unknownTab.slice(0, 80)})`);

	// 11. No turns, no provider involvement anywhere in this run.
	check(host.host.store.listCommands(session.id).length === 0, "zero host commands (no turns, no provider calls)");
	if (errors.length) throw new Error(`Renderer errors: ${errors.join("\n")}`);
	await page.screenshot({ path: join(output, "packaged-window.png"), fullPage: true });
	await writeFile(join(output, "result.json"), JSON.stringify({ ok: true, threadId, tabId, cdpLoopback: true, providerCommands: 0, errors }, null, 2));
	await Promise.all(["failure.json", "failure.png"].map(name => rm(join(output, name), { force: true })));
	console.log(`OMP packaged browser proof passed: ${output}`);
} catch (error) {
	try { await page.screenshot({ path: join(output, "failure.png"), fullPage: true }); } catch { /* best effort */ }
	await writeFile(join(output, "failure.json"), JSON.stringify({ error: String(error && (error as Error).stack || error), errors }, null, 2));
	throw error;
} finally {
	try { await browser.close(); } catch { /* owned process */ }
	try { fixture.stop(true); } catch { /* owned server */ }
	try { await host.close?.(); } catch { /* owned host */ }
	await rm(scratch, { recursive: true, force: true });
}
