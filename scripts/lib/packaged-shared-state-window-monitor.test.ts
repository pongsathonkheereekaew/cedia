import { expect, it } from "bun:test";
import { installElectronWindowMonitor } from "./packaged-shared-state-window-monitor.ts";

class FakePage {
	readonly listeners = new Map<string, Array<(value: unknown) => void>>();
	on(event: string, listener: (value: unknown) => void): void {
		this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
	}
	emit(event: string, value: unknown): void {
		for (const listener of this.listeners.get(event) ?? []) listener(value);
	}
}

class FakeApplication {
	readonly listeners = new Map<string, Array<(value: unknown) => void>>();
	readonly pages: FakePage[];
	constructor(first: FakePage) { this.pages = [first]; }
	windows(): FakePage[] { return [...this.pages]; }
	on(event: string, listener: (value: unknown) => void): void {
		this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
	}
	off(event: string, listener: (value: unknown) => void): void {
		this.listeners.set(event, (this.listeners.get(event) ?? []).filter(entry => entry !== listener));
	}
	removeListener(event: string, listener: (value: unknown) => void): void { this.off(event, listener); }
	emitWindow(page: FakePage): void {
		this.pages.push(page);
		for (const listener of this.listeners.get("window") ?? []) listener(page);
	}
}

it("captures page errors from a second Electron window without duplicate listeners", () => {
	const first = new FakePage();
	const application = new FakeApplication(first);
	const errors: string[] = [];
	const monitor = installElectronWindowMonitor(application, { errors });
	// firstWindow() may be observed after launch and then delivered through the
	// window event; the Set must keep this one page attached exactly once.
	for (const listener of application.listeners.get("window") ?? []) listener(first);
	const ide = new FakePage();
	application.emitWindow(ide);
	ide.emit("pageerror", new Error("IDE webview failed"));
	first.emit("pageerror", new Error("Agents failed"));
	ide.emit("pageerror", new Error("IDE webview failed again"));
	expect(monitor.attachedCount()).toBe(2);
	expect(errors).toEqual(["IDE webview failed", "Agents failed", "IDE webview failed again"]);
	monitor.dispose();
	const later = new FakePage();
	application.emitWindow(later);
	later.emit("pageerror", new Error("not observed after dispose"));
	expect(errors).toHaveLength(3);
});
