import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	buildAuditedRecordSet,
	buildCediaRecordSet,
	compareOmpCoverage,
	OMP_RPC_UNCARRIED,
	OMP_RPC_VIA_CEDIA_CALLER,
	OMP_RPC_VIA_OTHER_PATH,
	OMP_SDK_DISPOSITIONS,
	OMP_SDK_VIA_CEDIA_CALLER,
	OMP_SDK_VIA_OTHER_PATH,
	OMP_SDK_VIA_OPERATION,
	OMP_SDK_VIA_RPC,
	OMP_SDK_VIA_SLASH,
	OMP_SDK_VIA_WINDOW_LOCAL,
	staleSourcePaths,
	verifyOmpRpcCediaCallers,
	verifyOmpRpcPaths,
	verifyOmpSdkCediaCallers,
	verifyOmpSdkOperationLinks,
	verifyOmpSdkSourceLinks,
	verifyOmpSdkViaSlash,
	verifyOmpSdkWindowLocalLinks,
	verifyOmpSdkDispositions,
	type OmpAuditInputs,
	type OmpCediaEntry,
} from "./omp-coverage.ts";

function auditFixture(overrides: Partial<OmpAuditInputs> = {}): OmpAuditInputs {
	const config = {
		settings: [{ path: "alpha", family: "runtime" }],
		slashCommands: [{ name: "help", aliases: ["h"], subcommands: ["about"], family: "control" }],
		cliCommands: [{ name: "launch", aliases: ["l"] }],
		launchFlags: { string: ["--cwd"], optional: [], boolean: ["--help"] },
	};
	const rpc = {
		commands: [{ name: "prompt" }],
		extensionUiMethods: [{ method: "select" }],
		hostBridgeFrames: [{ type: "host_tool_call" }],
		sessionEvents: { sourceUnion: ["agent_start"] },
	};
	const tools = {
		registry: { builtin: [{ name: "read" }], hidden: [], aliases: { search: "read" } },
		dynamic: [{ name: "browser" }],
	};
	const sdk = { entries: [{ name: "executeBash" }] };
	const rows = [
		["setting", "alpha", "O04"],
		["slash", "help", "O05"],
		["slash-alias", "h", "O05"],
		["slash-subcommand", "help about", "O05"],
		["cli", "launch", "O04"],
		["cli-alias", "l", "O04"],
		["launch-flag", "--cwd", "O04"],
		["launch-flag", "--help", "O04"],
		["rpc", "prompt", "O01"],
		["extension-ui", "select", "O05"],
		["host-frame", "host_tool_call", "O05"],
		["event", "agent_start", "O01"],
		["tool", "read", "O05"],
		["tool-alias", "search", "O05"],
		["dynamic-tool", "browser", "O10"],
		["sdk", "executeBash", "O11"],
	].map(([kind, name, family]) => ({ kind, name, family, implementationVerified: false }));
	return {
		configCli: config,
		rpc,
		tools,
		sdk,
		coverage: { rows, sources: {} },
		...overrides,
	} as OmpAuditInputs;
}

function entries(...entries: OmpCediaEntry[]): readonly OmpCediaEntry[] {
	return buildCediaRecordSet({ entries });
}

describe("OMP coverage comparison", () => {
	test("a complete audited fixture with explicit handlers passes", () => {
		const audit = auditFixture();
		const cedia = entries(
			...buildAuditedRecordSet(audit).map(record => ({
				kind: record.kind,
				name: record.name,
				disposition: "integrated" as const,
				handler: `fixture#${record.kind}`,
			})),
		);
		const report = compareOmpCoverage(audit, cedia, {});
		expect(report.issues).toEqual([]);
		expect(report.complete).toBe(true);
	});

	test("reports an audited record with no Cedia disposition as unmapped", () => {
		const report = compareOmpCoverage(auditFixture(), entries(), {});
		expect(report.issues.some(issue => issue.kind === "unmapped" && issue.name === "prompt")).toBe(true);
		expect(report.gaps.some(gap => gap.kind === "rpc" && gap.name === "prompt")).toBe(true);
	});

	test("reports a Cedia entry without an audited record as orphan", () => {
		const report = compareOmpCoverage(
			auditFixture(),
			entries({ kind: "rpc", name: "cedia_future_command", disposition: "integrated", handler: "fixture#future" }),
			{},
		);
		expect(report.issues).toContainEqual(expect.objectContaining({ kind: "orphan", name: "cedia_future_command" }));
	});

	test("reports duplicate audited and Cedia mappings", () => {
		const audit = auditFixture({
			coverage: {
				rows: [
					{ kind: "rpc", name: "prompt", family: "O01" },
					{ kind: "rpc", name: "prompt", family: "O01" },
				],
				sources: {},
			},
		});
		const report = compareOmpCoverage(
			audit,
			entries(
				{ kind: "rpc", name: "prompt", disposition: "integrated" },
				{ kind: "rpc", name: "prompt", disposition: "integrated" },
			),
			{},
		);
		expect(report.issues.filter(issue => issue.kind === "duplicate").length).toBeGreaterThanOrEqual(2);
	});

	test("reports invalid families and rows absent from the audit classification", () => {
		const audit = auditFixture({
			coverage: {
				rows: [
					{ kind: "rpc", name: "prompt", family: "O99" },
					{ kind: "rpc", name: "not-in-audit", family: "O01" },
				],
				sources: {},
			},
		});
		const report = compareOmpCoverage(audit, entries({ kind: "rpc", name: "prompt", disposition: "integrated" }), {});
		expect(report.issues).toContainEqual(expect.objectContaining({ kind: "family_invalid", name: "prompt" }));
		expect(report.issues).toContainEqual(expect.objectContaining({ kind: "orphan", name: "not-in-audit" }));
		const unclassified = compareOmpCoverage(
			auditFixture({ coverage: { rows: [], sources: {} } }),
			entries(),
			{},
		);
		expect(unclassified.issues).toContainEqual(expect.objectContaining({ kind: "unclassified", name: "prompt" }));
	});

	test("blocks F only for the plan's two unsettled states", () => {
		const audit = auditFixture();
		// The plan's settled dispositions: an operation Cedia carries, or a documented reason it
		// does not. None of them is a gap.
		for (const disposition of ["integrated", "dependency_unavailable", "platform_presentation_equivalent", "owner_only", "explicitly_excluded"] as const) {
			const report = compareOmpCoverage(audit, entries({ kind: "rpc", name: "prompt", disposition }), {});
			// The fixture maps one record, so other audit rows are legitimately unmapped; what this
			// asserts is that the settled dispositions themselves never become gaps.
			expect(report.rows.find(row => row.kind === "rpc" && row.name === "prompt")?.disposition).toBe(disposition);
			expect(report.gaps.some(gap => gap.kind === "rpc" && gap.name === "prompt")).toBe(false);
		}
		// "Not done yet" and "not mapped at all" both block, which is what keeps F honest.
		const missing = compareOmpCoverage(audit, entries({ kind: "rpc", name: "prompt", disposition: "integration_missing", reason: "not built" }), {});
		expect(missing.gaps).toContainEqual(expect.objectContaining({ kind: "rpc", name: "prompt", disposition: "integration_missing" }));
		expect(compareOmpCoverage(audit, []).gaps).toContainEqual(expect.objectContaining({ disposition: "unmapped" }));
	});

	test("detects a source hash that no longer matches an existing file", () => {
		expect(staleSourcePaths({ "rpc.ts": "old", "missing.ts": "gone" }, { "rpc.ts": "new" })).toEqual(["rpc.ts"]);
	});
});

describe("SDK source links", () => {
  const adapter = 'await this.sendCommand(session, id(), "prompt", { message: text });\nawait this.sendCommand(session, id(), "abort");';

  test("accepts a link whose audited command the adapter really sends", () => {
    expect(verifyOmpSdkSourceLinks(
      [{ name: "prompt", rpcCommand: "prompt" }, { name: "abort", rpcCommand: "abort" }],
      { auditedRpcCommands: new Set(["prompt", "abort"]), cediaAdapterSource: adapter },
    )).toEqual([]);
  });

  test("refuses a link the audit does not record as an RPC command", () => {
    const issues = verifyOmpSdkSourceLinks(
      [{ name: "redeemResetCredit", rpcCommand: "redeem_reset_credit" }],
      { auditedRpcCommands: new Set(["prompt"]), cediaAdapterSource: adapter },
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "unclassified", name: "redeemResetCredit" });
    expect(issues[0]!.message).toContain("does not record as an RPC command");
  });

  test("refuses a link whose command the adapter stopped sending", () => {
    const issues = verifyOmpSdkSourceLinks(
      [{ name: "compact", rpcCommand: "compact" }],
      { auditedRpcCommands: new Set(["compact"]), cediaAdapterSource: adapter },
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("no longer sends");
  });

  test("refuses to vouch for anything when the adapter source cannot be read", () => {
    const issues = verifyOmpSdkSourceLinks(
      [{ name: "prompt", rpcCommand: "prompt" }],
      { auditedRpcCommands: new Set(["prompt"]) },
    );
    expect(issues.map(issue => issue.kind)).toEqual(["source_missing"]);
  });

  test("the shipped table is the one the adapter proves", () => {
    // Every shipped link names a distinct SDK method and a distinct command, so one entry cannot
    // quietly stand in for two operations.
    expect(new Set(OMP_SDK_VIA_RPC.map(link => link.name)).size).toBe(OMP_SDK_VIA_RPC.length);
    expect(new Set(OMP_SDK_VIA_RPC.map(link => link.rpcCommand)).size).toBe(OMP_SDK_VIA_RPC.length);
    expect(OMP_SDK_VIA_RPC.length).toBeGreaterThan(0);
  });

  test("accepts SDK links carried by a reachable slash path or the OMP settings surface", () => {
    expect(verifyOmpSdkSourceLinks(
      [
        { name: "setFastMode", rpcCommand: "set_fast_mode", via: "slash", value: "fast" },
        { name: "setAutoRetryEnabled", rpcCommand: "set_auto_retry", via: "setting", value: "retry.enabled" },
      ],
      {
        auditedRpcCommands: new Set(["set_fast_mode", "set_auto_retry"]),
        reachableSlashCommands: new Set(["fast"]),
        settingsPaths: new Set(["retry.enabled"]),
        cediaAdapterSource: `${adapter}\nawait this.request("PATCH", "/v1/omp/settings", body);`,
      },
    )).toEqual([]);
  });

  test("accepts an SDK link carried by another RPC command", () => {
    // A command credited to a Cedia caller is proven against that file: the row cannot outlive
    // the call site, and a caller that cannot be read is its own failure.
    expect(verifyOmpRpcCediaCallers(
      [{ name: "get_subagents", caller: "apps/host/src/omp-progress.ts" }],
      { sourceTexts: new Map([["apps/host/src/omp-progress.ts", `await client.request("get_subagents");`]]) },
    )).toEqual([]);
    const stopped = verifyOmpRpcCediaCallers(
      [{ name: "get_subagents", caller: "apps/host/src/omp-progress.ts" }],
      { sourceTexts: new Map([["apps/host/src/omp-progress.ts", "await client.request(\"get_messages\");"]]) },
    );
    expect(stopped.map(issue => issue.kind)).toEqual(["unclassified"]);
    expect(stopped[0]?.message).toContain("no longer sends");
    expect(verifyOmpRpcCediaCallers(
      [{ name: "get_subagents", caller: "apps/host/src/gone.ts" }],
      { sourceTexts: new Map([["apps/host/src/gone.ts", undefined]]) },
    ).map(issue => issue.kind)).toEqual(["source_missing"]);
    // The same command cannot be credited twice: one operation, one caller entry.
    expect(new Set(OMP_RPC_VIA_CEDIA_CALLER.map(link => link.name)).size).toBe(OMP_RPC_VIA_CEDIA_CALLER.length);

    // An operation link is proven against the table the running runtime advertises, so a Cedia
    // file can never keep a row settled after the runtime stopped registering the operation.
    expect(verifyOmpSdkOperationLinks(
      [{ name: "getGoalModeState", operation: "goal.get" }],
      { availableOperations: new Set(["goal.get", "goal.set"]) },
    )).toEqual([]);
    const unregistered = verifyOmpSdkOperationLinks(
      [{ name: "getGoalModeState", operation: "goal.get" }],
      { availableOperations: new Set(["goal.set"]) },
    );
    expect(unregistered.map(issue => issue.kind)).toEqual(["unclassified"]);
    expect(unregistered[0]?.message).toContain("does not report as available");
    // No readable table at all is its own failure: the link is not silently accepted.
    expect(verifyOmpSdkOperationLinks(
      [{ name: "getGoalModeState", operation: "goal.get" }],
      { availableOperations: undefined },
    ).map(issue => issue.kind)).toEqual(["source_missing"]);
    // Every shipped link names a distinct SDK method, so one entry cannot stand in for two.
    expect(new Set(OMP_SDK_VIA_OPERATION.map(link => link.name)).size).toBe(OMP_SDK_VIA_OPERATION.length);

    expect(verifyOmpSdkSourceLinks(
      [{ name: "getLastAssistantText", rpcCommand: "get_last_assistant_text", via: "command", value: "get_messages" }],
      {
        auditedRpcCommands: new Set(["get_last_assistant_text"]),
        reachableSlashCommands: new Set(),
        settingsPaths: new Set(),
        cediaAdapterSource: `${adapter}\nawait this.sendCommand(session, id(), "get_messages");`,
      },
    )).toEqual([]);
  });

  test("refuses an SDK command link when its carrying RPC literal is gone", () => {
    const issues = verifyOmpSdkSourceLinks(
      [{ name: "getLastAssistantText", rpcCommand: "get_last_assistant_text", via: "command", value: "get_messages" }],
      {
        auditedRpcCommands: new Set(["get_last_assistant_text"]),
        reachableSlashCommands: new Set(),
        settingsPaths: new Set(),
        cediaAdapterSource: adapter,
      },
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "unclassified", name: "getLastAssistantText" });
    expect(issues[0]!.message).toContain("no longer sends");
  });

  test("refuses an SDK slash link the audit does not mark reachable", () => {
    const issues = verifyOmpSdkSourceLinks(
      [{ name: "setFastMode", rpcCommand: "set_fast_mode", via: "slash", value: "not-a-command" }],
      {
        auditedRpcCommands: new Set(["set_fast_mode"]),
        reachableSlashCommands: new Set(["fast"]),
        settingsPaths: new Set(),
        cediaAdapterSource: adapter,
      },
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "unclassified", name: "setFastMode" });
    expect(issues[0]!.message).toContain("does not mark reachable");
  });

  test("refuses an SDK settings link the runtime schema does not define", () => {
    const issues = verifyOmpSdkSourceLinks(
      [{ name: "setAutoRetryEnabled", rpcCommand: "set_auto_retry", via: "setting", value: "retry.madeUp" }],
      {
        auditedRpcCommands: new Set(["set_auto_retry"]),
        reachableSlashCommands: new Set(),
        settingsPaths: new Set(["retry.enabled"]),
        cediaAdapterSource: `${adapter}\nawait this.request("PATCH", "/v1/omp/settings", body);`,
      },
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "unclassified", name: "setAutoRetryEnabled" });
    expect(issues[0]!.message).toContain("schema does not define");
  });

  test("refuses SDK other-path links when Cedia no longer sends the carrying surface", () => {
    const issues = verifyOmpSdkSourceLinks(
      [
        { name: "setFastMode", rpcCommand: "set_fast_mode", via: "slash", value: "fast" },
        { name: "setAutoRetryEnabled", rpcCommand: "set_auto_retry", via: "setting", value: "retry.enabled" },
      ],
      {
        auditedRpcCommands: new Set(["set_fast_mode", "set_auto_retry"]),
        reachableSlashCommands: new Set(["fast"]),
        settingsPaths: new Set(["retry.enabled"]),
        cediaAdapterSource: "await this.request(\"GET\", \"/v1/capabilities\");",
      },
    );
    expect(issues).toHaveLength(2);
    expect(issues.every(issue => issue.kind === "unclassified")).toBe(true);
    expect(issues.map(issue => issue.name)).toEqual(["setFastMode", "setAutoRetryEnabled"]);
    expect(issues[0]!.message).toContain("prompt path");
    expect(issues[1]!.message).toContain("settings surface");
  });

  test("does not let an unrelated Cedia source stand in for the adapter path", () => {
    const issues = verifyOmpSdkSourceLinks(
      [{ name: "setFastMode", rpcCommand: "set_fast_mode", via: "slash", value: "fast" }],
      {
        auditedRpcCommands: new Set(["set_fast_mode"]),
        reachableSlashCommands: new Set(["fast"]),
        settingsPaths: new Set(),
        cediaSourceTexts: ['command: "prompt"'],
      },
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("Cedia client source was not readable");
  });

  test("accepts a direct SDK link proven by another Cedia client source", () => {
    expect(verifyOmpSdkSourceLinks(
      [{ name: "getAvailableModels", rpcCommand: "get_available_models" }],
      {
        auditedRpcCommands: new Set(["get_available_models"]),
        cediaAdapterSource: "await this.request(\"GET\", \"/v1/capabilities\");",
        cediaSourceTexts: ['command: "get_available_models"'],
      },
    )).toEqual([]);
  });

  test("refuses a direct SDK link when no Cedia source sends the audited command", () => {
    const issues = verifyOmpSdkSourceLinks(
      [{ name: "getAvailableModels", rpcCommand: "get_available_models" }],
      {
        auditedRpcCommands: new Set(["get_available_models"]),
        cediaAdapterSource: "await this.request(\"GET\", \"/v1/capabilities\");",
        cediaSourceTexts: ["command: \"get_available_commands\""],
      },
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("no longer sends");
  });

  test("refuses an SDK link whose method is no longer in the dated SDK audit", () => {
    const issues = verifyOmpSdkSourceLinks(
      [{ name: "removedSdkMethod", rpcCommand: "prompt" }],
      {
        auditedRpcCommands: new Set(["prompt"]),
        auditedSdkNames: new Set(["prompt"]),
        cediaAdapterSource: adapter,
      },
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "orphan", recordKind: "sdk", name: "removedSdkMethod" });
    expect(issues[0]!.message).toContain("dated SDK audit");
  });

	test("the shipped other-path table names unique SDK methods and audited paths", () => {
    const allLinks = [...OMP_SDK_VIA_RPC, ...OMP_SDK_VIA_OTHER_PATH];
    expect(new Set(allLinks.map(link => link.name)).size).toBe(allLinks.length);
    expect(new Set(allLinks.map(link => link.rpcCommand)).size).toBe(allLinks.length);
    expect(OMP_SDK_VIA_OTHER_PATH.every(link => link.via && link.value)).toBe(true);
  });

	test("accepts an SDK link carried by a named Cedia host caller", () => {
    const caller = "apps/macos/src/provider-review.ts";
    expect(verifyOmpSdkCediaCallers(
      [{ name: "newSession", rpcCommand: "new_session", caller }],
      {
        auditedRpcCommands: new Set(["new_session"]),
        auditedSdkNames: new Set(["newSession"]),
        sourceTexts: new Map([[caller, 'await this.requestOmp("new_session", { parentSession });']]),
      },
    )).toEqual([]);
  });

	test("refuses a caller link the caller stopped sending, an unaudited command and a stale SDK name", () => {
    const caller = "apps/macos/src/provider-review.ts";
    const stopped = verifyOmpSdkCediaCallers(
      [{ name: "newSession", rpcCommand: "new_session", caller }],
      {
        auditedRpcCommands: new Set(["new_session"]),
        auditedSdkNames: new Set(["newSession"]),
        sourceTexts: new Map([[caller, 'await this.requestOmp("get_messages", {});']]),
      },
    );
    expect(stopped).toHaveLength(1);
    expect(stopped[0]).toMatchObject({ kind: "unclassified", name: "newSession" });
    expect(stopped[0]!.message).toContain("no longer sends");

    const unaudited = verifyOmpSdkCediaCallers(
      [{ name: "newSession", rpcCommand: "start_over", caller }],
      {
        auditedRpcCommands: new Set(["new_session"]),
        auditedSdkNames: new Set(["newSession"]),
        sourceTexts: new Map([[caller, 'await this.requestOmp("start_over", {});']]),
      },
    );
    expect(unaudited.map(issue => issue.kind)).toEqual(["unclassified"]);
    expect(unaudited[0]!.message).toContain("does not record as an RPC command");

    const staleName = verifyOmpSdkCediaCallers(
      [{ name: "removedSdkMethod", rpcCommand: "new_session", caller }],
      {
        auditedRpcCommands: new Set(["new_session"]),
        auditedSdkNames: new Set(["newSession"]),
        sourceTexts: new Map([[caller, 'await this.requestOmp("new_session", {});']]),
      },
    );
    expect(staleName).toHaveLength(1);
    expect(staleName[0]).toMatchObject({ kind: "orphan", recordKind: "sdk", name: "removedSdkMethod" });
  });

	test("the shipped caller table names a distinct SDK method, a distinct command and a readable caller", () => {
    expect(new Set(OMP_SDK_VIA_CEDIA_CALLER.map(link => link.name)).size).toBe(OMP_SDK_VIA_CEDIA_CALLER.length);
    expect(new Set(OMP_SDK_VIA_CEDIA_CALLER.map(link => link.rpcCommand)).size).toBe(OMP_SDK_VIA_CEDIA_CALLER.length);
    expect(OMP_SDK_VIA_CEDIA_CALLER.every(link => link.caller.endsWith(".ts"))).toBe(true);
    // A caller credit is only as good as the file it names: on this checkout every one must read.
    const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
    const audit = JSON.parse(readFileSync(join(repoRoot, "docs/maintenance/evidence/omp-complete-scope-2026-09-29/coverage.json"), "utf8")) as { rows: { kind: string; name: string }[] };
    const sources = new Map(OMP_SDK_VIA_CEDIA_CALLER.map(link => [link.caller, readFileSync(join(repoRoot, link.caller), "utf8")] as const));
    expect(verifyOmpSdkCediaCallers(OMP_SDK_VIA_CEDIA_CALLER, {
      auditedRpcCommands: new Set(audit.rows.filter(row => row.kind === "rpc").map(row => row.name)),
      auditedSdkNames: new Set(audit.rows.filter(row => row.kind === "sdk").map(row => row.name)),
      sourceTexts: sources,
    })).toEqual([]);
  });

	test("accepts an SDK operation performed by a reachable slash command", () => {
    expect(verifyOmpSdkViaSlash(
      [{ name: "armPrewalk", slash: "prewalk" }],
      {
        auditedSdkNames: new Set(["armPrewalk"]),
        reachableSlashCommands: new Set(["prewalk"]),
        cediaAdapterSource: 'await adapter.sendCommand(session, id(), "prompt", { message });',
      },
    )).toEqual([]);
  });

	test("refuses a slash link with a stale SDK name, an unreachable slash, or a dead prompt path", () => {
    const staleName = verifyOmpSdkViaSlash(
      [{ name: "removedSdkMethod", slash: "prewalk" }],
      {
        auditedSdkNames: new Set(["armPrewalk"]),
        reachableSlashCommands: new Set(["prewalk"]),
        cediaAdapterSource: 'sendCommand(session, id(), "prompt", {})',
      },
    );
    expect(staleName).toHaveLength(1);
    expect(staleName[0]).toMatchObject({ kind: "orphan", recordKind: "sdk", name: "removedSdkMethod" });

    const unreachable = verifyOmpSdkViaSlash(
      [{ name: "armPrewalk", slash: "prewalk" }],
      {
        auditedSdkNames: new Set(["armPrewalk"]),
        reachableSlashCommands: new Set(["jobs"]),
        cediaAdapterSource: 'sendCommand(session, id(), "prompt", {})',
      },
    );
    expect(unreachable).toHaveLength(1);
    expect(unreachable[0]).toMatchObject({ kind: "unclassified", name: "armPrewalk" });
    expect(unreachable[0]!.message).toContain("does not mark reachable");

    const noSource = verifyOmpSdkViaSlash(
      [{ name: "armPrewalk", slash: "prewalk" }],
      {
        auditedSdkNames: new Set(["armPrewalk"]),
        reachableSlashCommands: new Set(["prewalk"]),
      },
    );
    expect(noSource).toHaveLength(1);
    expect(noSource[0]).toMatchObject({ kind: "source_missing", name: "armPrewalk" });

    const deadPrompt = verifyOmpSdkViaSlash(
      [{ name: "armPrewalk", slash: "prewalk" }],
      {
        auditedSdkNames: new Set(["armPrewalk"]),
        reachableSlashCommands: new Set(["prewalk"]),
        cediaAdapterSource: 'await adapter.sendCommand(session, id(), "steer", {})',
      },
    );
    expect(deadPrompt).toHaveLength(1);
    expect(deadPrompt[0]).toMatchObject({ kind: "unclassified", name: "armPrewalk" });
    expect(deadPrompt[0]!.message).toContain("no longer sends");
  });

	test("the shipped slash table names a distinct SDK method per reachable command", () => {
    expect(new Set(OMP_SDK_VIA_SLASH.map(link => link.name)).size).toBe(OMP_SDK_VIA_SLASH.length);
    expect(new Set(OMP_SDK_VIA_SLASH.map(link => link.slash)).size).toBe(OMP_SDK_VIA_SLASH.length);
    // Proven against the dated audit and the real adapter source, like the gate itself.
    const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
    const coverage = JSON.parse(readFileSync(join(repoRoot, "docs/maintenance/evidence/omp-complete-scope-2026-09-29/coverage.json"), "utf8")) as { rows: { kind: string; name: string }[] };
    const cli = JSON.parse(readFileSync(join(repoRoot, "docs/maintenance/evidence/omp-complete-scope-2026-09-29/config-cli.json"), "utf8")) as { slashCommands?: { name: string; tuiOnly?: boolean; surfaces?: unknown }[] };
    const reachable = new Set(
      (cli.slashCommands ?? [])
        .filter(row => row.tuiOnly !== true && Array.isArray(row.surfaces) && ((row.surfaces as string[]).includes("rpc") || (row.surfaces as string[]).includes("acp")))
        .map(row => row.name),
    );
    expect(verifyOmpSdkViaSlash(OMP_SDK_VIA_SLASH, {
      auditedSdkNames: new Set(coverage.rows.filter(row => row.kind === "sdk").map(row => row.name)),
      reachableSlashCommands: reachable,
      cediaAdapterSource: readFileSync(join(repoRoot, "apps/macos/agent-window/src/cedia-adapter.ts"), "utf8"),
    })).toEqual([]);
  });

	test("the shipped operation table names a distinct SDK method and a capable operation id", () => {
    expect(new Set(OMP_SDK_VIA_OPERATION.map(link => link.name)).size).toBe(OMP_SDK_VIA_OPERATION.length);
    expect(OMP_SDK_VIA_OPERATION.every(link => /^[a-z][a-z0-9]*([.-][a-z0-9-]+)*$/.test(link.operation))).toBe(true);
    expect(verifyOmpSdkOperationLinks(OMP_SDK_VIA_OPERATION, {
      availableOperations: new Set(OMP_SDK_VIA_OPERATION.map(link => link.operation)),
    })).toEqual([]);
  });
});

describe("SDK window-local links", () => {
	const link = {
		name: "switchSession",
		source: "apps/macos/src/provider-projects.ts",
		sourceNeedles: ["async selectSession", "client.getSession(id)", 'type: "reset"'],
		testFiles: [{
			path: "apps/macos/agent-window/test/native-handoff.test.ts",
			needles: ["window-local task navigation keeps each task runtime distinct without an OMP retarget command"],
		}],
		reason: "Cedia selects another durable task in the window; each task keeps its own host-owned OMP runtime.",
	} as const;

	test("accepts a window-local link only when source and behavioral receipt are readable", () => {
		expect(verifyOmpSdkWindowLocalLinks([link], {
			auditedSdkNames: new Set(["switchSession"]),
			readFile: path => new Map<string, string>([
				[link.source, "async selectSession(id) { await client.getSession(id); this.setState({ type: \"reset\" }); }"],
				[link.testFiles[0]!.path, `test(\"${link.testFiles[0]!.needles[0]}\", () => {})`],
			]).get(path),
		})).toEqual([]);
	});

	test("refuses stale or unreadable window-local links", () => {
		const absent = verifyOmpSdkWindowLocalLinks([link], {
			auditedSdkNames: new Set(["switchSession"]),
			readFile: () => undefined,
		});
		expect(absent.map(issue => issue.kind)).toEqual(["source_missing"]);

		const stale = verifyOmpSdkWindowLocalLinks([link], {
			auditedSdkNames: new Set(["otherSdkMethod"]),
			readFile: () => "present",
		});
		expect(stale).toContainEqual(expect.objectContaining({ kind: "orphan", name: "switchSession" }));

		const missingReceipt = verifyOmpSdkWindowLocalLinks([link], {
			auditedSdkNames: new Set(["switchSession"]),
			readFile: path => path === link.source ? "async selectSession(id) { await client.getSession(id); this.setState({ type: \"reset\" }); }" : undefined,
		});
		expect(missingReceipt).toContainEqual(expect.objectContaining({ kind: "source_missing", name: "switchSession" }));

		const staleMarker = verifyOmpSdkWindowLocalLinks([link], {
			auditedSdkNames: new Set(["switchSession"]),
			readFile: path => path === link.source ? "async selectSession(id) { await client.getSession(id); this.setState({ type: \"reset\" }); }" : "test(\"old navigation proof\", () => {})",
		});
		expect(staleMarker).toContainEqual(expect.objectContaining({ kind: "unclassified", name: "switchSession" }));
	});

	test("the shipped window-local table has no RPC carrier and names one audited SDK method", () => {
		expect(new Set(OMP_SDK_VIA_WINDOW_LOCAL.map(row => row.name)).size).toBe(OMP_SDK_VIA_WINDOW_LOCAL.length);
		expect(OMP_SDK_VIA_WINDOW_LOCAL).toContainEqual(expect.objectContaining({ name: "switchSession" }));
		expect(OMP_SDK_VIA_WINDOW_LOCAL.every(row => !("rpcCommand" in row))).toBe(true);
	});
});

describe("RPC paths that are not a direct caller", () => {
  const inputs = {
    auditedRpcCommands: new Set(["cycle_model", "set_auto_compaction"]),
    reachableSlashCommands: new Set(["model"]),
    settingsPaths: new Set(["compaction.enabled"]),
    cediaAdapterSource: 'await this.request("set_model", {});',
  };

  test("accepts a slash path, a settings path and another Cedia command", () => {
    expect(verifyOmpRpcPaths([
      { name: "cycle_model", via: "slash", value: "model", reason: "" },
      { name: "set_auto_compaction", via: "setting", value: "compaction.enabled", reason: "" },
      { name: "cycle_model", via: "command", value: "set_model", reason: "" },
    ], inputs)).toEqual([]);
  });

  test("refuses a slash command the audit does not mark reachable", () => {
    const issues = verifyOmpRpcPaths(
      [{ name: "cycle_model", via: "slash", value: "settings", reason: "" }],
      inputs,
    );
    expect(issues.map(issue => issue.kind)).toEqual(["unclassified"]);
    expect(issues[0]!.message).toContain("does not mark reachable");
  });

  test("refuses a setting the runtime's schema does not define", () => {
    const issues = verifyOmpRpcPaths(
      [{ name: "set_auto_compaction", via: "setting", value: "compaction.madeUp", reason: "" }],
      inputs,
    );
    expect(issues[0]!.message).toContain("schema does not define");
  });

  test("refuses a link to a command Cedia no longer sends, and to a name that is not an RPC command", () => {
    expect(verifyOmpRpcPaths([{ name: "cycle_model", via: "command", value: "cycle_model", reason: "" }], inputs)[0]!.message)
      .toContain("no longer sends");
    expect(verifyOmpRpcPaths([{ name: "not_a_command", via: "setting", value: "compaction.enabled", reason: "" }], inputs)[0]!.message)
      .toContain("does not record as an RPC command");
  });

  test("every uncarried command names a packet and a reason", () => {
    for (const row of OMP_RPC_UNCARRIED) {
      expect(/^O\d\d$/.test(row.packet)).toBe(true);
      expect(row.reason.length).toBeGreaterThan(20);
    }
    // A command cannot be both carried elsewhere and uncarried.
    const carried = new Set(OMP_RPC_VIA_OTHER_PATH.map(link => link.name));
    for (const row of OMP_RPC_UNCARRIED) expect(carried.has(row.name)).toBe(false);
  });
	test("a disposition that is OMP's own behaviour carries source evidence the gate re-reads", () => {
		// Read the real sources: the shipped table must still describe the code in this checkout, which
		// is the same check the gate runs.
		const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
		const realFiles = new Map<string, string>();
		const shipped = verifyOmpSdkDispositions(OMP_SDK_DISPOSITIONS, {
			readFile: path => {
				const cached = realFiles.get(path);
				if (cached !== undefined) return cached;
				try {
					const text = readFileSync(join(repoRoot, path), "utf8");
					realFiles.set(path, text);
					return text;
				} catch {
					return undefined;
				}
			},
		});
		expect(shipped).toEqual([]);
		expect(OMP_SDK_DISPOSITIONS.every(row => row.reason.length > 0 && row.presentation.length > 0)).toBe(true);

		// A literal that moved out of the named file fails the run rather than leaving the claim.
		const moved = verifyOmpSdkDispositions(OMP_SDK_DISPOSITIONS, {
			readFile: () => "nothing this table claims is here",
		});
		expect(moved.length).toBeGreaterThan(0);
		expect(moved.every(issue => issue.kind === "unclassified")).toBe(true);

		// A file that cannot be read is a missing source, not a pass.
		const missing = verifyOmpSdkDispositions(OMP_SDK_DISPOSITIONS, { readFile: () => undefined });
		expect(missing).toHaveLength(OMP_SDK_DISPOSITIONS.length);
		expect(missing[0]).toMatchObject({ kind: "source_missing" });

		// And a name the dated audit does not have is an orphan.
		const orphan = verifyOmpSdkDispositions(OMP_SDK_DISPOSITIONS, {
			readFile: () => OMP_SDK_DISPOSITIONS.flatMap(row => row.evidence.needles).join("\n"),
			auditedSdkNames: new Set(["prompt"]),
		});
		expect(orphan[0]).toMatchObject({ kind: "orphan", name: OMP_SDK_DISPOSITIONS[0]!.name });
	});
});
