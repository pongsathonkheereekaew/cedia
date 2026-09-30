/**
 * Proof of the browser-relay prerequisite chain and its headless boundary
 * (plan §8.2 O10, relay half — no provider, no model, no spend, no user profile).
 *
 * Proves, against the pinned runtime and system Chrome, each link that CAN be proven
 * headlessly plus the exact link that cannot:
 * - `install` writes the extension bundle to a throwaway dir;
 * - the daemon serves loopback and answers 503 "not connected" (honest absence);
 * - branded Google Chrome REFUSES `--load-extension` ("not allowed in Google Chrome,
 *   ignoring" in its own log), so no headless flow can complete the handshake;
 * - the relay therefore still waits after a bounded window (expected, not a failure).
 *
 * Consequence: qualifying the relay path genuinely requires the user's manual
 * unpacked install in a headed browser (chrome://extensions → Developer mode → Load
 * unpacked). Nothing here touches the user's Chrome, profile, or extensions.
 *
 * Run: bun scripts/omp-relay-smoke.ts
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { OMP_BASELINE_VERSION, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP relay smoke failed: ${message}`);
	console.log(`OK   ${message}`);
}

const requested = process.env.CEDIA_OMP_PATH ?? process.env.CEDIA_OMP_BINARY ?? "dist/omp/omp";
const executable = requested.includes("/") ? resolve(requested) : requested;
const version = execFileSync(executable, ["--version"], { encoding: "utf8", timeout: 20_000 }).trim();
check(isSupportedOmpVersion(version), `the runtime is the pinned ${OMP_BASELINE_VERSION} or later (${version})`);

const work = await mkdtemp(join(tmpdir(), "cedia-relay-"));
const extDir = join(work, "ext");
execFileSync(executable, ["browser-relay", "install", "--dir", extDir], { encoding: "utf8", timeout: 30_000 });
check(true, "the relay extension installs to a throwaway dir (user profile untouched)");

// Unclaimed by the user's live headed extension (which watches the default 9224):
// probing absence on 9224 would race the real extension and flake 503 into 200.
const PORT = 9333;
let relay: ChildProcess | undefined;
let chrome: ChildProcess | undefined;
const chromeLog: string[] = [];
try {
	relay = spawn(executable, ["browser-relay", "-p", String(PORT)], { stdio: "ignore" });
	await new Promise(resolve => setTimeout(resolve, 2000));
	const version = await fetch(`http://127.0.0.1:${PORT}/json/version`);
	check(version.status === 503, `the daemon serves loopback and reports honest absence (${version.status})`);
	const body = (await version.json()) as { error?: string };
	check(typeof body.error === "string" && body.error.includes("not connected"), `absence carries its reason (${JSON.stringify(body).slice(0, 80)})`);

	chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
		"--headless=new",
		"--no-sandbox",
		"--disable-gpu",
		"--enable-logging=stderr",
		`--user-data-dir=${join(work, "profile")}`,
		`--load-extension=${extDir}`,
		"about:blank",
	], { stdio: ["ignore", "pipe", "pipe"] });
	chrome.stdout?.on("data", chunk => chromeLog.push(String(chunk)));
	chrome.stderr?.on("data", chunk => chromeLog.push(String(chunk)));
	await new Promise(resolve => setTimeout(resolve, 10000));
	const joined = chromeLog.join(" ");
	check(joined.includes("--load-extension is not allowed in Google Chrome"), "branded Chrome refuses CLI extension load (its own words)");
	const stillWaiting = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).status;
	check(stillWaiting === 503, "with no loadable extension the relay still waits (expected boundary, not a failure)");
} finally {
	chrome?.kill();
	relay?.kill();
	await rm(work, { recursive: true, force: true });
}
console.log(JSON.stringify({ ok: true, boundary: "manual unpacked install in a headed browser" }));
