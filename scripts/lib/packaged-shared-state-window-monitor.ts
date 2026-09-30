import { appendFile } from "node:fs/promises";

export interface ElectronWindowMonitorOptions {
	readonly errors: string[];
	readonly consolePath?: string;
	readonly label?: string;
}

export interface ElectronWindowMonitor {
	readonly attachedCount: () => number;
	dispose: () => void;
}

/**
 * Attach diagnostics to every Electron Playwright page, including windows that
 * appear after the initial Agents page (for example the IDE window).  Install
 * this immediately after launch, before awaiting firstWindow(), so the first
 * window and later window events share one listener path.
 */
export function installElectronWindowMonitor(
	application: any,
	options: ElectronWindowMonitorOptions,
): ElectronWindowMonitor {
	const attached = new Set<any>();
	const attach = (page: any): void => {
		if (!page || attached.has(page)) return;
		attached.add(page);
		page.on?.("pageerror", (error: unknown) => {
			const message = error instanceof Error ? error.message : String(error);
			options.errors.push(options.label ? `${options.label}: ${message}` : message);
		});
		if (options.consolePath) {
			page.on?.("console", (message: any) => {
				const record = {
					type: typeof message?.type === "function" ? message.type() : undefined,
					text: typeof message?.text === "function" ? message.text() : "",
				};
				void appendFile(options.consolePath!, `${JSON.stringify(record)}\n`).catch(() => undefined);
			});
		}
	};
	for (const page of application.windows?.() ?? []) attach(page);
	const onWindow = (page: any): void => attach(page);
	application.on?.("window", onWindow);
	return {
		attachedCount: () => attached.size,
		dispose: () => {
			application.off?.("window", onWindow);
			application.removeListener?.("window", onWindow);
			attached.clear();
		},
	};
}
