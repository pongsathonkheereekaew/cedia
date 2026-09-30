import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface OmpPatchManifest { revision: string; patches: { file: string; sha256: string }[] }
export const fileSha256 = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");
export const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
export const launcherText = (bun: string, source: string): string => `#!/bin/sh\nexec ${shellQuote(bun)} ${shellQuote(join(source, "packages/coding-agent/src/cli.ts"))} "$@"\n`;

/** Compare the complete tracked/untracked non-ignored source tree against HEAD + patches, without touching the user's index. */
export function verifyOmpSource(root: string, source: string, manifest: OmpPatchManifest): string {
  const temp = mkdtempSync(join(tmpdir(), "cedia-omp-index-"));
  const git = (args: string[], index: string): string => execFileSync("git", args, {
    cwd: source, encoding: "utf8", env: { ...process.env, GIT_INDEX_FILE: join(temp, index) }, maxBuffer: 4 * 1024 * 1024,
  }).trim();
  try {
    if (git(["rev-parse", "HEAD"], "expected") !== manifest.revision) throw new Error("OMP source revision mismatch");
    git(["read-tree", "HEAD"], "expected");
    for (const patch of manifest.patches) {
      if (!/^[a-zA-Z0-9_.-]+\.patch$/.test(patch.file)) throw new Error("Invalid OMP patch path");
      const path = join(root, "patches/omp", patch.file);
      if (fileSha256(path) !== patch.sha256) throw new Error("OMP patch hash mismatch");
      git(["apply", "--cached", path], "expected");
    }
    const expected = git(["write-tree"], "expected");
    git(["read-tree", "HEAD"], "actual");
    git(["add", "-A", "--", "."], "actual");
    const actual = git(["write-tree"], "actual");
    if (actual !== expected) throw new Error("OMP source has changes outside the recorded patch; export and prepare the runtime first");
    return actual;
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

export function attestOmpRuntime(root: string, executable: string) {
  const runtimePath = join(dirname(resolve(executable)), "runtime.json");
  const runtime = JSON.parse(readFileSync(runtimePath, "utf8"));
  const manifestPath = join(root, "patches/omp/manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as OmpPatchManifest;
  const activeEntry = manifest.patches.length === 1 ? manifest.patches[0]!
    : (manifest.patches.find(patch => patch.file.includes(manifest.revision.slice(0, 12))) ?? manifest.patches.at(-1)!);
  const activePatches = [{ file: activeEntry.file, sha256: activeEntry.sha256 }];
  if ((runtime.developmentRuntime !== true && runtime.standaloneRuntime !== true) || resolve(runtime.executable) !== resolve(executable)
    || runtime.revision !== manifest.revision || JSON.stringify(runtime.patches) !== JSON.stringify(activePatches)) throw new Error("Runtime descriptor does not match the requested pinned launcher");
  if (runtime.standaloneRuntime === true) {
    if (fileSha256(executable) !== runtime.executableSha256) throw new Error("Standalone runtime hash mismatch");
  } else if (readFileSync(executable, "utf8") !== launcherText(runtime.bun, runtime.source)) throw new Error("Runtime launcher content mismatch");
  const sourceTree = verifyOmpSource(root, runtime.source, { revision: manifest.revision, patches: activePatches });
  if (runtime.sourceTree !== sourceTree || runtime.bunSha256 !== fileSha256(runtime.bun)
    || runtime.nativeSha256 !== fileSha256(runtime.nativePath)) throw new Error("Prepared runtime attestation changed; prepare the runtime again");
  return { runtimeKind: runtime.standaloneRuntime === true ? "standalone-binary" : "development-source-launcher", sourceVerified: true, sourceRevision: manifest.revision,
    sourceTree, executableSha256: fileSha256(executable), patchManifestSha256: fileSha256(manifestPath),
    bunSha256: runtime.bunSha256 as string, nativeSha256: runtime.nativeSha256 as string };
}
