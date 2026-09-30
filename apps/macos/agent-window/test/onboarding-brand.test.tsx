import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  isOnboardingSetupStep,
  nextOnboardingStep,
  ONBOARDING_STEPS,
  previousOnboardingStep,
  resolveLocalOnboardingCompletion,
  resolveOnboardingGate,
  type OnboardingGateInputs,
} from "../vendor/synara/apps/web/src/onboarding/logic";
import { WelcomeStep } from "../vendor/synara/apps/web/src/onboarding/steps/WelcomeStep";

// D settings/brand boundary: the first-run tour must tell the local-first story
// and never name a foreign harness. OMP is the only harness; provider/model choice
// lives in OMP surfaces, not in welcome copy. (The dialog shell itself renders in a
// portal, so static tests target the step content and the pure gate logic.)
const FORBIDDEN_HARNESS_NAMES = ["copilot", "claude", "codex", "cursor", "windsurf", "tabnine"];

function visibleText(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
}

function gateInput(overrides: Partial<OnboardingGateInputs> = {}): OnboardingGateInputs {
  return {
    installationKeyStatus: "success",
    threadsHydrated: true,
    settingsSettled: true,
    projectCount: 0,
    serverCompletedAt: null,
    localCompletedAt: null,
    ...overrides,
  };
}

describe("Onboarding brand boundary", () => {
  it("tells the local-first story with no foreign-harness copy", () => {
    const text = visibleText(renderToStaticMarkup(<WelcomeStep />));
    for (const point of ["Local-first", "Your own agents", "Verify before done"]) {
      expect(text).toContain(point);
    }
    expect(text).toContain("No account. Workspace data stays on this machine.");
    const lower = text.toLowerCase();
    for (const name of FORBIDDEN_HARNESS_NAMES) {
      expect(lower).not.toContain(name);
    }
  });

  it("walks welcome, tour, project, done without auto-closing past setup choices", () => {
    expect([...ONBOARDING_STEPS]).toEqual(["welcome", "tour", "project", "done"]);
    expect(nextOnboardingStep("welcome")).toBe("tour");
    expect(nextOnboardingStep("tour")).toBe("project");
    expect(nextOnboardingStep("project")).toBe("done");
    expect(nextOnboardingStep("done")).toBe("done");
    expect(previousOnboardingStep("done")).toBe("project");
    expect(previousOnboardingStep("welcome")).toBe("welcome");
    expect(isOnboardingSetupStep("welcome")).toBe(false);
    expect(isOnboardingSetupStep("tour")).toBe(false);
    expect(isOnboardingSetupStep("project")).toBe(true);
    expect(isOnboardingSetupStep("done")).toBe(true);
  });

  it("shows the tour exactly on fresh installs with no completion marker", () => {
    expect(resolveOnboardingGate(gateInput())).toBe("show");
    expect(resolveOnboardingGate(gateInput({ projectCount: 2 }))).toBe("hidden");
    expect(resolveOnboardingGate(gateInput({ serverCompletedAt: "2026-09-26T00:00:00.000Z" }))).toBe("hidden");
    expect(resolveOnboardingGate(gateInput({ localCompletedAt: "2026-09-26T00:00:00.000Z" }))).toBe("hidden");
    expect(resolveOnboardingGate(gateInput({ threadsHydrated: false }))).toBe("pending");
    expect(resolveOnboardingGate(gateInput({ settingsSettled: false }))).toBe("pending");
    expect(resolveOnboardingGate(gateInput({ installationKeyStatus: "pending" }))).toBe("pending");
    expect(resolveOnboardingGate(gateInput({ installationKeyStatus: "error" }))).toBe("hidden");
  });

  it("ignores a completion marker recorded against another installation", () => {
    expect(resolveLocalOnboardingCompletion({ completedAt: "2026-09-26T00:00:00.000Z", installationKey: "other" }, "here")).toBeNull();
    expect(resolveLocalOnboardingCompletion({ completedAt: "2026-09-26T00:00:00.000Z", installationKey: "here" }, "here")).toBe(
      "2026-09-26T00:00:00.000Z",
    );
    expect(resolveLocalOnboardingCompletion({ completedAt: null, installationKey: "here" }, "here")).toBeNull();
  });
});
