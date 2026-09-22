import type {
	FilesystemBrowseInput,
	FilesystemBrowseResult,
	ProjectFileChangeEvent,
	ProjectListDirectoriesInput,
	ProjectListDirectoriesResult,
	ProjectReadFileInput,
	ProjectReadFileResult,
	ProjectSearchContentInput,
	ProjectSearchContentResult,
	ProjectSearchEntriesInput,
	ProjectSearchEntriesResult,
	ProjectSearchLocalEntriesInput,
	ProjectSearchLocalEntriesResult,
	ProjectWatchFileInput,
	ProjectWriteFileInput,
	ProjectWriteFileResult,
} from "../vendor/synara/packages/contracts/src/index.ts";

import { AGENT_WINDOW_CHANNEL as CEDIA_AGENT_CHANNEL } from "../../src/bridge-contract.ts";
const CEDIA_FILES_EVENT_CHANNEL = "vscode:cediaAgentFiles";

export interface NativeFilesBridge {
	invoke(channel: string, input?: unknown): Promise<unknown>;
	on?(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
	removeListener?(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
}

export interface NativeFilesApi {
	projects: {
		listDirectories(input: ProjectListDirectoriesInput): Promise<ProjectListDirectoriesResult>;
		searchEntries(input: ProjectSearchEntriesInput): Promise<ProjectSearchEntriesResult>;
		searchLocalEntries(input: ProjectSearchLocalEntriesInput): Promise<ProjectSearchLocalEntriesResult>;
		searchContent(input: ProjectSearchContentInput): Promise<ProjectSearchContentResult>;
		readFile(input: ProjectReadFileInput, options?: { readonly signal?: AbortSignal }): Promise<ProjectReadFileResult>;
		writeFile(input: ProjectWriteFileInput): Promise<ProjectWriteFileResult>;
		onFileChange(input: ProjectWatchFileInput, callback: (event: ProjectFileChangeEvent) => void): () => void;
	};
	filesystem: {
		browse(input: FilesystemBrowseInput): Promise<FilesystemBrowseResult>;
	};
}

interface PanelRequest {
	kind: "panel";
	surface: "files";
	method: string;
	input: unknown;
}

interface WatchEventPayload {
	subscriptionId?: unknown;
	event?: unknown;
}

function request(bridge: NativeFilesBridge, method: string, input: unknown): Promise<unknown> {
	const payload: PanelRequest = { kind: "panel", surface: "files", method, input };
	return bridge.invoke(CEDIA_AGENT_CHANNEL, payload);
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
	if (!signal) return promise;
	if (signal.aborted) return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then(
			(value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
			(error) => { signal.removeEventListener("abort", onAbort); reject(error); },
		);
	});
}

export function createNativeFilesApi(bridge: NativeFilesBridge): NativeFilesApi {
	const invoke = (method: string, input: unknown) => request(bridge, method, input);
	return {
		projects: {
			listDirectories: (input) => invoke("projects.listDirectories", input) as Promise<ProjectListDirectoriesResult>,
			searchEntries: (input) => invoke("projects.searchEntries", input) as Promise<ProjectSearchEntriesResult>,
			searchLocalEntries: (input) => invoke("projects.searchLocalEntries", input) as Promise<ProjectSearchLocalEntriesResult>,
			searchContent: (input) => invoke("projects.searchContent", input) as Promise<ProjectSearchContentResult>,
			readFile: (input, options) => withAbort(invoke("projects.readFile", input) as Promise<ProjectReadFileResult>, options?.signal),
			writeFile: (input) => invoke("projects.writeFile", input) as Promise<ProjectWriteFileResult>,
			onFileChange: (input, callback) => {
				let disposed = false;
				let subscriptionId: string | undefined;
				const listener = (_event: unknown, ...args: unknown[]) => {
					const payload = (args[0] ?? {}) as WatchEventPayload;
					const event = payload.event;
					if (disposed || payload.subscriptionId !== subscriptionId || !event || typeof event !== "object") return;
					callback(event as ProjectFileChangeEvent);
				};
				bridge.on?.(CEDIA_FILES_EVENT_CHANNEL, listener);
				void (invoke("projects.subscribeFileChange", input) as Promise<{ subscriptionId: string }>).then((result) => {
					if (disposed) {
						void invoke("projects.unsubscribeFileChange", { subscriptionId: result.subscriptionId }).catch(() => undefined);
						return;
					}
					subscriptionId = result.subscriptionId;
				}).catch(() => undefined);
				return () => {
					disposed = true;
					if (subscriptionId) void invoke("projects.unsubscribeFileChange", { subscriptionId }).catch(() => undefined);
					bridge.removeListener?.(CEDIA_FILES_EVENT_CHANNEL, listener);
				};
			},
		},
		filesystem: {
			browse: (input) => invoke("filesystem.browse", input) as Promise<FilesystemBrowseResult>,
		},
	};
}
