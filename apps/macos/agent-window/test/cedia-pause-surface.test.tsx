import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  RunPauseButtons,
} from "../vendor/synara/apps/web/src/components/chat/CediaRunPauseControl";
import {
  parseCediaPauseAnswer,
  serverPauseQueryOptions,
} from "../vendor/synara/apps/web/src/lib/serverReactQuery";

describe("Cedia run pause surface", () => {
  it("offers Pause while running and Resume with a badge while paused", () => {
    const running = renderToStaticMarkup(
      <RunPauseButtons
        paused={false}
        busy={false}
        onPause={() => undefined}
        onResume={() => undefined}
      />,
    );
    expect(running).toContain("Pause run");
    expect(running).not.toContain("Resume run");

    const parked = renderToStaticMarkup(
      <RunPauseButtons
        paused={true}
        busy={false}
        onPause={() => undefined}
        onResume={() => undefined}
      />,
    );
    expect(parked).toContain("Paused");
    expect(parked).toContain("Resume run");
    expect(parked).not.toContain("Pause run");
  });

  it("keeps pause parsing strict about the gate shape", () => {
    expect(parseCediaPauseAnswer({ state: "available", revision: 3, paused: true, pausedAt: 1790000000000 })).toEqual({
      state: "available",
      revision: 3,
      paused: true,
      pausedAt: 1790000000000,
    });
    expect(parseCediaPauseAnswer({ state: "available", revision: 3, paused: false })).toEqual({
      state: "available",
      revision: 3,
      paused: false,
    });
    expect(parseCediaPauseAnswer({ state: "unavailable", reason: "No OMP runtime is running" })).toEqual({
      state: "unavailable",
      reason: "No OMP runtime is running",
    });
    expect(() => parseCediaPauseAnswer({ state: "available", revision: 1, paused: "yes" })).toThrow();
    expect(() => parseCediaPauseAnswer({ state: "available", revision: 1, paused: true, pausedAt: -1 })).toThrow();
    expect(() => parseCediaPauseAnswer({ state: "available", revision: 0, paused: false })).toThrow();
    expect(() => parseCediaPauseAnswer({ state: "available", revision: 1, paused: false, extra: true })).toThrow();
  });

  it("does not configure a polling interval", () => {
    expect(serverPauseQueryOptions("session-pause").refetchInterval).toBeUndefined();
  });
});
