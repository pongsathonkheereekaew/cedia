import { playwright } from "@vitest/browser-playwright";
import { defineConfig, mergeConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

import appConfig from "../../../../vite.config";

export default mergeConfig(
  appConfig,
  defineConfig({
    root: fileURLToPath(new URL(".", import.meta.url)),
    test: {
      include: ["src/components/chat/useChatTurnExecution.browser.tsx"],
      browser: {
        enabled: true,
        provider: playwright({ launchOptions: { channel: "chrome" } }),
        instances: [{ browser: "chromium" }],
        headless: true,
      },
    },
  }),
);
