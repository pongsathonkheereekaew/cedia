/** New-draft branch picker (D18). Lists advertised Git refs only. Does not checkout. */

import type { GitBranch } from "../../../packages/protocol/src/git.ts";

export type BranchKind = "local" | "remote" | "current";

export interface BranchHit {
	readonly name: string;
	readonly kind: BranchKind;
	readonly current: boolean;
}

export interface BranchPickerState {
	readonly query: string;
	readonly hits: readonly BranchHit[];
	readonly noMatch: boolean;
	readonly loading: boolean;
	readonly current?: string;
	readonly selected?: string;
}

export const BRANCH_NO_GIT = "No Git branch until the folder has a repository.";
export const BRANCH_NO_RESULTS = "No matching refs. Refresh to reload advertised local and remote names.";
export const BRANCH_SELECT_REASON = "Selecting a ref targets the new draft. Cedia will not checkout until you confirm a workspace workflow.";

/** The picker's rows from the host's branch list (§10 item 58): the host reads
 * the refs, this only names the three kinds the picker renders. */
export function branchHitsFromHostBranches(branches: readonly GitBranch[]): BranchHit[] {
	return branches.map(branch => ({
		name: branch.name,
		kind: branch.current ? "current" : branch.isRemote === true ? "remote" : "local",
		current: branch.current,
	}));
}

export function filterBranchHits(hits: readonly BranchHit[], query: string, loading = false): BranchPickerState {
	const needle = query.trim().toLowerCase();
	const filtered = needle ? hits.filter(item => item.name.toLowerCase().includes(needle) || item.kind.includes(needle)) : [...hits];
	const current = hits.find(item => item.current)?.name;
	return {
		query: query.trim(),
		hits: filtered,
		noMatch: Boolean(needle) && filtered.length === 0,
		loading,
		...(current ? { current } : {}),
	};
}

export function emptyBranchPicker(current?: string): BranchPickerState {
	return { query: "", hits: [], noMatch: false, loading: false, ...(current ? { current } : {}) };
}
