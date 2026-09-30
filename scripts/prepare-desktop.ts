import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, normalize, resolve, sep } from "node:path";

const root = resolve(import.meta.dir, "..");
const desktop = join(root, "desktop");
const manifest = JSON.parse(readFileSync(join(root, "patches/desktop/manifest.json"), "utf8"));

if (execFileSync("git", ["rev-parse", "HEAD"], { cwd: desktop, encoding: "utf8" }).trim() !== manifest.baseRevision)
  throw new Error("Code-OSS base differs from the reviewed Cedia pin");

// Patch sets overlap: a later patch may rewrite lines an earlier patch added
// (0011's model-picker block was extended by 0043/0045), so per-patch
// reverse-check cannot prove "already applied" for every patch once the whole
// set is on. The stamp proves the whole set instead: it is written only after
// a full successful apply, and `git clean` on reset deletes it, so a reset
// always re-prepares. Drift inside the checkout is caught by the
// desktop-patch-set test's mirror comparison, not here.
const manifestDigest = createHash("sha256").update(JSON.stringify([
  manifest.baseRevision,
  manifest.patches.map((patch: { file: string; sha256: string }) => [patch.file, patch.sha256]),
])).digest("hex");

/** Every path a patch touches, read from its `diff --git` headers. */
function filesOfPatch(file: string): string[] {
	return [...readFileSync(join(root, "patches/desktop", file), "utf8").matchAll(/^diff --git a\/(\S+) b\//gm)].map(match => match[1]!);
}

/**
 * True when the checkout is exactly the pinned base plus this patch set.
 *
 * Copying only the touched files keeps the proof cheap. Undoing the set in reverse
 * manifest order can only succeed when every hunk sits where the patches left it,
 * which is the same property `apps/macos/test/desktop-patch-set.test.ts` asserts
 * forward; the removals are checked directly.
 */
function patchSetReversesFromCheckout(): boolean {
	const work = mkdtempSync(join(tmpdir(), "cedia-patch-verify-"));
	try {
		for (const entry of (manifest.removals ?? []) as string[]) {
			if (existsSync(join(desktop, entry))) return false;
		}
		const touched = new Set((manifest.patches as { file: string }[]).flatMap(patch => filesOfPatch(patch.file)));
		for (const file of touched) {
			const source = join(desktop, file);
			if (!existsSync(source)) return false;
			mkdirSync(dirname(join(work, file)), { recursive: true });
			copyFileSync(source, join(work, file));
		}
		for (const patch of [...(manifest.patches as { file: string }[])].reverse()) {
			execFileSync("git", ["apply", "--reverse", join(root, "patches/desktop", patch.file)], { cwd: work, stdio: "pipe" });
		}
		// Undoing the set is only enough when what is left is the pinned base byte for
		// byte; otherwise the checkout carries content no patch explains.
		for (const file of touched) {
			let expected: string | undefined;
			try {
				expected = execFileSync("git", ["show", `${manifest.baseRevision}:${file}`], { cwd: desktop, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
			} catch {
				expected = undefined;
			}
			const reversed = join(work, file);
			if (!existsSync(reversed)) return expected === undefined;
			if (expected === undefined || readFileSync(reversed, "utf8") !== expected) return false;
		}
		return true;
	} catch {
		return false;
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}

const stampPath = join(desktop, ".prepared.json");
try {
  const stamp = JSON.parse(readFileSync(stampPath, "utf8")) as { manifestDigest?: string };
  if (stamp.manifestDigest === manifestDigest) {
    console.log(`Cedia desktop patches already prepared (${manifest.patches.length} patches, ${(manifest.removals ?? []).length} removals)`);
    process.exit(0);
  }
} catch { /* Missing or stale stamp: run the per-patch loop below. */ }

for (const entry of manifest.patches as { file: string; sha256: string }[]) {
  const patch = join(root, "patches/desktop", entry.file);
  if (createHash("sha256").update(readFileSync(patch)).digest("hex") !== entry.sha256)
    throw new Error(`Cedia desktop patch integrity mismatch: ${entry.file}`);
  try {
    execFileSync("git", ["apply", "--reverse", "--check", patch], { cwd: desktop, stdio: "pipe" });
    continue; // Already applied; a re-run must not fail or double-apply.
  } catch {
    try {
      execFileSync("git", ["apply", "--check", patch], { cwd: desktop, stdio: "pipe" });
      execFileSync("git", ["apply", patch], { cwd: desktop, stdio: "inherit" });
    } catch {
      // Neither direction applies on its own: a later patch rewrote lines this one
      // added, so the per-patch reverse-check cannot decide. Prove the whole set is
      // already applied by undoing it, in reverse manifest order, from a mirror of
      // the checkout's touched files; fail loudly when that proof does not hold.
      if (!patchSetReversesFromCheckout()) {
        throw new Error(`Cedia desktop patch ${entry.file} applies in neither direction, and the checkout is not the pinned base plus this patch set`);
      }
    }
  }
}

// Whole trees and files that Cedia does not ship — the Copilot/Claude/Codex
// harness layer, its tests, and the Copilot-schema pickers — are recorded as
// removals instead of a multi-megabyte deletion patch, so every removal is
// reviewable in one list. Each path must stay inside the pinned checkout.
for (const entry of (manifest.removals ?? []) as string[]) {
  const target = normalize(join(desktop, entry));
  if (target !== desktop && !target.startsWith(desktop + sep)) throw new Error(`Removal escapes the checkout: ${entry}`);
  await rm(target, { recursive: true, force: true });
}

console.log(`Cedia desktop patches applied (${manifest.patches.length} patches, ${(manifest.removals ?? []).length} removals)`);
writeFileSync(stampPath, JSON.stringify({ manifestDigest, appliedAt: new Date().toISOString() }) + "\n");
