import { defineConfig, mergeConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import appConfig from "../../../../vite.config";
export default mergeConfig(
  appConfig,
  defineConfig({
    optimizeDeps: {
      entries: [
        "vendor/synara/apps/web/src/components/chat/AgentRunTimelineRow.browser.tsx",
        "vendor/synara/apps/web/src/components/chat/CenterDockShare.browser.tsx",
        "vendor/synara/apps/web/src/components/chat/DockResize.browser.tsx",
        "vendor/synara/apps/web/src/components/chat/RightToolRail.browser.tsx",
        "vendor/synara/apps/web/src/lib/panelResize.browser.ts",
        "vendor/synara/apps/web/src/components/chat/PanelMotion.browser.tsx",
        "vendor/synara/apps/web/src/components/chat/TaskTabs.browser.tsx",
        "vendor/synara/apps/web/src/components/code-review/CodeReviewSurface.browser.tsx",
        "vendor/synara/apps/web/src/components/code-review/CodeReviewWorkspace.browser.tsx",
        "vendor/synara/apps/web/src/components/DiffPanelFileList.inlineComment.browser.tsx",
      ],
    },
    test: {
      // Geometry and pointer tests share a browser process. Serial files keep
      // heavy diff imports from starving frame/timing assertions.
      fileParallelism: false,
      include: [
        "vendor/synara/apps/web/src/components/chat/AgentRunTimelineRow.browser.tsx",
        "vendor/synara/apps/web/src/components/chat/CenterDockShare.browser.tsx",
        "vendor/synara/apps/web/src/components/chat/DockResize.browser.tsx",
        "vendor/synara/apps/web/src/components/chat/RightToolRail.browser.tsx",
        "vendor/synara/apps/web/src/components/LocalImagePreview.cedia.browser.tsx",
        "vendor/synara/apps/web/src/components/chat/PanelMotion.browser.tsx",
        "vendor/synara/apps/web/src/components/chat/TaskTabs.browser.tsx",
        "vendor/synara/apps/web/src/components/code-review/CodeReviewSurface.browser.tsx",
        "vendor/synara/apps/web/src/components/code-review/CodeReviewWorkspace.browser.tsx",
        "vendor/synara/apps/web/src/components/DiffPanelFileList.inlineComment.browser.tsx",
        "vendor/synara/apps/web/src/components/BrowserPanel.menuOcclusion.browser.tsx",
      ],
      browser: {
        enabled: true,
        provider: playwright({
          launchOptions: { channel: "chrome" },
          contextOptions: {
            reducedMotion:
              process.env.CEDIA_TEST_REDUCED_MOTION === "1"
                ? "reduce"
                : "no-preference",
          },
        }),
        instances: [{ browser: "chromium" }],
        headless: true,
      },
    },
  }),
);
