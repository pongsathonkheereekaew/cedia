import { describe, expect, it } from "bun:test";
import { orderedSettings } from "../../../upstream/omp/packages/coding-agent/src/config/all-settings.ts";
import { ompSettingDisposition } from "../src/omp-settings.ts";

// S1 inventory guard (§6.4.1): the live OMP registry is the key authority, not a
// hand-maintained list. This test fails when a new source key has no Cedia
// disposition, and proves the seven native OMP paths are discoverable rather
// than excluded as other-harness settings.
describe("OMP settings inventory (live registry)", () => {
  it("enumerates the live registry with unique paths", () => {
    const rows = orderedSettings();
    expect(rows.length).toBeGreaterThan(500);
    const ids = rows.map(row => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps the seven native OMP paths discoverable (not excluded)", () => {
    const byId = new Map(orderedSettings().map(row => [row.id, row]));
    const native = [
      "enabledProviders",
      "disabledProviders",
      "modelProviderOrder",
      "providers.antigravityEndpoint",
      "searxng.endpoint",
      "compaction.remoteEndpoint",
      "dev.autoqaPush.endpoint",
    ];
    for (const id of native) {
      const row = byId.get(id);
      expect(row).toBeDefined();
      const key = {
        path: id,
        type: String((row as { type?: unknown }).type ?? "string"),
        credential: Boolean((row as { isCredential?: unknown }).isCredential),
        ui: Boolean((row as { ui?: unknown }).ui),
        projectWritable: false,
      };
      const { disposition } = ompSettingDisposition(key);
      expect(disposition).not.toBe("excluded");
    }
  });

  it("excludes only explicit product paths (S1b), keeping TTS/marketplace/vault/blob-ssh writable", () => {
    const byId = new Map(orderedSettings().map(row => [row.id, row]));
    const excluded = [
      "live.voice",
      "stt.enabled",
      "stt.language",
      "stt.submitTrigger",
      "collab.relayUrl",
      "collab.webUrl",
      "collab.displayName",
      "collab.autoStart",
      "update.channel",
      "startup.checkUpdate",
      "providers.tinyModelDevice",
      "providers.tinyModelDtype",
      "auth.broker.url",
    ];
    for (const id of excluded) {
      expect(byId.has(id)).toBe(true);
      const row = byId.get(id);
      if (!row) throw new Error(`live registry is missing ${id}`);
      const { disposition } = ompSettingDisposition({
        path: id,
        type: String((row as { type?: unknown }).type ?? "string"),
        credential: Boolean((row as { isCredential?: unknown }).isCredential),
        ui: Boolean((row as { ui?: unknown }).ui),
        projectWritable: false,
      });
      expect(disposition).toBe("excluded");
    }
    // Deliberately kept writable: TTS output, extension marketplace, Obsidian vault,
    // blob-broker SSH fields, and the S1a-unblocked native endpoints.
    const writable = [
      "speech.voice",
      "tts.localVoice",
      "marketplace.autoUpdate",
      "vault.enabled",
      "images.urls.sshTarget",
      "images.urls.sshRemotePort",
      "searxng.endpoint",
      "providers.antigravityEndpoint",
    ];
    for (const id of writable) {
      expect(byId.has(id)).toBe(true);
      const row = byId.get(id);
      if (!row) throw new Error(`live registry is missing ${id}`);
      const { disposition } = ompSettingDisposition({
        path: id,
        type: String((row as { type?: unknown }).type ?? "string"),
        credential: Boolean((row as { isCredential?: unknown }).isCredential),
        ui: Boolean((row as { ui?: unknown }).ui),
        projectWritable: false,
      });
      expect(disposition).not.toBe("excluded");
    }
  });

  it("keeps modelPresets discoverable despite no TUI row, and credentials protected", () => {
    const byId = new Map(orderedSettings().map(row => [row.id, row]));
    expect(byId.has("modelPresets")).toBe(true);
    expect(byId.has("ratchet.enabled")).toBe(true);
    expect(byId.has("display.subagentLivePreview")).toBe(true);
    expect(byId.has("input.bareExitOnEmptySession")).toBe(true);
    expect(byId.has("input.bareSlashCommands")).toBe(true);
    expect(byId.has("browser.tern")).toBe(true);
    const broker = byId.get("auth.broker.token");
    expect(Boolean(broker?.isCredential)).toBe(true);
    const { disposition } = ompSettingDisposition({
      path: "auth.broker.token",
      type: "string",
      credential: true,
      ui: false,
      projectWritable: false,
    });
    expect(disposition).toBe("protected");
  });
});
