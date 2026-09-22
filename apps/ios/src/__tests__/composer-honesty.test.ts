import { describe, expect, test } from "bun:test";
import type { Session } from "../../../../packages/protocol/src/index.ts";
import {
  advertisedModelId,
  IOS_COMPOSER_ADD_MESSAGE,
  IOS_COMPOSER_CHOOSE_MODEL,
  IOS_COMPOSER_HOST_OFFLINE,
  IOS_COMPOSER_NO_SESSION,
  IOS_COMPOSER_QUEUE_IDLE,
  IOS_COMPOSER_STEER_IDLE,
  IOS_COMPOSER_STOP_IDLE,
  IOS_HOST_UPLOAD_ADVERTISED,
  IOS_HOST_UPLOAD_COPY,
  iosComposerAllowsCommand,
  iosComposerHonesty,
  modelOptionSelectable,
} from "../core/composer-honesty.ts";
import { createInitialMobileState } from "../core/state.ts";

const session: Session = {
  id: "s1",
  projectId: "p1",
  title: "Card pass",
  cwd: "/work/aetheria",
  sessionFile: "/state/s1/session.jsonl",
  incarnation: "inc-1",
  status: "idle",
  archived: false,
  createdAt: "2026-09-12T00:00:00.000Z",
  updatedAt: "2026-09-12T00:00:00.000Z",
};

const project = { id: "p1", path: "/work/aetheria", name: "Aetheria", pinned: false, archived: false, createdAt: "2026-09-12T00:00:00.000Z" };
const advertised = [{ id: "test-model", label: "Test", provider: "omp" }];

function honesty(partial: Parameters<typeof createInitialMobileState>[0] = {}) {
  return iosComposerHonesty(createInitialMobileState({
    connection: "connected",
    project,
    session,
    draft: "hello",
    models: advertised,
    selectedModel: "test-model",
    ...partial,
  }));
}

describe("advertised model id", () => {
  test("ignores a leftover selected id when OMP has not advertised a catalog", () => {
    expect(advertisedModelId({ selectedModel: "stale-model", models: [] })).toBeUndefined();
    expect(advertisedModelId({ selectedModel: "stale-model" })).toBeUndefined();
    expect(advertisedModelId({ selectedModel: "test-model", models: advertised })).toBe("test-model");
  });

  test("rejects advertised rows that OMP marked unavailable", () => {
    expect(modelOptionSelectable({ id: "test-model", label: "Test", available: false })).toBe(false);
    expect(advertisedModelId({
      selectedModel: "test-model",
      models: [{ id: "test-model", label: "Test", available: false }],
    })).toBeUndefined();
  });
});

describe("ios composer honesty", () => {
  test("does not invent host upload or attachment dispatch", () => {
    expect(IOS_HOST_UPLOAD_ADVERTISED).toBe(false);
    expect(IOS_HOST_UPLOAD_COPY).toContain("Host file upload is not advertised on this phone");
    const empty = honesty({ draft: "" });
    expect(empty.primaryEnabled).toBe(false);
    expect(empty.primaryReason).toBe(IOS_COMPOSER_ADD_MESSAGE);
    expect(empty.primaryReason).not.toContain("attachment");
    expect(empty.uploadAdvertised).toBe(false);
    expect(empty.uploadReason).toBe(IOS_HOST_UPLOAD_COPY);
    expect(empty.sendIntent).toBeNull();
  });

  test("enables Send only with an advertised model, host session, and online host", () => {
    const ready = honesty();
    expect(ready.primary).toBe("send");
    expect(ready.primaryEnabled).toBe(true);
    expect(ready.sendIntent).toBe("send_prompt");
    expect(ready.queueEnabled).toBe(false);
    expect(ready.steerEnabled).toBe(false);
    expect(ready.stopEnabled).toBe(false);
    expect(ready.queueReason).toBe(IOS_COMPOSER_QUEUE_IDLE);
    expect(ready.steerReason).toBe(IOS_COMPOSER_STEER_IDLE);
    expect(ready.stopReason).toBe(IOS_COMPOSER_STOP_IDLE);
    expect(iosComposerAllowsCommand(ready, "prompt")).toBe(true);
  });

  test("disables Send/Queue/Steer when there is no advertised model", () => {
    const missing = honesty({ selectedModel: undefined });
    expect(missing.primaryEnabled).toBe(false);
    expect(missing.queueEnabled).toBe(false);
    expect(missing.steerEnabled).toBe(false);
    expect(missing.primaryReason).toBe(IOS_COMPOSER_CHOOSE_MODEL);
    expect(missing.queueReason).toBe(IOS_COMPOSER_CHOOSE_MODEL);
    expect(missing.steerReason).toBe(IOS_COMPOSER_CHOOSE_MODEL);
    expect(missing.sendIntent).toBeNull();
    expect(iosComposerAllowsCommand(missing, "prompt")).toBe(false);
    expect(iosComposerAllowsCommand(missing, "follow_up")).toBe(false);
    expect(iosComposerAllowsCommand(missing, "steer")).toBe(false);

    const stale = honesty({ models: [] });
    expect(stale.primaryEnabled).toBe(false);
    expect(stale.primaryReason).toBe(IOS_COMPOSER_CHOOSE_MODEL);
    expect(iosComposerAllowsCommand(stale, "prompt")).toBe(false);
  });

  test("disables Send/Queue/Steer/Stop without a host session", () => {
    const unpaired = honesty({ session: null });
    expect(unpaired.primaryEnabled).toBe(false);
    expect(unpaired.queueEnabled).toBe(false);
    expect(unpaired.steerEnabled).toBe(false);
    expect(unpaired.stopEnabled).toBe(false);
    expect(unpaired.primaryReason).toBe(IOS_COMPOSER_NO_SESSION);
    expect(unpaired.stopReason).toBe(IOS_COMPOSER_NO_SESSION);
    expect(unpaired.sendIntent).toBeNull();
    expect(iosComposerAllowsCommand(unpaired, "prompt")).toBe(false);
    expect(iosComposerAllowsCommand(unpaired, "abort")).toBe(false);
  });

  test("keeps offline composers draft-only with a readable D16 reason", () => {
    const offline = honesty({ connection: "offline" });
    expect(offline.primary).toBe("waiting_host");
    expect(offline.primaryEnabled).toBe(false);
    expect(offline.queueEnabled).toBe(false);
    expect(offline.steerEnabled).toBe(false);
    expect(offline.stopEnabled).toBe(false);
    expect(offline.modelEnabled).toBe(false);
    expect(offline.primaryReason).toBe(IOS_COMPOSER_HOST_OFFLINE);
    expect(offline.queueReason).toBe(IOS_COMPOSER_HOST_OFFLINE);
    expect(offline.steerReason).toBe(IOS_COMPOSER_HOST_OFFLINE);
    expect(offline.stopReason).toBe(IOS_COMPOSER_HOST_OFFLINE);
    expect(offline.sendIntent).toBeNull();
    expect(iosComposerAllowsCommand(offline, "prompt")).toBe(false);
    expect(iosComposerAllowsCommand(offline, "steer")).toBe(false);
    expect(iosComposerAllowsCommand(offline, "abort")).toBe(false);
  });

  test("does not look enabled for Queue/Steer while running without an advertised model", () => {
    const running = honesty({
      session: { ...session, status: "running" },
      selectedModel: undefined,
    });
    expect(running.primary).toBe("queue");
    expect(running.primaryEnabled).toBe(false);
    expect(running.queueVisible).toBe(true);
    expect(running.queueEnabled).toBe(false);
    expect(running.steerEnabled).toBe(false);
    expect(running.stopEnabled).toBe(true);
    expect(running.primaryReason).toBe(IOS_COMPOSER_CHOOSE_MODEL);
    expect(running.queueReason).toBe(IOS_COMPOSER_CHOOSE_MODEL);
    expect(running.stopReason).toBe("");
    expect(iosComposerAllowsCommand(running, "follow_up")).toBe(false);
    expect(iosComposerAllowsCommand(running, "steer")).toBe(false);
    expect(iosComposerAllowsCommand(running, "abort")).toBe(true);
  });

  test("allows compact without inventing prompt dispatch", () => {
    const offline = honesty({ connection: "offline" });
    expect(iosComposerAllowsCommand(offline, "compact")).toBe(true);
    expect(iosComposerAllowsCommand(offline, "prompt")).toBe(false);
  });
});
