/**
 * Regenerate the consolidated OMP patch from the pinned checkout.
 *
 * The pinned tree under `upstream/omp` is the applied state: it sits at the manifest revision with
 * this patch applied on top. Regenerating means diffing that working tree against the revision it
 * is pinned to, which is what `git diff --cached` over a throwaway index answers - the checkout's
 * own index is not touched, so a developer's staged state (if any) survives.
 *
 * The result must be byte-identical to what `bun scripts/prepare-omp-runtime.ts` applies, so this
 * writes the patch file and the manifest hash together and reports both. It refuses to run when
 * the checkout is not at the revision the manifest names, because a patch against another
 * revision would silently describe a runtime Cedia never pinned.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const source = join(root, "upstream/omp");
const manifestPath = join(root, "patches/omp/manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
	revision: string;
	patches: { file: string; sha256: string }[];
};
if (manifest.patches.length !== 1) throw new Error("Use one consolidated patch per pinned runtime revision");
const patch = manifest.patches[0]!;

const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" }).trim();
if (head !== manifest.revision) {
	throw new Error(`OMP checkout is at ${head}, but the manifest pins ${manifest.revision}`);
}

const index = join(mkdtempSync(join(tmpdir(), "cedia-omp-index-")), "index");
const git = (args: string[]): Buffer =>
	execFileSync("git", args, { cwd: source, env: { ...process.env, GIT_INDEX_FILE: index }, maxBuffer: 64 * 1024 * 1024 });
git(["read-tree", "HEAD"]);
git(["add", "-A"]);
const diff = git(["diff", "--cached", "--binary", "HEAD"]);

const patchPath = join(root, "patches/omp", patch.file);
writeFileSync(patchPath, diff);
const sha = createHash("sha256").update(diff).digest("hex");
writeFileSync(
	manifestPath,
	`${JSON.stringify({ ...manifest, patches: [{ ...patch, sha256: sha }] }, null, 2)}\n`,
);
console.log(`Regenerated patches/omp/${patch.file} (${diff.length} bytes, sha256 ${sha}).`);
