import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { buildOmpNative } from "./lib/omp-native-build.ts";
import { isSupportedOmpVersion } from "../packages/omp-adapter/src/types.ts";
import { verifyOmpSource, launcherText, fileSha256, attestOmpRuntime } from "./lib/omp-runtime-integrity.ts";

const root = resolve(import.meta.dir, "..");
const manifestPath = join(root, "patches/omp/manifest.json");
if (!existsSync(manifestPath)) throw new Error("OMP patch manifest is not finalized yet");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { revision: string; patches: { file: string; sha256: string }[] };
// Rolling pin: the manifest names exactly one patch per tracked revision, and
// `activePatchFile` selects the entry matching the pinned revision. Adding a
// new revision means appending one entry (never editing history).
const activePatchFile = manifest.patches.length === 1 ? manifest.patches[0]!.file
	: (manifest.patches.find(patch => patch.file.includes(manifest.revision.slice(0, 12))) ?? manifest.patches.at(-1)!).file;
const activePatches = [{ file: activePatchFile, sha256: manifest.patches.find(patch => patch.file === activePatchFile)!.sha256 }];
const source = join(root, "upstream/omp");
const run = (command: string, args: string[], cwd = root) => execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
if (!existsSync(join(source, ".git"))) {
  mkdirSync(dirname(source), { recursive: true });
  run("git", ["clone", "--no-checkout", "https://github.com/can1357/oh-my-pi", source]);
  run("git", ["checkout", "--detach", manifest.revision], source);
}
if (run("git", ["rev-parse", "HEAD"], source).trim() !== manifest.revision) throw new Error("OMP source revision differs from the patch manifest");
for (const patch of activePatches) {
  if (!/^[a-zA-Z0-9_.-]+\.patch$/.test(patch.file)) throw new Error("Invalid patch path");
  const path = join(root, "patches/omp", patch.file);
  const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (actual !== patch.sha256) throw new Error(`Patch integrity failure: ${patch.file}`);
  let applied = false;
  try { run("git", ["apply", "--reverse", "--check", path], source); applied = true; } catch { /* expected for a clean baseline */ }
  if (!applied) { run("git", ["apply", "--check", path], source); run("git", ["apply", path], source); }
}
const sourceTree = verifyOmpSource(root, source, { revision: manifest.revision, patches: activePatches });
run(process.execPath, ["install", "--frozen-lockfile", "--ignore-scripts"], source);
// Native edit overlays are part of the pinned patch and require its rebuilt addon.
const nativeTarget = buildOmpNative(source, sourceTree);
run(process.execPath, ["packages/collab-web/scripts/build-tool-views.ts"], source);
const cli = join(source, "packages/coding-agent/src/cli.ts");
// Rolling pin: the prepared version must satisfy the supported floor, not equal
// the old baseline constant. A newer minor reports its own number here.
const preparedVersion = run(process.execPath, [cli, "--version"], source).trim();
if (!isSupportedOmpVersion(preparedVersion)) throw new Error(`Prepared OMP version is not supported: ${preparedVersion}`);
const standalone = process.argv.includes("--standalone");
const output = join(root, standalone ? "dist/omp-standalone/omp" : "dist/omp/omp");
mkdirSync(dirname(output), { recursive: true });
let reuseStandalone = false;
if (standalone && existsSync(output)) {
  try { reuseStandalone = attestOmpRuntime(root, output).runtimeKind === "standalone-binary"; } catch { /* Rebuild stale or unverified output. */ }
}
if (standalone && !reuseStandalone) {
  execFileSync(process.execPath, ["packages/coding-agent/scripts/build-binary.ts"], { cwd: source,
    env: { ...process.env, CEDIA_COMPILED_RUNTIME: "1", PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}` }, stdio: "inherit" });
  copyFileSync(join(source, "packages/coding-agent/dist/omp"), output);
} else if (!standalone) writeFileSync(output, launcherText(process.execPath, source), { mode: 0o755 });
chmodSync(output, 0o755);
if (verifyOmpSource(root, source, { revision: manifest.revision, patches: activePatches }) !== sourceTree) throw new Error("OMP source changed during preparation");
if (standalone && !isSupportedOmpVersion(run(output, ["--version"], root).trim())) throw new Error("Standalone OMP version check failed");
writeFileSync(join(dirname(output), "runtime.json"), JSON.stringify({ revision: manifest.revision, patches: activePatches, source, sourceTree, executable: output, executableSha256: fileSha256(output), bun: process.execPath, bunSha256: fileSha256(process.execPath), nativePath: nativeTarget, nativeSha256: fileSha256(nativeTarget), developmentRuntime: !standalone, standaloneRuntime: standalone }, null, 2) + "\n");
console.log(`Prepared pinned Cedia OMP ${standalone ? "standalone" : "development"} runtime: ${output}`);
