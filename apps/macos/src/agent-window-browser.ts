import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";

import { CdpTabEndpoint, type CdpEndpointTab, type CdpTabDebugger } from "./cdp-tab-endpoint.ts";

/**
 * Browser state owned by the Agent Window.  The renderer only receives copies
 * of this state over the authenticated Cedia IPC channel; page contents never
 * receive a Node or Electron bridge.
 */
export interface AgentBrowserTab {
	readonly id: string;
	url: string;
	title: string;
	runtimeSurface: "native";
	status: "live" | "suspended";
	isLoading: boolean;
	canGoBack: boolean;
	canGoForward: boolean;
	faviconUrl: string | null;
	lastCommittedUrl: string | null;
	lastError: string | null;
}

export interface AgentBrowserState {
	readonly threadId: string;
	version: number;
	open: boolean;
	activeTabId: string | null;
	tabs: AgentBrowserTab[];
	lastError: string | null;
}

interface BrowserBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface BrowserPanelLayout {
	bounds: BrowserBounds;
	pageZoomFactor: number;
}

interface BrowserEvent {
	url?: string;
	isMainFrame?: boolean;
	preventDefault?(): void;
	sender?: unknown;
}

type Listener = (...args: any[]) => void;

interface ElectronDebugger {
	isAttached(): boolean;
	attach(protocolVersion?: string): Promise<void>;
	detach(): Promise<void>;
	sendCommand(method: string, commandParams?: unknown): Promise<unknown>;
	on(event: "message", listener: (event: unknown, method: string, params: unknown) => void): void;
	on(event: "detach", listener: (event: unknown, reason: string) => void): void;
	removeListener(event: string, listener: (...args: any[]) => void): void;
}

interface BrowserWebContents {
	readonly id: number;
	readonly debugger?: ElectronDebugger;
	readonly session?: {
		setPermissionCheckHandler(handler: () => boolean): void;
		setPermissionRequestHandler(handler: (contents: unknown, permission: string, callback: (allowed: boolean) => void) => void): void;
	};
	on(event: string, listener: Listener): void;
	removeListener(event: string, listener: Listener): void;
	setWindowOpenHandler?(handler: (details: { url?: unknown }) => unknown): void;
	loadURL(url: string): Promise<unknown>;
	reload(): void;
	readonly navigationHistory?: { canGoBack(): boolean; canGoForward(): boolean; goBack(): void; goForward(): void };
	goBack(): void;
	goForward(): void;
	canGoBack?(): boolean;
	canGoForward?(): boolean;
	getURL?(): string;
	getTitle?(): string;
	setZoomFactor?(factor: number): void;
	openDevTools?(options?: unknown): void;
	capturePage?(): Promise<{ toPNG(): Buffer | Uint8Array }>;
	isDestroyed?(): boolean;
	destroy?(): void;
}

interface BrowserView {
	readonly webContents: BrowserWebContents;
	setBounds(bounds: BrowserBounds): void;
	setVisible?(visible: boolean): void;
	setBorderRadius?(radius: number): void;
}

interface BrowserContentView {
	addChildView(view: BrowserView, index?: number): void;
	removeChildView(view: BrowserView): void;
}

interface BrowserWindow {
	readonly contentView: BrowserContentView;
	readonly webContents: BrowserWebContents;
	isDestroyed?(): boolean;
}

interface ElectronRuntime {
	BrowserWindow: {
		fromWebContents(sender: unknown): BrowserWindow | undefined;
	};
	WebContentsView: new (options?: unknown) => BrowserView;
	clipboard: {
		writeText(value: string): void;
		writeImage(value: unknown): void;
	};
	nativeImage: {
		createFromBuffer(value: Buffer | Uint8Array): unknown;
	};
}

export interface AgentBrowserServiceOptions {
	readonly appRoot: string;
	/** Test seam. Production always resolves Electron from the Code-OSS app. */
	readonly electron?: unknown;
}

export interface AgentBrowserService {
	handle(event: unknown, method: string, input: unknown): Promise<unknown>;
	dispose(): void;
}

interface BrowserRuntime {
	readonly key: string;
	readonly threadId: string;
	readonly tabId: string;
	readonly owner: BrowserWindow;
	readonly view: BrowserView;
	readonly webContents: BrowserWebContents;
	readonly disposeListeners: Array<() => void>;
}

interface BrowserPanelInput {
	readonly threadId: string;
	readonly tabId?: string;
	readonly url?: string;
	readonly initialUrl?: string;
	readonly activate?: boolean;
	readonly bounds?: BrowserBounds | null;
	readonly surface?: "native" | "renderer";
	readonly occluded?: boolean;
	readonly preview?: boolean;
	readonly pageZoomFactor?: number;
}

const BROWSER_EVENT_CHANNEL = "vscode:cediaAgentBrowser";
const BROWSER_COPY_LINK_CHANNEL = "vscode:cediaAgentBrowserCopyLink";
const BROWSER_BLANK_URL = "about:blank";
const BROWSER_PARTITION = "persist:cedia-browser";
// Keep a newly-created guest renderable while it is waiting for the first DOM
// bounds measurement. Electron can leave a fresh WebContentsView blank when it
// is initialized at a 1x1 sentinel rect and navigated before the panel sends
// its real bounds. Synara parks native guests at this non-zero automation
// viewport for the same reason; visibility is still disabled until attachment.
const HIDDEN_BOUNDS: BrowserBounds = { x: 0, y: 0, width: 1_280, height: 800 };

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Invalid browser panel input");
	}
	return value as Record<string, unknown>;
}

function requiredText(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0 || value.length > 16_384) {
		throw new Error(`Invalid browser ${label}`);
	}
	return value.trim();
}

function threadIdOf(input: unknown): string {
	return requiredText(record(input).threadId, "thread id");
}

function isBlankUrl(url: string | null | undefined): boolean {
	return !url || url === BROWSER_BLANK_URL;
}

function allowedUrl(value: unknown, allowBlank = true): string {
	const raw = requiredText(value, "URL");
	if (allowBlank && raw === BROWSER_BLANK_URL) return raw;
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		throw new Error("Only http(s) browser URLs are allowed");
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error("Only http(s) browser URLs are allowed");
	}
	if (parsed.username || parsed.password) {
		throw new Error("Browser URLs cannot contain credentials");
	}
	return parsed.toString();
}

function normalizeTypedUrl(value: unknown): string {
	const raw = requiredText(value, "URL");
	if (raw === BROWSER_BLANK_URL) return raw;
	try {
		return allowedUrl(raw);
	} catch (error) {
		if (/^[a-z][a-z\d+.-]*:/i.test(raw)) throw error;
		try {
			return allowedUrl(`https://${raw}`);
		} catch {
			throw new Error("Only http(s) browser URLs are allowed");
		}
	}
}

function titleForUrl(url: string): string {
	if (isBlankUrl(url)) return "New tab";
	try {
		return new URL(url).hostname || url;
	} catch {
		return url;
	}
}

function cloneState(state: AgentBrowserState): AgentBrowserState {
	return {
		threadId: state.threadId,
		version: state.version,
		open: state.open,
		activeTabId: state.activeTabId,
		tabs: state.tabs.map((tab) => ({ ...tab })),
		lastError: state.lastError,
	};
}

function cloneBounds(value: unknown): BrowserBounds | null {
	if (value === null || value === undefined) return null;
	const bounds = record(value);
	const values = [bounds.x, bounds.y, bounds.width, bounds.height];
	if (!values.every((entry) => typeof entry === "number" && Number.isFinite(entry))) return null;
	const width = Math.max(0, Math.floor(bounds.width as number));
	const height = Math.max(0, Math.floor(bounds.height as number));
	if (width <= 0 || height <= 0) return null;
	return {
		x: Math.max(0, Math.floor(bounds.x as number)),
		y: Math.max(0, Math.floor(bounds.y as number)),
		width,
		height,
	};
}

function zoomFactor(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 1;
}

function runtimeKey(threadId: string, tabId: string): string {
	return `${threadId}:${tabId}`;
}

function eventUrl(args: readonly unknown[]): string | undefined {
	const candidate = args.find((value) => typeof value === "string");
	return typeof candidate === "string" ? candidate : undefined;
}

function eventWindowOwner(event: unknown, electron: ElectronRuntime): BrowserWindow {
	const sender = record(event).sender;
	if (!sender) throw new Error("Browser panel sender is unavailable");
	const owner = electron.BrowserWindow.fromWebContents(sender);
	if (!owner || owner.isDestroyed?.()) throw new Error("Browser panel window is unavailable");
	return owner;
}

function isBrowserWebUrl(value: string): boolean {
	try {
		const protocol = new URL(value).protocol;
		return protocol === "http:" || protocol === "https:" || value === BROWSER_BLANK_URL;
	} catch {
		return false;
	}
}

function canGoBack(webContents: BrowserWebContents): boolean {
	try { return (webContents.navigationHistory?.canGoBack() ?? webContents.canGoBack?.()) === true; } catch { return false; }
}

function canGoForward(webContents: BrowserWebContents): boolean {
	try { return (webContents.navigationHistory?.canGoForward() ?? webContents.canGoForward?.()) === true; } catch { return false; }
}

function currentUrl(runtime: BrowserRuntime): string {
	try { return runtime.webContents.getURL?.() ?? ""; } catch { return ""; }
}

function currentTitle(runtime: BrowserRuntime): string | null {
	try {
		const title = runtime.webContents.getTitle?.().trim();
		return title && title !== "New tab" ? title.slice(0, 512) : null;
	} catch {
		return null;
	}
}

function copyableUrl(tab: AgentBrowserTab, runtime?: BrowserRuntime): string | null {
	const live = runtime ? currentUrl(runtime) : "";
	if (live && !isBlankUrl(live) && isBrowserWebUrl(live)) return live;
	for (const candidate of [tab.lastCommittedUrl, tab.url]) {
		if (candidate && !isBlankUrl(candidate) && isBrowserWebUrl(candidate)) return candidate;
	}
	return null;
}

function mapLoadError(code: unknown): string {
	switch (code) {
		case -105: return "Couldn't resolve this address.";
		case -106: return "You're offline.";
		case -118: return "This page took too long to respond.";
		case -102: return "Connection refused.";
		default: return "Couldn't open this page.";
	}
}

function isAbortedLoad(value: unknown): boolean {
	if (value === -3 || value === "ERR_ABORTED") {
		return true;
	}
	if (typeof value === "string") {
		return /ERR_ABORTED|\(-3\)/i.test(value);
	}
	if (!value || typeof value !== "object") {
		return false;
	}
	const candidate = value as { code?: unknown; message?: unknown };
	return isAbortedLoad(candidate.code) || (typeof candidate.message === "string" && /ERR_ABORTED|\(-3\)/i.test(candidate.message));
}

function send(owner: BrowserWindow, channel: string, value: unknown): void {
	try {
		(owner.webContents as unknown as { send?: (channel: string, value: unknown) => void }).send?.(channel, value);
	} catch {
		// A window can close between the request and the event publication.
	}
}

const cediaBrowserContents = new WeakSet<object>();

/** Native identity only: renderer windows cannot opt into browser navigation. */
export function isCediaAgentBrowserWebContents(contents: unknown): boolean {
  return typeof contents === "object" && contents !== null && cediaBrowserContents.has(contents);
}

export function createAgentBrowserService(options: AgentBrowserServiceOptions): AgentBrowserService {
	const electron = (options.electron ?? createRequire(join(options.appRoot, "package.json"))("electron")) as ElectronRuntime;
	const states = new Map<string, AgentBrowserState>();
	const runtimes = new Map<string, BrowserRuntime>();
	const owners = new Map<string, BrowserWindow>();
	// Renderer bounds are deliberately cached in main. Switching tabs can update
	// only metadata in React, so the bounds key does not change and no second
	// setPanelBounds IPC is emitted. Reusing the last live layout keeps the newly
	// active native view attached to the same slot immediately.
	const panelLayouts = new Map<string, BrowserPanelLayout>();
	const ownerDisposers = new Map<BrowserWindow, () => void>();
	let attachedKey: string | null = null;
	let disposed = false;

	function getOrCreateState(threadId: string): AgentBrowserState {
		let state = states.get(threadId);
		if (!state) {
			state = { threadId, version: 0, open: false, activeTabId: null, tabs: [], lastError: null };
			states.set(threadId, state);
		}
		return state;
	}

	function activeTab(state: AgentBrowserState): AgentBrowserTab | null {
		return state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0] ?? null;
	}

	function resolveTab(state: AgentBrowserState, tabId: unknown): AgentBrowserTab {
		const requested = typeof tabId === "string" ? state.tabs.find((tab) => tab.id === tabId) : undefined;
		const found = requested ?? activeTab(state);
		if (found) return found;
		const tab = makeTab();
		state.tabs = [tab];
		state.activeTabId = tab.id;
		return tab;
	}

	function makeTab(url = BROWSER_BLANK_URL): AgentBrowserTab {
		return {
			id: randomUUID(),
			url,
			title: titleForUrl(url),
			runtimeSurface: "native",
			status: "suspended",
			isLoading: false,
			canGoBack: false,
			canGoForward: false,
			faviconUrl: null,
			lastCommittedUrl: null,
			lastError: null,
		};
	}

	function bump(state: AgentBrowserState): void {
		state.version += 1;
		state.lastError = state.tabs.find((tab) => tab.lastError)?.lastError ?? null;
		const owner = owners.get(state.threadId);
		if (owner && !owner.isDestroyed?.()) send(owner, BROWSER_EVENT_CHANNEL, cloneState(state));
	}

	function ensureWorkspace(state: AgentBrowserState, initialUrl?: string): AgentBrowserTab {
		if (state.tabs.length === 0) {
			const tab = makeTab(initialUrl ?? BROWSER_BLANK_URL);
			state.tabs = [tab];
			state.activeTabId = tab.id;
		}
		return resolveTab(state, state.activeTabId);
	}

	function removeRuntime(runtime: BrowserRuntime): void {
		cediaBrowserContents.delete(runtime.webContents);
		if (attachedKey === runtime.key) attachedKey = null;
		try { runtime.owner.contentView.removeChildView(runtime.view); } catch { /* already detached */ }
		try { runtime.view.setVisible?.(false); runtime.view.setBounds(HIDDEN_BOUNDS); } catch { /* destroyed */ }
		for (const dispose of runtime.disposeListeners.splice(0)) dispose();
		try { runtime.webContents.destroy?.(); } catch { /* destroyed */ }
		runtimes.delete(runtime.key);
	}

	function releaseOwner(owner: BrowserWindow): void {
		for (const [threadId, candidate] of owners) {
			if (candidate !== owner) continue;
			void agentDetach(threadId).catch(() => { /* window is gone */ });
			for (const runtime of [...runtimes.values()]) {
				if (runtime.owner === owner && runtime.threadId === threadId) removeRuntime(runtime);
			}
			owners.delete(threadId);
			panelLayouts.delete(threadId);
			states.delete(threadId);
		}
		ownerDisposers.get(owner)?.();
		ownerDisposers.delete(owner);
	}

	function trackOwner(owner: BrowserWindow): void {
		if (ownerDisposers.has(owner)) return;
		const destroyed = () => releaseOwner(owner);
		owner.webContents.on("destroyed", destroyed);
		ownerDisposers.set(owner, () => owner.webContents.removeListener("destroyed", destroyed));
	}

	function attachRuntime(runtime: BrowserRuntime, bounds: BrowserBounds, factor: number): void {
		if (attachedKey && attachedKey !== runtime.key) {
			const previous = runtimes.get(attachedKey);
			if (previous) {
				try { previous.owner.contentView.removeChildView(previous.view); previous.view.setVisible?.(false); previous.view.setBounds(HIDDEN_BOUNDS); } catch { /* closed */ }
			}
		}
		try { runtime.owner.contentView.addChildView(runtime.view); } catch { /* already attached */ }
		runtime.view.setBorderRadius?.(0);
		runtime.view.setVisible?.(true);
		runtime.view.setBounds(bounds);
		runtime.webContents.setZoomFactor?.(factor);
		attachedKey = runtime.key;
	}

	function detachRuntime(runtime: BrowserRuntime): void {
		if (attachedKey === runtime.key) attachedKey = null;
		try {
			runtime.owner.contentView.removeChildView(runtime.view);
			runtime.view.setVisible?.(false);
			runtime.view.setBounds(HIDDEN_BOUNDS);
		} catch { /* closed */ }
	}

	function runtimeFor(threadId: string, tabId: string): BrowserRuntime | undefined {
		const runtime = runtimes.get(runtimeKey(threadId, tabId));
		if (runtime?.webContents.isDestroyed?.()) {
			if (runtime) removeRuntime(runtime);
			return undefined;
		}
		return runtime;
	}

	interface AgentAttachedTab {
		readonly debugger: CdpTabDebugger;
	}

	interface AgentEndpointRecord {
		readonly endpoint: CdpTabEndpoint;
		readonly attached: Map<string, AgentAttachedTab>;
	}

	const agentEndpoints = new Map<string, AgentEndpointRecord>();

	const debuggerAdapters = new WeakMap<ElectronDebugger, CdpTabDebugger>();

	function adaptDebugger(native: ElectronDebugger): CdpTabDebugger {
		const known = debuggerAdapters.get(native);
		if (known) return known;
		const adapter: CdpTabDebugger = {
			isAttached: () => {
				try { return native.isAttached(); } catch { return false; }
			},
			attach: () => native.attach(),
			detach: async () => {
				try {
					if (native.isAttached()) await native.detach();
				} catch { /* already gone */ }
			},
			sendCommand: (method, params) => native.sendCommand(method, params),
			on: (event, listener) => {
				if (event === "message") native.on("message", (_event, method, params) => listener(method, params as Record<string, unknown> | undefined));
				else native.on("detach", (_event, reason) => listener(reason));
			},
			removeListener: (event, listener) => {
				// The adapter wraps native listeners, so removal by identity cannot
				// reach the wrapped originals; endpoint teardown drops the whole
				// debugger session instead, which is the actual invalidation.
				void event; void listener;
			},
		};
		debuggerAdapters.set(native, adapter);
		return adapter;
	}

	function agentTabsResolver(threadId: string): () => readonly CdpEndpointTab[] {
		return () => {
			const record = agentEndpoints.get(threadId);
			const state = states.get(threadId);
			if (!record || !state) return [];
			const out: CdpEndpointTab[] = [];
			for (const [tabId, attached] of record.attached) {
				const tab = state.tabs.find(candidate => candidate.id === tabId);
				const runtime = runtimeFor(threadId, tabId);
				if (!tab || !runtime || !attached.debugger.isAttached()) continue;
				out.push({ tabId, url: currentUrl(runtime) || tab.url, title: tab.title, debugger: attached.debugger });
			}
			return out;
		};
	}

	function agentThreadId(value: unknown): string {
		if (typeof value !== "string" || value.trim().length === 0) throw new Error("Browser agent attach needs a thread");
		return value;
	}

	async function agentAttach(owner: BrowserWindow, threadId: string, tabId: string): Promise<{ cdpUrl: string; tabId: string }> {
		const thread = agentThreadId(threadId);
		if (typeof tabId !== "string" || tabId.trim().length === 0) throw new Error("Browser agent attach needs a tab");
		const state = getOrCreateState(thread);
		const tab = state.tabs.find(candidate => candidate.id === tabId);
		if (!tab) throw new Error("Unknown browser tab");
		const runtime = ensureRuntime(owner, state, tab);
		const native = runtime.webContents.debugger;
		if (!native) throw new Error("Browser tab debugger is unavailable");
		let record = agentEndpoints.get(thread);
		const known = record?.attached.get(tabId);
		if (known && known.debugger.isAttached()) {
			const address = record!.endpoint.address ?? await record!.endpoint.listen();
			return { cdpUrl: address.url, tabId };
		}
		let attached: boolean;
		try { attached = native.isAttached(); } catch { attached = false; }
		if (attached) throw new Error("Browser tab debugger is already attached");
		await native.attach();
		const adapter = adaptDebugger(native);
		if (!record) {
			record = { endpoint: new CdpTabEndpoint(agentTabsResolver(thread)), attached: new Map() };
			agentEndpoints.set(thread, record);
		}
		record.attached.set(tabId, { debugger: adapter });
		const address = await record.endpoint.listen();
		return { cdpUrl: address.url, tabId };
	}

	async function agentDetach(threadId: string, tabId?: string): Promise<{ attached: boolean; cdpUrl?: string }> {
		const thread = agentThreadId(threadId);
		const record = agentEndpoints.get(thread);
		if (!record) return { attached: false };
		const ids = tabId === undefined ? [...record.attached.keys()] : [tabId];
		for (const id of ids) {
			const attached = record.attached.get(id);
			record.attached.delete(id);
			if (attached) {
				try { await attached.debugger.detach(); } catch { /* already gone */ }
			}
		}
		if (record.attached.size === 0) {
			try { await record.endpoint.close(); } catch { /* already closed */ }
			agentEndpoints.delete(thread);
			return { attached: false };
		}
		const address = record.endpoint.address;
		return address ? { attached: true, cdpUrl: address.url } : { attached: true };
	}

	function agentEndpoint(threadId: string): { attached: boolean; cdpUrl?: string; tabs: { tabId: string; url: string; title: string }[] } {
		const thread = agentThreadId(threadId);
		const record = agentEndpoints.get(thread);
		if (!record) return { attached: false, tabs: [] };
		const state = states.get(thread);
		const tabs = [...record.attached.keys()].flatMap(tabId => {
			const tab = state?.tabs.find(candidate => candidate.id === tabId);
			const runtime = runtimeFor(thread, tabId);
			if (!tab || !runtime) return [];
			return [{ tabId, url: currentUrl(runtime) || tab.url, title: tab.title }];
		});
		const address = record.endpoint.address;
		return address ? { attached: true, cdpUrl: address.url, tabs } : { attached: tabs.length > 0, tabs };
	}

	function attachActiveRuntime(owner: BrowserWindow, state: AgentBrowserState): BrowserRuntime | null {
		const active = activeTab(state);
		if (!state.open || !active) return null;
		const runtime = ensureRuntime(owner, state, active);
		const layout = panelLayouts.get(state.threadId);
		if (layout) {
			attachRuntime(runtime, layout.bounds, layout.pageZoomFactor);
		} else {
			// Keep the newly-created view in the owner's content tree while it is
			// waiting for the renderer's first bounds measurement. It remains hidden
			// at the parked background viewport until setPanelBounds supplies the live slot.
			runtime.view.setVisible?.(false);
			runtime.view.setBounds(HIDDEN_BOUNDS);
		}
		return runtime;
	}

	function ensureRuntime(owner: BrowserWindow, state: AgentBrowserState, tab: AgentBrowserTab): BrowserRuntime {
		const key = runtimeKey(state.threadId, tab.id);
		const existing = runtimeFor(state.threadId, tab.id);
		if (existing) {
			if (existing.owner !== owner) throw new Error("Browser tab belongs to another window");
			return existing;
		}
		const view = new electron.WebContentsView({
			webPreferences: {
				partition: BROWSER_PARTITION,
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
			},
		});
		cediaBrowserContents.add(view.webContents);
		const runtime: BrowserRuntime = {
			key,
			threadId: state.threadId,
			tabId: tab.id,
			owner,
			view,
			webContents: view.webContents,
			disposeListeners: [],
		};
		try { owner.contentView.addChildView(view); } catch { /* owner is still starting */ }
		view.setVisible?.(false);
		view.setBounds(HIDDEN_BOUNDS);
		configureRuntime(runtime);
		runtimes.set(key, runtime);
		tab.status = "live";
		return runtime;
	}

	function configureRuntime(runtime: BrowserRuntime): void {
		const { webContents } = runtime;
		// This partition hosts remote pages, never the privileged Cedia renderer.
		// Electron otherwise grants requests without a browser permission prompt.
		webContents.session?.setPermissionCheckHandler(() => false);
		webContents.session?.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
		const onStart = () => {
			const state = states.get(runtime.threadId);
			const tab = state && state.tabs.find((candidate) => candidate.id === runtime.tabId);
			if (!tab) return;
			tab.isLoading = true;
			tab.lastError = null;
			bump(state);
		};
		const onStop = () => {
			const state = states.get(runtime.threadId);
			const tab = state && state.tabs.find((candidate) => candidate.id === runtime.tabId);
			if (!tab) return;
			tab.isLoading = false;
			const url = currentUrl(runtime);
			if (isBrowserWebUrl(url)) {
				tab.url = url;
				tab.lastCommittedUrl = isBlankUrl(url) ? null : url;
				tab.title = currentTitle(runtime) ?? tab.title;
			}
			tab.canGoBack = canGoBack(webContents);
			tab.canGoForward = canGoForward(webContents);
			bump(state);
		};
		const onNavigate = (_event: BrowserEvent, ...args: unknown[]) => {
			const url = eventUrl(args);
			if (!url || !isBrowserWebUrl(url)) return;
			const state = states.get(runtime.threadId);
			const tab = state && state.tabs.find((candidate) => candidate.id === runtime.tabId);
			if (!tab) return;
			tab.url = url;
			tab.lastCommittedUrl = isBlankUrl(url) ? null : url;
			tab.title = titleForUrl(url);
			tab.lastError = null;
			tab.canGoBack = canGoBack(webContents);
			tab.canGoForward = canGoForward(webContents);
			bump(state);
		};
		const onTitle = (_event: BrowserEvent, title: unknown) => {
			const state = states.get(runtime.threadId);
			const tab = state && state.tabs.find((candidate) => candidate.id === runtime.tabId);
			if (!tab || typeof title !== "string" || title.trim().length === 0) return;
			tab.title = title.trim().slice(0, 512);
			bump(state);
		};
		const onFavicon = (_event: BrowserEvent, favicons: unknown) => {
			const state = states.get(runtime.threadId);
			const tab = state && state.tabs.find((candidate) => candidate.id === runtime.tabId);
			const first = Array.isArray(favicons) ? favicons[0] : undefined;
			if (!tab || typeof first !== "string" || !isBrowserWebUrl(first)) return;
			tab.faviconUrl = first;
			bump(state);
		};
		const onFail = (_event: BrowserEvent, code: unknown, _description: unknown, _validated: unknown, isMainFrame?: unknown) => {
			// Only an explicit main-frame failure belongs to the visible tab. Electron
			// has shipped versions that omit the frame flag for subframe/redirect
			// failures; treating `undefined` as main-frame replaces a healthy page
			// with the generic error overlay.
			if (isMainFrame !== true || isAbortedLoad(code)) return;
			const state = states.get(runtime.threadId);
			const tab = state && state.tabs.find((candidate) => candidate.id === runtime.tabId);
			if (!tab) return;
			tab.isLoading = false;
			tab.lastError = mapLoadError(code);
			tab.status = "live";
			bump(state);
		};
		const onBeforeNavigate = (event: BrowserEvent, details?: unknown, legacyUrl?: unknown) => {
			const url = typeof event.url === "string" ? event.url : typeof details === "object" && details !== null && typeof (details as any).url === "string"
				? (details as any).url as string
				: typeof details === "string" ? details : typeof legacyUrl === "string" ? legacyUrl : "";
			const mainFrame = typeof event.isMainFrame === "boolean" ? event.isMainFrame : typeof details === "object" && details !== null && typeof (details as any).isMainFrame === "boolean"
				? (details as any).isMainFrame !== false
				: true;
			if (mainFrame && !isBrowserWebUrl(url)) event.preventDefault?.();
		};
		const onBeforeInput = (event: BrowserEvent, input?: unknown) => {
			const keyInput = record(input);
			if (keyInput.type !== "keyDown") return;
			const key = typeof keyInput.key === "string" ? keyInput.key.toLowerCase() : "";
			const meta = keyInput.meta === true || keyInput.control === true;
			if (meta && keyInput.shift === true && key === "l") {
				event.preventDefault?.();
				void copyLinkFor(runtime);
			}
		};
		webContents.on("did-start-loading", onStart);
		webContents.on("did-finish-load", onStop);
		webContents.on("did-stop-loading", onStop);
		webContents.on("did-navigate", onNavigate);
		webContents.on("did-navigate-in-page", onNavigate);
		webContents.on("page-title-updated", onTitle);
		webContents.on("page-favicon-updated", onFavicon);
		webContents.on("did-fail-load", onFail);
		webContents.on("will-navigate", onBeforeNavigate);
		webContents.on("will-redirect", onBeforeNavigate);
		webContents.on("before-input-event", onBeforeInput);
		webContents.setWindowOpenHandler?.(() => ({ action: "deny" }));
		const onDestroyed = () => {
			if (disposed) return;
			const state = states.get(runtime.threadId);
			const tab = state?.tabs.find((candidate) => candidate.id === runtime.tabId);
			if (tab) {
				tab.status = "suspended";
				tab.isLoading = false;
				bump(state!);
			}
			runtimes.delete(runtime.key);
			if (attachedKey === runtime.key) attachedKey = null;
		};
		webContents.on("render-process-gone", onDestroyed);
		webContents.on("destroyed", onDestroyed);
		const listeners: Array<[string, Listener]> = [
			["did-start-loading", onStart], ["did-finish-load", onStop], ["did-stop-loading", onStop],
			["did-navigate", onNavigate], ["did-navigate-in-page", onNavigate], ["page-title-updated", onTitle],
			["page-favicon-updated", onFavicon], ["did-fail-load", onFail], ["will-navigate", onBeforeNavigate],
			["will-redirect", onBeforeNavigate], ["before-input-event", onBeforeInput], ["render-process-gone", onDestroyed],
			["destroyed", onDestroyed],
		];
		runtime.disposeListeners.push(() => {
			for (const [name, listener] of listeners) webContents.removeListener(name, listener);
		});
	}

	async function loadTab(runtime: BrowserRuntime, tab: AgentBrowserTab, url: string): Promise<void> {
		tab.isLoading = true;
		bump(states.get(runtime.threadId)!);
		try {
			await runtime.webContents.loadURL(url);
		} catch (error) {
			if (!isAbortedLoad((error as any)?.code)) {
				tab.lastError = "Couldn't open this page.";
			}
		} finally {
			tab.isLoading = false;
			const state = states.get(runtime.threadId);
			if (state) bump(state);
		}
	}

	async function capture(runtime: BrowserRuntime): Promise<Uint8Array> {
		if (!runtime.webContents.capturePage) throw new Error("Browser screenshots are unavailable");
		const image = await runtime.webContents.capturePage();
		const bytes = image.toPNG();
		const result = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
		if (result.byteLength === 0) throw new Error("Couldn't capture a browser screenshot.");
		return result;
	}

	async function copyLinkFor(runtime: BrowserRuntime): Promise<void> {
		const state = states.get(runtime.threadId);
		const tab = state?.tabs.find((candidate) => candidate.id === runtime.tabId);
		if (!tab) return;
		const url = copyableUrl(tab, runtime);
		if (!url) return;
		electron.clipboard.writeText(url);
		send(runtime.owner, BROWSER_COPY_LINK_CHANNEL, { threadId: runtime.threadId, url });
	}

	function requireOwner(event: unknown, threadId: string): BrowserWindow {
		const owner = eventWindowOwner(event, electron);
		const current = owners.get(threadId);
		if (current && current !== owner) throw new Error("Browser thread belongs to another window");
		owners.set(threadId, owner);
		trackOwner(owner);
		return owner;
	}

	function stateFor(threadId: string): AgentBrowserState {
		return cloneState(getOrCreateState(threadId));
	}

	async function open(owner: BrowserWindow, input: BrowserPanelInput): Promise<AgentBrowserState> {
		const state = getOrCreateState(input.threadId);
		const initial = input.initialUrl === undefined ? undefined : normalizeTypedUrl(input.initialUrl);
		const tab = ensureWorkspace(state, initial);
		if (initial !== undefined && tab.url !== initial) {
			tab.url = initial;
			tab.title = titleForUrl(initial);
			tab.lastCommittedUrl = null;
		}
		state.open = true;
		const runtime = attachActiveRuntime(owner, state) ?? ensureRuntime(owner, state, tab);
		bump(state);
		if (initial !== undefined && currentUrl(runtime) !== initial) void loadTab(runtime, tab, initial);
		return cloneState(state);
	}

	async function invoke(owner: BrowserWindow, method: string, raw: BrowserPanelInput): Promise<unknown> {
		const input = raw;
		const state = getOrCreateState(input.threadId);
		const tab = () => resolveTab(state, input.tabId);
		switch (method) {
			case "open": return open(owner, input);
			case "close": {
				try { await agentDetach(input.threadId); } catch { /* already detached */ }
				for (const runtime of [...runtimes.values()]) if (runtime.threadId === input.threadId) removeRuntime(runtime);
				state.open = false; state.tabs = []; state.activeTabId = null; state.lastError = null;
				bump(state); owners.delete(input.threadId); return cloneState(state);
			}
			case "hide": {
				const active = activeTab(state); if (active) { const runtime = runtimeFor(input.threadId, active.id); if (runtime) detachRuntime(runtime); }
				return undefined;
			}
			case "getState": return stateFor(input.threadId);
			case "setPanelBounds": {
				const bounds = cloneBounds(input.bounds);
				const active = activeTab(state);
				if (bounds) {
					panelLayouts.set(input.threadId, {
						bounds,
						pageZoomFactor: zoomFactor(input.pageZoomFactor),
					});
				}
				if (!state.open || !active || !bounds) {
					if (active) { const runtime = runtimeFor(input.threadId, active.id); if (runtime) detachRuntime(runtime); }
					return undefined;
				}
				const runtime = ensureRuntime(owner, state, active);
				attachRuntime(runtime, bounds, zoomFactor(input.pageZoomFactor));
				return undefined;
			}
			case "attachWebview": return cloneState(state);
			case "detachWebview": return undefined;
			case "navigate": {
				const target = tab();
				const url = normalizeTypedUrl(input.url);
				target.url = url; target.title = titleForUrl(url); target.lastCommittedUrl = null; target.lastError = null;
				state.open = true; state.activeTabId = target.id;
				const runtime = attachActiveRuntime(owner, state) ?? ensureRuntime(owner, state, target);
				bump(state); void loadTab(runtime, target, url); return cloneState(state);
			}
			case "reload": {
				const target = tab(); const runtime = ensureRuntime(owner, state, target); runtime.webContents.reload(); return cloneState(state);
			}
			case "goBack": { const runtime = runtimeFor(input.threadId, tab().id); if (runtime) { const history = runtime.webContents.navigationHistory ?? runtime.webContents; history.goBack(); } return stateFor(input.threadId); }
			case "goForward": { const runtime = runtimeFor(input.threadId, tab().id); if (runtime) { const history = runtime.webContents.navigationHistory ?? runtime.webContents; history.goForward(); } return stateFor(input.threadId); }
			case "newTab": {
				const url = input.url === undefined ? BROWSER_BLANK_URL : normalizeTypedUrl(input.url);
				const next = makeTab(url); state.tabs = [...state.tabs, next];
				if (input.activate !== false || !state.activeTabId) state.activeTabId = next.id;
				state.open = true;
				const runtime = ensureRuntime(owner, state, next);
				if (state.activeTabId === next.id) attachActiveRuntime(owner, state);
				bump(state);
				if (!isBlankUrl(url)) void loadTab(runtime, next, url);
				return cloneState(state);
			}
			case "agentAttach": {
				if (typeof input.tabId !== "string") throw new Error("Browser agent attach needs a tab");
				return agentAttach(owner, input.threadId, input.tabId);
			}
			case "agentDetach": {
				return agentDetach(input.threadId, input.tabId);
			}
			case "agentEndpoint": {
				return agentEndpoint(input.threadId);
			}
			case "closeTab": {
				const target = tab();
				try { await agentDetach(input.threadId, target.id); } catch { /* already detached */ }
				const wasActive = state.activeTabId === target.id;
				const runtime = runtimeFor(input.threadId, target.id); if (runtime) removeRuntime(runtime);
				state.tabs = state.tabs.filter((candidate) => candidate.id !== target.id);
				if (state.tabs.length === 0) { state.activeTabId = null; state.open = false; }
				else if (state.activeTabId === target.id) state.activeTabId = state.tabs.at(-1)?.id ?? null;
				if (wasActive) attachActiveRuntime(owner, state);
				bump(state); return cloneState(state);
			}
			case "selectTab": {
				const target = tab();
				state.activeTabId = target.id;
				state.open = true;
				attachActiveRuntime(owner, state);
				target.status = "live";
				bump(state); return cloneState(state);
			}
			case "copyLink": { const target = tab(); const runtime = runtimeFor(input.threadId, target.id); if (runtime) await copyLinkFor(runtime); return undefined; }
			case "copyScreenshotToClipboard": {
				const runtime = ensureRuntime(owner, state, tab()); const bytes = await capture(runtime); electron.clipboard.writeImage(electron.nativeImage.createFromBuffer(bytes)); return undefined;
			}
			case "captureScreenshot": {
				const target = tab(); const runtime = ensureRuntime(owner, state, target); const bytes = await capture(runtime);
				return { name: `${titleForUrl(target.url).replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "browser"}-${Date.now()}.png`, mimeType: "image/png", sizeBytes: bytes.byteLength, bytes };
			}
			case "capturePreview": {
				const runtime = ensureRuntime(owner, state, tab()); const bytes = await capture(runtime);
				return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
			}
			case "openDevTools": { const runtime = ensureRuntime(owner, state, tab()); runtime.webContents.openDevTools?.({ mode: "detach" }); return undefined; }
			default: throw new Error(`Unsupported browser panel method: ${method}`);
		}
	}

	return {
		handle: async (event, method, input) => {
			if (disposed) throw new Error("Browser service is disposed");
			const value = record(input) as unknown as BrowserPanelInput;
			const threadId = threadIdOf(input);
			const owner = requireOwner(event, threadId);
			return invoke(owner, method, { ...value, threadId });
		},
		dispose: () => {
			if (disposed) return;
			disposed = true;
			for (const runtime of [...runtimes.values()]) removeRuntime(runtime);
			for (const disposeOwner of ownerDisposers.values()) disposeOwner();
			ownerDisposers.clear();
			runtimes.clear(); states.clear(); owners.clear(); panelLayouts.clear(); attachedKey = null;
		},
	};
}
