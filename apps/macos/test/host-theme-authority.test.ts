import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_THEME_COLOR_KEYS } from "../src/agent-theme-anchors.ts";
import { normalizeAgentThemeSnapshot } from "../src/agent-theme.ts";
import {
	HOST_THEME_REQUIRED_ANCHORS,
	HOST_THEME_TOKEN_DERIVED_TOKENS,
	HOST_THEME_TOKEN_SOURCES,
	applyHostThemeTokens,
} from "../agent-window/src/host-theme-tokens.ts";
import {
	DEFAULT_THEME_STATE,
	buildThemeCssVariables,
	resolveThemePack,
} from "../agent-window/vendor/synara/apps/web/src/theme/theme.logic.ts";

const here = dirname(fileURLToPath(import.meta.url));
const macosRoot = join(here, "..");
const bundleRoots = [
	join(macosRoot, "agent-window", "src"),
	join(macosRoot, "agent-window", "vendor", "synara", "apps", "web", "src"),
];

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		if (entry === "node_modules") continue;
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) walk(path, out);
		else if (/\.(ts|tsx|css)$/.test(entry)) out.push(path);
	}
	return out;
}

/** Every `--vscode-*` anchor Cedia's own surfaces read straight out of CSS. */
function anchorsReadDirectly(): Set<string> {
	const files = [...bundleRoots.flatMap(root => walk(root)), join(macosRoot, "src", "cedia-theme.ts")];
	const anchors = new Set<string>();
	for (const file of files) {
		const text = readFileSync(file, "utf8");
		for (const match of text.matchAll(/var\(\s*(--vscode-[a-zA-Z0-9-]+)/g)) anchors.add(match[1]!);
	}
	return anchors;
}

/** Anchors read directly that are not colours, so the snapshot cannot carry them. */
const NON_COLOR_ANCHOR_READS: Readonly<Record<string, string>> = {
	"--vscode-font-family": "a font stack; the snapshot carries colours only, and the vendored default applies off the IDE",
};

describe("host theme authority", () => {
	it("maps every colour the pack layer emits onto a workbench anchor", () => {
		// The pack layer is still the fallback palette (browser runs, first paint
		// before the snapshot arrives). Once the snapshot lands, nothing it painted
		// may survive — so every variable it emits has to be in the map, or listed
		// as a documented derivation.
		const mapped = new Set(Object.keys(HOST_THEME_TOKEN_SOURCES));
		const derived = new Set(Object.keys(HOST_THEME_TOKEN_DERIVED_TOKENS));
		const unmapped: string[] = [];
		for (const variant of ["dark", "light"] as const) {
			const { variables } = buildThemeCssVariables(
				resolveThemePack(DEFAULT_THEME_STATE, variant),
				variant,
				{ electron: true, isMac: true },
			);
			for (const name of Object.keys(variables)) {
				if (!mapped.has(name) && !derived.has(name)) unmapped.push(`${variant}:${name}`);
			}
		}
		expect(unmapped).toEqual([]);
	});

	it("sources every mapped token from anchors the snapshot is allowed to carry", () => {
		const allowed = new Set<string>(AGENT_THEME_COLOR_KEYS);
		const unknown = HOST_THEME_REQUIRED_ANCHORS.filter(anchor => !allowed.has(anchor));
		// An anchor missing here is dropped by `normalizeAgentThemeSnapshot` before the
		// bundle ever sees it, so the window would silently keep the pack's colour.
		expect(unknown).toEqual([]);
	});

	it("keeps the shared anchor list exactly as wide as the bundle needs", () => {
		// Both directions matter: too narrow and the snapshot loses a colour, too wide
		// and the snapshot carries anchors nothing paints (the retired task shell's
		// tab/title tokens were exactly that).
		const required = new Set<string>(HOST_THEME_REQUIRED_ANCHORS);
		for (const anchor of anchorsReadDirectly()) {
			if (anchor in NON_COLOR_ANCHOR_READS) continue;
			required.add(anchor);
		}
		const allowed = new Set<string>(AGENT_THEME_COLOR_KEYS);
		expect([...required].filter(anchor => !allowed.has(anchor)).sort()).toEqual([]);
		expect([...allowed].filter(anchor => !required.has(anchor)).sort()).toEqual([]);
	});

	it("carries the whole anchor set through the snapshot sanitiser", () => {
		const colors: Record<string, string> = {};
		for (const anchor of AGENT_THEME_COLOR_KEYS) colors[anchor] = "#123456";
		const snapshot = normalizeAgentThemeSnapshot({ mode: "dark", themeName: "Test", colors });
		expect(Object.keys(snapshot?.colors ?? {}).length).toBe(AGENT_THEME_COLOR_KEYS.length);
	});

	it("repaints chips, panels and settings — not only the composer card", () => {
		const painted = new Map<string, string>();
		const root = { setProperty: (name: string, value: string) => painted.set(name, value) };
		applyHostThemeTokens(root, {
			mode: "dark",
			colors: {
				"--vscode-editor-background": "#101010",
				"--vscode-panel-background": "#141414",
				"--vscode-input-background": "#1a1a1a",
				"--vscode-badge-background": "#88c0d0",
				"--vscode-descriptionForeground": "#a0a0a0",
				"--vscode-gitDecoration-addedResourceForeground": "#00a240",
				"--vscode-terminal-ansiRed": "#e02e2a",
			},
		});
		expect(painted.get("--app-settings-surface")).toBe("#141414");
		expect(painted.get("--color-token-badge-background")).toBe("#88c0d0");
		expect(painted.get("--color-token-description-foreground")).toBe("#a0a0a0");
		expect(painted.get("--color-decoration-added")).toBe("#00a240");
		expect(painted.get("--vscode-terminal-ansiRed")).toBe("#e02e2a");
		expect(painted.get("--color-token-input-background")).toBe("#1a1a1a");
	});

	it("falls back through a token's anchors in priority order", () => {
		const painted = new Map<string, string>();
		const root = { setProperty: (name: string, value: string) => painted.set(name, value) };
		applyHostThemeTokens(root, {
			mode: "light",
			colors: { "--vscode-titleBar-activeBackground": "#f3f3f3" },
		});
		// `--background` is [titleBar-activeBackground, editor-background]: the first
		// anchor with a value wins, and the unmapped remainder is left alone.
		expect(painted.get("--background")).toBe("#f3f3f3");
		expect(painted.has("--color-token-badge-background")).toBe(false);
	});

	it("leaves the pack alone when there is no snapshot", () => {
		const painted = new Map<string, string>();
		applyHostThemeTokens({ setProperty: (n, v) => painted.set(n, v) }, undefined);
		expect(painted.size).toBe(0);
	});
});

describe("no agent-side theme editing", () => {
	const bundleFiles = bundleRoots.flatMap(root => walk(root));
	const readBundle = (): string => bundleFiles.map(file => readFileSync(file, "utf8")).join("\n");

	it("has no theme-pack editor, catalog or mode picker left", () => {
		expect(bundleFiles.filter(file => /ThemePackEditor/.test(file))).toEqual([]);
		const text = readBundle();
		// The editing surface, by name: none of it may come back without deleting this test.
		for (const symbol of ["theme-command:", "Switch to system theme", "Apply to the current", "CodeThemeBadge"]) {
			expect(text).not.toContain(symbol);
		}
		// And no consumer of the removed setters.
		for (const removed of ["updateChromeTheme(", "setThemeFonts(", "updateThemePackFromShareString(", "createThemeShareString("]) {
			expect(text).not.toContain(removed);
		}
	});

	it("keeps the Appearance section read-only about the IDE theme", () => {
		const settings = readFileSync(
			join(macosRoot, "agent-window", "vendor", "synara", "apps", "web", "src", "routes", "_chat.settings.tsx"),
			"utf8",
		);
		expect(settings).toContain('status="Following the IDE"');
		expect(settings).toContain("Change it in the IDE window");
	});

	it("has no theme store left to unlink from the IDE", () => {
		const text = readBundle();
		expect(text).not.toContain("followHostTheme");
		expect(relative(macosRoot, bundleFiles[0]!)).not.toStartWith("..");
	});
});
