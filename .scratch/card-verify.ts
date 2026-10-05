// Scratch verification: drive the PACKAGED app's agent window, read computed
// card geometry + screenshot. No provider, fixture OMP only.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startHostServer } from "../apps/host/src/server.ts";

const root = resolve(import.meta.dir, "..");
const { _electron } = createRequire(join(root, "desktop/package.json"))("playwright");
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const out = join(root, ".scratch/rebuild-proof");
await mkdir(out, { recursive: true });
const scratch = await realpath(await mkdtemp(join(tmpdir(), "cedia-card-")));
const projectPath = join(scratch, "project");
await mkdir(projectPath);
await writeFile(join(projectPath, "hello.txt"), "card verify fixture\n");
execFileSync("git", ["init"], { cwd: projectPath, stdio: "ignore" });
execFileSync("git", ["add", "hello.txt"], { cwd: projectPath, stdio: "ignore" });
execFileSync("git", ["-c", "user.email=fixture@cedia", "-c", "user.name=Cedia Fixture", "commit", "-m", "fixture"], { cwd: projectPath, stdio: "ignore" });
const host = await startHostServer({
  stateDir: join(scratch, "host"),
  ompExecutable: join(root, "apps/macos/test/fixtures/agent-window-omp"),
  ompEnv: { CEDIA_NODE: process.execPath },
});
const project = host.host.store.createProject({ path: projectPath, name: "Card Verify" });
const session = host.host.createSession(project.id, "Card verify task");
console.log("thread", session.id);
const browser = await _electron.launch({
  executablePath: join(root, `VSCode-darwin-${process.arch}/Cedia.app/Contents/MacOS/Cedia`),
  args: ["--user-data-dir", join(scratch, "profile"), "--password-store=basic", "--use-inmemory-secretstorage", "--skip-welcome", "--skip-release-notes"],
  env: { ...process.env, CEDIA_STATE_DIR: join(scratch, "host"), CEDIA_HOST_NODE: "/Users/pond/.caret-tools/node-v24.18.0-darwin-arm64/bin/node" },
  timeout: 60_000,
});
const page = await browser.firstWindow();
const errors: string[] = [];
page.on("pageerror", (e: Error) => errors.push(e.message));
await page.evaluate((tid: string) => { location.hash = `#/${tid}`; }, session.id);
await page.waitForSelector("[data-chat-composer-footer='true']", { timeout: 60_000 });
await sleep(1500);
// left rail state + ensure sidebar open
const railState = await page.evaluate(() => {
  const rail = document.querySelector('[data-slot="sidebar"][data-side="left"]');
  return { state: rail?.getAttribute("data-state"), variant: rail?.getAttribute("data-variant") };
});
console.log("left sidebar:", JSON.stringify(railState));
const railLabels: string[] = await page.evaluate(() =>
  Array.from(document.querySelectorAll('[data-right-tool-rail] button')).map(b => b.getAttribute("aria-label") ?? "?"));
console.log("right rail buttons:", JSON.stringify(railLabels));
const leftLabels: string[] = await page.evaluate(() =>
  Array.from(document.querySelectorAll('[data-slot="sidebar"][data-side="left"]')).length
    ? Array.from(document.querySelector('[data-slot="sidebar"][data-side="left"]')!.querySelectorAll("button")).map(b => b.getAttribute("aria-label") ?? "?").slice(0, 12)
    : []);
console.log("left rail buttons:", JSON.stringify(leftLabels));
await page.screenshot({ path: join(out, "verify-A-sidebar.png") });
// open dock via Files tool
const filesBtn = page.locator('[data-right-tool-rail] button[aria-label="Files"]');
if (await filesBtn.count() > 0) {
  await filesBtn.first().click();
  await page.waitForSelector("[data-right-dock-content]", { timeout: 30_000 });
  await sleep(1200);
  console.log("dock opened via Files");
} else {
  console.log("NO Files button; trying first rail button");
  await page.locator('[data-right-tool-rail] button').first().click();
  await sleep(1500);
}
await page.screenshot({ path: join(out, "verify-B-dock.png") });
// computed geometry
const geom = await page.evaluate(() => {
  const cs = (el: Element | null, props: string[]) => {
    if (!el) return null;
    const s = getComputedStyle(el);
    const o: Record<string, string> = {};
    for (const p of props) o[p] = s.getPropertyValue(p);
    return o;
  };
  const q = (sel: string) => document.querySelector(sel);
  return {
    provider: cs(q('[data-slot="sidebar-wrapper"]'), ["padding-top", "padding-left", "gap", "column-gap", "background-color"]),
    floatContainer: cs(q('[data-variant="floating"] [data-slot="sidebar-container"]'), ["padding-top", "padding-left", "top", "bottom", "height", "width"]),
    floatInner: cs(q('[data-variant="floating"] [data-sidebar="sidebar"]'), ["border-radius", "background-color", "box-shadow", "border-top-width", "border-top-color"]),
    rightRail: cs(q('[data-right-tool-rail]'), ["margin-right", "margin-bottom", "margin-top", "border-radius", "background-color", "border-top-width", "box-shadow", "width"]),
    dockContainer: cs(q('.cedia-dock-card[data-slot="sidebar-container"]'), ["top", "bottom", "right", "border-radius", "border-top-width", "overflow", "height"]),
    dockInner: cs(q('.cedia-dock-card [data-sidebar="sidebar"]'), ["border-radius", "background-color"]),
    centerCard: cs(q('.cedia-center-card'), ["border-radius", "background-color", "border-top-width", "overflow"]),
    dockOpen: !!q('[data-right-dock-content]'),
  };
});
console.log(JSON.stringify(geom, null, 1));
console.log("pageerrors:", JSON.stringify(errors.slice(0, 5)));
await browser.close();
await host.close?.();
process.exit(0);
