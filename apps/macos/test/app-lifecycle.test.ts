import { describe, expect, it } from "bun:test";
import {
	createCediaAppLifecycle,
	createCediaQuitDecision,
	createCediaShutdownJoin,
	registerCediaLoginItem,
	shouldOpenFirstWindowAtLaunch,
	type CediaLifecycleGateway,
} from "../src/app-lifecycle.ts";
import {
	CEDIA_DIRTY_EDITORS_CHANNEL,
	createCediaDirtyEditorReader,
	installCediaMainProcessLifecycle,
} from "../src/agent-window-bridge.ts";

type Snapshot = {
	phase: string;
	accepting: boolean;
	runningSessions: number;
	remotePaired: boolean;
	generation?: string;
};

function gateway(options: {
	lifecycle?: Snapshot[];
	peek?: (Snapshot | undefined)[];
	receipt?: { phase?: string };
	quit?: () => Promise<{ accepted?: boolean; alreadyRequested?: boolean; phase?: string } | undefined> | { accepted?: boolean; alreadyRequested?: boolean; phase?: string } | undefined;
	fence?: () => Promise<{ accepted?: boolean; changed?: boolean; phase?: string } | undefined> | { accepted?: boolean; changed?: boolean; phase?: string } | undefined;
	resume?: () => Promise<{ accepted?: boolean; changed?: boolean; phase?: string } | undefined> | { accepted?: boolean; changed?: boolean; phase?: string } | undefined;
	reliable?: boolean;
} = {}): CediaLifecycleGateway & { quitCalls: number; lifecycleCalls: number; ensureCalls: number; fenceCalls: number; resumeCalls: number } {
	const snapshots = [...(options.lifecycle ?? [])];
	const peeks = [...(options.peek ?? [])];
	let latest = snapshots.at(-1);
	let latestPeek: Snapshot | undefined;
	let quitCalls = 0;
	let lifecycleCalls = 0;
	let ensureCalls = 0;
	let fenceCalls = 0;
	let resumeCalls = 0;
	const api: CediaLifecycleGateway & { quitCalls: number; lifecycleCalls: number; ensureCalls: number; fenceCalls: number; resumeCalls: number } = {
		ensure: async () => { ensureCalls += 1; },
		lifecycle: async () => {
			lifecycleCalls += 1;
			latest = snapshots.length > 0 ? snapshots.shift()! : latest;
			return latest;
		},
		quit: async () => {
			quitCalls += 1;
			return options.quit ? options.quit() : { accepted: true, phase: "quitting" };
		},
		reliable: () => options.reliable ?? true,
		get fenceCalls() { return fenceCalls; },
		get resumeCalls() { return resumeCalls; },
		get quitCalls() { return quitCalls; },
		get lifecycleCalls() { return lifecycleCalls; },
		get ensureCalls() { return ensureCalls; },
	};
	if (options.peek) {
		api.peek = async () => {
			const next = peeks.length > 0 ? peeks.shift() : latestPeek;
			latestPeek = next;
			return next;
		};
	}
	if (options.receipt) {
		api.shutdownReceipt = async () => options.receipt;
	}
	if (options.fence) {
		api.fence = async () => { fenceCalls += 1; return options.fence!(); };
	}
	if (options.resume) {
		api.resume = async () => { resumeCalls += 1; return options.resume!(); };
	}
	return api;
}

const readyIdle: Snapshot = { phase: "ready", accepting: true, runningSessions: 0, remotePaired: false, generation: "g1" };
const stopped: Snapshot = { phase: "stopped", accepting: false, runningSessions: 0, remotePaired: false, generation: "g1" };

describe("Cedia application lifecycle", () => {
	it("treats an unreachable host as idle", async () => {
		const host = gateway({ lifecycle: [undefined as unknown as Snapshot], reliable: false });
		const lifecycle = createCediaAppLifecycle({
			gateway: host,
			confirmStopAndQuit: async () => "stop",
		});

		const result = await lifecycle.tryQuit();

		expect(result.outcome).toBe("idle");
		expect(result.status.phase).toBe("unreachable");
		expect(host.quitCalls).toBe(0);
	});

	it("reports stopped only after lifecycle reports non-accepting", async () => {
		const host = gateway({ lifecycle: [readyIdle, { ...readyIdle, phase: "quitting" }, stopped] });
		const lifecycle = createCediaAppLifecycle({
			gateway: host,
			confirmStopAndQuit: async () => "stop",
			sleep: async () => {},
			maxPollAttempts: 3,
		});

		const result = await lifecycle.tryQuit();

		expect(result.outcome).toBe("stopped");
		expect(result.status.accepting).toBe(false);
		expect(host.quitCalls).toBe(1);
	});

	it("closes host admission before asking, and reopens it when the owner cancels", async () => {
		const order: string[] = [];
		const host = gateway({
			peek: [{ ...readyIdle, runningSessions: 1 }],
			lifecycle: [readyIdle],
			fence: () => { order.push("fence"); return { accepted: true, changed: true, phase: "quitting" }; },
			resume: () => { order.push("resume"); return { accepted: true, changed: true, phase: "ready" }; },
		});
		const lifecycle = createCediaAppLifecycle({
			gateway: host,
			confirmStopAndQuit: async () => { order.push("prompt"); return "cancel"; },
		});

		const result = await lifecycle.tryQuit();

		expect(result.outcome).toBe("cancelled");
		// The decision window is closed on both sides: the fence precedes the prompt, and the
		// reopen follows the cancel, so no new work is admitted while the owner is asked.
		expect(order).toEqual(["fence", "prompt", "resume"]);
		expect(host.quitCalls).toBe(0);
		// The cancel republished the reopened host, so the surface does not keep showing a
		// fenced host after the owner chose to stay.
		expect(lifecycle.status().accepting).toBe(true);
		expect(lifecycle.status().phase).toBe("ready");
	});

	it("stops from an already fenced host without opening admission again", async () => {
		const host = gateway({
			peek: [{ ...readyIdle, runningSessions: 1 }],
			lifecycle: [stopped],
			fence: () => ({ accepted: true, changed: true, phase: "quitting" }),
			resume: () => { throw new Error("a confirmed quit must not reopen admission"); },
		});
		const lifecycle = createCediaAppLifecycle({
			gateway: host,
			confirmStopAndQuit: async () => "stop",
			sleep: async () => {},
			maxPollAttempts: 2,
		});

		const result = await lifecycle.tryQuit();

		expect(result.outcome).toBe("stopped");
		expect(host.fenceCalls).toBe(1);
		expect(host.resumeCalls).toBe(0);
	});

	it("does not ask about a quit whose admission never closed", async () => {
		const host = gateway({
			peek: [{ ...readyIdle, runningSessions: 1 }],
			fence: () => { throw new Error("host is unreachable"); },
		});
		let confirmations = 0;
		const lifecycle = createCediaAppLifecycle({
			gateway: host,
			confirmStopAndQuit: async () => { confirmations += 1; return "stop"; },
		});

		const result = await lifecycle.tryQuit();

		expect(result.outcome).toBe("failed");
		expect(result.error).toMatch(/admission/i);
		// Reporting a safe decision window the host never had would be a lie, so nothing is asked.
		expect(confirmations).toBe(0);
		expect(host.quitCalls).toBe(0);
	});

	it("reports a cancelled quit whose admission did not reopen", async () => {
		const host = gateway({
			peek: [{ ...readyIdle, runningSessions: 1 }],
			fence: () => ({ accepted: true, changed: true, phase: "quitting" }),
			resume: () => { throw new Error("host vanished during the decision"); },
		});
		let confirmations = 0;
		const lifecycle = createCediaAppLifecycle({
			gateway: host,
			confirmStopAndQuit: async () => { confirmations += 1; return "cancel"; },
		});

		const result = await lifecycle.tryQuit();

		expect(result.outcome).toBe("failed");
		expect(result.error).toMatch(/did not reopen admission/i);
		expect(confirmations).toBe(1);
		expect(host.quitCalls).toBe(0);
	});

	it("does not fence a quit that has nothing to decide", async () => {
		const host = gateway({
			peek: [readyIdle],
			lifecycle: [stopped],
			fence: () => { throw new Error("an idle quit must not need a fence"); },
		});
		const lifecycle = createCediaAppLifecycle({
			gateway: host,
			confirmStopAndQuit: async () => { throw new Error("an idle quit must not ask"); },
			sleep: async () => {},
			maxPollAttempts: 2,
		});

		const result = await lifecycle.tryQuit();

		expect(result.outcome).toBe("stopped");
		expect(host.fenceCalls).toBe(0);
	});

	it("asks before stopping active work and leaves the host untouched on cancel", async () => {
		const host = gateway({ lifecycle: [{ ...readyIdle, runningSessions: 1 }] });
		let confirmation = 0;
		const lifecycle = createCediaAppLifecycle({
			gateway: host,
			readDirtyEditors: () => 2,
			confirmStopAndQuit: async state => {
				confirmation += 1;
				expect(state.runningSessions).toBe(1);
				expect(state.dirtyEditors).toBe(2);
				return "cancel";
			},
		});

		const result = await lifecycle.tryQuit();

		expect(result.outcome).toBe("cancelled");
		expect(confirmation).toBe(1);
		expect(host.quitCalls).toBe(0);
		expect(result.status.busy).toBe(false);
	});

	it("proceeds after active work is confirmed to stop", async () => {
		const host = gateway({ lifecycle: [{ ...readyIdle, runningSessions: 1 }, stopped] });
		const lifecycle = createCediaAppLifecycle({
			gateway: host,
			confirmStopAndQuit: async () => "stop",
			sleep: async () => {},
			maxPollAttempts: 2,
		});

		const result = await lifecycle.tryQuit();

		expect(result.outcome).toBe("stopped");
		expect(host.quitCalls).toBe(1);
	});

	it("fails when the host keeps accepting after the quit request", async () => {
		const host = gateway({ lifecycle: [readyIdle, readyIdle, readyIdle] });
		const lifecycle = createCediaAppLifecycle({
			gateway: host,
			confirmStopAndQuit: async () => "stop",
			sleep: async () => {},
			maxPollAttempts: 2,
		});

		const result = await lifecycle.tryQuit();

		expect(result.outcome).toBe("failed");
		expect(result.error).toMatch(/accepting|shutdown/i);
		expect(result.status.accepting).toBe(true);
		expect(host.quitCalls).toBe(1);
	});

	it("never starts a host just to quit when none is running", async () => {
		const host = gateway({ peek: [undefined] });
		const lifecycle = createCediaAppLifecycle({
			gateway: host,
			confirmStopAndQuit: async () => "stop",
		});

		const result = await lifecycle.tryQuit();

		expect(result.outcome).toBe("idle");
		expect(host.ensureCalls).toBe(0);
		expect(host.quitCalls).toBe(0);
	});

	it("reports stopped when an acknowledged quit removes the listener and leaves the receipt", async () => {
		const host = gateway({
			peek: [readyIdle],
			lifecycle: [undefined as unknown as Snapshot, undefined as unknown as Snapshot],
			receipt: { phase: "stopped" },
		});
		const lifecycle = createCediaAppLifecycle({
			gateway: host,
			confirmStopAndQuit: async () => "stop",
			sleep: async () => {},
			maxPollAttempts: 3,
		});

		const result = await lifecycle.tryQuit();

		expect(result.outcome).toBe("stopped");
		expect(result.status.accepting).toBe(false);
		expect(host.quitCalls).toBe(1);
	});

	it("fails when the listener disappears without a durable stopped receipt", async () => {
		const host = gateway({ peek: [readyIdle], lifecycle: [undefined as unknown as Snapshot] });
		const lifecycle = createCediaAppLifecycle({
			gateway: host,
			confirmStopAndQuit: async () => "stop",
			sleep: async () => {},
			maxPollAttempts: 2,
		});

		const result = await lifecycle.tryQuit();

		expect(result.outcome).toBe("failed");
		expect(result.error).toMatch(/unavailable|shutdown/i);
	});

	it("fails visibly when the host refuses the shutdown request", async () => {
		const host = gateway({ peek: [readyIdle], quit: async () => ({ accepted: false }) });
		const lifecycle = createCediaAppLifecycle({
			gateway: host,
			confirmStopAndQuit: async () => "stop",
			sleep: async () => {},
		});

		const result = await lifecycle.tryQuit();

		expect(result.outcome).toBe("failed");
		expect(result.error).toMatch(/refused/i);
	});

	it("allows the quit only after the host actually stopped", async () => {
		const host = gateway({ peek: [{ ...readyIdle, runningSessions: 1 }], lifecycle: [stopped] });
		let confirmations = 0;
		const lifecycle = createCediaAppLifecycle({
			gateway: host,
			confirmStopAndQuit: async () => { confirmations += 1; return "stop"; },
			sleep: async () => {},
			maxPollAttempts: 2,
		});
		const decide = createCediaQuitDecision({ lifecycle, windowsOpen: () => 1 });

		expect(await decide()).toBe(true);
		expect(confirmations).toBe(1);
		expect(host.quitCalls).toBe(1);
	});

	it("refuses the quit when the owner cancels, before anything is stopped", async () => {
		const host = gateway({ peek: [{ ...readyIdle, runningSessions: 1 }], lifecycle: [readyIdle] });
		const lifecycle = createCediaAppLifecycle({
			gateway: host,
			confirmStopAndQuit: async () => "cancel",
			sleep: async () => {},
		});
		const decide = createCediaQuitDecision({ lifecycle, windowsOpen: () => 1 });

		expect(await decide()).toBe(false);
		// Cancel must not be a stop with a different label: the host was never asked
		// to shut down, so nothing is half-committed and the next Quit asks again.
		expect(host.quitCalls).toBe(0);
		expect(await decide()).toBe(false);
		expect(host.quitCalls).toBe(0);
	});

	it("decides without a window, because there is no surface to ask on", async () => {
		const host = gateway({ lifecycle: [readyIdle] });
		let confirmations = 0;
		const lifecycle = createCediaAppLifecycle({
			gateway: host,
			confirmStopAndQuit: async () => { confirmations += 1; return "cancel"; },
			sleep: async () => {},
		});
		const decide = createCediaQuitDecision({ lifecycle, windowsOpen: () => 0 });

		expect(await decide()).toBe(true);
		expect(confirmations).toBe(0);
		expect(host.quitCalls).toBe(0);
	});
});

describe("Cedia application shutdown join", () => {
	it("stops the host without asking again once shutdown is committed", async () => {
		const host = gateway({ peek: [{ ...readyIdle, runningSessions: 2 }], lifecycle: [stopped] });
		let confirmations = 0;
		const lifecycle = createCediaAppLifecycle({
			gateway: host,
			readDirtyEditors: () => 1,
			confirmStopAndQuit: async () => { confirmations += 1; return "cancel"; },
			sleep: async () => {},
			maxPollAttempts: 2,
		});
		const logs: string[] = [];
		const join = createCediaShutdownJoin({ lifecycle, log: message => logs.push(message) });

		await join();

		expect(confirmations).toBe(0);
		expect(host.quitCalls).toBe(1);
		expect(logs.join("\n")).toContain("stopped");
	});

	it("logs a host that could not be stopped and still resolves, once", async () => {
		const host = gateway({ peek: [readyIdle], lifecycle: [readyIdle, readyIdle] });
		const lifecycle = createCediaAppLifecycle({
			gateway: host,
			confirmStopAndQuit: async () => "stop",
			sleep: async () => {},
			maxPollAttempts: 2,
		});
		const logs: string[] = [];
		const join = createCediaShutdownJoin({ lifecycle, log: message => logs.push(message) });

		await join();
		await join();

		expect(host.quitCalls).toBe(1);
		expect(logs.join("\n")).toMatch(/did not confirm/i);
	});
});

describe("Cedia login item", () => {
	it("never registers a development binary", () => {
		let writes = 0;
		const result = registerCediaLoginItem({ isPackaged: false, setLoginItemSettings: () => { writes += 1; } });
		expect(result.enabled).toBe(false);
		expect(writes).toBe(0);
		expect(result.reason).toMatch(/packaged/i);
	});

	it("registers a packaged build hidden, and reports a failure instead of throwing", () => {
		const settings: unknown[] = [];
		expect(registerCediaLoginItem({ isPackaged: true, setLoginItemSettings: value => { settings.push(value); } })).toEqual({ enabled: true });
		expect(settings).toEqual([{ openAtLogin: true, openAsHidden: true }]);
		const logs: string[] = [];
		const failed = registerCediaLoginItem({
			isPackaged: true,
			setLoginItemSettings: () => { throw new Error("SMAppService denied"); },
			log: message => logs.push(message),
		});
		expect(failed.enabled).toBe(false);
		expect(failed.reason).toContain("SMAppService denied");
		expect(logs.join("\n")).toContain("not registered");
	});
});

describe("Cedia login launch", () => {
	it("keeps a login launch in the background unless it was given something to open", () => {
		expect(shouldOpenFirstWindowAtLaunch({ isPackaged: true, wasOpenedAtLogin: true, hasOpenableArguments: false })).toBe(false);
		expect(shouldOpenFirstWindowAtLaunch({ isPackaged: true, wasOpenedAtLogin: true, hasOpenableArguments: true })).toBe(true);
		expect(shouldOpenFirstWindowAtLaunch({ isPackaged: false, wasOpenedAtLogin: true, hasOpenableArguments: false })).toBe(true);
		expect(shouldOpenFirstWindowAtLaunch({ isPackaged: true, wasOpenedAtLogin: false, hasOpenableArguments: false })).toBe(true);
	});
});

describe("Cedia dirty editor IPC", () => {
	it("rejects dirty counts when the host has not supplied a trusted sender check", () => {
		const sender = { once: () => {}, removeListener: () => {} };
		const reader = createCediaDirtyEditorReader();
		reader.update({ sender }, 7);
		expect(reader.read()).toBe(0);
		reader.dispose();
	});

	it("publishes each trusted workbench count and removes it when its sender is destroyed", () => {
		const destroyed = new Map<object, () => void>();
		const senderA = {
			once: (_event: "destroyed", listener: () => void) => { destroyed.set(senderA, listener); },
			removeListener: () => {},
		};
		const senderB = {
			once: (_event: "destroyed", listener: () => void) => { destroyed.set(senderB, listener); },
			removeListener: () => {},
		};
		const reader = createCediaDirtyEditorReader({
			isTrustedSender: event => (event as { trusted?: boolean }).trusted === true,
		});

		reader.update({ sender: senderA, trusted: true }, 2);
		expect(reader.read()).toBe(2);
		reader.update({ sender: senderB, trusted: true }, 1);
		expect(reader.read()).toBe(3);
		reader.update({ sender: senderA, trusted: true }, 4);
		expect(reader.read()).toBe(5);

		reader.update({ sender: senderA, trusted: false }, 99);
		reader.update({ sender: senderA, trusted: true }, -1);
		expect(reader.read()).toBe(5);

		destroyed.get(senderA)!();
		expect(reader.read()).toBe(1);
		destroyed.get(senderB)!();
		expect(reader.read()).toBe(0);
		reader.dispose();
	});

	it("feeds the registered IPC listener into lifecycle status and unregisters it", async () => {
		let listener: ((event: unknown, ...args: unknown[]) => void) | undefined;
		let removed: ((event: unknown, ...args: unknown[]) => void) | undefined;
		let destroyed: (() => void) | undefined;
		const sender = {
			once: (_event: "destroyed", callback: () => void) => { destroyed = callback; },
			removeListener: () => {},
		};
		const installed = installCediaMainProcessLifecycle({
			appRoot: "/checkout",
			parentPid: process.pid,
			gateway: gateway({ lifecycle: [readyIdle] }),
			ipcMain: {
				on: (channel, callback) => { expect(channel).toBe(CEDIA_DIRTY_EDITORS_CHANNEL); listener = callback; },
				removeListener: (channel, callback) => { expect(channel).toBe(CEDIA_DIRTY_EDITORS_CHANNEL); removed = callback; },
			},
			isTrustedWorkbenchSender: event => (event as { trusted?: boolean }).trusted === true,
			lifecycleMainService: { onWillShutdown: () => {} },
			electronApp: { isPackaged: false, setLoginItemSettings: () => {}, getLoginItemSettings: () => ({}) },
		});

		listener!({ sender, trusted: true }, 3);
		expect((await installed.lifecycle.refresh()).dirtyEditors).toBe(3);
		destroyed!();
		expect((await installed.lifecycle.refresh()).dirtyEditors).toBe(0);
		installed.dispose();
		expect(removed).toBe(listener);
	});
});

describe("Cedia main-process lifecycle wiring", () => {
	it("joins shutdown, registers the login item and decides the login window", async () => {
		const listeners: Array<(event: { join(id: string, promise: Promise<void>): void }) => void> = [];
		const joined: Promise<void>[] = [];
		const loginWrites: unknown[] = [];
		const host = gateway({ peek: [readyIdle], lifecycle: [stopped] });
		const installed = installCediaMainProcessLifecycle({
			appRoot: "/Applications/Cedia.app/Contents/Resources/app",
			parentPid: process.pid,
			gateway: host,
			lifecycleMainService: { onWillShutdown: listener => { listeners.push(listener); } },
			electronApp: {
				isPackaged: true,
				setLoginItemSettings: settings => { loginWrites.push(settings); },
				getLoginItemSettings: () => ({ openAtLogin: true, wasOpenedAtLogin: true }),
			},
		});

		expect(installed.loginItem.enabled).toBe(true);
		expect(loginWrites).toEqual([{ openAtLogin: true, openAsHidden: true }]);
		expect(installed.shouldOpenFirstWindow(false)).toBe(false);
		expect(installed.shouldOpenFirstWindow(true)).toBe(true);
		expect(listeners.length).toBe(1);

		listeners[0]!({ join: (_id, promise) => joined.push(promise) });
		expect(joined.length).toBe(1);
		await joined[0];
		expect(host.quitCalls).toBe(1);
		installed.dispose();
	});

	it("asks the owner through a real dialog before it lets a quit stop running work", async () => {
		const deciders: Array<() => Promise<boolean>> = [];
		const dialogs: Array<{ message: string; detail?: string; buttons: readonly string[] }> = [];
		const logs: string[] = [];
		const host = gateway({ peek: [{ ...readyIdle, runningSessions: 2, remotePaired: true }], lifecycle: [stopped] });
		const installed = installCediaMainProcessLifecycle({
			appRoot: "/Applications/Cedia.app/Contents/Resources/app",
			parentPid: process.pid,
			gateway: host,
			lifecycleMainService: {
				onWillShutdown: () => {},
				registerQuitDecider: decider => { deciders.push(decider); return { dispose: () => { deciders.length = 0; } }; },
			},
			log: message => logs.push(message),
			windowsOpen: () => 1,
			electronDialog: {
				showMessageBox: async options => {
					dialogs.push({ message: options.message, ...(options.detail === undefined ? {} : { detail: options.detail }), buttons: options.buttons });
					return { response: 0 };
				},
			},
			electronApp: {
				isPackaged: true,
				setLoginItemSettings: () => {},
				getLoginItemSettings: () => ({}),
			},
		});

		expect(deciders.length).toBe(1);
		expect(await deciders[0]!()).toBe(true);
		expect(dialogs.length).toBe(1);
		expect(dialogs[0]!.buttons).toEqual(["Stop and Quit", "Cancel"]);
		expect(dialogs[0]!.detail).toContain("2 tasks are still running");
		expect(dialogs[0]!.detail).toContain("paired device");
		expect(host.quitCalls).toBe(1);

		// An unanswered prompt is not consent: a dialog that cannot be shown keeps the
		// application running and says why.
		const failing = gateway({ peek: [{ ...readyIdle, runningSessions: 1 }] });
		const failingLogs: string[] = [];
		const second = installCediaMainProcessLifecycle({
			appRoot: "/Applications/Cedia.app/Contents/Resources/app",
			parentPid: process.pid,
			gateway: failing,
			lifecycleMainService: { onWillShutdown: () => {}, registerQuitDecider: decider => { deciders.push(decider); return { dispose: () => {} }; } },
			log: message => failingLogs.push(message),
			windowsOpen: () => 1,
			electronDialog: { showMessageBox: async () => { throw new Error("no display"); } },
			electronApp: { isPackaged: true, setLoginItemSettings: () => {}, getLoginItemSettings: () => ({}) },
		});
		expect(await deciders.at(-1)!()).toBe(false);
		expect(failing.quitCalls).toBe(0);
		expect(failingLogs.join("\n")).toContain("could not ask about quitting");
		expect(installed.dispose).toBeTypeOf("function");
		second.dispose();
	});

	it("neither registers a login item nor suppresses the window for a development launch", () => {
		const installed = installCediaMainProcessLifecycle({
			appRoot: "/checkout",
			parentPid: process.pid,
			gateway: gateway({}),
			lifecycleMainService: { onWillShutdown: () => {} },
			electronApp: {
				isPackaged: false,
				setLoginItemSettings: () => { throw new Error("must not be called"); },
				getLoginItemSettings: () => ({ wasOpenedAtLogin: true }),
			},
		});

		expect(installed.loginItem.enabled).toBe(false);
		expect(installed.shouldOpenFirstWindow(false)).toBe(true);
	});
});
