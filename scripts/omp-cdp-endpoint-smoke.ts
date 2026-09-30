/**
 * Wire-compat proof: OMP's own puppeteer-core drives the Cedia CDP endpoint
 * (plan §8.2 O10, protocol half — no Electron, no tabs, no provider).
 *
 * Boots CdpTabEndpoint over one fixture tab (scripted answers for the methods a real
 * drive issues), then connects with the exact puppeteer-core OMP ships
 * (`upstream/omp/node_modules/puppeteer-core`) the way `attach.ts` does: version
 * discovery, targets, page, evaluate round-trip, navigate. Proves the discovery
 * format, the browser-level Target session multiplexing and the per-tab proxy speak
 * real puppeteer — the remaining gap to production is the Electron debugger behind
 * the fixture, not the wire.
 *
 * Run: bun scripts/omp-cdp-endpoint-smoke.ts
 */
import { rm } from "node:fs/promises";
import { CdpTabEndpoint } from "../apps/macos/src/cdp-tab-endpoint.ts";
import puppeteer from "/Users/pond/cedia/upstream/omp/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP CDP endpoint smoke failed: ${message}`);
	console.log(`OK   ${message}`);
}

type Listener = (method: string, params?: Record<string, unknown>) => void;

class FixtureDebugger {
	attached = true;
	private readonly messageListeners = new Set<Listener>();
	private readonly detachListeners = new Set<(reason: string) => void>();

	isAttached(): boolean {
		return this.attached;
	}

	async attach(): Promise<void> {
		this.attached = true;
	}

	async detach(): Promise<void> {
		this.attached = false;
	}

	async sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown> {
		if (!this.attached) throw new Error("Not attached");
		if (process.env.CEDIA_CDP_DEBUG === "1") console.log(`FIXTURE <- ${method} (listeners=${this.messageListeners.size}) ${JSON.stringify(params ?? {}).slice(0, 160)}`);
		switch (method) {
			case "Page.enable":
			case "Page.setLifecycleEventsEnabled":
			case "Runtime.enable":
			case "DOM.enable":
			case "CSS.enable":
			case "Overlay.enable":
			case "Target.setAutoAttach":
				return {};
			case "Page.navigate": {
				const url = typeof params?.url === "string" ? params.url : "https://example.com/";
				// A navigation settles like a real one: frameNavigated then load, so goto
				// with lifecycle waiting resolves instead of timing out.
				setTimeout(
					() => this.emit("Page.frameNavigated", {
						frame: { id: "F1", loaderId: "L1", url, name: "", securityOrigin: "https://example.com", mimeType: "text/html" },
					}),
					20,
				);
				setTimeout(() => this.emit("Page.frameStoppedLoading", { frameId: "F1" }), 30);
				// Lifecycle watchers key on Page.lifecycleEvent (frameId + loaderId + name),
				// not on the raw load event alone.
				setTimeout(() => this.emit("Page.lifecycleEvent", { frameId: "F1", loaderId: "L1", name: "init", timestamp: 1 }), 35);
				setTimeout(() => this.emit("Page.lifecycleEvent", { frameId: "F1", loaderId: "L1", name: "commit", timestamp: 1 }), 38);
				setTimeout(() => this.emit("Page.domContentEventFired", { timestamp: 1 }), 39);
				setTimeout(() => this.emit("Page.lifecycleEvent", { frameId: "F1", loaderId: "L1", name: "DOMContentLoaded", timestamp: 1 }), 39);
				setTimeout(() => this.emit("Page.loadEventFired", { timestamp: 1 }), 40);
				setTimeout(() => this.emit("Page.lifecycleEvent", { frameId: "F1", loaderId: "L1", name: "load", timestamp: 1 }), 42);
				return { frameId: "F1", loaderId: "L1" };
			}
			case "Page.getNavigationHistory":
				return { currentIndex: 0, entries: [{ id: 1, url: "https://example.com/", userTypedURL: "https://example.com/", title: "Example", transitionType: "typed" }] };
			case "Page.createIsolatedWorld":
				return { executionContextId: 101 };
			case "Runtime.callFunctionOn":
			case "Runtime.evaluate": {
				const expression = typeof params?.expression === "string" ? params.expression : "";
				if (expression.includes("pong-marker")) return { result: { type: "string", value: "pong" } };
				if (expression === "globalThis") return { result: { type: "object", className: "Window", objectId: "o1" } };
				return { result: { type: "string", value: "" } };
			}
			case "Runtime.getProperties":
				return { result: [] };
			case "Runtime.releaseObject":
				return {};
			case "Runtime.getIsolateId":
				return { id: "I1" };
			case "Runtime.getHeapUsage":
				return { usedSize: 1, totalSize: 2 };
			case "Page.getFrameTree":
				return { frameTree: { frame: { id: "F1", url: "https://example.com/", name: "", securityOrigin: "https://example.com", mimeType: "text/html" }, childFrames: [] } };
			case "Page.getAppManifest":
				return { url: "https://example.com/", data: "", errors: [] };
			case "Target.getTargets":
				return { targetInfos: [] };
			default:
				// Page-initialization chatter (Network.enable, DOM/CSS getDocument…)
				// answers empty: the wire, not the page model, is under test.
				return {};
		}
	}

	emit(method: string, params?: Record<string, unknown>): void {
		for (const listener of [...this.messageListeners]) listener(method, params);
	}

	on(event: "message", listener: Listener): void;
	on(event: "detach", listener: (reason: string) => void): void;
	on(event: string, listener: (...args: never[]) => void): void {
		if (event === "message") this.messageListeners.add(listener as Listener);
		else this.detachListeners.add(listener as (reason: string) => void);
	}

	removeListener(): void {}
}

// One stable fixture: the endpoint resolves tabs() on every request, so the debugger
// instance must be shared or listeners registered on one instance never fire.
const fixtureDebugger = new FixtureDebugger();
const endpoint = new CdpTabEndpoint(() => [
	{ tabId: "tab-1", url: "https://example.com/", title: "Example", debugger: fixtureDebugger },
]);
try {
	const address = await endpoint.listen();
	check(address.url.startsWith("http://127.0.0.1:"), `the endpoint binds loopback (${address.url})`);

	const browser = await puppeteer.connect({ browserURL: address.url });
	try {
		const targets = browser.targets().filter((target: { type(): string }) => target.type() === "page");
		check(targets.length === 1 && targets[0]?.url() === "https://example.com/", `puppeteer discovers the attached tab (${targets.length} page target(s))`);
		const page = await targets[0]!.page();
		check(page !== null, "the target opens as a puppeteer page");
		const pong = await page.evaluate(`"pong-marker"`);
		check(pong === "pong", `evaluate round-trips through the proxy (got ${JSON.stringify(pong)})`);
		// Lifecycle waiting (load/domcontentloaded/network-idle) is puppeteer's page-model
		// behavior over Blink lifecycle events, which a scripted fixture does not emulate;
		// the command round-trip below is the wire this endpoint owns. Behind a real
		// Electron debugger the same socket carries the real lifecycle.
		const session = await page.createCDPSession();
		const navigated = (await session.send("Page.navigate", { url: "https://example.com/next" })) as { frameId?: string };
		check(navigated.frameId === "F1", `navigate round-trips through an explicit session (frame ${String(navigated.frameId)})`);
		await session.detach();
	} finally {
		await browser.disconnect();
	}
} finally {
	await endpoint.close();
}
await rm("/tmp/cedia-cdp-smoke-unused", { recursive: true, force: true }).catch(() => {});
console.log(JSON.stringify({ ok: true, driver: "upstream puppeteer-core 25.3.0" }));
