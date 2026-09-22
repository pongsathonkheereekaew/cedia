import { describe, expect, it } from "bun:test";
import { branchHitsFromHostBranches, filterBranchHits } from "../src/branch-picker.ts";

/** The host's branch rows, as `POST /v1/git { method: "listBranches" }` answers
 * them: local refs, remote refs with their remote name, and the current one. */
const hostBranches = [
	{ name: "feat/s18", current: true, isDefault: false, worktreePath: null },
	{ name: "notes", current: false, isDefault: false, worktreePath: null },
	{ name: "origin/feat/s18", isRemote: true, remoteName: "origin", current: false, isDefault: true, worktreePath: null },
];

describe("branchHitsFromHostBranches", () => {
	it("marks current, local, and remote refs without inventing main", () => {
		const hits = branchHitsFromHostBranches(hostBranches);
		expect(hits.map(item => item.name)).toEqual(["feat/s18", "notes", "origin/feat/s18"]);
		expect(hits[0]).toMatchObject({ kind: "current", current: true });
		expect(hits[1]).toMatchObject({ kind: "local", current: false });
		expect(hits[2]).toMatchObject({ kind: "remote", current: false });
		expect(hits.every(item => item.name !== "main")).toBe(true);
	});

	it("keeps the picker empty for a folder the host reports as no repository", () => {
		expect(branchHitsFromHostBranches([])).toEqual([]);
	});
});

describe("filterBranchHits", () => {
	const hits = branchHitsFromHostBranches(hostBranches);

	it("stays empty-query honest and does not invent a hit", () => {
		const all = filterBranchHits(hits, "  ");
		expect(all.noMatch).toBe(false);
		expect(all.hits).toHaveLength(3);
		expect(all.current).toBe("feat/s18");
	});

	it("returns no-match without selecting a stale row", () => {
		expect(filterBranchHits(hits, "cedia-no-ref-137", true)).toMatchObject({
			noMatch: true,
			hits: [],
			loading: true,
		});
	});
});
