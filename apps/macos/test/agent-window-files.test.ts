import { describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, readFile, realpath, symlink, writeFile, rm, truncate } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createAgentFilesService } from "../src/agent-window-files.ts";
import { createNativeFilesApi } from "../agent-window/src/native-files.ts";

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "cedia-files-"));
	await mkdir(join(root, "src"));
	await writeFile(join(root, "src", "hello.ts"), "const hello = true;\n", "utf8");
	await writeFile(join(root, "README.md"), "# Cedia\r\n", "utf8");
	return root;
}

describe("Cedia Agent files service", () => {
	it("serves an allowlisted image through an exact-path capability grant", async () => {
		const root = await fixture();
		const imagePath = join(root, "preview.png");
		const otherImagePath = join(root, "other.png");
		const service = createAgentFilesService();
		try {
			const png = Buffer.from("89504e470d0a1a0a", "hex");
			await writeFile(imagePath, png);
			await writeFile(otherImagePath, png);
			const grant = await service.handle({}, "projects.createLocalFilePreviewGrant", { path: imagePath, cwd: root }) as {
				grant: string;
				expiresAt: string;
			};
			expect(grant.grant).toMatch(/^[0-9a-f-]{36}$/);
			expect(Date.parse(grant.expiresAt)).toBeGreaterThan(Date.now());
			const loaded = await service.handle({}, "projects.readLocalFilePreview", {
				path: imagePath,
				cwd: root,
				grant: grant.grant,
			}) as { path: string; mimeType: string; dataBase64: string; version: string };
			expect(loaded.path).toBe(await realpath(imagePath));
			expect(loaded.mimeType).toBe("image/png");
			expect(loaded.dataBase64).toBe(png.toString("base64"));
			expect(loaded.version).toMatch(/^sha256:[0-9a-f]{64}$/);
			await expect(service.handle({}, "projects.readLocalFilePreview", {
				path: otherImagePath,
				cwd: root,
				grant: grant.grant,
			})).rejects.toMatchObject({ code: "AGENT_FILES_PREVIEW_GRANT" });
			await expect(service.handle({}, "projects.createLocalFilePreviewGrant", {
				path: join(root, "README.md"),
				cwd: root,
			})).rejects.toMatchObject({ code: "AGENT_FILES_PREVIEW_TYPE" });
		} finally {
			service.dispose();
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects preview files outside the workspace and over the binary size cap", async () => {
		const root = await fixture();
		const service = createAgentFilesService();
		const outside = await mkdtemp(join(tmpdir(), "cedia-files-preview-outside-"));
		try {
			const outsideImage = join(outside, "secret.png");
			await writeFile(outsideImage, Buffer.from("png"));
			await expect(service.handle({}, "projects.createLocalFilePreviewGrant", { path: outsideImage, cwd: root })).rejects.toMatchObject({ code: "AGENT_FILES_PREVIEW_PATH" });
			await symlink(outsideImage, join(root, "escaped.png"));
			await expect(service.handle({}, "projects.createLocalFilePreviewGrant", { path: join(root, "escaped.png"), cwd: root })).rejects.toMatchObject({ code: "AGENT_FILES_PREVIEW_PATH" });
			const largeImage = join(root, "large.png");
			await writeFile(largeImage, Buffer.alloc(1));
			await truncate(largeImage, 8 * 1024 * 1024 + 1);
			await expect(service.handle({}, "projects.createLocalFilePreviewGrant", { path: largeImage, cwd: root })).rejects.toMatchObject({ code: "AGENT_FILES_PREVIEW_CAPACITY" });
		} finally {
			service.dispose();
			await rm(root, { recursive: true, force: true });
			await rm(outside, { recursive: true, force: true });
		}
	});

	it("lists the workspace tree and reads normalized text with a byte version", async () => {
		const root = await fixture();
		const service = createAgentFilesService();
		try {
			await expect(service.handle({}, "projects.listDirectories", { cwd: root, includeFiles: true })).resolves.toEqual({
				entries: [
					{ path: "src", name: "src", kind: "directory", hasChildren: true },
					{ path: "README.md", name: "README.md", kind: "file" },
				],
			});
			const loaded = await service.handle({}, "projects.readFile", { cwd: root, relativePath: "README.md" }) as {
				contents: string;
				version: string;
				lineEnding: string;
			};
			expect(loaded.contents).toBe("# Cedia\n");
			expect(loaded.version).toMatch(/^sha256:[0-9a-f]{64}$/);
			expect(loaded.lineEnding).toBe("crlf");
		} finally {
			service.dispose();
			await rm(root, { recursive: true, force: true });
		}
	});

	it("refuses direct workspace writes: OMP turns and the guarded editor bridge own them (item 63d)", async () => {
		const root = await fixture();
		const service = createAgentFilesService();
		try {
			// Reads still work; only the write path is restricted.
			const loaded = await service.handle({}, "projects.readFile", { cwd: root, relativePath: "src/hello.ts" }) as { version: string };
			expect(loaded.version).toMatch(/^sha256:[0-9a-f]{64}$/);
			await expect(service.handle({}, "projects.writeFile", {
				cwd: root,
				relativePath: "src/hello.ts",
				contents: "const hello = false;\n",
				expectedVersion: loaded.version,
				encoding: "utf8",
				lineEnding: "lf",
			})).rejects.toMatchObject({ code: "AGENT_FILES_WRITE_GUARD" });
			// The file is untouched: no silent write happened.
			expect(await readFile(join(root, "src", "hello.ts"), "utf8")).toBe("const hello = true;\n");
		} finally {
			service.dispose();
			await rm(root, { recursive: true, force: true });
		}
	});

	it("saves empty files and keeps watching after atomic replacement", async () => {
		const root = await fixture();
		const service = createAgentFilesService();
		const events: unknown[] = [];
		try {
			await service.handle({ sender: { send: (_channel: string, event: unknown) => events.push(event) } }, "projects.subscribeFileChange", { cwd: root, relativePath: "README.md" });
			await writeFile(join(root, "README.md"), "");
			expect(await readFile(join(root, "README.md"), "utf8")).toBe("");
			await new Promise(resolve => setTimeout(resolve, 80));
			events.length = 0;
			await writeFile(join(root, "README.md"), "external edit");
			for (let attempt = 0; attempt < 20 && events.length === 0; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
			expect(events.length).toBeGreaterThan(0);
		} finally { service.dispose(); await rm(root, { recursive: true, force: true }); }
	});

	it("searches text while skipping oversized workspace artifacts", async () => {
		const root = await fixture();
		const service = createAgentFilesService();
		try {
			await writeFile(join(root, "large.txt"), "hello oversized artifact");
			await truncate(join(root, "large.txt"), 2 * 1024 * 1024);
			const result = await service.handle({}, "projects.searchContent", { cwd: root, query: "hello" }) as { matches: { path: string }[] };
			expect(result.matches.map(match => match.path)).toEqual(["src/hello.ts"]);
		} finally { service.dispose(); await rm(root, { recursive: true, force: true }); }
	});

	it("rejects relative escapes and symlinks that resolve outside the workspace", async () => {
		const root = await fixture();
		const outside = await mkdtemp(join(tmpdir(), "cedia-files-outside-"));
		const service = createAgentFilesService();
		try {
			await writeFile(join(outside, "secret.txt"), "secret", "utf8");
			await symlink(join(outside, "secret.txt"), join(root, "secret.txt"));
			await expect(service.handle({}, "projects.readFile", { cwd: root, relativePath: "../secret.txt" })).rejects.toThrow();
			await expect(service.handle({}, "projects.readFile", { cwd: root, relativePath: "secret.txt" })).rejects.toThrow();
			await expect(service.handle({}, "projects.writeFile", {
				cwd: root,
				relativePath: "secret.txt",
				contents: "overwrite",
			})).rejects.toMatchObject({ code: "AGENT_FILES_WRITE_GUARD" });
		} finally {
			service.dispose();
			await rm(root, { recursive: true, force: true });
			await rm(outside, { recursive: true, force: true });
		}
	});

	it("projects the file methods through the renderer bridge and unsubscribes watchers", async () => {
		const calls: Array<{ channel: string; input: unknown }> = [];
		const listeners = new Map<string, (event: unknown, ...args: unknown[]) => void>();
		const bridge = {
			invoke: async (channel: string, input: unknown) => {
				calls.push({ channel, input });
				if (typeof input === "object" && input !== null && (input as { method?: string }).method === "projects.subscribeFileChange") {
					return { subscriptionId: "watch-1" };
				}
				return { entries: [] };
			},
			on: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => {
				listeners.set(channel, listener);
			},
		};
		const api = createNativeFilesApi(bridge);
		await expect(api.projects.listDirectories({ cwd: "/tmp", includeFiles: true })).resolves.toEqual({ entries: [] });
		const received: unknown[] = [];
		const unsubscribe = api.projects.onFileChange!({ cwd: "/tmp", relativePath: "a.txt" }, event => received.push(event));
		await new Promise(resolve => setTimeout(resolve, 0));
		listeners.get("vscode:cediaAgentFiles")?.({}, { subscriptionId: "watch-1", event: { type: "changed", relativePath: "a.txt", mtimeMs: 1 } });
		await new Promise(resolve => setTimeout(resolve, 0));
		expect(received).toEqual([{ type: "changed", relativePath: "a.txt", mtimeMs: 1 }]);
		unsubscribe();
		expect(calls.some(call => (call.input as { method?: string }).method === "projects.unsubscribeFileChange")).toBe(true);
	});
});
