import "../../index.css";
import { page } from "vitest/browser";
import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "vitest-browser-react";
import { RightToolRail } from "./RightToolRail";
import { resolveRightDockLauncherItems } from "./rightDockPaneMeta";

afterEach(cleanup);
it("shows pending sidechat creation while leaving other tools available", async () => {
  const items = resolveRightDockLauncherItems({
    hasWorkspace: true,
    hasGitRepository: true,
    hasReview: true,
    hasDeviceSupport: false,
  });
  const view = (pending: boolean) => (
    <RightToolRail
      items={items}
      activeKind={null}
      onPick={() => {}}
      pendingKind={pending ? "sidechat" : null}
    />
  );
  const mounted = await render(view(true));
  const sidechat = page.getByRole("button", {
    name: "Opening Side chats…",
    exact: true,
  });
  await expect.element(sidechat).toHaveAttribute("aria-busy", "true");
  await expect.element(sidechat).toBeDisabled();
  await expect
    .element(page.getByRole("button", { name: "Review", exact: true }))
    .toBeEnabled();
  await mounted.rerender(view(false));
  await expect
    .element(page.getByRole("button", { name: "Side chats", exact: true }))
    .toBeEnabled();
});
