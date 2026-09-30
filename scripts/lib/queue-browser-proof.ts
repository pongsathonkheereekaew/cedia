/** Real queue/composer UI proof; host/runtime setup belongs to omp-queue-smoke. */
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile, realpath } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { createAgentHostGateway, createAgentWindowHandler } from "../../apps/macos/src/agent-window-main.ts";
import { applyLoginItemShim, validateStagedAppPath } from "../omp-packaged-task-controls-proof.ts";

export interface QueueImageFixture {
  name: string;
  mimeType: string;
  base64: string;
}

export type QueueImagePixel = readonly [number, number, number, number];

export interface QueueDecodedImage {
  width: number;
  height: number;
  pixel: QueueImagePixel;
}

/** Decode both sides through the real browser image pipeline, including normalized WebP. */
export async function decodeQueueImagePair(page: unknown, actualUrl: string, expected: QueueImageFixture): Promise<{ actual: QueueDecodedImage; expected: QueueDecodedImage }> {
  const target = page as { evaluate<T>(fn: (value: unknown) => T | Promise<T>, value: unknown): Promise<T> };
  return target.evaluate(async (value: unknown) => {
    const input = value as { actualUrl: string; expectedUrl: string };
    const decode = async (source: string): Promise<QueueDecodedImage> => {
      const image = new Image();
      image.src = source;
      await Promise.race([
        image.decode(),
        new Promise<void>(resolveTimeout => setTimeout(resolveTimeout, 3_000)),
      ]).catch(() => {});
      if (image.naturalWidth <= 0 || image.naturalHeight <= 0) throw new Error(`Image did not decode: ${source.slice(0, 120)}`);
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas 2D context unavailable");
      try {
        context.drawImage(image, 0, 0, 1, 1);
        const pixel = Array.from(context.getImageData(0, 0, 1, 1).data) as unknown as QueueImagePixel;
        return { width: image.naturalWidth, height: image.naturalHeight, pixel };
      } catch (error) {
        throw new Error(`Image pixels were unreadable: ${String(error)}`);
      }
    };
    return { actual: await decode(input.actualUrl), expected: await decode(input.expectedUrl) };
  }, { actualUrl, expectedUrl: `data:${expected.mimeType};base64,${expected.base64}` });
}

export function queuePixelsMatch(actual: QueueImagePixel, expected: QueueImagePixel): boolean {
  return actual.every((value, index) => Math.abs(value - expected[index]!) <= 8);
}

export function queueImageDataUrl(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>).url === "string") return (value as Record<string, string>).url;
  return undefined;
}

export function queueImageParts(message: Record<string, unknown> | undefined): Record<string, unknown>[] {
  if (!message || !Array.isArray(message.content)) return [];
  return message.content.filter((part): part is Record<string, unknown> => part !== null && typeof part === "object" && !Array.isArray(part) && part.type === "image_url");
}

function summarizeDataUrl(value: string | undefined): Record<string, unknown> {
  if (!value) return { representation: "missing" };
  const match = /^data:([^;,]+);base64,([\s\S]*)$/.exec(value);
  if (!match) return { representation: "non-data-url", chars: value.length };
  const bytes = Buffer.from(match[2]!, "base64");
  return {
    representation: "data-uri",
    mediaType: match[1],
    encodedChars: match[2]!.length,
    payloadBytes: bytes.length,
    signature: bytes.subarray(0, 12).toString("hex"),
  };
}

export function summarizeQueueRequest(body: Record<string, unknown>): Record<string, unknown> {
  const messages = Array.isArray(body.messages) ? body.messages.filter((value): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)) : [];
  const users = messages.filter(message => message.role === "user").map(message => {
    const content = Array.isArray(message.content)
      ? message.content.map(part => {
          if (!part || typeof part !== "object" || Array.isArray(part)) return { type: "unknown" };
          const row = part as Record<string, unknown>;
          return row.type === "text" ? { type: "text", chars: typeof row.text === "string" ? row.text.length : 0 } : row.type === "image_url" ? { type: "image_url", image: summarizeDataUrl(queueImageDataUrl(row.image_url)) } : { type: String(row.type ?? "unknown") };
        })
      : [{ type: typeof message.content === "string" ? "text" : "unknown", ...(typeof message.content === "string" ? { chars: message.content.length } : {}) }];
    return { content };
  });
  return { model: body.model, stream: body.stream, messageCount: messages.length, userMessages: users };
}

export async function dropQueueThroughBrowser(input: {
  root: string; stateDir: string; sessionTitle: string; queuedText: string;
  composer?: { firstText: string; onSubmitted(commandId: string, phase: "running" | "queued"): Promise<void> };
  execution?: {
    thirdText: string;
    replies: string[];
    attachments?: { first: QueueImageFixture; second: QueueImageFixture };
    finish(page: unknown): Promise<unknown>;
    capture?(output: string): Promise<void> | void;
    afterReload?(): Promise<void> | void;
    validate?(): Promise<void> | void;
  };
}) {
  const nativeApp = process.env.CEDIA_QUEUE_NATIVE_APP ? await realpath(process.env.CEDIA_QUEUE_NATIVE_APP) : undefined;
  if (nativeApp) {
    const valid = validateStagedAppPath(nativeApp, join(input.root, "VSCode-darwin-arm64/Cedia.app"), await realpath(tmpdir()));
    if (!valid.accepted || !input.composer || process.env.CEDIA_QUEUE_UI_ASSETS) throw new Error(`Native queue proof requires scratch app, composer mode and no asset override: ${valid.reason}`);
  }
  const assets = nativeApp ? join(nativeApp, "Contents/Resources/app/out/vs/cedia/agent") : process.env.CEDIA_QUEUE_UI_ASSETS ? resolve(process.env.CEDIA_QUEUE_UI_ASSETS) : join(input.root, "VSCode-darwin-arm64/Cedia.app/Contents/Resources/app/out/vs/cedia/agent");
  const index = await readFile(join(assets, "index.html"), "utf8");
  const assetPath = index.match(/src="\.\/([^" ]+\.js)"/)?.[1];
  if (!assetPath) throw new Error("Packaged Agent Window script missing");
  const assetSha256 = createHash("sha256").update(await readFile(join(assets, assetPath))).digest("hex");
  const { chromium, _electron } = createRequire(join(input.root, "desktop/package.json"))("playwright");
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
    if (nativeApp) {
      const mainPath = join(assets, "main.cjs");
      const main = await readFile(mainPath, "utf8");
      if (main !== await readFile(join(input.root, "dist/agent-window/main.cjs"), "utf8")) throw new Error("Staged main process differs from current build");
      await writeFile(mainPath, applyLoginItemShim(main));
      execFileSync("codesign", ["--force", "--deep", "--sign", "-", nativeApp], { stdio: "ignore", timeout: 120_000 });
      // Code-OSS appends its IPC socket name; macOS permits only 103 bytes.
      const profile = join(input.stateDir, "u");
      const home = join(input.stateDir, "h");
      await mkdir(join(profile, "User"), { recursive: true });
      await mkdir(home, { recursive: true });
      await writeFile(join(profile, "User/settings.json"), JSON.stringify({ "cedia.hostStateDir": input.stateDir, "update.mode": "none", "telemetry.telemetryLevel": "off", "extensions.autoCheckUpdates": false, "security.workspace.trust.enabled": false }));
      browser = await _electron.launch({ executablePath: join(nativeApp, "Contents/MacOS/Cedia"),
        args: ["--user-data-dir", profile, "--password-store=basic", "--use-inmemory-secretstorage", "--skip-welcome", "--skip-release-notes"],
        env: { ...process.env, HOME: home, CEDIA_STATE_DIR: input.stateDir,
          CEDIA_HOST_NODE: process.env.CEDIA_HOST_NODE ?? "/Users/pond/.caret-tools/node-v24.18.0-darwin-arm64/bin/node",
          CEDIA_LIFECYCLE_SHIM_LOG: join(output, "login-item-shim.jsonl"), CEDIA_HOST_REQUEST_TIMEOUT_MS: "180000" }, timeout: 45_000 });
    } else browser = await chromium.launch({ headless: true, channel: "chrome" });
    const page = nativeApp ? await browser.firstWindow() : await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
    page.on("pageerror", (error: Error) => errors.push(error.message));
    page.on("console", (message: { type(): string; text(): string }) => { if (message.type() === "error") errors.push(message.text()); });
    if (!nativeApp) {
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
    }
    try {
      if (!nativeApp) await page.goto(server.url.toString(), { waitUntil: "networkidle", timeout: 30_000 });
      await page.getByText(input.sessionTitle, { exact: true }).last().click({ timeout: 20_000 });
      if (input.composer) {
        // Cold native startup hydrates the task draft while loading its model
        // catalog. Do not type into that transient draft before the fixture's
        // selected model has reached the composer.
        await page.getByText("Cedia queue smoke fixture", { exact: true }).waitFor({ timeout: 30_000 });
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
        for (const [index, text] of [input.composer.firstText, input.queuedText, ...(input.execution ? [input.execution.thirdText] : [])].entries()) {
          const attachment = input.execution?.attachments
            ? index === 0 ? input.execution.attachments.first : index === 1 ? input.execution.attachments.second : undefined
            : undefined;
          if (attachment) {
            await page.locator("[data-composer-extras-trigger]").click({ timeout: 20_000 });
            await page.locator("[data-testid='composer-file-input']").setInputFiles({
              name: attachment.name,
              mimeType: attachment.mimeType,
              buffer: Buffer.from(attachment.base64, "base64"),
            });
            await page.getByRole("button", { name: `Remove ${attachment.name}`, exact: true }).waitFor({ timeout: 20_000 });
          }
          const editor = page.locator('[contenteditable="true"]').first();
          if (input.execution?.attachments) {
            // The picker resolves before the controlled editor finishes its draft update.
            // Exercise keyboard input after the attachment chip mounts, not a synthetic
            // whole-value replacement racing that update.
            await editor.fill("");
            await editor.pressSequentially(text);
          } else {
            await editor.fill(text);
          }
          if (index === 0) await page.getByRole("button", { name: "Send message", exact: true }).click({ timeout: 20_000 });
          else await page.locator('[contenteditable="true"]').first().press("Enter");
          await page.waitForFunction((count: number) => (window as any).__queueSubmissions[count - 1]?.proofSettled === true, index + 1, { timeout: 20_000 });
          const commands = await page.evaluate(() => (window as any).__queueSubmissions);
          if (commands.length !== index + 1) throw new Error("Composer dispatched a duplicate turn");
          if (input.execution?.attachments) {
            const submittedMessage = commands[index]?.message as Record<string, unknown> | undefined;
            if (submittedMessage?.text !== text) throw new Error(`Composer dispatch ${index + 1} did not preserve the entered text`);
            const submittedAttachments = submittedMessage?.attachments;
            const submittedCount = Array.isArray(submittedAttachments) ? submittedAttachments.length : 0;
            const expectedCount = index < 2 ? 1 : 0;
            if (submittedCount !== expectedCount) throw new Error(`Composer dispatch ${index + 1} carried ${submittedCount} attachments; expected ${expectedCount}`);
          }
          await input.composer.onSubmitted(commands[index].commandId, index === 0 ? "running" : "queued");
          await page.getByRole("button", { name: "Stop generation", exact: true }).waitFor({ timeout: 20_000 });
          await page.waitForFunction(() => document.querySelector('[contenteditable="true"]')?.textContent?.trim() === "", undefined, { timeout: 20_000 });
          if (attachment) await page.getByRole("button", { name: `Remove ${attachment.name}`, exact: true }).waitFor({ state: "hidden", timeout: 20_000 });
        }
      }
      await page.getByText("Task controls", { exact: true }).click();
      const panel = page.getByTestId("cedia-queue-surface");
      await panel.getByRole("region", { name: "Follow-up", exact: true }).getByText(input.queuedText, { exact: true }).waitFor({ timeout: 20_000 });
      if (input.execution) {
        await panel.getByRole("region", { name: "Follow-up", exact: true }).getByText(input.execution.thirdText, { exact: true }).waitFor({ timeout: 20_000 });
        await page.screenshot({ path: join(output, "queued.png"), fullPage: true });
        const receipt = await input.execution.finish(page);
        await panel.getByText("Nothing queued", { exact: true }).waitFor({ timeout: 20_000 });
        const messageRows = page.locator("[data-message-id]");
        for (const text of [input.composer!.firstText, input.queuedText, input.execution.thirdText, ...input.execution.replies]) {
          await messageRows.getByText(text, { exact: true }).waitFor({ timeout: 20_000 });
          if (await messageRows.getByText(text, { exact: true }).count() !== 1) throw new Error(`Transcript duplicates: ${text}`);
        }
        const assertTranscriptImages = async (phase: string) => {
          const fixtures = input.execution?.attachments;
          if (!fixtures) return [];
          const expected = [fixtures.first, fixtures.second, undefined];
          const texts = [input.composer!.firstText, input.queuedText, input.execution!.thirdText];
          const userRows = page.locator("[data-message-id][data-message-role='user']");
          const evidence: Record<string, unknown>[] = [];
          for (const [index, text] of texts.entries()) {
            const row = userRows.filter({ hasText: text }).first();
            await row.waitFor({ timeout: 20_000 });
            const images = row.locator("img");
            const expectedFixture = expected[index];
            const count = await images.count();
            const expectedCount = expectedFixture ? 1 : 0;
            if (count !== expectedCount) throw new Error(`${phase} transcript row ${index + 1} has ${count} image thumbnails; expected ${expectedCount}`);
            if (!expectedFixture) {
              evidence.push({ text, imageCount: count });
              continue;
            }
            const source = await images.first().getAttribute("src");
            if (!source) throw new Error(`${phase} transcript row ${index + 1} image has no source URL`);
            const decoded = await decodeQueueImagePair(page, source, expectedFixture);
            if (!queuePixelsMatch(decoded.actual.pixel, decoded.expected.pixel)) throw new Error(`${phase} transcript row ${index + 1} thumbnail pixel does not match ${expectedFixture.name}: ${JSON.stringify({ actual: decoded.actual.pixel, expected: decoded.expected.pixel })}`);
            evidence.push({ text, imageCount: count, decoded: { naturalWidth: decoded.actual.width, naturalHeight: decoded.actual.height, pixel: decoded.actual.pixel, src: source } });
          }
          return evidence;
        };
        const transcriptImages = await assertTranscriptImages("completed");
        // LegendList recycles DOM children: insertion order is not visual order.
        // Read actual row positions, retaining the independent unique-text gates.
        const visualRows = await messageRows.evaluateAll((rows: HTMLElement[]) => rows.map(row => ({
          text: row.innerText, top: row.getBoundingClientRect().top,
        })).sort((left, right) => left.top - right.top));
        const transcript = visualRows.map((row: { text: string }) => row.text).join("\n");
        let previousPosition = -1;
        for (const text of [input.composer!.firstText, input.execution.replies[0]!, input.queuedText, input.execution.replies[1]!, input.execution.thirdText, input.execution.replies[2]!]) {
          const position = transcript.indexOf(text);
          if (position <= previousPosition) throw new Error(`Transcript is out of execution order: ${text}`);
          previousPosition = position;
        }
        await page.getByRole("button", { name: "Stop generation", exact: true }).waitFor({ state: "hidden", timeout: 20_000 });
        await page.getByText("Task controls", { exact: true }).click();
        await messageRows.getByText(input.composer!.firstText, { exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(output, "completed.png"), fullPage: true });
        const submissions = await page.evaluate(() => (window as any).__queueSubmissions);
        await input.execution.capture?.(output);
        let restoredImages: Record<string, unknown>[] = [];
        if (input.execution.attachments) {
          await page.reload({ waitUntil: nativeApp ? "domcontentloaded" : "networkidle", timeout: 30_000 });
          await page.getByText(input.sessionTitle, { exact: true }).last().click({ timeout: 20_000 });
          restoredImages = await assertTranscriptImages("reloaded");
          await page.screenshot({ path: join(output, "reloaded.png"), fullPage: true });
          await input.execution.afterReload?.();
        }
        await input.execution.validate?.();
        if (submissions.length !== 3 || errors.length) throw new Error(`Execution proof failed: ${JSON.stringify({ submissions, errors })}`);
        return { body: receipt, commandId: undefined, output, assets, nativeApp, assetSha256, errors, submissions,
          transcript: { text: transcript, visualRows, orderedUniqueMessages: 6, stopControlHidden: true, ...(input.execution.attachments ? { images: transcriptImages, restoredImages } : {}) } };
      }
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
      return { body: drops[0].answer, commandId: drops[0].args[1].commandId, output, assets, nativeApp, assetSha256, errors, submissions };
    } catch (error) {
      await page.screenshot({ path: join(output, "failure.png"), fullPage: true }).catch(() => {});
      await writeFile(join(output, "failure.json"), JSON.stringify({ error: String(error), errors, browser: await page.evaluate(() => ({ text: document.body.innerText, submissions: (window as any).__queueSubmissions })) }, null, 2)).catch(() => {});
      await input.execution?.capture?.(output);
      throw error;
    }
  } finally {
    // This is a disposable proof profile, not normal user quit/lifecycle
    // acceptance. Exit the staged Electron instance without its running-task
    // confirmation; the outer smoke still owns and closes the fixture host.
    if (nativeApp && browser) await browser.evaluate(({ app }: any) => app.exit(0)).catch(() => {});
    await browser?.close();
    server.stop(true);
  }
}
