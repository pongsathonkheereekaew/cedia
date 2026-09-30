import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { CediaModelRolesControls } from "./CediaRuntimeProviderState";

const roles = {
  available: true as const,
  cycleOrder: ["default", "smol"],
  roles: [
    { role: "default", modelId: "fixture/fixture-model", source: "global" },
    { role: "smol", modelId: "fixture/fast-1", source: "global" },
  ],
  storage: "global",
};

it("assigns, clears, and creates role mappings through real inputs", async () => {
  // Item-6 acceptance: role assignment driven with real input events (not
  // static markup). The durable dispatch behind onSet is proven live by
  // scripts/omp-roles-apply-smoke.ts; this proves the window sends it.
  const onSet = vi.fn();
  const screen = await render(
    <CediaModelRolesControls state={roles} onApply={() => {}} onSet={onSet} />,
  );
  try {
    await page.getByRole("textbox", { name: "Model for role smol" }).fill("fixture/edited-model");
    await page.getByRole("button", { name: "Set model for role smol" }).click();
    expect(onSet).toHaveBeenCalledWith("smol", "fixture/edited-model");

    await page.getByRole("button", { name: "Clear model for role smol" }).click();
    expect(onSet).toHaveBeenCalledWith("smol", null);

    await page.getByRole("textbox", { name: "New role name" }).fill("tiny");
    await page.getByRole("textbox", { name: "Model for the new role" }).fill("fixture/tiny-1");
    await page.getByRole("button", { name: "Assign" }).click();
    expect(onSet).toHaveBeenCalledWith("tiny", "fixture/tiny-1");
  } finally {
    await screen.unmount();
  }
});
