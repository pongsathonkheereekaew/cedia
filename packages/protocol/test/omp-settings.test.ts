import { describe, expect, it } from "bun:test";
import {
  OmpSettingsValidationError,
  parseOmpSettingsContext,
  parseOmpSettingsKey,
  parseOmpSettingsMutation,
  parseOmpSettingsValue,
} from "../src/index.ts";

describe("OMP settings scope parsers", () => {
  it("carries schema metadata without values in a key", () => {
    const key = parseOmpSettingsKey({
      path: "searxng.endpoint",
      type: "string",
      credential: false,
      ui: true,
      tab: "providers",
      projectWritable: false,
      label: "SearXNG Endpoint",
      description: "Base URL of a self-hosted SearXNG instance",
      group: "Services",
      envVar: "SEARXNG_ENDPOINT",
    });
    expect(key).toMatchObject({ label: "SearXNG Endpoint", group: "Services", envVar: "SEARXNG_ENDPOINT" });
    expect(Object.hasOwn(key, "value")).toBe(false);
  });

  it("reports legacy answers without scope as session scope", () => {
    const legacy = parseOmpSettingsValue({
      path: "cycleOrder",
      credential: false,
      redacted: false,
      configured: true,
      value: ["a"],
      settingsRevision: "rev-1",
    });
    expect(legacy.scope).toBe("session");
    const scoped = parseOmpSettingsValue({
      path: "cycleOrder",
      credential: false,
      redacted: false,
      configured: true,
      value: ["a"],
      settingsRevision: "rev-1",
      scope: "global",
      provenance: "global",
      storedGlobal: ["a"],
      defaultJson: ["smol", "default", "slow"],
    });
    expect(scoped).toMatchObject({ scope: "global", provenance: "global", storedGlobal: ["a"] });
  });

  it("keeps redaction invariants for stored layers", () => {
    const redacted = {
      path: "auth.broker.token",
      credential: true,
      redacted: true,
      configured: false,
      settingsRevision: "rev-1",
    };
    expect(parseOmpSettingsValue(redacted).scope).toBe("session");
    expect(() => parseOmpSettingsValue({ ...redacted, storedGlobal: "sk-x" })).toThrow(OmpSettingsValidationError);
    expect(() => parseOmpSettingsValue({ ...redacted, scope: "zone" })).toThrow(OmpSettingsValidationError);
    expect(() => parseOmpSettingsValue({ ...redacted, provenance: "file" })).toThrow(OmpSettingsValidationError);
  });

  it("parses contexts and refuses session mutations", () => {
    expect(parseOmpSettingsContext({ scope: "global" })).toEqual({ scope: "global" });
    expect(parseOmpSettingsContext({ scope: "project", projectId: "p1" })).toEqual({ scope: "project", projectId: "p1" });
    expect(() => parseOmpSettingsContext({ scope: "project" })).toThrow(OmpSettingsValidationError);
    expect(() => parseOmpSettingsContext({ scope: "project", projectId: "/etc/passwd", extra: 1 })).toThrow(
      OmpSettingsValidationError,
    );
    const mutation = parseOmpSettingsMutation({
      context: { scope: "project", projectId: "p1" },
      expectedRevision: "rev-1",
      changes: [
        { path: "cycleOrder", operation: "set", value: ["x"] },
        { path: "cycleOrder", operation: "unset" },
      ],
    });
    expect(mutation.changes.length).toBe(2);
    expect(() =>
      parseOmpSettingsMutation({ context: { scope: "session", sessionId: "s1" }, changes: [{ path: "a", operation: "unset" }] }),
    ).toThrow(/never targets a session/);
    expect(() =>
      parseOmpSettingsMutation({ context: { scope: "global" }, changes: [{ path: "a", operation: "unset", value: 1 }] }),
    ).toThrow(OmpSettingsValidationError);
    expect(() =>
      parseOmpSettingsMutation({ context: { scope: "global" }, changes: [{ path: "a", operation: "set" }] }),
    ).toThrow(/needs a value/);
  });
});
