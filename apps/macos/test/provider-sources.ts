import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Item 66: the provider's implementation now spans several files — the wiring root
 * (`extension.ts`), the state hub, the generated API type, the per-concern slices
 * (`provider-*.ts`), the runtime helpers and the theme sync. Source-level assertions
 * that used to read `extension.ts` alone ask "does this repository contain this
 * behaviour", so they read the whole set instead of one file that no longer owns
 * everything. The assertions themselves are unchanged.
 */
export function readProviderSources(srcDir: string): string {
	const names = readdirSync(srcDir).filter(name =>
		name === "extension.ts"
		|| name === "task-runtime.ts"
		|| name === "task-theme-sync.ts"
		|| name === "task-commands.ts"
		|| (name.startsWith("provider-") && name.endsWith(".ts") && name !== "provider-icons.ts"));
	return names.map(name => readFileSync(join(srcDir, name), "utf8")).join("\n");
}
