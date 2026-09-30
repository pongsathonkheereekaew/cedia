import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createCediaNativeApi } from "../src/cedia-adapter.ts";

/**
 * Acceptance fixtures for the slash commands the dated audit marks reachable over the RPC
 * surface (§8.2 O05/O06).
 *
 * Two halves make a slash command available in Cedia. The runtime half is measured by
 * `scripts/omp-slash-smoke.ts`: with the virtual terminal negotiated - which is what the Cedia
 * host does before a session accepts a prompt - a builtin command and its subcommands answer
 * with `agentInvoked: false` and no model call. This file covers the Cedia half: the composer's
 * text reaches the session exactly as typed, so `/security scan` stays a command and is never
 * rewritten into prose.
 */

const audit = JSON.parse(
	readFileSync(join(import.meta.dir, "../../../../docs/maintenance/evidence/omp-complete-scope-2026-09-23/config-cli.json"), "utf8"),
) as {
	slashCommands: { name: string; aliases?: string[]; subcommands?: (string | { name?: string })[]; surfaces?: string[]; tuiOnly?: boolean }[];
};

const reachable = audit.slashCommands.filter(row => row.tuiOnly !== true && (row.surfaces ?? []).some(surface => surface === "rpc" || surface === "acp"));
const subcommandOf = (row: (typeof audit.slashCommands)[number]): string | undefined => {
	const sub = (row.subcommands ?? [])[0];
	const name = typeof sub === "string" ? sub : sub?.name;
	return name === undefined ? undefined : `/${row.name} ${name}`;
};

const SESSION = {
	id: "session-slash",
	projectId: "project-1",
	title: "Slash turn",
	cwd: "/workspace/demo",
	sessionFile: "/state/session-slash.json",
	incarnation: "inc-1",
	status: "idle" as const,
	archived: false,
	createdAt: "2026-09-24T10:00:00.000Z",
	updatedAt: "2026-09-24T10:01:00.000Z",
};

interface RecordedRequest {
	method: string;
	path: string;
	body?: unknown;
}

function fakeBridge() {
	const calls: RecordedRequest[] = [];
	const host = { ...SESSION, status: "running" };
	const bridge = {
		invoke: async (_channel: string, request: RecordedRequest) => {
			const requestKind = (request as RecordedRequest & { kind?: string }).kind;
			if (requestKind !== "uiDraft") calls.push(request);
			if (request.path === `/v1/sessions/${SESSION.id}`) return host;
			if (request.path === `/v1/models`) return { source: "omp", models: [] };
			if (request.path.endsWith("/commands") && request.method === "POST") {
				const body = request.body as { commandId: string; command: string; payload?: unknown };
				return { sessionId: SESSION.id, commandId: body.commandId, incarnation: host.incarnation, kind: body.command, payload: body.payload ?? null, status: "acknowledged" };
			}
			throw new Error(`Unexpected ${request.method} ${request.path}`);
		},
	};
	return { bridge, calls };
}

function promptMessages(calls: readonly RecordedRequest[]): string[] {
	return calls
		.filter(call => call.path.endsWith("/commands") && (call.body as { command?: string })?.command === "prompt")
		.map(call => String((call.body as { payload?: { message?: unknown } }).payload?.message));
}

async function sendTurn(text: string): Promise<string[]> {
	const { bridge, calls } = fakeBridge();
	const api = createCediaNativeApi({ bridge });
	await api.orchestration.dispatchCommand({
		type: "thread.turn.start",
		commandId: `cmd-slash-${text.replace(/[^a-z0-9]+/gi, "-")}`,
		threadId: SESSION.id,
		message: { messageId: "msg-slash-1", role: "user", text },
	});
	return promptMessages(calls);
}

async function sendSelectedTurn(text: string, selectedCommand: string | undefined): Promise<RecordedRequest[]> {
	const { bridge, calls } = fakeBridge();
	const api = createCediaNativeApi({ bridge });
	await api.orchestration.dispatchCommand({
		type: "thread.turn.start",
		commandId: `cmd-selected-${text.replace(/[^a-z0-9]+/gi, "-")}`,
		threadId: SESSION.id,
		message: { messageId: "msg-selected-1", role: "user", text },
		...(selectedCommand === undefined ? {} : { cediaSelectedSlashCommand: selectedCommand }),
	});
	return calls;
}

describe("Cedia slash dispatch", () => {
	it("keeps the audit's reachable set non-empty and recognisably split from the TUI-only one", () => {
		expect(reachable.length).toBeGreaterThan(30);
		const tuiOnly = audit.slashCommands.filter(row => row.tuiOnly === true);
		// The split is upstream's own metadata; the gate reads the same fields.
		expect(tuiOnly.length).toBeGreaterThan(30);
		expect(tuiOnly.some(row => row.name === "settings")).toBe(true);
		expect(reachable.some(row => row.name === "security")).toBe(true);
	});

	it("sends a slash command, its subcommand and an alias to the session exactly as typed", async () => {
		const withSubcommand = reachable.find(row => subcommandOf(row) !== undefined);
		const withAlias = reachable.find(row => (row.aliases ?? []).length > 0);
		const cases = [
			`/${reachable[0]!.name}`,
			...(([withSubcommand, withAlias].filter(Boolean) as (typeof reachable)[number][]).flatMap(row => {
				const sub = subcommandOf(row);
				const alias = row.aliases?.[0];
				return [sub, alias === undefined ? undefined : `/${alias}`].filter((value): value is string => value !== undefined);
			})),
		];
		expect(cases.length).toBeGreaterThan(2);

		for (const text of cases) {
			// No rewrite, no shell escaping, no trimming of the subcommand: the runtime parses the
			// leading slash itself, so what leaves Cedia has to be what the owner typed.
			expect(await sendTurn(text)).toEqual([text]);
		}
	});

	it("sends a slash command with trailing arguments unchanged too", async () => {
		expect(await sendTurn("/security scan --path /tmp/fixture")).toEqual(["/security scan --path /tmp/fixture"]);
		expect(await sendTurn("/model anthropic/claude")).toEqual(["/model anthropic/claude"]);
	});

	 it("marks only menu-selected commands and leaves ordinary slash-like prompt text unmarked", async () => {
		const selected = await sendSelectedTurn("/fixture arg", "fixture");
		const selectedPrompt = selected.find(call => call.path.endsWith("/commands"));
		expect((selectedPrompt?.body as { payload?: Record<string, unknown> }).payload?.cediaSelectedSlashCommand).toBe("fixture");

		const literal = await sendTurn("/literal text prompt");
		 expect(literal).toEqual(["/literal text prompt"]);
	 });

	it("refuses to downgrade a selected command to steer or follow-up text", async () => {
		for (const dispatchMode of ["steer", "queue"] as const) {
			const { bridge, calls } = fakeBridge();
			const api = createCediaNativeApi({ bridge });
			await expect(api.orchestration.dispatchCommand({
				type: "thread.turn.start",
				commandId: `cmd-selected-${dispatchMode}`,
				threadId: SESSION.id,
				message: { messageId: `msg-selected-${dispatchMode}`, role: "user", text: "/fixture arg" },
				cediaSelectedSlashCommand: "fixture",
				dispatchMode,
			})).rejects.toThrow(/selected slash command cannot be dispatched while this turn is running/i);
			expect(calls.filter(call => call.path.endsWith("/commands"))).toEqual([]);
		}
	});
});
