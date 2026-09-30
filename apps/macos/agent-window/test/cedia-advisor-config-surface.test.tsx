import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CediaAdvisorPanel,
  type CediaAdvisorConfigState,
} from "../vendor/synara/apps/web/src/components/chat/CediaAdvisorSurface";
import {
  parseCediaAdvisorConfigAnswer,
  serverAdvisorConfigQueryOptions,
} from "../vendor/synara/apps/web/src/lib/serverReactQuery";

const closed: CediaAdvisorConfigState = {
  scope: "project",
  answer: null,
  draft: "",
  busy: false,
  error: null,
  saved: null,
  editorOpen: false,
};

const openEditor: CediaAdvisorConfigState = {
  scope: "project",
  answer: {
    state: "available",
    revision: 2,
    scope: "project",
    path: "/task/WATCHDOG.yml",
    exists: true,
    text: "advisors:\n  - name: probe\n",
  },
  draft: "advisors:\n  - name: probe\n",
  busy: false,
  error: null,
  saved: null,
  editorOpen: true,
};

const idleAdvisor = {
  enabled: false,
  active: false,
  configured: false,
  contextWindow: 0,
  contextTokens: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  cost: 0,
  messages: { user: 0, assistant: 0, total: 0 },
  advisors: [],
  changed: false,
} as const;

const idle = { state: "available", revision: 1, advisor: idleAdvisor } as const;

describe("Cedia advisor config surface", () => {
  it("offers Configure without opening the editor", () => {
    const html = renderToStaticMarkup(<CediaAdvisorPanel state={idle} config={closed} />);
    expect(html).toContain("Configure advisors");
    expect(html).not.toContain("Advisor configuration");
  });

  it("renders scope tabs, the file path, and the draft text", () => {
    const html = renderToStaticMarkup(<CediaAdvisorPanel state={idle} config={openEditor} />);
    expect(html).toContain("Advisor configuration");
    expect(html).toContain("Project");
    expect(html).toContain("User");
    expect(html).toContain("/task/WATCHDOG.yml");
    expect(html).toContain("Save advisor config");
    expect(html).toContain("Cancel advisor config edit");
  });

  it("names a missing file instead of an empty editor", () => {
    const html = renderToStaticMarkup(
      <CediaAdvisorPanel
        state={idle}
        config={{
          ...openEditor,
          answer: { state: "available", revision: 2, scope: "user", path: "/agent/WATCHDOG.yml", exists: false, text: "" },
          scope: "user",
        }}
      />,
    );
    expect(html).toContain("No file at this level yet");
  });

  it("reports the applied roster and refuses loudly", () => {
    const saved = renderToStaticMarkup(
      <CediaAdvisorPanel state={idle} config={{ ...openEditor, saved: { scope: "project", advisors: 2 } }} />,
    );
    expect(saved).toContain("Saved project config");
    expect(saved).toContain("2 advisors active");

    const failed = renderToStaticMarkup(
      <CediaAdvisorPanel state={idle} config={{ ...openEditor, error: "advisor.config is not YAML: boom" }} />,
    );
    expect(failed).toContain("advisor.config is not YAML: boom");
  });

  it("keeps config parsing strict about the file shape", () => {
    expect(parseCediaAdvisorConfigAnswer({
      state: "available", revision: 1, scope: "project", path: "/p/WATCHDOG.yml", exists: true, text: "advisors: []\n", advisors: 0,
    })).toEqual({
      state: "available", revision: 1, scope: "project", path: "/p/WATCHDOG.yml", exists: true, text: "advisors: []\n", advisors: 0,
    });
    expect(parseCediaAdvisorConfigAnswer({ state: "unavailable", reason: "No OMP runtime is running" })).toEqual({
      state: "unavailable", reason: "No OMP runtime is running",
    });
    expect(() => parseCediaAdvisorConfigAnswer({ state: "available", revision: 1, scope: "global", path: "/p", exists: true, text: "" })).toThrow();
    expect(() => parseCediaAdvisorConfigAnswer({ state: "available", revision: 0, scope: "project", path: "/p", exists: true, text: "" })).toThrow();
    expect(() => parseCediaAdvisorConfigAnswer({ state: "available", revision: 1, scope: "project", path: "/p", exists: true, text: "", extra: true })).toThrow();
    expect(() => parseCediaAdvisorConfigAnswer({ state: "available", revision: 1, scope: "project", path: "/p", exists: true, text: "", advisors: -1 })).toThrow();
  });

  it("does not configure a polling interval", () => {
    expect(serverAdvisorConfigQueryOptions("session-config", "project").refetchInterval).toBeUndefined();
  });
});
