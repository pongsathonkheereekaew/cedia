/** Actual shipped queue-panel click; host/runtime setup belongs to omp-queue-smoke. */
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { createAgentHostGateway, createAgentWindowHandler } from "../../apps/macos/src/agent-window-main.ts";

export async function dropQueueThroughBrowser(input: {
  root: string; stateDir: string; sessionTitle: string; queuedText: string;
  composer?: { firstText: string; onSubmitted(commandId: string, phase: "running" | "queued"): Promise<void> };
}) {
  const assets = process.env.CEDIA_QUEUE_UI_ASSETS ? resolve(process.env.CEDIA_QUEUE_UI_ASSETS) : join(input.root, "VSCode-darwin-arm64/Cedia.app/Contents/Resources/app/out/vs/cedia/agent");
  const index = await readFile(join(assets, "index.html"), "utf8");
  const assetPath = index.match(/src="\.\/([^" ]+\.js)"/)?.[1];
  if (!assetPath) throw new Error("Packaged Agent Window script missing");
  const assetSha256 = createHash("sha256").update(await readFile(join(assets, assetPath))).digest("hex");
  const { chromium } = createRequire(join(input.root, "desktop/package.json"))("playwright");
  const output = join(input.root, "dist/queue-browser-proof", new Date().toISOString().replaceAll(":", "-"));
  await mkdir(output, { recursive: true });
  const gateway = createAgentHostGateway({ appRoot: input.root, parentPid: process.pid, stateDir: input.stateDir });
  const handler = createAgentWindowHandler({
    ...gateway, stateDir: input.stateDir, authorize: () => true,
    pickFolder: async () => { throw new Error("No folder selection in queue proof"); },
    openIde: async () => { throw new Error("No IDE launch in queue proof"); },
    openExternal: async () => { throw new Error("No external navigation in queue proof"); },
    version: "queue-proof",
  });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const url = new URL(request.url);
    const path = resolve(assets, `.${decodeURIComponent(url.pathname)}`);
    if (path !== assets && !path.startsWith(`${assets}/`)) return new Response("Not found", { status: 404 });
    const file = Bun.file(path === assets ? join(assets, "index.html") : path);
    return new Response(await file.exists() ? file : Bun.file(join(assets, "index.html")));
  } });
  let browser;
  const errors: string[] = [];
  try {
    browser = await chromium.launch({ headless: true, channel: "chrome" });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
    page.on("pageerror", (error: Error) => errors.push(error.message));
    page.on("console", (message: { type(): string; text(): string }) => { if (message.type() === "error") errors.push(message.text()); });
    await page.route("**/*", async (route: any) => {
      if (new URL(route.request().url()).origin !== server.url.origin) return route.abort();
      return route.continue();
    });
    await page.exposeBinding("__cediaFixtureInvoke", async (_source: unknown, channel: string, request: unknown) => {
      if (channel !== "vscode:cediaAgent") throw new Error("Unexpected IPC channel");
      return handler({ sender: { send: () => {} } }, request);
    });
    await page.addInitScript(() => {
      const target = window as any;
      target.vscode = {
        context: { resolveConfiguration: async () => ({ windowId: 1, isSessionsWindow: true }) },
        process: { platform: "darwin", env: {} },
        ipcRenderer: { invoke: (channel: string, request: unknown) => target.__cediaFixtureInvoke(channel, request),
          send() {}, on() {}, once() {}, removeListener() {} },
      };
    });
    try {
      await page.goto(server.url.toString(), { waitUntil: "networkidle", timeout: 30_000 });
      await page.getByText(input.sessionTitle, { exact: true }).last().click({ timeout: 20_000 });
      if (input.composer) {
        await page.evaluate(() => {
          const target = window as any;
          target.__queueSubmissions = [];
          const original = target.nativeApi.orchestration.dispatchCommand;
          target.nativeApi.orchestration.dispatchCommand = async (command: any) => {
            if (command.type === "thread.turn.start") target.__queueSubmissions.push(command);
            const result = await original(command);
            if (command.type === "thread.turn.start") command.proofSettled = true;
            return result;
          };
        });
        for (const [index, text] of [input.composer.firstText, input.queuedText].entries()) {
          await page.locator('[contenteditable="true"]').first().fill(text);
          if (index === 0) await page.getByRole("button", { name: "Send message", exact: true }).click({ timeout: 20_000 });
          else await page.locator('[contenteditable="true"]').first().press("Enter");
          await page.waitForFunction((count: number) => (window as any).__queueSubmissions[count - 1]?.proofSettled === true, index + 1, { timeout: 20_000 });
          const commands = await page.evaluate(() => (window as any).__queueSubmissions);
          if (commands.length !== index + 1) throw new Error("Composer dispatched a duplicate turn");
          await input.composer.onSubmitted(commands[index].commandId, index === 0 ? "running" : "queued");
          await page.getByRole("button", { name: "Stop generation", exact: true }).waitFor({ timeout: 20_000 });
          if (index === 0) {
            await page.getByRole("button", { name: "Stop generation", exact: true }).waitFor({ timeout: 20_000 });
            await page.waitForFunction(() => document.querySelector('[contenteditable="true"]')?.textContent?.trim() === "", undefined, { timeout: 20_000 });
          }
        }
      }
      await page.getByText("Task controls", { exact: true }).click();
      const panel = page.getByTestId("cedia-queue-surface");
      await panel.getByRole("region", { name: "Follow-up", exact: true }).getByText(input.queuedText, { exact: true }).waitFor({ timeout: 20_000 });
      await page.screenshot({ path: join(output, "queued.png"), fullPage: true });
      await page.evaluate(() => {
        const target = window as any;
        target.__queueDrops = [];
        const original = target.nativeApi.cedia.dropQueued;
        target.nativeApi.cedia.dropQueued = async (...args: unknown[]) => {
          const entry: any = { args, status: "pending" };
          target.__queueDrops.push(entry);
          try {
            entry.answer = await original(...args);
            entry.status = "fulfilled";
            return entry.answer;
          } catch (error) { entry.status = "rejected"; throw error; }
        };
      });
      await panel.getByRole("button", { name: "Drop last queued submission", exact: true }).click();
      await panel.getByRole("region", { name: "Dropped queue submissions", exact: true }).getByText(input.queuedText, { exact: true }).waitFor({ timeout: 20_000 });
      await panel.getByText("Nothing queued", { exact: true }).waitFor({ timeout: 20_000 });
      if (input.composer) await page.getByRole("button", { name: "Stop generation", exact: true }).waitFor({ timeout: 20_000 });
      if (input.composer) {
        const visibleCopies = await page.getByText(input.queuedText, { exact: true }).count();
        if (visibleCopies !== 1) throw new Error(`Dropped prompt remains outside queue history (${visibleCopies} copies)`);
      }
      await page.screenshot({ path: join(output, "dropped.png"), fullPage: true });
      const drops = await page.evaluate(() => (window as any).__queueDrops);
      if (drops.length !== 1 || drops[0].status !== "fulfilled" || drops[0].args[1]?.mode !== "last") throw new Error("Expected exactly one successful UI Drop last dispatch");
      if (errors.length) throw new Error(`Renderer errors: ${JSON.stringify(errors)}`);
      const submissions = input.composer ? await page.evaluate(() => (window as any).__queueSubmissions) : [];
      if (input.composer && submissions.length !== 2) throw new Error("Expected exactly two composer submissions");
      return { body: drops[0].answer, commandId: drops[0].args[1].commandId, output, assets, assetSha256, errors, submissions };
    } catch (error) {
      await page.screenshot({ path: join(output, "failure.png"), fullPage: true }).catch(() => {});
      await writeFile(join(output, "failure.json"), JSON.stringify({ error: String(error), errors, browser: await page.evaluate(() => ({ text: document.body.innerText, submissions: (window as any).__queueSubmissions })) }, null, 2)).catch(() => {});
      throw error;
    }
  } finally {
    await browser?.close();
    server.stop(true);
  }
}
