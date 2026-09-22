/**
 * Native IDE acceptance smoke for the shared Cedia/Synara composer.
 *
 * This launches the packaged Code-OSS app with a real workspace, a real
 * `cediaComposerDock` webview, and the provider-free OMP fixture.  The fixture
 * session is written to the same handoff store that the Agent Window uses, so
 * the IDE has to render the session selected by the handoff rather than a new
 * task or a second agent runtime.
 *
 * The script intentionally does not contact a provider.  OMP is spawned by
 * the isolated Cedia host and answers from
 * `apps/macos/test/fixtures/agent-window-omp`.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { startHostServer } from "../apps/host/src/server.ts";
import { saveIdeHandoff } from "../apps/macos/src/agent-ui-state.ts";

type AnyRecord = Record<string, any>;

const root = resolve(import.meta.dir, "..");
const appPath = join(root, `VSCode-darwin-${process.arch}`, "Cedia.app", "Contents", "MacOS", "Cedia");
const { _electron } = createRequire(join(root, "desktop/package.json"))("playwright");
// Resolve the fixture root before creating the host project.  The host/store
// canonicalizes cwd values, and handoff validation intentionally compares
// canonical paths; preserving a symlinked temp root would make an otherwise
// valid handoff look like it belongs to a different workspace.
const scratch = await realpath(await mkdtemp(join(tmpdir(), "cedia-agent-ide-")));
const projectPath = join(scratch, "project");
const stateDir = join(scratch, "host");
const profile = join(scratch, "profile");
const settingsPath = join(projectPath, ".vscode", "settings.json");
const output = join(root, "dist/agent-ide-smoke");
const keepScratch = process.env.CEDIA_KEEP_IDE_SMOKE_FIXTURE === "1";
await mkdir(join(projectPath, ".vscode"), { recursive: true });
await mkdir(join(profile, "User"), { recursive: true });
await writeFile(join(projectPath, "README.md"), "Cedia IDE fixture workspace\n");
await writeFile(join(projectPath, "src.ts"), "export const ideFixture = true;\n");

// Workspace settings are part of the fixture rather than the user's profile:
// they prove that the IDE extension reads the same private host directory that
// the Agent Window handoff wrote.  The profile copy keeps the early extension
// activation path deterministic before the folder settings have loaded.
const workspaceSettings = {
  "cedia.hostStateDir": stateDir,
  "security.workspace.trust.enabled": false,
  "window.startupEditor": "none",
  "workbench.startupEditor": "none",
  "update.mode": "none",
  "telemetry.telemetryLevel": "off",
  "extensions.autoCheckUpdates": false,
};
await writeFile(settingsPath, `${JSON.stringify(workspaceSettings, null, 2)}\n`);
await writeFile(join(profile, "User", "settings.json"), `${JSON.stringify(workspaceSettings, null, 2)}\n`);

execFileSync("git", ["init", "-q"], { cwd: projectPath, stdio: "ignore" });
execFileSync("git", ["config", "user.name", "Cedia IDE fixture"], { cwd: projectPath, stdio: "ignore" });
execFileSync("git", ["config", "user.email", "cedia-ide-fixture@example.invalid"], { cwd: projectPath, stdio: "ignore" });
execFileSync("git", ["add", "."], { cwd: projectPath, stdio: "ignore" });
execFileSync("git", ["commit", "-qm", "fixture baseline"], { cwd: projectPath, stdio: "ignore" });

const host = await startHostServer({
  stateDir,
  ompExecutable: join(root, "apps/macos/test/fixtures/agent-window-omp"),
  ompEnv: { CEDIA_NODE: process.execPath },
});
const project = host.host.store.createProject({ path: projectPath, name: "Cedia IDE fixture workspace" });
const session = host.host.createSession(project.id, "Cedia IDE fixture task");

// Materialise the fixture OMP session and select a real model/effort before
// handing the task to the IDE.  This makes a stale or synthetic composer state
// fail deterministically and still keeps all inference provider-free.
const started = await host.host.startSession(session.id);
let commandNumber = 0;
const issue = (command: string, payload: AnyRecord) => host.host.command(session.id, "agent-ide-smoke", {
  commandId: `agent-ide-smoke-${++commandNumber}`,
  incarnation: started.incarnation,
  command,
  payload,
});
const selectedModel = await issue("set_model", { provider: "fixture", modelId: "fixture-model" });
if (!["completed", "acknowledged"].includes(selectedModel.status)) throw new Error(`Fixture model selection failed: ${selectedModel.status}`);
const selectedEffort = await issue("set_thinking_level", { level: "high" });
if (!["completed", "acknowledged"].includes(selectedEffort.status)) throw new Error(`Fixture effort selection failed: ${selectedEffort.status}`);
await saveIdeHandoff(stateDir, projectPath, session.id);

await mkdir(output, { recursive: true });
try { execFileSync("security", ["delete-generic-password", "-s", "Cedia Safe Storage"], { stdio: "ignore" }); } catch {}

const app = await _electron.launch({
  executablePath: appPath,
  args: [
    `--user-data-dir=${profile}`,
    "--password-store=basic",
    "--use-inmemory-secretstorage",
    "--skip-welcome",
    "--skip-release-notes",
    `--folder-uri=${projectPath}`,
  ],
  env: {
    ...process.env,
    CEDIA_STATE_DIR: stateDir,
    CEDIA_HOST_NODE: process.env.CEDIA_HOST_NODE ?? "/Users/pond/.caret-tools/node-v24.18.0-darwin-arm64/bin/node",
  },
  timeout: 45_000,
});
let ide: any = await app.firstWindow();
const errors: string[] = [];
const paletteDebug: string[] = [];
const observePage = (page: any, label: string): void => {
  page.on("pageerror", (error: Error) => errors.push(`[${label}] ${error.message}`));
  page.on("console", (message: { type(): string; text(): string }) => {
    if (message.type() === "error") errors.push(`[${label}] ${message.text()}`);
  });
};
observePage(ide, "ide");

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};
// A packaged Code-OSS build can emit diagnostics from bundled optional
// extensions and from the provider-registration race before the Cedia bridge
// is ready.  Keep those in the receipt, but fail on actual webview/bridge
// failures (CSP, bootstrap, uncaught renderer errors, and Cedia errors).
const expectedRuntimeNoise = [
  /GitHub\.vscode-pull-request-github/i,
  /CANNOT USE these API proposals/i,
  /proposed menu identifier/i,
  /Chat model provider uses UNKNOWN vendor cedia-omp\./i,
  /DEP0169|DEP0040/i,
  /Failed to load resource: the server responded with a status of 403 \(Forbidden\)/i,
];
const actionableRendererErrors = (): string[] => errors.filter(error => !expectedRuntimeNoise.some(pattern => pattern.test(error)));
const waitFor = async <T>(read: () => Promise<T>, predicate: (value: T) => boolean, timeoutMs = 30_000): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  let latest: T;
  do {
    latest = await read();
    if (predicate(latest)) return latest;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
  } while (Date.now() < deadline);
  return latest!;
};

async function openComposerFromPalette(page: any): Promise<void> {
  await page.keyboard.press("Meta+Shift+P");
  const input = page.locator(".quick-input-widget input").first();
  await input.waitFor({ state: "visible", timeout: 15_000 });
  // Code-OSS versions differ on whether a command category is included in
  // the fuzzy label.  Try the user-visible command title first; the category
  // form is kept as a compatibility fallback for patched workbenches.
  for (const query of ["Focus Composer", "Cedia: Focus Composer", "Cedia"]) {
    // Opening the palette via the shortcut leaves the quick input in command
    // mode only while its `>` prefix is present. Filling without it silently
    // switches to file search, which makes every Cedia command look missing.
    await input.fill(`>${query}`);
    await page.waitForTimeout(200);
    const resultText = await page.locator(".quick-input-widget").innerText().catch(() => "");
    paletteDebug.push(`${query}: ${resultText}`);
    if (!/No matching results/i.test(resultText)) {
      await input.press("Enter");
      return;
    }
  }
  throw new Error("Cedia Focus Composer is missing from the command palette");
}

/** Find the actual Cedia webview frame, instead of assuming iframe order. */
async function findComposerFrame(page: any, timeoutMs = 30_000): Promise<any> {
  return await waitFor(async () => {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      try {
        const picker = frame.getByRole("button", { name: "Change model and reasoning", exact: true });
        if (await picker.count() > 0 && await picker.first().isVisible()) return frame;
      } catch {
        // A webview can be replaced while the secondary sidebar opens.
      }
    }
    return null;
  }, value => value !== null, timeoutMs);
}

async function closeAppBounded(): Promise<void> {
  let closed = false;
  const closing = Promise.resolve().then(() => app.close()).then(() => { closed = true; }, () => undefined);
  await Promise.race([closing, new Promise<void>(resolveDelay => setTimeout(resolveDelay, 5_000))]);
  if (closed) return;
  try {
    const child = typeof app.process === "function" ? app.process() : undefined;
    if (child && !child.killed) child.kill("SIGTERM");
  } catch {}
  await Promise.race([closing, new Promise<void>(resolveDelay => setTimeout(resolveDelay, 2_000))]);
}

type LayoutBox = { x: number; y: number; width: number; height: number };
type ThemeTokens = {
  variant: string | null;
  vscodeEditorBackground: string;
  vscodeEditorForeground: string;
  vscodeForeground: string;
  appShellBackground: string;
  background: string;
  backgroundShared: string;
  surface: string;
  surfaceShared: string;
  foreground: string;
  foregroundShared: string;
  bodyBackground: string;
};

function normalizeCssColor(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(trimmed);
  if (hex) {
    const raw = hex[1]!;
    if (raw.length === 3 || raw.length === 4) {
      return `#${raw.slice(0, 3).split("").map(channel => channel + channel).join("")}`;
    }
    return `#${raw.slice(0, 6)}`;
  }
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(trimmed);
  if (!rgb) return trimmed;
  const channel = (raw: string): string => Math.max(0, Math.min(255, Math.round(Number(raw)))).toString(16).padStart(2, "0");
  return `#${channel(rgb[1]!)}${channel(rgb[2]!)}${channel(rgb[3]!)}`;
}

async function readThemeTokens(target: any): Promise<ThemeTokens> {
  return await target.evaluate(() => {
    const root = document.documentElement;
    const rootStyle = getComputedStyle(root);
    const bodyStyle = getComputedStyle(document.body);
    const read = (name: string): string => rootStyle.getPropertyValue(name).trim();
    return {
      variant: root.getAttribute("data-theme-variant"),
      vscodeEditorBackground: read("--vscode-editor-background"),
      vscodeEditorForeground: read("--vscode-editor-foreground"),
      vscodeForeground: read("--vscode-foreground"),
      appShellBackground: read("--app-shell-background"),
      background: read("--background"),
      backgroundShared: read("--color-background-surface-under"),
      surface: read("--color-background-surface"),
      surfaceShared: read("--color-token-main-surface-primary"),
      foreground: read("--foreground"),
      foregroundShared: read("--color-token-foreground"),
      bodyBackground: bodyStyle.backgroundColor,
    };
  }) as ThemeTokens;
}

function themeMapping(embedded: ThemeTokens, standalone: ThemeTokens): Record<string, unknown> {
  const embeddedBackground = normalizeCssColor(embedded.vscodeEditorBackground);
  const embeddedForeground = normalizeCssColor(embedded.vscodeForeground || embedded.vscodeEditorForeground);
  const standaloneSurface = normalizeCssColor(standalone.surface);
  const standaloneForeground = normalizeCssColor(standalone.foreground);
  const backgroundShared = normalizeCssColor(standalone.backgroundShared);
  const surfaceShared = normalizeCssColor(standalone.surfaceShared);
  const background = normalizeCssColor(standalone.background);
  const surface = normalizeCssColor(standalone.surface);
  return {
    embeddedBackground,
    standaloneSurface,
    embeddedForeground,
    standaloneForeground,
    background,
    backgroundShared,
    surface,
    surfaceShared,
    backgroundMatchesShared: Boolean(background && background === backgroundShared),
    surfaceMatchesShared: Boolean(surface && surface === surfaceShared),
    backgroundMatchesHost: Boolean(embeddedBackground && embeddedBackground === standaloneSurface),
    foregroundMatchesHost: Boolean(embeddedForeground && embeddedForeground === standaloneForeground),
  };
}

function assertThemeMapping(embedded: ThemeTokens, standalone: ThemeTokens, label: string): Record<string, unknown> {
  const mapping = themeMapping(embedded, standalone);
  assert(mapping.backgroundMatchesShared, `${label}: standalone --background is not the mapped --color-background-surface-under token: ${JSON.stringify(mapping)}`);
  assert(mapping.surfaceMatchesShared, `${label}: standalone surface token is not shared: ${JSON.stringify(mapping)}`);
  assert(mapping.backgroundMatchesHost, `${label}: standalone surface does not follow embedded --vscode-editor-background: ${JSON.stringify(mapping)}`);
  assert(mapping.foregroundMatchesHost, `${label}: standalone foreground does not follow embedded Code-OSS foreground: ${JSON.stringify(mapping)}`);
  return mapping;
}

function within(inner: LayoutBox, outer: LayoutBox, tolerance = 2): boolean {
  return inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance;
}

async function assertDarkTheme(page: any, frame: any): Promise<Record<string, unknown>> {
  const host = await page.evaluate(() => {
    const workbench = document.querySelector(".monaco-workbench");
    const classes = `${document.body.className} ${workbench?.className ?? ""}`;
    return {
      classes,
      background: workbench ? getComputedStyle(workbench).backgroundColor : "",
      dark: /(?:^|\s)(?:vs-dark|hc-black)(?:\s|$)/.test(classes),
    };
  });
  const webview = await frame.evaluate(() => {
    const root = document.documentElement;
    const classes = `${root.className} ${document.body.className}`;
    return {
      classes,
      variant: root.getAttribute("data-theme-variant"),
      background: getComputedStyle(document.body).backgroundColor,
      dark: root.classList.contains("dark") || root.getAttribute("data-theme-variant") === "dark",
    };
  });
  assert(host.dark, `IDE host is not dark: ${JSON.stringify(host)}`);
  assert(webview.dark, `IDE composer did not inherit the dark theme: ${JSON.stringify(webview)}`);
  return { host, webview };
}

async function assertComposerBounds(frame: any): Promise<Record<string, LayoutBox>> {
  const frameElement = await frame.frameElement();
  const pane = await frameElement?.boundingBox();
  assert(pane, "Cedia composer frame has no layout bounds");
  const paneBox = pane as LayoutBox;
  const composer = frame.locator('[contenteditable="true"]').filter({ visible: true }).first();
  const picker = frame.getByRole("button", { name: "Change model and reasoning", exact: true });
  const send = frame.getByRole("button", { name: "Send message", exact: true });
  const controls: Record<string, LayoutBox> = {};
  for (const [name, locator] of [["composer", composer], ["modelPicker", picker], ["send", send]] as const) {
    const box = await locator.boundingBox();
    assert(box, `IDE ${name} control has no layout bounds`);
    controls[name] = box as LayoutBox;
    assert(within(box as LayoutBox, paneBox), `IDE ${name} control is clipped outside the composer pane: ${JSON.stringify({ pane: paneBox, box })}`);
  }
  return controls;
}

/**
 * The IDE must expose Cedia's single Agent dock.  Upstream Code-OSS can also
 * contribute a native Chat participant, which creates a second tab in the
 * auxiliary bar and leaves the user in the wrong surface after an IDE ↔ Agent
 * handoff.  Inspect the workbench DOM directly so this gate does not depend on
 * screenshot text or a locale-specific title.
 */
async function assertSoleAgentDock(page: any): Promise<Record<string, unknown>> {
  const report = await page.evaluate(() => {
    const auxiliary = document.querySelector<HTMLElement>(".auxiliarybar") ??
      document.querySelector<HTMLElement>('[id="workbench.parts.auxiliarybar"]');
    const normalize = (value: string | null | undefined): string => (value ?? "").replace(/\s+/g, " ").trim();
    const controls = auxiliary ? Array.from(auxiliary.querySelectorAll<HTMLElement>('[role="tab"], [role="button"], [aria-label]')).map(node => {
      const aria = normalize(node.getAttribute("aria-label"));
      const text = normalize(node.innerText || node.textContent);
      const title = normalize(node.getAttribute("title"));
      const labels = [aria, text, title].filter(Boolean);
      const style = window.getComputedStyle(node);
      const visible = style.display !== "none" && style.visibility !== "hidden" && node.getClientRects().length > 0;
      return { role: node.getAttribute("role"), aria, text, title, labels, visible };
    }) : [];
    const visibleControls = controls.filter(control => control.visible);
    // Code-OSS wraps the active tab in an "Active View Switcher" tablist and
    // repeats its label on the pane heading. Prefer the semantic tab itself so
    // those presentation/heading nodes cannot be counted as extra Agents.
    const semanticControls = visibleControls.some(control => control.role === "tab")
      ? visibleControls.filter(control => control.role === "tab")
      : visibleControls.filter(control => control.role !== "tablist" && control.role !== "toolbar");
    const exact = (control: { labels: string[] }, pattern: RegExp): boolean => control.labels.some(label => pattern.test(label));
    const agentControls = semanticControls.filter(control => exact(control, /^(?:agent|agents)$/i));
    const chatControls = semanticControls.filter(control => exact(control, /^(?:chat|chats)$/i));
    return {
      auxiliaryFound: Boolean(auxiliary),
      controls: visibleControls,
      semanticControls,
      agentControls,
      chatControls,
    };
  });
  assert(report.auxiliaryFound, "IDE auxiliary bar is missing");
  assert(report.agentControls.length === 1, `IDE must expose exactly one visible Agent control: ${JSON.stringify(report)}`);
  assert(report.chatControls.length === 0, `IDE must not expose a native Chat control beside Cedia Agent: ${JSON.stringify(report)}`);
  return report;
}

async function openAgentsFromIde(page: any, frame: any): Promise<any> {
  const knownPages = new Set<any>(app.windows());
  const opened = app.waitForEvent("window", { predicate: (candidate: any) => !knownPages.has(candidate), timeout: 30_000 });
  const embeddedButton = frame.getByRole("button", { name: "Open Agents Window", exact: true }).first();
  if (await embeddedButton.count() > 0 && await embeddedButton.isVisible()) {
    await embeddedButton.click();
  } else {
    const titlebarButton = page.getByRole("button", { name: /Open in Agents(?: Window)?/ }).first();
    if (await titlebarButton.count() > 0 && await titlebarButton.isVisible()) await titlebarButton.click();
    else await page.keyboard.press("Meta+Shift+A");
  }
  return await opened;
}

/**
 * §10 item 64 asks for a packaged receipt of *the dock's Terminal pane*: a terminal
 * opened from the IDE dock, a command run in it, and the screen read back from the
 * host's PTY registry (`GET /v1/sessions/:id/terminals`).
 *
 * This step walks that chain in the packaged build and records which link answers,
 * instead of assuming the pane is there.  It reads the dock's real control inventory
 * by role/accessible name, makes the exact call the bundle's terminal runtime makes
 * when its pane mounts (`buildOpenInput` in `terminalRuntime.ts` →
 * `nativeApi.terminal.open`), and reads the host route in the same run.  `resolved`
 * is true only when a terminal actually opened *and* the host reported it; otherwise
 * `blockedAt`/`missing` name the gap.  Nothing here is fabricated for the receipt.
 */
async function recordDockTerminalRoute(
  frame: any,
  options: {
    sessionId: string;
    workspace: string;
    descriptor: { url: string; token: string };
    cediaHost: typeof host.host;
  },
): Promise<Record<string, unknown>> {
  // Resting state first: an earlier step (the model picker) can leave a popup open,
  // and the inventory has to describe the dock's panes, not that popup.
  await frame.locator("body").press("Escape");
  await frame.waitForTimeout(200);
  // The dock's affordances, by role and accessible name — never by CSS class.
  const dock = await frame.evaluate(() => {
    const normalize = (value: string | null | undefined): string => (value ?? "").replace(/\s+/g, " ").trim();
    const controls = Array.from(document.querySelectorAll<HTMLElement>(
      "button, [role='button'], [role='tab'], [role='menuitem'], [role='switch'], [role='slider']",
    )).map(node => ({ node, style: window.getComputedStyle(node) }))
      .filter(({ node, style }) => style.display !== "none" && style.visibility !== "hidden" && node.getClientRects().length > 0)
      .map(({ node }) => ({
        role: node.getAttribute("role"),
        aria: normalize(node.getAttribute("aria-label")),
        title: normalize(node.getAttribute("title")),
        text: normalize(node.innerText || node.textContent).slice(0, 80),
      })).filter(control => control.aria || control.title || control.text);
    return {
      hash: window.location.hash,
      ideEmbedded: (window as unknown as { __CEDIA_IDE_EMBEDDED__?: boolean }).__CEDIA_IDE_EMBEDDED__ === true,
      // The right dock's own container, its offcanvas wrapper, and any live xterm.
      rightDockContainers: document.querySelectorAll("[data-right-dock-content]").length,
      sidebarWrappers: document.querySelectorAll("[data-slot='sidebar-wrapper']").length,
      terminalSurfaces: document.querySelectorAll(".xterm, [data-terminal-viewport]").length,
      controls,
      terminalControls: controls.filter(control => /terminal/i.test(`${control.aria} ${control.title} ${control.text}`)),
      bodyText: normalize(document.body.innerText).slice(0, 2_000),
    };
  });
  assert(dock.ideEmbedded, `IDE dock frame is not the embedded bundle runtime: ${JSON.stringify({ hash: dock.hash, ideEmbedded: dock.ideEmbedded })}`);
  assert(dock.controls.length > 0, `IDE dock exposed no controls to inventory: ${JSON.stringify(dock)}`);
  assert(dock.hash.includes(options.sessionId), `Terminal receipt ran in the wrong dock session: ${dock.hash}`);

  // The dock's own menus: a terminal could only be offered here or in the header,
  // so the receipt covers both rather than trusting the header row alone.
  const menus: Record<string, string[]> = {};
  for (const name of ["More actions", "Composer extras"]) {
    const trigger = frame.getByRole("button", { name, exact: true }).first();
    if (await trigger.count() === 0 || !(await trigger.isVisible())) {
      menus[name] = [];
      continue;
    }
    await trigger.click();
    await frame.waitForTimeout(500);
    menus[name] = await frame.locator("[role='menuitem'], [role='option'], [role='menuitemradio'], [role='menuitemcheckbox']").evaluateAll((nodes: Element[]) =>
      nodes.filter(node => node.getClientRects().length > 0)
        .map(node => (node.textContent ?? "").replace(/\s+/g, " ").trim())
        .filter(Boolean));
    await frame.locator("body").press("Escape");
    await frame.waitForTimeout(200);
  }
  const menuTerminalItems = Object.values(menus).flat().filter(label => /terminal/i.test(label));

  // The bundle's Terminal pane opens a PTY through this bridge call and nothing
  // else; a refusal here is the pane's own refusal.
  const request = { threadId: `dock-terminal:${options.sessionId}`, terminalId: "cedia-dock-terminal-receipt", cwd: options.workspace, cols: 80, rows: 24 };
  const opened = await frame.evaluate(async (input: { threadId: string; terminalId: string; cwd: string; cols: number; rows: number }) => {
    const api = (window as unknown as {
      nativeApi?: { terminal?: { open: (value: unknown) => Promise<unknown> } };
    }).nativeApi;
    if (!api?.terminal) return { answered: false, error: "window.nativeApi.terminal is unavailable in this webview" };
    try {
      return { answered: true, snapshot: await api.terminal.open(input) };
    } catch (error) {
      return { answered: true, error: error instanceof Error ? error.message : String(error) };
    }
  }, request);

  // Control: the same bridge answers the dock's other panels, so a refusal above is
  // specific to the terminal surface and not a dead bridge.
  const bridgeControl = await frame.evaluate(async (cwd: string) => {
    const api = (window as unknown as {
      nativeApi?: { git?: { status: (value: unknown) => Promise<{ branch?: string | null }> } };
    }).nativeApi;
    if (!api?.git) return { answered: false, error: "window.nativeApi.git is unavailable in this webview" };
    try {
      const status = await api.git.status({ cwd });
      return { answered: true, branch: status.branch ?? null };
    } catch (error) {
      return { answered: true, error: error instanceof Error ? error.message : String(error) };
    }
  }, options.workspace);

  // The host's PTY registry (`GET /v1/sessions/:id/terminals`) is the checkpoint list
  // the item names, read here over the host's own loopback route.
  const route = `/v1/sessions/${options.sessionId}/terminals`;
  const response = await fetch(`${options.descriptor.url}${route}`, {
    headers: { Authorization: `Bearer ${options.descriptor.token}` },
  });
  const body = await response.json() as { terminals?: unknown };
  const routeTerminals = Array.isArray(body.terminals) ? body.terminals : null;
  // If a terminal really opened, its output has to reach a checkpoint. Poll the
  // registry the way a client would rather than sampling once.
  const snapshots = opened.answered && opened.snapshot
    ? await waitFor(
      async () => options.cediaHost.terminalSnapshots(options.sessionId),
      value => value.length > 0,
      5_000,
    )
    : options.cediaHost.terminalSnapshots(options.sessionId);
  assert(routeTerminals !== null, `Host terminal route did not answer with a terminal list: ${response.status} ${JSON.stringify(body)}`);

  const openedTerminalId = opened.answered && opened.snapshot
    ? (opened.snapshot as { terminalId?: unknown }).terminalId ?? null
    : null;
  const hostLines = snapshots.flatMap(snapshot => snapshot.lines);
  const resolved = openedTerminalId !== null && snapshots.some(snapshot => snapshot.terminalId === openedTerminalId);
  // Every control that could open a terminal in this dock: a header control, or an
  // entry in one of the dock's own menus.
  const terminalAffordances = [
    ...dock.terminalControls.map((control: { aria: string; text: string }) => `control:${control.aria || control.text}`),
    ...menuTerminalItems.map(label => `menu:${label}`),
  ];
  const blockedAt = resolved
    ? null
    : terminalAffordances.length === 0
      ? "the packaged IDE dock renders no Terminal pane and no right-dock switcher, and its terminal transport is refused by the IDE bridge"
      : "the dock exposed a Terminal control but the chain did not complete; see the fields below";
  const missing = resolved ? [] : [
    "dock-terminal-pane: the dock webview renders no right-dock container (`[data-right-dock-content]` count 0), no control and no menu entry whose accessible name mentions a terminal, so no pane could be opened from a switcher (the embedded runtime gates the right dock off entirely: `SingleChatSurface.tsx` renders `<RightDock>` only when `!isIdeEmbeddedRuntime()`)",
    "dock-terminal-transport: `nativeApi.terminal.open(...)` — the exact call the bundle's terminal runtime makes when its pane mounts — is answered by the IDE bridge with the refusal recorded below (`agent-ide-webview.ts` wires the `panel` surfaces `files` and `git` only), so the dock cannot start a PTY in this window",
    "host-pty-registry: this smoke starts the host without the virtual-UI terminal registry (its OMP is the fixture, which advertises no Cedia virtual UI, so no PTY is ever negotiated), and the host only keeps checkpoints for OMP's `cedia_terminal_*` frames — so `GET /v1/sessions/:id/terminals` has nothing to report in this run, and neither window's terminal pane is backed by that route (the Agents window's pane uses the Electron-main node-pty service in `agent-window-bridge.ts`)",
    "no marker: with no terminal surface there is no command to run and no screen to assert a marker on; the fields the positive path would fill stay null rather than being fabricated",
  ];

  return {
    item: "CEDIA-PLAN §10 item 64 — dock Terminal pane served by the host PTY registry",
    resolved,
    blockedAt,
    missing,
    capturedAt: new Date().toISOString(),
    app: appPath,
    sessionId: options.sessionId,
    workspace: options.workspace,
    dock,
    menus,
    terminalAffordances,
    terminalAttempt: { api: "nativeApi.terminal.open", request, ...opened },
    bridgeControl: { api: "nativeApi.git.status", ...bridgeControl },
    terminal: {
      terminalId: openedTerminalId,
      marker: null,
      hostLines,
      hostSnapshots: snapshots,
    },
    hostRegistry: {
      route,
      status: response.status,
      terminals: routeTerminals,
      terminalSnapshots: snapshots,
      virtualUi: false,
      note: "This smoke starts the host without the virtual-UI terminal registry: enabling it needs an OMP that advertises Cedia virtual UI v1 (the provider-free fixture does not, so `cedia_terminal_negotiate` is refused), and the registry only ever holds OMP's `cedia_terminal_*` frames. An empty list here therefore means no PTY was negotiated for this session, which the module documents as an honest answer.",
    },
    screenshot: "dist/agent-ide-smoke/ide-dock-terminal.png",
  };
}

async function openIdeFromAgents(page: any): Promise<any> {
  const direct = page.getByRole("button", { name: "Open in IDE", exact: true }).first();
  if (await direct.count() > 0 && await direct.isVisible()) {
    await direct.click();
  } else {
    const environmentToggle = page.getByRole("button", { name: "Toggle environment panel", exact: true }).first();
    if (await environmentToggle.count() > 0 && await environmentToggle.isVisible()) {
      if (await environmentToggle.getAttribute("aria-pressed") !== "true") await environmentToggle.click();
      const cediaIde = page.getByRole("button", { name: "Open in Cedia IDE", exact: true }).first();
      await cediaIde.waitFor({ state: "visible", timeout: 15_000 });
      await cediaIde.click();
      const radio = page.getByRole("menuitemradio", { name: "Cedia IDE", exact: true }).first();
      if (await radio.count() > 0 && await radio.isVisible()) await radio.click();
      else await page.getByRole("menuitem", { name: "Cedia IDE", exact: true }).click();
    } else {
      const more = page.getByRole("button", { name: "More actions", exact: true }).first();
      await more.waitFor({ state: "visible", timeout: 15_000 });
      await more.click();
      await page.getByRole("menuitem", { name: "Open in IDE", exact: true }).click();
    }
  }
  // Code-OSS may reuse the already-open workspace window instead of creating a
  // second one. Prefer a newly-created workbench, then accept the original IDE
  // once it regains focus after the handoff.
  return await waitFor<any>(async () => {
    for (const candidate of app.windows()) {
      if (candidate === page) {
        continue;
      }
      try {
        if (await candidate.locator(".monaco-workbench").count() > 0) return candidate;
      } catch {}
    }
    try {
      if (await ide.locator(".monaco-workbench").count() > 0 && await ide.evaluate(() => document.hasFocus())) return ide;
    } catch {}
    return null;
  }, value => value !== null, 30_000);
}

try {
  await ide.waitForURL(/workbench/, { timeout: 30_000 });
  await ide.locator(".monaco-workbench").waitFor({ timeout: 30_000 });

  // Some Code-OSS profiles reveal the secondary sidebar at startup.  If this
  // build does not, use the same public command a user reaches from the palette.
  let frame: any = null;
  try { frame = await findComposerFrame(ide, 8_000); } catch {}
  if (!frame) {
    await openComposerFromPalette(ide);
    frame = await findComposerFrame(ide, 30_000);
  }
  assert(frame, "Cedia composer webview did not open from startup or the command palette");

  await ide.screenshot({ path: join(output, "ide-composer.png"), fullPage: true });
  const agentDockChecks: Record<string, unknown>[] = [];
  agentDockChecks.push(await assertSoleAgentDock(ide));
  const hash: string = await frame.evaluate(() => window.location.hash) as string;
  assert(hash.includes(session.id), `IDE rendered a different handoff session: hash=${hash} expected=${session.id}`);
  // The shared composer may hide its hero/title in the compact IDE sidebar;
  // the hash is the exact durable-session identity check.  The model picker
  // below additionally proves that this route has mounted the live composer.

  const pickerTrigger = frame.getByRole("button", { name: "Change model and reasoning", exact: true });
  await pickerTrigger.waitFor({ state: "visible", timeout: 20_000 });
  const selectionTitleValue = await waitFor<string | null>(
    () => pickerTrigger.getAttribute("title"),
    value => Boolean(value && /fixture-model|fixture model/i.test(value) && /high/i.test(value)),
    20_000,
  );
  assert(selectionTitleValue, "IDE model picker did not expose a selected model title");
  const selectionTitle: string = selectionTitleValue;
  const triggerText = await pickerTrigger.innerText();
  assert(/fixture-model|fixture model/i.test(triggerText), `IDE model picker hides the selected model: ${triggerText}`);
  assert(/high/i.test(triggerText), `IDE model picker hides the selected effort: ${triggerText}`);

  await pickerTrigger.click();
  const picker = frame.locator("[data-model-picker-popup]");
  await picker.waitFor({ state: "visible", timeout: 15_000 });
  const modelRows = picker.getByRole("menuitem").filter({ hasText: /Fixture model|fixture-model/i });
  await modelRows.first().waitFor({ state: "visible", timeout: 15_000 });
  assert(await modelRows.count() === 1, `IDE model picker rendered ${await modelRows.count()} fixture model rows`);
  const effortLabels: string[] = await picker.locator("[aria-label^='Set effort to ']").evaluateAll((nodes: Element[]) => nodes.map(node => node.getAttribute("aria-label") ?? "")) as string[];
  const effortSlider = picker.getByRole("slider", { name: "Reasoning effort" });
  const effortVisible = await effortSlider.count() > 0 && await effortSlider.first().isVisible();
  assert(effortVisible || effortLabels.some(label => /high/i.test(label)), "IDE model picker does not expose the fixture effort control");
  await ide.screenshot({ path: join(output, "ide-model-picker.png"), fullPage: true });
  await ide.keyboard.press("Escape");

  const themeChecks: Record<string, unknown>[] = [];
  const embeddedTheme = await readThemeTokens(frame);
  themeChecks.push(await assertDarkTheme(ide, frame));
  const draft = "IDE unsent draft survives Agent handoff";
  const draftComposer = frame.locator('[contenteditable="true"]').filter({ visible: true }).first();
  await draftComposer.waitFor({ state: "visible", timeout: 15_000 });
  await draftComposer.fill(draft);
  const draftSend = frame.getByRole("button", { name: "Send message", exact: true });
  await draftSend.waitFor({ state: "visible", timeout: 15_000 });
  const initialBounds = await assertComposerBounds(frame);
  await ide.screenshot({ path: join(output, "ide-draft.png"), fullPage: true });

  // §10 item 64's chain, walked in the packaged build while the dock is mounted
  // and no other surface has taken focus.  The receipt records where it stops.
  const dockTerminal = await recordDockTerminalRoute(frame, {
    sessionId: session.id,
    workspace: projectPath,
    descriptor: host.descriptor,
    cediaHost: host.host,
  });
  await ide.screenshot({ path: join(output, "ide-dock-terminal.png"), fullPage: true });
  await writeFile(join(output, "dock-terminal-receipt.json"), `${JSON.stringify(dockTerminal, null, 2)}\n`);

  // Use the shared composer action so it flushes the draft bridge before the
  // native host opens the standalone Agent Window.
  const agents = await openAgentsFromIde(ide, frame);
  observePage(agents, "agents");
  const agentPicker = agents.getByRole("button", { name: "Change model and reasoning", exact: true }).first();
  await agentPicker.waitFor({ state: "visible", timeout: 30_000 });
  const agentHash = await waitFor<string>(
    () => agents.evaluate(() => window.location.hash),
    value => value.includes(session.id),
    30_000,
  );
  assert(agentHash.includes(session.id), `Agents Window rendered a different session: hash=${agentHash} expected=${session.id}`);
  const agentTitle = await waitFor<string | null>(
    () => agentPicker.getAttribute("title"),
    value => Boolean(value && /fixture-model|fixture model/i.test(value) && /high/i.test(value)),
    20_000,
  );
  assert(agentTitle, "Agents Window did not preserve the selected model/effort");
  const agentDraft = agents.locator('[contenteditable="true"]').filter({ visible: true }).first();
  const agentDraftText = await waitFor<string>(
    () => agentDraft.innerText(),
    value => value.includes(draft),
    20_000,
  );
  assert(agentDraftText.includes(draft), "Agents Window did not hydrate the unsent IDE draft");
  await agents.screenshot({ path: join(output, "agents-draft.png"), fullPage: true });

  // The standalone window starts from the effective Code-OSS variables that
  // the embedded webview publishes. Check both the host colour mapping and
  // Synara's root aliases, rather than only comparing a dark/light class.
  const standaloneTheme = await waitFor<ThemeTokens>(
    () => readThemeTokens(agents),
    value => Boolean(themeMapping(embeddedTheme, value).backgroundMatchesHost &&
      themeMapping(embeddedTheme, value).foregroundMatchesHost &&
      themeMapping(embeddedTheme, value).backgroundMatchesShared &&
      themeMapping(embeddedTheme, value).surfaceMatchesShared),
    20_000,
  );
  themeChecks.push({
    kind: "embedded-vscode-to-standalone-theme",
    embedded: embeddedTheme,
    standalone: standaloneTheme,
    mapping: assertThemeMapping(embeddedTheme, standaloneTheme, "initial Agent theme"),
  });

  // A workspace colour customization is a user-controlled theme change, not a
  // Cedia palette. Write it while the Agent window is open and wait for the
  // embedded Code-OSS snapshot + standalone polling bridge to carry the new
  // editor surface and foreground across the window boundary.
  const originalSettings = await readFile(settingsPath, "utf8");
  const customizedEditorBackground = "#203247";
  const customizedEditorForeground = "#f4e7c5";
  const customizedColors = {
    "editor.background": customizedEditorBackground,
    "editor.foreground": customizedEditorForeground,
    foreground: customizedEditorForeground,
  };
  try {
    const parsedSettings = JSON.parse(originalSettings) as Record<string, unknown>;
    await writeFile(settingsPath, `${JSON.stringify({
      ...parsedSettings,
      "workbench.colorCustomizations": customizedColors,
    }, null, 2)}\n`);
    const customizedEmbeddedTheme = await waitFor<ThemeTokens>(
      () => readThemeTokens(frame),
      value => normalizeCssColor(value.vscodeEditorBackground) === normalizeCssColor(customizedEditorBackground) &&
        normalizeCssColor(value.vscodeForeground || value.vscodeEditorForeground) === normalizeCssColor(customizedEditorForeground),
      20_000,
    );
    const customizedTheme = await waitFor<ThemeTokens>(
      () => readThemeTokens(agents),
      value => normalizeCssColor(value.surface) === normalizeCssColor(customizedEditorBackground) &&
        normalizeCssColor(value.foreground) === normalizeCssColor(customizedEditorForeground),
      20_000,
    );
    const customizedMapping = themeMapping(customizedEmbeddedTheme, customizedTheme);
    assert(customizedMapping.backgroundMatchesHost && customizedMapping.foregroundMatchesHost,
      `Agent did not follow workspace editor color customizations: ${JSON.stringify({ expected: customizedColors, standalone: customizedTheme, mapping: customizedMapping })}`);
    assert(customizedMapping.backgroundMatchesShared && customizedMapping.surfaceMatchesShared,
      `Agent custom theme root aliases diverged: ${JSON.stringify(customizedMapping)}`);
    themeChecks.push({
      kind: "workspace-color-customization-followed",
      expected: customizedColors,
      embedded: customizedEmbeddedTheme,
      standalone: customizedTheme,
      mapping: customizedMapping,
    });
    await agents.screenshot({ path: join(output, "agents-theme-custom.png"), fullPage: true });
  } finally {
    await writeFile(settingsPath, originalSettings);
  }

  // Return through the Agent Window's real IDE launcher. This creates the
  // normal native IDE handoff and must keep both the route and shared draft.
  const returnedIde = await openIdeFromAgents(agents);
  if (returnedIde !== ide) observePage(returnedIde, "ide-returned");
  await returnedIde.waitForURL(/workbench/, { timeout: 30_000 });
  await returnedIde.locator(".monaco-workbench").waitFor({ timeout: 30_000 });
  const returnedFrame = await findComposerFrame(returnedIde, 30_000);
  assert(returnedFrame, "Returned IDE did not reopen the Cedia composer webview");
  const returnedHash: string = await returnedFrame.evaluate(() => window.location.hash) as string;
  assert(returnedHash.includes(session.id), `Returned IDE rendered a different session: hash=${returnedHash} expected=${session.id}`);
  const returnedPicker = returnedFrame.getByRole("button", { name: "Change model and reasoning", exact: true });
  const returnedTitle = await waitFor<string | null>(
    () => returnedPicker.getAttribute("title"),
    value => Boolean(value && /fixture-model|fixture model/i.test(value) && /high/i.test(value)),
    20_000,
  );
  assert(returnedTitle, "Returned IDE did not preserve the selected model/effort");
  const returnedComposer = returnedFrame.locator('[contenteditable="true"]').filter({ visible: true }).first();
  const returnedDraftText = await waitFor<string>(
    () => returnedComposer.innerText(),
    value => value.includes(draft),
    20_000,
  );
  assert(returnedDraftText.includes(draft), "Returned IDE did not restore the unsent draft");
  const returnedBounds = await assertComposerBounds(returnedFrame);
  agentDockChecks.push(await assertSoleAgentDock(returnedIde));
  themeChecks.push(await assertDarkTheme(returnedIde, returnedFrame));
  await returnedIde.screenshot({ path: join(output, "ide-returned-draft.png"), fullPage: true });

  // Continue in the returned IDE and prove the same durable OMP session still
  // owns execution. Replacing the draft keeps this test provider-free while
  // exercising the actual send path after both window handoffs.
  ide = returnedIde;
  frame = returnedFrame;
  await returnedComposer.fill("");
  const prompt = "IDE fixture prompt";
  await returnedComposer.fill(prompt);
  const send = returnedFrame.getByRole("button", { name: "Send message", exact: true });
  await send.waitFor({ state: "visible", timeout: 15_000 });
  await send.click();
  await returnedFrame.getByText(`Fixture response: ${prompt}`, { exact: true }).waitFor({ timeout: 25_000 });
  const promptCommand = host.host.store.listCommands(session.id).find(command => command.kind === "prompt");
  assert(promptCommand && ["completed", "acknowledged"].includes(promptCommand.status), "IDE prompt did not reach the fixture OMP session");
  await returnedIde.screenshot({ path: join(output, "ide-conversation.png"), fullPage: true });

  const actionableErrors = actionableRendererErrors();
  if (actionableErrors.length) throw new Error(`IDE renderer errors: ${actionableErrors.join("\n")}`);
  const receipt = {
    ok: true,
    capturedAt: new Date().toISOString(),
    app: appPath,
    workspace: projectPath,
    stateDir,
    profile,
    projectId: project.id,
    sessionId: session.id,
    handoffHash: hash,
    agentsHash: agentHash,
    returnedHandoffHash: returnedHash,
    selectedModelTitle: selectionTitle,
    selectedEffort: "high",
    agentsModelTitle: agentTitle,
    returnedModelTitle: returnedTitle,
    draft,
    draftRoundTrip: { agent: agentDraftText, returnedIde: returnedDraftText },
    dockTerminal,
    agentDockChecks,
    themeChecks,
    composerBounds: { initial: initialBounds, returned: returnedBounds },
    providerCalls: 0,
    scriptedOmpOnly: true,
    rendererErrors: errors,
    actionableErrors,
    checks: [
      "packaged-code-oss-ide-launched",
      "cediaComposerDock-webview-loaded",
      "shared-synara-composer-rendered",
      "handoff-session-identity-preserved",
      "model-and-effort-visible-in-picker",
      "ide-exposes-one-agent-dock-without-native-chat-tab",
      "ide-agents-ide-draft-roundtrip-preserved",
      "dark-workbench-and-webview-theme-match",
      "agent-theme-shares-vscode-surface-and-foreground",
      "workspace-color-customizations-follow-agent-theme",
      "composer-controls-fit-within-webview-pane",
      "fixture-prompt-completed-without-provider-call",
      // §10 item 64's chain is *recorded*, not closed: the packaged dock renders no
      // Terminal pane (see `dockTerminal.resolved`/`blockedAt`), so the receipt names
      // the gap instead of asserting a terminal that does not exist.
      "dock-terminal-route-answered-and-recorded",
    ],
  };
  await writeFile(join(output, "result.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  await Promise.all(["failure.json", "failure.png"].map(name => rm(join(output, name), { force: true })));
  console.log(`Agent IDE smoke passed: ${output}`);
  console.log(dockTerminal.resolved === true
    ? `CEDIA-PLAN §10 item 64 receipt: resolved; see ${join(output, "dock-terminal-receipt.json")}`
    : `CEDIA-PLAN §10 item 64 receipt: UNRESOLVED — ${String(dockTerminal.blockedAt)}; see ${join(output, "dock-terminal-receipt.json")}`);
} catch (error) {
  await ide.screenshot({ path: join(output, "failure.png"), fullPage: true }).catch(() => undefined);
  const frames = await Promise.all(ide.frames().map(async (frame: any) => ({
    url: frame.url(),
    title: await frame.title().catch(() => ""),
    body: (await frame.locator("body").innerText().catch(() => "")).slice(0, 20_000),
    html: (await frame.locator("body").innerHTML().catch(() => "")).slice(0, 60_000),
  })));
  const windows = await Promise.all(app.windows().map(async (page: any, index: number) => ({
    index,
    url: page.url(),
    hash: await page.evaluate(() => window.location.hash).catch(() => ""),
    title: await page.title().catch(() => ""),
    body: (await page.locator("body").innerText().catch(() => "")).slice(0, 20_000),
  })));
  const body = await ide.locator("body").innerText().catch(() => "");
  await writeFile(join(output, "failure.json"), `${JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    errors,
    frames,
    windows,
    body: body.slice(0, 40_000),
    paletteDebug,
    sessionId: session.id,
    projectPath,
  }, null, 2)}\n`);
  throw error;
} finally {
  await closeAppBounded();
  await host.close();
  if (!keepScratch) await rm(scratch, { recursive: true, force: true });
}
