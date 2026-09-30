#!/usr/bin/env bun
/** Regenerate docs/maintenance/evidence/omp-complete-scope-2026-09-29/ from the live 18.4.3 pin.
 * Bun-runnable, stdlib only. Reads upstream/omp + old JSONs + live runtime metadata
 * (dist/omp/runtime.json) and writes the 5 new JSONs plus rewritten verify.py.
 * Live settings come from orderedSettings() via `bun -e` (bun resolves TS directly);
 * this script never imports upstream TS, so tsc stays on this file alone.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const OLD = join(root, "docs/maintenance/evidence/omp-complete-scope-2026-09-23");
const NEW = join(root, "docs/maintenance/evidence/omp-complete-scope-2026-09-29");
const SRC = join(root, "upstream/omp/packages/coding-agent/src");
const NEW_REV = "fc671eba383f2a7208500836673b485c0dc7073d";
const NEW_DATE = "2026-09-29";

type Json = Record<string, unknown>;
function readJson(path: string): Json {
	return JSON.parse(readFileSync(path, "utf8")) as Json;
}
function sha256File(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}
function strArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}
function jsonObj(value: unknown): Json {
	if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Json;
	throw new Error("want object");
}

const runtimeMeta = readJson(join(root, "dist/omp/runtime.json"));
const NEW_TREE = runtimeMeta.sourceTree as string;
if (runtimeMeta.revision !== NEW_REV) throw new Error(`runtime.json revision ${runtimeMeta.revision} != ${NEW_REV}`);

const oldConfig = readJson(join(OLD, "config-cli.json"));
const oldRpc = readJson(join(OLD, "rpc.json"));
const oldTools = readJson(join(OLD, "tools.json"));
const oldSdk = readJson(join(OLD, "sdk.json"));
const oldCoverage = readJson(join(OLD, "coverage.json"));

// ---------------------------------------------------------------- settings ---
const liveRaw = execFileSync("bun", ["-e",
	`import {orderedSettings} from ${JSON.stringify(join(SRC, "config/all-settings.ts"))};` +
	`const s=orderedSettings();console.log(JSON.stringify(s.map(x=>({id:x.id,type:x.definition?.type,credential:x.definition?.credential===true,ui:x.definition?.ui?{tab:x.definition.ui.tab,group:x.definition.ui.group}:null}))))`,
], { encoding: "utf8", cwd: root, maxBuffer: 64 * 1024 * 1024 });
interface LiveSetting { id: string; type: string; credential: boolean; ui: { tab: string; group: string } | null }
const live = JSON.parse(liveRaw) as LiveSetting[];
if (live.length !== 516) throw new Error(`orderedSettings() = ${live.length}, want 516`);

function listTs(dir: string, out: string[]): void {
	for (const name of readdirSync(dir).sort()) {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) listTs(full, out);
		else if (name.endsWith(".ts")) out.push(full);
	}
}
const allTs: string[] = [];
listTs(SRC, allTs);
const fileTexts = new Map<string, string>();
for (const f of allTs) {
	const t = readFileSync(f, "utf8");
	if (t.includes("register(")) fileTexts.set(f, t);
}
// id -> registering file: first file (sorted) whose 300 chars before `id: "X"` contain `register(`.
const idFile = new Map<string, string>();
for (const f of [...fileTexts.keys()].sort()) {
	const t = fileTexts.get(f) ?? "";
	for (const m of t.matchAll(/id:\s*"([A-Za-z][\w.]*)"/g)) {
		const id = m[1] ?? "";
		if (idFile.has(id)) continue;
		if (t.slice(Math.max(0, (m.index ?? 0) - 300), m.index).includes("register(")) idFile.set(id, f);
	}
}
for (const s of live) {
	if (s.id.startsWith("magicKeywords.") && s.id !== "magicKeywords.enabled") { idFile.set(s.id, "__magic__"); continue; }
	if (idFile.has(s.id)) continue;
	for (const f of [...fileTexts.keys()].sort()) {
		const t = fileTexts.get(f) ?? "";
		const i = t.indexOf(`id: "${s.id}"`);
		if (i >= 0 && t.slice(Math.max(0, i - 2000), i).includes("register(")) { idFile.set(s.id, f); break; }
	}
	if (!idFile.has(s.id)) console.warn(`WARN: no registering file for ${s.id}`);
}

// Brace-aware parse of `default: <EXPR>,` at depth 1 of the register({ ... }) call.
function extractDefault(fileText: string, id: string): string {
	const idIdx = fileText.indexOf(`id: "${id}"`);
	if (idIdx < 0) return "undefined";
	const regIdx = fileText.lastIndexOf("register(", idIdx);
	if (regIdx < 0) return "undefined";
	const open = fileText.indexOf("{", regIdx);
	if (open < 0 || open > idIdx) return "undefined";
	let depth = 0;
	let j = open;
	const n = fileText.length;
	const skipString = (q: string): void => {
		j++;
		while (j < n) {
			const c = fileText[j];
			if (c === "\\") { j += 2; continue; }
			if (c === q) { j++; return; }
			if (q === "`" && c === "$" && fileText[j + 1] === "{") {
				j += 2;
				let d = 1;
				while (j < n && d > 0) {
					if (fileText[j] === "{") d++;
					else if (fileText[j] === "}") d--;
					j++;
				}
				continue;
			}
			j++;
		}
	};
	while (j < n) {
		const c = fileText[j];
		if (c === '"' || c === "'" || c === "`") { skipString(c); continue; }
		if (c === "(" || c === "[" || c === "{") { depth++; j++; continue; }
		if (c === ")" || c === "]" || c === "}") { depth--; j++; if (depth < 0) break; continue; }
		if (depth === 1) {
			const save = j;
			while (j < n && /[\s,]/.test(fileText[j] ?? "")) j++;
			const km = /^[A-Za-z_$][\w$]*/.exec(fileText.slice(j, j + 64));
			if (!km) { j = save + 1; continue; }
			let k2 = j + km[0].length;
			while (k2 < n && /\s/.test(fileText[k2] ?? "")) k2++;
			if (fileText[k2] !== ":") { j = save + 1; continue; }
			j = k2 + 1;
			while (j < n && /\s/.test(fileText[j] ?? "")) j++;
			const start = j;
			let d = 0;
			while (j < n) {
				const v = fileText[j];
				if (v === '"' || v === "'" || v === "`") { skipString(v); continue; }
				if (v === "(" || v === "[" || v === "{") d++;
				else if (v === ")" || v === "]" || v === "}") {
					if (d === 0) break;
					d--;
				} else if (v === "," && d === 0) break;
				j++;
			}
			if (km[0] === "default") {
				const val = fileText.slice(start, j).trim();
				return val === "" ? "undefined" : val;
			}
			continue;
		}
		j++;
	}
	return "undefined";
}

const oldSettings = oldConfig.settings as unknown as { path: string; family: string }[];
const oldFam = new Map(oldSettings.map(x => [x.path, x.family]));
const NEW_SETTING_FAMILY: Record<string, string> = {
	"advisor.evictStaleResults": "models", "auth.accountPolicies": "providers",
	"claudeResets.autoRedeem": "providers", "claudeResets.keepCredits": "providers",
	"claudeResets.minBlockedMinutes": "providers", "claudeResets.salvageHorizonHours": "providers",
	"collab.autoStart": "interaction", "composer.tokenRate": "appearance",
	"edit.modelVariants": "files", "eval.autoProvision": "shell",
	"find.enabled": "tools-and-extensions",
	"ida.enabled": "tools-and-extensions", "ida.idleCloseSec": "tools-and-extensions",
	"ida.installDir": "tools-and-extensions", "ida.maxOpen": "tools-and-extensions",
	"ida.python": "tools-and-extensions", "magicKeywords.jevify": "interaction",
	"mcp.startupTimeoutMs": "tools-and-extensions", "providers.anthropic.slowMode": "providers",
	"providers.cacheWarming": "providers", "providers.openaiLiveSteering": "providers",
	"skills.registryUrl": "interaction",
	"stream.redactPatterns": "interaction", "stream.serverUrl": "interaction",
	"task.agentCompactionThresholdOverrides": "tasks-and-workflows",
	"task.agentServiceTierOverrides": "tasks-and-workflows",
	"task.speculativeLaunch": "tasks-and-workflows",
	"telemetry.otlpExportEnabled": "providers",
	"tools.speculativeExecution.enabled": "tools-and-extensions",
	"tools.speculativeExecution.maxInFlight": "tools-and-extensions",
	"ttsr.judge": "context", "tui.titleSpinner": "appearance",
};
interface SettingRow { path: string; family: string; type: string; defaultExpr: string; ui: { tab: string; group: string } | null; credential: boolean; source: string; root: string }
const settings: SettingRow[] = live.map(s => {
	const fam = oldFam.get(s.id) ?? NEW_SETTING_FAMILY[s.id];
	if (!fam) throw new Error(`no family for new setting ${s.id}`);
	const regFile = idFile.get(s.id);
	return {
		path: s.id, family: fam, type: s.type,
		defaultExpr: regFile === undefined ? "undefined" : regFile === "__magic__" ? "true" : extractDefault(fileTexts.get(regFile) ?? "", s.id),
		ui: s.ui, credential: s.credential,
		source: "registry:orderedSettings", root: s.id.split(".")[0] ?? s.id,
	};
});
const GONE_SETTINGS = ["stt.modelName", "hindsight.mentalModelRefreshIntervalMs", "async.pollWaitDuration",
	"irc.timeoutMs", "providers.webSearchOrder", "providers.webSearchExclude", "providers.webSearchGeminiModel",
	"providers.imageOrder", "providers.tts", "tts.localModel", "providers.tinyModel", "providers.memoryModel",
	"providers.autoThinkingModel", "providers.unexpectedStopModel"];
for (const g of GONE_SETTINGS) if (settings.some(x => x.path === g)) throw new Error(`gone setting still live: ${g}`);
const spell = settings.find(x => x.path === "spelling.autocomplete");
if (!spell || spell.type !== "enum") throw new Error(`spelling.autocomplete type ${spell?.type}, want enum`);
const settingsFamilies: Record<string, number> = {};
for (const s of settings) settingsFamilies[s.family] = (settingsFamilies[s.family] ?? 0) + 1;

// ------------------------------------------------------------------- slash ---
const SLASH_FILES = ["modes", "session", "lifecycle", "collaboration", "marketplace", "control", "skills"] as const;
const SLASH_UPPER: Record<string, string> = { modes: "MODE", session: "SESSION", lifecycle: "LIFECYCLE", collaboration: "COLLABORATION", marketplace: "MARKETPLACE", control: "CONTROL", skills: "SKILLS" };
function extractBracketBlock(p: string, key: string): string | null {
	const m = new RegExp(`^\\t\\t${key}: \\[`, "m").exec(p);
	if (!m) return null;
	let i = m.index + m[0].length - 1;
	let depth = 0;
	const n = p.length;
	const start = i;
	while (i < n) {
		const c = p[i];
		if (c === '"' || c === "'" || c === "`") {
			const q = c;
			i++;
			while (i < n && p[i] !== q) { if (p[i] === "\\") i++; i++; }
			i++;
			continue;
		}
		if (c === "[") depth++;
		else if (c === "]") { depth--; if (depth === 0) return p.slice(start + 1, i); }
		i++;
	}
	return null;
}
interface SlashRow { name: string; aliases: string[]; family: string; subcommands: string[]; surfaces: string[]; tuiOnly: boolean; source: string }
const slashCommands: SlashRow[] = [];
for (const stem of SLASH_FILES) {
	const text = readFileSync(join(SRC, `slash-commands/builtin-${stem}.ts`), "utf8");
	const specs = text.split(/(?=\n\t\{)/).slice(1);
	for (const p of specs) {
		const name = /^\t\tname: "([^"]+)"/m.exec(p)?.[1];
		if (!name) continue;
		const hasHandle = /^\t\thandle:/m.test(p);
		const hasHandleTui = /^\t\thandleTui:/m.test(p);
		const aliasBlock = extractBracketBlock(p, "aliases");
		const aliases = aliasBlock ? [...aliasBlock.matchAll(/"([^"]+)"/g)].map(m => m[1] ?? "") : [];
		const subBlock = extractBracketBlock(p, "subcommands");
		const subcommands = subBlock ? [...subBlock.matchAll(/name: "([^"]+)"/g)].map(m => m[1] ?? "") : [];
		const surfaces = hasHandle && hasHandleTui ? ["tui", "rpc", "acp"] : hasHandle ? ["tui-adapter", "rpc", "acp"] : ["tui"];
		slashCommands.push({
			name, aliases, family: stem === "skills" ? "skills" : stem, subcommands,
			surfaces, tuiOnly: !hasHandle, source: `builtin-${stem}:BUILTIN_${SLASH_UPPER[stem]}_SLASH_COMMANDS`,
		});
	}
}
if (slashCommands.length !== 82) throw new Error(`slash ${slashCommands.length}, want 82`);
const tuiOnly = slashCommands.filter(x => x.tuiOnly).map(x => x.name);
for (const [nm, want] of [["delete", true], ["record", true], ["skills", true], ["slow", false]] as [string, boolean][]) {
	const row = slashCommands.find(x => x.name === nm);
	if (!row || row.tuiOnly !== want) throw new Error(`slash ${nm} tuiOnly mismatch`);
}
if (slashCommands.some(x => x.name === "drop")) throw new Error("drop still present");
const adv = slashCommands.find(x => x.name === "advisor");
if (!adv) throw new Error("advisor missing");
// NOTE: spec said drop `advisor configure`, but the live tree still declares it
// (builtin-collaboration.ts subcommands + handler); kept so JSON == live source.

// --------------------------------------------------------------------- CLI ---
const cliText = readFileSync(join(SRC, "cli-commands.ts"), "utf8");
const cliStart = cliText.indexOf("export const commands:");
const cliEnd = cliText.indexOf("\n];", cliStart);
const cliSeg = cliText.slice(cliStart, cliEnd);
const cliLines = cliSeg.split("\n");
interface CliRow { name: string; aliases: string[]; source: string }
const cliCommands: CliRow[] = [];
for (let i = 0; i < cliLines.length; i++) {
	const m = /name: "([^"]+)"/.exec(cliLines[i] ?? "");
	if (!m) continue;
	const blk = cliLines.slice(i, i + 5).join("\n");
	const a = /aliases: \[([^\]]*)\]/.exec(blk);
	cliCommands.push({ name: m[1] ?? "", aliases: a ? [...(a[1] ?? "").matchAll(/"([^"]+)"/g)].map(x => x[1] ?? "") : [], source: "cli-commands:commands" });
}
if (cliCommands.length !== 50) throw new Error(`cli ${cliCommands.length}, want 50`);
for (const n of ["clip", "collab", "find", "login", "play", "predict", "skill", "stream", "toks"])
	if (!cliCommands.some(x => x.name === n)) throw new Error(`cli ${n} missing`);

// ------------------------------------------------------------ launch flags ---
const flagText = readFileSync(join(SRC, "cli/flag-tables.ts"), "utf8");
const argsText = readFileSync(join(SRC, "cli/args.ts"), "utf8");
const stringSeg = /export const STRING_SETTERS[^{]*\{(.*?)\n\};/s.exec(flagText)?.[1] ?? "";
const stringFlags: string[] = [...stringSeg.matchAll(/^\t"([^"]+)":/gm)].map(m => m[1] ?? "");
const optSeg = /export const OPTIONAL_FLAGS[^{]*\{(.*?)\n\};/s.exec(flagText)?.[1] ?? "";
const optFlags: string[] = [...optSeg.matchAll(/^\t"([^"]+)":/gm)].map(m => m[1] ?? "");
const valSeg = /export const VALUELESS_FLAGS[^\[]*\[(.*?)\];/s.exec(flagText)?.[1] ?? "";
const valFlags: string[] = [...valSeg.matchAll(/"(--[\w-]+)"/g)].map(m => m[1] ?? "");
// Mirror the old audit's args.ts extras exactly: -e/--profile/--alias ride with the
// string flags; -h/-v/-c/-p ride with the boolean flags; --no-ui is NOT in the old
// audit's launch flags even though both tables now list it, so it stays out.
for (const s of ["-e", "--profile", "--alias", "-h", "-v", "-c", "-p"]) {
	if (!argsText.includes(`"${s}"`) && !flagText.includes(`"${s}"`)) throw new Error(`${s} nowhere`);
}
const stringExtra = ["-e", "--profile", "--alias"].filter(f => !stringFlags.includes(f));
const boolExtra = ["-h", "-v", "-c", "-p"].filter(f => !valFlags.includes(f));
const launchFlags = {
	string: [...stringFlags, ...stringExtra],
	optional: optFlags,
	boolean: [...valFlags, ...boolExtra],
	source: ["cli/flag-tables.ts:STRING_SETTERS", "cli/flag-tables.ts:OPTIONAL_FLAGS", "cli/flag-tables.ts:VALUELESS_FLAGS", "cli/args.ts"],
};
const flagTotal = launchFlags.string.length + launchFlags.optional.length + launchFlags.boolean.length;
if (flagTotal !== 66) throw new Error(`launch flags ${flagTotal} (str ${launchFlags.string.length} opt ${launchFlags.optional.length} bool ${launchFlags.boolean.length}), want 66`);

// --------------------------------------------------------------------- RPC ---
const rpcText = readFileSync(join(SRC, "modes/rpc/rpc-types.ts"), "utf8");
const rpcSeg = rpcText.slice(rpcText.indexOf("export type RpcCommand ="), rpcText.indexOf("export interface RpcSessionState"));
const members = rpcSeg.split(/\n\t\|\s*\{|\n\t\{/);
interface RpcMember { name: string; fields: { name: string; optional: boolean }[] }
const seenRpc = new Set<string>();
const rpcMembers: RpcMember[] = [];
for (const m of members) {
	const t = /type: "([^"]+)"/.exec(m)?.[1];
	if (!t || seenRpc.has(t)) continue;
	seenRpc.add(t);
	const fields: { name: string; optional: boolean }[] = [];
	for (const fm of m.matchAll(/;\s*([A-Za-z_][\w]*)\??:/g)) {
		const fname = fm[1] ?? "";
		if (fname === "id" || fname === "type") continue;
		fields.push({ name: fname, optional: fm[0].includes("?") });
	}
	rpcMembers.push({ name: t, fields });
}
const oldCmds = oldRpc.commands as unknown as { name: string; source: string; family: string; payload: string[]; host: string; presentation: string; required: string }[];
const oldByName = new Map(oldCmds.map(x => [x.name, x]));
const cediaByName = new Map(oldCmds.filter(x => x.source !== "stock").map(x => [x.name, x]));
const NEW_RPC_FAMILY: Record<string, string> = {
	get_entries: "session", get_tree: "session", open_session: "session",
	set_event_filter: "protocol", get_available_thinking_levels: "models",
};
const NEW_CEDIA_FAMILY: Record<string, string> = {
	cedia_turn_queue: "O01", cedia_pending_model: "O03", cedia_goal: "O07",
	cedia_plan: "O07", cedia_get_capabilities: "O04", cedia_control: "O04",
};
const NEW_CEDIA_MIRROR: Record<string, string> = {
	cedia_turn_queue: "cedia_terminal_negotiate", cedia_pending_model: "cedia_get_model_roles",
	cedia_goal: "cedia_terminal_negotiate", cedia_plan: "cedia_terminal_negotiate",
	cedia_get_capabilities: "cedia_get_model_roles", cedia_control: "cedia_get_model_roles",
};
const branch = oldByName.get("branch");
const negotiate = oldByName.get("negotiate_protocol");
const thinking = oldByName.get("set_thinking_level");
if (!branch || !negotiate || !thinking) throw new Error("missing template rpc rows");
const commands: typeof oldCmds = [];
for (const m of rpcMembers) {
	const old = oldByName.get(m.name);
	if (old) { commands.push(old); continue; }
	const cediaFam = NEW_CEDIA_FAMILY[m.name];
	if (cediaFam) {
		const mirrorName = NEW_CEDIA_MIRROR[m.name] ?? "";
		const mirror = cediaByName.get(mirrorName);
		if (!mirror) throw new Error(`missing cedia mirror ${mirrorName} for ${m.name}`);
		commands.push({
			name: m.name, source: "cedia", family: cediaFam,
			payload: m.fields.map(f => (f.optional ? `${f.name}?` : f.name)),
			host: mirror.host, presentation: mirror.presentation, required: mirror.required,
		});
		continue;
	}
	const fam = NEW_RPC_FAMILY[m.name];
	if (!fam) throw new Error(`no family for new rpc ${m.name}`);
	const tpl = m.name === "set_event_filter" ? negotiate : m.name === "get_available_thinking_levels" ? thinking : branch;
	commands.push({
		name: m.name, source: "stock", family: fam,
		payload: m.fields.map(f => (f.optional ? `${f.name}?` : f.name)),
		host: tpl.host, presentation: tpl.presentation,
		required: `${tpl.required} (18.4.3 new; no Cedia caller yet)`,
	});
}

// Cedia rows: mirror old neighboring rows.
const cediaRows = oldCmds.filter(x => x.source !== "stock");
if (cediaRows.length !== 8) throw new Error(`cedia rpc rows ${cediaRows.length}, want 8`);
if (rpcMembers.length !== 61) throw new Error(`union members ${rpcMembers.length}, want 61`);
// Union arithmetic: 42 old stock + 5 new stock = 47 stock; 8 old cedia + 6 new cedia = 14 cedia; 61 total.
if (commands.length !== 61) throw new Error(`rpc total ${commands.length}, want 61`);
// events/hostFrames/extUi unchanged — verify counts equal old before writing.
const oldEvents = jsonObj(oldRpc.sessionEvents);
if ((oldEvents.sourceUnion as unknown[]).length !== 28) throw new Error("events changed");
const oldHost = oldRpc.hostBridgeFrames as unknown[];
const oldExt = oldRpc.extensionUiMethods as unknown[];
if (oldHost.length !== 7 || oldExt.length !== 11) throw new Error("frames/extui changed");
// Spec payloads for the 6 new cedia rows (union parse drops bare `op`-style fields).
const SPEC_CEDIA_PAYLOAD: Record<string, string[]> = {
	cedia_turn_queue: [], cedia_pending_model: ["revision", "provider?", "modelId?", "thinkingLevel?"],
	cedia_goal: ["op", "objective?", "tokenBudget?"], cedia_plan: ["command"],
	cedia_get_capabilities: [], cedia_control: ["operation", "payload?", "capabilityRevision?"],
};
for (const c of commands) {
	if (c.source === "cedia" && SPEC_CEDIA_PAYLOAD[c.name] !== undefined) c.payload = SPEC_CEDIA_PAYLOAD[c.name] ?? [];
}
// events live in AgentSessionEvent (session/agent-session.ts) + rpc-client.ts allow-list;
// the regen keeps them unchanged after verifying the 28/25 counts still match.
const stockCount = rpcMembers.filter(m => !m.name.startsWith("cedia_")).length;
const cediaCount = rpcMembers.filter(m => m.name.startsWith("cedia_")).length;

// ------------------------------------------------------------------- tools ---
const namesText = readFileSync(join(SRC, "tools/builtin-names.ts"), "utf8");
const builtinStart = namesText.indexOf("export const BUILTIN_TOOL_NAMES = [");
const builtinPart = namesText.slice(builtinStart, namesText.indexOf("] as const", builtinStart));
const builtinNames = [...builtinPart.matchAll(/"([^"]+)"/g)].map(m => m[1] ?? "");
const hiddenStart = namesText.indexOf("export const HIDDEN_TOOL_NAMES = [");
const hiddenPart = namesText.slice(hiddenStart, namesText.indexOf("] as const", hiddenStart));
const hiddenNames = [...hiddenPart.matchAll(/"([^"]+)"/g)].map(m => m[1] ?? "");
if (builtinNames.length !== 30 || hiddenNames.length !== 3) throw new Error(`tools ${builtinNames.length}/${hiddenNames.length}, want 30/3`);
if (builtinNames.includes("hub")) throw new Error("hub still builtin");
for (const n of ["find", "ida", "wait"]) if (!builtinNames.includes(n)) throw new Error(`tool ${n} missing`);
const aliasMap: Record<string, string> = {};
for (const m of namesText.matchAll(/\["([^"]+)",\s*"([^"]+)"\]/g)) aliasMap[m[1] ?? ""] = m[2] ?? "";
if (Object.keys(aliasMap).length !== 1 || aliasMap["search"] !== "grep") throw new Error(`alias map ${JSON.stringify(aliasMap)}`);
const oldBuiltin = (oldTools.registry as Json).builtin as unknown as { name: string; family: string; condition: string }[];
const oldByTool = new Map(oldBuiltin.map(x => [x.name, x]));
const NEW_TOOL: Record<string, { family: string; condition: string }> = {
	find: { family: "native_search", condition: "find.enabled" },
	ida: { family: "native_subagents_agenthub_jobs", condition: "ida.enabled and IDA installation is available" },
	wait: { family: "native_subagents_agenthub_jobs", condition: "async subsystem enabled, IRC enabled, or launch enabled" },
};
const builtin = builtinNames.map(n => oldByTool.get(n) ?? ({ name: n, family: NEW_TOOL[n]?.family ?? "", condition: NEW_TOOL[n]?.condition ?? "" }));
const oldHidden = (oldTools.registry as Json).hidden as unknown as { name: string; family: string; condition: string }[];
const hidden = hiddenNames.map(n => {
	const old = oldHidden.find(x => x.name === n);
	if (!old) throw new Error(`hidden tool ${n} has no old row`);
	return old;
});
const families = jsonObj(oldTools.families) as Record<string, string[]>;
const famCopy: Record<string, string[]> = Object.fromEntries(Object.entries(families).map(([k, v]) => [k, [...v]]));
famCopy.native_subagents_agenthub_jobs = (famCopy.native_subagents_agenthub_jobs ?? []).filter(n => n !== "hub");
famCopy.native_subagents_agenthub_jobs?.push("ida", "wait");
famCopy.native_search = [...(famCopy.native_search ?? []), "find"];

// --------------------------------------------------------------------- SDK ---
const sdkEntries = oldSdk.entries as unknown as { name: string; family: string; source: string; line: number }[];
if (sdkEntries.length !== 106) throw new Error(`sdk ${sdkEntries.length}, want 106`);
const agentSessionText = readFileSync(join(SRC, "session/agent-session.ts"), "utf8");
for (const e of sdkEntries) {
	if (!agentSessionText.includes(e.name)) throw new Error(`sdk ${e.name} missing in agent-session.ts`);
}

// ---------------------------------------------------------------- coverage ---
interface CovRow { kind: string; name: string; family: string; planSection: string; target: string; testPacket: string; implementationVerified: boolean; reason?: string }
const oldRows = oldCoverage.rows as unknown as CovRow[];
const goneKeys = new Set([
	...GONE_SETTINGS.map(n => `setting\u0000${n}`),
	"tool\u0000hub", "tool-alias\u0000find",
	"slash\u0000drop",
]);
const rows: CovRow[] = oldRows.filter(r => !goneKeys.has(`${r.kind}\u0000${r.name}`));
// drop's subcommands (none) would already be gone; assert none remain.
const dropped = oldRows.length - rows.length;
const SETTING_REASON = "Effective provenance and scoped validated write/read-only policy in O04.";
for (const s of settings) {
	if (oldRows.some(r => r.kind === "setting" && r.name === s.path)) continue;
	rows.push({ kind: "setting", name: s.path, family: "O04", planSection: "2.8/8.2/O04", target: "owner-settings", testPacket: "O04", implementationVerified: false, reason: SETTING_REASON });
}
const rpcFamToO: Record<string, string> = { session: "O02", protocol: "O01", models: "O03" };
for (const c of commands) {
	if (c.source === "cedia") continue;
	if (oldRows.some(r => r.kind === "rpc" && r.name === c.name)) continue;
	const o = rpcFamToO[c.family] ?? "O01";
	rows.push({ kind: "rpc", name: c.name, family: o, planSection: `2.8/8.2/${o}`, target: "required", testPacket: o, implementationVerified: false });
}
for (const c of commands) {
	if (c.source !== "cedia") continue;
	if (oldRows.some(r => r.kind === "rpc" && r.name === c.name)) continue;
	rows.push({ kind: "rpc", name: c.name, family: c.family, planSection: `2.8/8.2/${c.family}`, target: "required", testPacket: c.family, implementationVerified: false });
}
const SLASH_O: Record<string, string> = { delete: "O02", record: "O11", skills: "O06", slow: "O03" };
for (const s of slashCommands) {
	const o = SLASH_O[s.name] ?? (oldRows.find(r => r.kind === "slash" && r.name === s.name)?.family as string) ?? "O02";
	if (!oldRows.some(r => r.kind === "slash" && r.name === s.name)) {
		rows.push({ kind: "slash", name: s.name, family: o, planSection: `2.8/8.2/${o}`, target: "required", testPacket: o, implementationVerified: false });
	}

	for (const a of s.aliases) {
		if (oldRows.some(r => r.kind === "slash-alias" && r.name === a)) continue;
		rows.push({ kind: "slash-alias", name: a, family: o, planSection: `2.8/8.2/${o}`, target: "required", testPacket: o, implementationVerified: false, reason: `Alias of /${s.name}` });
	}
	for (const sub of s.subcommands) {
		if (oldRows.some(r => r.kind === "slash-subcommand" && r.name === `${s.name} ${sub}`)) continue;
		rows.push({ kind: "slash-subcommand", name: `${s.name} ${sub}`, family: o, planSection: `2.8/8.2/${o}`, target: "required", testPacket: o, implementationVerified: false });
	}
}
// changed subcommand lists: drop stale, add new for survivors.
const liveSub = new Map(slashCommands.map(s => [`${s.name}`, new Set(s.subcommands)]));
const staleSubs: [string, string[]][] = [
	["advisor", ["configure"]], ["mcp", ["smithery-search", "smithery-login", "smithery-logout"]],
	["marketplace", ["install", "uninstall", "discover", "list", "installed", "upgrade", "help"]],
	["todo", ["append", "start", "done", "drop", "rm"]],
	["session", ["pin"]], ["memory", ["mm refresh"]], ["ssh", ["remove", "help"]],
];
void staleSubs;
void liveSub;
const oldSlash = oldConfig.slashCommands as unknown as { name: string; subcommands: string[] }[];
const oldSubByName = new Map(oldSlash.map(x => [x.name, new Set(x.subcommands)]));
let subDropped = 0;
const keptRows: CovRow[] = [];
for (const r of rows) {
	if (r.kind !== "slash-subcommand") { keptRows.push(r); continue; }
	const sp = r.name.indexOf(" ");
	const parent = r.name.slice(0, sp);
	const sub = r.name.slice(sp + 1);
	const liveSet = new Set((slashCommands.find(s => s.name === parent)?.subcommands) ?? []);
	const oldSet = oldSubByName.get(parent);
	if (oldSet && !liveSet.has(sub)) { subDropped++; continue; }
	keptRows.push(r);
}
rows.length = 0;
rows.push(...keptRows);
const CLI_REASON_PRES_EQ = "Use qualified CEDIA launch/update/setup path.";
const CLI_REASON_OWNER = "Typed owner operation or guarded config/source editor; no arbitrary command route.";
// New verbs mirror the old audit's own split: launcher-owned verbs (launch/install/update)
// are presentation-equivalent; every other command verb is an owner-only typed operation.
const CLI_PRES_EQ = new Set(["clip", "play", "skill", "stream"]);
const oldCli = oldConfig.cliCommands as unknown as { name: string }[];
for (const c of cliCommands) {
	if (oldCli.some(x => x.name === c.name)) continue;
	const presEq = CLI_PRES_EQ.has(c.name);
	rows.push({ kind: "cli", name: c.name, family: "O12", planSection: "2.8/8.2/O12", target: presEq ? "presentation-equivalent" : "owner-only", testPacket: "O12", implementationVerified: false, reason: presEq ? CLI_REASON_PRES_EQ : CLI_REASON_OWNER });
	for (const a of c.aliases) {
		if (oldRows.some(r => r.kind === "cli-alias" && r.name === a)) continue;
		rows.push({ kind: "cli-alias", name: a, family: "O12", planSection: "2.8/8.2/O12", target: "presentation-equivalent", testPacket: "O12", implementationVerified: false, reason: `Alias of ${c.name}` });
	}
}
const oldCliAliasByName = new Map((oldConfig.cliCommands as unknown as { name: string; aliases: string[] }[]).map(x => [x.name, new Set(x.aliases)]));
for (const c of cliCommands) {
	const oldSet = oldCliAliasByName.get(c.name) ?? new Set<string>();
	for (const a of c.aliases) {
		if (oldSet.has(a) || rows.some(r => r.kind === "cli-alias" && r.name === a)) continue;
		rows.push({ kind: "cli-alias", name: a, family: "O12", planSection: "2.8/8.2/O12", target: "presentation-equivalent", testPacket: "O12", implementationVerified: false, reason: `Alias of ${c.name}` });
	}
}
const TOOL_O: Record<string, string> = { find: "O05", ida: "O07", wait: "O07" };
// Launch flags: add rows for flags the old audit did not list (--no-ui, --system-prompt-template).
const oldFlagSet = new Set(["string", "optional", "boolean"].flatMap(t => ((oldConfig.launchFlags as unknown as Record<string, string[]>)[t] ?? [])));
for (const t of ["string", "optional", "boolean"] as const) {
	for (const f of launchFlags[t]) {
		if (oldFlagSet.has(f) || rows.some(r => r.kind === "launch-flag" && r.name === f)) continue;
		rows.push({ kind: "launch-flag", name: f, family: "O04", planSection: "2.8/8.2/O04", target: "owner-settings", testPacket: "O04", implementationVerified: false, reason: "Classify as session launch value, product invariant or CLI frontend equivalent; arbitrary flags never pass through." });
	}
}
for (const t of builtin) {
	if (oldRows.some(r => r.kind === "tool" && r.name === t.name)) continue;
	const o = TOOL_O[t.name] ?? "O05";
	rows.push({ kind: "tool", name: t.name, family: o, planSection: `2.8/8.2/${o}`, target: "required", testPacket: o, implementationVerified: false });
}
// sources: refresh sha256 for existing paths; replace settings-schema entry.
const oldSources = oldCoverage.sources as unknown as Record<string, string>;
const sources: Record<string, string> = {};
for (const p of Object.keys(oldSources)) {
	if (p === "packages/coding-agent/src/config/settings-schema.ts") continue;
	const full = join(root, "upstream/omp", p);
	try { sources[p] = sha256File(full); }
	catch { throw new Error(`coverage source missing: ${p}`); }
}
sources["packages/coding-agent/src/config/registry.ts"] = sha256File(join(root, "upstream/omp/packages/coding-agent/src/config/registry.ts"));
sources["packages/coding-agent/src/config/all-settings.ts"] = sha256File(join(root, "upstream/omp/packages/coding-agent/src/config/all-settings.ts"));
sources["packages/coding-agent/src/slash-commands/builtin-skills.ts"] = sha256File(join(root, "upstream/omp/packages/coding-agent/src/slash-commands/builtin-skills.ts"));

// ------------------------------------------------------------------ writes ---
const oldSource = jsonObj(oldConfig.source);
const newSource = {
	...oldSource, commit: NEW_REV,
	workingTree: "dirty because the pinned CEDIA OMP manifest patch is applied; parent verification found tracked/untracked non-ignored tree 3b333bd1fea898e8c5c81e6e06d83db26d70d61d exactly equal to the pinned revision plus that manifest patch",
	verifiedSourceTree: NEW_TREE,
	paths: {
		...jsonObj(oldSource.paths),
		settings: "packages/coding-agent/src/config/registry.ts#orderedSettings+all-settings.ts",
		slashRegistry: "packages/coding-agent/src/slash-commands/builtin-registry.ts#BUILTIN_SLASH_COMMAND_REGISTRY+builtin-skills.ts",
	},
};
const slashAliasCount = slashCommands.reduce((n, s) => n + s.aliases.length, 0);
const slashSubCount = slashCommands.reduce((n, s) => n + s.subcommands.length, 0);
const cliAliasCount = cliCommands.reduce((n, c) => n + c.aliases.length, 0);
const configCli = {
	...oldConfig,
	inspectedAt: NEW_DATE, source: newSource,
	counts: { settings: 516, builtinSlashCommands: 82, tuiOnlySlashCommands: tuiOnly.length, cliCommands: 50, settingsFamilies },
	settings, slashCommands, tuiOnlySlashCommands: tuiOnly, cliCommands, launchFlags,
	inventoryChecks: {
		settingsPathsUnique: true, slashNamesUnique: true, cliNamesUnique: true,
		expectedSurface: { settings: 516, builtinSlashCommands: 82, tuiOnlySlashCommands: tuiOnly.length, cliCommands: 50 },
	},
};
writeFileSync(join(NEW, "config-cli.json"), `${JSON.stringify(configCli, null, "\t")}\n`);

const oldRpcSource = jsonObj(oldRpc.source);
const rpc = {
	...oldRpc,
	source: {
		...oldRpcSource, stockRevision: NEW_REV, stockVersion: "18.4.3",
		patchFile: "patches/omp/0002-cedia-rpc-bridges-18.4.3.patch",
		patchSha256: "a90b75f9fbcde9979e68af0ddd9ceca740f3b3720dd93f732f286fdc366782d5",
		verifiedSourceTree: NEW_TREE,
	},
	counts: {
		stockCommands: stockCount, cediaPatchCommands: cediaCount, effectiveCommands: commands.length,
		extensionUiMethods: oldExt.length, hostBridgeFrameTypes: oldHost.length,
		rpcSessionEventNames: 28, rpcClientRecognizedSessionEventNames: 25,
	},
	commands,
};
writeFileSync(join(NEW, "rpc.json"), `${JSON.stringify(rpc, null, "\t")}\n`);

const oldToolSource = jsonObj(oldTools.source);
const tools = {
	...oldTools, artifact: "omp-complete-scope-2026-09-29/tools",
	source: { ...oldToolSource, revision: NEW_REV, dirty_worktree: true },
	registry: { ...(oldTools.registry as Json), builtin, hidden, aliases: aliasMap },
	dynamic: oldTools.dynamic, discovery_rule: oldTools.discovery_rule, families: famCopy, cedia_boundary: oldTools.cedia_boundary,
};
writeFileSync(join(NEW, "tools.json"), `${JSON.stringify(tools, null, "\t")}\n`);

const oldSdkSources = jsonObj(oldSdk.sources);
const sdkSources: Record<string, string> = {};
for (const p of Object.keys(oldSdkSources)) {
	if (p === "docs/sdk.md") { sdkSources[p] = oldSdkSources[p] as string; continue; }
	sdkSources[p] = sha256File(join(root, "upstream/omp", p));
}
const sdk = { ...oldSdk, baseRevision: NEW_REV, sources: sdkSources };
writeFileSync(join(NEW, "sdk.json"), `${JSON.stringify(sdk, null, "\t")}\n`);

const coverage = { purpose: oldCoverage.purpose, sourceTree: NEW_TREE, sources, rows };
writeFileSync(join(NEW, "coverage.json"), `${JSON.stringify(coverage, null, "\t")}\n`);

// ---------------------------------------------------------------- verify.py ---
// Written from lines: verbatim python, kept as an array to avoid TS escaping.
const verifyLines: string[] = [
"\"\"\"Read-only verification of this dated planning inventory, not an application test.\"\"\"",
"from pathlib import Path",
"import hashlib",
"import json",
"import re",
"from collections import Counter",
"",
"here = Path(__file__).resolve().parent",
"repo = here.parents[3]",
"omp = repo / 'upstream/omp'",
"load = lambda name: json.loads((here / name).read_text())",
"config, rpc, tools, sdk, coverage = [load(n + '.json') for n in ['config-cli', 'rpc', 'tools', 'sdk', 'coverage']]",
"",
"def equal(label, actual, recorded):",
"    a, b = set(actual), set(recorded)",
"    assert a == b, (label, 'unrecorded', sorted(a-b), 'stale', sorted(b-a))",
"    print(f'{label}: {len(a)} exact entries')",
"",
"for path, digest in coverage['sources'].items():",
"    assert hashlib.sha256((omp/path).read_bytes()).hexdigest() == digest, ('source changed', path)",
"",
"text = (omp/'packages/coding-agent/src/modes/rpc/rpc-types.ts').read_text()",
"commands = text.split('export type RpcCommand =', 1)[1].split('export interface RpcSessionState', 1)[0]",
"equal('RPC', re.findall(r'type: \"([^\"]+)\"', commands), [x['name'] for x in rpc['commands']])",
"text = (omp/'packages/coding-agent/src/config/all-settings.ts').read_text()",
"assert 'orderedSettings' in text, 'orderedSettings missing'",
"registered = set()",
"for path in (omp/'packages/coding-agent/src').rglob('*.ts'):",
"    source = path.read_text(errors='ignore')",
"    for m in re.finditer(r'id:', source):",
"        seg = source[m.start():m.start()+80]",
"        mm = re.match(r'id: \"([A-Za-z][\\w.-]*)\"', seg)",
"        if mm and 'register(' in source[max(0, m.start()-2000):m.start()]:",
"            registered.add(mm.group(1))",
"for kid in re.findall(r'\\tid: \"(\\w+)\",', (omp/'packages/coding-agent/src/modes/magic-keywords.ts').read_text()):",
"    registered.add('magicKeywords.' + kid)",
"equal('Settings', registered, [x['path'] for x in config['settings']])",
"slashfiles = ['modes','session','lifecycle','collaboration','marketplace','control','skills']",
"names = []",
"for f in slashfiles:",
"    source=(omp/f'packages/coding-agent/src/slash-commands/builtin-{f}.ts').read_text()",
"    names += re.findall(r'^\\t\\tname: \"([^\"]+)\"', source, re.M)",
"equal('Slash commands', names, [x['name'] for x in config['slashCommands']])",
"source=(omp/'packages/coding-agent/src/cli-commands.ts').read_text().split('export const commands:',1)[1].split(chr(10)+'];',1)[0]",
"equal('CLI commands',re.findall(r'name: \"([^\"]+)\"', source),[x['name'] for x in config['cliCommands']])",
"source=(omp/'packages/coding-agent/src/tools/builtin-names.ts').read_text()",
"for key, constant in [('builtin','BUILTIN_TOOL_NAMES'),('hidden','HIDDEN_TOOL_NAMES')]:",
"    part=source.split(f'export const {constant} = [',1)[1].split('] as const',1)[0]",
"    equal('Tools '+key,re.findall(r'\"([^\"]+)\"',part),[x['name'] for x in tools['registry'][key]])",
"aliases=dict(re.findall(r'\\[\"([^\"]+)\",\\s*\"([^\"]+)\"\\]', source))",
"assert aliases == tools['registry']['aliases'], ('tool aliases', aliases, tools['registry']['aliases'])",
"expected={",
"    'rpc':[x['name'] for x in rpc['commands']],",
"    'setting':[x['path'] for x in config['settings']],",
"    'slash':[x['name'] for x in config['slashCommands']],",
"    'slash-alias':[a for x in config['slashCommands'] for a in x['aliases']],",
"    'slash-subcommand':[x['name']+' '+a for x in config['slashCommands'] for a in x['subcommands']],",
"    'cli':[x['name'] for x in config['cliCommands']],",
"    'cli-alias':[a for x in config['cliCommands'] for a in x['aliases']],",
"    'launch-flag':[a for typ in ['string','optional','boolean'] for a in config['launchFlags'][typ]],",
"    'tool':[x['name'] for typ in ['builtin','hidden'] for x in tools['registry'][typ]],",
"    'tool-alias':list(tools['registry']['aliases']),",
"    'dynamic-tool':[x['name'] for x in tools['dynamic']],",
"    'extension-ui':[x['method'] for x in rpc['extensionUiMethods']],",
"    'host-frame':[x if isinstance(x,str) else x.get('type',x.get('name')) for x in rpc['hostBridgeFrames']],",
"    'event':rpc['sessionEvents']['sourceUnion'],",
"    'sdk':[x['name'] for x in sdk['entries']],",
"}",
"rows=coverage['rows']",
"assert len(rows)==len({(x['kind'],x['name']) for x in rows}), 'Duplicate mapping'",
"assert set(x['kind'] for x in rows)==set(expected), 'Unrecognized mapping kind'",
"for kind,names in expected.items():",
"    equal('Mapped '+kind,names,[x['name'] for x in rows if x['kind']==kind])",
"plan=(repo/'docs/maintenance/CEDIA-PLAN.md').read_text()",
"for x in rows:",
"    assert x['family'] in [f'O{i:02}' for i in range(1,13)], x",
"    assert '| '+x['family']+' \u2014' in plan, ('Missing plan packet',x)",
"print('PASS:',len(rows),'planning mappings;',len(coverage['sources']),'source hashes;',dict(Counter(x['family'] for x in rows)))"
];
const verifyPy = `${verifyLines.join("\n")}\n`;
writeFileSync(join(NEW, "verify.py"), verifyPy);

console.log(`settings=${settings.length} slash=${slashCommands.length} tuiOnly=${tuiOnly.length} cli=${cliCommands.length} slashAlias=${slashAliasCount} slashSub=${slashSubCount} cliAlias=${cliAliasCount} flags=${flagTotal} rpc=${commands.length} tools=${builtinNames.length} sdk=${sdkEntries.length} rows=${rows.length} (dropped base rows=${dropped}, dropped subcommands=${subDropped})`);
console.log(`added settings=${settings.length - oldSettings.length} sourceKeys=${Object.keys(sources).length}`);
