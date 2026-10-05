import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startHostServer } from "../apps/host/src/server.ts";

const root = resolve(import.meta.dir, "..");
const { _electron } = createRequire(join(root, "desktop/package.json"))("playwright");
const scratch = await realpath(await mkdtemp(join(tmpdir(), "cedia-panel-hit-")));
const projectPath = join(scratch, "project");
await mkdir(projectPath);
await writeFile(join(projectPath, "hello.txt"), "probe\n");
execFileSync("git", ["init"], { cwd: projectPath, stdio: "ignore" });
execFileSync("git", ["add", "hello.txt"], { cwd: projectPath, stdio: "ignore" });
execFileSync("git", ["-c", "user.email=f@cedia", "-c", "user.name=F", "commit", "-m", "x"], { cwd: projectPath, stdio: "ignore" });
const host = await startHostServer({ stateDir: join(scratch, "host"), ompExecutable: join(root, "apps/macos/test/fixtures/agent-window-omp"), ompEnv: { CEDIA_NODE: process.execPath } });
const project = host.host.store.createProject({ path: projectPath, name: "Resize probe" });
host.host.createSession(project.id, "Resize task");
const browser = await _electron.launch({
  executablePath: join(root, `VSCode-darwin-${process.arch}/Cedia.app/Contents/MacOS/Cedia`),
  args: ["--user-data-dir", join(scratch, "profile"), "--password-store=basic", "--use-inmemory-secretstorage", "--skip-welcome", "--skip-release-notes"],
  env: { ...process.env, CEDIA_STATE_DIR: join(scratch, "host"), CEDIA_HOST_NODE: process.env.CEDIA_HOST_NODE! },
  timeout: 60_000,
});
try {
  const page = await browser.firstWindow();
  await page.getByText("Resize task", { exact: true }).first().click({ timeout: 60_000 });
  await page.getByRole("toolbar", { name: "Tools" }).getByRole("button", { name: "Terminal", exact: true }).click();
  await page.setViewportSize({ width: 1600, height: 1080 });
  const probe = await page.evaluate(() => {
    const rails = [...document.querySelectorAll<HTMLElement>('[data-slot="sidebar-rail"]')];
    return rails.map((rail) => {
      const r = rail.getBoundingClientRect();
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      const hit = document.elementFromPoint(x, y) as HTMLElement | null;
      const parent = rail.closest<HTMLElement>('[data-slot="sidebar-wrapper"]');
      const describe = (el: HTMLElement | null) => {
        const result = [];
        for (let n = 0; el && n < 14; n++, el = el.parentElement) {
          const box = el.getBoundingClientRect();
          result.push({ tag: el.tagName, slot: el.dataset.slot, cls: el.className.toString().slice(0, 80), rect: [box.x, box.y, box.width, box.height], z: getComputedStyle(el).zIndex, overflow: getComputedStyle(el).overflow, pointer: getComputedStyle(el).pointerEvents, visibility: getComputedStyle(el).visibility, clip: getComputedStyle(el).clipPath });
        }
        return result;
      };
      return { placement: rail.dataset.placement, rect: { x: r.x, y: r.y, w: r.width, h: r.height }, display: getComputedStyle(rail).display, z: getComputedStyle(rail).zIndex, position: getComputedStyle(rail).position, pointerEvents: getComputedStyle(rail).pointerEvents, cursor: getComputedStyle(rail).cursor, hit: describe(hit), stack: document.elementsFromPoint(x, y).map((el) => `${el.tagName} ${el.getAttribute("data-slot") ?? ""} ${el.className.toString().slice(0, 45)}`), ancestors: describe(rail.parentElement), isHit: hit === rail || !!hit && rail.contains(hit), wrapper: parent?.getAttribute("style") };
    });
  });
  console.log(JSON.stringify(probe, null, 2));
} finally {
  await browser.close();
  await host.close();
  await rm(scratch, { recursive: true, force: true });
}
