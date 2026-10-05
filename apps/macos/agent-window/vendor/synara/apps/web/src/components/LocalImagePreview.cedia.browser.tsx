import "../index.css";

import { afterEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { LocalImagePreview } from "./LocalImagePreview";

const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==";

const nativeApi = {
  projects: {
    createLocalFilePreviewGrant: vi.fn(async () => ({
      grant: "cedia-preview-grant",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })),
    readLocalFilePreview: vi.fn(async () => ({
      path: "/Users/tester/project/icon.png",
      mimeType: "image/png",
      dataBase64: pngBase64,
      version: "sha256:fixture",
    })),
  },
};

let previousNativeApi: PropertyDescriptor | undefined;
let previousDesktopBridge: PropertyDescriptor | undefined;

function installCediaBridge() {
  previousNativeApi = Object.getOwnPropertyDescriptor(window, "nativeApi");
  previousDesktopBridge = Object.getOwnPropertyDescriptor(window, "desktopBridge");
  Object.defineProperty(window, "nativeApi", {
    configurable: true,
    value: nativeApi,
  });
  Object.defineProperty(window, "desktopBridge", {
    configurable: true,
    value: { getWsUrl: () => null },
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  if (previousNativeApi) Object.defineProperty(window, "nativeApi", previousNativeApi);
  else Reflect.deleteProperty(window, "nativeApi");
  if (previousDesktopBridge) {
    Object.defineProperty(window, "desktopBridge", previousDesktopBridge);
  } else {
    Reflect.deleteProperty(window, "desktopBridge");
  }
  nativeApi.projects.createLocalFilePreviewGrant.mockClear();
  nativeApi.projects.readLocalFilePreview.mockClear();
});

function preview(cacheKey?: number) {
  return (
    <LocalImagePreview
      src="./icon.png"
      cwd="/Users/tester/project"
      alt="Fixture icon"
      {...(cacheKey === undefined ? {} : { cacheKey })}
    />
  );
}

it("loads a valid PNG through Cedia's native capability path", async () => {
  installCediaBridge();
  await render(preview(0));
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLImageElement>(".local-image-preview__img")?.src).toContain(
      "data:image/png;base64,",
    ),
  );
  await vi.waitFor(() =>
    expect(document.querySelector(".local-image-preview")?.getAttribute("data-status")).toBe(
      "ready",
    ),
  );
  expect(nativeApi.projects.createLocalFilePreviewGrant).toHaveBeenCalledWith({
    path: "./icon.png",
    cwd: "/Users/tester/project",
  });
  expect(nativeApi.projects.readLocalFilePreview).toHaveBeenCalledWith({
    path: "./icon.png",
    cwd: "/Users/tester/project",
    grant: "cedia-preview-grant",
  });
});

it("shows the normal error card when the native payload cannot decode", async () => {
  installCediaBridge();
  nativeApi.projects.readLocalFilePreview.mockResolvedValueOnce({
    path: "/Users/tester/project/icon.png",
    mimeType: "image/png",
    dataBase64: "bm90LWltYWdl",
    version: "sha256:invalid",
  });
  await render(preview());
  await vi.waitFor(() =>
    expect(document.querySelector(".local-image-error__title")?.textContent).toBe(
      "Couldn’t open this image",
    ),
  );
});

it("reloads the native payload when the binary cache key changes", async () => {
  installCediaBridge();
  const mounted = await render(preview(1));
  await vi.waitFor(() =>
    expect(document.querySelector(".local-image-preview")?.getAttribute("data-status")).toBe(
      "ready",
    ),
  );
  await mounted.rerender(preview(2));
  await vi.waitFor(() => expect(nativeApi.projects.readLocalFilePreview).toHaveBeenCalledTimes(2));
});
