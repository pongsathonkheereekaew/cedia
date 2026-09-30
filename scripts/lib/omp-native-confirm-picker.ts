export interface OmpPickerProviderTab {
	readonly label: string;
	readonly stableTabId: string | null;
}

/** Resolve the upstream tab for a model, preferring its stable UI id. */
export function resolveOmpUpstreamProviderTab<T extends OmpPickerProviderTab>(
	tabs: readonly T[],
	providerId: string,
): T | undefined {
	const expectedTabId = `upstream:${providerId.trim().toLowerCase().replace(/\s+/gu, "-")}`;
	const byId = tabs.find(tab => tab.stableTabId === expectedTabId);
	if (byId) return byId;
	const nonStarred = tabs.filter(tab => tab.label.trim().toLowerCase() !== "starred");
	return nonStarred.length === 1 ? nonStarred[0] : undefined;
}
