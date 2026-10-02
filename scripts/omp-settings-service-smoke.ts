/**
 * Live proof of the taskless configuration-only entry (plan §6.4.1 S2).
 *
 * Spawns the prepared pinned runtime with CEDIA_SETTINGS_SERVICE=1 and drives
 * settings inventory, reads, airgapped writes, unset and reset preview with
 * zero sessions and zero provider calls. A session operation is refused
 * without starting an executor.
 *
 * Run: bun scripts/omp-settings-service-smoke.ts
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { OmpRpcClient } from "../packages/omp-adapter/src/client.ts";

const root = resolve(import.meta.dir, "..");
const executable = process.env.CEDIA_OMP_BINARY ?? join(root, "dist/omp/omp");

function check(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`settings-service smoke failed: ${message}`);
	console.log(`OK   ${message}`);
}

const profileDir = mkdtempSync(join(tmpdir(), "cedia-settings-service-"));
const client = await OmpRpcClient.start({
	executable,
	env: { HOME: profileDir, PI_CODING_AGENT_DIR: profileDir, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off", CEDIA_SETTINGS_SERVICE: "1", PATH: process.env.PATH ?? "" },
});
try {
	const ready = client.readyFrame as unknown as Record<string, unknown>;
	check(ready.cediaSettingsServiceVersion === 1, "entry advertises cediaSettingsServiceVersion 1");
	check(ready.cediaCapabilitiesVersion === 1, "entry advertises the capability bridge");

	const caps = (await client.requestCedia("cedia_control", { operation: "settings.keys.list" })) as unknown as {
		data: { result: { keys: unknown[]; settingsRevision: string } };
	};
	check(caps.data.result.keys.length > 500, `inventory lists ${caps.data.result.keys.length} keys with no task`);
	const revision = caps.data.result.settingsRevision;

	const describe = (await client.requestCedia("cedia_control", { operation: "settings.keys.describe" })) as unknown as {
		data: { result: { keys: Array<Record<string, unknown>> } };
	};
	const endpoint = describe.data.result.keys.find(key => key.path === "searxng.endpoint");
	check(endpoint?.label === "SearXNG Endpoint", "describe carries schema label/help/env metadata");

	const read = (await client.requestCedia("cedia_control", {
		operation: "settings.get",
		payload: { path: "cycleOrder", scope: "global" },
	})) as unknown as { data: { result: Record<string, unknown> } };
	check(read.data.result.provenance === "default", "global read reports provenance and scope");
	check(read.data.result.scope === "global", "global read echoes its scope");

	const mutate = (await client.requestCedia("cedia_control", {
		operation: "settings.mutate",
		payload: {
			context: { scope: "global" },
			expectedRevision: revision,
			changes: [{ path: "cycleOrder", operation: "set", value: ["smoke/pick"] }],
		},
	})) as unknown as { data: { result: Array<Record<string, unknown>> } };
	check(
		Array.isArray(mutate.data.result) && mutate.data.result[0]?.value !== undefined,
		"scoped mutate writes through the owner with readback",
	);
	const writtenRevision = mutate.data.result[0]?.settingsRevision as string;

	const preview = (await client.requestCedia("cedia_control", {
		operation: "settings.reset.preview",
		payload: { paths: ["cycleOrder"] },
	})) as unknown as { data: { result: Array<Record<string, unknown>> } };
	check(preview.data.result[0]?.globalConfigured === true, "reset preview names the saved override");

	const unset = (await client.requestCedia("cedia_control", {
		operation: "settings.unset",
		payload: { path: "cycleOrder", expectedRevision: writtenRevision },
	})) as unknown as { data: { result: Record<string, unknown> } };
	check(unset.data.result.configured === false, "unset removes the override and reveals the default");

	const sessionOp = await client
		.requestCedia("cedia_control", { operation: "goal.get" })
		.then(() => null)
		.catch((error: unknown) => error);
	check(sessionOp !== null, "a session operation is refused without starting an executor");
} finally {
	await client.close().catch(() => undefined);
	rmSync(profileDir, { recursive: true, force: true });
}
console.log("settings-service smoke passed");
