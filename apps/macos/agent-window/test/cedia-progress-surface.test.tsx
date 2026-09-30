import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CediaProgressPanel,
  type CediaProgressAnswer,
} from "../vendor/synara/apps/web/src/components/chat/CediaProgressSurface";
import { parseCediaProgressAnswer } from "../vendor/synara/apps/web/src/lib/serverReactQuery";

const progress: CediaProgressAnswer = {
  state: "available",
  revision: 4,
  phases: [
    {
      name: "Ship the surface",
      tasks: [
        { content: "Write the adapter", status: "completed" },
        { content: "Render the panel", status: "in_progress" },
        { content: "Handle host refusal", status: "blocked", blocker: "Waiting for the host route" },
        { content: "Run verification", status: "pending" },
      ],
    },
  ],
};

describe("Cedia progress surface", () => {
  it("renders every runtime status, blocker text, and presentation counts", () => {
    const html = renderToStaticMarkup(<CediaProgressPanel state={progress} />);

    expect(html).toContain("Ship the surface");
    expect(html).toContain("Write the adapter");
    expect(html).toContain("Render the panel");
    expect(html).toContain("Handle host refusal");
    expect(html).toContain("Waiting for the host route");
    expect(html).toContain("Run verification");
    expect(html).toContain("Done: 1");
    expect(html).toContain("In progress: 1");
    expect(html).toContain("Blocked: 1");
    expect(html).toContain("Pending: 1");
  });

  it("renders no panel when the runtime returns an empty phase list", () => {
    const html = renderToStaticMarkup(
      <CediaProgressPanel state={{ state: "available", revision: 5, phases: [] }} />,
    );

    expect(html).toBe("");
  });

  it("renders an unavailable reason without a working list", () => {
    const html = renderToStaticMarkup(
      <CediaProgressPanel state={{ state: "unavailable", reason: "OMP runtime is stopped" }} />,
    );

    expect(html).toContain("OMP runtime is stopped");
    expect(html).not.toContain("Progress counts");
    expect(html).not.toContain("Write the adapter");
  });

  it("parses the host answer defensively while preserving runtime order", () => {
    expect(parseCediaProgressAnswer({
      state: "available",
      revision: 6,
      phases: [
        { name: "First", tasks: [{ content: "One", status: "pending" }] },
        { name: "Second", tasks: [{ content: "Two", status: "blocked", blocker: "A reason" }] },
      ],
    })).toEqual({
      state: "available",
      revision: 6,
      phases: [
        { name: "First", tasks: [{ content: "One", status: "pending" }] },
        { name: "Second", tasks: [{ content: "Two", status: "blocked", blocker: "A reason" }] },
      ],
    });
  });
});
