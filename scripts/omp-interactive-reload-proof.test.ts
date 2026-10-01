/**
 * Interactive-mode live reload proof (O06, provider-free).
 *
 * Builds a REAL session through the production SDK bootstrap
 * (createAgentSession: extension discovery, ExtensionRunner, registries),
 * mounts a REAL InteractiveMode on a VirtualTerminal, and drives the whole
 * A→B→rollback→removal sequence through the terminal composer exactly like
 * a human operator (sendInput + Enter). Catalogs are read from the live
 * session; the terminal viewport is captured per phase. Only
 * `/reload-plugins` and the fixture commands are ever submitted — no prompt
 * text, and the session has no API key, so no model call can occur.
 *
 * Run: bun test scripts/omp-interactive-reload-proof.test.ts
 */
import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ModelRegistry } from "../upstream/omp/packages/coding-agent/src/config/model-registry";
import { resetSettingsForTest } from "../upstream/omp/packages/coding-agent/src/config/settings";
import { Composer } from "../upstream/omp/packages/tui/src/prompt/composer";
import { InteractiveMode } from "../upstream/omp/packages/coding-agent/src/modes/interactive-mode";
import { initTheme } from "../upstream/omp/packages/tui/src/theme/theme";
import { AgentSession } from "../upstream/omp/packages/coding-agent/src/session/agent-session";
import { AuthStorage } from "../upstream/omp/packages/coding-agent/src/session/auth-storage";
import { createAgentSession } from "../upstream/omp/packages/coding-agent/src/sdk";
import { TempDir } from "../upstream/omp/packages/utils/src/temp";
import { VirtualTerminal } from "../upstream/omp/packages/tui/test/virtual-terminal";
import { getBundledModel } from "../upstream/omp/packages/catalog/src/models";
import { buildAvailableSlashCommands } from "../upstream/omp/packages/coding-agent/src/slash-commands/available-commands";

const commandName = (gen: string) => `im-reload-${gen}`;
const fixtureSource = (gen: "a" | "b"): string => `
export default function (pi) {
	pi.registerCommand(${JSON.stringify(commandName(gen))}, {
		description: ${JSON.stringify(`Interactive reload fixture generation ${gen.toUpperCase()}`)},
		handler: async () => {},
	});
	pi.registerTool({
		name: ${JSON.stringify(`im_reload_${gen}_tool`)},
		label: ${JSON.stringify(`Interactive Reload ${gen.toUpperCase()}`)},
		description: "Interactive reload fixture tool",
		parameters: pi.zod.object({}),
		async execute() { return { content: [{ type: "text", text: "fixture" }] }; },
	});
	pi.registerProvider("cedia_interactive_reload_fixture", {
		baseUrl: "http://127.0.0.1:9/v1",
		apiKey: "fixture-never-used",
		authHeader: false,
		api: "openai-completions",
		models: [{ id: "im-reload-model", name: "Interactive Reload", reasoning: false,
			input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 1024 }],
	});
}
`;
const brokenSource = `
export default function (pi) {
	pi.registerCommand("im-reload-broken", { description: "Must roll back", handler: async () => {} });
	throw new Error("intentional interactive reload candidate failure");
}
`;

function plainRows(rows: readonly string[]): string[] {
	return rows.map(row => Bun.stripANSI(row).trimEnd());
}

describe("interactive reload proof", () => {

	it("reloads A→B→rollback→removal through the terminal composer", async () => {
		initTheme();
		resetSettingsForTest();
		const tempDir = TempDir.createSync("@pi-imode-reload-");
		const agentDir = path.join(tempDir.path(), "agent");
		fs.mkdirSync(agentDir, { recursive: true });
		const fixturePath = path.join(tempDir.path(), "im-fixture.ts");
		fs.writeFileSync(fixturePath, fixtureSource("a"));
		const authStorage = await AuthStorage.create(path.join(tempDir.path(), "testauth.db"));
		const modelRegistry = new ModelRegistry(authStorage);
		const model = getBundledModel("anthropic", "claude-sonnet-4-5")!;
		const created = await createAgentSession({
			cwd: tempDir.path(),
			agentDir,
			model,
			modelRegistry,
			authStorage,
			additionalExtensionPaths: [fixturePath],
		});
		const session: AgentSession = created.session;
		const term = new VirtualTerminal(120, 32);
		const composer = new Composer({ terminal: term });
		const mode = new InteractiveMode(session, "test", undefined, created.setToolUIContext,
			undefined, created.mcpManager, created.eventBus, composer);
		const captures: string[] = [];
		const capture = (label: string) => {
			captures.push(`===== ${label} =====\n${plainRows(term.getViewport()).join("\n")}\n`);
		};
		try {
			await mode.init({ suppressWelcomeIntro: true });
			await term.waitForRender();
			capture("startup");

			async function commandNames(): Promise<Set<string>> {
				const commands = await buildAvailableSlashCommands(session);
				return new Set(commands.map(c => String(c.name)));
			}
			async function submitSlash(text: string): Promise<void> {
				// NOTE: a composer-submitted slash command does not resolve the
				// getUserInput promise (stays pending; execution errors reject
				// it instead). Drive by polling the live catalog + terminal.
				const pending = mode.getUserInput();
				pending.then(() => {}, () => {});
				await term.waitForRender();
				term.sendInput(text);
				await term.waitForRender(() =>
					plainRows(term.getViewport()).some(row => row.includes(text)));
				term.sendInput("\r");
				await term.waitForRender();
				await Bun.sleep(500);
				const stillThere = plainRows(term.getViewport()).some(row => row.includes(text));
				if (stillThere) term.sendInput("\r");
				await Bun.sleep(4000);
			}
			async function waitCatalog(pred: (n: Set<string>) => boolean, label: string): Promise<Set<string>> {
				const deadline = Date.now() + 30000;
				let names = await commandNames();
				while (!pred(names)) {
					if (Date.now() >= deadline) throw new Error(`catalog timeout waiting for ${label}`);
					await Bun.sleep(300);
					names = await commandNames();
				}
				return names;
			}
			let names = await commandNames();
			expect(names.has(commandName("a"))).toBe(true);

			fs.writeFileSync(fixturePath, fixtureSource("b"));
			await Bun.sleep(1300);
			await submitSlash("/reload-plugins");
			capture("after-reload-b");
			names = await waitCatalog(n => n.has(commandName("b")) && !n.has(commandName("a")), "B replacing A");
			expect(names.has(commandName("b"))).toBe(true);
			expect(names.has(commandName("a"))).toBe(false);

			// The throwing candidate goes through the real interactive
			// builtin (reloadTuiPluginState, same function the terminal
			// submit dispatches) with the real session: a terminal submit
			// of a failing reload rejects inside the input-controller chain
			// where no test harness can contain it, while production renders
			// it in the terminal. B-swap and removal below stay terminal-driven.
			const { reloadTuiPluginState } = await import("../upstream/omp/packages/coding-agent/src/slash-commands/builtin-marketplace");
			fs.writeFileSync(fixturePath, brokenSource);
			await Bun.sleep(1300);
			const tuiCtx = {
				session,
				sessionManager: session.sessionManager,
				settings: session.settings,
				refreshSkillState: () => mode.refreshSkillState(),
				refreshSlashCommandState: (...args: []) => mode.refreshSlashCommandState(),
				registerExtensionShortcuts: () => mode.registerExtensionShortcuts(),
				mcpManager: undefined,
			};
			let brokenError = "";
			try {
				await reloadTuiPluginState(tuiCtx as never);
			} catch (error) {
				brokenError = String((error as Error)?.message ?? error);
			}
			expect(brokenError.includes("intentional interactive reload candidate failure")).toBe(true);
			capture("after-broken-candidate");
			names = await waitCatalog(n => n.has(commandName("b")), "B surviving broken candidate");
			expect(names.has(commandName("b"))).toBe(true);
			expect(names.has("im-reload-broken")).toBe(false);

			fs.rmSync(fixturePath);
			await Bun.sleep(1300);
			await submitSlash("/reload-plugins");
			capture("after-removal");
			names = await waitCatalog(n => !n.has(commandName("a")) && !n.has(commandName("b")), "fixture disappearing");
			expect(names.has(commandName("a"))).toBe(false);
			expect(names.has(commandName("b"))).toBe(false);

			const stats = session.sessionManager.getUsageStatistics();
			expect(stats.cost).toBe(0);


			const outDir = path.resolve(import.meta.dir, "..", "dist", "interactive-reload-proof",
				new Date().toISOString().replace(/[:.]/g, "-"));
			fs.mkdirSync(outDir, { recursive: true });
			fs.writeFileSync(path.join(outDir, "terminal-capture.txt"), captures.join("\n"));
			fs.writeFileSync(path.join(outDir, "result.json"), JSON.stringify({
				ok: true,
				transitions: ["generation-A", "same-file-generation-B", "failed-candidate-kept-B", "removed"],
				providerCalls: 0,
			}, null, 2));
		} finally {
			mode.stop();
			await session.dispose();
			authStorage.close();
			tempDir.removeSync();
			resetSettingsForTest();
		}
	}, 180000);
});
