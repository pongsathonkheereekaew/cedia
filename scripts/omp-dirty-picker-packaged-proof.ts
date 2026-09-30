/**
 * Packaged dirty-file picker proof (D close-out): real clicks in Cedia.app.
 *
 * Same topology as scripts/agent-window-smoke.ts --native: an in-process host
 * (fixture OMP, scratch state dir) registers the fixture project, then the
 * packaged app attaches to it via CEDIA_STATE_DIR. Drives the Agents window:
 * open the fixture project, new thread, switch env to worktree mode, uncheck
 * drop.txt in the picker, send, then assert the created worktree carries
 * keep.txt's modification and NOT drop.txt's.
 *
 * Run: bun scripts/omp-dirty-picker-packaged-proof.ts
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startHostServer } from "../apps/host/src/server.ts";

const FAIL_PREFIX = "OMP dirty-picker packaged proof failed";
function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`${FAIL_PREFIX}: ${message}`);
	console.log(`OK   ${message}`);
}
type Clickable = { click(o?: unknown): Promise<void> };
type TextBox = Clickable & {
	waitFor(o?: unknown): Promise<void>;
	innerText(): Promise<string>;
	isChecked(): Promise<boolean>;
	uncheck(o?: unknown): Promise<void>;
	fill(s: string): Promise<void>;
	hover(o?: unknown): Promise<void>;
};
type Role = { first(): TextBox; count(): Promise<number> };
type Page = {
	getByRole(r: string, o?: Record<string, unknown>): Role;
	getByText(t: string | RegExp, o?: Record<string, unknown>): Role;
	getByLabel(t: string | RegExp, o?: Record<string, unknown>): Role;
	locator(s: string): Role;
	screenshot(o: Record<string, unknown>): Promise<void>;
};

const root = resolve(import.meta.dir, "..");
const { _electron } = createRequire(join(root, "desktop/package.json"))("playwright") as {
	_electron: {
		launch(opts: Record<string, unknown>): Promise<{
			firstWindow(): Promise<unknown>;
			close(): Promise<void>;
		}>;
	};
};

const scratch = await mkdtemp(join(tmpdir(), "cedia-dirty-picker-pkg-"));
const projectPath = join(scratch, "project");
await mkdir(projectPath, { recursive: true });
const git = (args: string[]) =>
	execFileSync("git", args, { cwd: projectPath, encoding: "utf8", timeout: 30_000 });
await writeFile(join(projectPath, "keep.txt"), "base\n");
await writeFile(join(projectPath, "drop.txt"), "base\n");
git(["init", "-q"]);
git(["config", "user.email", "fixture@cedia"]);
git(["config", "user.name", "Cedia Fixture"]);
git(["add", "."]);
git(["commit", "-qm", "fixture base"]);
git(["branch", "-M", "main"]);
// Both dirty files must be TRACKED modifications: the picker lists the status working
// tree and the host carries tracked paths by diff-apply; an untracked file takes a
// different copy path and would not isolate the picker's selection semantics.
await writeFile(join(projectPath, "keep.txt"), "dirty carry me\n");
await writeFile(join(projectPath, "drop.txt"), "dirty carry me too\n");

const stateDir = join(scratch, "host");
const host = await startHostServer({
	stateDir,
	ompExecutable: join(root, "apps/macos/test/fixtures/agent-window-omp"),
	ompEnv: { CEDIA_NODE: process.execPath },
});
const project = host.host.store.createProject({ path: projectPath, name: "Dirty picker fixture" });
check(project.id.length > 0, "fixture project registered on the live host");

const output = join(root, "dist/dirty-picker-packaged-proof");
await mkdir(output, { recursive: true });

try {
	execFileSync("security", ["delete-generic-password", "-s", "Cedia Safe Storage"], { stdio: "ignore" });
} catch { /* first run has nothing to delete */ }

const app = await _electron.launch({
	executablePath: join(root, `VSCode-darwin-${process.arch}/Cedia.app/Contents/MacOS/Cedia`),
	args: [
		"--user-data-dir", join(scratch, "profile"),
		"--password-store=basic", "--use-inmemory-secretstorage",
		"--skip-welcome", "--skip-release-notes",
	],
	env: {
		...process.env,
		CEDIA_STATE_DIR: stateDir,
		CEDIA_HOST_NODE: "/Users/pond/.caret-tools/node-v24.18.0-darwin-arm64/bin/node",
	},
	timeout: 45_000,
});
const page = (await app.firstWindow()) as unknown as Page;
const shot = async (name: string) => {
	await page.screenshot({ path: join(output, `${name}.png`) });
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
try {
	await page.getByRole("button", { name: "Skip setup", exact: true }).first().click({ timeout: 15_000 }).catch(() => {});
	await page.getByText("Dirty picker fixture", { exact: true }).first().waitFor({ timeout: 60_000 });
	await shot("picker-home.png");

	// Create the thread bound to the fixture project via the row's create button
	// (same as agent-window-smoke.ts); a bare New thread stays unbound and renders
	// the "Work in a project" tab with no BranchToolbar/env chip.
	await page.getByText("Dirty picker fixture", { exact: true }).first().hover();
	await page.getByRole("button", { name: "Create new thread in Dirty picker fixture", exact: true }).first().click();
	await page.locator('[contenteditable="true"]').first().waitFor({ timeout: 30_000 });
	await shot("picker-composer.png");

	const envChip = page.getByRole("button", { name: /^(Local|Worktree)$/i });
	await envChip.first().waitFor({ timeout: 20_000 }).catch(() => {});
	const envText = await envChip.first().innerText().catch(() => "");
	console.log(`ENV-CHIP: ${envText.slice(0, 80)}`);
	if (/^local$/i.test(envText.trim())) {
		await envChip.first().click();
		await sleep(2_000);
		await shot("picker-env-menu.png");
		const dumpPage = page as unknown as {
			evaluate(fn: () => string): Promise<string>;
		};
		const menuDump = await dumpPage.evaluate(() =>
			Array.from(document.querySelectorAll('[role="menu"],[role="menuitem"],[role="menuitemradio"],[data-composer-environment-menu]'))
				.map((n) => `${n.getAttribute("role") ?? n.tagName}: ${(n.textContent ?? "").trim().slice(0, 40)}`).join(" | "));
		console.log(`ENV-MENU: ${menuDump.slice(0, 600)}`);
		await page.getByRole("menuitem", { name: /New worktree|Worktree/i }).first().click({ timeout: 10_000 });
		await sleep(2_000);
	}
	await shot("picker-worktree-mode.png");
	const pickerHeading = page.getByText(/Carry changes into worktree/i);
	await pickerHeading.first().waitFor({ timeout: 20_000 });
	check(true, "dirty picker mounted after switching to worktree mode");
	await shot("picker-mounted.png");

	const dropBox = page.getByLabel(/Carry drop\.txt into the worktree/i);
	await dropBox.first().waitFor({ timeout: 20_000 });
	check(true, "dirty picker lists drop.txt with a checkbox");
	console.log(`DROP-CHECKED-BEFORE: ${await dropBox.first().isChecked().catch(() => null)}`);
	await dropBox.first().uncheck();
	await shot("picker-unchecked-drop.png");

	const keepBox = page.getByLabel(/Carry keep\.txt into the worktree/i);
	check((await keepBox.first().isChecked().catch(() => null)) === true, "keep.txt stays checked after unchecking drop.txt");
	// Settle the branch control first (same race as agent-window-smoke.ts): the picker
	// writes the draft workspace, and filling before the toolbar settles can target an
	// element a re-render discards — silently dropping the uncheck.
	await page.getByText("Select branch").first().waitFor({ timeout: 20_000 }).catch(() => {});
	await page.locator('[contenteditable="true"]').first().fill("Dirty picker packaged proof");
	const beforeSessions = new Set(host.host.store.listSessions(project.id).map((s) => s.id));
	await page.getByRole("button", { name: "Send message", exact: true }).first().click();
	await sleep(25_000);
	await shot("picker-sent.png");

	// The send creates exactly one session: the thread's own. Identify it by set
	// difference so a stale worktree from an earlier attempt cannot mask it.
	const afterSessions = host.host.store.listSessions(project.id);
	const created = afterSessions.filter((s) => !beforeSessions.has(s.id));
	console.log(`SESSIONS: before=${beforeSessions.size} after=${afterSessions.length} created=${JSON.stringify(created.map((s) => s.id))}`);
	check(created.length === 1, `exactly one session was created by the send (got ${created.length})`);
	const createdSession = created[0]!;
	const wt = createdSession.cwd;
	console.log(`WORKTREE: ${wt}`);
	const keepContent = await readFile(join(wt, "keep.txt"), "utf8").catch(() => null);
	check(keepContent !== null && keepContent.includes("dirty carry me"), "worktree carries keep.txt modification");
	const dropContent = await readFile(join(wt, "drop.txt"), "utf8").catch(() => null);
	check(dropContent === null || !dropContent.includes("dirty carry me too"), "worktree does NOT carry drop.txt modification (unchecked in picker)");
	console.log("OMP dirty-picker packaged proof passed: picker uncheck honored in real worktree.");
} finally {
	await app.close().catch(() => {});
	await host.close().catch(() => {});
}
