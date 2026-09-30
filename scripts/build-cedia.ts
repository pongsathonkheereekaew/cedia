import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, statSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { applyDarwinAppIcon, removeDevBundle } from "./lib/app-icon.ts";
import { fileSha256, isShellFresh, newestPatchMtime, readPatchSet, type PatchSetManifest } from "./lib/patch-set-digest.ts";
import { personalCediaArgv } from "./lib/personal-argv.ts";
import { agentWindowDigest } from "./lib/agent-window-assets.ts";

const root = resolve(import.meta.dir, "..");

/**
 * Name of the newest patch in the manifest, for messages that have to point at what changed.
 *
 * `newestPatchMtime` answers "is the shell fresh?" with one number; a failure has to name
 * the patch a rebuild is missing, and the manifest is the only place that mapping lives.
 */
function newestPatchFile(root: string, manifest: PatchSetManifest): string | undefined {
  let newest: { file: string; mtimeMs: number } | undefined;
  for (const patch of manifest.patches) {
    try {
      const { mtimeMs } = statSync(join(root, "patches", "desktop", patch.file));
      if (!newest || mtimeMs > newest.mtimeMs) newest = { file: patch.file, mtimeMs };
    } catch {
      // A patch that cannot be stat'ed contributes no name; readPatchSet rejects it first.
    }
  }
  return newest?.file;
}

/** The host's headless terminal engine (libghostty-vt). Native addon: external + shipped beside the bundle. */
const HOST_TERMINAL_ENGINE = "@coder/libghostty-vt-node";
const portable = process.argv.includes("--portable") || process.argv.includes("--package");

/**
 * Stage the packaged remote web client (§6.5).
 *
 * The client is the existing `apps/ios` Expo export, not a second web app, so this build copies
 * that output to `dist/remote-web` and packages it under `runtime/remote-web`. The export stays a
 * separate, deliberate command: a build without one fails by name instead of shipping a gateway
 * that has nothing to serve.
 */
async function stageRemoteWeb(): Promise<string> {
  const source = join(root, "apps/ios/dist");
  const entry = join(source, "index.html");
  if (!existsSync(entry)) {
    throw new Error(`The remote web client export is missing (${entry}); run \`bun run --cwd apps/ios export:web\` first`);
  }
  const target = join(root, "dist/remote-web");
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await cp(source, target, { recursive: true });
  return target;
}

const remoteWeb = await stageRemoteWeb();
if (portable) execFileSync(process.execPath, [join(root, "scripts/prepare-omp-runtime.ts"), "--standalone"], { cwd: root, stdio: "inherit" });
if (process.argv.includes("--runtime")) execFileSync(process.execPath, [join(root, "scripts/prepare-omp-runtime.ts")], { cwd: root, stdio: "inherit" });
/**
 * Recompute the workbench checksums for the packaged app.
 *
 * The pinned packager writes upstream's `product.json` checksums, which do not describe the files
 * this build actually ships, so every launch raises "Your Cedia installation appears to be
 * corrupt. Please reinstall." - a warning about tampering that is not true. A normal VS Code build
 * regenerates these as its last step; this reproduces that for the personal app. It runs before
 * signing, because `product.json` is inside what gets sealed.
 */
async function refreshPackagedChecksums(productJsonPath: string): Promise<void> {
  const appResources = dirname(productJsonPath);
  const product: { checksums?: Record<string, string> } = JSON.parse(await readFile(productJsonPath, "utf8"));
  const checksums = product.checksums;
  if (!checksums) return;
  let refreshed = 0;
  for (const key of Object.keys(checksums)) {
    const file = join(appResources, "out", key);
    try {
      // `ChecksumService.checksum` resolves `hash.digest('base64').replace(/=+$/, '')`, so the
      // padding has to go or every file compares as modified.
      checksums[key] = createHash("sha256").update(await readFile(file)).digest("base64").replace(/=+$/, "");
      refreshed++;
    } catch {
      // A file this build does not ship is left as it is rather than invented.
    }
  }
  await writeFile(productJsonPath, JSON.stringify(product, null, "\t") + "\n");
  console.log(`Refreshed ${refreshed} workbench checksums in ${productJsonPath}`);
}

/**
 * Stamp the packaged `product.json` with the Cedia patch-set receipt and, when the
 * packager left it blank, the renderer build identity.
 *
 * The workbench loads the npm packages its bundles leave external (`@xterm/xterm`,
 * `katex`, `vscode-oniguruma`, `vscode-textmate`, `jschardet`, `@vscode/iconv-lite-umd`)
 * through a runtime helper that picks the layout by build identity: a product.json with a
 * `commit` resolves `node_modules.asar`, a commit-less one resolves the plain `node_modules`
 * directory. The pinned packager writes the archive plus a plain directory that only holds
 * the files it had to duplicate (`@vscode/tree-sitter-wasm`, `zod`, ...), so a commit-less
 * packaged app misses every other runtime import. The fetch fails (`ERR_FILE_NOT_FOUND`),
 * `TerminalInstance` never gets its xterm, and the window reports "An unknown error
 * occurred" with no terminal process anywhere - which is what the Apps panel's terminal
 * shows as "terminal not working". Release Code-OSS builds always carry a commit, so
 * upstream never hits this; stamping the pinned revision restores that.
 *
 * The `cedia` field is written on every run, even when the commit already exists: the
 * pinned revision alone cannot distinguish a package built before a patch from one built
 * after it, so the patch-set digest plus the hashes of the two desktop shell bundles and
 * the Cedia extension are what `scripts/check-packaged-shell.ts` verifies. The commit
 * itself is still never second-guessed once present.
 */
async function stampPackagedCedia(productJsonPath: string): Promise<void> {
  const appResources = dirname(productJsonPath);
  const product: { commit?: string; version?: string; date?: string; cedia?: Record<string, unknown> } = JSON.parse(await readFile(productJsonPath, "utf8"));
  const patchSet = readPatchSet(root);
  const sessionsSha256 = fileSha256(join(appResources, "out/vs/sessions/sessions.desktop.main.js"));
  const workbenchSha256 = fileSha256(join(appResources, "out/vs/workbench/workbench.desktop.main.js"));
  product.cedia = {
    patchSetSha256: patchSet.digest,
    baseRevision: patchSet.manifest.baseRevision,
    patchCount: patchSet.manifest.patches.length,
    packagedAt: new Date().toISOString(),
    // An artifact the package does not carry has no hash and is left out rather than
    // invented; `check-packaged-shell.ts` reports the missing key as a FAIL.
    shell: {
      ...(sessionsSha256 === undefined ? {} : { sessions: sessionsSha256 }),
      ...(workbenchSha256 === undefined ? {} : { workbench: workbenchSha256 }),
      main: fileSha256(join(appResources, "out/main.js")),
    },
    agentWindow: agentWindowDigest(join(appResources, "out/vs/cedia/agent")),
    extension: fileSha256(join(appResources, "extensions/cedia/out/extension.js")),
  };
  if (!product.commit) {
    const lock: { sources: { name?: string; revision: string }[] } = JSON.parse(await readFile(join(root, "upstream-lock.json"), "utf8"));
    const pinned = lock.sources.find(source => source.name === "cedia-native")?.revision;
    const version = JSON.parse(await readFile(join(root, "desktop/package.json"), "utf8")).version;
    product.commit = pinned;
    product.version = version;
    product.date = new Date().toISOString();
  }
  await writeFile(productJsonPath, JSON.stringify(product, null, "\t") + "\n");
  console.log(`Stamped packaged product.json: cedia patch set ${patchSet.digest.slice(0, 12)} (${patchSet.manifest.patches.length} patches), identity ${product.version}+${String(product.commit).slice(0, 12)}`);
}

const dist = join(root, "dist");
await mkdir(dist, { recursive: true });
// The Agent Window has its own React/runtime bundle; Code-OSS continues to own the IDE.
execFileSync(process.execPath, [join(root, "scripts/build-agent-window.ts")], { cwd: root, stdio: "inherit" });
for (const [entrypoint, output] of [["apps/host/src/cli.ts", "host/cli.js"], ["apps/host/src/runtime-lock.ts", "host/runtime-lock.ts"]]) {
  // `@coder/libghostty-vt-node` is the host's headless terminal engine (libghostty-vt).
  // It carries a native addon, which cannot live inside a bundle, so it stays external
  // and the package is copied beside the bundle below.
  const result = await Bun.build({ entrypoints: [join(root, entrypoint!)], outdir: join(dist, "host"), target: "node", format: "esm", naming: output!.split("/").at(-1)!, sourcemap: "external", external: [HOST_TERMINAL_ENGINE] });
  if (!result.success) throw new AggregateError(result.logs, `Build failed: ${entrypoint}`);
}
// Ship the engine with the host: the bundle imports it at runtime, and `node-gyp-build`
// resolves the addon from the package's own prebuilds directory.
function installedPackage(name: string, from = root): string {
  // Resolve the way the runtime would: bun links a workspace dependency into the
  // workspace's node_modules and keeps transitive ones in its store layout.
  try {
    return dirname(Bun.resolveSync(`${name}/package.json`, from));
  } catch {
    throw new Error(`Host runtime dependency is missing: ${name} (run bun install)`);
  }
}
const hostEngine = installedPackage(HOST_TERMINAL_ENGINE, join(root, "apps", "host"));
const prebuild = join(hostEngine, "prebuilds", `${process.platform}-${process.arch}`);
if (!existsSync(prebuild)) throw new Error(`The host terminal engine has no prebuild for ${process.platform}-${process.arch}: ${prebuild}`);
for (const [name, from] of [[HOST_TERMINAL_ENGINE, join(root, "apps", "host")], ["node-gyp-build", hostEngine]] as const) {
  await cp(installedPackage(name, from), join(dist, "host", "node_modules", name), { recursive: true });
}
const extensionOutput = join(dist, "mac-extension");
await mkdir(extensionOutput, { recursive: true });
const extension = await Bun.build({ entrypoints: [join(root, "apps/macos/src/extension.ts")], outdir: join(extensionOutput, "out"), target: "node", format: "cjs", external: ["vscode"], naming: "extension.js", sourcemap: "external" });
if (!extension.success) throw new AggregateError(extension.logs, "Mac extension build failed");
const manifest = JSON.parse(await readFile(join(root, "apps/macos/package.json"), "utf8"));
delete manifest.type; manifest.name = "cedia"; manifest.publisher = "cedia";
manifest.contributes.configuration.properties["cedia.hostNodePath"].default = portable ? "" : process.env.CEDIA_HOST_NODE ?? process.execPath;
manifest.contributes.configuration.properties["cedia.hostScriptPath"].default = portable ? "" : join(dist, "host", "cli.js");
await writeFile(join(extensionOutput, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
await cp(join(root, "apps/macos/media"), join(extensionOutput, "media"), { recursive: true });
await cp(join(dist, "agent-window"), join(extensionOutput, "agent-ui"), { recursive: true });
if (portable) {
  const node = process.env.CEDIA_HOST_NODE;
  if (!node) throw new Error("Set CEDIA_HOST_NODE to the Node 24 executable to bundle");
  const version = execFileSync(node, ["--version"], { encoding: "utf8" }).trim();
  if (!/^v24\./.test(version)) throw new Error("Cedia host bundle requires Node 24");
  const runtime = join(extensionOutput, "runtime");
  await mkdir(join(runtime, "node/bin"), { recursive: true });
  await cp(node, join(runtime, "node/bin/node"));
  await cp(join(dirname(node), "../LICENSE"), join(runtime, "node/LICENSE"));
  await cp(join(dist, "host"), join(runtime, "host"), { recursive: true });
  await writeFile(join(runtime, "host/package.json"), JSON.stringify({ private: true, type: "module" }) + "\n");
  await mkdir(join(runtime, "omp"), { recursive: true });
  await cp(join(dist, "omp-standalone/omp"), join(runtime, "omp/omp"));
  await cp(join(root, "upstream/omp/LICENSE"), join(runtime, "omp/LICENSE"));
  // The packaged web client sits beside `host/`, which is where the host resolves it at startup
  // (`apps/host/src/remote-web-assets.ts`), so the gateway starts in a packaged app and does not
  // start in a build that carries no export.
  await cp(remoteWeb, join(runtime, "remote-web"), { recursive: true });
  // Cedia's qualified launcher ships beside the runtime it owns (§8.2 O08). It is bundled for the
  // packaged Node so a user can run `cedia-omp` instead of the bare binary: the launcher is what
  // respects a live owner endpoint, and without it the packaged CLI would be uninstrumented.
  // ESM, not CJS: the launcher awaits its own exit code at the top level, which a CommonJS bundle
  // cannot express, and the `.mjs` extension is what tells the packaged Node to run it as ESM.
  const launcher = await Bun.build({
    entrypoints: [join(root, "scripts/cedia-omp.ts")],
    outdir: join(runtime, "omp"),
    target: "node",
    format: "esm",
    naming: "cedia-omp.mjs",
    minify: false,
    sourcemap: "none",
  });
  if (!launcher.success) throw new Error(`Cedia CLI launcher build failed: ${launcher.logs.map(log => log.message).join("; ")}`);
  const launcherShim = join(runtime, "omp", "cedia-omp");
  await writeFile(launcherShim, `#!/bin/sh\n# Cedia's qualified launcher for the bundled OMP runtime (§8.2 O08).\nexec \"$(dirname \"$0\")/../node/bin/node\" \"$(dirname \"$0\")/cedia-omp.mjs\" \"$@\"\n`);
  await chmodSync(launcherShim, 0o755);
  // Build evidence is kept outside the runnable payload: it contains source paths.
  await cp(join(root, "docs/upstream-notices"), join(runtime, "notices"), { recursive: true });
}
// Code-OSS Electron packaging and the DMG builder both consume this icon.
const brandIcon = join(root, "assets/brand/cedia-terminal-d-v1/cedia.icns");
await mkdir(join(dist, "brand"), { recursive: true });
await cp(brandIcon, join(dist, "brand/cedia.icns"));
if (process.argv.includes("--desktop")) {
  execFileSync(process.execPath, [join(root, "scripts/prepare-desktop.ts")], { cwd: root, stdio: "inherit" });
  await cp(join(dist, "agent-window"), join(root, "desktop/out/vs/cedia/agent"), { recursive: true });
  // The retained, ignored Code-OSS checkout is a build output. Tracked source stays above.
  await cp(extensionOutput, join(root, "desktop/extensions/cedia"), { recursive: true });
  await cp(brandIcon, join(root, "desktop/resources/darwin/code.icns"));
  await writeFile(join(root, "desktop/argv.json"), JSON.stringify(personalCediaArgv(), null, 2) + "\n");
  // `desktop/scripts/code.sh` launches `.build/electron/<nameShort>.app`, which
  // `gulp electron` extracts into `.build/electron`. That shell is an incomplete
  // Electron bundle with no app payload, and it is *also* what the packaging task
  // is told to build from, so leaving it behind puts a second app called "Cedia"
  // (with no Cedia surfaces) in LaunchServices next to the packaged one - the
  // wrong build the OS then opens. A desktop build is meant to produce one Cedia,
  // so this removes the shell instead of branding it. `code.sh` recreates it on
  // demand when someone actually wants the dev window.
  const desktopProduct: { nameShort: string } = JSON.parse(await readFile(join(root, "desktop/product.json"), "utf8"));
  const desktopName = desktopProduct.nameShort;
  const devBundle = join(root, "desktop/.build/electron", `${desktopName}.app`);
  await removeDevBundle(devBundle);
}
if (process.argv.includes("--package")) {
  const app = join(root, `VSCode-darwin-${process.arch}`, "Cedia.app");
  const appExtension = join(app, "Contents/Resources/app/extensions/cedia");
  // This target is generated by the pinned Code-OSS packaging task.
  await readFile(join(app, "Contents/Info.plist"));
  await rm(appExtension, { recursive: true, force: true });
  await cp(extensionOutput, appExtension, { recursive: true });
  // Tree-sitter opens WASM by a real node_modules path, outside Electron ASAR
  // resolution. Reuse the exact filtered assets emitted by the pinned packager.
  const appResources = join(app, "Contents/Resources/app");
  await rm(join(appResources, "out/vs/cedia/agent"), { recursive: true, force: true });
  await cp(join(dist, "agent-window"), join(appResources, "out/vs/cedia/agent"), { recursive: true });
  await cp(join(appResources, "node_modules.asar.unpacked/@vscode/tree-sitter-wasm"),
    join(appResources, "node_modules/@vscode/tree-sitter-wasm"), { recursive: true });
  // Product decision 2026-09-13: single agent surface. Remove the bundled
  // Copilot Chat agent UI (ships in the `copilot` dir) so it cannot front its
  // own Sessions/Chats over the Cedia shell. OMP stays the only harness.
  // `github`/`github-authentication` stay: unrelated to the agent UI.
  // Re-apply on every --package: the pinned Code-OSS packager restores it.
  await rm(join(appResources, "extensions/copilot"), { recursive: true, force: true });
  // The fork's base still ships its own `extensions/caret` copy of this product's
  // extension (caret.* commands, caret UI); the Cedia extension lives at
  // `extensions/cedia` now, so the stale twin leaves with the Copilot UI.
  await rm(join(appResources, "extensions/caret"), { recursive: true, force: true });
  await writeFile(join(app, "Contents/Resources/app/argv.json"), JSON.stringify(personalCediaArgv(), null, 2) + "\n");
  // A rebuild must not package a desktop shell older than the patch set this checkout
  // describes. The patches edit exactly these two bundles, and a stale pair ships
  // behaviour that exists in `patches/desktop` but not in the app - the silent mismatch
  // this gate turns into a failed build. `readPatchSet` also re-verifies every patch
  // file's recorded sha256 first, so a tampered checkout stops here as well.
  const patchSet = readPatchSet(root);
  const newestPatchMtimeMs = newestPatchMtime(root, patchSet.manifest);
  const shellBundles = [
    join(appResources, "out/vs/sessions/sessions.desktop.main.js"),
    join(appResources, "out/vs/workbench/workbench.desktop.main.js"),
    join(appResources, "out/main.js"),
  ];
  for (const shellBundle of shellBundles) {
    let bundleMtimeMs: number | undefined;
    try {
      bundleMtimeMs = statSync(shellBundle).mtimeMs;
    } catch {
      bundleMtimeMs = undefined; // isShellFresh reports a missing bundle as stale.
    }
    if (!isShellFresh(bundleMtimeMs, newestPatchMtimeMs)) {
      const newest = newestPatchFile(root, patchSet.manifest);
      throw new Error(`Packaged shell is older than patches/desktop/${newest ?? "(unknown)"}; rebuild the desktop shell (prepare-desktop + the pinned gulp task) before --package. Checked bundles: ${shellBundles.join(" and ")}.`);
    }
  }
  // Before the checksum pass: it rewrites this same file, so the identity has to be
  // in place first or the next launch resolves its runtime imports from the wrong layout.
  await stampPackagedCedia(join(appResources, "product.json"));
  await refreshPackagedChecksums(join(appResources, "product.json"));
  // The packager bakes `desktop/resources/darwin/code.icns` into the bundle, so
  // an app packaged before an icon change would keep the old artwork. Re-apply
  // the brand icon before signing; anything written after this breaks the seal.
  await applyDarwinAppIcon(app, brandIcon);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
  console.log(`Prepared local ad-hoc signed app (not notarized): ${app}`);
}
console.log(`Built Cedia host and Mac extension in ${dist}`);
