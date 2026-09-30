import { defineConfig, mergeConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import appConfig from '../../../../vite.config';
export default mergeConfig(appConfig, defineConfig({
  test: {
    include: [
      'vendor/synara/apps/web/src/components/chat/ComposerModelPickerTabs.browser.tsx',
      'vendor/synara/apps/web/src/components/settings/ProvidersSettingsPanel.browser.tsx',
      'vendor/synara/apps/web/src/hooks/useProviderModelCatalog.browser.tsx',
    ],
    browser: { enabled: true, provider: playwright({ launchOptions: { channel: 'chrome' } }), instances: [{ browser: 'chromium' }], headless: true },
  },
}));
