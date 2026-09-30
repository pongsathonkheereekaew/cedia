// Cedia slice test for upstream #1290 remainder (project sort timestamps
// resolved once per project, not per comparison). The refactor is
// behavior-identical by construction; this pins the observable ordering.
// Upstream: https://github.com/Emanuele-web04/synara/pull/1290
import { describe, expect, it } from "vitest";

import { sortProjectsForSidebar } from "./Sidebar.logic";

const project = (id: string) => ({ id, name: id.toUpperCase() });
const thread = (projectId: string, createdAt: string) => ({ projectId, createdAt });

describe("sortProjectsForSidebar", () => {
  it("orders projects by newest thread first without rescanning per comparison", () => {
    const projects = [project("p1"), project("p2"), project("p3")];
    const threads = [
      thread("p1", "2026-01-01T00:00:00.000Z"),
      thread("p2", "2026-03-01T00:00:00.000Z"),
      thread("p3", "2026-02-01T00:00:00.000Z"),
    ];
    expect(sortProjectsForSidebar(projects, threads, "created_at").map((p) => p.id)).toEqual([
      "p2",
      "p3",
      "p1",
    ]);
  });

  it("keeps manual order untouched", () => {
    const projects = [project("p1"), project("p2")];
    const threads = [
      thread("p1", "2026-01-01T00:00:00.000Z"),
      thread("p2", "2026-03-01T00:00:00.000Z"),
    ];
    expect(sortProjectsForSidebar(projects, threads, "manual").map((p) => p.id)).toEqual([
      "p1",
      "p2",
    ]);
  });
});
