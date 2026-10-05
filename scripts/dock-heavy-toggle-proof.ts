/** Heavy-dock toggle repro: 4 panes (terminal+browser+explorer+diff with real
 * uncommitted changes), close via corner toggle, reopen, time it.
 * Run: CEDIA_HOST_NODE=<node24> bun scripts/dock-heavy-toggle-proof.ts
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startHostServer } from "../apps/host/src/server.ts";

const root = resolve(import.meta.dir, "..");
const { _electron } = createRequire(join(root, "desktop/package.json"))("playwright");
const scratch = await realpath(await mkdtemp(join(tmpdir(), "cedia-heavy-dock-")));
const projectPath = join(scratch, "project");
await mkdir(projectPath, { recursive: true });
await writeFile(join(projectPath, "hello.txt"), "heavy dock fixture\n");
for (let i = 0; i < 30; i++) await writeFile(join(projectPath, `file-${i}.txt`), `content ${i}\n`);
execFileSync("git", ["init"], { cwd: projectPath, stdio: "ignore" });
execFileSync("git", ["add", "."], { cwd: projectPath, stdio: "ignore" });
execFileSync("git", ["-c", "user.email=f@cedia", "-c", "user.name=F", "commit", "-m", "x"], { cwd: projectPath, stdio: "ignore" });
for (let i = 0; i < 30; i++) await writeFile(join(projectPath, `file-${i}.txt`), `changed ${i}\n`);
await writeFile(join(projectPath, "new-file.txt"), "untracked\n");
const host = await startHostServer({
  stateDir: join(scratch, "host"),
  ompExecutable: join(root, "apps/macos/test/fixtures/agent-window-omp"),
  ompEnv: { CEDIA_NODE: process.execPath },
});
const project = host.host.store.createProject({ path: projectPath, name: "Heavy fixture" });
host.host.createSession(project.id, "Heavy task");
try { execFileSync("security", ["delete-generic-password", "-s", "Cedia Safe Storage"], { stdio: "ignore" }); } catch {}
const browser = await _electron.launch({
  executablePath: join(root, `VSCode-darwin-${process.arch}/Cedia.app/Contents/MacOS/Cedia`),
  args: ["--user-data-dir", join(scratch, "profile"), "--password-store=basic", "--use-inmemory-secretstorage", "--skip-welcome", "--skip-release-notes"],
  env: { ...process.env, CEDIA_STATE_DIR: join(scratch, "host"), CEDIA_HOST_NODE: process.env.CEDIA_HOST_NODE! },
  timeout: 60_000,
});
const page = await browser.firstWindow();
const errors: string[] = [];
page.on("pageerror", (e: Error) => errors.push(e.message));
try {
  await page.getByText("Heavy fixture", { exact: true }).first().waitFor({ timeout: 60_000 });
  await page.getByText("Heavy task", { exact: true }).first().click();
  const rail = page.getByRole("toolbar", { name: "Tools" });
  for (const name of ["Terminal", "Browser", "Files"]) {
    await rail.getByRole("button", { name, exact: true }).click();
    await new Promise((r) => setTimeout(r, 1500));
  }
  // Diff needs computed changes; wait for the Review rail button then open it.
  await rail.getByRole("button", { name: "Review", exact: true }).click();
  await page.getByText("30 unmodified lines").first().waitFor({ timeout: 60_000 }).catch(() => {});
  const paneCount = await page.evaluate(() => document.querySelectorAll('[data-right-dock-content]').length);
  console.log("dock content roots:", paneCount);
  const toggle = page.getByRole("button", { name: "Toggle right sidebar", exact: true });
  await toggle.click();
  await page.waitForTimeout(1000);
  const t0 = Date.now();
  await toggle.click();
  // Reopen must restore a VISIBLE pane quickly (not hang on remount).
  await page.getByText("Terminal 1").first().waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});
  const visibleTerminal = await page.getByText("Terminal 1").first().isVisible().catch(() => false);
  const visibleBrowser = await page.getByText("Start browsing").first().isVisible().catch(() => false);
  console.log(`reopen took ${Date.now() - t0}ms; terminal visible: ${visibleTerminal}; browser home visible: ${visibleBrowser}`);
  await page.screenshot({ path: join(root, "dist/heavy-dock-proof.png"), fullPage: true });
  if (errors.length) throw new Error(`Renderer errors: ${errors.join("\n")}`);
  console.log("heavy dock toggle proof done");
} finally {
  await browser.close();
  await host.close();
  await rm(scratch, { recursive: true, force: true });
}
