export type NativeConfirmEditorPhase = "opened" | "approved";

export type NativeConfirmEditorPage<T> = {
	page: T;
	editorText: string;
	bodyText: string;
	hasMonaco: boolean;
};

export function findNativeConfirmEditorPage<T>(
	pages: readonly NativeConfirmEditorPage<T>[],
	phase: NativeConfirmEditorPhase,
	baselineText: string,
	editedText: string,
): T | null {
	const expectedText = phase === "opened" ? baselineText : editedText;
	return pages.find(({ editorText, bodyText, hasMonaco }) =>
		editorText.includes(expectedText) || (hasMonaco && bodyText.includes(expectedText)),
	)?.page ?? null;
}
