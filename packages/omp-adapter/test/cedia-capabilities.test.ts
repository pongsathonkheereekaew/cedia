import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OmpRpcClient } from "../src/client.ts";
import type { RpcCediaCapabilitiesData, RpcCediaControlData } from "../src/types.ts";

/**
 * The capability contract only exists in Cedia's pinned OMP patch, so this runs
 * against the prepared runtime. Skipped when the runtime has not been built.
 */
const prepared = process.env.CEDIA_OMP_BINARY ?? join(import.meta.dir, "../../../dist/omp/omp");
const available = existsSync(prepared);

/** A throwaway agent directory: the runtime must never read the user's real config here. */
function isolatedEnv(): { env: NodeJS.ProcessEnv; dispose: () => void } {
	const dir = mkdtempSync(join(tmpdir(), "cedia-capability-test-"));
	writeFileSync(
		join(dir, "models.yml"),
		`providers:
  cedia-capability-fixture:
    baseUrl: http://127.0.0.1:9/v1
    auth: none
    api: openai-completions
    models:
      - id: cedia-capability-fixture-model
        name: Cedia capability fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`,
		{ mode: 0o600 },
	);
	return {
		env: { ...process.env, HOME: dir, PI_CODING_AGENT_DIR: dir, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
		dispose: () => rmSync(dir, { recursive: true, force: true }),
	};
}

const start = (env: NodeJS.ProcessEnv) =>
	OmpRpcClient.start({
		executable: prepared,
		cwd: join(import.meta.dir, "../../.."),
		args: ["--no-title"],
		env,
		readyTimeoutMs: 60_000,
		requestTimeoutMs: 60_000,
	});

/** Run one control call and answer its failure, or undefined when it succeeded. */
async function controlFailure(client: OmpRpcClient, request: Record<string, unknown>): Promise<{ code?: string; message: string } | undefined> {
	try {
		await client.requestCedia("cedia_control", request);
		return undefined;
	} catch (error) {
		const failure = error as { code?: string; message?: string };
		return { ...(failure.code === undefined ? {} : { code: failure.code }), message: failure.message ?? String(error) };
	}
}

describe.skipIf(!available)("Cedia capability bridge on the prepared runtime", () => {
	it("advertises the capability bridge in its ready frame", async () => {
		const isolated = isolatedEnv();
		const client = await start(isolated.env);
		try {
			expect(client.readyFrame?.cediaCapabilitiesVersion).toBe(1);
			expect(client.capabilitiesAdvertised()).toBe(true);
		} finally {
			await client.close();
			isolated.dispose();
		}
	}, 60_000);

	it("answers a table where every available row is really runnable and every gap has a reason", async () => {
		const isolated = isolatedEnv();
		const client = await start(isolated.env);
		try {
			const table = (await client.requestCedia("cedia_get_capabilities", {})).data as RpcCediaCapabilitiesData;
			expect(table.bridgeVersion).toBe(1);
			expect(table.schemaVersion).toBe(1);
			expect(table.capabilityRevision.length).toBeGreaterThan(0);
			expect(table.ompRevision.startsWith("omp/")).toBe(true);

			const availableIds = table.capabilities.filter(row => row.state === "available").map(row => row.id);
			expect(availableIds).toEqual([
				"advisor.config.get",
				"advisor.config.set",
				"advisor.get",
				"advisor.history",
				"advisor.set",
				"agents.config.list",
				"agents.config.set",
				"agents.get",
				"agents.kill",
				"agents.revive",
				"auth.account.pin",
				"auth.accounts.list",
				"auth.api-key.set",
				"auth.logout",
				"auth.providers.list",
				"btw.ask",
				"btw.branch",
				"btw.state.get",
				"capabilities.get",
				"cleanse.abort",
				"cleanse.run",
				"cleanse.state.get",
				"context.abort-compaction",
				"context.drop-images",
				"context.get",
				"context.reset",
				"context.shake",
				"credits.get",
				"credits.redeem",
				"extensions.list",
				"extensions.set",
				"goal.get",
				"goal.set",
				"history.state",
				"history.transcript",
				"loop.set",
				"loop.state.get",
				"memory.apply",
				"memory.get",
				"model.pending",
				"model.roles.apply",
				"model.roles.get",
				"model.roles.set",
				"model.service-tier.set",
				"model.state.get",
				"omfg.abort",
				"omfg.draft",
				"omfg.save",
				"omfg.state.get",
				"pause.get",
				"pause.set",
				"plan.get",
				"plan.review",
				"plan.set",
				"policy.get",
				"prewalk.state.get",
				"progress.get",
				"python.abort",
				"python.exec",
				"queue.drop",
				"queue.get",
				"session.fresh",
				"settings.get",
				"settings.keys.describe",
				"settings.keys.list",
				"settings.mutate",
				"settings.reset.preview",
				"settings.set",
				"settings.unset",
				"tools.active.set",
				"tools.catalog.get",
				"tools.codemode.get",
				"tools.refresh-skills",
				"tree.get",
				"tree.navigate",
				"turn.queue.get",
				"usage.get",
			]);
			for (const row of table.capabilities) {
				expect(row.ompRevision).toBe(table.ompRevision);
				expect(row.surfaces.length).toBeGreaterThan(0);
				if (row.state === "available") expect(row.reason).toBeUndefined();
				else expect(String(row.reason ?? "").length).toBeGreaterThan(0);
			}

			// Every row the table calls available really runs, which is the invariant the
			// plan states as "advertised operation without handler fails coverage". An operation
			// that needs a field gets its smallest valid one; the rest take none.
			const sample: Record<string, Record<string, unknown>> = {
				"settings.get": { path: "cycleOrder" },
				"settings.set": { path: "cycleOrder", value: [] },
				// Unset and mutate probes name an unconfigured key, so they reach the
				// handler and answer without staging anything in the fixture profile.
				"settings.unset": { path: "cycleOrder" },
				"settings.mutate": { context: { scope: "global" }, changes: [{ path: "cycleOrder", operation: "unset" }] },
				"settings.reset.preview": { paths: ["cycleOrder"] },
				// Goal mode is this session's own state, so the probe names the smallest operation
				// that exists without one: `pause` reaches the runtime and answers about real state.
				"goal.set": { op: "pause" },
				"plan.review": { reviewId: 1, decision: "approve" },
				"plan.set": { op: "vibe.enter" },
				// The advisor switch needs the flag it switches; the session starts with the advisor
				// off, so this is the smallest valid probe that still reaches the handler.
				"advisor.set": { enabled: false },
				// The config read names the level it reads; the write carries schema-valid
				// roster text, which the isolated agent directory accepts without touching
				// any other probe in this run.
				"advisor.config.get": { scope: "project" },
				"advisor.config.set": { scope: "project", text: "advisors: []\n" },
				// A drop names which end of the queue it takes; `last` is the dequeue keybinding's
				// own single-item removal, so the probe reaches the handler with a real mode.
				"queue.drop": { mode: "last" },
				// The pause write names the gate position it takes; engaging it here is safe
				// because no later probe in this run needs the agent loop to advance.
				"pause.set": { paused: true },
				// The kernel probe runs the smallest real snippet; the isolated agent
				// directory keeps it from touching anything else in this run.
				"python.exec": { code: "print(1)" },
				// The context-reduction control names which of the runtime's own strategies runs;
				// `elide` is the one that shrugs off whole tool results, which is reachable on an
				// empty fixture session and honestly reports zeroes.
				"context.shake": { mode: "elide" },
				// The redeem probe names an account this runtime does not store: the payload rule is what
				// is under test, and a target that cannot resolve must not spend anything.
				"credits.redeem": { confirm: true, email: "probe@example.invalid" },
				// The owner-only writes need their smallest valid payloads. The provider id is one
				// OMP has no endpoint configured for, so a key is stored and removed in this isolated
				// agent directory without a provider request leaving the machine.
				"model.roles.set": { role: "default", modelId: null },
				"auth.api-key.set": { providerId: "cedia-probe-unknown-provider", apiKey: "probe-key" },
				"auth.logout": { providerId: "cedia-probe-unknown-provider" },
				"auth.account.pin": { credentialId: 1 },
				"model.pending": { revision: 1 },
				"model.service-tier.set": { family: "openai", tier: null },
				// The lifecycle probes name an agent the isolated session never
				// registered, so the runtime's own unknown-id refusal answers.
				"agents.kill": { id: "ghost-agent" },
				"agents.revive": { id: "ghost-agent" },
				// The config probe names an agent the isolated session never
				// discovered, so the runtime's own unknown-agent refusal answers.
				"agents.config.set": { agent: "ghost-agent", enabled: false },
				// The side-question probe names a question; the isolated session has no
				// model, so the handler's own gate answers instead of starting a turn.
				"btw.ask": { question: "capability probe" },
				// The extension toggle names an id the isolated session never
				// registered, so the runtime's own refusal answers instead of a write.
				"extensions.set": { id: "mcp:missing", enabled: false },
				"tree.navigate": { entryId: "fixture-entry" },
				// The activation write names the smallest stable selection: the native read tool
				// this fixture session always registers. Later probes in this run need no tools.
				"tools.active.set": { toolNames: ["read"] },
			};
			// A session-scoped operation with nothing to act on answers the runtime's own refusal
			// rather than a validation one; that still proves a handler ran.
			const statefulRefusals = new Set([
				"No active goal to pause.",
				"Entry fixture-entry not found",
				"No active model available for a side question.",
				"Cannot branch the side question: no answered side question",
				"omfg.save needs a scope",
				"omfg.draft needs a complaint",
				"model.roles.apply needs a role",
				"Unknown extension: mcp:missing",
				"Unknown agent: ghost-agent",
			]);
			for (const id of availableIds) {
				const payload = sample[id];
				let result: RpcCediaControlData;
				try {
					result = (await client.requestCedia("cedia_control", {
						operation: id,
						...(payload === undefined ? {} : { payload }),
					})).data as RpcCediaControlData;
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					if (statefulRefusals.has(message) || id === "plan.review") continue;
					throw error;
				}
				expect(result.operation).toBe(id);
				expect(result.capabilityRevision).toBe(table.capabilityRevision);
				expect(result.result).not.toBeUndefined();
			}
		} finally {
			await client.close();
			isolated.dispose();
		}
	}, 60_000);

	it("runs a registered read and answers the runtime's own projection", async () => {
		const isolated = isolatedEnv();
		const client = await start(isolated.env);
		try {
			const direct = (await client.requestCedia("cedia_get_model_roles", {})).data;
			const controlled = (await client.requestCedia("cedia_control", { operation: "model.roles.get" })).data as RpcCediaControlData;
			// The controlled path must be the same projection, not a second one.
			expect(controlled.result).toEqual(direct);
		} finally {
			await client.close();
			isolated.dispose();
		}
	}, 60_000);

	it("lists the settings the runtime defines, matching the audited inventory exactly", async () => {
		const isolated = isolatedEnv();
		const client = await start(isolated.env);
		try {
			const inventory = (await client.requestCedia("cedia_control", { operation: "settings.keys.list" })).data as RpcCediaControlData;
			const inventoryResult = inventory.result as { keys: { path: string; type: string; credential: boolean; projectWritable: boolean; values?: string[]; apply?: string }[]; settingsRevision: string };
			const keys = inventoryResult.keys;
			expect(inventoryResult.settingsRevision.length).toBeGreaterThan(0);
			// The dated audit extracted every SETTINGS_SCHEMA path from the same pinned revision.
			// Comparing live against it is what turns "the inventory exists" into "the inventory
			// classifies every audited key", and it fails loudly if either side drifts.
			const audited = JSON.parse(
				readFileSync(join(import.meta.dir, "../../../docs/maintenance/evidence/omp-complete-scope-2026-10-02/config-cli.json"), "utf8"),
			) as { settings: { path: string }[] };
			const live = keys.map(key => key.path).sort();
			const auditedPaths = audited.settings.map(row => row.path).sort();
			expect(live.length).toBe(auditedPaths.length);
			expect(live).toEqual(auditedPaths);
			expect(keys.filter(key => key.projectWritable).map(key => key.path)).toEqual(["modelRoles"]);
			// An enum path's allowed values come from the schema that validates the write, so the
			// control can offer them instead of asking the owner to guess a string. This is the
			// live runtime answering, not a Cedia copy of the schema.
			const enums = keys.filter(key => key.type === "enum");
			expect(enums.length).toBeGreaterThan(0);
			expect(enums.filter(key => (key.values?.length ?? 0) > 0).map(key => key.path)).toContain("power.sleepPrevention");
			for (const key of keys) {
				if (key.type !== "enum") expect(key.values).toBeUndefined();
				if (key.values !== undefined) expect(new Set(key.values).size).toBe(key.values.length);
			}
			// When a change takes effect (O04). Every schema path is classified now: the runtime
			// derives it from where its own sources read the key, and `immediate` remains exactly the
			// keys with a declared hook. A path with no reader at all is not left blank either - the
			// registry maps it explicitly, so a control never renders "unknown timing".
			const vocabulary = new Set(["immediate", "turn_boundary", "reload", "new_session"]);
			const untimed = keys.filter(key => key.apply === undefined);
			expect(untimed.map(key => key.path)).toEqual([]);
			for (const key of keys) expect(vocabulary.has(String(key.apply))).toBe(true);
			const byPath = new Map(keys.map(key => [key.path, key.apply]));
			expect(byPath.get("theme.dark")).toBe("immediate");
			expect(byPath.get("colorBlindMode")).toBe("immediate");
			// The hook table is the definition of "immediate", so a filter and a hook cannot drift.
			const immediate = keys.filter(key => key.apply === "immediate").map(key => key.path).sort();
			expect(immediate.length).toBe(21);
			expect(immediate).toContain("colorBlindMode");
		} finally {
			await client.close();
			isolated.dispose();
		}
	}, 60_000);

	it("reads one settings value, redacts a credential, and refuses an unknown key", async () => {
		const isolated = isolatedEnv();
		const client = await start(isolated.env);
		try {
			const roleStorage = (await client.requestCedia("cedia_control", { operation: "settings.get", payload: { path: "modelRoleStorage" } })).data as RpcCediaControlData;
			const read = roleStorage.result as { path: string; value: unknown; configured: boolean; redacted: boolean };
			expect(read.path).toBe("modelRoleStorage");
			expect(read.redacted).toBe(false);
			expect(typeof read.configured).toBe("boolean");
			expect(typeof (read as { settingsRevision?: string }).settingsRevision).toBe("string");
			expect(read.value).not.toBeUndefined();

			const unknown = await controlFailure(client, { operation: "settings.get", payload: { path: "not.a.setting" } });
			expect(unknown?.code).toBe("cedia_control_invalid_payload");
			expect(unknown?.message).toContain("not a setting");
		} finally {
			await client.close();
			isolated.dispose();
		}
	}, 60_000);

	it("redacts a credential path and never returns its value", async () => {
		const isolated = isolatedEnv();
		const client = await start(isolated.env);
		try {
			// The audit marks eight schema paths as credentials; the runtime must answer their
			// state and never their secret, exactly as native config listing does.
			const result = (await client.requestCedia("cedia_control", {
				operation: "settings.get",
				payload: { path: "auth.broker.token" },
			})).data as RpcCediaControlData;
			const read = result.result as Record<string, unknown>;
			expect(read.path).toBe("auth.broker.token");
			expect(read.credential).toBe(true);
			expect(read.redacted).toBe(true);
			expect(Object.hasOwn(read, "value")).toBe(false);
		} finally {
			await client.close();
			isolated.dispose();
		}
	}, 60_000);

	it("reads back a value the native CLI wrote, across a restart", async () => {
		const isolated = isolatedEnv();
		const read = async (client: OmpRpcClient) =>
			((await client.requestCedia("cedia_control", { operation: "settings.get", payload: { path: "cycleOrder" } })).data as RpcCediaControlData)
				.result as { value: unknown; configured: boolean; redacted: boolean };

		let client = await start(isolated.env);
		try {
			// Fresh profile: nothing has written this key, so the schema default is in effect and
			// the runtime says so instead of pretending a value was configured.
			const fresh = await read(client);
			expect(fresh.configured).toBe(false);
		} finally {
			await client.close();
		}

		// The edit happens through OMP's own config CLI, which is the surface the plan requires
		// the effective readback to survive.
		execFileSync(prepared, ["config", "set", "cycleOrder", '["default","smol"]'], { env: isolated.env, stdio: "pipe" });

		client = await start(isolated.env);
		try {
			const edited = await read(client);
			expect(edited.configured).toBe(true);
			expect(edited.value).toEqual(["default", "smol"]);
		} finally {
			await client.close();
		}

		// A second process in the same agent directory still reports the edited value.
		client = await start(isolated.env);
		try {
			const restarted = await read(client);
			expect(restarted.configured).toBe(true);
			expect(restarted.value).toEqual(["default", "smol"]);
		} finally {
			await client.close();
			isolated.dispose();
		}
	}, 60_000);

	it("writes one settings value, reads it back, and refuses a moved revision", async () => {
		const isolated = isolatedEnv();
		const client = await start(isolated.env);
		const control = async (operation: string, payload?: Record<string, unknown>) =>
			(await client.requestCedia("cedia_control", { operation, ...(payload === undefined ? {} : { payload }) })).data as RpcCediaControlData;
		const revision = async () =>
			((await control("settings.get", { path: "modelRoleStorage" })).result as { settingsRevision: string }).settingsRevision;
		try {
			const before = await revision();

			// The write goes through OMP's own setter, so the answer describes a value that is
			// already on disk and carries the new revision.
			const written = (await control("settings.set", { path: "cycleOrder", value: ["default"], expectedRevision: before }))
				.result as { value: unknown; settingsRevision: string; configured: boolean };
			expect(written.value).toEqual(["default"]);
			expect(written.configured).toBe(true);
			expect(written.settingsRevision).not.toBe(before);

			// The same write with the revision it already applied is now stale, which is what keeps
			// two windows from overwriting each other.
			const stale = await controlFailure(client, {
				operation: "settings.set",
				payload: { path: "cycleOrder", value: ["smol"], expectedRevision: before },
			});
			expect(stale?.code).toBe("cedia_control_stale_settings_revision");

			// A value the schema does not accept never reaches the setter.
			const wrongType = await controlFailure(client, {
				operation: "settings.set",
				payload: { path: "cycleOrder", value: "default" },
			});
			expect(wrongType?.code).toBe("cedia_control_invalid_payload");
			expect(wrongType?.message).toContain("takes an array");

			// A fresh process in the same agent directory reads the written value back.
			await client.close();
			const restarted = await start(isolated.env);
			try {
				const read = (await (await restarted.requestCedia("cedia_control", { operation: "settings.get", payload: { path: "cycleOrder" } })).data as RpcCediaControlData)
					.result as { value: unknown; configured: boolean };
				expect(read.configured).toBe(true);
				expect(read.value).toEqual(["default"]);
			} finally {
				await restarted.close();
			}
		} finally {
			await client.close();
			isolated.dispose();
		}
	}, 60_000);

	it("refuses an unknown operation by name, without running anything", async () => {
		const isolated = isolatedEnv();
		const client = await start(isolated.env);
		try {
			const failure = await controlFailure(client, { operation: "not.a.registered.operation" });
			expect(failure?.code).toBe("cedia_control_unknown_operation");

			// A name the runtime never registered is refused as unknown rather than run; this
			// generation has nothing declared-but-unregistered left (the four owner-only writes that
			// used to sit there are registered and probed above).
			const table = (await client.requestCedia("cedia_get_capabilities", {})).data as { capabilities: { state: string }[] };
			expect(table.capabilities.some(row => row.state === "integration_missing")).toBe(false);
		} finally {
			await client.close();
			isolated.dispose();
		}
	}, 60_000);

	it("refuses a payload that could name code, and a stale revision", async () => {
		const isolated = isolatedEnv();
		const client = await start(isolated.env);
		try {
			const withFields = await controlFailure(client, { operation: "model.roles.get", payload: { js: "return 1" } });
			expect(withFields?.code).toBe("cedia_control_invalid_payload");
			expect(withFields?.message).toContain("js");

			const stale = await controlFailure(client, {
				operation: "turn.queue.get",
				capabilityRevision: "00000000000000000000000000000000",
			});
			expect(stale?.code).toBe("cedia_control_stale_capability_revision");

			// The current revision is accepted, so the refusal above really is about staleness.
			const table = (await client.requestCedia("cedia_get_capabilities", {})).data as RpcCediaCapabilitiesData;
			const current = (await client.requestCedia("cedia_control", {
				operation: "turn.queue.get",
				capabilityRevision: table.capabilityRevision,
			})).data as RpcCediaControlData;
			expect(current.operation).toBe("turn.queue.get");
		} finally {
			await client.close();
			isolated.dispose();
		}
	}, 60_000);
});
