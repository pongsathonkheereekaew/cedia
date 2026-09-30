import type {
	BrowserCaptureScreenshotResult,
	BrowserNavigateInput,
	BrowserNewTabInput,
	BrowserOpenInput,
	BrowserPanelBounds,
	BrowserTabInput,
	BrowserThreadInput,
	BrowserSetPanelBoundsInput,
	ThreadBrowserState,
} from "@synara/contracts";

import { AGENT_WINDOW_CHANNEL as CEDIA_AGENT_CHANNEL } from "../../src/bridge-contract.ts";
const BROWSER_STATE_CHANNEL = "vscode:cediaAgentBrowser";
const BROWSER_COPY_LINK_CHANNEL = "vscode:cediaAgentBrowserCopyLink";

export interface NativeBrowserBridge {
	invoke(channel: string, input?: unknown): Promise<unknown>;
	on?(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
	removeListener?(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
}

export interface NativeBrowserApi {
	open(input: BrowserOpenInput): Promise<ThreadBrowserState>;
	close(input: BrowserThreadInput): Promise<ThreadBrowserState>;
	hide(input: BrowserThreadInput): Promise<void>;
	getState(input: BrowserThreadInput): Promise<ThreadBrowserState>;
	setPanelBounds(input: {
		threadId: string;
		bounds: BrowserPanelBounds | null;
		surface?: "native" | "renderer";
		occluded?: boolean;
		preview?: boolean;
		pageZoomFactor?: number;
	}): Promise<void>;
	attachWebview(input: BrowserTabInput & { webContentsId: number }): Promise<ThreadBrowserState>;
	detachWebview(input: BrowserTabInput & { webContentsId: number }): Promise<void>;
	copyLink(input: BrowserTabInput): Promise<void>;
	copyScreenshotToClipboard(input: BrowserTabInput): Promise<void>;
	captureScreenshot(input: BrowserTabInput): Promise<BrowserCaptureScreenshotResult>;
	capturePreview(input: BrowserTabInput): Promise<string | null>;
	navigate(input: BrowserNavigateInput): Promise<ThreadBrowserState>;
	reload(input: BrowserTabInput): Promise<ThreadBrowserState>;
	goBack(input: BrowserTabInput): Promise<ThreadBrowserState>;
	goForward(input: BrowserTabInput): Promise<ThreadBrowserState>;
	newTab(input: BrowserNewTabInput): Promise<ThreadBrowserState>;
	closeTab(input: BrowserTabInput): Promise<ThreadBrowserState>;
	selectTab(input: BrowserTabInput): Promise<ThreadBrowserState>;
	openDevTools(input: BrowserTabInput): Promise<void>;
	agentAttach(input: BrowserTabInput): Promise<BrowserAgentAttachResult>;
	agentDetach(input: BrowserThreadInput & { tabId?: string }): Promise<BrowserAgentDetachResult>;
	agentEndpoint(input: BrowserThreadInput): Promise<BrowserAgentEndpointResult>;
	onState(listener: (state: ThreadBrowserState) => void): () => void;
	onBrowserCopyLink(listener: (event: { threadId: string; url: string }) => void): () => void;
}

export interface BrowserAgentAttachResult {
	readonly cdpUrl: string;
	readonly tabId: string;
}

export interface BrowserAgentDetachResult {
	readonly attached: boolean;
	readonly cdpUrl?: string;
}

export interface BrowserAgentEndpointTab {
	readonly tabId: string;
	readonly url: string;
	readonly title: string;
}

export interface BrowserAgentEndpointResult {
	readonly attached: boolean;
	readonly cdpUrl?: string;
	readonly tabs: BrowserAgentEndpointTab[];
}

function panelRequest(method: string, input: unknown): { kind: "panel"; surface: "browser"; method: string; input: unknown } {
	return { kind: "panel", surface: "browser", method, input };
}

function statePayload(args: readonly unknown[]): ThreadBrowserState | null {
	const candidate = args.find((value) => value && typeof value === "object" && "threadId" in (value as object));
	return candidate && typeof candidate === "object" ? candidate as ThreadBrowserState : null;
}

export function createNativeBrowserApi(bridge: NativeBrowserBridge): NativeBrowserApi {
	const invoke = async <T>(method: string, input: unknown): Promise<T> => {
		return bridge.invoke(CEDIA_AGENT_CHANNEL, panelRequest(method, input)) as Promise<T>;
	};
	return {
		open: (input) => invoke<ThreadBrowserState>("open", input),
		close: (input) => invoke<ThreadBrowserState>("close", input),
		hide: async (input) => { await invoke("hide", input); },
		getState: (input) => invoke<ThreadBrowserState>("getState", input),
		setPanelBounds: async (input) => { await invoke("setPanelBounds", input); },
		attachWebview: (input) => invoke<ThreadBrowserState>("attachWebview", input),
		detachWebview: async (input) => { await invoke("detachWebview", input); },
		copyLink: async (input) => { await invoke("copyLink", input); },
		copyScreenshotToClipboard: async (input) => { await invoke("copyScreenshotToClipboard", input); },
		captureScreenshot: (input) => invoke<BrowserCaptureScreenshotResult>("captureScreenshot", input),
		capturePreview: (input) => invoke<string | null>("capturePreview", input),
		navigate: (input) => invoke<ThreadBrowserState>("navigate", input),
		reload: (input) => invoke<ThreadBrowserState>("reload", input),
		goBack: (input) => invoke<ThreadBrowserState>("goBack", input),
		goForward: (input) => invoke<ThreadBrowserState>("goForward", input),
		newTab: (input) => invoke<ThreadBrowserState>("newTab", input),
		closeTab: (input) => invoke<ThreadBrowserState>("closeTab", input),
		selectTab: (input) => invoke<ThreadBrowserState>("selectTab", input),
		openDevTools: async (input) => { await invoke("openDevTools", input); },
		agentAttach: (input) => invoke<BrowserAgentAttachResult>("agentAttach", input),
		agentDetach: (input) => invoke<BrowserAgentDetachResult>("agentDetach", input),
		agentEndpoint: (input) => invoke<BrowserAgentEndpointResult>("agentEndpoint", input),
		onState: (listener) => {
			if (!bridge.on) return () => undefined;
			const handler = (_event: unknown, ...args: unknown[]) => {
				const state = statePayload(args);
				if (state) listener(state);
			};
			bridge.on(BROWSER_STATE_CHANNEL, handler);
			return () => bridge.removeListener?.(BROWSER_STATE_CHANNEL, handler);
		},
		onBrowserCopyLink: (listener) => {
			if (!bridge.on) return () => undefined;
			const handler = (_event: unknown, ...args: unknown[]) => {
				const value = args.find((entry) => entry && typeof entry === "object") as { threadId?: unknown; url?: unknown } | undefined;
				if (typeof value?.threadId === "string" && typeof value.url === "string") listener({ threadId: value.threadId, url: value.url });
			};
			bridge.on(BROWSER_COPY_LINK_CHANNEL, handler);
			return () => bridge.removeListener?.(BROWSER_COPY_LINK_CHANNEL, handler);
		},
	};
}

