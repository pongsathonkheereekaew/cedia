import { describe, expect, test } from "bun:test";
import { isDiscoverableOwner, ownerRowPresentation, parseOwnerListing } from "../core/owners.ts";

const live = { taskId: "t1", title: "CLI job", archived: false, state: "attached",
  identity: { sessionId: "s1", incarnation: "i1", pid: 4242, ownerStartedAt: "2026-10-01T00:00:00.000Z", mode: "controller" } };
const inspectOnly = { taskId: "t2", title: "Watched", archived: false, state: "attached",
  identity: { sessionId: "s2", incarnation: "i2", pid: 4243, ownerStartedAt: "2026-10-01T00:00:00.000Z", mode: "inspect_only" } };

describe("owner listing parser", () => {
  test("accepts a mixed listing and drops malformed rows", () => {
    const listing = parseOwnerListing({ owners: [live, inspectOnly,
      { taskId: "t3", title: "Gone", archived: false, state: "stale", reason: "process gone" },
      { taskId: "t4", title: "Clash", archived: true, state: "conflict", reason: "other session" },
      { taskId: "t5", title: "Quiet", archived: false, state: "absent" },
      { taskId: "", title: "Bad", archived: false, state: "absent" },
      { taskId: "t6", title: "Bad", archived: false, state: "attached" },
    ], truncated: false });
    expect(listing.owners.map(entry => entry.taskId)).toEqual(["t1", "t2", "t3", "t4", "t5"]);
    expect(listing.truncated).toBe(false);
  });

  test("refuses unknown states and non-object bodies", () => {
    expect(() => parseOwnerListing({ owners: [{ taskId: "t", title: "T", archived: false, state: "flying" }], truncated: false })).not.toThrow();
    expect(parseOwnerListing({ owners: [{ taskId: "t", title: "T", archived: false, state: "flying" }], truncated: false }).owners).toEqual([]);
    expect(() => parseOwnerListing({ owners: [], truncated: "yes" })).toThrow();
    expect(() => parseOwnerListing(null)).toThrow();
  });

  test("a modeless identity stays controller-capable", () => {
    const listing = parseOwnerListing({ owners: [{ taskId: "t", title: "T", archived: false, state: "attached",
      identity: { sessionId: "s", incarnation: "i", pid: 1, ownerStartedAt: "2026-10-01T00:00:00.000Z" } }], truncated: true });
    expect(listing.owners[0]?.identity?.mode).toBe("controller");
  });
});

describe("owner row presentation", () => {
  test("only non-idle owners are discoverable", () => {
    const listing = parseOwnerListing({ owners: [live, { taskId: "t5", title: "Quiet", archived: false, state: "absent" }], truncated: false });
    expect(listing.owners.filter(isDiscoverableOwner).map(entry => entry.taskId)).toEqual(["t1"]);
  });

  test("attach is offered only for controller-capable live owners", () => {
    const listing = parseOwnerListing({ owners: [live, inspectOnly,
      { taskId: "t3", title: "Gone", archived: false, state: "stale", reason: "gone" },
      { taskId: "t4", title: "Clash", archived: false, state: "conflict", reason: "clash" },
    ], truncated: false });
    const [a, b, c, d] = listing.owners.map(ownerRowPresentation);
    expect(a).toMatchObject({ badge: "Live", canAttach: true, canOpen: true });
    expect(b).toMatchObject({ badge: "View only", canAttach: false, canOpen: true });
    expect(c?.badge).toBe("Ended");
    expect(c?.canAttach).toBe(false);
    expect(d?.badge).toBe("Elsewhere");
    expect(d?.detail).toBe("clash");
  });
});
