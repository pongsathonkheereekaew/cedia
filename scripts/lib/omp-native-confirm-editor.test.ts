import { expect, it } from "bun:test";
import { findNativeConfirmEditorPage } from "./omp-native-confirm-editor.ts";

it("selects the renderer showing the edited buffer after the approval handoff", () => {
	const staleHandoffPage = { id: "stale-handoff" };
	const currentEditorPage = { id: "current-editor" };
	const pages = [
		{
			page: staleHandoffPage,
			editorText: "disk original",
			bodyText: "fixture.txt disk original",
			hasMonaco: true,
		},
		{
			page: currentEditorPage,
			editorText: "unsaved edited",
			bodyText: "fixture.txt unsaved edited",
			hasMonaco: true,
		},
	];

	expect(findNativeConfirmEditorPage(pages, "approved", "disk original", "unsaved edited"))
		.toBe(currentEditorPage);
});

it("uses the disk baseline to find the editor immediately after opening", () => {
	const baselinePage = { id: "baseline-editor" };
	const editedPage = { id: "edited-editor" };
	const pages = [
		{
			page: editedPage,
			editorText: "unsaved edited",
			bodyText: "fixture.txt unsaved edited",
			hasMonaco: true,
		},
		{
			page: baselinePage,
			editorText: "disk original",
			bodyText: "fixture.txt disk original",
			hasMonaco: true,
		},
	];

	expect(findNativeConfirmEditorPage(pages, "opened", "disk original", "unsaved edited"))
		.toBe(baselinePage);
});
