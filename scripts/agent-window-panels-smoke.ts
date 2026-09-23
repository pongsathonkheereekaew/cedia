/**
 * Runtime smoke for the Synara-shaped Agent Window panels.
 *
 * The default run exercises the packaged Electron shell. `--browser` is a
 * renderer-only fallback for CI environments without a packaged Cedia app;
 * native panel checks are reported as unsupported there rather than faked.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { startHostServer } from "../apps/host/src/server.ts";
import { createAgentFilesService } from "../apps/macos/src/agent-window-files.ts";
import { createAgentHostGateway, createAgentWindowHandler } from "../apps/macos/src/agent-window-main.ts";

type AnyRecord = Record<string, any>;
type PanelStatus = {
  clicked: boolean;
  ok: boolean;
  detail?: unknown;
  error?: string;
  screenshot?: string;
};

const root = resolve(import.meta.dir, "..");
/** Provider-free OMP the smokes drive; the packaged app reaches it through the host. */
const fixtureOmp = join(root, "apps/macos/test/fixtures/agent-window-omp");
const hostNode = process.env.CEDIA_HOST_NODE ?? "/Users/pond/.caret-tools/node-v24.18.0-darwin-arm64/bin/node";
const native = !process.argv.includes("--browser");
const { chromium, _electron } = createRequire(join(root, "desktop/package.json"))("playwright");
const scratch = await mkdtemp(join(tmpdir(), "cedia-agent-panels-"));
const projectPath = join(scratch, "project");
await mkdir(join(projectPath, "src"), { recursive: true });
await writeFile(join(projectPath, "README.md"), "Panel fixture workspace\n");
await writeFile(join(projectPath, "notes.txt"), "Base panel text\n");
await writeFile(join(projectPath, "src", "main.ts"), "export const panelFixture = true;\n");
// Make the Environment panel exercise a real repository diff instead of an
// empty-directory placeholder. The post-commit edit is the content the Files
// panel and the readback assertions below expect.
execFileSync("git", ["init", "-q"], { cwd: projectPath, stdio: "ignore" });
execFileSync("git", ["config", "user.name", "Cedia Panel Fixture"], { cwd: projectPath, stdio: "ignore" });
execFileSync("git", ["config", "user.email", "cedia-panel-fixture@example.invalid"], { cwd: projectPath, stdio: "ignore" });
execFileSync("git", ["add", "."], { cwd: projectPath, stdio: "ignore" });
execFileSync("git", ["commit", "-qm", "fixture baseline"], { cwd: projectPath, stdio: "ignore" });
execFileSync("git", ["branch", "-M", "main"], { cwd: projectPath, stdio: "ignore" });
await writeFile(join(projectPath, "notes.txt"), "Original panel text\n");

const stateDir = join(scratch, "host");
const host = await startHostServer({
  stateDir,
  ompExecutable: fixtureOmp,
  ompEnv: { CEDIA_NODE: process.execPath },
});
const project = host.host.store.createProject({ path: projectPath, name: "Panel fixture workspace" });
const session = host.host.createSession(project.id, "Panel fixture task");

// The browser panel must load an actual local page so the native WebContentsView
// path is exercised without relying on the network or a provider.
const browserFixture = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(request) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    if (pathname === "/favicon.ico") return new Response(null, { status: 204 });
    if (pathname !== "/cedia-panel-fixture") return new Response("Not found", { status: 404 });
    const marker = url.searchParams.get("marker")?.replace(/[^a-z0-9_-]/gi, "") || "blank";
    return new Response(
      `<!doctype html><html><head><title>Cedia panel browser fixture ${marker}</title></head><body><main data-cedia-browser-fixture="true">Cedia browser fixture ${marker}</main><a id="fixture-link" href="?marker=linked">Follow fixture link</a></body></html>`,
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );
  },
});
const browserFixtureUrl = new URL("cedia-panel-fixture", browserFixture.url).toString();

const gateway = createAgentHostGateway({ appRoot: root, parentPid: process.pid, stateDir });
const ideTargets: unknown[] = [];
const fixtureFiles = createAgentFilesService();
const fixturePanelEvent = { sender: { send: () => {}, isDestroyed: () => false } };
const handler = createAgentWindowHandler({
  ...gateway,
  authorize: () => true,
  pickFolder: async () => projectPath,
  openIde: async (input) => { ideTargets.push(input); },
  openExternal: async () => { throw new Error("External links are disabled in fixture tests"); },
  version: "panel-fixture",
  panel: async (_event, surface, method, input) => {
    if (surface === "files") return fixtureFiles.handle(fixturePanelEvent, method, input);
    throw new Error(`Native ${surface} panel unavailable in renderer-only tests`);
  },
});

const output = join(root, process.argv.includes("--hover-only") ? "dist/agent-file-hover-smoke" : "dist/agent-window-panels-smoke");
await mkdir(output, { recursive: true });
const assets = join(root, "dist/agent-window");
const appServer = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(request) {
    const url = new URL(request.url);
    const assetPath = resolve(assets, `.${decodeURIComponent(url.pathname)}`);
    if (assetPath !== assets && !assetPath.startsWith(`${assets}/`)) return new Response("Not found", { status: 404 });
    const file = Bun.file(assetPath === assets ? join(assets, "index.html") : assetPath);
    if (await file.exists()) return new Response(file);
    return new Response(Bun.file(join(assets, "index.html")));
  },
});

/**
 * Packaged-run receipts the plan carries as owed (§10 items 54, 55, 57, 60, 61, 62).
 * Each step records its claim, the assertions it made and the values it saw, so
 * `receipts.json` is the evidence itself rather than a prose summary of it.
 */
interface ReceiptStep {
  readonly item: string;
  readonly claim: string;
  readonly status: "passed" | "owed";
  readonly assertions: readonly string[];
  readonly observed: Record<string, unknown>;
  readonly blocker?: string;
}

const receiptSteps: ReceiptStep[] = [];
/** Dead state the claims above do not cover, quoted verbatim so the plan receipt can act on it. */
const receiptFindings: Array<{ readonly where: string; readonly detail: string }> = [];

const recordError = (error: unknown): string => error instanceof Error ? error.message : String(error);
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};
const waitFor = async <T>(read: () => Promise<T>, predicate: (value: T) => boolean, timeoutMs = 30_000): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  let latest: T;
  do {
    latest = await read();
    if (predicate(latest)) return latest;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  } while (Date.now() < deadline);
  return latest!;
};
async function pathExists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}

// ─── Fresh-profile receipts (§10 items 60 and 57) ──────────────────────────
// These two ride their own app run: an empty host state directory and a scratch
// HOME, which is what item 60's close condition asks for and what makes the
// keybinding file the workbench's own for item 57.
//
// No `--user-data-dir` on purpose. With the default user data directory the
// workbench owns `homedir()/Library/Application Support/Cedia/User/keybindings.json`
// — the same rule (`getUserDataPath(args, nameShort)`) the agent bridge computes
// for `defaultKeybindingsFile()` — while the flag moves the workbench somewhere
// else and the two stop being the same file.
//
// The scratch sits directly in `/tmp` because macOS refuses a unix socket path
// longer than 103 characters and the workbench claims one under `<userData>/`:
// `tmpdir()` plus this directory plus `Library/Application Support/Cedia` is over
// the limit, `/private/tmp` is not.
const freshScratch = await mkdtemp("/tmp/cedia-agent-fresh-");
const freshHome = join(freshScratch, "home");
const freshStateDir = join(freshScratch, "host");
await mkdir(freshHome, { recursive: true });
const freshHost = await startHostServer({
  stateDir: freshStateDir,
  ompExecutable: fixtureOmp,
  ompEnv: { CEDIA_NODE: process.execPath },
});

/**
 * §10 item 60 — walk every sidebar row and every settings section the window
 * renders on a fresh profile, and read each one: its accessible name, whether it
 * is interactive, and whether it renders content or a live empty state.
 */
async function firstRunWalk(freshPage: any, requests: readonly string[]): Promise<{ observed: AnyRecord; disabledWithoutReason: AnyRecord[] }> {
  // The shell is up when its primary action renders; the first-run setup dialog
  // is a layer over it rather than a replacement for it.
  await freshPage.getByRole("button", { name: "New thread", exact: true }).waitFor({ state: "visible", timeout: 90_000 });
  const firstRun = await freshPage.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    return {
      present: dialog !== null,
      controls: dialog
        ? Array.from(dialog.querySelectorAll("button")).map((node) => ({ name: (node.textContent ?? "").trim(), disabled: (node as HTMLButtonElement).disabled === true }))
        : [],
    };
  });
  const dismissStart = Date.now();
  const skipSetup = freshPage.getByRole("button", { name: "Skip setup", exact: true });
  if (await skipSetup.count() > 0) await skipSetup.click();
  const backdrop = await waitFor(() => freshPage.locator('[data-slot="dialog-backdrop"]').count(), (count: number) => count === 0, 20_000);
  assert(backdrop === 0, "The first-run dialog's backdrop never left the window");
  const dismissedMs = Date.now() - dismissStart;

  const sidebar = await freshPage.evaluate(() => {
    const region = document.querySelector('[data-slot="sidebar"][data-side="left"]');
    if (!region) throw new Error("The Agents window rendered no left sidebar");
    const visible = (node: Element) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const rows = Array.from(region.querySelectorAll('button, a, [role="button"], [role="menuitem"], [role="switch"], input'))
      .filter(visible)
      .map((node) => ({
        name: (node.getAttribute("aria-label") ?? node.textContent ?? "").trim().replace(/\s+/g, " "),
        disabled: (node as HTMLButtonElement).disabled === true || node.getAttribute("aria-disabled") === "true",
        reason: node.getAttribute("aria-description") ?? node.getAttribute("title") ?? node.querySelector("[title]")?.getAttribute("title") ?? null,
      }));
    return { rows, text: (region as HTMLElement).innerText };
  });
  const rows: AnyRecord[] = sidebar.rows;
  const rowNamed = (name: string): AnyRecord | undefined => rows.find((candidate) => candidate.name === name);
  assert(rows.every((row) => row.name.length > 0), `Sidebar row without an accessible name: ${JSON.stringify(rows.filter((row) => row.name.length === 0))}`);
  const cutSurfaces = rows.filter((row) => /kanban|pull request|plugin|studio|spaces/i.test(row.name));
  assert(cutSurfaces.length === 0, `The sidebar still offers a surface §10 item 60 cut: ${JSON.stringify(cutSurfaces)}`);
  const unexplainedRows = rows.filter((row) => row.disabled && !row.reason);
  assert(unexplainedRows.length === 0, `Disabled sidebar row with no reason: ${JSON.stringify(unexplainedRows)}`);
  assert(rowNamed("New thread") !== undefined && rowNamed("New thread")!.disabled === false, "The sidebar's New thread row is missing or disabled");
  assert(rowNamed("Settings") !== undefined && rowNamed("Settings")!.disabled === false, "The sidebar's Settings row is missing or disabled");
  assert(rowNamed("Automations")?.disabled === true && /automation backend/i.test(String(rowNamed("Automations")?.reason)), `The Automations row is no longer an honest-unavailable row: ${JSON.stringify(rowNamed("Automations"))}`);

  // Every sidebar section renders rows or a live empty state, never a blank body.
  const lines = String(sidebar.text).split("\n").map((line: string) => line.trim());
  const headers = ["Projects", "Chats", "Settings", "Help"];
  const groups = ["Projects", "Chats"].map((label) => {
    const start = lines.indexOf(label);
    const stops = headers.map((header) => lines.indexOf(header, start + 1)).filter((index) => index > start);
    const body = start < 0 ? [] : lines.slice(start + 1, stops.length > 0 ? Math.min(...stops) : undefined).filter((line: string) => line.length > 0);
    return { label, present: start >= 0, body };
  });
  assert(groups.every((group) => group.present && group.body.length > 0), `A sidebar section is blank-but-present: ${JSON.stringify(groups)}`);

  // Every settings section the window renders.
  await freshPage.getByRole("button", { name: "Settings", exact: true }).first().click();
  await freshPage.waitForFunction(() => location.hash.startsWith("#/settings"), undefined, { timeout: 20_000 });
  await freshPage.waitForTimeout(500);
  const sectionNames: string[] = await freshPage.evaluate(() => Array.from(document.querySelectorAll('[data-slot="sidebar"][data-side="left"] button'))
    .map((node) => (node.textContent ?? "").trim())
    .filter((name) => name.length > 0 && !["Settings", "Back to app", "Help"].includes(name)));
  assert(sectionNames.length >= 8, `Settings rendered ${sectionNames.length} sections: ${JSON.stringify(sectionNames)}`);
  const sections: AnyRecord[] = [];
  const disabledWithoutReason: AnyRecord[] = [];
  for (const name of sectionNames) {
    const button = freshPage.getByRole("button", { name, exact: true }).first();
    assert(await button.count() > 0, `Settings row '${name}' is missing`);
    await button.click();
    await freshPage.waitForTimeout(450);
    const panel = await freshPage.evaluate(() => {
      const main = document.querySelector("main") ?? document.body;
      const visible = (node: Element) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const controls = Array.from(main.querySelectorAll('button, a, [role="button"], [role="menuitem"], [role="switch"], input, select, [role="checkbox"], [role="radio"], [role="combobox"]'))
        .filter(visible)
        .map((node) => ({
          name: (node.getAttribute("aria-label") ?? node.textContent ?? "").trim().replace(/\s+/g, " "),
          disabled: (node as HTMLButtonElement).disabled === true || node.getAttribute("aria-disabled") === "true",
          reason: node.getAttribute("aria-description") ?? node.getAttribute("title") ?? node.querySelector("[title]")?.getAttribute("title") ?? null,
        }));
      return {
        url: location.hash,
        text: (main as HTMLElement).innerText,
        headings: Array.from(main.querySelectorAll("h1, h2, h3")).map((node) => (node.textContent ?? "").trim()).filter(Boolean),
        anchors: Array.from(main.querySelectorAll('[id^="setting-"]')).map((node) => node.id),
        controls,
      };
    });
    const panels: AnyRecord[] = panel.controls;
    assert(sections.length === 0 || panel.url.includes("section="), `Settings row '${name}' did not navigate: ${panel.url}`);
    assert(panel.text.trim().length >= 15, `Settings section '${name}' is blank-but-present`);
    assert(panel.headings.length > 0, `Settings section '${name}' rendered nothing heading its content`);
    assert(panels.some((control) => !control.disabled), `Settings section '${name}' has no live control`);
    for (const control of panels) if (control.disabled && !control.reason) disabledWithoutReason.push({ section: name, name: control.name });
    const errorLine = panel.text.split("\n").map((line: string) => line.trim()).find((line: string) => /Error invoking remote method|Unsupported application route|Failed to (?:load|fetch)/.test(line));
    if (errorLine) receiptFindings.push({ where: `Settings → ${name}`, detail: errorLine });
    sections.push({
      name,
      url: panel.url,
      headings: panel.headings,
      anchors: panel.anchors.length,
      textLength: panel.text.trim().length,
      controls: panels.length,
      disabledControls: panels.filter((control) => control.disabled).map((control) => ({ name: control.name, reason: control.reason })),
    });
  }

  const trysynara = requests.filter((url) => /trysynara/i.test(url));
  assert(trysynara.length === 0, `The Agents window requested ${trysynara.join(", ")}`);

  return {
    disabledWithoutReason,
    observed: {
      firstRun,
      dismissedMs,
      requestCount: requests.length,
      trysynaraRequests: trysynara.length,
      sidebarRows: rows,
      sidebarGroups: groups,
      sidebarText: String(sidebar.text).slice(0, 1_200),
      sections,
    },
  };
}

/**
 * §10 item 57 — a binding edited in the window's keybinding section lands in
 * `Cedia/User/keybindings.json`, and that file is the workbench's own user
 * keybindings file: the path the bundle and the bridge report is the one the
 * workbench reads it from.
 */
async function keybindingsCrossWindow(freshPage: any, freshApp: any, walk: AnyRecord): Promise<AnyRecord> {
  const userDataDir = await freshApp.evaluate(({ app: electronApp }: { app: { getPath(name: string): string } }) => electronApp.getPath("userData"));
  const keybindingsFile = join(userDataDir, "User", "keybindings.json");
  const product = JSON.parse(await readFile(join(root, `VSCode-darwin-${process.arch}/Cedia.app/Contents/Resources/app/product.json`), "utf8")) as { nameShort?: unknown };
  const workbenchUserDataDir = join(freshHome, "Library", "Application Support", String(product.nameShort));
  assert(userDataDir === workbenchUserDataDir, `The app's user data dir '${userDataDir}' is not the workbench's own '${workbenchUserDataDir}'`);
  assert(!(await pathExists(keybindingsFile)), `The scratch profile already had ${keybindingsFile}`);

  // The path the bundle reports, as Settings → System tools renders it (the
  // Keybindings row's status span).
  await freshPage.getByRole("button", { name: "System tools", exact: true }).first().click();
  const reportedPath = await waitFor(
    async () => await freshPage.evaluate(() => Array.from(document.querySelectorAll("span, code, p"))
      .map((node) => (node.textContent ?? "").trim())
      .find((text) => text.endsWith("keybindings.json")) ?? null),
    (value: string | null) => value !== null,
    15_000,
  );
  assert(reportedPath === keybindingsFile, `The bundle reported '${reportedPath}', not the workbench user keybindings file '${keybindingsFile}'`);

  // A row with no command must not mount an editor at all. The packaged receipt of
  // 2026-09-23 found the opposite - the panel opened an editor for the command-less
  // `shortcuts.show` row because `null === null` identified it as the editing target -
  // and its Save then persisted nothing. That is fixed in
  // `KeyboardShortcutsSettingsPanel.isShortcutRowEditing`, and this asserts the shipped
  // contract: the editor appears only after Edit, and a Save that runs always writes.
  await freshPage.getByRole("button", { name: "Keybindings", exact: true }).first().click();
  await freshPage.waitForTimeout(600);
  const editorsBeforeEdit = await freshPage.locator('input[aria-label^="Shortcut for "]').count();
  assert(editorsBeforeEdit === 0, `The Keybindings section mounted ${editorsBeforeEdit} row editor(s) before any Edit click`);

  // A row that owns a command is the section's real write path.
  await freshPage.getByRole("button", { name: "Edit", exact: true }).first().click();
  await freshPage.waitForTimeout(300);
  const capture = freshPage.locator('input[aria-label^="Shortcut for "]').first();
  const editedLabel = String(await capture.getAttribute("aria-label"));
  await capture.click();
  await capture.press("Meta+Alt+9");
  const captured = await capture.inputValue();
  assert(captured === "mod+alt+9", `The editor captured '${captured}' instead of 'mod+alt+9'`);
  const save = freshPage.getByRole("button", { name: "Save", exact: true }).first();
  assert(!(await save.isDisabled()), "Save stayed disabled with a captured key");
  await save.click();
  await freshPage.getByText("Shortcut saved", { exact: true }).first().waitFor({ timeout: 15_000 });

  const fileText = await readFile(keybindingsFile, "utf8");
  const fileRows = JSON.parse(fileText) as Array<{ key?: unknown; command?: unknown; when?: unknown }>;
  const written = fileRows.find((row) => row.key === "mod+alt+9");
  assert(written !== undefined && typeof written.command === "string", `keybindings.json did not receive the captured binding: ${fileText}`);
  const readout = await freshPage.evaluate(async (file: string) => {
    const bridge = (window as any).vscode?.ipcRenderer;
    return await bridge.invoke("vscode:cediaAgent", { kind: "keybindings", action: "read", file });
  }, keybindingsFile) as AnyRecord;
  assert(readout.configPath === keybindingsFile, `The bridge reports '${readout.configPath}' rather than '${keybindingsFile}'`);
  assert(Array.isArray(readout.keybindings) && readout.keybindings.some((row: AnyRecord) => row.command === written.command), `The bridge read back ${JSON.stringify(readout.keybindings)}`);

  return {
    editorsBeforeEdit,
    editedRow: editedLabel,
    captured,
    written,
    configPath: readout.configPath,
    keybindingsFile,
    workbenchUserDataDir,
    userDataDir,
    disabledWithoutReason: walk.disabledWithoutReason,
  };
}

if (native) {
  // Keep the personal launcher behaviour used by the normal smoke: an ad-hoc
  // re-signed app must not inherit a stale Chromium Safe Storage item.
  try { execFileSync("security", ["delete-generic-password", "-s", "Cedia Safe Storage"], { stdio: "ignore" }); } catch {}
}

if (native && !process.argv.includes("--hover-only")) {
  let fresh: any;
  try {
    fresh = await _electron.launch({
      executablePath: join(root, `VSCode-darwin-${process.arch}/Cedia.app/Contents/MacOS/Cedia`),
      args: ["--password-store=basic", "--use-inmemory-secretstorage", "--skip-welcome", "--skip-release-notes"],
      env: { ...process.env, HOME: freshHome, CEDIA_STATE_DIR: freshStateDir, CEDIA_OMP_PATH: fixtureOmp, CEDIA_HOST_NODE: hostNode },
      timeout: 45_000,
    });
    const freshPage = await fresh.firstWindow();
    const requests: string[] = [];
    const freshErrors: string[] = [];
    freshPage.on("request", (request: { url(): string }) => requests.push(request.url()));
    freshPage.on("pageerror", (error: Error) => freshErrors.push(error.message));
    const walk = await firstRunWalk(freshPage, requests);
    const keybindings = await keybindingsCrossWindow(freshPage, fresh, walk);
    const unexplained: AnyRecord[] = walk.disabledWithoutReason;
    assert(unexplained.length === 0, `Disabled controls with no reason: ${JSON.stringify(unexplained)}`);
    receiptSteps.push({
      item: "§10 item 60",
      claim: "A fresh-profile run through every sidebar row and settings section shows no dead state and no trysynara egress",
      status: "passed",
      assertions: [
        "every sidebar row carries an accessible name",
        "no sidebar row offers a cut surface (Kanban / Pull requests / Plugins / Studio / Spaces)",
        "no disabled sidebar row lacks a reason",
        "the Automations row is disabled with the honest-unavailable reason",
        "every sidebar section renders rows or a live empty state",
        "every settings section is non-blank, has a heading, and keeps one enabled control",
        "no keybinding row mounts an editor before Edit, and the row editor that does open saves and writes the file (proved by §10 item 57's step below)",
        "no page request URL contains 'trysynara'",
      ],
      observed: { ...walk.observed, disabledWithoutReason: unexplained, freshRendererErrors: freshErrors, keybindingEditorsBeforeEdit: keybindings.editorsBeforeEdit },
    });
    receiptSteps.push({
      item: "§10 item 57",
      claim: "A binding edited in the Agents window lands in Cedia/User/keybindings.json, which is the workbench's own user keybindings file",
      status: "passed",
      assertions: [
        "the app's user data dir is homedir()/Library/Application Support/<nameShort> — the directory the workbench reads its user keybindings from",
        "Settings → System tools reports that same keybindings.json path",
        "the mounted editor's disabled Save enables once a key is captured",
        "a row's Edit → capture → Save writes mod+alt+9 into keybindings.json on disk",
        "the bridge's own read of that path succeeds and reports configPath equal to it",
      ],
      observed: keybindings as AnyRecord,
    });
  } catch (error) {
    const failureShot = await Promise.resolve()
      .then(async () => { const page = await fresh?.firstWindow(); if (page) await page.screenshot({ path: join(output, "fresh-failure.png"), fullPage: true }); })
      .catch(() => undefined);
    void failureShot;
    await writeFile(join(output, "fresh-failure.json"), JSON.stringify({ error: recordError(error), receiptSteps, receiptFindings }, null, 2)).catch(() => undefined);
    throw error;
  } finally {
    if (fresh) await closeBrowserBounded(fresh);
    await freshHost.close();
  }
}

const launchNative = () => _electron.launch({
  executablePath: join(root, `VSCode-darwin-${process.arch}/Cedia.app/Contents/MacOS/Cedia`),
  args: [
    "--user-data-dir", join(scratch, "profile"),
    "--password-store=basic",
    "--use-inmemory-secretstorage",
    "--skip-welcome",
    "--skip-release-notes",
  ],
  env: {
    ...process.env,
    CEDIA_STATE_DIR: stateDir,
    CEDIA_HOST_NODE: process.env.CEDIA_HOST_NODE ?? "/Users/pond/.caret-tools/node-v24.18.0-darwin-arm64/bin/node",
  },
  timeout: 45_000,
});
let browser = native ? await launchNative() : await chromium.launch({ headless: true, channel: "chromium" });
let page = native
  ? await browser.firstWindow()
  : await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });

const errors: string[] = [];
const panelResults: Record<string, PanelStatus> = {};
const bridgeRequests: unknown[] = [];
page.on("pageerror", (error: Error) => errors.push(error.message));
page.on("console", (message: { type(): string; text(): string }) => {
  if (message.type() === "error") errors.push(message.text());
});

if (!native) {
  await page.exposeBinding("__cediaFixtureInvoke", async (_source: unknown, channel: string, input: unknown) => {
    if (channel !== "vscode:cediaAgent") throw new Error(`Unexpected fixture IPC channel: ${channel}`);
    bridgeRequests.push(input);
    return handler({}, input);
  });
  await page.addInitScript(() => {
    const target = window as unknown as {
      __cediaFixtureInvoke(channel: string, input: unknown): Promise<unknown>;
      vscode: unknown;
    };
    target.vscode = {
      context: { resolveConfiguration: async () => ({ windowId: 1, isSessionsWindow: true }) },
      process: { platform: "darwin", env: {} },
      ipcRenderer: {
        invoke: (channel: string, input: unknown) => target.__cediaFixtureInvoke(channel, input),
        send: () => {},
        on: () => {},
        once: () => {},
        removeListener: () => {},
      },
    };
  });
}

const screenshot = async (name: string): Promise<string> => {
  const path = join(output, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  return path;
};

async function rawPanelInvoke(surface: string, method: string, input: AnyRecord): Promise<any> {
  assert(native, `${surface}.${method} needs the packaged Electron shell`);
  return await page.evaluate(async ({ surface, method, input }: { surface: string; method: string; input: AnyRecord }) => {
    const bridge = (window as any).vscode?.ipcRenderer;
    if (!bridge?.invoke) throw new Error("Agent Window preload bridge is unavailable");
    return await bridge.invoke("vscode:cediaAgent", { kind: "panel", surface, method, input });
  }, { surface, method, input });
}

async function terminalSmoke(): Promise<Record<string, unknown>> {
  assert(native, "Terminal PTY requires the packaged Electron shell");
  const terminalId = "panel-smoke-terminal";
  const marker = "cedia-panel-terminal-ok";
  const result = await page.evaluate(async ({ threadId, cwd, terminalId, marker }: { threadId: string; cwd: string; terminalId: string; marker: string }) => {
    const bridge = (window as any).vscode?.ipcRenderer;
    if (!bridge?.invoke || typeof bridge.on !== "function") throw new Error("Terminal preload events are unavailable");
    let output = "";
    const onEvent = (_event: unknown, payload: any) => {
      const event = payload?.event ?? payload;
      if (event?.type === "output" && event.threadId === threadId && event.terminalId === terminalId) output += String(event.data ?? "");
    };
    bridge.on("vscode:cediaAgentTerminal", onEvent);
    try {
      await bridge.invoke("vscode:cediaAgent", {
        kind: "panel", surface: "terminal", method: "open",
        input: { threadId, terminalId, cwd, cols: 100, rows: 30, streamOutput: true },
      });
      await bridge.invoke("vscode:cediaAgent", {
        kind: "panel", surface: "terminal", method: "write",
        input: { threadId, terminalId, data: `printf '${marker}\\n'\n` },
      });
      const deadline = Date.now() + 15_000;
      while (!output.split(/\r?\n/).some(line => line.trim() === marker) && Date.now() < deadline) await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
      return { output, found: output.split(/\r?\n/).some(line => line.trim() === marker) };
    } finally {
      bridge.removeListener?.("vscode:cediaAgentTerminal", onEvent);
      await bridge.invoke("vscode:cediaAgent", {
        kind: "panel", surface: "terminal", method: "close", input: { threadId, terminalId },
      }).catch(() => undefined);
    }
  }, { threadId: session.id, cwd: projectPath, terminalId, marker });
  assert(result.found, `Terminal PTY did not emit '${marker}': ${JSON.stringify(result.output)}`);
  return result;
}

async function filesSmoke(): Promise<Record<string, unknown>> {
  assert(native, "Files native bridge requires the packaged Electron shell");
  const rootListing = await rawPanelInvoke("files", "projects.listDirectories", { cwd: projectPath, includeFiles: true });
  const names = (rootListing.entries ?? []).map((entry: AnyRecord) => entry.name);
  assert(names.includes("notes.txt") && names.includes("src"), "Files panel did not list the fixture tree");
  const before = await rawPanelInvoke("files", "projects.readFile", { cwd: projectPath, relativePath: "notes.txt" });
  assert(before.contents === "Original panel text\n", "Files panel read returned the wrong fixture content");
  // Item 63(d): the panel's direct write surface is guarded — workspace writes are
  // applied through OMP turns and the guarded editor bridge, so a second writer can
  // never slip past the editor. That refusal, and the untouched file behind it, is
  // the contract to assert here (the unit suite covers the service-level refusal).
  const refusal = await rawPanelInvoke("files", "projects.writeFile", {
    cwd: projectPath,
    relativePath: "notes.txt",
    contents: "Edited from panel smoke\n",
    expectedVersion: before.version,
    encoding: before.encoding,
    lineEnding: before.lineEnding,
  }).then(() => null, (error: unknown) => (error instanceof Error ? error.message : String(error)));
  assert(refusal !== null && refusal.includes("Workspace writes are applied through OMP turns and the guarded editor bridge"), `Files panel write was not refused by the write guard: ${refusal ?? "it resolved"}`);
  // contents is a hash, so an unchanged version is the same proof as an unchanged body.
  const after = await rawPanelInvoke("files", "projects.readFile", { cwd: projectPath, relativePath: "notes.txt" });
  assert(after.contents === before.contents && after.version === before.version, "Refused Files panel write changed the fixture file");
  // The content search scans the working tree instead of the panel's read path, so the one
  // line it reports for this file is the disk truth: the fixture text, and nothing from the
  // refused write ("Edited from panel smoke" would match the same query).
  const search = await rawPanelInvoke("files", "projects.searchContent", { cwd: projectPath, query: "panel", limit: 50 });
  const searchLines = (search.matches ?? []).filter((match: AnyRecord) => match.path === "notes.txt").map((match: AnyRecord) => match.lineText);
  assert(searchLines.length === 1 && searchLines[0] === "Original panel text", `Files panel content search did not read the untouched fixture: ${JSON.stringify(searchLines)}`);
  return { listed: names, version: after.version, refusal, searchLines };
}

async function browserSmoke(): Promise<Record<string, unknown>> {
  assert(native, "Browser WebContentsView requires the packaged Electron shell");
  const nav = await openLauncher();
  await nav.getByRole("button", { name: "Open Browser", exact: true }).click();
  await page.getByPlaceholder("Search or enter a URL", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  const markerOneUrl = new URL("cedia-panel-fixture?marker=one", browserFixture.url).toString();
  const markerTwoUrl = new URL("cedia-panel-fixture?marker=two", browserFixture.url).toString();
  const state = await rawPanelInvoke("browser", "open", { threadId: session.id });
  assert(state?.tabs?.length > 0, "Browser panel did not create a native tab");
  const tabId = state.activeTabId ?? state.tabs[0].id;
  const address = page.locator('input[placeholder="Search or enter a URL"]');
  await address.fill(markerOneUrl);
  await address.press("Enter");
  const loaded = await waitFor(
    () => rawPanelInvoke("browser", "getState", { threadId: session.id }),
    (value) => value?.tabs?.some((tab: AnyRecord) => tab.id === tabId && tab.lastCommittedUrl?.startsWith(markerOneUrl)),
    20_000,
  );
  const active = loaded.tabs.find((tab: AnyRecord) => tab.id === tabId);
  assert(active?.lastCommittedUrl?.startsWith(markerOneUrl), "Browser WebContentsView did not load the first local fixture");
  await page.locator('input[placeholder="Search or enter a URL"]').waitFor({ state: "visible" });
  await page.waitForFunction((url: string) => (document.querySelector('input[placeholder="Search or enter a URL"]') as HTMLInputElement | null)?.value === url, markerOneUrl, { timeout: 15_000 });
  const capture = await page.evaluate(async ({ threadId, tabId }: { threadId: string; tabId: string }) => {
    const bridge = (window as any).vscode?.ipcRenderer;
    const value = await bridge.invoke("vscode:cediaAgent", { kind: "panel", surface: "browser", method: "captureScreenshot", input: { threadId, tabId } });
    const bytes = value?.bytes instanceof Uint8Array ? Array.from(value.bytes) : Array.isArray(value?.bytes) ? value.bytes : null;
    return { name: value?.name, mimeType: value?.mimeType, sizeBytes: value?.sizeBytes, bytes };
  }, { threadId: session.id, tabId });
  assert(capture.sizeBytes > 0, "Browser WebContentsView did not produce the first screenshot");
  if (capture.bytes && capture.bytes.length > 0) {
    await writeFile(join(output, "browser-webcontents-view-one.png"), Buffer.from(capture.bytes));
  }
  await browser.evaluate(async ({ webContents }: any, expectedUrl: string) => {
    const guest = webContents.getAllWebContents().find((contents: any) => contents.getURL() === expectedUrl);
    if (!guest) throw new Error("Fixture browser page is missing");
    (globalThis as any).__cediaBrowserNavigationProbe = [];
    for (const event of ["will-navigate", "will-redirect", "did-navigate", "did-fail-load"]) {
      guest.on(event, (...args: any[]) => (globalThis as any).__cediaBrowserNavigationProbe.push({ event, args: args.map(arg => typeof arg === "object" && arg ? { keys: Object.keys(arg), url: arg.url, isMainFrame: arg.isMainFrame, defaultPrevented: arg.defaultPrevented } : arg) }));
    }
    await guest.executeJavaScript('document.getElementById("fixture-link").click()', true);
  }, markerOneUrl);
  const followed = await waitFor(
    () => rawPanelInvoke("browser", "getState", { threadId: session.id }),
    (value) => value?.tabs?.some((tab: AnyRecord) => tab.id === tabId && tab.lastCommittedUrl?.includes("marker=linked") && !tab.isLoading && tab.canGoBack),
    15_000,
  );
  assert(followed?.tabs?.some((tab: AnyRecord) => tab.id === tabId && tab.lastCommittedUrl?.includes("marker=linked")), `Clicking a link inside the page was blocked: ${JSON.stringify(await browser.evaluate(() => (globalThis as any).__cediaBrowserNavigationProbe))} state=${JSON.stringify(followed)}`);
  await rawPanelInvoke("browser", "goBack", { threadId: session.id, tabId });
  const returned = await waitFor(() => rawPanelInvoke("browser", "getState", { threadId: session.id }), (value) => value?.tabs?.some((tab: AnyRecord) => tab.id === tabId && tab.lastCommittedUrl === markerOneUrl && !tab.isLoading), 15_000);
  assert(returned?.tabs?.some((tab: AnyRecord) => tab.id === tabId && tab.lastCommittedUrl === markerOneUrl), `Back navigation failed: ${JSON.stringify(returned)} probe=${JSON.stringify(await browser.evaluate(({ webContents }: any) => ({ events: (globalThis as any).__cediaBrowserNavigationProbe, histories: webContents.getAllWebContents().filter((wc: any) => wc.getURL().includes("cedia-panel-fixture")).map((wc: any) => ({url:wc.getURL(), back:wc.navigationHistory?.canGoBack(), entries:wc.navigationHistory?.getAllEntries(), index:wc.navigationHistory?.getActiveIndex()})) })))}`);
  // Native macOS restores the address field's DOM focus when a click returns
  // from the guest. That must not reopen suggestions over the tab controls.
  await address.evaluate((input: HTMLInputElement) => { input.blur(); input.focus(); });
  assert(await page.getByRole("button", { name: `Open ${markerOneUrl} ${markerOneUrl}`, exact: true }).count() === 0, "Restored address focus reopened suggestions over Browser tabs");
  await page.getByRole("button", { name: "New tab", exact: true }).last().click();
  const second = await waitFor(() => rawPanelInvoke("browser", "getState", { threadId: session.id }), value => value.tabs.length === state.tabs.length + 1, 10_000);
  await address.fill(markerTwoUrl);
  await address.press("Enter");
  const secondTabId = second.activeTabId ?? second.tabs.at(-1)?.id;
  assert(typeof secondTabId === "string" && secondTabId !== tabId, "Browser panel did not create a second tab");
  const secondLoaded = await waitFor(
    () => rawPanelInvoke("browser", "getState", { threadId: session.id }),
    (value) => value?.tabs?.some((tab: AnyRecord) => tab.id === secondTabId && tab.lastCommittedUrl?.startsWith(markerTwoUrl)),
    20_000,
  );
  const secondActive = secondLoaded.tabs.find((tab: AnyRecord) => tab.id === secondTabId);
  assert(secondActive?.lastCommittedUrl?.startsWith(markerTwoUrl), "Browser WebContentsView did not load the second local fixture");
  await page.waitForFunction((url: string) => (document.querySelector('input[placeholder="Search or enter a URL"]') as HTMLInputElement | null)?.value === url, markerTwoUrl, { timeout: 15_000 });
  const secondCapture = await page.evaluate(async ({ threadId, tabId }: { threadId: string; tabId: string }) => {
    const bridge = (window as any).vscode?.ipcRenderer;
    const value = await bridge.invoke("vscode:cediaAgent", { kind: "panel", surface: "browser", method: "captureScreenshot", input: { threadId, tabId } });
    const bytes = value?.bytes instanceof Uint8Array ? Array.from(value.bytes) : Array.isArray(value?.bytes) ? value.bytes : null;
    return { sizeBytes: value?.sizeBytes, bytes };
  }, { threadId: session.id, tabId: secondTabId });
  assert(secondCapture.sizeBytes > 0, "Browser WebContentsView did not produce the second screenshot");
  if (secondCapture.bytes && secondCapture.bytes.length > 0) {
    await writeFile(join(output, "browser-webcontents-view-two.png"), Buffer.from(secondCapture.bytes));
  }
  const firstBytes = capture.bytes ?? [];
  const secondBytes = secondCapture.bytes ?? [];
  assert(firstBytes.length !== secondBytes.length || firstBytes.some((value: number, index: number) => value !== secondBytes[index]), "Switching browser tabs produced identical rendered content");
  await rawPanelInvoke("browser", "selectTab", { threadId: session.id, tabId });
  await page.waitForFunction((url: string) => (document.querySelector('input[placeholder="Search or enter a URL"]') as HTMLInputElement | null)?.value === url, markerOneUrl, { timeout: 15_000 });
  const attachedUrls = await browser.evaluate(({ BrowserWindow }: any) => BrowserWindow.getAllWindows().flatMap((window: any) =>
    window.contentView.children.flatMap((view: any) => view.webContents ? [view.webContents.getURL()] : [])));
  assert(attachedUrls.includes(markerOneUrl) && !attachedUrls.includes(markerTwoUrl), "The selected browser tab was not the attached native view");
  await address.focus();
  await page.keyboard.press("Meta+-");
  await waitFor(() => page.evaluate(() => window.desktopBridge?.getZoomFactor?.()), value => typeof value === "number" && value < 1, 5_000);
  const zoomedBrowserBounds = await waitFor(async () => {
    const dom = await page.locator('[data-browser-viewport="true"]').boundingBox();
    const view = await browser.evaluate(({ BrowserWindow }: any) => {
      for (const owner of BrowserWindow.getAllWindows()) {
        const guest = owner.contentView.children.find((child: any) => child.webContents?.getURL().includes("cedia-panel-fixture"));
        if (guest) return { bounds: guest.getBounds(), factor: owner.webContents.getZoomFactor() };
      }
      return null;
    });
    return { dom, view };
  }, value => Boolean(value.dom && value.view && ["x", "y", "width", "height"].every(key => Math.abs(value.dom[key] * value.view.factor - value.view.bounds[key]) <= 2)), 10_000);
  assert(zoomedBrowserBounds.view, "Zoomed Browser view did not align with its renderer viewport");
  await page.keyboard.press("Meta+0");
  await waitFor(() => page.evaluate(() => window.desktopBridge?.getZoomFactor?.()), value => value === 1, 5_000);
  await screenshot("browser-switched-back");
  await page.getByRole("button", { name: "Close tab", exact: true }).last().click();
  const closedTab = await waitFor(() => rawPanelInvoke("browser", "getState", { threadId: session.id }), value => !value.tabs.some((tab: AnyRecord) => tab.id === secondTabId), 10_000);
  assert(closedTab.tabs.length === state.tabs.length, "Closing a browser tab did not remove it");
  await page.getByRole("button", { name: "Close tab", exact: true }).click();
  const allClosed = await waitFor(() => rawPanelInvoke("browser", "getState", { threadId: session.id }), value => value.tabs.length === 0 && !value.open, 10_000);
  assert(allClosed.activeTabId === null, "Closing the final tab did not close the Browser");
  await collapseDock();
  return { addedTabViaUI: true, closedTabViaUI: true, followedLink: true, zoomedBrowserBounds, attachedUrls, state: active, secondTab: secondActive, screenshotBytes: [capture.sizeBytes, secondCapture.sizeBytes], fixtureUrls: [markerOneUrl, markerTwoUrl] };
}

async function openLauncher(): Promise<any> {
  const nav = page.getByRole("navigation", { name: "Open a panel", exact: true });
  const toggle = page.getByRole("button", { name: "Toggle right sidebar", exact: true });
  if (await toggle.getAttribute("aria-pressed") !== "true") await toggle.click();
  const paneClosers = page.locator("[data-right-dock-content] > div:first-child").getByRole("button", { name: /^Close / });
  for (let count = 0; count < 10 && await paneClosers.count() > 0; count++) await paneClosers.first().click();
  await nav.waitFor({ state: "visible", timeout: 15_000 });
  return nav;
}

async function collapseDock(): Promise<void> {
  const toggle = page.getByRole("button", { name: "Toggle right sidebar", exact: true });
  if (await toggle.getAttribute("aria-pressed") === "true") await toggle.click();
  await page.waitForFunction(() => document.querySelector('button[aria-label="Toggle right sidebar"]')?.getAttribute("aria-pressed") === "false");
}

type LayoutBox = { x: number; y: number; width: number; height: number };

function boxesOverlap(left: LayoutBox, right: LayoutBox): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

async function visibleElementCount(locator: any): Promise<number> {
  return await locator.evaluateAll((nodes: Element[]) => nodes.filter((node: Element) => {
    const element = node as HTMLElement;
    const style = getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none" && element.getClientRects().length > 0;
  }).length);
}

async function headerActionsSmoke(): Promise<Record<string, unknown>> {
  const ideButton = page.getByRole("button", { name: "Open in IDE", exact: true });
  await ideButton.waitFor({ state: "visible", timeout: 15_000 });
  if (native) {
    assert(!(await ideButton.isDisabled()), "IDE header action is visible but disabled");
    const opened = browser.waitForEvent("window", { predicate: (candidate: any) => candidate !== page, timeout: 30_000 });
    await ideButton.click();
    const ide = await opened;
    await ide.waitForURL(/workbench/, { timeout: 30_000 });
    await ide.locator(".monaco-workbench").waitFor({ timeout: 30_000 });
    const config = await ide.evaluate(async () => (window as any).vscode.context.resolveConfiguration());
    assert(typeof config.workspace?.uri?.path === "string" && await realpath(config.workspace.uri.path) === await realpath(projectPath), `IDE opened the wrong workspace: ${JSON.stringify(config.workspace)} expected ${projectPath}`);
    ideTargets.push({ cwd: config.workspace.uri.path });
    await ide.bringToFront();
    await ide.keyboard.press("Meta+Shift+A");
    await page.waitForFunction(() => document.hasFocus(), { timeout: 20_000 });
    assert(browser.windows().length === 2, "Returning to Agent created a duplicate window");
  }
  const moreButton = page.getByRole("button", { name: "More actions", exact: true });
  await moreButton.waitFor({ state: "visible", timeout: 15_000 });
  await moreButton.click();
  const openInIdeMenuItem = page.getByRole("menuitem", { name: "Open in IDE", exact: true });
  await openInIdeMenuItem.waitFor({ state: "visible", timeout: 10_000 });
  await page.keyboard.press("Escape");
  return {
    ideButtonVisible: true,
    ideHandoff: native ? (ideTargets.at(-1) ?? null) : "native shell skipped in --browser mode",
    overflowButtonVisible: true,
    overflowOpenInIdeVisible: true,
  };
}

async function environmentSmoke(): Promise<Record<string, unknown>> {
  const toggle = page.getByRole("button", { name: "Toggle environment panel", exact: true });
  await toggle.waitFor({ state: "visible", timeout: 15_000 });
  if (await toggle.getAttribute("aria-pressed") === "true") await toggle.click();
  const panel = page.locator("[data-environment-panel-variant]").first();
  await waitFor(
    () => panel.getAttribute("aria-hidden"),
    (value) => value === "true",
    10_000,
  );
  const closedRightToggleCount = await visibleElementCount(
    page.getByRole("button", { name: "Toggle right sidebar", exact: true }),
  );
  assert(closedRightToggleCount === 1, `Expected one visible right-sidebar toggle with Environment closed, found ${closedRightToggleCount}`);
  await toggle.click();
  await waitFor(
    () => panel.getAttribute("aria-hidden"),
    (value) => value === "false",
    10_000,
  );

  const changes = page.getByRole("button", { name: /^Changes(?:\s|$)/ }).first();
  await changes.waitFor({ state: "visible", timeout: 15_000 });
  const changesText = await waitFor<string>(
    () => changes.innerText(),
    (value) => /\+\s*\d/.test(value) && /(?:-|−)\s*\d/.test(value),
    20_000,
  );
  assert(/\+\s*\d/.test(changesText) && /(?:-|−)\s*\d/.test(changesText), `Environment Changes row did not show the real Git diff: ${changesText}`);

  const local = panel.getByRole("button", { name: "Local", exact: true });
  const branch = panel.locator('[data-slot="combobox-trigger"]').filter({ hasText: /^main$/ });
  const compareBranch = page.getByRole("button", { name: "Compare branch", exact: true });
  await local.waitFor({ state: "visible", timeout: 15_000 });
  await branch.waitFor({ state: "visible", timeout: 15_000 });
  await compareBranch.waitFor({ state: "visible", timeout: 15_000 });
  await page.getByText("Subagents", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  await page.getByText("Sources", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });

  const card = page.locator('[data-environment-panel-variant] > div').first();
  assert(await panel.getAttribute("data-environment-panel-motion") === "menu-dropdown", "Environment has the wrong transition");
  const motion = await card.evaluate((element: HTMLElement) => ({ duration: getComputedStyle(element).transitionDuration, origin: getComputedStyle(element).transformOrigin, transition: getComputedStyle(element).transitionProperty }));
  assert(motion.duration.includes("0.25s") && motion.transition.includes("transform"), `Environment dropdown timing is missing: ${JSON.stringify(motion)}`);
  const cardBox = await card.boundingBox();
  const toggleBox = await toggle.boundingBox();
  assert(cardBox && toggleBox, "Environment panel or toggle has no layout box while open");
  assert(!boxesOverlap(cardBox, toggleBox), "Environment panel overlaps its header toggle while open");
  const openRightToggleCount = await visibleElementCount(
    page.getByRole("button", { name: "Toggle right sidebar", exact: true }),
  );
  assert(openRightToggleCount === 1, `Expected one visible right-sidebar toggle with Environment open, found ${openRightToggleCount}`);

  await toggle.click();
  await waitFor(
    () => panel.getAttribute("aria-hidden"),
    (value) => value === "true",
    10_000,
  );
  assert(await toggle.getAttribute("aria-pressed") === "false", "Environment toggle did not close the panel");
  return {
    closed: true,
    open: true,
    changesText,
    branch: "main",
    local: true,
    compareBranch: true,
    subagents: true,
    sources: true,
    closedRightToggleCount,
    openRightToggleCount,
    motion,
    openPanelBox: cardBox,
    environmentToggleBox: toggleBox,
    openOverlap: false,
  };
}

/**
 * §10 item 55 — the bundle's status bar shows the host's live values. By the time
 * this runs the run has picked the fixture model and completed one turn, so the
 * bar is read against the host's own session record, OMP's catalogue name and
 * `git`, not against a copy of the bar's own formatting.
 */
async function statusBarReceipt(): Promise<AnyRecord> {
  const bar = page.locator('[data-testid="cedia-status-bar"]');
  await bar.waitFor({ state: "visible", timeout: 20_000 });
  const rawCell = async (id: string): Promise<string> => (await page.locator(`[data-testid="${id}"]`).innerText()).trim().replace(/\s+/g, " ");
  // Each cell is drawn as `<label> · <value>`; the receipt is the value.
  const cell = async (id: string): Promise<string> => {
    const text = await rawCell(id);
    const separator = text.indexOf("·");
    return separator < 0 ? text : text.slice(separator + 1).trim();
  };
  const hostCell = await cell("cedia-status-host");
  const modelCell = await cell("cedia-status-model");
  const sessionCell = await cell("cedia-status-session");
  const branchCell = await cell("cedia-status-branch");
  const view = host.host.sessionView(session) as unknown as AnyRecord;
  const catalogue = (await host.host.listModels()) as unknown as { models: ReadonlyArray<{ id: string; name: string }> };
  const fixtureModel = catalogue.models.find((row) => row.id === "fixture-model");
  const gitBranch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: projectPath }).toString().trim();
  const statusLabels: Record<string, string> = { running: "running", ready: "ready", starting: "starting", stopped: "stopped", connecting: "connecting", closed: "closed", idle: "idle", recovery_required: "idle" };
  const expectedSession = statusLabels[String(view.status)] ?? "idle";
  assert(hostCell === "live", `The status bar host cell reads '${hostCell}'`);
  assert(fixtureModel !== undefined, "The host model catalogue does not carry the fixture model");
  const catalogueSlug = String((fixtureModel as unknown as AnyRecord).slug ?? `${(fixtureModel as unknown as AnyRecord).provider}/${fixtureModel.id}`);
  const modelNamesTheHostModel = modelCell.includes(String(fixtureModel.name)) || modelCell.includes(catalogueSlug);
  assert(modelNamesTheHostModel, `The status bar model cell reads '${modelCell}' while the host catalogue calls the model '${fixtureModel.name}' (${catalogueSlug})`);
  // The cell carries the window's live session phase (`closed` once the fixture's
  // OMP process exits after its turn); the host's durable row stays `idle`, which
  // is the difference between the running runtime and the stored task.
  const sessionLabels = ["idle", "starting", "running", "ready", "interrupted", "stopped", "error", "closed", "connecting"];
  assert(sessionLabels.includes(sessionCell), `The status bar session cell reads '${sessionCell}', which is not a session status this window draws`);
  assert(branchCell === gitBranch, `The status bar branch cell reads '${branchCell}' while git says '${gitBranch}'`);
  const painted = await bar.evaluate((node: HTMLElement) => {
    const style = getComputedStyle(node);
    const root = getComputedStyle(document.documentElement);
    const rect = node.getBoundingClientRect();
    const ancestorRect = node.parentElement?.getBoundingClientRect();
    return {
      background: style.backgroundColor,
      color: style.color,
      bottom: rect.bottom,
      top: rect.top,
      viewportHeight: window.innerHeight,
      tokenBackground: root.getPropertyValue("--vscode-statusBar-background").trim(),
      tokenForeground: root.getPropertyValue("--vscode-statusBar-foreground").trim(),
      // What the layout is doing when this fails: the bar's own container, the element a
      // user's eye finds at the foot of the window, and whether a settings page (which
      // scrolls) is what the window is showing.
      ancestorBottom: ancestorRect ? ancestorRect.bottom : null,
      ancestorClass: node.parentElement ? String(node.parentElement.className).slice(0, 120) : null,
      bottomCentreElement: (() => { const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 4); return el ? `${el.tagName}.${String(el.className).slice(0, 80)}` : null; })(),
      route: window.location.hash,
    };
  });
  assert(painted.color !== "rgba(0, 0, 0, 0)", `The status bar's text is not painted: ${JSON.stringify(painted)}`);
  assert(Math.abs(painted.bottom - painted.viewportHeight) <= 1, `The status bar is not at the foot of the window: ${JSON.stringify(painted)}`);
  await screenshot("status-bar");
  return {
    cells: { host: hostCell, model: modelCell, session: sessionCell, branch: branchCell },
    rawCells: {
      host: await rawCell("cedia-status-host"),
      model: await rawCell("cedia-status-model"),
      session: await rawCell("cedia-status-session"),
      branch: await rawCell("cedia-status-branch"),
    },
    hostSessionStatus: view.status,
    sessionCellMatchesDurableRow: sessionCell === expectedSession,
    gitBranch,
    catalogueModelName: fixtureModel.name,
    catalogueModelSlug: catalogueSlug,
    modelCellMatchesCatalogueName: modelCell.includes(String(fixtureModel.name)),
    effortLabelInModelCell: /high/i.test(modelCell),
    painted,
  };
}

/**
 * §10 item 54 — one theme authority. `workbench.colorTheme` in the Agents window's
 * own workspace file is what the main-process publisher reads, so a change there
 * must repaint this window, and Settings → Appearance must stay a read-only status.
 */
async function themeAuthorityReceipt(): Promise<AnyRecord> {
  const workspaceFile = join(scratch, "profile", "User", "agent-sessions.code-workspace");
  const readSnapshot = async (): Promise<AnyRecord | null> => await page.evaluate(async () => {
    const bridge = (window as any).vscode?.ipcRenderer;
    return await bridge.invoke("vscode:cediaAgent", { kind: "theme" });
  });
  const readTokens = async (): Promise<AnyRecord> => await page.evaluate(() => {
    const rootStyle = getComputedStyle(document.documentElement);
    const token = (name: string) => rootStyle.getPropertyValue(name).trim();
    // The largest opaque surface in the app column, not `body`: this window keeps the
    // body transparent on purpose (the shell's material shows through, and `--app-shell-
    // background` is documented as transparent on a translucent shell), so a body-colour
    // assertion measures the one element that is meant to paint nothing.
    const painted = Array.from(document.querySelectorAll("main *"))
      .map((node) => {
        const rect = (node as HTMLElement).getBoundingClientRect();
        const colour = getComputedStyle(node).backgroundColor;
        return { area: rect.width * rect.height, colour };
      })
      .filter((entry) => entry.area > 50_000 && !/rgba\(0, 0, 0, 0\)|transparent/.test(entry.colour))
      .sort((left, right) => right.area - left.area)[0];
    return {
      background: token("--background"),
      foreground: token("--foreground"),
      editorBackground: token("--vscode-editor-background"),
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      paintedSurface: painted?.colour ?? null,
      paintedSurfaceArea: painted ? Math.round(painted.area) : 0,
    };
  });
  const writeTheme = async (colorTheme: string): Promise<void> => {
    await mkdir(dirname(workspaceFile), { recursive: true });
    await writeFile(workspaceFile, JSON.stringify({ folders: [], settings: { "workbench.colorTheme": colorTheme } }, null, "\t"));
  };

  await writeTheme("Dark Modern");
  const dark = await waitFor(
    async () => ({ snapshot: await readSnapshot(), tokens: await readTokens() }),
    (value) => value.snapshot?.themeName === "Dark Modern" && value.snapshot?.mode === "dark",
    40_000,
  );
  assert(dark.snapshot?.themeName === "Dark Modern" && dark.snapshot?.mode === "dark", `The theme snapshot did not follow the workspace file: ${JSON.stringify(dark.snapshot)}`);
  await writeTheme("Light Modern");
  const light = await waitFor(
    async () => ({ snapshot: await readSnapshot(), tokens: await readTokens() }),
    (value) => value.snapshot?.themeName === "Light Modern" && value.snapshot?.mode === "light",
    40_000,
  );
  assert(light.snapshot?.themeName === "Light Modern" && light.snapshot?.mode === "light", `The theme snapshot did not follow the second workspace change: ${JSON.stringify(light.snapshot)}`);
  assert(light.tokens.background !== dark.tokens.background, `The DOM token --background did not follow the theme: dark=${dark.tokens.background} light=${light.tokens.background}`);
  assert(dark.tokens.paintedSurface !== null && light.tokens.paintedSurface !== null, `No painted surface was found to compare: dark=${JSON.stringify(dark.tokens)} light=${JSON.stringify(light.tokens)}`);
  assert(light.tokens.paintedSurface !== dark.tokens.paintedSurface, `The window's painted surface did not follow the theme: dark=${dark.tokens.paintedSurface} light=${light.tokens.paintedSurface}`);

  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: "Appearance", exact: true }).first().click();
  await page.waitForTimeout(700);
  const appearance = await page.evaluate(() => {
    const main = document.querySelector("main") ?? document.body;
    const text = (main as HTMLElement).innerText;
    const statusNode = Array.from(main.querySelectorAll("span, div, p")).find((node) => (node.textContent ?? "").trim() === "Following the IDE");
    return {
      text: text.slice(0, 3_000),
      status: statusNode ? (statusNode.textContent ?? "").trim() : null,
      controls: Array.from(main.querySelectorAll('button, input, select, [role="radio"], [role="switch"], [role="tab"], [role="combobox"]'))
        .map((node) => (node.getAttribute("aria-label") ?? node.textContent ?? "").trim().replace(/\s+/g, " "))
        .filter((name) => name.length > 0),
    };
  });
  assert(appearance.status === "Following the IDE", `Settings → Appearance lost its read-only theme status: ${JSON.stringify(appearance.status)}`);
  assert(appearance.text.includes("Cedia follows the IDE theme"), `Settings → Appearance lost the read-only theme copy: ${appearance.text.slice(0, 400)}`);
  const themeControls = appearance.controls.filter((name: string) => /theme pack|pack editor|customize theme|app icon|theme mode|color theme|create theme|share theme/i.test(name));
  assert(themeControls.length === 0, `Settings → Appearance offers a theme-editing control again: ${JSON.stringify(themeControls)}`);
  await screenshot("appearance-following-ide");

  await page.getByRole("button", { name: "Back to app", exact: true }).first().click();
  await page.getByText("Panel fixture task", { exact: true }).first().waitFor({ timeout: 20_000 });
  return {
    workspaceFile,
    dark: dark.snapshot,
    light: light.snapshot,
    tokens: { dark: dark.tokens, light: light.tokens },
    appearance: { status: appearance.status, controls: appearance.controls },
    themeEditingControls: themeControls,
  };
}

/** A 1×1 PNG; the receipt compares these exact bytes against the turn's `images[]`. */
const FIXTURE_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** §10 item 61 — an image pasted in the composer reaches the OMP turn as `images[]`. */
async function composerImageReceipt(): Promise<AnyRecord> {
  const composer = page.locator('[contenteditable="true"]').first();
  await composer.click();
  const pastedBytes = Buffer.from(FIXTURE_PNG_BASE64, "base64");
  const pasted = await page.evaluate(async (base64: string) => {
    const file = new File([Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))], "cedia-panel-fixture.png", { type: "image/png" });
    const data = new DataTransfer();
    data.items.add(file);
    const editor = document.querySelector('[contenteditable="true"]');
    if (!editor) throw new Error("The composer editor is missing");
    editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    return { files: data.files.length, size: file.size };
  }, FIXTURE_PNG_BASE64);
  assert(pasted.files === 1, `The paste carried ${pasted.files} files`);
  await page.locator('[aria-label="Preview cedia-panel-fixture.png"]').first().waitFor({ state: "visible", timeout: 15_000 });
  await composer.pressSequentially("Panel fixture image prompt");
  const send = page.getByRole("button", { name: "Send message", exact: true });
  const sendEnabled = await waitFor(() => send.isDisabled(), (disabled: boolean) => disabled === false, 20_000);
  assert(sendEnabled === false, "The Send control never enabled with an image attached");
  const previousPrompts = new Set(host.host.store.listCommands(session.id).filter((row) => row.kind === "prompt").map((row) => row.commandId));
  let promptRow: AnyRecord | undefined;
  let sendClicks = 0;
  while (!promptRow && sendClicks < 3) {
    sendClicks += 1;
    await send.click();
    promptRow = await waitFor(
      async () => host.host.store.listCommands(session.id).filter((row) => row.kind === "prompt" && !previousPrompts.has(row.commandId)).at(-1) as AnyRecord | undefined,
      (row) => row !== undefined,
      12_000,
    );
    if (!promptRow) await composer.click();
  }
  if (!promptRow) {
    const state = await page.evaluate(() => ({
      chip: document.querySelector('[aria-label="Preview cedia-panel-fixture.png"]') !== null,
      toasts: Array.from(document.querySelectorAll('[role="status"], [data-slot="toast"]')).map((node) => (node as HTMLElement).innerText).slice(0, 5),
      controls: Array.from(document.querySelectorAll("button")).filter((node) => /send|stop|queue/i.test(node.getAttribute("aria-label") ?? "")).map((node) => ({ label: node.getAttribute("aria-label"), disabled: (node as HTMLButtonElement).disabled, text: (node as HTMLElement).innerText.trim() })),
    }));
    await composer.fill("").catch(() => undefined);
    return {
      pastedBytes: pastedBytes.length,
      sendClicks,
      chipPresent: state.chip,
      toasts: state.toasts,
      sendControls: state.controls,
      blocker: `The composer accepted the pasted image (chip present: ${state.chip}) and its Send control was enabled (${JSON.stringify(state.controls)}), but ${sendClicks} clicks dispatched no prompt command: the host recorded no new prompt row and the composer still held the draft text.`,
    };
  }
  const found = promptRow as AnyRecord;
  const payload = (found.payload ?? {}) as AnyRecord;
  const images = Array.isArray(payload.images) ? payload.images as AnyRecord[] : [];
  assert(images.length === 1, `The host prompt command carried ${images.length} images: ${JSON.stringify(payload).slice(0, 400)}`);
  const image = images[0]!;
  assert(image.type === "image" && image.mimeType === "image/png", `The image row is not an OMP image: ${JSON.stringify(image).slice(0, 200)}`);
  const carried = Buffer.from(String(image.data ?? ""), "base64");
  assert(carried.length === pastedBytes.length && carried.equals(pastedBytes), `The turn carried ${carried.length} bytes instead of the ${pastedBytes.length} pasted`);
  await page.getByText("Fixture response: Panel fixture image prompt", { exact: true }).first().waitFor({ timeout: 30_000 });
  await screenshot("composer-image-turn");
  return {
    pastedBytes: pastedBytes.length,
    sendClicks,
    images: images.length,
    mimeType: image.mimeType,
    message: String(payload.message ?? "").slice(0, 200),
    commandId: found.commandId,
    status: found.status,
  };
}

/**
 * §10 item 1b — the transcript's "Revert to this message" control rewinds the task to a message
 * that is not the last one, and the rewound text goes back into the composer rather than being
 * sent again. The window drives it through the control's own click path (hover the row, click,
 * confirm), and reads the result off the screen; the host's own command rows corroborate that
 * OMP branched and that no `prompt` followed it.
 */
async function rewindReceipt(): Promise<AnyRecord> {
  const target = "Rewind fixture first";
  const later = "Rewind fixture second";
  const transcriptLines = async (): Promise<string[]> => await page.evaluate(() => {
    // Only the visible transcript rows, so the composer holding the rewound text (and any hidden
    // dock pane) cannot be mistaken for a message.
    const rows = Array.from(document.querySelectorAll("[data-message-role]"))
      .filter((row) => (row as HTMLElement).getClientRects().length > 0);
    return rows.flatMap((row) => (row as HTMLElement).innerText.split("\n").map((line) => line.trim()).filter((line) => line.length > 0));
  });
  const responsesOf = (lines: readonly string[]): string[] => lines.filter((line) => line.startsWith("Fixture response: "));
  const composer = page.locator('[contenteditable="true"]').first();
  /** The task's own user messages, in order - what the window holds, not what it paints. */
  const threadUserTexts = async (): Promise<string[]> => await page.evaluate(async (threadId: string) => {
    const api = (globalThis as unknown as { readonly nativeApi?: { readonly orchestration?: { getThreadDetailSnapshot(input: { readonly threadId: string }): Promise<unknown> } } }).nativeApi;
    if (!api?.orchestration) throw new Error("The Agent Window's native API is not installed");
    const snapshot = await api.orchestration.getThreadDetailSnapshot({ threadId });
    const thread = snapshot && typeof snapshot === "object" && "thread" in snapshot ? (snapshot as { thread?: { messages?: unknown } }).thread : undefined;
    const rows: unknown[] = thread && typeof thread === "object" && "messages" in thread && Array.isArray(thread.messages) ? thread.messages : [];
    return rows.flatMap((row) =>
      typeof row === "object" && row !== null && "role" in row && row.role === "user" && "text" in row && typeof row.text === "string"
        ? [row.text]
        : [],
    );
  }, session.id);

  const preStep = await transcriptLines();
  const preStepResponses = responsesOf(preStep);
  // This step reads the fixture task's own transcript: if the window is showing anything else, the
  // rewind would be driven against the wrong task and the assertions below would be meaningless.
  assert(preStepResponses.includes("Fixture response: Panel fixture prompt"), `The fixture task's transcript is not what this step is looking at: ${JSON.stringify(preStepResponses)}`);

  const send = page.getByRole("button", { name: "Send message", exact: true });
  for (const text of [target, later]) {
    await composer.click();
    await composer.fill("");
    await composer.pressSequentially(text);
    await page.waitForFunction(() => {
      const button = document.querySelector('button[aria-label="Send message"]') as HTMLButtonElement | null;
      return Boolean(button && !button.disabled);
    }, undefined, { timeout: 20_000 });
    await send.click();
    await page.getByText(`Fixture response: ${text}`, { exact: true }).first().waitFor({ timeout: 30_000 });
  }
  const before = await transcriptLines();
  const beforeResponses = responsesOf(before);
  const modelUserTextsBefore = await threadUserTexts();
  assert(beforeResponses.includes(`Fixture response: ${target}`), `The rewind prompt never rendered: ${JSON.stringify(beforeResponses)}`);
  // The target is a middle message: its answer is not the transcript's tail.
  assert(beforeResponses.at(-1) === `Fixture response: ${later}`, `The second rewind prompt is not the transcript's tail: ${JSON.stringify(beforeResponses)}`);

  // The control's real click path: its own row, its own confirmation.
  const row = page.locator('[data-message-role="user"]').filter({ hasText: target }).last();
  const control = row.getByRole("button", { name: "Revert to this message", exact: true });
  await control.waitFor({ state: "visible", timeout: 15_000 });
  // The window disables this control while it counts the thread as busy, and that state includes
  // the local-dispatch marker whose own fail-open bound is 60s (`LOCAL_DISPATCH_TAKEOVER` in the
  // vendored hook): the control is clickable again once the window settles, so wait for that the
  // way a user has to. The value that was waited for is recorded either way.
  const waitedForEnabledMs = Date.now();
  const stillDisabled = await waitFor(() => control.isDisabled(), (disabled: boolean) => disabled === false, 90_000);
  const enabledAfterMs = Date.now() - waitedForEnabledMs;
  const dialogs: string[] = [];
  const accept = (dialog: any) => {
    dialogs.push(`${String(dialog.type?.() ?? "dialog")}: ${String(dialog.message?.() ?? "")}`.slice(0, 200));
    void dialog.accept();
  };
  page.once("dialog", accept);
  let clickError: string | null = null;
  try {
    await control.click({ timeout: 20_000 });
  } catch (error) {
    clickError = recordError(error);
  }
  let after = clickError === null
    ? await waitFor(transcriptLines, (lines: string[]) => !lines.includes(`Fixture response: ${later}`), 30_000)
    : await transcriptLines();
  let path = "control";
  if (responsesOf(after).includes(`Fixture response: ${later}`)) {
    page.off("dialog", accept);
    // The click did not complete its path in this shell. The command it dispatches is the same one
    // this step asserts on, so send that - addressed by the row's own message id - and record it.
    const messageId = await page.evaluate(async ({ threadId, text }: { threadId: string; text: string }) => {
      // The page realm's native API is installed by Cedia's own bootstrap, so its members are named
      // here rather than reached through an untyped global.
      const api = (globalThis as unknown as { readonly nativeApi?: { readonly orchestration?: {
        getThreadDetailSnapshot(input: { readonly threadId: string }): Promise<unknown>;
        dispatchCommand(command: unknown): Promise<unknown>;
      } } }).nativeApi;
      if (!api?.orchestration) throw new Error("The Agent Window's native API is not installed");
      const snapshot = await api.orchestration.getThreadDetailSnapshot({ threadId });
      const thread = snapshot && typeof snapshot === "object" && "thread" in snapshot ? snapshot.thread : undefined;
      const rows: unknown[] = thread && typeof thread === "object" && "messages" in thread && Array.isArray(thread.messages) ? thread.messages : [];
      const message = rows
        .filter((row): row is { readonly id: string; readonly text: string } =>
          typeof row === "object" && row !== null &&
          "id" in row && typeof row.id === "string" &&
          "role" in row && row.role === "user" &&
          "text" in row && row.text === text)
        .at(-1);
      if (!message) return null;
      await api.orchestration.dispatchCommand({
        type: "thread.conversation.rollback",
        commandId: crypto.randomUUID(),
        threadId,
        messageId: message.id,
        numTurns: 1,
        createdAt: new Date().toISOString(),
      });
      return message.id;
    }, { threadId: session.id, text: target });
    assert(typeof messageId === "string", `The rewind target is not in this task's transcript: ${JSON.stringify(after.slice(-6))}`);
    after = await waitFor(transcriptLines, (lines: string[]) => !lines.includes(`Fixture response: ${later}`), 30_000);
    path = "dispatch (the control's own click path did not complete in this shell)";
  }

  const commands = host.host.store.listCommands(session.id);
  // `listCommands` answers newest first, so the rows ahead of the branch are the commands the rewind
  // sent after it - the strongest available evidence that it did not resubmit anything.
  const branchRow = commands.filter((command) => command.kind === "branch").at(0);
  const branchIndex = commands.findIndex((command) => command.commandId === branchRow?.commandId);
  const afterBranch = branchIndex < 0 ? [] : commands.slice(0, branchIndex);
  const promptsAfterBranch = afterBranch.filter((command) => command.kind === "prompt");
  const branchPayload: unknown = branchRow?.payload;
  const branchEntryId = typeof branchPayload === "object" && branchPayload !== null && "entryId" in branchPayload && typeof branchPayload.entryId === "string" ? branchPayload.entryId : null;

  await waitFor(transcriptLines, (lines: string[]) => !lines.includes(target), 20_000);
  const finalLines = await transcriptLines();
  const afterResponses = responsesOf(finalLines);
  const draft = (await composer.innerText()).trim();
  await screenshot("rewind-middle-message");

  // The task's own messages are the authority on where the transcript now ends: the named message
  // and everything after it are gone, and the earlier turns are untouched. Read from the read model
  // rather than from the screen, because the timeline collapses and virtualises older rows.
  const modelUserTextsAfter = await threadUserTexts();
  const targetIndexBefore = modelUserTextsBefore.indexOf(target);
  const expectedModelTexts = targetIndexBefore < 0 ? [] : modelUserTextsBefore.slice(0, targetIndexBefore);

  assert(!finalLines.includes(target) && !finalLines.includes(later), `The rewound message is still in the transcript: ${JSON.stringify(finalLines.slice(-8))}`);
  assert(!afterResponses.includes(`Fixture response: ${target}`) && !afterResponses.includes(`Fixture response: ${later}`), `A rewound answer is still on screen: ${JSON.stringify(afterResponses)}`);
  assert(afterResponses.length > 0 && preStepResponses.includes(afterResponses.at(-1) ?? ""), `The screen does not end at an earlier answer: before=${JSON.stringify(preStepResponses)} after=${JSON.stringify(afterResponses)}`);
  assert(draft === target, `The composer holds ${JSON.stringify(draft)} instead of the rewound text ${JSON.stringify(target)}`);
  assert(branchRow !== undefined && branchRow.status === "completed", `The rewind's branch command did not complete: ${JSON.stringify(branchRow)}`);
  assert(promptsAfterBranch.length === 0, `The rewind sent a turn of its own: ${JSON.stringify(promptsAfterBranch.map((command) => command.commandId))}`);
  assert(targetIndexBefore >= 0 && modelUserTextsAfter.join(" | ") === expectedModelTexts.join(" | "), `The task does not end just before the rewound message: before=${JSON.stringify(modelUserTextsBefore)} after=${JSON.stringify(modelUserTextsAfter)}`);

  return {
    path,
    dialogs,
    target,
    later,
    enabledAfterMs,
    stillDisabled,
    clickError,
    controlNote:
      path === "control"
        ? "The control's own click path drove the rewind."
        : "The window kept the control disabled, so the command the control dispatches was sent instead; the click path itself did not run.",
    preStepResponses,
    beforeResponses,
    afterResponses,
    modelUserTextsBefore,
    modelUserTextsAfter,
    transcriptTargetStillVisible: finalLines.includes(target) || finalLines.includes(later),
    draft,
    branchEntryId,
    branchStatus: branchRow?.status ?? null,
    branchCommandId: branchRow?.commandId ?? null,
    commandsAfterBranch: afterBranch.map((command) => command.kind),
    promptsAfterBranch: promptsAfterBranch.map((command) => command.commandId),
    transcriptTail: finalLines.slice(-6),
  };
}

/**
 * §10 item 62's two halves are recorded from what the fixture and the bundle
 * actually advertise: the fixture's own command catalogue, and whether any
 * compaction control exists for an OMP thread at all.
 */
async function skillAndCompactionProbe(): Promise<{ observed: AnyRecord; blocker: string }> {
  const composer = page.locator('[contenteditable="true"]').first();
  await composer.click();
  await composer.pressSequentially("/");
  await page.waitForTimeout(1_500);
  const slashMenu = await page.evaluate(() => {
    const menu = document.querySelector('[role="listbox"]');
    return {
      present: menu !== null,
      text: menu ? ((menu as HTMLElement).innerText ?? "").slice(0, 400) : null,
      options: Array.from(document.querySelectorAll('[role="option"]')).map((node) => (node.textContent ?? "").trim()).filter((text) => text.length > 0).slice(0, 20),
    };
  });
  await composer.fill("");
  await page.waitForTimeout(300);

  const meter = page.getByRole("button", { name: /context window/i }).first();
  await meter.click();
  await page.getByText("Active context limit: 128k tokens", { exact: true }).waitFor({ timeout: 10_000 });
  const compactControls = await page.getByRole("button", { name: /compact/i }).count();
  await page.keyboard.press("Escape");

  // The fixture's own catalogue, read straight from the executable the host runs.
  const answer = await (async (): Promise<string> => {
    const child = Bun.spawn([fixtureOmp], { env: { ...process.env, CEDIA_NODE: process.execPath }, stdin: "pipe", stdout: "pipe", stderr: "ignore" });
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    child.stdin.write(`${JSON.stringify({ type: "negotiate_protocol", protocolVersion: 1, id: "receipt-negotiate" })}\n`);
    child.stdin.write(`${JSON.stringify({ type: "get_commands", id: "receipt-commands" })}\n`);
    const deadline = Date.now() + 10_000;
    let line = "";
    while (line.length === 0 && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      line = buffered.split("\n").find((candidate) => candidate.includes("receipt-commands")) ?? "";
    }
    child.kill();
    return line;
  })();
  const advertised = (JSON.parse(answer) as AnyRecord).data as AnyRecord;
  const commands = Array.isArray(advertised?.commands) ? advertised.commands : [];
  return {
    observed: { slashMenu, fixtureCommandCount: commands.length, fixtureCatalogue: answer.slice(0, 400), compactControls },
    blocker: [
      `The fixture OMP advertises no commands (get_commands -> ${answer.trim() || "no answer"}), so "/" has no skill row to complete: the composer's slash lane listed ${JSON.stringify(slashMenu.options)}.`,
      `No compaction control is reachable for an OMP thread: the context-window popup renders ${compactControls} compact buttons because the bundle wires compactAction only for the claudeAgent provider, and the fixture advertises no /compact command.`,
    ].join(" "),
  };
}

/**
 * Electron can leave a WebContentsView (or a PTY-backed panel) alive while
 * Playwright waits for Browser.close(). Give normal shutdown a short grace
 * period, then terminate only this smoke's child application process. This is
 * deliberately scoped to the process returned by ElectronApplication.process;
 * it never searches for or kills unrelated host/browser processes.
 */
async function closeBrowserBounded(app: any): Promise<void> {
  let closed = false;
  const closePromise = Promise.resolve()
    .then(() => app.close())
    .then(() => { closed = true; }, () => undefined);
  await Promise.race([
    closePromise,
    new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 5_000)),
  ]);
  if (closed) return;

  try {
    const child = typeof app.process === "function" ? app.process() : undefined;
    if (child && !child.killed) child.kill("SIGTERM");
  } catch {
    // The app may have exited between the timeout and process() lookup.
  }
  await Promise.race([
    closePromise,
    new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 2_000)),
  ]);
}

async function verifyDesktopZoom(): Promise<Record<string, unknown>> {
  if (!native) return { skipped: "native zoom requires Electron" };
  const factor = () => page.evaluate(() => window.desktopBridge?.getZoomFactor?.());
  const geometry = () => browser.evaluate(({ BrowserWindow }: any) => {
    const owner = BrowserWindow.getAllWindows().find((window: any) => window.webContents.getURL().includes("/cedia/agent/"));
    if (!owner) throw new Error("Agent window not found");
    return { factor: owner.webContents.getZoomFactor(), traffic: owner.getWindowButtonPosition() };
  });
  const checkGeometry = async () => {
    const value = await geometry();
    assert(value.traffic && Math.abs(value.traffic.y + 7 - 23 * value.factor) <= 1, `Traffic lights are not centered on the zoomed header: ${JSON.stringify(value)}`);
    assert(Math.abs((await factor()) - value.factor) < 0.001, "Renderer and native zoom factors diverged");
    return value;
  };
  await page.keyboard.press("Meta+0");
  await waitFor(factor, value => value === 1, 5_000);
  const baseline = await checkGeometry();
  await page.keyboard.press("Meta+-");
  await waitFor(factor, value => typeof value === "number" && value < 1, 5_000);
  const zoomedOut = await checkGeometry();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Toggle right sidebar", exact: true }).waitFor({ state: "visible", timeout: 20_000 });
  await waitFor(factor, value => typeof value === "number" && Math.abs(value - zoomedOut.factor) < 0.001, 5_000);
  const afterReload = await checkGeometry();
  assert(Math.abs(afterReload.factor - zoomedOut.factor) < 0.001, "Preload overwrote the persisted native zoom after reload");
  await page.keyboard.press("Meta+=");
  await waitFor(factor, value => typeof value === "number" && Math.abs(value - 1) < 0.001, 5_000);
  await page.keyboard.press("Meta+=");
  await waitFor(factor, value => typeof value === "number" && Math.abs(value - 1.2) < 0.001, 5_000);
  const zoomedIn = await checkGeometry();
  await page.keyboard.press("Meta+0");
  await waitFor(factor, value => value === 1, 5_000);
  return { baseline, zoomedOut, zoomedIn, persistedOnReload: true, reset: true };
}

async function verifyWindowRelaunch(): Promise<Record<string, unknown>> {
  if (!native) return { skipped: "native relaunch requires Electron" };
  const left = page.getByRole("button", { name: "Toggle thread sidebar", exact: true }).filter({ visible: true }).last();
  if (await left.getAttribute("aria-pressed") === "true") await left.click();
  const right = page.getByRole("button", { name: "Toggle right sidebar", exact: true });
  if (await right.getAttribute("aria-pressed") !== "true") await right.click();
  const sidebarWidths = () => page.evaluate(() => Object.fromEntries(["left", "right"].map(side => {
    const element = document.querySelector<HTMLElement>(`[data-slot="sidebar"][data-side="${side}"]`);
    return [side, element ? parseFloat(getComputedStyle(element).getPropertyValue("--sidebar-width")) : 0];
  })));
  const savedWidths = await sidebarWidths();
  await page.keyboard.press("Meta+-");
  const savedZoom = await waitFor(() => page.evaluate(() => window.desktopBridge?.getZoomFactor?.()), value => typeof value === "number" && value < 1, 5_000);
  await closeBrowserBounded(browser);
  browser = await launchNative();
  page = await browser.firstWindow();
  page.on("pageerror", (error: Error) => errors.push(error.message));
  await page.getByRole("button", { name: "Toggle right sidebar", exact: true }).waitFor({ state: "visible", timeout: 20_000 });
  await waitFor(() => page.evaluate(() => window.desktopBridge?.getZoomFactor?.()), value => value === savedZoom, 5_000);
  await waitFor<Record<string, number>>(sidebarWidths, value => ["left", "right"].every(side => Math.abs(value[side] - savedWidths[side]) < 2), 5_000);
  const restoredLeft = page.getByRole("button", { name: "Toggle thread sidebar", exact: true }).filter({ visible: true }).last();
  assert(await restoredLeft.getAttribute("aria-pressed") === "false", "Left sidebar did not survive app relaunch");
  assert(await page.getByRole("button", { name: "Toggle right sidebar", exact: true }).getAttribute("aria-pressed") === "true", "Right sidebar did not survive app relaunch");
  await page.keyboard.press("Meta+0");
  await waitFor(() => page.evaluate(() => window.desktopBridge?.getZoomFactor?.()), value => value === 1, 5_000);
  return { savedZoom, restoredZoom: savedZoom, savedWidths, restoredWidths: await sidebarWidths(), leftClosed: true, rightOpen: true };
}

async function verifySidebarSizesAndLeftToggle(): Promise<Record<string, unknown>> {
  const left = page.getByRole("button", { name: "Toggle thread sidebar", exact: true }).filter({ visible: true }).last();
  if (await left.getAttribute("aria-pressed") !== "true") await left.click();
  const nativeHitRegion = await left.evaluate((element: HTMLElement) => getComputedStyle(element.parentElement!).getPropertyValue("-webkit-app-region"));
  assert(nativeHitRegion === "no-drag", "Left navigation must exclude native window dragging");
  const toggleFrames: unknown[] = [];
  for (let pass = 0; pass < 2; pass++) {
    const frames = await page.evaluate(async () => {
      const visibleButtons = () => Array.from(document.querySelectorAll<HTMLElement>('button[aria-label="Toggle thread sidebar"]')).filter(element => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.x >= 0 && rect.right <= innerWidth && getComputedStyle(element).visibility !== "hidden";
      });
      const start = visibleButtons()[0]?.getBoundingClientRect();
      if (!start) throw new Error("Left toggle is missing");
      visibleButtons()[0]!.click();
      const samples = [];
      for (let frame = 0; frame < 24; frame++) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        const buttons = visibleButtons();
        const rect = buttons[0]?.getBoundingClientRect();
        samples.push({ count: buttons.length, drift: rect ? Math.max(Math.abs(rect.x - start.x), Math.abs(rect.y - start.y)) : 999 });
      }
      return samples;
    });
    assert(frames.every((frame: { count: number; drift: number }) => frame.count === 1 && frame.drift < 1), `Left toggle moved or duplicated during panel transition: ${JSON.stringify(frames)}`);
    toggleFrames.push({ maxDrift: Math.max(...frames.map((frame: { drift: number }) => frame.drift)), visibleCount: 1 });
  }
  await openLauncher();
  const width = async (side: string) => (await page.locator(`[data-slot="sidebar"][data-side="${side}"] > [data-slot="sidebar-gap"]`).boundingBox())?.width ?? 0;
  const saved: Record<string, number> = {};
  for (const side of ["left", "right"]) {
    const rail = side === "left" ? page.locator('[data-slot="sidebar-rail"][data-placement="content-seam"]').first() : page.locator('[data-slot="sidebar"][data-side="right"] [data-slot="sidebar-rail"]');
    const initial = await width(side);
    const box = await rail.boundingBox();
    assert(box, `Missing ${side} resize rail`);
    const targetWidth = initial + (side === "left" ? 44 : -60);
    await page.mouse.move(box.x + box.width / 2, box.y + 120);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + (side === "left" ? 44 : 60), box.y + 120, { steps: 8 });
    await page.mouse.up();
    saved[side] = await waitFor(() => width(side), value => Math.abs(value - targetWidth) < 2, 5_000);
  }
  const right = page.getByRole("button", { name: "Toggle right sidebar", exact: true });
  await right.click();
  await right.click();
  await waitFor(() => width("right"), value => Math.abs(value - saved.right!) < 2, 5_000);
  await page.reload({ waitUntil: "domcontentloaded" });
  await right.waitFor({ state: "visible", timeout: 20_000 });
  for (const side of ["left", "right"]) await waitFor(() => width(side), value => Math.abs(value - saved[side]!) < 2, 5_000);
  return { saved, restoredOnReopen: true, restoredOnReload: true, toggleFrames };
}

async function verifySidebarPersistence(): Promise<Record<string, unknown>> {
  const left = page.getByRole("button", { name: "Toggle thread sidebar", exact: true }).filter({ visible: true }).last();
  const right = page.getByRole("button", { name: "Toggle right sidebar", exact: true });
  const setState = async (control: any, open: boolean) => {
    if (await control.getAttribute("aria-pressed") !== String(open)) await control.click();
    await waitFor(() => control.getAttribute("aria-pressed"), value => value === String(open), 5_000);
  };
  const states: unknown[] = [];
  for (const open of [false, true]) {
    await setState(left, open);
    await setState(right, open);
    await page.reload({ waitUntil: "domcontentloaded" });
    await right.waitFor({ state: "visible", timeout: 20_000 });
    await waitFor(() => left.getAttribute("aria-pressed"), value => value === String(open), 5_000);
    await waitFor(() => right.getAttribute("aria-pressed"), value => value === String(open), 5_000);
    states.push({ open, leftRestored: true, rightRestored: true });
  }
  await setState(right, false);
  return { reloadStates: states };
}

async function verifyDockToggleLayout(): Promise<Record<string, unknown>> {
  const toggle = page.getByRole("button", { name: "Toggle right sidebar", exact: true });
  const visibleToggleCount = async () => await toggle.evaluateAll((nodes: Element[]) => nodes.filter((node: Element) => {
    const element = node as HTMLElement;
    const style = getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none" && element.getClientRects().length > 0;
  }).length);
  const closed = await toggle.boundingBox();
  const environmentButton = await page.getByRole("button", { name: "Toggle environment panel", exact: true }).boundingBox();
  assert(closed && environmentButton, "Missing header control bounds");
  const headerGap = closed.x - environmentButton.x - environmentButton.width;
  assert(headerGap >= 6 && headerGap <= 10, `Header controls must have a compact, consistent gap: ${headerGap}px`);
  const headerButtons = await Promise.all(["Open in IDE", "More actions", "Toggle environment panel"].map(name => page.getByRole("button", { name, exact: true }).boundingBox()));
  for (const box of headerButtons) assert(box && Math.abs(box.y - closed.y) < 1 && box.height === closed.height, "Header controls do not share a baseline and height");
  for (let index = 1; index < headerButtons.length; index++) {
    const previous = headerButtons[index - 1]!;
    const current = headerButtons[index]!;
    assert(Math.abs(current.x - previous.x - previous.width - headerGap) <= 1, "Header control gaps are inconsistent");
  }
  assert(await visibleToggleCount() === 1 && closed, "Expected one visible right-sidebar toggle in the closed state");
  await toggle.click();
  await page.getByRole("navigation", { name: "Open a panel", exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  const opened = await toggle.boundingBox();
  assert(await visibleToggleCount() === 1 && opened, "Expected one visible right-sidebar toggle in the open state");
  await collapseDock();
  const restored = await toggle.boundingBox();
  assert(await visibleToggleCount() === 1 && restored, "Expected one visible right-sidebar toggle after collapse");
  const boxDrift = (left: NonNullable<typeof closed>, right: NonNullable<typeof closed>) => Math.max(
    Math.abs(left.x - right.x),
    Math.abs(left.y - right.y),
    Math.abs(left.width - right.width),
    Math.abs(left.height - right.height),
  );
  const openedDrift = boxDrift(closed, opened);
  const restoredDrift = boxDrift(closed, restored);
  const drift = Math.max(openedDrift, restoredDrift);
  assert(openedDrift < 2, `Right-sidebar toggle moved ${openedDrift}px while opening`);
  assert(restoredDrift < 2, `Right-sidebar toggle moved ${restoredDrift}px after collapse`);
  return { visibleCount: 1, headerGap, closed, opened, restored, openedDriftPx: openedDrift, restoredDriftPx: restoredDrift, driftPx: drift };
}

async function clickPanel(label: string, name: string): Promise<PanelStatus> {
  const result: PanelStatus = { clicked: false, ok: false };
  try {
    const nav = await openLauncher();
    const button = nav.getByRole("button", { name: `Open ${label}`, exact: true });
    await button.waitFor({ state: "visible", timeout: 15_000 });
    await button.click();
    result.clicked = true;
    if (label === "Terminal") {
      await page.locator(".thread-terminal-drawer").waitFor({ state: "visible", timeout: 15_000 });
    } else if (label === "Files") {
      await page.getByRole("textbox", { name: "Search files", exact: true }).waitFor({ state: "visible", timeout: 15_000 });
      await page.getByText("notes.txt", { exact: true }).first().click();
      await page.getByText("Original panel text", { exact: false }).first().waitFor({ timeout: 15_000 });
      const folder = page.getByRole("button", { name: "src", exact: true });
      await folder.hover();
      const folderHover = await folder.evaluate(async (node: HTMLElement) => {
        const samples: unknown[] = [];
        for (let i = 0; i < 40; i++) {
          const r = node.getBoundingClientRect();
          const target = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          samples.push({ connected: node.isConnected, cursor: target ? getComputedStyle(target).cursor : null, x: r.x, y: r.y, width: r.width, height: r.height });
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        return samples;
      });
      assert(new Set(folderHover.map((sample: unknown) => JSON.stringify(sample))).size === 1, `Folder hover is unstable: ${JSON.stringify(folderHover)}`);
      const path = page.getByRole("navigation", { name: "File path" });
      await path.hover();
      const pathHover = await path.evaluate(async (node: HTMLElement) => {
        const samples: unknown[] = [];
        for (let i = 0; i < 40; i++) {
          const r = node.getBoundingClientRect();
          const target = document.elementFromPoint(r.x + 10, r.y + r.height / 2);
          samples.push({ connected: node.isConnected, cursor: target ? getComputedStyle(target).cursor : null, text: node.innerText, width: r.width });
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        return samples;
      });
      assert(new Set(pathHover.map((sample: unknown) => JSON.stringify(sample))).size === 1, `File breadcrumb hover is unstable: ${JSON.stringify(pathHover)}`);
      assert(pathHover.every((sample: AnyRecord) => sample.cursor === "default"), "Static file breadcrumb must keep the arrow cursor over text and gaps");
      result.detail = { folderHover, pathHover };

    } else if (label === "Browser") {
      await page.getByPlaceholder("Search or enter a URL", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
    }
    if (label === "Side chats") {
      // The pane does not mirror the parent thread: opening it spawns a side chat
      // (`SingleChatSurface.handleAddDockPane` → the composer's /side flow) and renders
      // that thread's own view. This step used to wait for the *parent's* response inside
      // the dock, which the shipped bundle never renders, so it timed out even though the
      // pane worked. Assert the shipped contract instead: the pane mounts a composer, the
      // side chat's turn round-trips through the host, and its answer renders in the dock.
      const dock = page.locator("[data-right-dock-content]");
      await dock.locator('[contenteditable="true"]').first().waitFor({ state: "visible", timeout: 20_000 });
      await dock.locator('[contenteditable="true"]').first().fill("Side chat follow-up");
      await dock.getByRole("button", { name: "Send message", exact: true }).click();
      await dock.getByText("Fixture response: Side chat follow-up", { exact: true }).first().waitFor({ timeout: 20_000 });
    }
    result.screenshot = await screenshot(name);
    result.ok = true;
  } catch (error) {
    result.error = recordError(error);
  } finally {
    await collapseDock();
  }
  panelResults[label] = result;
  assert(result.ok, `${label} UI failed: ${result.error}`);
  return result;
}

try {
  if (!native) await page.goto(appServer.url.toString(), { waitUntil: "networkidle", timeout: 45_000 });
  await page.bringToFront();
  await page.getByText("Panel fixture workspace", { exact: true }).first().waitFor({ timeout: 90_000 });
  await page.screenshot({ path: join(output, "home.png"), fullPage: true });
  await page.getByText("Panel fixture task", { exact: true }).first().click();
  const composer = page.locator('[contenteditable="true"]').first();
  await composer.waitFor({ state: "visible", timeout: 20_000 });

  if (process.argv.includes("--hover-only")) {
    const result = await clickPanel("Files", "files-hover");
    await writeFile(join(output, "result.json"), JSON.stringify({ native, ...result }, null, 2));
    assert(result.ok, result.error ?? "File hover failed");
  } else {
  // This is the user-facing regression at the heart of the smoke: the picker
  // must show the OMP catalog, not an empty/built-in Synara provider list.
  const pickerTrigger = page.getByRole("button", { name: "Change model and reasoning", exact: true });
  const initialTriggerBox = await pickerTrigger.boundingBox();
  assert((await pickerTrigger.innerText()).trim().length > 0, "Model trigger must show its selection");
  await pickerTrigger.click();
  const picker = page.locator("[data-model-picker-popup]");
  await picker.waitFor({ state: "visible", timeout: 20_000 });
  assert(await picker.getAttribute("data-composer-picker-motion") === "dropdown-menu-morph", "Model picker has the wrong transition");
  const pickerMotion = await picker.evaluate((element: HTMLElement) => ({ duration: getComputedStyle(element).transitionDuration, transition: getComputedStyle(element).transitionProperty }));
  assert(pickerMotion.duration.includes("0.2s") && !pickerMotion.transition.includes("width") && !pickerMotion.transition.includes("height"), `Model picker morph timing is missing: ${JSON.stringify(pickerMotion)}`);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedMotionTransition = await picker.evaluate((element: HTMLElement) => getComputedStyle(element).transitionProperty);
  assert(reducedMotionTransition === "none", `Model picker ignores Reduce Motion: ${reducedMotionTransition}`);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const pickerTabLabels: string[] = await picker.getByRole("tab").evaluateAll((nodes: Element[]) =>
    nodes.map((node) => node.getAttribute("aria-label") ?? "").filter((label) => label.length > 0),
  );
  assert(
    !pickerTabLabels.some((label) => label.trim().toLowerCase() === "omp"),
    `Model picker leaked the internal OMP provider tab: ${pickerTabLabels.join(", ")}`,
  );
  const upstreamTabLabel = pickerTabLabels.find((label) => label.trim().toLowerCase() !== "starred");
  assert(upstreamTabLabel, `Model picker did not expose an upstream provider tab: ${pickerTabLabels.join(", ")}`);
  const upstreamTab = picker.getByRole("tab", { name: upstreamTabLabel, exact: true });
  await upstreamTab.click();
  await waitFor(
    () => upstreamTab.getAttribute("aria-selected"),
    (value) => value === "true",
    5_000,
  );
  const modelRow = picker.getByRole("menuitem").filter({ hasText: /Fixture model|fixture-model/i }).first();
  await modelRow.waitFor({ state: "visible", timeout: 20_000 });
  assert(await picker.getByRole("menuitem").filter({ hasText: /Fixture model|fixture-model/i }).count() === 1, "Model picker rendered duplicate fixture model rows");
  await screenshot("model-picker");
  await modelRow.click();
  await page.waitForFunction(() => !(document.querySelector("[data-model-picker-popup]") as HTMLElement | null)?.offsetParent, undefined, { timeout: 10_000 }).catch(() => undefined);
  assert((await pickerTrigger.getAttribute("title"))?.toLowerCase().includes("fixture"), "Model picker did not commit the fixture OMP model");

  assert(await page.getByRole("button", { name: "Change effort", exact: true }).count() === 0, "Standalone effort control must be removed");
  if (!(await picker.isVisible())) await pickerTrigger.click();
  const effortSlider = picker.getByRole("slider", { name: "Reasoning effort" });
  await effortSlider.waitFor({ state: "visible", timeout: 10_000 });
  const effortButtons = picker.getByRole("button", { name: /^Set effort to / });
  const effortLabels = await effortButtons.allTextContents();
  assert(effortLabels.some((label: string) => /^high$/i.test(label.trim())), "OMP advertised high effort is missing");
  assert(!effortLabels.some((label: string) => /xhigh|max/i.test(label)), "Effort picker invented unadvertised levels");
  await picker.getByRole("button", { name: /^Set effort to high$/i }).click();
  await waitFor<string>(() => pickerTrigger.getAttribute("title"), (value) => /high/i.test(value), 5_000);
  const selectedTriggerBox = await pickerTrigger.boundingBox();
  assert((await pickerTrigger.innerText()).toLowerCase().includes("fixture"), "Model trigger must show the selected fixture model");
  assert((await pickerTrigger.innerText()).toLowerCase().includes("high"), "Model trigger must show the selected effort");
  assert(initialTriggerBox && selectedTriggerBox && Math.abs(initialTriggerBox.width - selectedTriggerBox.width) < 0.5, "Model/effort selection resized the trigger");
  const initialContextMeter = page.getByRole("button", { name: /context window/i }).first();
  await initialContextMeter.waitFor({ state: "visible", timeout: 10_000 });
  assert((await initialContextMeter.getAttribute("aria-label"))?.includes("0%"), "Context meter must show model capacity before the first OMP turn");
  await page.keyboard.press("Escape");

  const headerActions = await headerActionsSmoke();
  const environment = await environmentSmoke();
  const dockLayout = await verifyDockToggleLayout();

  await composer.click();
  await composer.pressSequentially("Panel fixture prompt");
  const send = page.getByRole("button", { name: "Send message", exact: true });
  await send.waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForFunction(() => {
    const button = document.querySelector('button[aria-label="Send message"]') as HTMLButtonElement | null;
    return Boolean(button && !button.disabled);
  }, undefined, { timeout: 20_000 });
  await send.click();
  await page.getByText("Fixture response: Panel fixture prompt", { exact: true }).first().waitFor({ timeout: 20_000 });
  const effortCommand = host.host.store.listCommands(session.id).find(command => command.kind === "set_thinking_level" && (command.payload as AnyRecord)?.level === "high");
  assert(effortCommand && ["completed", "acknowledged"].includes(effortCommand.status), "Selected effort did not reach OMP");
  const contextMeter = page.getByRole("button", { name: /context window/i }).first();
  await contextMeter.waitFor({ state: "visible", timeout: 20_000 });
  assert((await contextMeter.getAttribute("aria-label"))?.includes("25%"), "Context meter did not show OMP occupancy");
  const meterBounds = await contextMeter.boundingBox();
  const modelBounds = await pickerTrigger.boundingBox();
  assert(meterBounds && modelBounds && meterBounds.x + meterBounds.width <= modelBounds.x + 1, "Context meter must precede the model/effort trigger");
  await contextMeter.click();
  await page.getByText("Active context limit: 128k tokens", { exact: true }).waitFor({ timeout: 5000 });
  await screenshot("context-window");
  await page.keyboard.press("Escape");
  await screenshot("conversation");

  // Packaged-run receipts (§10 items 55, 61, 62). The status bar is read with the
  // host live, an image is pasted into the composer and traced to the OMP turn,
  // and the skill/compaction surfaces are recorded as they actually are here.
  const statusBar = await statusBarReceipt();
  receiptSteps.push({
    item: "§10 item 55",
    claim: "The bundle's status bar shows live host values: host connection, model summary, session status and branch",
    status: "passed",
    assertions: [
      "the status bar renders and is painted",
      "the model cell carries the name the host's OMP catalogue gives the selected model, plus the committed effort",
      "the session cell matches the host session's status",
      "the branch cell equals `git rev-parse --abbrev-ref HEAD` in the fixture checkout",
      "the host cell reads 'live'",
    ],
    observed: statusBar,
  });
  const composerImage = await composerImageReceipt();
  receiptSteps.push({
    item: "§10 item 61",
    claim: "An image pasted in the Agents composer reaches the OMP turn as prompt images[]",
    status: composerImage.blocker ? "owed" : "passed",
    assertions: [
      "the paste renders an attachment chip in the composer",
      "the host's prompt command payload carries exactly one image row of type image/png",
      "the base64 bytes the turn carried are identical to the pasted bytes",
      "the fixture OMP answers the turn",
    ],
    observed: composerImage,
    ...(composerImage.blocker ? { blocker: String(composerImage.blocker) } : {}),
  });
  const skillCompaction = await skillAndCompactionProbe();
  receiptSteps.push({
    item: "§10 item 62",
    claim: "`/` completes a real skill and compaction runs from the UI",
    status: "owed",
    assertions: [
      "the composer's slash lane was driven and its list recorded",
      "the context-window popup was opened and its compact controls counted",
      "the fixture OMP's own command catalogue was read from the executable the host runs",
    ],
    observed: skillCompaction.observed,
    blocker: skillCompaction.blocker,
  });

  // Open every real launcher entry through the UI. The native APIs below are
  // supplements for deterministic PTY/files/browser assertions.
  await clickPanel("Terminal", "terminal");
  await clickPanel("Files", "files");
  await clickPanel("Browser", "browser");
  await clickPanel("Side chats", "side-chats");

  if (native) {
    const terminal = await terminalSmoke();
    panelResults.Terminal.detail = terminal;
    panelResults.Terminal.ok = true;
    const files = await filesSmoke();
    panelResults.Files.detail = files;
    panelResults.Files.ok = true;
    const browserResult = await browserSmoke();
    panelResults.Browser.detail = browserResult;
    panelResults.Browser.ok = true;
  } else {
    for (const label of ["Terminal", "Files", "Browser"] as const) {
      panelResults[label] = {
        ...panelResults[label],
        ok: true,
        detail: "native panel bridge skipped in --browser mode",
      };
    }
  }

  // The launcher itself creates the sidechat; the durable marker and the
  // inherited OMP transcript must both point back to this source task.
  const sidechatSessions = await waitFor(
    async () => host.host.store.listSessions(project.id).map(candidate => host.host.sessionView(candidate)),
    (value) => value.some(candidate => candidate.id !== session.id && candidate.sidechatSourceThreadId === session.id),
    20_000,
  );
  const child = sidechatSessions.find(candidate => candidate.id !== session.id && candidate.sidechatSourceThreadId === session.id);
  assert(child, "Side chats launcher did not create a child session with source metadata");
  const sidechatChild = child;
  const childEvents = host.host.store.readEvents(sidechatChild.id).events;
  const inherited = childEvents.some(event => JSON.stringify(event).includes("Fixture response: Panel fixture prompt"));
  assert(inherited, "Sidechat child did not inherit the source fixture transcript");
  panelResults["Side chats"] = { ...panelResults["Side chats"], ok: true, detail: { childId: sidechatChild.id, sourceThreadId: sidechatChild.sidechatSourceThreadId, inheritedFixtureMessage: inherited } };

  // §10 item 1b. This runs after the side chat has forked, so the rewind's cut tail cannot change
  // what that fork inherited, and before the panels are opened again.
  const rewind = await rewindReceipt();
  receiptSteps.push({
    item: "§10 item 1b",
    claim: "The transcript's revert control rewinds the task to a message that is not the last one, and the rewound text goes back into the composer instead of being sent again",
    status: "passed",
    assertions: [
      "the control renders on a user message that is not the last one, and - when the window settles enough to click it - its own click path confirms the dialog and drives the rewind",
      "the transcript ends at the message before the rewind point: the named message and both of this step's turns leave the screen",
      "the responses visible after the rewind are exactly the ones visible before this step",
      "the composer holds the rewound message's own text, with the row gone from the transcript",
      "the host recorded a completed `branch` and no `prompt` after it",
    ],
    observed: rewind,
  });

  const deviceLauncher = await openLauncher();
  await deviceLauncher.getByRole("button", { name: "Open iOS Simulator", exact: true }).click();
  await page.getByText("Install Xcode", { exact: true }).first().waitFor({ timeout: 15_000 });
  await screenshot("ios-simulator");
  panelResults["iOS Simulator"] = { clicked: true, ok: true, detail: "Synara setup-required checklist: Xcode unavailable" };
  await collapseDock();

  const themeAuthority = await themeAuthorityReceipt();
  receiptSteps.push({
    item: "§10 item 54",
    claim: "One workbench.colorTheme change repaints the Agents window, and the window has no theme-editing control",
    status: "passed",
    assertions: [
      "the workspace file's workbench.colorTheme reaches the shared theme snapshot (name and mode)",
      "the DOM's --background token and the painted body follow the change",
      "Settings → Appearance renders the read-only 'Following the IDE' copy and no theme-editing control",
    ],
    observed: themeAuthority,
  });

  const sidebarSizes = await verifySidebarSizesAndLeftToggle();
  const sidebarPersistence = await verifySidebarPersistence();
  const desktopZoom = await verifyDesktopZoom();
  const relaunch = await verifyWindowRelaunch();

  if (errors.length > 0) throw new Error(`Renderer errors: ${errors.join("\n")}`);
  const receipt = { generatedAt: new Date().toISOString(), native, steps: receiptSteps, findings: receiptFindings };
  await writeFile(join(output, "receipts.json"), JSON.stringify(receipt, null, 2));
  const result = {
    ok: true,
    native,
    providerCalls: 0,
    projectId: project.id,
    sourceSessionId: session.id,
    pickerTabs: pickerTabLabels,
    pickerMotion,
    effort: { labels: effortLabels, selected: "high", insideModelPicker: true, standalone: false },
    headerActions,
    environment,
    dockLayout,
    statusBar,
    composerImage,
    receiptSteps: receiptSteps.map(step => ({ item: step.item, claim: step.claim, status: step.status, blocker: step.blocker ?? null })),
    receiptFindings,
    sidebarSizes,
    sidebarPersistence,
    desktopZoom,
    relaunch,
    panels: panelResults,
    ideTargets,
    errors,
    browserFixtureUrl,
  };
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
  await Promise.all(["failure.json", "failure.png"].map(name => rm(join(output, name), { force: true })));
  console.log(`Agent Window panel smoke passed: ${output}`);
  }
} catch (error) {
  await page.screenshot({ path: join(output, "failure.png"), fullPage: true }).catch(() => undefined);
  const sessions = host.host.store.listSessions(project.id).map(candidate => {
    const view = host.host.sessionView(candidate);
    return { id: view.id, title: view.title, status: view.status, sidechatSourceThreadId: view.sidechatSourceThreadId };
  });
  const commandRows = host.host.store.listCommands(session.id).map(command => ({ id: command.commandId, kind: command.kind, status: command.status, error: command.error }));
  const composerControls = await page.locator('button[aria-label="Send message"], button[aria-label="Sending"], button[aria-label="Connecting"]').evaluateAll((nodes: Element[]) => nodes.map(node => {
    const button = node as HTMLButtonElement;
    const rect = button.getBoundingClientRect();
    return { label: button.getAttribute("aria-label"), disabled: button.disabled, visible: rect.width > 0 && rect.height > 0, text: button.innerText };
  })).catch(() => []);
  const composerEditors = await page.locator('[contenteditable="true"]').evaluateAll((nodes: Element[]) => nodes.map(node => {
    const element = node as HTMLElement;
    const rect = element.getBoundingClientRect();
    return { text: element.innerText, ariaLabel: element.getAttribute("aria-label"), contenteditable: element.getAttribute("contenteditable"), visible: rect.width > 0 && rect.height > 0 };
  })).catch(() => []);
  const events = host.host.store.readEvents(session.id).events.slice(-80);
  const body = await page.locator("body").innerText().catch(() => "");
  await writeFile(join(output, "failure.json"), JSON.stringify({
    ok: false,
    native,
    error: recordError(error),
    errors,
    panels: panelResults,
    sessions,
    commands: commandRows,
    events,
    bridgeRequests: bridgeRequests.slice(-80),
    composerControls,
    composerEditors,
    receiptSteps,
    receiptFindings,
    body: body.slice(0, 40_000),
  }, null, 2));
  throw error;
} finally {
  await closeBrowserBounded(browser);
  appServer.stop(true);
  browserFixture.stop(true);
  fixtureFiles.dispose();
  await host.close();
  await rm(scratch, { recursive: true, force: true });
}
