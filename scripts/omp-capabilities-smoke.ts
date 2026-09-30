/**
 * Live proof of Cedia's O04 capability contract (plan §8.2, item 70).
 *
 * Starts a real Cedia host against the prepared pinned runtime, opens one
 * session so a runtime is live, and reads the capability table twice: through
 * the host owner (`ompCapabilitySnapshot`) and through the owner-only
 * `/v1/capabilities` route. The fixture provider points at a local endpoint that
 * is never contacted, so no provider request leaves the machine - the session is
 * started and negotiated, never prompted.
 *
 * Run: bun scripts/omp-capabilities-smoke.ts
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startHostServer } from "../apps/host/src/server.ts";

const root = resolve(import.meta.dir, "..");
const executable = process.env.CEDIA_OMP_BINARY ?? join(root, "dist/omp/omp");

function check(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`OMP capability smoke failed: ${message}`);
	console.log(`OK   ${message}`);
}

const stateDir = mkdtempSync(join(tmpdir(), "cedia-omp-capabilities-"));
const profileDir = mkdtempSync(join(tmpdir(), "cedia-omp-capabilities-profile-"));
const workDir = mkdtempSync(join(tmpdir(), "cedia-omp-capabilities-work-"));
// A provider whose endpoint never answers: nothing in this run may reach a model.
writeFileSync(
	join(profileDir, "models.yml"),
	`providers:
  cedia-capability-fixture:
    baseUrl: http://127.0.0.1:9/v1
    auth: none
    api: openai-completions
    models:
      - id: cedia-capability-fixture-model
        name: Cedia capability smoke fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`,
	{ mode: 0o600 },
);

const started = await startHostServer({
	stateDir,
	port: 0,
	ompExecutable: executable,
	ompEnv: { HOME: profileDir, PI_CODING_AGENT_DIR: profileDir, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
});

try {
	// Before a runtime exists the answer is absence with a reason, never an empty table.
	const before = await started.host.ompCapabilitySnapshot();
	check(before.state === "unavailable" && before.reason.length > 0, "a host with no live runtime reports absence with a reason");

	const project = started.host.store.createProject({ path: workDir, name: "Capability smoke" });
	const session = started.host.createSession(project.id, "Capability smoke");
	await started.host.startSession(session.id);

	const live = await started.host.ompCapabilitySnapshot();
	check(live.state === "available", "a live session runtime answers the capability table");
	if (live.state !== "available") throw new Error("unreachable");
	const table = live.snapshot;
	check(table.ompRevision.startsWith("omp/"), `the table names the runtime revision (${table.ompRevision})`);
	check(/^[0-9a-f]{32}$/.test(table.capabilityRevision), `the table carries a revision (${table.capabilityRevision})`);

	const availableIds = table.capabilities.filter(row => row.state === "available").map(row => row.id);
	check(
		availableIds.join(",") ===
			"advisor.config.get,advisor.config.set,advisor.get,advisor.history,advisor.set,agents.config.list,agents.config.set,agents.get,agents.kill,agents.revive,auth.account.pin,auth.accounts.list,auth.api-key.set,auth.logout,auth.providers.list,btw.ask,btw.branch,btw.state.get,capabilities.get,cleanse.abort,cleanse.run,cleanse.state.get,context.abort-compaction,context.drop-images,context.get,context.reset,context.shake,credits.get,credits.redeem,extensions.list,extensions.set,goal.get,goal.set,history.state,history.transcript,loop.set,loop.state.get,memory.apply,memory.get,model.pending,model.roles.apply,model.roles.get,model.roles.set,model.service-tier.set,model.state.get,omfg.abort,omfg.draft,omfg.save,omfg.state.get,pause.get,pause.set,plan.get,plan.review,plan.set,policy.get,prewalk.state.get,progress.get,python.abort,python.exec,queue.drop,queue.get,session.fresh,settings.get,settings.keys.list,settings.set,tools.active.set,tools.catalog.get,tools.codemode.get,tools.refresh-skills,tree.get,tree.navigate,turn.queue.get,usage.get",
		`every available row is a registered operation (${availableIds.join(", ")})`,
	);
	// This generation registers everything it advertises, so the declared seam may be empty; a row
	// that is declared must still carry the reason it cannot run.
	const declared = table.capabilities.filter(row => row.state === "integration_missing");
	check(
		declared.every(row => typeof row.reason === "string" && row.reason.length > 0),
		`every declared-but-unregistered operation carries a reason (${declared.length} rows)`,
	);

	const route = await started.router({ method: "GET", path: "/v1/capabilities", token: started.auth.ownerToken });
	check(route.status === 200, "the owner-only capability route answers");
	const body = route.body as {
		omp?: { state?: string; capabilityRevision?: string; ompRevision?: string };
		capabilities?: { id: string; availability: string }[];
	};
	check(body.omp?.state === "available", "the route reports the runtime as available");
	check(body.omp?.capabilityRevision === table.capabilityRevision, "the route reports the same revision the runtime answered");
	const routeRows = new Map((body.capabilities ?? []).map(row => [row.id, row.availability]));
	for (const id of availableIds)
		check(routeRows.get(id) === "available", `the route carries the runtime row ${id}`);
	// The pre-existing aggregate rows survive beside the runtime rows, and they describe this
	// process: the settings bridge exists and is on screen, so a host with a live runtime reports
	// it as available rather than as an unimplemented capability.
	check(
		routeRows.get("omp.settings") === "available",
		`the pre-existing aggregate rows survive beside the runtime rows (${routeRows.get("omp.settings")})`,
	);
	check(
		routeRows.get("remote.tailscale") === "dependency_unavailable",
		"a host started without a packaged web client reports the remote path as needing the client",
	);

	// A caller that names the revision it already saw is answered only while that is still the
	// live table: a table that moved is a typed conflict, not a silent refresh.
	const matching = await started.router({
		method: "GET",
		path: `/v1/capabilities?expectRevision=${table.capabilityRevision}`,
		token: started.auth.ownerToken,
	});
	check(matching.status === 200, "the route answers when the caller names the live revision");

	// The settings half reads OMP's own schema and one effective value; a credential path is
	// answered redacted, so the secret never crosses this route.
	const inventory = await started.router({ method: "GET", path: "/v1/omp/settings/keys", token: started.auth.ownerToken });
	check(
		inventory.status === 200 && (inventory.body as { state?: string }).state === "available",
		"the settings inventory route answers from the live runtime",
	);
	const listed = (inventory.body as {
		keys?: { path: string; credential: boolean; projectWritable: boolean; apply?: string }[];
	}).keys ?? [];
	check(listed.length > 400, `the inventory carries the runtime's own schema (${listed.length} keys)`);
	const applyCounts = { immediate: 0, turn_boundary: 0, reload: 0, new_session: 0 };
	let allApplyTimingsValid = true;
	for (const key of listed) {
		if (key.apply === undefined || !Object.hasOwn(applyCounts, key.apply)) {
			allApplyTimingsValid = false;
			continue;
		}
		applyCounts[key.apply as keyof typeof applyCounts]++;
	}
	check(allApplyTimingsValid, "every live settings key carries one of OMP's four apply timings");
	check(
		listed.length === 498 && applyCounts.immediate === 13 && applyCounts.turn_boundary === 416 &&
			applyCounts.new_session === 39 && applyCounts.reload === 30,
		`the live timing distribution matches the pinned source audit (${JSON.stringify(applyCounts)})`,
	);
	check(
		listed.filter(key => key.projectWritable).map(key => key.path).join(",") === "modelRoles",
		"only modelRoles is project-writable",
	);
	check(listed.some(key => key.credential), `the inventory marks credential paths (${listed.filter(key => key.credential).length})`);

	// Goal mode is OMP's own session state, driven through the registered operations: the owner
	// sets an objective, reads it back, pauses and resumes it, and the runtime's own refusals come
	// through unchanged. The model endpoint is dead, so the turn the objective starts fails fast
	// and no provider is contacted.
	// The session's incarnation moved when it started, so the command names the one it is on now.
	const liveIncarnation = started.host.store.getSession(session.id)!.incarnation;
	const goalBefore = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/goal`, token: started.auth.ownerToken });
	check((goalBefore.body as { goal?: unknown }).goal === null, "a task with no goal answers an empty goal, not a guess");
	const setGoal = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/goal`,
		token: started.auth.ownerToken,
		body: { commandId: "capability-goal-1", incarnation: liveIncarnation, op: "set", objective: "Prove the goal bridge", tokenBudget: 50_000 },
	});
	type GoalAnswer = { status?: string; result?: { data?: { goal?: { objective?: string; status?: string; tokenBudget?: number }; startedTurn?: boolean } } };
	const setBody = setGoal.body as GoalAnswer;
	const setGoalSnapshot = setBody.result?.data;
	check(setGoal.status === 200 && setBody.status === "completed", `the goal route accepts a set (${JSON.stringify(setBody).slice(0, 160)})`);
	check(setGoalSnapshot?.goal?.objective === "Prove the goal bridge", "the answer carries the objective the runtime holds");
	check(setGoalSnapshot?.goal?.tokenBudget === 50_000, "the answer carries the budget the runtime holds");
	// `set` is the operation that dispatches the objective as a turn, so it says so; the operations
	// that only change state do not pretend to have started anything.
	check(setGoalSnapshot?.startedTurn === true, "a set reports that it started the pursuit turn");
	const budgetGoal = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/goal`,
		token: started.auth.ownerToken,
		body: { commandId: "capability-goal-budget", incarnation: liveIncarnation, op: "budget", tokenBudget: 75_000 },
	});
	check(
		(budgetGoal.body as GoalAnswer).result?.data?.goal?.tokenBudget === 75_000,
		"the budget route changes and returns the runtime's own token budget",
	);
	// Idempotency: the same command id answers the same record rather than creating a second goal.
	const repeated = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/goal`,
		token: started.auth.ownerToken,
		body: { commandId: "capability-goal-1", incarnation: liveIncarnation, op: "set", objective: "Prove the goal bridge", tokenBudget: 50_000 },
	});
	check(JSON.stringify(repeated.body) === JSON.stringify(setGoal.body), "a repeated command id answers the same result");
	const paused = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/goal`,
		token: started.auth.ownerToken,
		body: { commandId: "capability-goal-2", incarnation: liveIncarnation, op: "pause" },
	});
	check((paused.body as GoalAnswer).result?.data?.goal?.status === "paused", "pause moves the runtime's own goal to paused");
	check((paused.body as GoalAnswer).result?.data?.startedTurn === undefined, "pause does not claim to have started a turn");
	const readGoal = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/goal`, token: started.auth.ownerToken });
	check((readGoal.body as { goal?: { status?: string } }).goal?.status === "paused", "the read answers the paused state the runtime holds");
	const resumed = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/goal`,
		token: started.auth.ownerToken,
		body: { commandId: "capability-goal-3", incarnation: liveIncarnation, op: "resume" },
	});
	check((resumed.body as GoalAnswer).result?.data?.goal?.status === "active", "resume returns the goal to active");

	// The subagent table is read from the runtime's own answer, so a task that has run no
	// subagent reports an empty list rather than an unavailable one.
	const subagents = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/subagents`, token: started.auth.ownerToken });
	const subagentBody = subagents.body as { state?: string; subagents?: unknown[] };
	check(
		subagents.status === 200 && subagentBody.state === "available" && Array.isArray(subagentBody.subagents) && subagentBody.subagents.length === 0,
		`the subagent route answers the runtime's own live set (${JSON.stringify(subagentBody).slice(0, 120)})`,
	);

	const readback = await started.router({
		method: "GET",
		path: "/v1/omp/settings/value?path=modelRoleStorage",
		token: started.auth.ownerToken,
	});
	check(readback.status === 200, "the settings value route answers for a defined key");

	const credentialPath = listed.find(key => key.credential)!.path;
	const credential = await started.router({
		method: "GET",
		path: `/v1/omp/settings/value?path=${encodeURIComponent(credentialPath)}`,
		token: started.auth.ownerToken,
	});
	check(
		(credential.body as { redacted?: boolean }).redacted === true && !Object.hasOwn(credential.body as object, "value"),
		`a credential path is answered redacted (${credentialPath})`,
	);

	const unknownKey = await started.router({
		method: "GET",
		path: "/v1/omp/settings/value?path=not.a.setting",
		token: started.auth.ownerToken,
	});
	check(
		unknownKey.status === 404 && (unknownKey.body as { error?: { code?: string } }).error?.code === "omp_settings_unknown_path",
		"a settings key the runtime does not define is a typed 404",
	);

	// The write path: Cedia's policy decides which keys are writable, the runtime validates the
	// value and checks the revision. The profile is an isolated temporary directory, so writing
	// here cannot touch the operator's real configuration.
	const revision = (inventory.body as { settingsRevision?: string }).settingsRevision ?? "";
	check(revision.length > 0, "the inventory carries the settings revision a write names");
	// Pick a key whose schema type the fixture value matches: an array-typed setting is written
	// with an array, so the check exercises the write path rather than the validator.
	const editable = listed.find(
		key => !key.credential && (key as { disposition?: string }).disposition === "editable" && (key as { type?: string }).type === "array",
	);
	check(
		editable !== undefined,
		`the inventory marks writable array-typed keys (${listed.filter(key => !key.credential && (key as { disposition?: string }).disposition === "editable" && (key as { type?: string }).type === "array").length})`,
	);

	const written = await started.router({
		method: "PATCH",
		path: "/v1/omp/settings",
		token: started.auth.ownerToken,
		body: { path: editable!.path, value: ["default"], expectedRevision: revision },
	});
	check(written.status === 200, `the owner can write an editable setting (${editable!.path})`);
	const writtenRevision = (written.body as { settingsRevision?: string }).settingsRevision ?? "";
	check(writtenRevision.length > 0 && writtenRevision !== revision, "the write reports the revision it produced");

	const staleWrite = await started.router({
		method: "PATCH",
		path: "/v1/omp/settings",
		token: started.auth.ownerToken,
		body: { path: editable!.path, value: ["smol"], expectedRevision: revision },
	});
	check(
		staleWrite.status === 409 && (staleWrite.body as { error?: { code?: string } }).error?.code === "omp_settings_stale_revision",
		"a write that names the revision it already applied is a typed 409",
	);

	const protectedWrite = await started.router({
		method: "PATCH",
		path: "/v1/omp/settings",
		token: started.auth.ownerToken,
		body: { path: credentialPath, value: "anything" },
	});
	check(
		protectedWrite.status === 403 && (protectedWrite.body as { error?: { code?: string } }).error?.code === "omp_settings_not_editable",
		`a credential path is refused by Cedia's policy (${credentialPath})`,
	);

	const badValue = await started.router({
		method: "PATCH",
		path: "/v1/omp/settings",
		token: started.auth.ownerToken,
		body: { path: editable!.path, value: "default" },
	});
	check(
		badValue.status === 400 && (badValue.body as { error?: { code?: string } }).error?.code === "omp_settings_rejected",
		"a value the runtime's schema rejects is a typed 400",
	);

	const readBack = await started.router({
		method: "GET",
		path: `/v1/omp/settings/value?path=${encodeURIComponent(editable!.path)}`,
		token: started.auth.ownerToken,
	});
	check(
		JSON.stringify((readBack.body as { value?: unknown }).value) === JSON.stringify(["default"]),
		"the written value reads back",
	);

	const stale = await started.router({
		method: "GET",
		path: "/v1/capabilities?expectRevision=00000000000000000000000000000000",
		token: started.auth.ownerToken,
	});
	const staleBody = stale.body as { error?: { code?: string; message?: string } };
	check(
		stale.status === 409 && staleBody.error?.code === "omp_capability_revision_mismatch",
		`a stale capability revision is a typed conflict (${stale.status} ${staleBody.error?.code ?? "no code"})`,
	);

	console.log("\nOMP capability smoke: every check OK");
} finally {
	await started.close();
	rmSync(stateDir, { recursive: true, force: true });
	rmSync(profileDir, { recursive: true, force: true });
	rmSync(workDir, { recursive: true, force: true });
}
