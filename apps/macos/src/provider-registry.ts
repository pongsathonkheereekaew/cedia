/** Item 66: installs every concern slice on CediaTaskViewProvider.prototype. */

import type { CediaTaskViewProviderApi } from "./provider-api.ts";
import { hostConcern } from "./provider-host.ts";
import { ompConcern } from "./provider-omp.ts";
import { projectsConcern } from "./provider-projects.ts";
import { editorConcern } from "./provider-editor.ts";
import { reviewConcern } from "./provider-review.ts";
import { chromeConcern } from "./provider-chrome.ts";

export function installProviderConcerns(prototype: CediaTaskViewProviderApi): void {
	Object.assign(prototype, hostConcern, ompConcern, projectsConcern, editorConcern, reviewConcern, chromeConcern);
}
