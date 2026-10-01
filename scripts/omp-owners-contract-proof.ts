/**
 * Live contract proof for the CLI discovery surface (O08 CEDIA-side half).
 *
 * Starts a real Cedia host against the prepared pinned runtime, opens one live
 * session (attached controller owner) plus one idle session (absent owner), and
 * reads GET /v1/owners through the owner token. The body must parse with the
 * same strict parser the mobile client ships, and the projection must mark
 * exactly the live row discoverable with Attach offered. The fixture provider
 * points at a local endpoint that is never contacted: no provider request
 * leaves the machine - sessions are started, never prompted.
 *
 * Run: bun scripts/omp-owners-contract-proof.ts
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startHostServer } from "../apps/host/src/server.ts";
import { isDiscoverableOwner, ownerRowPresentation, parseOwnerListing } from "../apps/ios/src/core/owners.ts";

const root = resolve(import.meta.dir, "..");
const executable = process.env.CEDIA_OMP_BINARY ?? join(root, "dist/omp/omp");

function check(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`OMP owners contract proof failed: ${message}`);
	console.log(`OK   ${message}`);
}

const stateDir = mkdtempSync(join(tmpdir(), "cedia-omp-owners-"));
const profileDir = mkdtempSync(join(tmpdir(), "cedia-omp-owners-profile-"));
const workDir = mkdtempSync(join(tmpdir(), "cedia-omp-owners-work-"));
const idleDir = mkdtempSync(join(tmpdir(), "cedia-omp-owners-idle-"));
writeFileSync(
	join(profileDir, "models.yml"),
	`providers:
  cedia-owners-fixture:
    baseUrl: http://127.0.0.1:9/v1
    auth: none
    api: openai-completions
    models:
      - id: cedia-owners-fixture-model
        name: Owners contract fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 1024
`,
	{ mode: 0o600 },
);

const started = await startHostServer({
	stateDir,
	port: 0,
	ompExecutable: executable,
	ownerBridge: true,
	ompEnv: { HOME: profileDir, PI_CODING_AGENT_DIR: profileDir, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
});

try {
	const liveProject = started.host.store.createProject({ path: workDir, name: "Owners contract live" });
	const idleProject = started.host.store.createProject({ path: idleDir, name: "Owners contract idle" });
	const live = started.host.createSession(liveProject.id, "Live CLI owner");
	await started.host.startSession(live.id);
	const idle = started.host.createSession(idleProject.id, "Idle task");

	const answer = await started.router({ method: "GET", path: "/v1/owners", token: started.auth.ownerToken });
	check(answer.status === 200, "GET /v1/owners answers 200 for the owner");
	const listing = parseOwnerListing((answer as { body: unknown }).body);
	check(!listing.truncated, "two tasks fit under the listing cap");
	const liveRow = listing.owners.find(entry => entry.taskId === live.id);
	check(liveRow?.state === "attached" && liveRow.identity?.mode === "controller", "the started session reads back attached/controller");
	const idleRow = listing.owners.find(entry => entry.taskId === idle.id);
	check(idleRow?.state === "absent", "the unstarted session reads back absent");
	const discoverable = listing.owners.filter(isDiscoverableOwner);
	check(discoverable.length === 1 && discoverable[0]?.taskId === live.id, "exactly the live row is discoverable");
	check(ownerRowPresentation(liveRow!).canAttach, "the live row offers Attach");
	check(!ownerRowPresentation(idleRow!).canAttach, "the idle row offers no Attach");

	// Attach path: starting the live task again adopts instead of spawning.
	const adopted = await started.host.startSession(live.id);
	check(adopted.id === live.id, "re-start adopts the live owner in place");
} finally {
	await started.close();
	rmSync(stateDir, { recursive: true, force: true });
	rmSync(profileDir, { recursive: true, force: true });
	rmSync(workDir, { recursive: true, force: true });
	rmSync(idleDir, { recursive: true, force: true });
}
console.log(JSON.stringify({ ok: true, route: "GET /v1/owners", parser: "apps/ios/src/core/owners.ts", providerCalls: 0 }));
