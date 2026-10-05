/** Packaged proof for the target.html card layout fix (floating 12px cards,
 *  8px shell, 6px gaps, visible status bar). Launches the packaged Cedia.app
 *  against an isolated fixture host (provider-free OMP fixture, zero provider
 *  calls) and measures the real Agents window geometry plus screenshots.
 *
 * Run: CEDIA_HOST_NODE=<node24> bun scripts/card-layout-packaged-proof.ts
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { realpath } from "node:fs/promises";
import { startHostServer } from "../apps/host/src/server.ts";

const root = resolve(import.meta.dir, "..");
const { _electron } = createRequire(join(root, "desktop/package.json"))("playwright");

const scratch = await realpath(await mkdtemp(join(tmpdir(), "cedia-card-layout-")));
const projectPath = join(scratch, "project");
await mkdir(projectPath, { recursive: true });
await writeFile(join(projectPath, "hello.txt"), "Card layout fixture\n");
execFileSync("git", ["init"], { cwd: projectPath, stdio: "ignore" });
execFileSync("git", ["add", "hello.txt"], { cwd: projectPath, stdio: "ignore" });
execFileSync("git", ["-c", "user.email=fixture@cedia", "-c", "user.name=Cedia Fixture", "commit", "-m", "fixture"], { cwd: projectPath, stdio: "ignore" });

const host = await startHostServer({
  stateDir: join(scratch, "host"),
  ompExecutable: join(root, "apps/macos/test/fixtures/agent-window-omp"),
  ompEnv: { CEDIA_NODE: process.execPath },
});
const project = host.host.store.createProject({ path: projectPath, name: "Card Layout fixture" });
host.host.createSession(project.id, "Fixture task");

const output = join(root, "dist/card-layout-proof");
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

const result: Record<string, unknown> = { providerCalls: 0 };
try {
  await page.getByText("Card Layout fixture", { exact: true }).first().waitFor({ timeout: 60_000 });
  await page.getByText("Fixture task", { exact: true }).first().click();
  // One fixture turn so the layout is transcript + composer (not the empty landing).
  const box = page.locator('[contenteditable="true"]').first();
  await box.waitFor({ state: "visible", timeout: 30_000 });
  await box.fill("Card layout proof turn");
  await page.waitForFunction(() => {
    const button = document.querySelector('button[aria-label="Send message"]') as HTMLButtonElement | null;
    return !!button && !button.disabled;
  }, undefined, { timeout: 15_000 });
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByText("Fixture response: Card layout proof turn", { exact: true }).first().waitFor({ timeout: 60_000 });
  await page.setViewportSize({ width: 1440, height: 900 });

  const composerWidth = await page.evaluate(() => {
    const input = document.querySelector('[contenteditable="true"]') as HTMLElement | null;
    // First ancestor with a real max-width constraint (the composer frame pill).
    let el: HTMLElement | null = input;
    while (el) {
      const mw = getComputedStyle(el).maxWidth;
      if (mw !== "none" && !mw.startsWith("max(") && !mw.endsWith("%") && !mw.endsWith("vw")) {
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), x: Math.round(r.x), maxWidth: mw };
      }
      el = el.parentElement;
    }
    return null;
  });
  const headerSearchField = await page.getByRole("button", { name: /^Search \(/ }).first().isVisible().catch(() => false);
  const geometry = await page.evaluate((extra: { composerWidth: unknown; headerSearchField: unknown }) => {
    const px = (v: string) => Number.parseFloat(v) || 0;
    const q = (s: string) => document.querySelector(s) as HTMLElement | null;
    const provider = q('[data-slot="sidebar-wrapper"]');
    const sideInner = document.querySelector('[data-sidebar="sidebar"]') as HTMLElement | null;
    const center = document.querySelector(".cedia-center-card") as HTMLElement | null;
    const rail = q("[data-right-tool-rail]");
    const statusbar = document.querySelector('[data-testid="cedia-status-bar"]') ?? [...document.querySelectorAll(".cedia-center-card *")].find((el) => /host.*live/i.test(el.textContent ?? "")) as HTMLElement | undefined;
    const seamHidden = (() => {
      if (!center) return null;
      const inner = center.querySelector(".chat-content-card") as HTMLElement | null;
      if (!inner) return "no-inner-card";
      return getComputedStyle(inner, "::before").display;
    })();
    const cs = (el: HTMLElement | null) => el ? getComputedStyle(el) : null;
    const pc = cs(provider); const sc = cs(sideInner); const cc = cs(center);
    const root = getComputedStyle(document.documentElement);
    const tokens: Record<string, string> = {};
    for (const t of ["--background", "--sidebar", "--card", "--color-background-surface", "--sidebar-border", "--muted"]) tokens[t] = root.getPropertyValue(t).trim();
    return {
      theme: document.documentElement.className,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      providerPadding: pc ? [pc.paddingTop, pc.paddingRight, pc.paddingBottom, pc.paddingLeft].join("/") : null,
      providerGap: pc ? pc.gap : null,
      sidebarRadius: sc ? sc.borderRadius : null,
      sidebarShadow: sc ? (sc.boxShadow !== "none") : null,
      sidebarRect: sideInner ? sideInner.getBoundingClientRect().toJSON() : null,
      centerRadius: cc ? cc.borderRadius : null,
      centerBorder: cc ? cc.borderTopWidth : null,
      centerRect: center ? center.getBoundingClientRect().toJSON() : null,
      seamBeforeDisplay: seamHidden,
      railMargins: rail ? (() => { const r = getComputedStyle(rail); return [r.marginTop, r.marginRight, r.marginBottom, r.marginLeft].join("/"); })() : null,
      railRadius: rail ? getComputedStyle(rail).borderRadius : null,
      railRect: rail ? rail.getBoundingClientRect().toJSON() : null,
      shellBg: pc ? pc.backgroundColor : null,
      sidebarBg: sc ? sc.backgroundColor : null,
      centerBg: cc ? cc.backgroundColor : null,
      railBg: rail ? getComputedStyle(rail).backgroundColor : null,
      tokens,
      composerWidth: extra.composerWidth,
      headerSearchField: extra.headerSearchField,
      statusbarVisible: statusbar ? (() => { const r = (statusbar as HTMLElement).getBoundingClientRect(); return r.bottom <= window.innerHeight + 1 && r.top >= 0 ? { top: r.top, bottom: r.bottom } : { offscreen: true, top: r.top, bottom: r.bottom }; })() : "not-found",
    };
  }, { composerWidth, headerSearchField });
  result.geometry = geometry;
  await page.screenshot({ path: join(output, "cards-dock-closed.png") });
  // Header search field opens the existing sidebar palette.
  const searchField = page.getByRole("button", { name: /^Search \(/ }).first();
  if (await searchField.isVisible()) {
    await searchField.click();
    await page.getByPlaceholder("Search chats or run a command").waitFor({ state: "visible", timeout: 20_000 });
    result.headerSearchOpensPalette = true;
    await page.keyboard.press("Escape");
  } else {
    result.headerSearchOpensPalette = "field-hidden";
  }
  // Dock open: the panel must end above the fixed-height status bar, never overlap it.
  await page.getByRole("toolbar", { name: "Tools" }).getByRole("button", { name: "Terminal", exact: true }).click();
  await page.getByText("Terminal 1").first().waitFor({ state: "visible", timeout: 30_000 });
  const dockState = await page.evaluate(() => {
    const dock = document.querySelector(".cedia-dock-card[data-slot='sidebar-container']") as HTMLElement | null;
    const bar = document.querySelector("[data-testid='cedia-status-bar']") as HTMLElement | null;
    const dr = dock?.getBoundingClientRect();
    const br = bar?.getBoundingClientRect();
    return {
      dockRect: dr ? { top: Math.round(dr.top), bottom: Math.round(dr.bottom) } : null,
      statusRect: br ? { top: Math.round(br.top), bottom: Math.round(br.bottom) } : null,
      overlap: dr && br ? dr.bottom > br.top + 1 : null,
      providerGap: (() => { const el = document.querySelector('[data-slot="sidebar-wrapper"]') as HTMLElement | null; return el ? getComputedStyle(el).gap : null; })(),
    };
  });
  result.dockOpen = dockState;
  if (dockState.overlap) throw new Error(`Open dock overlaps the status bar: ${JSON.stringify(dockState)}`);
  await page.screenshot({ path: join(output, "cards-dock-open.png") });
  // Dark mode: same geometry contract, tone follows the theme.
  await page.emulateMedia({ colorScheme: "dark" });
  const darkFlipped = await page.waitForFunction(() => document.documentElement.classList.contains("dark"), undefined, { timeout: 30_000 }).then(() => true).catch(() => false);
  result.darkMode = darkFlipped;
  if (darkFlipped) {
    await page.screenshot({ path: join(output, "cards-dock-open-dark.png") });
    result.darkTones = await page.evaluate(() => {
      const bg = (s: string) => { const el = document.querySelector(s) as HTMLElement | null; return el ? getComputedStyle(el).backgroundColor : null; };
      return { shell: bg('[data-slot="sidebar-wrapper"]'), center: bg(".cedia-center-card"), rail: bg("[data-right-tool-rail]") };
    });
  }
  result.errors = errors;
  console.log(JSON.stringify(result, null, 1));
} finally {
  await browser.close().catch(() => {});
  await host.close?.().catch(() => {});
}
