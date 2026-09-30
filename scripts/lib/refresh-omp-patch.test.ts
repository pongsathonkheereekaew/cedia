import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("refreshes the active rolling-pin patch without rewriting historical entries or the source index", () => {
  const scratch = mkdtempSync(join(tmpdir(), "cedia-patch-refresh-test-"));
  try {
    const source = join(scratch, "upstream/omp");
    const patchDir = join(scratch, "patches/omp");
    mkdirSync(source, { recursive: true });
    mkdirSync(patchDir, { recursive: true });
    mkdirSync(join(scratch, "scripts"));
    cpSync(resolve(import.meta.dir, "../refresh-omp-patch.ts"), join(scratch, "scripts/refresh-omp-patch.ts"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: source, encoding: "utf8" });
    git("init", "-q");
    writeFileSync(join(source, "fixture.txt"), "before\n");
    git("add", "fixture.txt");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "base");
    const revision = git("rev-parse", "HEAD").trim();
    const historical = { file: "0001-old.patch", sha256: "a".repeat(64) };
    const active = { file: "0002-current.patch", sha256: "b".repeat(64) };
    const manifestPath = join(patchDir, "manifest.json");
    writeFileSync(manifestPath, JSON.stringify({ revision, patches: [historical, active] }));
    writeFileSync(join(patchDir, historical.file), "historical bytes\n");
    writeFileSync(join(source, "fixture.txt"), "after\n");
    execFileSync(process.execPath, [join(scratch, "scripts/refresh-omp-patch.ts")], { stdio: "pipe" });
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const patch = readFileSync(join(patchDir, active.file), "utf8");
    expect(manifest.revision).toBe(revision);
    expect(manifest.patches).toEqual([historical, {
      file: active.file,
      sha256: createHash("sha256").update(patch).digest("hex"),
    }]);
    expect(readFileSync(join(patchDir, historical.file), "utf8")).toBe("historical bytes\n");
    expect(patch).toContain("-before\n+after\n");
    expect(git("diff", "--cached")).toBe("");
    git("apply", "--reverse", "--check", join(patchDir, active.file));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
