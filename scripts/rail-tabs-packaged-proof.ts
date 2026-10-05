/** Packaged proof for the §3.E rail/tab/tool-rail layout (item 71, slice 4).
 *
 * Launches the packaged Cedia.app against an isolated fixture host (provider-free
 * OMP fixture, zero provider calls) and observes the real Agents window:
 * independent left rail open/closed, task-tab strip, right tool rail open/switch/
 * collapse, cross-task tool carry, keyboard toggle, narrow overflow, IDE open/return.
 *
 * Run: CEDIA_HOST_NODE=<node24> bun scripts/rail-tabs-packaged-proof.ts
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { realpath } from "node:fs/promises";
import { startHostServer } from "../apps/host/src/server.ts";

const root = resolve(import.meta.dir, "..");
const { _electron } = createRequire(join(root, "desktop/package.json"))("playwright");

const scratch = await realpath(await mkdtemp(join(tmpdir(), "cedia-rail-tabs-")));
const projectPath = join(scratch, "project");
await mkdir(projectPath, { recursive: true });
await writeFile(join(projectPath, "hello.txt"), "Rail tabs fixture\n");
execFileSync("git", ["init"], { cwd: projectPath, stdio: "ignore" });
execFileSync("git", ["add", "hello.txt"], { cwd: projectPath, stdio: "ignore" });
execFileSync("git", ["-c", "user.email=fixture@cedia", "-c", "user.name=Cedia Fixture", "commit", "-m", "fixture"], { cwd: projectPath, stdio: "ignore" });

const host = await startHostServer({
  stateDir: join(scratch, "host"),
  ompExecutable: join(root, "apps/macos/test/fixtures/agent-window-omp"),
  ompEnv: { CEDIA_NODE: process.execPath },
});
const project = host.host.store.createProject({ path: projectPath, name: "Rail Tabs fixture" });
const session = host.host.createSession(project.id, "Fixture task");

const output = join(root, "dist/rail-tabs-packaged-proof");
await mkdir(output, { recursive: true });

try { execFileSync("security", ["delete-generic-password", "-s", "Cedia Safe Storage"], { stdio: "ignore" }); } catch {}
const node24 = process.env.CEDIA_HOST_NODE;
if (!node24) throw new Error("Set CEDIA_HOST_NODE to the Node 24 executable");
const browser = await _electron.launch({
  executablePath: join(root, `VSCode-darwin-${process.arch}/Cedia.app/Contents/MacOS/Cedia`),
  args: ["--user-data-dir", join(scratch, "profile"), "--password-store=basic", "--use-inmemory-secretstorage", "--skip-welcome", "--skip-release-notes"],
  env: { ...process.env, CEDIA_STATE_DIR: join(scratch, "host"), CEDIA_HOST_NODE: node24 },
  timeout: 60_000,
});
const page = await browser.firstWindow();
const errors: string[] = [];
page.on("pageerror", (error: Error) => errors.push(error.message));
page.on("console", (message: { type(): string; text(): string }) => { if (message.type() === "error") errors.push(message.text()); });
page.on("requestfailed", (request: { url(): string; failure(): { errorText: string } | null }) => {
  const text = request.failure()?.errorText ?? "unknown";
  if (text === "net::ERR_ABORTED") return;
  errors.push(`REQFAIL ${text} ${request.url()}`);
});

async function fillComposerAndSend(text: string): Promise<void> {
  const box = page.locator('[contenteditable="true"]').first();
  await box.waitFor({ state: "visible", timeout: 30_000 });
  await page.getByText("Select branch").first().waitFor({ timeout: 30_000 }).catch(() => {});
  for (let attempt = 0; ; attempt++) {
    await box.fill(text);
    try {
      await page.waitForFunction(() => {
        const button = document.querySelector('button[aria-label="Send message"]') as HTMLButtonElement | null;
        return !!button && !button.disabled;
      }, undefined, { timeout: 10_000 });
      break;
    } catch {
      if (attempt >= 2) throw new Error(`Send stayed disabled: ${text}`);
    }
  }
  await page.getByRole("button", { name: "Send message", exact: true }).click();
}

const result: Record<string, unknown> = { providerCalls: 0 };
try {
  await page.getByText("Rail Tabs fixture", { exact: true }).first().waitFor({ timeout: 60_000 });
  await page.getByText("Fixture task", { exact: true }).first().click();
  await fillComposerAndSend("Rail tabs proof turn");
  await page.getByText("Fixture response: Rail tabs proof turn", { exact: true }).first().waitFor({ timeout: 60_000 });

  // 1. Open state: rail icons, panel list, thread title, no tab strip.
  for (const name of ["Threads", "New thread", "Search", "Activity", "Projects", "Settings"]) {
    await page.getByRole("button", { name, exact: true }).first().waitFor({ state: "visible", timeout: 20_000 });
  }
  await page.getByText("Fixture task", { exact: true }).first().waitFor({ timeout: 20_000 });
  const openTitle = await page.locator("h2").first().textContent();
  if (!openTitle?.includes("Fixture task")) throw new Error(`Open header shows no thread title: ${openTitle}`);
  if (await page.getByRole("tablist", { name: "Tasks" }).count() !== 0) {
    throw new Error("Tab strip renders while the panel is open (duplicate view)");
  }
  await page.screenshot({ path: join(output, "rail-open.png"), fullPage: true });
  result.railOpen = true;

  // 2. Wobble: sample the title rect across the collapse animation.
  const sampling = page.evaluate(() => new Promise((resolveSamples) => {
    const samples: Array<{ x: number; y: number } | null> = [];
    let frames = 0;
    const tick = () => {
      const el = document.querySelector("h2");
      if (el) {
        const rect = el.getBoundingClientRect();
        samples.push({ x: rect.x, y: rect.y });
      } else {
        samples.push(null);
      }
      if (++frames < 42) requestAnimationFrame(tick);
      else (resolveSamples as (v: unknown) => void)(samples);
    };
    requestAnimationFrame(tick);
  }));
  await new Promise((resolve) => setTimeout(resolve, 150));
  await page.getByRole("button", { name: "Toggle thread sidebar", exact: true }).click();
  const samples = (await sampling) as Array<{ x: number; y: number } | null>;
  const visible = samples.filter((s): s is { x: number; y: number } => s !== null);
  const ys = visible.map((s) => s.y);
  const ySpread = Math.max(...ys) - Math.min(...ys);
  result.titleYSpread = ySpread;
  result.titleSamples = samples.length;
  if (ySpread > 2) throw new Error(`Thread title wobbled vertically by ${ySpread}px during collapse`);

  // 3. Collapsed state: rail persists, tab strip replaces the title.
  await page.getByRole("tablist", { name: "Tasks" }).waitFor({ state: "visible", timeout: 20_000 });
  for (const name of ["Threads", "New thread", "Search", "Activity", "Projects", "Settings"]) {
    await page.getByRole("button", { name, exact: true }).first().waitFor({ state: "visible", timeout: 20_000 });
  }
  const tabCount = await page.getByRole("tablist", { name: "Tasks" }).getByRole("tab").count();
  if (tabCount < 1) throw new Error("Tab strip is empty with unfinished work");
  result.tabCountCollapsed = tabCount;
  await page.getByRole("toolbar", { name: "Tools" }).waitFor({ state: "visible", timeout: 20_000 });
  await page.screenshot({ path: join(output, "tabs-collapsed.png"), fullPage: true });
  result.tabsCollapsed = true;

  // 4. Right rail: open Terminal, collapse it, switch to Browser.
  await page.getByRole("toolbar", { name: "Tools" }).getByRole("button", { name: "Terminal", exact: true }).click();
  await page.getByText("Terminal 1").first().waitFor({ state: "visible", timeout: 30_000 });
  result.terminalOpened = true;
  // Single pane: no dock-level tab row (only the rail icon carries the name).
  const terminalNameCount = await page.getByRole("button", { name: "Terminal", exact: true }).count();
  result.singlePaneTerminalButtons = terminalNameCount;
  if (terminalNameCount !== 1) throw new Error(`Single pane shows a dock-level tab row (Terminal buttons: ${terminalNameCount})`);
  await page.getByRole("toolbar", { name: "Tools" }).getByRole("button", { name: "Terminal", exact: true }).click();
  await page.getByText("Terminal 1").first().waitFor({ state: "hidden", timeout: 20_000 });
  result.terminalCollapsed = true;
  await page.getByRole("toolbar", { name: "Tools" }).getByRole("button", { name: "Browser", exact: true }).click();
  await page.getByText("Start browsing").first().waitFor({ timeout: 30_000 });
  result.browserOpened = true;
  // Header dock toggle: visible at the top and toggles the panel.
  const headerDockToggle = page.getByRole("button", { name: "Toggle right sidebar", exact: true });
  await headerDockToggle.waitFor({ state: "visible", timeout: 20_000 });
  await headerDockToggle.click();
  await page.getByText("Start browsing").waitFor({ state: "hidden", timeout: 20_000 });
  await headerDockToggle.click();
  await page.getByText("Start browsing").first().waitFor({ state: "visible", timeout: 20_000 });
  result.headerDockToggle = true;
  // Header dock toggle: visible at the top and toggles the panel.
  const headerToggle = page.getByRole("button", { name: "Toggle right sidebar", exact: true });
  await headerToggle.waitFor({ state: "visible", timeout: 20_000 });
  await headerToggle.click();
  await page.getByText("Start browsing").waitFor({ state: "hidden", timeout: 20_000 });
  await headerToggle.click();
  await page.getByText("Start browsing").first().waitFor({ state: "visible", timeout: 20_000 });
  result.headerDockToggle = true;
  // Corner slot: the toggle sits at the top-right above the rail, not in the
  // header flow (this distinguishes it from the interim inline toggle).
  const toggleBox = await headerToggle.boundingBox();
  const innerWidth = await page.evaluate(() => window.innerWidth);
  result.toggleBox = toggleBox;
  if (!toggleBox || toggleBox.y >= 46 || toggleBox.x + toggleBox.width < innerWidth - 70) {
    throw new Error(`Dock toggle is not fixed at the far right: ${JSON.stringify(toggleBox)} vs ${innerWidth}`);
  }
  // Two panes: the dock-level tab row returns for switching.
  const browserNameCount = await page.getByRole("button", { name: "Browser", exact: true }).count();
  result.twoPaneBrowserButtons = browserNameCount;
  if (browserNameCount < 2) throw new Error(`Two panes show no dock-level tabs (Browser buttons: ${browserNameCount})`);
  await page.screenshot({ path: join(output, "tool-rail.png"), fullPage: true });

  // 5. Carry: second task inherits the visible tool kind.
  await page.getByRole("button", { name: "Toggle thread sidebar", exact: true }).click();
  await page.getByText("Rail Tabs fixture", { exact: true }).first().hover();
  // Hover-revealed row action: force the click past the row's own hit box,
  // which wins Playwright's hit test while the reveal settles.
  await page.getByRole("button", { name: "Create new thread in Rail Tabs fixture", exact: true }).click({ force: true });
  await fillComposerAndSend("Second proof turn");
  await page.getByText("Fixture response: Second proof turn", { exact: true }).first().waitFor({ timeout: 60_000 });
  // Terminal was visible on task one... reopen it there first for a clean carry origin.
  await page.getByText("Fixture task", { exact: true }).first().click();
  await page.getByText("Fixture response: Rail tabs proof turn", { exact: true }).first().waitFor({ timeout: 30_000 });
  // Deterministic carry origin: collapse first if the rail shows Terminal
  // active (otherwise this click would collapse instead of opening).
  const railTerminal = page.getByRole("toolbar", { name: "Tools" }).getByRole("button", { name: "Terminal", exact: true });
  if ((await railTerminal.getAttribute("aria-pressed")) === "true") {
    await railTerminal.click();
    await page.getByText("Terminal 1").first().waitFor({ state: "hidden", timeout: 20_000 });
  }
  await railTerminal.click();
  await page.getByText("Terminal 1").first().waitFor({ state: "visible", timeout: 30_000 });
  const sessions = host.host.store.listSessions(project.id);
  const second = sessions.find((candidate: { id: string }) => candidate.id !== session.id);
  if (!second) throw new Error("Second task has no durable session");
  await page.getByText(second.title, { exact: true }).first().click();
  await page.getByText("Fixture response: Second proof turn", { exact: true }).first().waitFor({ timeout: 30_000 });
  const railPressed = await page.getByRole("toolbar", { name: "Tools" }).getByRole("button", { name: "Terminal", exact: true }).getAttribute("aria-pressed");
  if (railPressed !== "true") throw new Error("Visible tool kind did not carry to the new task (rail shows Terminal inactive)");
  const carried = await page.getByText("Terminal 1").first().waitFor({ state: "visible", timeout: 30_000 }).then(() => true).catch(() => false);
  if (!carried) throw new Error("Carried terminal pane did not render on the new task");
  result.toolCarried = true;
  await page.screenshot({ path: join(output, "tool-carry.png"), fullPage: true });

  // 6. Keyboard: Enter on the focused toggle collapses/expands.
  const toggle = page.getByRole("button", { name: "Toggle thread sidebar", exact: true });
  await toggle.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("tablist", { name: "Tasks" }).waitFor({ state: "visible", timeout: 20_000 });
  await toggle.focus();
  await page.keyboard.press("Enter");
  await page.locator("h2").first().waitFor({ state: "visible", timeout: 20_000 });
  result.keyboardToggle = true;

  // 7. Narrow window: rail and tabs stay reachable with overflow.
  await page.setViewportSize({ width: 900, height: 800 });
  await page.getByRole("button", { name: "Toggle thread sidebar", exact: true }).click();
  await page.getByRole("tablist", { name: "Tasks" }).waitFor({ state: "visible", timeout: 20_000 });
  const overflow = await page.evaluate(() => {
    const strip = document.querySelector('[role="tablist"][aria-label="Tasks"]');
    if (!strip) return null;
    return { scrollWidth: strip.scrollWidth, clientWidth: strip.clientWidth };
  });
  result.narrowStrip = overflow;
  await page.screenshot({ path: join(output, "tabs-narrow.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });

  // 8. IDE opens on the task workspace and returns without duplicating windows.
  await page.getByRole("button", { name: "Toggle thread sidebar", exact: true }).click();
  await page.getByText("Fixture task", { exact: true }).first().click();
  const ideOpened = browser.waitForEvent("window", { timeout: 30_000 });
  const openIdeButtons = page.getByRole("button", { name: "Open in IDE", exact: true });
  await openIdeButtons.first().waitFor({ state: "visible", timeout: 20_000 });
  let launched = false;
  for (let index = 0; index < await openIdeButtons.count(); index++) {
    if (await openIdeButtons.nth(index).isEnabled()) {
      await openIdeButtons.nth(index).click();
      launched = true;
      break;
    }
  }
  if (!launched) throw new Error("No enabled Open in IDE button");
  const ide = await ideOpened;
  await ide.waitForURL(/workbench/, { timeout: 30_000 });
  await ide.locator(".monaco-workbench").waitFor({ timeout: 30_000 });
  await ide.bringToFront();
  await ide.keyboard.press("Meta+Shift+A");
  await page.waitForFunction(() => document.hasFocus(), { timeout: 20_000 });
  if (browser.windows().length !== 2) throw new Error("Returning to Agents created a duplicate window");
  result.ideRoundTrip = true;

  if (errors.length) throw new Error(`Renderer errors: ${errors.join("\n")}`);
  result.ok = true;
  await writeFile(join(output, "result.json"), JSON.stringify({ ...result, projectId: project.id, sessionId: session.id }, null, 2));
  console.log(`Rail/tabs packaged proof passed: ${output}`);
} catch (error) {
  await page.screenshot({ path: join(output, "failure.png"), fullPage: true });
  await writeFile(join(output, "failure.json"), JSON.stringify({ error: String(error), errors, result, body: await page.locator("body").innerText().catch(() => "") }, null, 2));
  throw error;
} finally {
  await browser.close();
  await host.close();
  await rm(scratch, { recursive: true, force: true });
}
