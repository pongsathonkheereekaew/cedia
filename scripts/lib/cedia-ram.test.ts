import { describe, expect, it } from "bun:test";
import { classifyCediaProcess, parsePsLine, summarizeRam } from "./cedia-ram.ts";

describe("cedia ram classifier", () => {
	it("buckets each Cedia.app process role from its command line", () => {
		expect(classifyCediaProcess("/Users/pond/cedia/VSCode-darwin-arm64/Cedia.app/Contents/MacOS/Cedia --password-store=basic")).toBe("main");
		expect(
			classifyCediaProcess(
				"/Users/pond/cedia/VSCode-darwin-arm64/Cedia.app/Contents/Frameworks/Cedia Helper.app/Contents/MacOS/Cedia Helper --type=gpu-process --user-data-dir=/Users/pond/Library/Application Support/Cedia",
			),
		).toBe("gpu");
		expect(
			classifyCediaProcess(
				"/Users/pond/cedia/VSCode-darwin-arm64/Cedia.app/Contents/Frameworks/Cedia Helper (Renderer).app/Contents/MacOS/Cedia Helper (Renderer) --type=renderer --vscode-window-config=vscode:93fa17d7",
			),
		).toBe("renderer");
		expect(
			classifyCediaProcess(
				"/Users/pond/cedia/VSCode-darwin-arm64/Cedia.app/Contents/Frameworks/Cedia Helper (Plugin).app/Contents/MacOS/Cedia Helper (Plugin) --type=utility --utility-sub-type=node.mojom.NodeService",
			),
		).toBe("extension-host");
		expect(
			classifyCediaProcess(
				"/Users/pond/cedia/VSCode-darwin-arm64/Cedia.app/Contents/Frameworks/Cedia Helper (Plugin).app/Contents/MacOS/Cedia Helper (Plugin) /Users/pond/cedia/VSCode-darwin-arm64/Cedia.app/Contents/Resources/app/extensions/json-language-features/server/dist/node/jsonServerMain --node-ipc",
			),
		).toBe("language-server");
		expect(
			classifyCediaProcess(
				"/Users/pond/cedia/VSCode-darwin-arm64/Cedia.app/Contents/Resources/app/extensions/cedia/runtime/node/bin/node /Users/pond/cedia/VSCode-darwin-arm64/Cedia.app/Contents/Resources/app/extensions/cedia/runtime/host/cli.js serve",
			),
		).toBe("host");
		expect(
			classifyCediaProcess(
				"/Users/pond/cedia/VSCode-darwin-arm64/Cedia.app/Contents/Resources/app/extensions/cedia/runtime/omp/omp --mode rpc-ui --no-session --cwd /Users/pond/cedia",
			),
		).toBe("omp");
	});

	it("parses ps output lines and summarizes megabytes per bucket", () => {
		const a = parsePsLine("  48189 151824 /Users/pond/cedia/VSCode-darwin-arm64/Cedia.app/Contents/MacOS/Cedia --password-store=basic");
		const bad = parsePsLine("not a ps line");
		expect(a).toMatchObject({ pid: 48189, rssKb: 151824 });
		expect(bad).toBeUndefined();
		if (!a) throw new Error("fixture failed to parse");
		const summary = summarizeRam([
			{ ...a, bucket: "main" },
			{ pid: 2, rssKb: 1024, command: "x", bucket: "main" },
		]);
		expect(summary.count).toBe(2);
		expect(summary.totalMb).toBe(Math.round(152848 / 1024));
		expect(summary.byBucket.main.count).toBe(2);
		expect(summary.byBucket.omp.count).toBe(0);
	});
});
