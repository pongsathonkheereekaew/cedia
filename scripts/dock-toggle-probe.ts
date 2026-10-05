/** Probe: corner dock toggle hit-testing at a narrow window (user ~800px). */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startHostServer } from "../apps/host/src/server.ts";

const root = resolve(import.meta.dir, "..");
const { _electron } = createRequire(join(root, "desktop/package.json"))("playwright");
const scratch = await realpath(await mkdtemp(join(tmpdir(), "cedia-toggle-probe-")));
const projectPath = join(scratch, "project");
await mkdir(projectPath, { recursive: true });
await writeFile(join(projectPath, "hello.txt"), "probe\n");
execFileSync("git", ["init"], { cwd: projectPath, stdio: "ignore" });
execFileSync("git", ["add", "hello.txt"], { cwd: projectPath, stdio: "ignore" });
execFileSync("git", ["-c", "user.email=f@cedia", "-c", "user.name=F", "commit", "-m", "x"], { cwd: projectPath, stdio: "ignore" });
const host = await startHostServer({
  stateDir: join(scratch, "host"),
  ompExecutable: join(root, "apps/macos/test/fixtures/agent-window-omp"),
  ompEnv: { CEDIA_NODE: process.execPath },
});
const project = host.host.store.createProject({ path: projectPath, name: "Probe fixture" });
host.host.createSession(project.id, "Probe task");
try { execFileSync("security", ["delete-generic-password", "-s", "Cedia Safe Storage"], { stdio: "ignore" }); } catch {}
const browser = await _electron.launch({
  executablePath: join(root, `VSCode-darwin-${process.arch}/Cedia.app/Contents/MacOS/Cedia`),
  args: ["--user-data-dir", join(scratch, "profile"), "--password-store=basic", "--use-inmemory-secretstorage", "--skip-welcome", "--skip-release-notes"],
  env: { ...process.env, CEDIA_STATE_DIR: join(scratch, "host"), CEDIA_HOST_NODE: process.env.CEDIA_HOST_NODE! },
  timeout: 60_000,
});
const page = await browser.firstWindow();
try {
  await page.getByText("Probe fixture", { exact: true }).first().waitFor({ timeout: 60_000 });
  await page.getByText("Probe task", { exact: true }).first().click();
  await page.setViewportSize({ width: 800, height: 700 });
  const toggle = page.getByRole("button", { name: "Toggle right sidebar", exact: true });
  await toggle.waitFor({ state: "visible", timeout: 20_000 });
  const probe = await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="Toggle right sidebar"]') as HTMLElement | null;
    if (!btn) return { found: false };
    const r = btn.getBoundingClientRect();
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    const hit = document.elementFromPoint(cx, cy) as HTMLElement | null;
    const chain: string[] = [];
    let el: HTMLElement | null = hit;
    while (el && chain.length < 6) {
      chain.push(`${el.tagName}.${(el.className as string)?.toString?.().slice(0, 60)} pe=${getComputedStyle(el).pointerEvents} appRegion=${(getComputedStyle(el) as unknown as Record<string, string>)["-webkit-app-region"] ?? "n/a"}`);
      el = el.parentElement;
    }
    return {
      found: true, rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      innerWidth: window.innerWidth,
      hitChain: chain,
      btnPointerEvents: getComputedStyle(btn).pointerEvents,
      btnVisible: btn.offsetParent !== null,
    };
  });
  console.log(JSON.stringify(probe, null, 1));
  await toggle.click({ timeout: 10_000 });
  const opened = await page.evaluate(() => document.body.innerText.includes("Terminal 1") || document.body.innerText.includes("Start browsing") || document.body.innerText.includes("Explorer"));
  console.log("dock opened after click:", opened);
} finally {
  await browser.close();
  await host.close();
  await rm(scratch, { recursive: true, force: true });
}
