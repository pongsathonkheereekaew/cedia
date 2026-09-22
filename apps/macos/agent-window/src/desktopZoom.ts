/**
 * Renderer-side state for the Code-OSS page zoom owned by the Agent Window.
 *
 * Electron's `webContents` zoom API is asynchronous from the renderer's point of
 * view.  Keeping the last value in this tiny controller gives Synara a synchronous
 * `DesktopBridge.getZoomFactor()` while still accepting updates pushed by the
 * native window after a keyboard shortcut or a View-menu action.
 */

export const CEDIA_ZOOM_EVENT = "vscode:cediaZoomFactor";
import { AGENT_WINDOW_CHANNEL } from "../../src/bridge-contract.ts";
export const CEDIA_ZOOM_REQUEST = AGENT_WINDOW_CHANNEL;

export interface DesktopZoomIpc {
	invoke(channel: string, input?: unknown): Promise<unknown>;
	on?(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
	removeListener?(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
}

export interface DesktopZoomController {
	getZoomFactor(): number;
	onZoomFactorChange(listener: (zoomFactor: number) => void): () => void;
	dispose(): void;
}

function normalizeZoomFactor(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 1;
}

/** Install the native zoom event and return the stateful bridge methods. */
export function createDesktopZoomController(bridge: DesktopZoomIpc): DesktopZoomController {
	let zoomFactor = 1;
	const listeners = new Set<(zoomFactor: number) => void>();

	const update = (value: unknown): void => {
		const next = normalizeZoomFactor(value);
		if (next === zoomFactor) return;
		zoomFactor = next;
		for (const listener of listeners) listener(next);
	};
	const onZoom = (_event: unknown, ...args: unknown[]): void => update(args[0]);
	bridge.on?.(CEDIA_ZOOM_EVENT, onZoom);

	// The event is pushed after a change, but the first render also needs the
	// restored value from the native CodeWindow.  A failure simply leaves the
	// web build at its safe 100% default.
	void bridge.invoke(CEDIA_ZOOM_REQUEST, { kind: "getZoomFactor" })
		.then(update)
		.catch(() => undefined);

	return {
		getZoomFactor: () => zoomFactor,
		onZoomFactorChange: listener => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		dispose: () => {
			listeners.clear();
			bridge.removeListener?.(CEDIA_ZOOM_EVENT, onZoom);
		},
	};
}
