import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createOmpModelCatalog } from "../src/model-catalog.ts";

const fixture = `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import readline from "node:readline";

const args = process.argv.slice(2);
if (process.env.CATALOG_TRACE) appendFileSync(process.env.CATALOG_TRACE, JSON.stringify({ args, cwd: process.cwd() }) + "\\n");
const emit = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
if (args.includes("models")) {
  process.stdout.write(JSON.stringify({ models: [
    { provider: "opencode-go", id: "muse-spark-1.3-contributor", selector: "opencode-go/muse-spark-1.3-contributor", name: "Muse Spark 1.3 Contributor", contextWindow: 65536, maxTokens: 8192, reasoning: true, thinking: ["low", "high"], input: ["text"] },
  ] }));
  process.exit(0);
}
emit({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1, 2], maxFrameBytes: 1024 * 1024, maxReassembledFrameBytes: 64 * 1024 * 1024 });
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  let command;
  try { command = JSON.parse(line); } catch { return; }
  if (command.type === "negotiate_protocol") {
    emit({ type: "response", command: command.type, id: command.id, success: true, data: { protocolVersion: 2 } });
  } else if (command.type === "get_available_models") {
  if (process.env.CATALOG_OVERFLOW === "1") {
    emit({ type: "response", command: command.type, id: command.id, success: false, error: "RPC response exceeded the transport limit" });
    return;
  }
  if (process.env.CATALOG_REFUSE === "1") {
    emit({ type: "response", command: command.type, id: command.id, success: false, error: "Model catalog is unavailable" });
    return;
  }
  emit({ type: "response", command: command.type, id: command.id, success: true, data: { models: [
      { id: "deepseek-v4", provider: "openrouter", label: "DeepSeek V4", upstreamProviderName: "OpenRouter", thinking: { efforts: ["low", "high"], mode: "effort" }, contextWindow: 128000, maxTokens: 4096 },
      { id: "claude-fable-5", provider: "commandcode", name: "Claude Fable 5", reasoning: true, thinking: ["low", "medium", "high", "xhigh", "max"], contextWindow: 1000000, maxTokens: 65536 },
      { id: "openrouter/deepseek-v4", provider: "openrouter", label: "DeepSeek V4 duplicate" },
      { id: "deepseek-v4", provider: "openrouter", label: "DeepSeek V4 duplicate 2" },
      { id: "deepseek-v4", provider: "commandcode", label: "DeepSeek V4 Command Code", maxOutputTokens: 8192 },
    ] } });
  }
});
`;

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), "cedia-model-catalog-"));
  const executable = join(root, "omp-fixture.mjs");
  const trace = join(root, "trace.ndjson");
  await writeFile(executable, fixture, { mode: 0o700 });
  await chmod(executable, 0o700);
  return { root, executable, trace };
}

describe("OMP model catalog", () => {
  it("discovers models without a saved session and normalizes provider-qualified rows", async () => {
    const { root, executable, trace } = await makeFixture();
    try {
      const catalog = createOmpModelCatalog({
        ompExecutable: executable,
        ompEnv: { ...process.env, CATALOG_TRACE: trace },
        cwd: root,
      });

      const result = await catalog.list();
      expect(result.source).toBe("omp");
      expect(result.cached).toBe(false);
      expect(result.models.map(model => model.slug)).toEqual([
        "openrouter/deepseek-v4",
        "commandcode/claude-fable-5",
        "commandcode/deepseek-v4",
      ]);
      expect(result.models[0]).toMatchObject({
        name: "DeepSeek V4",
        upstreamProviderId: "openrouter",
        upstreamProviderName: "OpenRouter",
        maxOutputTokens: 4096,
        contextWindow: 128000,
        supportedReasoningEfforts: [
          { value: "low", label: "low" },
          { value: "high", label: "high" },
        ],
      });
      expect(result.models[1]).toMatchObject({
        name: "Claude Fable 5",
        upstreamProviderId: "commandcode",
        upstreamProviderName: "commandcode",
        contextWindow: 1000000,
        maxOutputTokens: 65536,
        supportedReasoningEfforts: [
          { value: "low", label: "low" },
          { value: "medium", label: "medium" },
          { value: "high", label: "high" },
          { value: "xhigh", label: "xhigh" },
          { value: "max", label: "max" },
        ],
      });
      expect(result.models[2]).toMatchObject({
        upstreamProviderId: "commandcode",
        upstreamProviderName: "commandcode",
        maxOutputTokens: 8192,
      });

      const launches = (await readFile(trace, "utf8")).trim().split("\n").map(line => JSON.parse(line) as { args: string[]; cwd: string });
      expect(launches).toHaveLength(1);
      expect(launches[0]?.cwd).toBe(await realpath(root));
      expect(launches[0]?.args).toContain("--no-session");
      expect(launches[0]?.args).toContain("--no-skills");
      expect(launches[0]?.args).toContain("--no-rules");
      expect(launches[0]?.args).toContain("--no-extensions");
      expect(launches[0]?.args).toContain("--cwd");
      expect(launches[0]?.args[launches[0]!.args.indexOf("--cwd") + 1]).toBe(root);
      expect(launches[0]?.args).not.toContain("--session");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("single-flights concurrent reads and caches only successful catalogs", async () => {
    const { root, executable, trace } = await makeFixture();
    try {
      const catalog = createOmpModelCatalog({
        ompExecutable: executable,
        ompEnv: { ...process.env, CATALOG_TRACE: trace },
        cwd: root,
      });
      const [first, second] = await Promise.all([catalog.list(), catalog.list()]);
      const cached = await catalog.list();
      expect(first.cached).toBe(false);
      expect(second.cached).toBe(false);
      expect(cached.cached).toBe(true);
      expect(cached.models).toEqual(first.models);
      expect((await readFile(trace, "utf8")).trim().split("\n")).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("falls back to OMP's compact models JSON only when its RPC catalog is oversized", async () => {
    const { root, executable, trace } = await makeFixture();
    try {
      const catalog = createOmpModelCatalog({
        ompExecutable: executable,
        ompEnv: { ...process.env, CATALOG_TRACE: trace, CATALOG_OVERFLOW: "1" },
        cwd: root,
      });

      const result = await catalog.list();
      expect(result.models).toHaveLength(1);
      expect(result.models[0]).toMatchObject({
        provider: "opencode-go",
        id: "muse-spark-1.3-contributor",
        slug: "opencode-go/muse-spark-1.3-contributor",
        name: "Muse Spark 1.3 Contributor",
        contextWindow: 65536,
        maxOutputTokens: 8192,
        supportedReasoningEfforts: [
          { value: "low", label: "low" },
          { value: "high", label: "high" },
        ],
      });

      const launches = (await readFile(trace, "utf8")).trim().split("\n").map(line => JSON.parse(line) as { args: string[]; cwd: string });
      expect(launches).toHaveLength(2);
      expect(launches[0]?.args).not.toContain("models");
      expect(launches[1]?.args).toContain("models");
      expect(launches[1]?.args).toContain("--json");
      expect(launches[1]?.args).toContain("--no-session");
      expect(launches[1]?.args).toContain("--no-extensions");
      expect(launches[1]?.args).toContain("--cwd");
      expect(launches[1]?.cwd).toBe(await realpath(root));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not hide ordinary OMP model-catalog failures behind the CLI fallback", async () => {
    const { root, executable, trace } = await makeFixture();
    try {
      const catalog = createOmpModelCatalog({
        ompExecutable: executable,
        ompEnv: { ...process.env, CATALOG_TRACE: trace, CATALOG_REFUSE: "1" },
        cwd: root,
      });

      await expect(catalog.list()).rejects.toThrow("Model catalog is unavailable");
      const launches = (await readFile(trace, "utf8")).trim().split("\n").map(line => JSON.parse(line) as { args: string[] });
      expect(launches).toHaveLength(1);
      expect(launches[0]?.args).not.toContain("models");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
