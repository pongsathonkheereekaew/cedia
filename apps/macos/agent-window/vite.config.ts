import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const agentWindowRoot = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(agentWindowRoot, "vendor/synara/apps/web");
const webSource = path.join(webRoot, "src");
const contractsSource = path.join(agentWindowRoot, "vendor/synara/packages/contracts/src");
const sharedSource = path.join(agentWindowRoot, "vendor/synara/packages/shared/src");
const outputRoot = path.resolve(agentWindowRoot, "../../../dist/agent-window");

/**
 * Cedia loads this bundle from a vscode-file/file URL. Keep the web app's
 * production route tree and CSS intact while making every generated asset
 * reference relative to index.html.
 */
export default defineConfig({
  root: agentWindowRoot,
  base: "./",
  publicDir: path.join(webRoot, "public"),
  plugins: [
    tanstackRouter({
      routesDirectory: path.join(agentWindowRoot, "vendor/synara/apps/web/src/routes"),
      generatedRouteTree: path.join(agentWindowRoot, "vendor/synara/apps/web/src/routeTree.gen.ts"),
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: [
      { find: /^~\//, replacement: `${webSource}/` },
      { find: "@synara/contracts", replacement: path.join(contractsSource, "index.ts") },
      { find: /^@synara\/shared\/(.+)$/, replacement: `${sharedSource}/$1` },
    ],
  },
  define: {
    "import.meta.env.VITE_WS_URL": JSON.stringify(process.env.VITE_WS_URL ?? ""),
    "import.meta.env.APP_VERSION": JSON.stringify("cedia-agent-window"),
  },
  build: {
    outDir: outputRoot,
    emptyOutDir: true,
    assetsDir: "assets",
    sourcemap: false,
    chunkSizeWarningLimit: 850,
    rollupOptions: {
      input: {
        agents: path.join(agentWindowRoot, "index.html"),
        ide: path.join(agentWindowRoot, "ide.html"),
      },
    },
  },
});
