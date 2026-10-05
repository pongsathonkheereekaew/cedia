/**
 * Cedia's native Agent Window bootstrap.
 *
 * The Synara web app is deliberately loaded only after the Code-OSS preload
 * configuration has resolved and the Cedia adapter has been installed.  This
 * keeps credentials and the host descriptor in the main process while giving
 * Synara the NativeApi shape it already consumes.
 */

import { createCediaDesktopBridge, createCediaNativeApi, type AgentWindowBridge } from "./cedia-adapter";
import { AGENT_WINDOW_CHANNEL as CEDIA_AGENT_CHANNEL } from "../../src/bridge-contract.ts";
import { CEDIA_ZOOM_REQUEST } from "./desktopZoom";
import { openNativeAgentIntent } from "./native-handoff";
import { installNativeDeviceFrameSource } from "./native-device";
import { decodeSessionIdFromHash } from "../vendor/synara/apps/web/src/ide-mode";
import type { DesktopBridge, NativeApi } from "@synara/contracts";

interface HostThemeSnapshot {
	mode: "light" | "dark";
	themeName?: string;
	colors?: Record<string, string>;
}

interface VscodePreload {
	context?: { resolveConfiguration?: () => Promise<unknown> };
	ipcRenderer?: AgentWindowBridge;
}

declare global {
	interface Window {
		vscode?: VscodePreload;
		nativeApi?: NativeApi;
		desktopBridge?: DesktopBridge;
		__CEDIA_HOST_THEME__?: HostThemeSnapshot;
	}
}

async function boot(): Promise<void> {
	const preload = window.vscode;
	if (!preload?.context?.resolveConfiguration || !preload.ipcRenderer?.invoke) {
		throw new Error("Cedia Agent Window preload bridge is unavailable");
	}
	await preload.context.resolveConfiguration();
	const disposeDeviceFrames = installNativeDeviceFrameSource(preload.ipcRenderer);
	const nativeApi = createCediaNativeApi({ bridge: preload.ipcRenderer });
	window.nativeApi = nativeApi;
	window.desktopBridge = createCediaDesktopBridge({ bridge: preload.ipcRenderer });
	// Load the shared app-side persistence only after the scoped bridge and native
	// API globals exist. Several Synara modules inspect those globals at module load.
	const [{ installSharedUiDraftBridge }, { appHistory }] = await Promise.all([
		import("../vendor/synara/apps/web/src/sharedUiDraftBridge"),
		import("../vendor/synara/apps/web/src/appNavigation"),
	]);
	const sharedDraftBridge = installSharedUiDraftBridge(preload.ipcRenderer, {
		subscribeToRouteChanges: listener => appHistory.subscribe(listener),
	});
	window.__CEDIA_DRAFT_FLUSH__ = sharedDraftBridge.flush;
	// §6.4: the host owns the CEDIA app-preference subset. The window projects it into its own
	// settings store and sends its own changes back with the revision it read, so two windows and a
	// restart agree on the same record instead of each keeping a private copy.
	const { installHostPreferenceSync } = await import("../vendor/synara/apps/web/src/hostPreferences");
	const hostPreferences = installHostPreferenceSync(preload.ipcRenderer);
	const hostPreferencesReady = hostPreferences.hydrate();
	window.__CEDIA_HOST_PREFERENCES_FLUSH__ = async () => {
		await hostPreferencesReady;
		await hostPreferences.flush();
		const unsaved = hostPreferences.unsaved();
		if (hostPreferences.status() !== "ready" || unsaved.length > 0) {
			throw new Error(`Cedia preferences were not acknowledged${unsaved.length ? ` (${unsaved.join(", ")})` : ""}.`);
		}
	};
	const openInEditor = nativeApi.shell.openInEditor;
	nativeApi.shell.openInEditor = async (target: string, editor: string) => {
		await sharedDraftBridge.flush();
		await hostPreferences.flush();
		await openInEditor(target, editor);
	};

	// The standalone Agent renderer does not load Code-OSS's workbench action
	// registry. Keep the familiar View-menu commands and macOS shortcuts wired to
	// the owning CodeWindow instead of letting Chromium zoom this document alone.
	const runZoomAction = (action: "in" | "out" | "reset"): void => {
		void preload.ipcRenderer?.invoke(CEDIA_ZOOM_REQUEST, { kind: "zoom", action }).catch(() => undefined);
	};
	const disposeMenuZoom = window.desktopBridge.onMenuAction(action => {
		switch (action) {
			case "workbench.action.zoomIn": runZoomAction("in"); break;
			case "workbench.action.zoomOut": runZoomAction("out"); break;
			case "workbench.action.zoomReset": runZoomAction("reset"); break;
		}
	});
	const onZoomShortcut = (event: KeyboardEvent): void => {
		const modifier = event.metaKey || event.ctrlKey;
		if (!modifier || event.altKey || event.metaKey && event.ctrlKey) return;
		switch (event.key) {
			case "+":
			case "=":
				event.preventDefault();
				runZoomAction("in");
				break;
			case "-":
				event.preventDefault();
				runZoomAction("out");
				break;
			case "0":
				event.preventDefault();
				runZoomAction("reset");
				break;
		}
	};
	window.addEventListener("keydown", onZoomShortcut, true);
	const environment = await preload.ipcRenderer.invoke(CEDIA_AGENT_CHANNEL, { kind: "bootstrap" }) as {
		homeDir: string;
		cwd?: string | null;
		sessionId?: string;
		theme?: HostThemeSnapshot;
	};
	// Set the host snapshot before importing Synara. useTheme projects it during
	// module initialization, avoiding a light/dark flash and keeping standalone
	// Agent Windows aligned with the IDE that launched them.
	if (environment.theme) window.__CEDIA_HOST_THEME__ = environment.theme;
	const initialSessionId = environment.sessionId ?? decodeSessionIdFromHash(window.location.hash);
	if (initialSessionId && !decodeSessionIdFromHash(window.location.hash)) {
		window.location.hash = `/${encodeURIComponent(initialSessionId)}`;
	}
	if (initialSessionId) void sharedDraftBridge.hydrateThread(initialSessionId);
	const notifyActiveSession = (): void => {
		const sessionId = decodeSessionIdFromHash(window.location.hash);
		if (!sessionId) return;
		void preload.ipcRenderer?.invoke(CEDIA_AGENT_CHANNEL, { kind: "activeSession", sessionId }).catch(() => undefined);
	};
	const onHashChange = (): void => {
		notifyActiveSession();
		const sessionId = decodeSessionIdFromHash(window.location.hash);
		if (sessionId) void sharedDraftBridge.hydrateThread(sessionId);
	};
	window.addEventListener("hashchange", onHashChange);
	const { useWorkspacePathsStore } = await import("../vendor/synara/apps/web/src/workspacePathsStore");
	useWorkspacePathsStore.getState().setServerWorkspacePaths({ homeDir: environment.homeDir });

	// Code-OSS asks renderer windows to participate in a two-phase unload.  A
	// standalone renderer has no workbench lifecycle service, so acknowledge the
	// same channels directly; failing to do so leaves the native window registry
	// waiting forever during quit/reload.
	const beforeUnload = (_event: unknown, ...args: unknown[]) => {
		const request = args[0] as { okChannel?: unknown; cancelChannel?: unknown } | undefined;
		if (typeof request?.okChannel === "string") preload.ipcRenderer?.send?.(request.okChannel);
	};
	const willUnload = (_event: unknown, ...args: unknown[]) => {
		const request = args[0] as { replyChannel?: unknown } | undefined;
		(nativeApi as { dispose?: () => void }).dispose?.();
		void sharedDraftBridge.flush();
		void hostPreferences.flush();
		sharedDraftBridge.dispose();
		hostPreferences.dispose();
		delete window.__CEDIA_HOST_PREFERENCES_FLUSH__;
		delete window.__CEDIA_DRAFT_FLUSH__;
		window.removeEventListener("hashchange", onHashChange);
		disposeMenuZoom();
		window.removeEventListener("keydown", onZoomShortcut, true);
		disposeDeviceFrames();
		if (typeof request?.replyChannel === "string") preload.ipcRenderer?.send?.(request.replyChannel);
	};
	preload.ipcRenderer.on?.("vscode:onBeforeUnload", beforeUnload);
	preload.ipcRenderer.on?.("vscode:onWillUnload", willUnload);

	let markReady!: () => void;
	const ready = new Promise<void>(resolve => { markReady = resolve; });
	// Module import finishes before React mounts its initial route. Wait for the
	// mounted chat so an index-route draft cannot overwrite a native handoff.
	window.addEventListener("cedia:chat-ui-ready", () => markReady(), { once: true });
	let handoffs = Promise.resolve();
	preload.ipcRenderer.on?.("vscode:selectAgentsFolder", (_event, folder, resource) => {
		handoffs = handoffs.then(async () => {
			await ready;
			const resourceObject = resource && typeof resource === "object" ? resource as { path?: unknown; scheme?: unknown; authority?: unknown } : null;
			const draftId = resourceObject?.scheme === "cedia" && resourceObject.authority === "session" && typeof resourceObject.path === "string"
				? resourceObject.path.replace(/^\/+/, "")
				: "";
			if (/^[A-Za-z0-9_-]{1,128}$/.test(draftId)) {
				await sharedDraftBridge.hydrateThread(draftId);
				const { useComposerDraftStore } = await import("../vendor/synara/apps/web/src/composerDraftStore");
				const state = useComposerDraftStore.getState();
				const hasDraftThread = Object.prototype.hasOwnProperty.call(state.draftThreadsByThreadId, draftId);
				const hasDraft = Object.prototype.hasOwnProperty.call(state.draftsByThreadId, draftId);
				if (hasDraftThread || hasDraft) {
					window.location.hash = `/${encodeURIComponent(draftId)}`;
					return;
				}
			}
			await openNativeAgentIntent(nativeApi, folder, resource, id => { window.location.hash = `/${encodeURIComponent(id)}`; });
		}).catch(error => console.error("Cedia IDE handoff failed", error));
	});

	// Agent windows use the native Code-OSS window lifecycle even though the
	// renderer is a standalone Synara app.  The main process listener accepts no
	// payload; using send also matches the existing VS Code workbench signal.
	preload.ipcRenderer.send?.("vscode:workbenchLoaded");

	// Bypass Synara's browser pairing/auth bootstrap.  Cedia's main process has
	// already authenticated the local OMP host and exposes only scoped requests.
	await import("../vendor/synara/apps/web/src/main");
	notifyActiveSession();
}

void boot().catch(error => {
	const message = error instanceof Error ? error.message : String(error);
	const root = document.getElementById("root");
	if (root) root.textContent = `Cedia Agents could not start: ${message}`;
	console.error(error);
});
