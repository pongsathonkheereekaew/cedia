import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileSha256 } from "./omp-runtime-integrity.ts";

export function nativeArtifactFromCargo(output: string): string {
  const artifacts: string[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const frame = JSON.parse(line);
    if (frame.reason === "compiler-artifact" && frame.target?.name === "pi_natives" && frame.target?.kind?.includes("cdylib")) {
      for (const path of frame.filenames ?? []) if (typeof path === "string" && path.endsWith(".dylib")) artifacts.push(path);
    }
  }
  if (artifacts.length !== 1) throw new Error("Cargo did not identify exactly one host native addon");
  return artifacts[0]!;
}

/** Build the patched native engine locally; never replace the user's stock OMP cache. */
export function buildOmpNative(source: string, sourceTree: string): string {
  if (process.platform !== "darwin") throw new Error("Cedia's native runtime build currently targets macOS");
  const target = join(source, "packages/natives/native", `pi_natives.${process.platform}-${process.arch}.node`);
  const receiptPath = join(source, "../../dist/omp/native-build.json");
  if (existsSync(target) && existsSync(receiptPath)) {
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    if (receipt.sourceTree === sourceTree && receipt.sha256 === fileSha256(target)) return target;
  }
  const isolatedCargo = join(homedir(), ".caret-tools/cargo");
  const isolatedRustup = join(homedir(), ".caret-tools/rustup");
  const useIsolated = !process.env.CEDIA_CARGO && existsSync(join(isolatedCargo, "bin/cargo"));
  const cargo = process.env.CEDIA_CARGO ?? (useIsolated ? join(isolatedCargo, "bin/cargo") : "cargo");
  const env = { ...process.env, ...(useIsolated ? { CARGO_HOME: isolatedCargo, RUSTUP_HOME: isolatedRustup } : {}), CARGO_PROFILE_DEV_DEBUG: "0", PCRE2_SYS_STATIC: "1" };
  // Cargo reads the upstream rust-toolchain.toml. --locked preserves its dependency graph.
  const output = execFileSync(cargo, ["build", "--locked", "-p", "pi-natives", "-j", "4", "--message-format=json"], { cwd: source, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] });
  const built = nativeArtifactFromCargo(output);
  if (!existsSync(built)) throw new Error("Patched OMP native build did not produce its addon");
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}`;
  // Post-link version stamp: crates/pi-natives links a fixed-size placeholder slot that
  // `__piNativesBuildVersion()` reads at runtime; embed-native.ts refuses an unstamped addon.
  // `packages/natives/package.json#version` is the stamp source (18.4.3 here).
  execFileSync(process.execPath, ["scripts/stamp-native-version.ts", target], { cwd: source, stdio: "inherit" });
  // Probe the actual ABI in an isolated process before recording the build.
  execFileSync(process.execPath, ["-e", "const n=require(process.argv[1]); if(typeof n.EditSession.prototype.setFileOverlay!=='function'||typeof n.EditSession.prototype.clearFileOverlays!=='function') throw Error('Missing Cedia native editor overlay ABI')", target], { cwd: source, stdio: "inherit" });
  mkdirSync(dirname(receiptPath), { recursive: true });
  writeFileSync(receiptPath, JSON.stringify({ sourceTree, sha256: fileSha256(target), profile: "dev", platform: process.platform, arch: process.arch }, null, 2) + "\n");
  return target;
}
