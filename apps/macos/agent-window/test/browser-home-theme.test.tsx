import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BrowserLocalServersHome, BrowserRuntimeError } from "../vendor/synara/apps/web/src/components/BrowserPanel";

const noop = () => {};

describe("browser home follows the theme", () => {
  it("shows a Codex-like light empty state instead of the dark server home", () => {
    const markup = renderToStaticMarkup(
      <BrowserLocalServersHome activeTabId={null} dark={false} loading={false} onNavigate={noop} onRefresh={noop} servers={[]} />,
    );
    expect(markup).toContain("Start browsing");
    expect(markup).toContain("Enter a URL to open a page");
    expect(markup).toContain("bg-background");
    expect(markup).not.toContain("No local servers");
    expect(markup).not.toContain("bg-[#0d0d0d]");
  });

  it("keeps the dark home dark with the same copy", () => {
    const markup = renderToStaticMarkup(
      <BrowserLocalServersHome activeTabId={null} dark={true} loading={false} onNavigate={noop} onRefresh={noop} servers={[]} />,
    );
    expect(markup).toContain("Start browsing");
    expect(markup).toContain("Enter a URL to open a page");
    expect(markup).toContain("bg-[#0d0d0d]");
    expect(markup).not.toContain("No local servers");
  });

  it("still lists local servers when the adapter reports them", () => {
    const markup = renderToStaticMarkup(
      <BrowserLocalServersHome
        activeTabId={null}
        dark={false}
        loading={false}
        onNavigate={noop}
        onRefresh={noop}
        servers={[{ id: "s1", pid: 123, command: "node", displayName: "Demo", args: "", ports: [3000], addresses: [], isStoppable: true }]}
      />,
    );
    expect(markup).toContain("Local");
    expect(markup).toContain("Demo");
    expect(markup).not.toContain("Start browsing");
  });
});

describe("browser error follows the theme", () => {
  it("keeps its copy in both themes with a themed surface", () => {
    const light = renderToStaticMarkup(<BrowserRuntimeError message="boom" onReload={noop} dark={false} />);
    expect(light).toContain("This page could not be loaded");
    expect(light).toContain("Reload page");
    expect(light).toContain("bg-background");
    expect(light).not.toContain("bg-[#0d0d0d]");
    const dark = renderToStaticMarkup(<BrowserRuntimeError message="boom" onReload={noop} dark={true} />);
    expect(dark).toContain("This page could not be loaded");
    expect(dark).toContain("bg-[#0d0d0d]");
  });
});
