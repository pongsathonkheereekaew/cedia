import readline from "node:readline";
import { join } from "node:path";
import { dirname } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const sessionIndex = args.indexOf("--session");
const sessionFile = sessionIndex >= 0 ? args[sessionIndex + 1] : undefined;
const forkIndex = args.indexOf("--fork");
const sessionDirIndex = args.indexOf("--session-dir");
const sessionDir = sessionDirIndex >= 0 ? args[sessionDirIndex + 1] : undefined;
const mode = process.env.CEDIA_FAKE_HOST_MODE ?? "normal";
const isFork = forkIndex >= 0 || process.env.CEDIA_FAKE_FORK_MODE === "1";
const forkSessionFile = isFork
  ? (process.env.CEDIA_FAKE_FORK_SESSION_FILE ?? join(sessionDir ?? process.cwd(), "forked-child.jsonl"))
  : sessionFile;
if (process.env.CEDIA_FAKE_FORK_ARGS_LOG && forkIndex >= 0) {
  writeFileSync(process.env.CEDIA_FAKE_FORK_ARGS_LOG, JSON.stringify({ args, source: args[forkIndex + 1], sessionDir }));
}

const frame = value => process.stdout.write(`${JSON.stringify(value)}\n`);
const response = (command, id, data) => frame({
  type: "response",
  command,
  id,
  success: true,
  ...(data === undefined ? {} : { data }),
});

const emitReady = () => frame({
  type: "ready",
  protocolVersion: 1,
  supportedProtocolVersions: [1, 2],
  maxFrameBytes: 1024 * 1024,
  maxReassembledFrameBytes: 64 * 1024 * 1024,
  fixture: "cedia-host",
  // The patched runtime advertises Cedia's turn bridge unconditionally; the fixture does too,
  // so host tests exercise the same negotiation a real runtime performs.
  cediaTurnBridgeVersion: 1,
  // Queue controls use the capability bridge in the pinned runtime. Keep the fixture's answer
  // deliberately empty so host tests prove the absence and drop receipt without a second queue.
  cediaCapabilitiesVersion: 1,
  // The patched runtime also accepts a pending model/effort revision (§2.4); a mode without
  // the flag stands in for an older runtime that only has the immediate path.
  ...(mode === "no-pending-model" ? {} : { cediaPendingModelVersion: 1 }),
  ...(mode === "native-permission" ? { cediaNativeBridgeVersion: 1 } : {}),
});
// `delay-ready` keeps the host inside its startup window long enough for a test to
// observe it; every other mode, and everything after the frame, stays unchanged.
if (mode === "delay-ready") setTimeout(emitReady, 300);
else emitReady();
frame({ type: "available_commands_update", commands: [{ name: "fixture-command", source: "extension" }, { name: "baseline-command", source: "builtin" }] });

let permissionPromptId;
// The submission OMP would be running right now, reported back through `cedia_turn_queue`.
let runningIntentId;
let runningBatchIds = [];
let runningModelId;
let gatedSchemesOnce = false;
// The submissions a bridge-aware runtime would be holding, in drain order (steering first).
const queuedIntents = [];
// The model/effort revision a client handed the runtime, and the one it committed at a boundary.
const fixtureModels = ["fixture-model", "fixture-model-2"];
let pendingModel;
let appliedModel;
let fixtureTodoPhases = [];
const fixtureQueue = { steering: [], followUp: [] };
const fixtureQueueIntentIds = { steering: [], followUp: [] };
// The advisor config files the fixture owns, per scope: config.set writes exactly the validated
// text here and answers the count of `- name:` roster rows, like discovery would.
const fixtureAdvisorConfig = { project: null, user: null };
const advisorConfigCount = text => (typeof text === "string" ? (text.match(/^\s*-\s*name\s*:/gm) ?? []).length : 0);
// The run-pause gate the fixture owns: pause.set drives it, pause.get reads it back.
// The side question the fixture owns: ask holds a canned answer, branch promotes it into
// a branched session file once and then reports nothing held, like the terminal controller.
let fixtureBtw = null;
let fixtureBtwAnswering = false;
const btwStateResult = () => {
  if (fixtureBtwAnswering) return { state: "answering", question: fixtureBtw?.question ?? null, questionTruncated: false, answer: null, answerTruncated: false, branchable: false, branchUnavailableReason: "the answer is not ready", reason: null };
  return fixtureBtw === null
    ? { state: "idle", question: null, questionTruncated: false, answer: null, answerTruncated: false, branchable: false, branchUnavailableReason: "no answered side question", reason: null }
    : { state: "ready", question: fixtureBtw.question, questionTruncated: false, answer: fixtureBtw.answer, answerTruncated: false, branchable: true, branchUnavailableReason: null, reason: null };
};
let fixturePaused = false;
let fixturePausedAt = undefined;
const pausedResult = () => (fixturePaused && fixturePausedAt !== undefined ? { paused: true, pausedAt: fixturePausedAt } : { paused: fixturePaused });
// The rule draft the fixture owns: draft holds a canned candidate at once, save writes it
// under a fixture directory, abort answers the current state. Nothing touches a model.
let fixtureOmfg = null;
const omfgStateResult = () => fixtureOmfg === null
  ? { state: "idle", complaint: null, complaintTruncated: false, draft: null, draftTruncated: false, ruleName: null, validated: false, validationFeedback: null, savedPath: null, reason: null }
  : { state: "ready", complaint: fixtureOmfg.complaint, complaintTruncated: false, draft: fixtureOmfg.fileContent, draftTruncated: false, ruleName: fixtureOmfg.ruleName, validated: true, validationFeedback: null, savedPath: null, reason: null };
// The agent roster the fixture owns: one running and one parked subagent. Kill aborts
// an attached running row before tombstoning it; revive restores a parked row to idle.
// Unknown ids are refused with the runtime's own sentence, like the real bridge.
let fixtureAgents = [
  { id: "agt-running", name: "Runner", kind: "sub", status: "running", createdAt: 100, lastActivity: 200, activity: "Reading files" },
  { id: "agt-parked", name: "Parked", kind: "sub", status: "parked", createdAt: 90, lastActivity: 150 },
  ];
  const fixtureAgentConfigs = [
    { name: "task", source: "bundled", enabled: true },
    { name: "reviewer", source: "bundled", enabled: false, model: "fixture/model" },
  ];
// The cleanse run the fixture owns: run dispatches at once, the report lands on the next read.
let fixtureCleanse = { state: "idle", request: null, phase: null, checkers: [], agents: [], log: [], report: null, reason: null };
// The loop mode the fixture owns: loop.set disables it, loop.state.get reads it back.
// It starts enabled with a bound so the disable half has something to turn off.
let fixtureLoop = { enabled: true, paused: false, limit: "3 iterations remaining", condition: null, hasPrompt: true };
const loopResult = () => ({ ...fixtureLoop });
const fixtureContext = {
  usage: {
    contextWindow: 128000,
    anchored: true,
    usedTokens: 2048,
    systemPromptTokens: 600,
    systemToolsTokens: 400,
    systemContextTokens: 200,
    skillsTokens: 100,
    messagesTokens: 748,
  },
  compacting: false,
  speculation: "idle",
};
const fixtureMemory = { backend: "off" };
const fixtureUsage = {
  reports: [{
    provider: "fixture",
    fetchedAt: 1727000000000,
    limits: [{ id: "requests", label: "Requests", amount: { unit: "requests", used: 25 } }],
  }],
};
const fixtureCredits = {
  accounts: [
    {
      accountId: "acct-1",
      email: "owner@example.invalid",
      availableCount: 1,
      credits: [{ id: "credit-1", status: "available", expiresAt: "2026-10-01T00:00:00.000Z" }],
      active: true,
    },
    {
      accountId: "acct-2",
      availableCount: 0,
      credits: [],
      active: false,
      error: "Fixture account failed to list credits",
    },
  ],
};
const fixtureModelState = {
  model: { provider: "fixture", id: "fixture-model" },
  effort: { configured: "auto", autoResolved: "medium", isAuto: true },
  serviceTiers: {
    families: ["speed", "quality"],
    tiers: ["standard", "fast"],
    current: [
      { family: "speed", tier: "standard" },
      { family: "quality", tier: null },
    ],
  },
};
const fixtureRoles = {
  cycleOrder: ["default", "smol"],
  roles: [
    { role: "default", modelId: "fixture/fixture-model", source: "global" },
    { role: "smol", modelId: "fixture/fast-1", source: "global" },
  ],
  storage: "global",
};
const fixtureAccounts = {
  supported: true,
  provider: "fixture",
  accounts: [
    { credentialId: 7, label: "Work", active: true },
    { credentialId: 9, label: null, active: false },
  ],
  truncated: false,
};
const modelStateResult = () => mode === "model-state-malformed"
  ? { ...fixtureModelState, effort: { ...fixtureModelState.effort, autoResolved: 1 } }
  : fixtureModelState;
const accountsResult = () => mode === "accounts-unsupported"
  ? { ...fixtureAccounts, supported: false, accounts: [] }
  : mode === "accounts-malformed"
    ? { ...fixtureAccounts, accounts: [{ ...fixtureAccounts.accounts[0], active: "yes" }] }
    : fixtureAccounts;
const serviceTierResult = payload => {
  const family = payload?.family;
  const tier = payload?.tier;
  const current = fixtureModelState.serviceTiers.current.map(row => row.family === family ? { ...row, tier } : row);
  return { family, tier, serviceTiers: { ...fixtureModelState.serviceTiers, current } };
};
const fixtureHistoryState = {
  checkpoint: { messageCount: 3, entryId: "entry-3", startedAt: "2026-09-24T00:00:00.000Z" },
  lastRewind: {
    report: "Rewound to entry-2",
    reportTruncated: false,
    startedAt: "2026-09-24T00:00:00.000Z",
    rewoundAt: "2026-09-24T00:01:00.000Z",
  },
};
const fixtureHistoryTranscript = { text: "user: hello\nassistant: hi\n", truncated: false, bytes: 26 };
const fixtureTree = {
  leafId: "entry-3",
  nodes: [
    { id: "root", parentId: null, kind: "session", timestamp: "2026-09-24T00:00:00.000Z", label: "Task", labelTruncated: false },
    { id: "entry-3", parentId: "root", kind: "assistant", timestamp: "2026-09-24T00:01:00.000Z", label: "Latest answer", labelTruncated: false },
  ],
  pathIds: ["root", "entry-3"],
  truncated: false,
  lineage: { sessionFile: forkSessionFile ?? "", parentSession: null, previousSessionFiles: [] },
};
const treeResult = () => mode === "tree-malformed-get"
  ? { ...fixtureTree, nodes: [{ ...fixtureTree.nodes[0], labelTruncated: "no" }] }
  : fixtureTree;
const treeNavigateResult = payload => mode === "tree-malformed-navigate"
  ? { moved: true, cancelled: false, aborted: false, askReopen: false, summarized: false, editorText: null, editorTextTruncated: false, editorImageCount: "0", leafId: payload?.entryId ?? null }
  : {
    moved: mode !== "tree-ask-reopen",
    cancelled: false,
    aborted: false,
    askReopen: mode === "tree-ask-reopen",
    summarized: payload?.summarize === true,
    editorText: payload?.summarize === true ? "Reopened entry" : null,
    editorTextTruncated: false,
    editorImageCount: 0,
    leafId: payload?.entryId ?? fixtureTree.leafId,
  };
const fixtureTools = [
  { name: "read", description: "Read a file", descriptionTruncated: false, source: "builtin", active: true },
  { name: "write", description: "Write a file", descriptionTruncated: false, source: "builtin", active: true },
  { name: "custom-widget", description: "Extension widget", descriptionTruncated: false, source: "extension", active: false },
];
let enabledToolNames = fixtureTools.filter(tool => tool.active).map(tool => tool.name);
const toolsCatalogResult = () => ({
  tools: fixtureTools.map(tool => ({ ...tool, active: enabledToolNames.includes(tool.name) })),
  truncated: false,
  total: fixtureTools.length,
  activeCount: enabledToolNames.filter(name => fixtureTools.some(tool => tool.name === name)).length,
});
const contextResult = () => mode === "context-no-usage"
  ? { compacting: fixtureContext.compacting, speculation: fixtureContext.speculation }
  : { ...fixtureContext };
const commandLog = process.env.CEDIA_FAKE_COMMAND_LOG;
const logCommand = command => {
  if (!commandLog) return;
  try { writeFileSync(commandLog, `${JSON.stringify(command)}\n`, { flag: "a" }); } catch { /* fixture logging is best effort */ }
};
const handle = command => {
  if (!command || typeof command !== "object" || typeof command.type !== "string") return;
  logCommand(command);
  if (command.type === "cedia_turn_queue") {
    response(command.type, command.id, {
      ...(runningIntentId
        ? { current: { intentId: runningIntentId, model: { provider: "fixture", id: runningModelId ?? "fixture-model" }, thinkingLevel: "medium" } }
        : {}),
      queued: queuedIntents.map((entry, index) => ({ intentId: entry.intentId, kind: entry.kind, position: index + 1 })),
      ...(pendingModel ? { pending: { revision: pendingModel.revision, acceptedAt: new Date().toISOString() } } : {}),
      ...(appliedModel ? { applied: appliedModel } : {}),
    });
    return;
  }
  if (command.type === "cedia_control") {
    const operation = command.operation;
    if (operation === "queue.get") {
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: { steering: fixtureQueue.steering, followUp: fixtureQueue.followUp } });
      return;
    }
    if (operation === "queue.drop") {
      const dropped = [];
      const droppedIntentIds = [];
      if (command.payload?.mode === "all") {
        dropped.push(...fixtureQueue.steering, ...fixtureQueue.followUp);
        droppedIntentIds.push(...fixtureQueueIntentIds.steering, ...fixtureQueueIntentIds.followUp);
        fixtureQueue.steering.length = 0;
        fixtureQueue.followUp.length = 0;
        fixtureQueueIntentIds.steering.length = 0;
        fixtureQueueIntentIds.followUp.length = 0;
        queuedIntents.length = 0;
      } else if (command.payload?.mode === "last") {
        const side = fixtureQueue.steering.length > 0 ? "steering" : "followUp";
        const queue = fixtureQueue[side];
        const item = queue.pop();
        const intentId = fixtureQueueIntentIds[side].pop();
        if (item !== undefined) dropped.push(item);
        if (intentId !== undefined) {
          droppedIntentIds.push(intentId);
          const queuedIndex = queuedIntents.findIndex(entry => entry.intentId === intentId);
          if (queuedIndex >= 0) queuedIntents.splice(queuedIndex, 1);
        }
      }
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: { steering: fixtureQueue.steering, followUp: fixtureQueue.followUp, dropped, droppedIntentIds } });
      return;
    }
    if (operation === "advisor.config.get") {
      const scope = command.payload?.scope;
      const row = fixtureAdvisorConfig[scope];
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: row ?? { scope, path: `/fixture/${scope}-WATCHDOG.yml`, exists: false, text: "" } });
      return;
    }
    if (operation === "advisor.config.set") {
      const scope = command.payload?.scope;
      fixtureAdvisorConfig[scope] = { scope, path: `/fixture/${scope}-WATCHDOG.yml`, exists: true, text: command.payload?.text ?? "" };
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: { ...fixtureAdvisorConfig[scope], advisors: advisorConfigCount(command.payload?.text) } });
      return;
    }
    if (operation === "pause.get") {
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: pausedResult() });
      return;
    }
    if (operation === "tools.codemode.get") {
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: { active: false, directToolNames: null, preludes: [{ name: "browser", enabled: true }] } });
      return;
    }
    if (operation === "btw.state.get") {
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: btwStateResult() });
      return;
    }
    if (operation === "btw.ask") {
      const question = typeof command.payload?.question === "string" ? command.payload.question : "";
      // Like the real bridge, the ask answers the answering state at once; the held answer
      // lands on the next state read.
      fixtureBtwAnswering = true;
      fixtureBtw = { question, answer: `fixture answer for ${question.slice(0, 32)}` };
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: btwStateResult() });
      fixtureBtwAnswering = false;
      return;
    }
    if (operation === "btw.branch") {
      if (fixtureBtw === null) {
        frame({ type: "response", command: command.type, id: command.id, success: false, error: "Cannot branch the side question: no answered side question" });
        return;
      }
      fixtureBtw = null;
      const branchedFile = typeof sessionFile === "string" && sessionFile.endsWith("session.jsonl")
        ? `${sessionFile.slice(0, -"session.jsonl".length)}branched.jsonl`
        : `${sessionFile ?? "/tmp/fixture-session"}.branched.jsonl`;
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: { cancelled: false, sessionFile: branchedFile } });
      return;
    }
    if (operation === "omfg.state.get") {
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: omfgStateResult() });
      return;
    }
    if (operation === "omfg.draft") {
      const complaint = typeof command.payload?.complaint === "string" ? command.payload.complaint : "";
      fixtureOmfg = { complaint, ruleName: "fixture-rule", fileContent: `# fixture rule for ${complaint.slice(0, 32)}\n` };
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: omfgStateResult() });
      return;
    }
    if (operation === "omfg.save") {
      if (fixtureOmfg === null) {
        frame({ type: "response", command: command.type, id: command.id, success: false, error: "No rule draft to save: draft one first." });
        return;
      }
      const scope = command.payload?.scope === "global" ? "global" : "project";
      const saved = { saved: true, scope, name: fixtureOmfg.ruleName, path: `/tmp/fixture-${scope}-rules/${fixtureOmfg.ruleName}.md`, validated: true };
      fixtureOmfg = null;
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: saved });
      return;
    }
    if (operation === "omfg.abort") {
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: omfgStateResult() });
      return;
    }
    if (operation === "cleanse.state.get") {
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: fixtureCleanse });
      return;
    }
    if (operation === "cleanse.run") {
      // Like the real bridge, the run answers the running state at once; the held report
      // lands on the next state read.
      fixtureCleanse = { state: "running", request: "all discovered checkers", phase: "detecting", checkers: [], agents: [], log: [], report: null, reason: null };
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: fixtureCleanse });
      fixtureCleanse = { state: "done", request: "all discovered checkers", phase: null, checkers: [{ id: "typescript", label: "TypeScript", state: "done", exitCode: 0, diagnostics: 0, durationMs: 12 }], agents: [], log: ["Clean: 1 checker passed."], report: { status: "clean", checks: [{ id: "typescript", label: "TypeScript", language: "TypeScript", exitCode: 0, diagnostics: 0 }], checksTruncated: false, diagnostics: [], diagnosticsTruncated: false, diagnosticsTotal: 0, skipped: [] }, reason: null };
      return;
    }
    if (operation === "cleanse.abort") {
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: fixtureCleanse });
      return;
    }
    if (operation === "agents.get") {
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: { agents: fixtureAgents } });
      return;
    }
    if (operation === "agents.kill") {
      const id = command.payload?.id;
      const row = fixtureAgents.find(entry => entry.id === id);
      if (row === undefined) {
        frame({ type: "response", command: command.type, id: command.id, success: false, error: `Unknown agent: ${id}` });
        return;
      }
      const aborted = row.status === "running";
      row.status = "aborted";
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: { id, aborted, released: true } });
      return;
    }
    if (operation === "agents.config.list") {
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: { agents: fixtureAgentConfigs } });
      return;
    }
    if (operation === "agents.config.set") {
      const agent = command.payload?.agent;
      const row = fixtureAgentConfigs.find(entry => entry.name === agent);
      if (row === undefined) {
        frame({ type: "response", command: command.type, id: command.id, success: false, error: `Unknown agent: ${agent}` });
        return;
      }
      if (command.payload?.enabled !== undefined) row.enabled = command.payload.enabled === true;
      for (const field of ["model", "prewalk", "advisor"]) {
        const value = command.payload?.[field];
        if (value === undefined) continue;
        if (typeof value !== "string") {
          frame({ type: "response", command: command.type, id: command.id, success: false, error: `agents.config.set ${field} must be a string` });
          return;
        }
        if (value.trim().length === 0) delete row[field];
        else row[field] = value.trim();
      }
      const { name, enabled, model, prewalk, advisor } = row;
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: { agent: name, enabled, ...(model === undefined ? {} : { model }), ...(prewalk === undefined ? {} : { prewalk }), ...(advisor === undefined ? {} : { advisor }) } });
      return;
    }
    if (operation === "agents.revive") {
      const id = command.payload?.id;
      const row = fixtureAgents.find(entry => entry.id === id);
      if (row === undefined) {
        frame({ type: "response", command: command.type, id: command.id, success: false, error: `Unknown agent: ${id}` });
        return;
      }
      if (row.status !== "parked") {
        frame({ type: "response", command: command.type, id: command.id, success: false, error: `Agent "${id}" is ${row.status} — only parked agents can be revived.` });
        return;
      }
      row.status = "idle";
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: { id, revived: true } });
      return;
    }
    if (operation === "extensions.list") {
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: { roots: { explicit: [], mode: "merge", configured: ["/tmp/fixture-project"], configuredLevel: "project" }, extensions: [{ id: "mcp:fixture-echo", kind: "mcp", name: "fixture-echo", displayName: "fixture-echo", description: "Echo server", descriptionTruncated: false, path: "/tmp/fixture-project/.omp/mcp.json", source: { provider: "mcp", providerName: "MCP", level: "project" }, state: "active" }], truncated: false, total: 1 } });
      return;
    }
    if (operation === "extensions.set") {
      const id = command.payload?.id;
      const enabled = command.payload?.enabled;
      if (id === "mcp:missing") {
        frame({ type: "response", command: command.type, id: command.id, success: false, error: "Unknown extension: mcp:missing from fixture" });
        return;
      }
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: { roots: { explicit: [], mode: "merge", configured: ["/tmp/fixture-project"], configuredLevel: "project" }, extensions: [{ id: "mcp:fixture-echo", kind: "mcp", name: "fixture-echo", displayName: "fixture-echo", description: "Echo server", descriptionTruncated: false, path: "/tmp/fixture-project/.omp/mcp.json", source: { provider: "mcp", providerName: "MCP", level: "project" }, state: enabled === false ? "disabled" : "active", ...(enabled === false ? { disabledReason: "item-disabled" } : {}) }], truncated: false, total: 1 } });
      return;
    }
    if (operation === "prewalk.state.get") {
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: { armed: true } });
      return;
    }
    if (operation === "loop.state.get") {
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: loopResult() });
      return;
    }
    if (operation === "loop.set") {
      fixtureLoop = { enabled: false, paused: false, limit: null, condition: null, hasPrompt: false };
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: loopResult() });
      return;
    }
    if (operation === "python.exec") {
      const code = typeof command.payload?.code === "string" ? command.payload.code : "";
      // The real kernel answers the bounded result; the fixture names the code, which is
      // also how a replay test tells a re-run apart from a receipt.
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: { exitCode: 0, output: `fixture python for ${code.slice(0, 32)}`, outputTruncated: false, cancelled: false, displayOutputs: 0 } });
      return;
    }
    if (operation === "python.abort") {
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: { aborted: true } });
      return;
    }
    if (operation === "pause.set") {
      fixturePaused = command.payload?.paused === true;
      fixturePausedAt = fixturePaused ? Date.now() : undefined;
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: pausedResult() });
      return;
    }
    if (operation === "context.get") {
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: contextResult() });
      return;
    }
    if (operation === "context.drop-images") {
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: { ...contextResult(), removed: 0 } });
      return;
    }
    if (operation === "context.abort-compaction") {
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: contextResult() });
      return;
    }
    if (operation === "context.shake") {
      response(command.type, command.id, {
        operation,
        capabilityRevision: "fixture-capabilities",
        result: {
          ...contextResult(),
          shake: {
            mode: command.payload?.mode,
            toolResultsDropped: 0,
            blocksDropped: 0,
            ...(command.payload?.mode === "images" ? { imagesDropped: 0 } : {}),
            ...(command.payload?.mode === "thinking" ? { thinkingBlocksDropped: 0 } : {}),
            tokensFreed: 0,
          },
        },
      });
      return;
    }
    if (operation === "memory.get") {
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: { ...fixtureMemory } });
      return;
    }
    if (operation === "memory.apply") {
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: { ...fixtureMemory, applied: true } });
      return;
    }
    if (operation === "usage.get") {
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: fixtureUsage });
      return;
    }
    if (operation === "model.state.get") {
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: modelStateResult() });
      return;
    }
    if (operation === "auth.accounts.list") {
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: accountsResult() });
      return;
    }
    if (operation === "auth.account.pin") {
      response(command.type, command.id, {
        operation,
        capabilityRevision: "fixture-capabilities",
        result: { pinned: mode !== "account-pin-refused", list: accountsResult() },
      });
      return;
    }
    if (operation === "model.roles.get") {
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: fixtureRoles });
      return;
    }
    if (operation === "model.roles.set") {
      const role = command.payload?.role;
      const modelId = command.payload?.modelId === undefined ? undefined : command.payload?.modelId;
      if (typeof role !== "string" || role.trim().length === 0) {
        frame({ type: "response", command: command.type, id: command.id, success: false, error: "model.roles.set needs a role name from fixture" });
        return;
      }
      if (modelId !== null && (typeof modelId !== "string" || modelId.trim().length === 0)) {
        frame({ type: "response", command: command.type, id: command.id, success: false, error: "model.roles.set needs a model id, or null to clear the role, from fixture" });
        return;
      }
      // Mirror the runtime: assigning answers the roles table that follows;
      // clearing removes the row so the role falls back to default resolution.
      const kept = fixtureRoles.roles.filter(row => row.role !== role);
      fixtureRoles.roles = modelId === null ? kept : [...kept, { role, modelId, source: "global" }];
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: fixtureRoles });
      return;
    }
    if (operation === "model.roles.apply") {
      const role = command.payload?.role;
      const entry = fixtureRoles.roles.find(row => row.role === role);
      if (!entry) {
        frame({ type: "response", command: command.type, id: command.id, success: false, error: `No model is configured for role "${String(role)}" from fixture` });
        return;
      }
      const [provider, ...rest] = String(entry.modelId).split("/");
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: { role, provider, model: rest.join("/") } });
      return;
    }
    if (operation === "model.service-tier.set") {
      if (mode === "service-tier-refused") {
        frame({ type: "response", command: command.type, id: command.id, success: false, error: "Unknown service-tier family from fixture" });
        return;
      }
      const result = serviceTierResult(command.payload);
      response(command.type, command.id, {
        operation,
        capabilityRevision: "fixture-capabilities",
        result: mode === "service-tier-malformed" ? { ...result, tier: 7 } : result,
      });
      return;
    }
    if (operation === "credits.get") {
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: fixtureCredits });
      return;
    }
    if (operation === "credits.redeem") {
      response(command.type, command.id, {
        operation,
        capabilityRevision: "fixture-capabilities",
        result: {
          ok: true,
          code: "reset",
          ...(typeof command.payload?.accountId === "string" ? { accountId: command.payload.accountId } : {}),
          ...(typeof command.payload?.email === "string" ? { email: command.payload.email } : {}),
          creditId: "credit-1",
        },
      });
      return;
    }
    if (operation === "history.state") {
      const result = mode === "history-malformed-state"
        ? { ...fixtureHistoryState, checkpoint: { ...fixtureHistoryState.checkpoint, messageCount: "3" } }
        : fixtureHistoryState;
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result });
      return;
    }
    if (operation === "history.transcript") {
      const result = mode === "history-malformed-transcript"
        ? { ...fixtureHistoryTranscript, bytes: "26" }
        : fixtureHistoryTranscript;
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result });
      return;
    }
    if (operation === "tree.get") {
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: treeResult() });
      return;
    }
    if (operation === "tools.catalog.get") {
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: toolsCatalogResult() });
      return;
    }
    if (operation === "tools.refresh-skills") {
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: toolsCatalogResult() });
      return;
    }
    if (operation === "tools.active.set") {
      const names = command.payload?.toolNames;
      if (!Array.isArray(names)) {
        frame({ type: "response", command: command.type, id: command.id, success: false, error: "Fixture tools need toolNames" });
        return;
      }
      enabledToolNames = names.filter(name => typeof name === "string");
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: toolsCatalogResult() });
      return;
    }
    if (operation === "tree.navigate") {
      if (mode === "tree-navigate-error") {
        frame({ type: "response", command: command.type, id: command.id, success: false, error: "Fixture tree entry does not exist" });
        return;
      }
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: treeNavigateResult(command.payload) });
      return;
    }
    if (operation === "context.reset") {
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: { reset: true } });
      return;
    }
    if (operation === "session.fresh") {
      response(command.type, command.id, { operation, capabilityRevision: "fixture-capabilities", result: { fresh: true, providerSessionId: "fixture-provider-session" } });
      return;
    }
    frame({ type: "response", command: command.type, id: command.id, success: false, error: `Unsupported fixture cedia_control operation: ${String(operation)}` });
    return;
  }
  if (command.type === "cedia_pending_model") {
    // Validation happens on acceptance, exactly like the patched runtime.
    if (command.modelId !== undefined && !fixtureModels.includes(command.modelId)) {
      frame({ type: "response", command: command.type, id: command.id, success: false, error: `Model not found: ${command.provider}/${command.modelId}` });
      return;
    }
    pendingModel = { revision: command.revision, provider: command.provider, modelId: command.modelId, thinkingLevel: command.thinkingLevel };
    response(command.type, command.id, { revision: command.revision, acceptedAt: new Date().toISOString() });
    return;
  }
  if (command.type === "follow_up" || command.type === "steer") {
    if (command.cediaIntentId !== undefined) {
      const side = command.type === "steer" ? "steering" : "followUp";
      queuedIntents.push({ intentId: command.cediaIntentId, kind: side === "steering" ? "steer" : "followUp" });
      fixtureQueue[side].push({ text: String(command.message ?? ""), truncated: false, images: Array.isArray(command.images) ? command.images.length : 0 });
      fixtureQueueIntentIds[side].push(command.cediaIntentId);
    }
    response(command.type, command.id, { fixture: command.type });
    return;
  }
  if (command.type === "negotiate_protocol") {
    response(command.type, command.id, { protocolVersion: command.protocolVersion });
    return;
  }
  if (command.type === "get_state") {
    const materialized = forkSessionFile;
    if (typeof materialized === "string") {
      mkdirSync(dirname(materialized), { recursive: true });
      writeFileSync(materialized, "fixture-session\n");
    }
    response(command.type, command.id, { sessionFile: forkSessionFile, fixture: "cedia-host", todoPhases: fixtureTodoPhases });
    if (mode === "exit-after-start") setTimeout(() => process.exit(17), 10);
    return;
  }
  if (command.type === "get_available_models") {
    if (mode === "session-models-refuse") {
      frame({ type: "response", command: command.type, id: command.id, success: false, error: "Live model catalog unavailable" });
      return;
    }
    if (mode === "session-models") {
      response(command.type, command.id, { models: [
        { id: "ephemeral-model", provider: "fixture-live", label: "Ephemeral live model" },
      ] });
      return;
    }
    response(command.type, command.id, { fixture: command.type });
    return;
  }
  if (command.type === "set_todos") {
    fixtureTodoPhases = command.phases;
    response(command.type, command.id, { todoPhases: fixtureTodoPhases });
    return;
  }
  if (command.type === "get_messages") {
    response(command.type, command.id, { messages: [{ role: "user", text: "inherited" }] });
    return;
  }
  if (command.type === "host_tool_result" && command.id === "native-permission-call") {
    const outcome = JSON.parse(command.result.content[0].text);
    frame({ type: "fixture_permission_outcome", outcome });
    frame({ type: "prompt_result", id: permissionPromptId, result: outcome });
    frame({ type: "agent_end", isTerminal: true }); return;
  }
  if (command.type === "prompt") {
    if (mode === "native-permission") {
      permissionPromptId = command.id;
      response(command.type, command.id, { accepted: true });
      frame({ type: "host_tool_call", id: "native-permission-call", toolCallId: "native-tool-1", toolName: "cedia_native_permission", arguments: { kind: "permission", toolCall: { toolCallId: "native-tool-1", toolName: "bash", title: "Run command?", rawInput: { command: "printf fixture" } }, options: [{ optionId: "allow_once", name: "Allow once", kind: "allow_once" }, { optionId: "reject_once", name: "Reject", kind: "reject_once" }] } }); return;
    }
    if (mode === "local-only") {
      response(command.type, command.id, { accepted: true, agentInvoked: false, fixture: "local-only" });
      return;
    }
    // `hold-turn` accepts the prompt and reports the turn starting, then stays silent: the
    // fixture a test uses to observe what Cedia knows while a turn is still running.
    if (mode === "hold-turn" || mode === "queue-boundaries") {
      response(command.type, command.id, { accepted: true, fixture: "hold-turn" });
      runningIntentId = command.cediaIntentId;
      frame({
        type: "agent_start",
        id: `agent-${command.id}`,
        ...(command.cediaIntentId === undefined ? {} : { cediaIntentId: command.cediaIntentId }),
        cediaModel: "fixture/fixture-model",
        cediaThinkingLevel: "medium",
      });
      return;
    }
    response(command.type, command.id, { accepted: true, fixture: "prompt" });
    if (mode === "exit-after-ack") {
      setTimeout(() => process.exit(17), 10);
      return;
    }
    setTimeout(() => {
      // A held revision is committed here, at the boundary that starts the next turn.
      if (pendingModel) {
        appliedModel = { revision: pendingModel.revision, ...(pendingModel.modelId === undefined ? {} : { model: { provider: pendingModel.provider, id: pendingModel.modelId } }), appliedAt: new Date().toISOString() };
        runningModelId = pendingModel.modelId;
        pendingModel = undefined;
      }
      runningIntentId = command.cediaIntentId;
      // A runtime with the turn bridge names the submission on every boundary of its turn.
      // A bridge-aware runtime names the submission and the model it is running it with.
      const named = {
        ...(command.cediaIntentId === undefined ? {} : { cediaIntentId: command.cediaIntentId }),
        cediaModel: `fixture/${runningModelId ?? "fixture-model"}`,
        cediaThinkingLevel: "medium",
      };
      frame({ type: "agent_start", id: `agent-${command.id}`, ...named });
      frame({ type: "turn_start", ...named });
      frame({ type: "prompt_result", id: command.id, result: { text: "fixture complete" } });
      frame({ type: "turn_end", ...named });
      runningIntentId = undefined;
      runningModelId = undefined;
      queuedIntents.length = 0;
      fixtureQueue.steering.length = 0;
      fixtureQueue.followUp.length = 0;
      fixtureQueueIntentIds.steering.length = 0;
      fixtureQueueIntentIds.followUp.length = 0;
      frame({ type: "agent_end", id: `end-${command.id}`, isTerminal: true, reason: "completed", ...named });
    }, 5);
    return;
  }
  if (command.type === "handoff" && mode === "handoff-no-end") {
    response(command.type, command.id, { accepted: true, fixture: "handoff-no-end" });
    return;
  }
  if (command.type === "bash") {
    if (mode === "queue-boundaries") {
      if (command.command === "fixture:tool-round") {
        frame({ type: "turn_end", cediaIntentId: runningIntentId });
        frame({ type: "turn_start", cediaIntentId: runningIntentId });
      } else if (command.command === "fixture:follow-up-batch") {
        const next = queuedIntents.splice(0).map(entry => entry.intentId);
        frame({ type: "cedia_turn_boundary", completedIntentIds: [runningIntentId], runningIntentIds: next });
        runningIntentId = next[0];
        runningModelId = "fixture-model-2";
        runningBatchIds = next;
        fixtureQueue.followUp.length = 0;
        fixtureQueueIntentIds.followUp.length = 0;
        frame({ type: "turn_start", cediaIntentId: runningIntentId, cediaModel: "fixture/fixture-model-2", cediaThinkingLevel: "medium" });
      } else if (command.command === "fixture:finish-batch") {
        frame({ type: "cedia_turn_boundary", completedIntentIds: runningBatchIds, runningIntentIds: [] });
        frame({ type: "agent_end", cediaIntentId: runningIntentId, isTerminal: true });
        runningIntentId = undefined;
        runningBatchIds = [];
      }
    }
    // The real runtime answers its own BashResult; the fixture mirrors that shape so host
    // tests prove strict parsing instead of a second shape. Output names the command, which
    // is also how a replay test tells a re-run apart from a receipt.
    const text = typeof command.command === "string" ? command.command : "";
    const output = `fixture output for ${text}`;
    response(command.type, command.id, {
      output,
      exitCode: 0,
      cancelled: false,
      truncated: false,
      totalLines: 1,
      totalBytes: output.length,
      outputLines: 1,
      outputBytes: output.length,
    });
    return;
  }
  if (command.type === "abort_bash") {
    response(command.type, command.id, {});
    return;
  }
  if (command.type === "set_host_tools") {
    response(command.type, command.id, { toolNames: (command.tools ?? []).map(tool => tool.name) });
    return;
  }
  // The patched runtime answers which schemes it installed, and the host treats a missing one as a
  // failure, so the fixture models that answer and a test host exercises the same check.
  if (command.type === "set_host_uri_schemes") {
    // A startup-gate probe: refuse the first install with the runtime startup code so a test
    // host can prove session startup defers the schemes instead of failing it.
    if ((process.env.CEDIA_FAKE_SCHEMES_GATE === "startup-once" || process.env.CEDIA_FAKE_SCHEMES_GATE === "startup-once-then-refuse") && !gatedSchemesOnce) {
      gatedSchemesOnce = true;
      frame({ type: "response", command: command.type, id: command.id, success: false, error: "Complete the startup interaction before sending this command", code: "cedia_initializing" });
      return;
    }
    if (process.env.CEDIA_FAKE_SCHEMES_GATE === "startup-once-then-refuse") {
      frame({ type: "response", command: command.type, id: command.id, success: false, error: "Schemes are not supported by this runtime" });
      return;
    }
    response(command.type, command.id, { schemes: (command.schemes ?? []).map(entry => entry.scheme) });
    return;
  }
  response(command.type, command.id, { fixture: command.type });
};

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", line => {
  if (!line.trim()) return;
  try { handle(JSON.parse(line)); } catch { /* malformed fixture input is ignored */ }
});
input.on("close", () => process.exit(0));
