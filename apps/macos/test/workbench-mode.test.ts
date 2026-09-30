import { describe, expect, it } from "bun:test";
import { AGENTS_EDITOR_SHOW_TABS, AGENTS_WINDOW_SUPPORT_SETTING, consumePendingNativeDestination, DEFAULT_IDE_LAYOUT, draftViewKey, isAgentsWindow, isCediaAgentsWindow, isCopilotAgentsWindow, mergeAgentsWindowWorkspaceSettings, modeSwitchProof, normalizeIdeLayout, persistDestinationAcrossReload, queuePendingNativeDestination, rememberIdeChrome, resolveSnapshotThemeName, resolveStartupView, retentionReceipt, runWorkbenchCommands, switchWorkbenchMode, themeProvidingExtensionIds } from "../src/workbench-mode.ts";
import { createInitialTaskState, reduceTaskState } from "../src/state.ts";
import type { Project, Session } from "../../../packages/protocol/src/index.ts";

const project = (id: string): Project => ({ id, name: id, path: `/${id}`, archived: false, pinned: false, createdAt: "now" });
const session = (id: string, projectId: string): Session => ({
	id, projectId, title: id, cwd: "/tmp", sessionFile: `/tmp/${id}.jsonl`, incarnation: "inc-1", status: "idle", archived: false, createdAt: "now", updatedAt: "now",
});

describe("Agent ↔ IDE workbench mode", () => {
	it("recognises both agent-window identities", () => {
		expect(isCediaAgentsWindow("/tmp/globalStorage/cedia-agents.code-workspace")).toBe(true);
		expect(isCopilotAgentsWindow("/User/agent-sessions.code-workspace")).toBe(true);
		expect(isAgentsWindow("/Users/pond/cedia")).toBe(false);
	});

	it("does not emit chrome commands when already in the requested mode", () => {
		expect(switchWorkbenchMode({ from: "agents", to: "agents", ideLayout: DEFAULT_IDE_LAYOUT }).commands).toEqual([]);
		expect(switchWorkbenchMode({ from: "ide", to: "ide", ideLayout: DEFAULT_IDE_LAYOUT }).commands).toEqual([]);
	});

	it("closes sidebar and auxiliary bar only when entering Agents", () => {
		const next = switchWorkbenchMode({ from: "ide", to: "agents", ideLayout: DEFAULT_IDE_LAYOUT });
		expect(next.mode).toBe("agents");
		expect(next.commands).toEqual([
			"workbench.action.closeSidebar",
			"workbench.action.closeAuxiliaryBar",
			"workbench.action.closePanel",
			"workbench.action.activityBarLocation.hide",
		]);
	});

	it("restores the saved IDE chrome instead of using startup defaults", () => {
		const layout = { sidebarVisible: true, auxiliaryBarVisible: true, panelVisible: false, activeEditorUri: "file:///tmp/a.ts" };
		const next = switchWorkbenchMode({ from: "agents", to: "ide", ideLayout: layout });
		expect(next.mode).toBe("ide");
		expect(next.ideLayout).toEqual(layout);
		expect(next.commands).toEqual(["workbench.view.explorer", "workbench.action.focusAuxiliaryBar"]);
		expect(next.commands).not.toContain("workbench.action.closeSidebar");
	});

	it("keeps drafts when switching A → B → A without changing session ownership fields", () => {
		const a = session("task-a", "proj-1");
		const b = session("task-b", "proj-1");
		let state = reduceTaskState(createInitialTaskState({ project: project("proj-1"), session: a }), { type: "draft", draft: "hello from A" });
		state = reduceTaskState(state, { type: "reset", project: project("proj-1"), session: b });
		expect(state.draft).toBe("");
		expect(state.session?.id).toBe("task-b");
		state = reduceTaskState(state, { type: "draft", draft: "notes on B" });
		state = reduceTaskState(state, { type: "reset", project: project("proj-1"), session: a });
		expect(state.draft).toBe("hello from A");
		expect(state.session?.id).toBe("task-a");
		expect(state.drafts[draftViewKey("proj-1", "task-b")]).toBe("notes on B");
	});

	it("uses window-local task selection while keeping each durable runtime identity distinct", () => {
		const a = session("task-a", "proj-1");
		const b = { ...session("task-b", "proj-1"), incarnation: "inc-b" };
		let state = createInitialTaskState({ project: project("proj-1"), session: a });
		state = reduceTaskState(state, { type: "reset", project: project("proj-1"), session: b });
		expect(state.session?.id).toBe("task-b");
		expect(state.session?.incarnation).toBe("inc-b");
		state = reduceTaskState(state, { type: "reset", project: project("proj-1"), session: a });
		expect(state.session?.id).toBe("task-a");
		expect(state.session?.incarnation).toBe("inc-1");
	});

	it("treats workbench mode as view state that survives task reset", () => {
		let state = reduceTaskState(createInitialTaskState({ session: session("task-a", "proj-1"), project: project("proj-1") }), { type: "workbench_mode", mode: "ide" });
		state = reduceTaskState(state, { type: "reset", project: project("proj-1"), session: session("task-b", "proj-1") });
		expect(state.workbenchMode).toBe("ide");
	});

	it("queues the latest pending native destination", () => {
		expect(queuePendingNativeDestination(undefined, "explorer")).toBe("explorer");
		expect(queuePendingNativeDestination("explorer", "explorer")).toBe("explorer");
	});

	it("makes a pending Explorer destination authoritative over remembered Agents mode", () => {
		expect(resolveStartupView({ pending: "explorer", rememberedMode: "agents", startupView: "last_task", inAgentsWindow: true })).toEqual({ mode: "ide", openExplorer: true, revealDock: true });
		expect(resolveStartupView({ rememberedMode: "ide", startupView: "last_task", inAgentsWindow: true })).toEqual({ mode: "ide", openExplorer: false, revealDock: true });
		expect(resolveStartupView({ rememberedMode: "ide", startupView: "agents", inAgentsWindow: true })).toEqual({ mode: "agents", openExplorer: false, revealDock: false });
	});

	it("opens the full-window Cedia shell by default, with the IDE an explicit choice", () => {
		// The product default is the Cedia shell (UI spec section 2), not the
		// docked coexistence view, and not a remembered window.
		expect(resolveStartupView({ startupView: "agents", inAgentsWindow: true })).toEqual({ mode: "agents", openExplorer: false, revealDock: false });
		// An unknown or missing value must not silently become a second meaning
		// for "ide"; it means the documented default.
		expect(resolveStartupView({ startupView: "nonsense" as never, inAgentsWindow: true })).toEqual({ mode: "agents", openExplorer: false, revealDock: false });
		// Choosing IDE keeps Code-OSS chrome with the agent docked beside it, and
		// must stay reachable from the settings surface.
		expect(resolveStartupView({ startupView: "ide", inAgentsWindow: true })).toEqual({ mode: "ide", openExplorer: false, revealDock: true });
		// A remembered IDE layout keeps the dock; a remembered Agents shell does not.
		expect(resolveStartupView({ startupView: "last_task", rememberedMode: "ide", inAgentsWindow: true })).toEqual({ mode: "ide", openExplorer: false, revealDock: true });
		expect(resolveStartupView({ startupView: "last_task", rememberedMode: "agents", inAgentsWindow: true })).toEqual({ mode: "agents", openExplorer: false, revealDock: false });
	});


	it("keeps a plain IDE window on full chrome and opens it clean", () => {
		// Native world (plan section 2): outside the agents workspace the agent
		// lives in its own window, so startup prefs must not strip the IDE.
		expect(resolveStartupView({ startupView: "agents", inAgentsWindow: false })).toEqual({ mode: "ide", openExplorer: false, revealDock: false });
		expect(resolveStartupView({ startupView: "last_task", rememberedMode: "agents", inAgentsWindow: false })).toEqual({ mode: "ide", openExplorer: false, revealDock: false });
		expect(resolveStartupView({ pending: "explorer", rememberedMode: "agents", startupView: "agents", inAgentsWindow: false })).toEqual({ mode: "ide", openExplorer: true, revealDock: true });
	});

	it("consumes pending explorer only after switching to IDE", () => {
		expect(consumePendingNativeDestination("ide", "explorer")).toEqual({ openExplorer: true });
		expect(consumePendingNativeDestination("agents", "explorer")).toEqual({ pending: "explorer", openExplorer: false });
		expect(consumePendingNativeDestination("ide")).toEqual({ openExplorer: false });
		expect(consumePendingNativeDestination("agents")).toEqual({ openExplorer: false });
		expect(consumePendingNativeDestination("ide", undefined)).toEqual({ openExplorer: false });
	});

	it("does not consume a pending Files destination on the dying instance after openFolder", () => {
		expect(persistDestinationAcrossReload(true, "explorer")).toEqual({ pending: "explorer", consumeNow: false });
		expect(persistDestinationAcrossReload(false, "explorer")).toEqual({ pending: "explorer", consumeNow: true });
		expect(persistDestinationAcrossReload(true)).toEqual({ consumeNow: false });
	});

	it("keeps the same session and draft across Agents → IDE → Agents", () => {
		const before = { sessionId: "task-a", draft: "hello", scrollEventId: "evt-1", mode: "agents" as const };
		const ide = retentionReceipt(before, { ...before, mode: "ide" });
		expect(ide.sessionUnchanged).toBe(true);
		expect(ide.draftRetained).toBe(true);
		expect(ide.scrollRetained).toBe(true);
		const back = retentionReceipt({ ...before, mode: "ide" }, before);
		expect(back.sessionUnchanged).toBe(true);
		expect(back.draftRetained).toBe(true);
		expect(back.mode).toBe("agents");
		expect(ide.attachmentsRetained).toBe(true);
		const lost = retentionReceipt(
			{ ...before, attachmentRefs: ["att-1"] },
			{ ...before, mode: "ide", attachmentRefs: [] },
		);
		expect(lost.attachmentsRetained).toBe(false);
		const proof = modeSwitchProof(before, { ...before, mode: "ide" }, "2026-09-13T07:00:00.000Z");
		expect(proof).toMatchObject({
			sameWindow: true,
			sessionId: "task-a",
			sessionUnchanged: true,
			draftRetained: true,
			from: "agents",
			to: "ide",
			ownerUnchanged: true,
		});
	});

	it("merges observed IDE chrome without dropping saved layout", () => {
		const next = rememberIdeChrome(
			{ ...DEFAULT_IDE_LAYOUT, sidebarVisible: true, activeEditorUri: "file:///a.ts" },
			{ activeEditorUri: "file:///b.ts", panelVisible: false },
		);
		expect(next.activeEditorUri).toBe("file:///b.ts");
		expect(next.sidebarVisible).toBe(true);
		expect(next.panelVisible).toBe(false);
	});
	it("round-trips the breadcrumbs toggle through the IDE snapshot", () => {
		const next = rememberIdeChrome(
			{ ...DEFAULT_IDE_LAYOUT, breadcrumbsEnabled: false },
			{ sidebarVisible: true },
		);
		expect(next.breadcrumbsEnabled).toBe(false);
		expect(next.sidebarVisible).toBe(true);
	});

	it("never reads Cedia's own hidden chrome back as the IDE layout", () => {
		// What a previous Agents session leaves in the workspace settings. Read
		// back as a layout, this is the bug that made IDE mode return without tabs
		// or a status bar, which reads as "the switch did nothing".
		const polluted = normalizeIdeLayout({
			sidebarVisible: true,
			auxiliaryBarVisible: false,
			panelVisible: true,
			showTabs: AGENTS_EDITOR_SHOW_TABS,
			statusBarVisible: false,
			activityBarLocation: "hidden",
		});
		expect(polluted.showTabs).toBe(DEFAULT_IDE_LAYOUT.showTabs);
		expect(polluted.statusBarVisible).toBe(true);
		expect(polluted.activityBarLocation).toBe(DEFAULT_IDE_LAYOUT.activityBarLocation);
		// A real user choice still survives.
		const chosen = normalizeIdeLayout({ showTabs: "single", statusBarVisible: false, activityBarLocation: "top" }, { ...DEFAULT_IDE_LAYOUT, showTabs: "multiple" });
		expect(chosen.showTabs).toBe("single");
		expect(chosen.activityBarLocation).toBe("top");
		// The status bar is only offered as visible/hidden by Cedia, so a stored
		// "false" is always Cedia's own footprint and falls back to the snapshot.
		expect(chosen.statusBarVisible).toBe(true);
		expect(normalizeIdeLayout({ statusBarVisible: false }, { ...DEFAULT_IDE_LAYOUT, statusBarVisible: false }).statusBarVisible).toBe(false);
	});

	it("keeps applying chrome commands after one rejects", async () => {
		const ran: string[] = [];
		await runWorkbenchCommands(async (command) => {
			ran.push(command);
			if (command === "workbench.action.closeAuxiliaryBar") throw new Error("unknown command");
		}, ["workbench.action.closeSidebar", "workbench.action.closeAuxiliaryBar", "workbench.action.closePanel"]);
		expect(ran).toEqual(["workbench.action.closeSidebar", "workbench.action.closeAuxiliaryBar", "workbench.action.closePanel"]);
	});

	it("names the extensions that paint the theme the user selected", () => {
		// Catppuccin is the real shape this exists for: `themes` next to a `configuration`
		// section, and the setting holds the picker's label rather than the theme id.
		const catppuccin = {
			id: "Catppuccin.catppuccin-vsc",
			packageJSON: { contributes: { themes: [{ id: "catppuccin-mocha", label: "Catppuccin Mocha" }] } },
		};
		const unrelated = { id: "fellipeutaka.subaru", packageJSON: { contributes: { themes: [{ id: "subaru", label: "Subaru" }] } } };
		const noThemes = { id: "cedia.cedia", packageJSON: { contributes: { commands: [] } } };
		expect(themeProvidingExtensionIds(["Catppuccin Mocha"], [catppuccin, unrelated, noThemes])).toEqual(["catppuccin.catppuccin-vsc"]);
		// Either id or label resolves, and a preferred-light/dark pair is honoured too.
		expect(themeProvidingExtensionIds(["catppuccin-mocha", undefined], [catppuccin, unrelated])).toEqual(["catppuccin.catppuccin-vsc"]);
		expect(themeProvidingExtensionIds(["Subaru", "Catppuccin Mocha"], [catppuccin, unrelated])).toEqual(["catppuccin.catppuccin-vsc", "fellipeutaka.subaru"]);
		// Nothing selected, or a theme no installed extension provides: no override at all.
		expect(themeProvidingExtensionIds([], [catppuccin])).toEqual([]);
		expect(themeProvidingExtensionIds([undefined, ""], [catppuccin])).toEqual([]);
		expect(themeProvidingExtensionIds(["Default Dark Modern"], [catppuccin])).toEqual([]);
	});

	it("hands over the theme the window actually shows", () => {
		// With autoDetect the stored colorTheme is not what the window paints.
		expect(resolveSnapshotThemeName({
			colorTheme: "__vs-dark",
			preferredDarkColorTheme: "Dark Modern",
			preferredLightColorTheme: "Light Modern",
			autoDetectColorScheme: true,
			mode: "light",
		})).toBe("Light Modern");
		expect(resolveSnapshotThemeName({
			colorTheme: "__vs-dark",
			preferredDarkColorTheme: "Dark Modern",
			preferredLightColorTheme: "Light Modern",
			autoDetectColorScheme: true,
			mode: "dark",
		})).toBe("Dark Modern");
		// A missing preferred theme falls back to the stored id rather than nothing.
		expect(resolveSnapshotThemeName({
			colorTheme: "__vs-dark",
			autoDetectColorScheme: true,
			mode: "light",
		})).toBe("__vs-dark");
		// Without autoDetect the stored theme is what the window shows.
		expect(resolveSnapshotThemeName({
			colorTheme: "Catppuccin Frapp\u00e9",
			preferredDarkColorTheme: "Dark Modern",
			preferredLightColorTheme: "Light Modern",
			autoDetectColorScheme: false,
			mode: "light",
		})).toBe("Catppuccin Frapp\u00e9");
		expect(resolveSnapshotThemeName({ mode: "dark" })).toBeUndefined();
	});

	it("merges the theme into the Agents window's own workspace file", () => {
		const merged = JSON.parse(mergeAgentsWindowWorkspaceSettings(
			JSON.stringify({ folders: [{ path: "/repo" }], settings: { "chat.disableAIFeatures": false, [AGENTS_WINDOW_SUPPORT_SETTING]: { "someone.else": true } } }),
			{ "workbench.colorTheme": "Catppuccin Frappé", "workbench.preferredDarkColorTheme": undefined },
			{ "catppuccin.catppuccin-vsc": true },
		)) as { folders: unknown[]; settings: Record<string, unknown> };
		// The document is upstream's: the folder list and the sessions workbench's own key stay.
		expect(merged.folders).toEqual([{ path: "/repo" }]);
		expect(merged.settings["chat.disableAIFeatures"]).toBe(false);
		expect(merged.settings[AGENTS_WINDOW_SUPPORT_SETTING]).toEqual({ "someone.else": true, "catppuccin.catppuccin-vsc": true });
		// The theme keys land here, and a key the user never set is left out entirely rather than
		// written as null, so the window keeps its own default for it.
		expect(merged.settings["workbench.colorTheme"]).toBe("Catppuccin Frappé");
		expect("workbench.preferredDarkColorTheme" in merged.settings).toBe(false);
		// No file yet, and a file that no longer parses, both end at a valid document with folders.
		expect(JSON.parse(mergeAgentsWindowWorkspaceSettings(undefined, {}, { "a.b": true }))).toEqual({
			folders: [], settings: { [AGENTS_WINDOW_SUPPORT_SETTING]: { "a.b": true } },
		});
		expect(JSON.parse(mergeAgentsWindowWorkspaceSettings("{ not json", {}, { "a.b": true }))).toEqual({
			folders: [], settings: { [AGENTS_WINDOW_SUPPORT_SETTING]: { "a.b": true } },
		});
	});
});
