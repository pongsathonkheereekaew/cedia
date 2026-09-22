import type {
	TerminalAckOutputInput,
	TerminalClearInput,
	TerminalCloseInput,
	TerminalEvent,
	TerminalOpenInput,
	TerminalResizeInput,
	TerminalRestartInput,
	TerminalSessionSnapshot,
	TerminalWriteInput,
} from "../vendor/synara/packages/contracts/src/terminal.ts";

import { AGENT_WINDOW_CHANNEL as CEDIA_AGENT_CHANNEL } from "../../src/bridge-contract.ts";
export const CEDIA_AGENT_TERMINAL_CHANNEL = "vscode:cediaAgentTerminal";

export interface NativeTerminalBridge {
	invoke(channel: string, input?: unknown): Promise<unknown>;
	on?(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
	removeListener?(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
}

export interface NativeTerminalApi {
	open(input: TerminalOpenInput): Promise<TerminalSessionSnapshot>;
	write(input: TerminalWriteInput): Promise<void>;
	ackOutput(input: TerminalAckOutputInput): Promise<void>;
	resize(input: TerminalResizeInput): Promise<void>;
	clear(input: TerminalClearInput): Promise<void>;
	restart(input: TerminalRestartInput): Promise<TerminalSessionSnapshot>;
	close(input: TerminalCloseInput): Promise<void>;
	onEvent(listener: (event: TerminalEvent) => void): () => void;
}

interface TerminalPanelRequest {
	kind: "panel";
	surface: "terminal";
	method: "open" | "write" | "ackOutput" | "resize" | "clear" | "restart" | "close";
	input: unknown;
}

function request<T>(bridge: NativeTerminalBridge, method: TerminalPanelRequest["method"], input: unknown): Promise<T> {
	return bridge.invoke(CEDIA_AGENT_CHANNEL, {
		kind: "panel",
		surface: "terminal",
		method,
		input,
	} satisfies TerminalPanelRequest) as Promise<T>;
}

export function createNativeTerminalApi(bridge: NativeTerminalBridge): NativeTerminalApi {
	return {
		open: input => request<TerminalSessionSnapshot>(bridge, "open", input),
		write: input => request<void>(bridge, "write", input),
		ackOutput: input => request<void>(bridge, "ackOutput", input),
		resize: input => request<void>(bridge, "resize", input),
		clear: input => request<void>(bridge, "clear", input),
		restart: input => request<TerminalSessionSnapshot>(bridge, "restart", input),
		close: input => request<void>(bridge, "close", input),
		onEvent: listener => {
			if (!bridge.on) return () => undefined;
			const handler = (_event: unknown, ...args: unknown[]) => {
				const payload = args[0];
				if (payload && typeof payload === "object") listener(payload as TerminalEvent);
			};
			bridge.on(CEDIA_AGENT_TERMINAL_CHANNEL, handler);
			return () => bridge.removeListener?.(CEDIA_AGENT_TERMINAL_CHANNEL, handler);
		},
	};
}
