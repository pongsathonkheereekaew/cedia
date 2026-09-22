// Builds the React 19 Synara renderer in its isolated workspace, then emits
// the small Node-side bridge used by the macOS host. The Vite build owns the
// directory cleanup; the Bun build runs second and only adds main.cjs.

import { mkdir, copyFile, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const agentWindowRoot = path.join(repoRoot, "apps/macos/agent-window");
const outputRoot = path.join(repoRoot, "dist/agent-window");

if (!existsSync(path.join(agentWindowRoot, "node_modules/.bin/vite"))) {
  await run("bun", ["install", "--ignore-scripts", "--no-save", "--no-progress"], agentWindowRoot);
}

function run(command: string, args: readonly string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed (${signal ?? `exit ${code ?? "unknown"}`})`));
    });
  });
}

await run("bun", ["run", "build"], agentWindowRoot);

await mkdir(outputRoot, { recursive: true });
const bridgeResult = await Bun.build({
  // The Electron-main half only. Bundling `agent-window-main.ts` here would pull
  // the shared gateway into an entrypoint that does not need it; bundling it into
  // the *extension* (which `apps/macos/src/extension.ts` does through
  // `agent-ide-webview.ts`) is what this split exists to prevent.
  entrypoints: [path.join(repoRoot, "apps/macos/src/agent-window-bridge.ts")],
  outdir: outputRoot,
  naming: "main.cjs",
  target: "node",
  format: "cjs",
  minify: false,
  sourcemap: "none",
  // The bridge runs inside Electron main: bare require("electron") must stay a
  // runtime require instead of being bundled.
  external: ["electron"],
});

if (!bridgeResult.success) {
  const diagnostics = bridgeResult.logs
    .map((log) => log.message)
    .filter(Boolean)
    .join("\n");
  throw new Error(`Agent Window bridge build failed${diagnostics ? `:\n${diagnostics}` : "."}`);
}

await copyFile(path.join(agentWindowRoot, "vendor/synara/LICENSE"), path.join(outputRoot, "SYNARA-LICENSE.txt"));
await cp(path.join(agentWindowRoot, "vendor/synara/apps/server/native/device-helper"), path.join(outputRoot, "native/device-helper"), { recursive: true });

console.log(`Agent Window assets written to ${path.relative(repoRoot, outputRoot)}`);
