import { expect, it } from "bun:test";
import {
  capabilityLabel,
  capabilityState,
  isCapabilityVisible,
  parseCapabilitySnapshot,
} from "../vendor/synara/apps/web/src/capabilityGate";
import { sidebarNavItemVisible } from "../vendor/synara/apps/web/src/sidebarNavOrdering";
import { SIDEBAR_NAV_CAPABILITY_IDS } from "../vendor/synara/apps/web/src/sidebarNavOrdering";
import {
  normalizeSettingsSection,
  resolveSettingsSection,
  settingsSectionVisible,
  SETTINGS_NAV_ITEMS,
  SETTINGS_SECTION_CAPABILITY_IDS,
  SETTINGS_SECTION_IDS,
} from "../vendor/synara/apps/web/src/settingsNavigation";
import { rankSettingsSearchEntries } from "../vendor/synara/apps/web/src/settingsSearchIndex";

const snapshot = {
  protocolVersion: 1,
  revision: "cedia-capabilities-v1",
  capabilities: [
    { id: "omp.execution", availability: "available", scope: "session", operations: ["send"] },
    { id: "omp.settings", availability: "integration_missing", scope: "global", reason: "not installed yet", operations: [] },
    { id: "app.automations", availability: "integration_missing", scope: "app", reason: "no automation backend", operations: [] },
    { id: "future.thing", availability: "something_new", operations: [] },
    { availability: "available" },
    "not a row",
  ],
};

it("parses only the recognisable host rows and never invents one", () => {
  expect(parseCapabilitySnapshot(snapshot)).toEqual([
    { id: "omp.execution", availability: "available", scope: "session" },
    { id: "omp.settings", availability: "integration_missing", scope: "global", reason: "not installed yet" },
    { id: "app.automations", availability: "integration_missing", scope: "app", reason: "no automation backend" },
  ]);
  expect(parseCapabilitySnapshot({ capabilities: "no" })).toBeUndefined();
  expect(parseCapabilitySnapshot(null)).toBeUndefined();
  expect(parseCapabilitySnapshot(undefined)).toBeUndefined();
});

it("maps host availability to a row state, keeping unknown distinct from missing", () => {
  const parsed = parseCapabilitySnapshot(snapshot);
  expect(capabilityState(parsed, "omp.execution")).toBe("available");
  expect(capabilityState(parsed, "omp.settings")).toBe("missing");
  expect(capabilityState(parsed, "future.thing")).toBe("unknown");
  expect(capabilityState(parsed, "not.advertised")).toBe("unknown");
  expect(capabilityState(undefined, "omp.settings")).toBe("unknown");
  expect(capabilityState(parsed, undefined)).toBe("unknown");
});

it("hides only what the host says is integration-missing", () => {
  expect(isCapabilityVisible("missing")).toBe(false);
  expect(isCapabilityVisible("available")).toBe(true);
  expect(isCapabilityVisible("blocked")).toBe(true);
  expect(isCapabilityVisible("unknown")).toBe(true);
});

it("takes the gated sidebar row out only on an explicit host answer", () => {
  const parsed = parseCapabilitySnapshot(snapshot);
  expect(sidebarNavItemVisible("automations", parsed)).toBe(false);
  expect(sidebarNavItemVisible("automations", undefined)).toBe(true);
  expect(sidebarNavItemVisible("automations", [{ id: "app.automations", availability: "available" }])).toBe(true);
  // The core rows are not gated on a host capability at all.
  expect(sidebarNavItemVisible("newThread", parsed)).toBe(true);
});

it("names the known host capabilities and falls back to the id", () => {
  expect(capabilityLabel("omp.execution")).toBe("OMP execution and control");
  expect(capabilityLabel("something.else")).toBe("something.else");
});

it("gates rows only on capability ids the host actually advertises", async () => {
  // A row bound to an id the host never sends would silently keep its old behaviour
  // forever, so the two sides are pinned to each other here.
  const host = await Bun.file(new URL("../../../host/src/capabilities.ts", import.meta.url)).text();
  for (const id of Object.values(SIDEBAR_NAV_CAPABILITY_IDS)) {
    expect(host).toContain(`id: "${id}"`);
  }
});

it("offers the capability status destination and keeps unknown deep links on general", () => {
  const item = SETTINGS_NAV_ITEMS.find(entry => entry.id === "status");
  expect(item).toMatchObject({ label: "Capability status" });
  expect(item?.description).toMatch(/not implemented yet/i);
  expect(SETTINGS_SECTION_IDS).toContain("status");
  expect(normalizeSettingsSection("status")).toBe("status");
  expect(normalizeSettingsSection("automations-status-page")).toBe("general");
  expect(normalizeSettingsSection(undefined)).toBe("general");
});

it("gates a settings destination the same way as a sidebar row", () => {
  const missing = parseCapabilitySnapshot({ capabilities: [{ id: "omp.settings", availability: "integration_missing", reason: "not wired" }] });
  expect(settingsSectionVisible("omp", missing)).toBe(false);
  // Core destinations carry no capability id, so no snapshot can remove them.
  expect(settingsSectionVisible("general", missing)).toBe(true);
  // A capability that needs setup keeps its destination: the panel has to explain itself (§2.8).
  const needsSetup = parseCapabilitySnapshot({ capabilities: [{ id: "omp.settings", availability: "dependency_unavailable", reason: "no runtime" }] });
  expect(settingsSectionVisible("omp", needsSetup)).toBe(true);
  expect(settingsSectionVisible("omp", undefined)).toBe(true);
});

it("falls back out of a deep link into a destination the host reports as missing", () => {
  const missing = parseCapabilitySnapshot({ capabilities: [{ id: "omp.settings", availability: "integration_missing", reason: "not wired" }] });
  expect(resolveSettingsSection("omp", missing)).toBe("general");
  expect(resolveSettingsSection("omp", undefined)).toBe("omp");
  expect(resolveSettingsSection("models", missing)).toBe("providers");
  expect(resolveSettingsSection("not-a-section", missing)).toBe("general");
});

it("keeps search results out of a destination that is gone", () => {
  const missing = parseCapabilitySnapshot({ capabilities: [{ id: "omp.settings", availability: "integration_missing", reason: "not wired" }] });
  const open = rankSettingsSearchEntries("omp", 12);
  expect(open.some(entry => entry.section === "omp")).toBe(true);
  expect(rankSettingsSearchEntries("omp", 12, missing).some(entry => entry.section === "omp")).toBe(false);
  // A query for a section that is still there is unaffected.
  expect(rankSettingsSearchEntries("appearance", 12, missing).some(entry => entry.section === "appearance")).toBe(true);
});

it("binds every gated settings destination to a capability the host advertises", async () => {
  const host = await Bun.file(new URL("../../../host/src/capabilities.ts", import.meta.url)).text();
  for (const id of Object.values(SETTINGS_SECTION_CAPABILITY_IDS)) {
    expect(host).toContain(`id: "${id}"`);
  }
});
