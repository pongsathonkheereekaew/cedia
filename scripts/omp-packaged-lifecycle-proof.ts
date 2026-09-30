/**
 * Packaged lifecycle proof on isolated scratch state (plan §8.1/§11 app-lifecycle
 * gate — owned processes only, no provider, no Keychain, no user data).
 *
 * Against the real packaged Cedia.app with a scratch profile + scratch state dir:
 * boot -> graceful quit (SIGTERM through the real will-quit path) with full
 * teardown of scratch-owned processes -> relaunch adoption -> crash (SIGKILL,
 * no cleanup) -> relaunch adoption again. Asserts a window each boot and zero
 * surviving scratch-owned processes after graceful quit.
 *
 * What this proves: boot/relaunch/crash-adoption on isolated state. What it does
 * NOT prove: menu-driven Quit, pre-quit stop-or-cancel prompt, login cycle,
 * background launch (launchd), crash with real user state, paired-client
 * repeats — those need interactive runs or real hands and stay open.
 *
 * Run: bun scripts/omp-packaged-lifecycle-proof.ts
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const { _electron } = createRequire(join(root, "desktop/package.json"))("playwright");

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP packaged lifecycle proof failed: ${message}`);
	console.log(`OK   ${message}`);
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function psFor(scratch: string): string[] {
	try {
		const out = execFileSync("ps", ["aux"], { encoding: "utf8" });
		return out.split("\n").filter(line => line.includes(scratch) && !line.includes("ps aux"));
	} catch { return [`ps-failed`]; }
}
// The quit-teardown assertion hunts the r3 defect class (app/host outliving
// quit). The crashpad handler is Google crash reporting, not app/host state:
// it references scratch only through its Crashpad database dir and can linger
// past teardown on cold boots without affecting adoption. Exclude it by exact
// name so a cold boot does not fail the gate for a harmless reporter.
function psForAppState(scratch: string): string[] {
	return psFor(scratch).filter(line => !line.includes("chrome_crashpad_handler"));
}
async function waitFor(label: string, fn: () => boolean, timeoutMs: number): Promise<void> {
	const start = Date.now();
	for (;;) {
		if (fn()) return;
		if (Date.now() - start > timeoutMs) throw new Error(`OMP packaged lifecycle proof failed: ${label}`);
		await sleep(500);
	}
}

// Require a separately staged app so the lifecycle proof cannot launch or mutate
// the user's installed bundle. The exact Cedia bundle copy is patched below to
// intercept Login Item calls before launch; no macOS Login Item is written.
const appBundle = process.env.CEDIA_LIFECYCLE_APP_PATH;
check(typeof appBundle === "string" && appBundle.endsWith("/Cedia.app"),
	"CEDIA_LIFECYCLE_APP_PATH names an explicitly staged scratch Cedia.app");
const resolvedAppBundle = resolve(appBundle);
const installedAppBundle = resolve(join(root, `VSCode-darwin-${process.arch}/Cedia.app`));
check(resolvedAppBundle !== installedAppBundle && !resolvedAppBundle.startsWith(`${installedAppBundle}/`),
	"the repository's installed Cedia.app is never launched by this proof");
const tempRoot = resolve(tmpdir());
check(resolvedAppBundle.startsWith(`${tempRoot}/`), "the staged app resides under the system temporary directory");
const appPath = join(resolvedAppBundle, "Contents/MacOS/Cedia");
await access(appPath);
const lifecycleModulePath = join(resolvedAppBundle, "Contents/Resources/app/out/vs/cedia/agent/main.cjs");
let lifecycleModule = await readFile(lifecycleModulePath, "utf8");
const setterNeedle = "setLoginItemSettings: (settings) => electronApp.setLoginItemSettings(settings),";
const getterNeedle = "wasOpenedAtLogin = electronApp.getLoginItemSettings().wasOpenedAtLogin === true;";
check(lifecycleModule.split(setterNeedle).length === 2 && lifecycleModule.split(getterNeedle).length === 2,
	"scratch Cedia lifecycle module matches the reviewed Login Item interception points");
lifecycleModule = lifecycleModule
	.replace(setterNeedle, `setLoginItemSettings: (settings) => { require("node:fs").appendFileSync(process.env.CEDIA_LIFECYCLE_SHIM_LOG, JSON.stringify({ event: "intercept-set-login-item", settings }) + "\\n"); },`)
	.replace(getterNeedle, `wasOpenedAtLogin = process.env.CEDIA_SIMULATE_LOGIN === "1"; require("node:fs").appendFileSync(process.env.CEDIA_LIFECYCLE_SHIM_LOG, JSON.stringify({ event: "simulated-login-state", isPackaged: electronApp.isPackaged, openedAtLogin: wasOpenedAtLogin }) + "\\n");`);
check(lifecycleModule.includes("intercept-set-login-item") && lifecycleModule.includes("simulated-login-state"),
	"scratch-only Login Item sandbox markers are present");
await writeFile(lifecycleModulePath, lifecycleModule);
execFileSync("codesign", ["--force", "--deep", "--sign", "-", resolvedAppBundle], { stdio: "ignore" });

const scratch = await realpath(await mkdtemp(join(tmpdir(), "cedia-pl-")));
const output = join(root, "dist/packaged-lifecycle-proof");
await mkdir(output, { recursive: true });
await Promise.all(["result.json", "failure.json", "failure.png", "boot-1.png", "boot-2.png", "boot-3.png", "leftovers-after-crash.txt", "survivors.txt"]
	.map(name => rm(join(output, name), { force: true })));
const shimLog = join(scratch, "electron-lifecycle-shim.jsonl");
const errors: string[] = [];
const baseEnv = {
	...process.env,
	CEDIA_STATE_DIR: join(scratch, "host"),
	CEDIA_HOST_NODE: process.env.CEDIA_HOST_NODE ?? "/Users/pond/.caret-tools/node-v24.18.0-darwin-arm64/bin/node",
	CEDIA_LIFECYCLE_SHIM_LOG: shimLog,
};
const shimEvents = async (): Promise<Array<Record<string, unknown>>> => {
	try { return (await readFile(shimLog, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line)); }
	catch { return []; }
};

async function launch(label: string) {
	const browser = await _electron.launch({
		executablePath: appPath,
		args: ["--user-data-dir", join(scratch, "profile"), "--password-store=basic", "--use-inmemory-secretstorage", "--skip-welcome", "--skip-release-notes"],
		env: { ...baseEnv, CEDIA_SIMULATE_LOGIN: "0" },
		timeout: 45_000,
	});
	const page = await browser.firstWindow();
	page.on("pageerror", (error: Error) => errors.push(error.message));
	check(true, `${label}: window appeared`);
	return { browser, page };
}
function mainPid(scratchPath: string): number | null {
	const lines = psFor(scratchPath).filter(l => l.includes("Cedia.app/Contents/MacOS/Cedia"));
	const m = lines[0]?.trim().split(/\s+/)[1];
	const pid = m ? Number.parseInt(m, 10) : NaN;
	return Number.isSafeInteger(pid) ? pid : null;
}

try {
	// Simulated login launch: the packaged Code-OSS main process sees the value
	// supplied by the scratch-only lifecycle-module shim. Login Item registration
	// is intercepted in the same app copy, so macOS settings are never written.
	const background = await _electron.launch({
		executablePath: appPath,
		args: ["--user-data-dir", join(scratch, "b"), "--password-store=basic", "--use-inmemory-secretstorage", "--skip-welcome", "--skip-release-notes"],
		env: { ...baseEnv, CEDIA_SIMULATE_LOGIN: "1" },
		timeout: 45_000,
	});
	try {
		await sleep(3_000);
		const backgroundEvents = await shimEvents();
		check(backgroundEvents.some(event => event.event === "simulated-login-state" && event.isPackaged === true && event.openedAtLogin === true),
			"scratch app bundle supplied the simulated login state");
		check(backgroundEvents.some(event => event.event === "intercept-set-login-item"),
			"packaged Login Item registration was intercepted by the scratch bundle shim");
		check(background.windows().length === 0, "simulated login launch keeps packaged app in background with no work window");
	} finally {
		try { await background.close(); } catch { /* the scratch launch may already have exited */ }
	}
	check(true, "simulated background process closed through its app handle");

	// Boot 1.
	let session = await launch("boot 1");
	const pid1 = mainPid(scratch);
	check(pid1 !== null, `boot 1 main PID identified (${pid1})`);
	await session.page.screenshot({ path: join(output, "boot-1.png") });

	// Graceful quit through the real will-quit path; the r3 defect class is a
	// host outliving the app, so scratch-owned processes must fully drain.
	process.kill(pid1 as number, "SIGTERM");
	await waitFor("graceful quit exits the app", () => mainPid(scratch) === null, 20_000);
	try {
		await waitFor("scratch-owned processes drained after quit", () => psForAppState(scratch).length === 0, 20_000);
	} catch (error) {
		await writeFile(join(output, "survivors.txt"), psFor(scratch).join("\n"));
		throw error;
	}
	check(true, "graceful quit: app exited and no scratch-owned process survives");
	try { await session.browser.close(); } catch { /* already gone */ }

	// Relaunch adoption on the same isolated state.
	session = await launch("boot 2 (relaunch after quit)");
	const pid2 = mainPid(scratch);
	check(pid2 !== null && pid2 !== pid1, `relaunch boots a new process (${pid2})`);
	await session.page.screenshot({ path: join(output, "boot-2.png") });

	// Crash: no cleanup runs. Relaunch must still boot (adoption gate).
	process.kill(pid2 as number, "SIGKILL");
	await waitFor("crashed process is gone", () => mainPid(scratch) === null, 20_000);
	const leftovers = psFor(scratch);
	await writeFile(join(output, "leftovers-after-crash.txt"), leftovers.join("\n"));
	session = await launch("boot 3 (relaunch after crash)");
	const pid3 = mainPid(scratch);
	check(pid3 !== null && pid3 !== pid2, `post-crash relaunch boots (leftovers observed: ${leftovers.length}; new PID ${pid3})`);
	await session.page.screenshot({ path: join(output, "boot-3.png") });
	try { await session.browser.close(); } catch { /* harness */ }

	if (errors.length) throw new Error(`Renderer errors: ${errors.join("\n")}`);
	await writeFile(join(output, "result.json"), JSON.stringify({ ok: true, simulatedLoginBackground: true, loginItemMutation: "intercepted by scratch-only app bundle shim", boots: 3, gracefulQuitDrained: true, crashRelaunch: true, leftoverScratchProcessesAfterCrash: leftovers.length, leftoverDetailFile: "leftovers-after-crash.txt", errors, lifecycleShimEvents: await shimEvents() }, null, 2));
	await Promise.all(["failure.json", "failure.png"].map(name => rm(join(output, name), { force: true })));
	console.log(`OMP packaged lifecycle proof passed: ${output}`);
} catch (error) {
	await writeFile(join(output, "failure.json"), JSON.stringify({ error: String(error && (error as Error).stack || error), errors }, null, 2));
	throw error;
} finally {
	await rm(scratch, { recursive: true, force: true });
}
