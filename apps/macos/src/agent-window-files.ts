import { createHash, randomUUID } from "node:crypto";
import { watch, constants as fsConstants, type FSWatcher } from "node:fs";
import { access, chmod, lstat, open, readdir, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { isSupportedLocalImagePath, lowerCaseExtensionOf } from "../agent-window/vendor/synara/packages/shared/src/localPreviewFiles.ts";

/** IPC channel used by file-watch subscriptions in the Agent Window. */
export const AGENT_FILES_EVENT_CHANNEL = "vscode:cediaAgentFiles";

const DEFAULT_READ_FILE_MAX_BYTES = 1_000_000;
const MAX_LOCAL_PREVIEW_BYTES = 8 * 1024 * 1024;
const LOCAL_PREVIEW_GRANT_TTL_MS = 60_000;
const MAX_LOCAL_PREVIEW_GRANTS = 256;
const MAX_FILE_PATH_LENGTH = 2_048;
const MAX_DIRECTORY_LIST_ENTRIES = 4_000;
const MAX_WORKSPACE_INDEX_ENTRIES = 25_000;
const MAX_SEARCH_LOCAL_DEPTH = 6;
const MAX_SEARCH_LOCAL_RESULTS = 100;
const MAX_SEARCH_CONTENT_FILE_BYTES = 512 * 1024;
const MAX_SEARCH_CONTENT_MATCHES_PER_FILE = 5;
const MAX_SEARCH_CONTENT_LINE_LENGTH = 1_024;
const SEARCH_TIME_BUDGET_MS = 2_000;
const IGNORED_DIRECTORY_NAMES = new Set([
	".git",
	".hg",
	".svn",
	".DS_Store",
	".Trash",
	"node_modules",
	".next",
	".nuxt",
	".turbo",
	".cache",
	".convex",
	".pnpm-store",
	".yarn",
	".gradle",
	".m2",
	".nuget",
	".bundle",
	"Library",
	"Pods",
	"dist",
	"build",
	"out",
	"target",
	"vendor",
	"__pycache__",
	".venv",
	"venv",
]);

interface RecordValue {
	readonly [key: string]: unknown;
}

interface ProjectFileSystemEntry {
	readonly path: string;
	readonly name: string;
	readonly parentPath?: string;
	readonly kind: "file" | "directory";
	readonly hasChildren?: boolean;
}

interface FileChangeEvent {
	readonly type: "changed" | "deleted";
	readonly relativePath: string;
	readonly mtimeMs?: number;
}

interface WatchSubscription {
	readonly id: string;
	readonly watcher: FSWatcher;
	readonly relativePath: string;
	readonly cwd: string;
	readonly sender: FileEventSender;
}

interface FileEventSender {
	send(channel: string, ...args: unknown[]): void;
	isDestroyed?: () => boolean;
	once?: (event: string, listener: () => void) => void;
}

interface FileEventRequest {
	readonly kind?: unknown;
	readonly sender?: FileEventSender;
}

interface LocalFilePreviewGrant {
	readonly path: string;
	readonly expiresAt: number;
}

interface LocalFilePreviewInput {
	readonly path?: unknown;
	readonly cwd?: unknown;
	readonly grant?: unknown;
}

export interface AgentFilesService {
	handle(event: unknown, method: string, input: unknown): Promise<unknown>;
	dispose(): void;
}

class AgentFilesError extends Error {
	readonly code: string;
	readonly cwd?: string;
	readonly relativePath?: string;

	constructor(message: string, code = "AGENT_FILES_ERROR", details?: { cwd?: string; relativePath?: string }) {
		super(message);
		this.name = "AgentFilesError";
		this.code = code;
		this.cwd = details?.cwd;
		this.relativePath = details?.relativePath;
	}
}

function isRecord(value: unknown): value is RecordValue {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, name: string, maxLength = MAX_FILE_PATH_LENGTH): string {
	if (typeof value !== "string" || value.length === 0 || value.length > maxLength || value.includes("\0")) {
		throw new AgentFilesError(`Invalid ${name}.`);
	}
	return value;
}

function mimeTypeForLocalImage(filePath: string): string {
	switch (lowerCaseExtensionOf(filePath)) {
		case ".avif": return "image/avif";
		case ".bmp": return "image/bmp";
		case ".gif": return "image/gif";
		case ".heic": return "image/heic";
		case ".heif": return "image/heif";
		case ".ico": return "image/x-icon";
		case ".jpeg":
		case ".jpg": return "image/jpeg";
		case ".png": return "image/png";
		case ".svg": return "image/svg+xml";
		case ".tiff": return "image/tiff";
		case ".webp": return "image/webp";
		default: throw new AgentFilesError("This file type is not supported for image preview.", "AGENT_FILES_PREVIEW_TYPE");
	}
}

function optionalPositiveInteger(value: unknown, name: string, fallback: number, max: number): number {
	if (value === undefined) return fallback;
	if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > max) {
		throw new AgentFilesError(`Invalid ${name}.`);
	}
	return value as number;
}

function assertAbsolutePath(value: unknown, name: string): string {
	const candidate = requiredString(value, name);
	if (!isAbsolute(candidate) || /^[A-Za-z]:[\\/]/.test(candidate) && process.platform !== "win32") {
		throw new AgentFilesError(`${name} must be an absolute path.`);
	}
	return resolve(candidate);
}

function assertRelativePath(value: unknown, name: string): string {
	const candidate = requiredString(value, name);
	if (isAbsolute(candidate) || /^[A-Za-z]:[\\/]/.test(candidate) || candidate.startsWith("\\\\")) {
		throw new AgentFilesError(`${name} must be workspace-relative.`);
	}
	const normalized = candidate.replaceAll("\\", "/");
	const parts = normalized.split("/").filter(Boolean);
	if (parts.length === 0 || parts.some((part) => part === "..")) {
		throw new AgentFilesError(`${name} is outside the workspace.`);
	}
	const result = parts.join("/");
	if (result === "." || result.length > MAX_FILE_PATH_LENGTH) {
		throw new AgentFilesError(`${name} is invalid.`);
	}
	return result;
}

function isContained(root: string, candidate: string): boolean {
	const child = relative(root, candidate);
	return child === "" || (child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}

function toPosixPath(value: string): string {
	return value.split(sep).join("/");
}

function parentPathOf(value: string): string | undefined {
	const index = value.lastIndexOf("/");
	return index === -1 ? undefined : value.slice(0, index);
}

function hashBytes(bytes: Uint8Array): string {
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function normalizeLineEndings(value: string): string {
	return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

function detectLineEnding(value: string): "lf" | "crlf" | "cr" | "mixed" {
	const crlf = value.match(/\r\n/g)?.length ?? 0;
	const lf = value.match(/(?<!\r)\n/g)?.length ?? 0;
	const cr = value.match(/\r(?!\n)/g)?.length ?? 0;
	const styles = Number(crlf > 0) + Number(lf > 0) + Number(cr > 0);
	if (styles > 1) return "mixed";
	if (crlf > 0) return "crlf";
	if (cr > 0) return "cr";
	return "lf";
}

function encodeText(contents: string, encoding: string | undefined, lineEnding: string | undefined): Buffer {
	const normalized = normalizeLineEndings(contents);
	const ending = lineEnding === "crlf" ? "\r\n" : lineEnding === "cr" ? "\r" : "\n";
	const value = lineEnding ? normalized.replaceAll("\n", ending) : contents;
	const bytes = Buffer.from(value, "utf8");
	if (encoding === "utf8-bom") return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]);
	return bytes;
}

function decodeText(bytes: Buffer): { contents: string; encoding: "utf8" | "utf8-bom"; lineEnding: "lf" | "crlf" | "cr" | "mixed" } {
	const hasBom = bytes.length >= 3 && bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));
	const textBytes = hasBom ? bytes.subarray(3) : bytes;
	let decoded: string;
	try {
		decoded = new TextDecoder("utf-8", { fatal: true }).decode(textBytes);
	} catch (error) {
		throw new AgentFilesError(`File encoding is not supported for text editing: ${error instanceof Error ? error.message : String(error)}`);
	}
	return { contents: normalizeLineEndings(decoded), encoding: hasBom ? "utf8-bom" : "utf8", lineEnding: detectLineEnding(decoded) };
}

async function canonicalWorkspace(cwdInput: unknown): Promise<{ input: string; root: string }> {
	const input = assertAbsolutePath(cwdInput, "cwd");
	let root: string;
	try {
		root = await realpath(input);
		const rootStat = await stat(root);
		if (!rootStat.isDirectory()) throw new Error("not a directory");
	} catch (error) {
		throw new AgentFilesError(`Workspace directory is unavailable: ${error instanceof Error ? error.message : String(error)}`, "AGENT_FILES_WORKSPACE");
	}
	return { input, root };
}

async function existingRealPathWithinRoot(root: string, absolutePath: string): Promise<string> {
	let target: string;
	try {
		target = await realpath(absolutePath);
	} catch (error) {
		throw new AgentFilesError(`Path is unavailable: ${error instanceof Error ? error.message : String(error)}`, "AGENT_FILES_PATH");
	}
	if (!isContained(root, target)) throw new AgentFilesError("Path is outside the workspace.", "AGENT_FILES_PATH");
	return target;
}

async function resolveLocalPreviewPath(input: LocalFilePreviewInput): Promise<{ real: string; mimeType: string; size: number }> {
	const requested = requiredString(input.path, "path");
	const workspace = await canonicalWorkspace(input.cwd);
	let absolute: string;
	if (isAbsolute(requested) || /^[A-Za-z]:[\\/]/.test(requested)) {
		absolute = resolve(requested);
	} else {
		absolute = resolve(workspace.root, requested.replaceAll("\\", "/"));
	}
	const real = await realpath(absolute).catch((error) => {
		throw new AgentFilesError(`Path is unavailable: ${error instanceof Error ? error.message : String(error)}`, "AGENT_FILES_PREVIEW_PATH");
	});
	if (!isContained(workspace.root, real)) throw new AgentFilesError("Image preview path is outside the workspace.", "AGENT_FILES_PREVIEW_PATH");
	if (!isSupportedLocalImagePath(real)) throw new AgentFilesError("This file type is not supported for image preview.", "AGENT_FILES_PREVIEW_TYPE");
	const info = await stat(real);
	if (!info.isFile()) throw new AgentFilesError("Image preview path is not a regular file.", "AGENT_FILES_PREVIEW_PATH");
	if (info.size > MAX_LOCAL_PREVIEW_BYTES) throw new AgentFilesError("Image preview is too large to load.", "AGENT_FILES_PREVIEW_CAPACITY");
	return { real, mimeType: mimeTypeForLocalImage(real), size: info.size };
}

async function resolveWorkspacePath(
	rootInfo: { input: string; root: string },
	relativePathInput: unknown,
	options: { readonly allowMissing?: boolean } = {},
): Promise<{ requested: string; absolute: string; real: string; symlink: boolean }> {
	const requested = assertRelativePath(relativePathInput, "relativePath");
	const absolute = resolve(rootInfo.root, requested);
	if (!isContained(rootInfo.root, absolute)) throw new AgentFilesError("Path is outside the workspace.", "AGENT_FILES_PATH", { cwd: rootInfo.input, relativePath: requested });
	let symlink = false;
	try {
		symlink = (await lstat(absolute)).isSymbolicLink();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !options.allowMissing) {
			throw new AgentFilesError(`Path is unavailable: ${error instanceof Error ? error.message : String(error)}`, "AGENT_FILES_PATH", { cwd: rootInfo.input, relativePath: requested });
		}
	}
	if (symlink && options.allowMissing) {
		throw new AgentFilesError("Writing through a symbolic link is not allowed.", "AGENT_FILES_PATH", { cwd: rootInfo.input, relativePath: requested });
	}
	if (options.allowMissing) {
		const parent = await existingRealPathWithinRoot(rootInfo.root, dirname(absolute));
		const parentStat = await stat(parent);
		if (!parentStat.isDirectory()) throw new AgentFilesError("Workspace write parent is not a directory.", "AGENT_FILES_PATH", { cwd: rootInfo.input, relativePath: requested });
		return { requested, absolute, real: join(parent, basename(absolute)), symlink };
	}
	const real = await existingRealPathWithinRoot(rootInfo.root, absolute);
	return { requested, absolute, real, symlink };
}

async function hasDirectoryChildren(directory: string): Promise<boolean> {
	try {
		const entries = await readdir(directory, { withFileTypes: true });
		return entries.some((entry) => entry.name !== "." && entry.name !== ".." && entry.name !== ".git");
	} catch {
		return false;
	}
}

async function safeDirentKind(root: string, absolute: string, dirent: { isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }): Promise<"file" | "directory" | null> {
	if (dirent.isDirectory() || dirent.isFile()) return dirent.isDirectory() ? "directory" : "file";
	if (!dirent.isSymbolicLink()) return null;
	try {
		const target = await existingRealPathWithinRoot(root, absolute);
		const targetStat = await stat(target);
		return targetStat.isDirectory() ? "directory" : targetStat.isFile() ? "file" : null;
	} catch {
		return null;
	}
}

async function listDirectories(input: RecordValue): Promise<{ entries: ProjectFileSystemEntry[] }> {
	const rootInfo = await canonicalWorkspace(input.cwd);
	const relativePath = input.relativePath === undefined ? "" : assertRelativePath(input.relativePath, "relativePath");
	const target = relativePath ? await resolveWorkspacePath(rootInfo, relativePath) : { real: rootInfo.root };
	const targetStat = await stat(target.real);
	if (!targetStat.isDirectory()) throw new AgentFilesError("Directory path is not a directory.", "AGENT_FILES_PATH");
	const includeFiles = input.includeFiles === true;
	const dirents = await readdir(target.real, { withFileTypes: true });
	const candidates: Array<{ name: string; kind: "file" | "directory"; absolute: string }> = [];
	for (const dirent of dirents) {
		if (!dirent.name || dirent.name === "." || dirent.name === ".." || dirent.name === ".git") continue;
		const kind = await safeDirentKind(rootInfo.root, join(target.real, dirent.name), dirent);
		if (!kind || (kind === "file" && !includeFiles)) continue;
		candidates.push({ name: dirent.name, kind, absolute: join(target.real, dirent.name) });
		if (candidates.length >= MAX_DIRECTORY_LIST_ENTRIES) break;
	}
	candidates.sort((left, right) => left.kind === right.kind ? left.name.localeCompare(right.name) : left.kind === "directory" ? -1 : 1);
	return {
		entries: await Promise.all(candidates.map(async (entry) => {
			const childPath = toPosixPath(relativePath ? join(relativePath, entry.name) : entry.name);
			return {
				path: childPath,
				name: entry.name,
				kind: entry.kind,
				...(relativePath ? { parentPath: relativePath } : {}),
				...(entry.kind === "directory" ? { hasChildren: await hasDirectoryChildren(entry.absolute) } : {}),
			};
		})),
	};
}

interface SearchEntry extends ProjectFileSystemEntry {
	readonly depth: number;
}

async function scanWorkspace(root: string): Promise<{ entries: SearchEntry[]; truncated: boolean }> {
	const entries: SearchEntry[] = [];
	const queue: Array<{ absolute: string; relativePath: string; depth: number }> = [{ absolute: root, relativePath: "", depth: 0 }];
	let truncated = false;
	while (queue.length > 0 && !truncated) {
		const current = queue.shift()!;
		let dirents;
		try { dirents = await readdir(current.absolute, { withFileTypes: true }); } catch { continue; }
		dirents.sort((left, right) => left.name.localeCompare(right.name));
		for (const dirent of dirents) {
			if (!dirent.name || dirent.name === "." || dirent.name === ".." || dirent.name === ".git") continue;
			if (dirent.isDirectory() && IGNORED_DIRECTORY_NAMES.has(dirent.name)) continue;
			const absolute = join(current.absolute, dirent.name);
			const kind = await safeDirentKind(root, absolute, dirent);
			if (!kind) continue;
			const pathValue = toPosixPath(current.relativePath ? join(current.relativePath, dirent.name) : dirent.name);
			entries.push({ path: pathValue, name: dirent.name, kind, ...(current.relativePath ? { parentPath: current.relativePath } : {}), depth: current.depth + 1 });
			if (entries.length >= MAX_WORKSPACE_INDEX_ENTRIES) { truncated = true; break; }
			if (kind === "directory" && current.depth < 64) queue.push({ absolute, relativePath: pathValue, depth: current.depth + 1 });
		}
	}
	return { entries, truncated };
}

function normalizeSearchQuery(value: unknown): string {
	let query = requiredString(value, "query", 256).trim().toLowerCase();
	while (query.startsWith("@") || query.startsWith("./") || query.startsWith("/")) query = query.startsWith("./") ? query.slice(2) : query.slice(1);
	return query;
}

function scoreMatch(value: string, query: string): number | null {
	if (!query) return 0;
	const lower = value.toLowerCase();
	if (lower === query) return 0;
	if (lower.startsWith(query)) return 2;
	if (lower.includes(query)) return 5;
	let cursor = 0;
	for (const char of query) {
		const index = lower.indexOf(char, cursor);
		if (index === -1) return null;
		cursor = index + 1;
	}
	return 100 + cursor;
}

async function searchEntries(input: RecordValue): Promise<{ entries: ProjectFileSystemEntry[]; truncated: boolean }> {
	const rootInfo = await canonicalWorkspace(input.cwd);
	const query = normalizeSearchQuery(input.query);
	const limit = optionalPositiveInteger(input.limit, "limit", 80, 200);
	const kind = input.kind === undefined ? undefined : input.kind === "file" || input.kind === "directory" ? input.kind : (() => { throw new AgentFilesError("Invalid kind."); })();
	const scanned = await scanWorkspace(rootInfo.root);
	const ranked = scanned.entries.flatMap((entry) => {
		if (kind && entry.kind !== kind) return [];
		const score = Math.min(scoreMatch(entry.name, query) ?? Infinity, scoreMatch(entry.path, query) === null ? Infinity : 1_000 + (scoreMatch(entry.path, query) ?? 0));
		return Number.isFinite(score) ? [{ entry, score }] : [];
	});
	ranked.sort((left, right) => left.score - right.score || left.entry.depth - right.entry.depth || left.entry.path.localeCompare(right.entry.path));
	return { entries: ranked.slice(0, limit).map(({ entry }) => { const { depth: _depth, ...value } = entry; return value; }), truncated: scanned.truncated || ranked.length > limit };
}

async function searchLocalEntries(input: RecordValue): Promise<{ entries: Array<{ path: string; name: string; parentPath?: string; kind: "file" | "directory" }>; truncated: boolean }> {
	const root = (await canonicalWorkspace(input.rootPath)).root;
	const query = normalizeSearchQuery(input.query);
	if (!query) return { entries: [], truncated: false };
	const limit = Math.min(optionalPositiveInteger(input.limit, "limit", 50, MAX_SEARCH_LOCAL_RESULTS), MAX_SEARCH_LOCAL_RESULTS);
	const includeFiles = input.includeFiles !== false;
	const includeDotfiles = query.startsWith(".");
	const deadline = Date.now() + SEARCH_TIME_BUDGET_MS;
	const ranked: Array<{ entry: { path: string; name: string; parentPath?: string; kind: "file" | "directory" }; score: number }> = [];
	const queue: Array<{ absolute: string; depth: number }> = [{ absolute: root, depth: 0 }];
	let truncated = false;
	while (queue.length > 0) {
		if (Date.now() > deadline) { truncated = true; break; }
		const current = queue.shift()!;
		let dirents;
		try { dirents = await readdir(current.absolute, { withFileTypes: true }); } catch { continue; }
		for (const dirent of dirents) {
			if (Date.now() > deadline) { truncated = true; break; }
			if (!dirent.name || dirent.name === "." || dirent.name === "..") continue;
			if (IGNORED_DIRECTORY_NAMES.has(dirent.name) || (!includeDotfiles && dirent.name.startsWith("."))) continue;
			const absolute = join(current.absolute, dirent.name);
			const kind = await safeDirentKind(root, absolute, dirent);
			if (!kind || (kind === "file" && !includeFiles)) continue;
			const score = scoreMatch(dirent.name, query);
			if (score !== null) ranked.push({ entry: { path: absolute, name: dirent.name, parentPath: current.absolute, kind }, score });
			if (kind === "directory" && current.depth < MAX_SEARCH_LOCAL_DEPTH) queue.push({ absolute, depth: current.depth + 1 });
		}
	}
	ranked.sort((left, right) => left.score - right.score || left.entry.path.localeCompare(right.entry.path));
	return { entries: ranked.slice(0, limit).map(({ entry }) => entry), truncated: truncated || ranked.length > limit };
}

async function searchContent(input: RecordValue): Promise<{ matches: Array<{ path: string; lineNumber: number; lineText: string }>; truncated: boolean }> {
	const rootInfo = await canonicalWorkspace(input.cwd);
	const query = normalizeSearchQuery(input.query);
	if (query.length < 2) return { matches: [], truncated: false };
	const limit = optionalPositiveInteger(input.limit, "limit", 50, 100);
	const scanned = await scanWorkspace(rootInfo.root);
	const matches: Array<{ path: string; lineNumber: number; lineText: string }> = [];
	const deadline = Date.now() + SEARCH_TIME_BUDGET_MS;
	for (const entry of scanned.entries) {
		if (entry.kind !== "file") continue;
		if (Date.now() > deadline) break;
		const absolute = join(rootInfo.root, entry.path);
		let bytes: Buffer;
		try {
			const handle = await open(absolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
			try {
				const info = await handle.stat();
				if (!info.isFile() || info.size > MAX_SEARCH_CONTENT_FILE_BYTES) continue;
				const buffer = Buffer.alloc(Math.min(info.size, MAX_SEARCH_CONTENT_FILE_BYTES));
				const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
				bytes = buffer.subarray(0, bytesRead);
			} finally { await handle.close(); }
		} catch { continue; }
		if (bytes.length === 0 || bytes.length > MAX_SEARCH_CONTENT_FILE_BYTES || bytes.subarray(0, Math.min(bytes.length, 8_192)).includes(0)) continue;
		let contents: string;
		try { contents = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { continue; }
		if (!contents.toLowerCase().includes(query)) continue;
		const lines = contents.split("\n");
		let perFile = 0;
		for (let index = 0; index < lines.length && perFile < MAX_SEARCH_CONTENT_MATCHES_PER_FILE; index += 1) {
			const line = lines[index] ?? "";
			if (!line.toLowerCase().includes(query)) continue;
			const trimmed = line.trimEnd();
			matches.push({ path: entry.path, lineNumber: index + 1, lineText: trimmed.length > MAX_SEARCH_CONTENT_LINE_LENGTH ? `${trimmed.slice(0, MAX_SEARCH_CONTENT_LINE_LENGTH - 1)}…` : trimmed });
			perFile += 1;
		}
		if (matches.length >= limit) break;
	}
	matches.sort((left, right) => left.path.localeCompare(right.path) || left.lineNumber - right.lineNumber);
	return { matches: matches.slice(0, limit), truncated: scanned.truncated || matches.length > limit || Date.now() > deadline };
}

async function browseFilesystem(input: RecordValue): Promise<{ parentPath: string; entries: Array<{ name: string; fullPath: string }> }> {
	const partialPath = requiredString(input.partialPath, "partialPath", 512);
	const cwd = input.cwd === undefined ? undefined : assertAbsolutePath(input.cwd, "cwd");
	let expanded = partialPath === "~" ? process.env.HOME ?? process.cwd() : partialPath.startsWith("~/") ? join(process.env.HOME ?? process.cwd(), partialPath.slice(2)) : partialPath;
	if (!isAbsolute(expanded)) {
		if (!cwd) throw new AgentFilesError("Relative filesystem browse paths require a current workspace.");
		expanded = resolve(cwd, expanded);
	}
	const endsWithSeparator = /[\\/]$/.test(partialPath) || partialPath === "~";
	const parentCandidate = endsWithSeparator ? expanded : dirname(expanded);
	const prefix = endsWithSeparator ? "" : basename(expanded);
	const parentPath = await realpath(parentCandidate);
	const dirents = await readdir(parentPath, { withFileTypes: true });
	const showHidden = endsWithSeparator || prefix.startsWith(".");
	const lowerPrefix = prefix.toLowerCase();
	const entries = dirents.filter((entry) => entry.isDirectory() && entry.name.toLowerCase().startsWith(lowerPrefix) && (showHidden || !entry.name.startsWith("."))).map((entry) => ({ name: entry.name, fullPath: join(parentPath, entry.name) })).sort((left, right) => left.name.localeCompare(right.name));
	return { parentPath, entries };
}

async function readFileContents(input: RecordValue): Promise<RecordValue> {
	const rootInfo = await canonicalWorkspace(input.cwd);
	const target = await resolveWorkspacePath(rootInfo, input.relativePath);
	const maxBytes = optionalPositiveInteger(input.maxBytes, "maxBytes", DEFAULT_READ_FILE_MAX_BYTES, DEFAULT_READ_FILE_MAX_BYTES);
	const handle = await open(target.real, "r");
	try {
		const fileStat = await handle.stat();
		if (!fileStat.isFile()) throw new AgentFilesError("Path is not a file.", "AGENT_FILES_PATH", { cwd: rootInfo.input, relativePath: target.requested });
		const readLength = Math.min(fileStat.size, maxBytes);
		const bytes = Buffer.alloc(readLength);
		const { bytesRead } = await handle.read(bytes, 0, readLength, 0);
		const loaded = bytes.subarray(0, bytesRead);
		if (fileStat.size > bytesRead) return { relativePath: target.requested, contents: loaded.toString("utf8"), truncated: true, version: null, encoding: null, lineEnding: null, symlink: target.symlink };
		if (loaded.includes(0)) throw new AgentFilesError("File appears to be binary.", "AGENT_FILES_BINARY", { cwd: rootInfo.input, relativePath: target.requested });
		const decoded = decodeText(loaded);
		return { relativePath: target.requested, contents: decoded.contents, truncated: false, version: hashBytes(loaded), encoding: decoded.encoding, lineEnding: decoded.lineEnding, symlink: target.symlink };
	} finally {
		await handle.close();
	}
}

async function writeFileContents(input: RecordValue): Promise<{ relativePath: string; version: string }> {
	const rootInfo = await canonicalWorkspace(input.cwd);
	const target = await resolveWorkspacePath(rootInfo, input.relativePath, { allowMissing: true });
	if (typeof input.contents !== "string" || input.contents.length > DEFAULT_READ_FILE_MAX_BYTES) throw new AgentFilesError("Invalid file contents.");
	const contents = input.contents;
	const expectedVersion = input.expectedVersion === undefined ? undefined : requiredString(input.expectedVersion, "expectedVersion", 128);
	const encoding = input.encoding === undefined ? undefined : input.encoding === "utf8" || input.encoding === "utf8-bom" ? input.encoding : (() => { throw new AgentFilesError("Unsupported file encoding."); })();
	const lineEnding = input.lineEnding === undefined ? undefined : ["lf", "crlf", "cr"].includes(String(input.lineEnding)) ? String(input.lineEnding) : (() => { throw new AgentFilesError("Unsupported line ending."); })();
	if (expectedVersion !== undefined && (!encoding || !lineEnding)) throw new AgentFilesError("Guarded text saves require encoding and line ending.", "AGENT_FILES_WRITE");
	const bytes = encodeText(contents, encoding, lineEnding);
	if (bytes.byteLength > DEFAULT_READ_FILE_MAX_BYTES) throw new AgentFilesError("The edited file is too large to save.", "AGENT_FILES_CAPACITY");
	let existing: Awaited<ReturnType<typeof lstat>> | null = null;
	try { existing = await lstat(target.absolute); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
	if (existing?.isSymbolicLink()) throw new AgentFilesError("Writing through a symbolic link is not allowed.", "AGENT_FILES_PATH", { cwd: rootInfo.input, relativePath: target.requested });
	if (existing && !existing.isFile()) throw new AgentFilesError("Path is not a regular file.", "AGENT_FILES_PATH", { cwd: rootInfo.input, relativePath: target.requested });
	if (expectedVersion !== undefined) {
		if (!existing) throw new AgentFilesError("This file was removed from disk after it was opened.", "WORKSPACE_FILE_DELETED", { cwd: rootInfo.input, relativePath: target.requested });
		const current = await readFile(target.absolute);
		if (hashBytes(current) !== expectedVersion) throw new AgentFilesError("This file changed on disk after it was opened. Reload it before saving.", "WORKSPACE_FILE_CONFLICT", { cwd: rootInfo.input, relativePath: target.requested });
	}
	const parent = dirname(target.absolute);
	const realParent = await existingRealPathWithinRoot(rootInfo.root, parent);
	if (realParent !== parent) throw new AgentFilesError("Workspace write parent escaped the workspace root.", "AGENT_FILES_PATH", { cwd: rootInfo.input, relativePath: target.requested });
	const temporary = join(parent, `.${basename(target.absolute)}.${process.pid}.${randomUUID()}.tmp`);
	try {
		await writeFile(temporary, bytes, { flag: "wx", mode: existing?.mode ?? 0o666 });
		if (existing) await chmod(temporary, existing.mode & 0o777);
		await access(temporary, fsConstants.W_OK);
		if (expectedVersion !== undefined) {
			const current = await readFile(target.absolute);
			if (hashBytes(current) !== expectedVersion) throw new AgentFilesError("This file changed on disk after it was opened. Reload it before saving.", "WORKSPACE_FILE_CONFLICT", { cwd: rootInfo.input, relativePath: target.requested });
		}
		await rename(temporary, target.absolute);
	} catch (error) {
		await unlink(temporary).catch(() => undefined);
		throw error;
	}
	return { relativePath: target.requested, version: hashBytes(bytes) };
}

function senderFromEvent(event: unknown): FileEventSender {
	if (!isRecord(event) || !isRecord(event.sender) || typeof event.sender.send !== "function") throw new AgentFilesError("File watcher requires a live Agent Window sender.");
	return event.sender as unknown as FileEventSender;
}

export function createAgentFilesService(): AgentFilesService {
	const subscriptions = new Map<string, WatchSubscription>();
	const previewGrants = new Map<string, LocalFilePreviewGrant>();
	const owners = new WeakSet<FileEventSender>();
	const cleanupSubscription = (id: string) => {
		const subscription = subscriptions.get(id);
		if (!subscription) return;
		subscriptions.delete(id);
		subscription.watcher.close();
	};
	const emit = (subscription: WatchSubscription, event: FileChangeEvent) => {
		if (subscription.sender.isDestroyed?.()) { cleanupSubscription(subscription.id); return; }
		try { subscription.sender.send(AGENT_FILES_EVENT_CHANNEL, { subscriptionId: subscription.id, event }); } catch { cleanupSubscription(subscription.id); }
	};
	const subscribe = async (event: unknown, input: RecordValue) => {
		const sender = senderFromEvent(event);
		if (!owners.has(sender)) {
			owners.add(sender);
			sender.once?.("destroyed", () => {
				for (const [id, subscription] of subscriptions) if (subscription.sender === sender) cleanupSubscription(id);
			});
		}
		const rootInfo = await canonicalWorkspace(input.cwd);
		const target = await resolveWorkspacePath(rootInfo, input.relativePath);
		const id = randomUUID();
		const watcher = watch(dirname(target.real), { persistent: false }, async (_event, filename) => {
			if (filename !== null && filename.toString() !== basename(target.real)) return;
			try {
				const info = await stat(target.real);
				if (!info.isFile()) return;
				emit({ id, watcher, relativePath: target.requested, cwd: rootInfo.input, sender }, { type: "changed", relativePath: target.requested, mtimeMs: info.mtimeMs });
			} catch { emit({ id, watcher, relativePath: target.requested, cwd: rootInfo.input, sender }, { type: "deleted", relativePath: target.requested }); cleanupSubscription(id); }
		});
		const subscription = { id, watcher, relativePath: target.requested, cwd: rootInfo.input, sender } satisfies WatchSubscription;
		subscriptions.set(id, subscription);
		watcher.on("error", () => cleanupSubscription(id));
		return { subscriptionId: id };
	};
	const createLocalFilePreviewGrant = async (rawInput: RecordValue) => {
		const resolved = await resolveLocalPreviewPath(rawInput);
		const grant = randomUUID();
		const expiresAt = Date.now() + LOCAL_PREVIEW_GRANT_TTL_MS;
		for (const [key, value] of previewGrants) {
			if (value.expiresAt <= Date.now()) previewGrants.delete(key);
		}
		while (previewGrants.size >= MAX_LOCAL_PREVIEW_GRANTS) {
			const oldest = previewGrants.keys().next().value;
			if (typeof oldest !== "string") break;
			previewGrants.delete(oldest);
		}
		previewGrants.set(grant, { path: resolved.real, expiresAt });
		return { grant, expiresAt: new Date(expiresAt).toISOString() };
	};
	const readLocalFilePreview = async (rawInput: RecordValue) => {
		const grant = requiredString(rawInput.grant, "grant", 256);
		const issued = previewGrants.get(grant);
		if (!issued || issued.expiresAt <= Date.now()) {
			previewGrants.delete(grant);
			throw new AgentFilesError("The image preview grant has expired.", "AGENT_FILES_PREVIEW_GRANT");
		}
		const resolved = await resolveLocalPreviewPath(rawInput);
		if (resolved.real !== issued.path) throw new AgentFilesError("The image preview grant does not match this file.", "AGENT_FILES_PREVIEW_GRANT");
		const handle = await open(resolved.real, "r");
		let bytes: Buffer;
		try {
			const info = await handle.stat();
			if (!info.isFile()) throw new AgentFilesError("Image preview path is not a regular file.", "AGENT_FILES_PREVIEW_PATH");
			if (info.size > MAX_LOCAL_PREVIEW_BYTES) throw new AgentFilesError("Image preview is too large to load.", "AGENT_FILES_PREVIEW_CAPACITY");
			bytes = Buffer.alloc(info.size);
			const result = await handle.read(bytes, 0, bytes.length, 0);
			bytes = bytes.subarray(0, result.bytesRead);
		} finally {
			await handle.close();
		}
		return { path: resolved.real, mimeType: resolved.mimeType, dataBase64: bytes.toString("base64"), version: hashBytes(bytes) };
	};
	return {
		handle: async (event, method, rawInput) => {
			const input = isRecord(rawInput) ? rawInput : {};
			switch (method) {
				case "projects.listDirectories": return listDirectories(input);
				case "projects.searchEntries": return searchEntries(input);
				case "projects.searchLocalEntries": return searchLocalEntries(input);
				case "projects.searchContent": return searchContent(input);
				case "projects.readFile": return readFileContents(input);
				case "projects.createLocalFilePreviewGrant": return createLocalFilePreviewGrant(input);
				case "projects.readLocalFilePreview": return readLocalFilePreview(input);
				case "projects.writeFile": {
					// Item 63d: workspace writes go through OMP turns and the guarded
					// editor bridge only. The bundle's direct file-write surface
					// (plan downloads, task toggles, editor saves) has no guard to
					// check against here, so it stays unavailable until a guarded
					// path exists for it — never a silent write.
					throw new AgentFilesError("Workspace writes are applied through OMP turns and the guarded editor bridge.", "AGENT_FILES_WRITE_GUARD");
				}
				case "filesystem.browse": return browseFilesystem(input);
				case "projects.subscribeFileChange": return subscribe(event, input);
				case "projects.unsubscribeFileChange": {
					const id = requiredString(input.subscriptionId, "subscriptionId", 128);
					if (subscriptions.get(id)?.sender !== senderFromEvent(event)) return undefined;
					cleanupSubscription(id);
					return undefined;
				}
				default: throw new AgentFilesError(`Unsupported Agent files method: ${method}`);
			}
		},
		dispose: () => { for (const id of [...subscriptions.keys()]) cleanupSubscription(id); previewGrants.clear(); },
	};
}
