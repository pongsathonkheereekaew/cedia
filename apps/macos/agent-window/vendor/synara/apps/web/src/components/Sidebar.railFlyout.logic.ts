export type RailFlyoutSection = "threads" | "projects" | "more";

export type RailFlyoutEnvironment = {
  isOnSettings: boolean;
  isMobile: boolean;
  state: "expanded" | "collapsed";
};

/**
 * The persistent rail remains visible beside the expanded panel, but only the
 * More action can own a flyout there. Threads and Projects already have their
 * full content in the panel and would otherwise portal a duplicate sheet.
 */
export function canOpenRailFlyout(
  section: RailFlyoutSection,
  environment: RailFlyoutEnvironment,
): boolean {
  return (
    !environment.isMobile &&
    !(environment.isOnSettings && section !== "more") &&
    (environment.state === "collapsed" || section === "more")
  );
}

/**
 * Route and layout transitions invalidate a flyout. `pathnameChanged` is
 * passed explicitly so a pinned More menu cannot survive navigation to another
 * thread while the shell itself remains expanded.
 */
export function shouldCloseRailFlyout(input: {
  pathnameChanged: boolean;
  flyout: { section: RailFlyoutSection } | null;
  environment: RailFlyoutEnvironment;
}): boolean {
  if (input.pathnameChanged || input.flyout === null) {
    return input.pathnameChanged;
  }

  const { environment, flyout } = input;
  return (
    environment.isMobile ||
    (environment.isOnSettings && flyout.section !== "more") ||
    (environment.state !== "collapsed" && flyout.section !== "more")
  );
}
