import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installVscodeStub } from "./helpers/vscode-stub.ts";

// The extension imports `vscode`; install the shared stub first (process-wide mock).
installVscodeStub();

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "src");
const apiSource = readFileSync(join(src, "provider-api.ts"), "utf8");
const extensionSource = readFileSync(join(src, "extension.ts"), "utf8");

/** Method names the API interface promises (its `name(...)` lines). */
function promisedMethods(): string[] {
	const body = apiSource.slice(apiSource.indexOf("export interface CediaTaskViewProviderMethods {"));
	const end = body.indexOf("\n}");
	return [...body.slice(0, end).matchAll(/^\t([a-zA-Z_]\w*)\(/gm)].map(match => match[1]!);
}

describe("provider concern registry", () => {
	it("promises a non-trivial surface, so the extraction cannot silently pass", () => {
		expect(promisedMethods().length).toBeGreaterThan(140);
	});

	it("installs every promised method on the prototype", async () => {
		const extension: any = await import("../src/extension.ts");
		const prototype = extension.CediaTaskViewProvider.prototype;
		const missing = promisedMethods().filter(name => typeof prototype[name] !== "function");
		expect(missing).toEqual([]);
	});

	it("keeps every concern's methods inside one slice file", () => {
		// Each provider-*.ts exports exactly one concern object; a method that lived in
		// the wrong slice would still install, so pin the file boundary too.
		const slices = ["host", "omp", "projects", "editor", "review", "chrome"];
		for (const slice of slices) {
			const text = readFileSync(join(src, `provider-${slice}.ts`), "utf8");
			expect(text).toContain(`export const ${slice}Concern: Partial<CediaTaskViewProviderApi> = {`);
		}
		const registry = readFileSync(join(src, "provider-registry.ts"), "utf8");
		for (const slice of slices) expect(registry).toContain(`${slice}Concern`);
	});

	it("keeps the wiring root under the item's budget", () => {
		expect(extensionSource.split("\n").length).toBeLessThanOrEqual(800);
		// The class body is the constructor only: methods live in the slices.
		const classBody = extensionSource.slice(extensionSource.indexOf("export class CediaTaskViewProvider"));
		expect(classBody).toContain("constructor(context: vscode.ExtensionContext)");
		expect(classBody).not.toMatch(/\n\t\tasync \w+\(/);
	});
});
