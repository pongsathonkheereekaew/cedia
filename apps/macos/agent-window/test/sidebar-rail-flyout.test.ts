import { describe, expect, it } from "bun:test";

import {
  canOpenRailFlyout,
  shouldCloseRailFlyout,
  type RailFlyoutEnvironment,
} from "../vendor/synara/apps/web/src/components/Sidebar.railFlyout.logic";

const collapsed: RailFlyoutEnvironment = {
  isOnSettings: false,
  isMobile: false,
  state: "collapsed",
};

describe("sidebar rail flyout lifecycle", () => {
  it("only opens Threads and Projects from the collapsed desktop rail", () => {
    expect(canOpenRailFlyout("threads", collapsed)).toBe(true);
    expect(canOpenRailFlyout("projects", collapsed)).toBe(true);
    expect(canOpenRailFlyout("threads", { ...collapsed, state: "expanded" })).toBe(false);
    expect(canOpenRailFlyout("projects", { ...collapsed, state: "expanded" })).toBe(false);
  });

  it("keeps More available as a menu while the panel is expanded", () => {
    expect(canOpenRailFlyout("more", { ...collapsed, state: "expanded" })).toBe(true);
    expect(canOpenRailFlyout("more", { ...collapsed, isOnSettings: true })).toBe(true);
    expect(canOpenRailFlyout("more", { ...collapsed, isMobile: true })).toBe(false);
  });

  it("suppresses Threads and Projects hover on Settings", () => {
    const environment = { ...collapsed, isOnSettings: true };
    expect(canOpenRailFlyout("threads", environment)).toBe(false);
    expect(canOpenRailFlyout("projects", environment)).toBe(false);
    expect(
      shouldCloseRailFlyout({
        pathnameChanged: false,
        flyout: { section: "threads" },
        environment,
      }),
    ).toBe(true);
  });

  it("closes a pinned flyout when the route changes or the layout becomes mobile", () => {
    expect(
      shouldCloseRailFlyout({
        pathnameChanged: true,
        flyout: { section: "more" },
        environment: collapsed,
      }),
    ).toBe(true);
    expect(
      shouldCloseRailFlyout({
        pathnameChanged: false,
        flyout: { section: "threads" },
        environment: { ...collapsed, isMobile: true },
      }),
    ).toBe(true);
  });
});
