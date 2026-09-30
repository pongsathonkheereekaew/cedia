#!/usr/bin/env bun
/**
 * Cedia's qualified launcher for OMP's own CLI (plan §8.2 O08).
 *
 * Run it instead of the bundled `omp` binary. It resolves the pinned runtime, respects the local
 * owner endpoint when a session is named, and refuses - with the reason - instead of starting a
 * second executor or cleaning up a record it cannot prove. Every verb and flag OMP ships is
 * forwarded untouched; only the flags that pick or attach a session meet the ownership rule.
 *
 * Usage:
 *   cedia-omp [--cedia-session-dir <dir>] <verb> [omp args...]
 *
 * `CEDIA_SESSION_OWNER_DIR` is the same as `--cedia-session-dir`; Cedia sets it for a task's user
 * shell so a terminal inside a task knows which owner it belongs to.
 */
import { spawn } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CEDIA_SESSION_OWNING_FLAGS, decideCediaCliInvocation } from "../apps/host/src/cli-launcher.ts";
import { askCediaOwner, readCediaOwnerRecord } from "../apps/host/src/owner-endpoint.ts";

const EXIT_USAGE = 64;
const EXIT_REFUSED = 75;
const CEDIA_TASK_CONTEXT_NAME = ".cedia-task-context.json";

/** Host-authored identity and policy context required to qualify a TUI launch. */
export interface CediaTaskContext {
  readonly version: 1;
  readonly taskId: string;
  readonly incarnation: string;
  readonly sessionFile: string;
  readonly cwd: string;
  readonly creditGuard: true;
}

export type CediaTaskContextResult =
  | { readonly context: CediaTaskContext }
  | { readonly reason: string };

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function privateRegularFile(file: string): string | undefined {
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) return undefined;
    return file;
  } catch {
    return undefined;
  }
}

function pathInside(root: string, value: string, label: string): { path: string } | { reason: string } {
  if (!isAbsolute(value)) return { reason: `${label} must be an absolute path` };
  const candidate = resolve(value);
  let canonicalCandidate: string;
  let stat: ReturnType<typeof lstatSync> | undefined;
  try {
    stat = lstatSync(candidate);
    if (stat.isSymbolicLink()) return { reason: `${label} may not be a symbolic link` };
    canonicalCandidate = realpathSync(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return { reason: `${label} could not be validated` };
    try {
      canonicalCandidate = join(realpathSync(dirname(candidate)), basename(candidate));
    } catch {
      return { reason: `${label} could not be validated` };
    }
  }
  const escaped = relative(root, canonicalCandidate);
  if (escaped === ".." || escaped.startsWith(`..${resolve("/") === "/" ? "/" : "\\"}`) || isAbsolute(escaped)) {
    return { reason: `${label} must stay inside the Cedia task directory` };
  }
  if (label === "sessionFile" && stat !== undefined && !stat.isFile()) return { reason: "sessionFile must name a regular file" };
  // Keep the host-authored spelling in the child arguments. The canonical path above only proves
  // containment; rewriting `/var` to `/private/var` on macOS would make the launcher diverge from
  // the durable task context even though both spellings name the same file.
  return { path: candidate };
}

/** Read the task context that the host atomically writes beside a session's lock. */
export function readCediaTaskContext(sessionDirectory: string): CediaTaskContextResult {
  let directory: string;
  try {
    const stat = lstatSync(sessionDirectory);
    if (!stat.isDirectory()) return { reason: "the Cedia session path is not a directory" };
    directory = realpathSync(sessionDirectory);
  } catch {
    return { reason: "the Cedia session directory is unavailable" };
  }
  const contextPath = join(directory, CEDIA_TASK_CONTEXT_NAME);
  if (privateRegularFile(contextPath) === undefined) return { reason: "the Cedia task context is missing or not private" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(contextPath, "utf8"));
  } catch {
    return { reason: "the Cedia task context is not valid JSON" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { reason: "the Cedia task context is not an object" };
  const row = parsed as Record<string, unknown>;
  if (row.version !== 1 || row.creditGuard !== true || !nonEmptyString(row.taskId) || !nonEmptyString(row.incarnation)
      || !nonEmptyString(row.sessionFile) || !nonEmptyString(row.cwd)) {
    return { reason: "the Cedia task context is missing its versioned identity or credit guard" };
  }
  if (row.taskId !== basename(directory)) return { reason: "the Cedia task context does not match this task directory" };
  const sessionFile = pathInside(directory, row.sessionFile, "sessionFile");
  if (!("path" in sessionFile)) return sessionFile;
  if (!isAbsolute(row.cwd)) return { reason: "cwd must be an absolute path" };
  let cwd: string;
  try {
    const stat = lstatSync(row.cwd);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return { reason: "cwd must name a real directory" };
    // As with sessionFile, realpath is used for validation only. Preserve the host's path spelling
    // when passing --cwd so its context remains byte-for-byte identifiable in diagnostics.
    realpathSync(row.cwd);
    cwd = row.cwd;
  } catch {
    return { reason: "cwd is unavailable" };
  }
  return {
    context: {
      version: 1,
      taskId: row.taskId,
      incarnation: row.incarnation,
      sessionFile: sessionFile.path,
      cwd,
      creditGuard: true,
    },
  };
}

function qualifiedFlag(argument: string): string {
  return argument.startsWith("-") ? argument.split("=", 1)[0]! : argument;
}

const CEDIA_TUI_FORBIDDEN_FLAGS = new Set([
  ...CEDIA_SESSION_OWNING_FLAGS,
  "--no-session",
  "--no-extensions",
  "--print",
  "--mode",
  "--rpc",
  "--rpc-ui",
  "--acp",
  "--cwd",
  "--trusted-extension",
]);

function resolveCediaLockExtension(environment: NodeJS.ProcessEnv, launcherDirectory: string): string | undefined {
  const candidates = [
    environment.CEDIA_RUNTIME_LOCK_EXTENSION,
    join(launcherDirectory, "..", "host", "runtime-lock.ts"),
    join(launcherDirectory, "..", "apps", "host", "src", "runtime-lock.ts"),
    resolve(process.cwd(), "apps", "host", "src", "runtime-lock.ts"),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
  for (const candidate of candidates) {
    try {
      const stat = lstatSync(candidate);
      if (stat.isFile() && !stat.isSymbolicLink()) return realpathSync(candidate);
    } catch {
      /* Try the next packaged/development location. */
    }
  }
  return undefined;
}

export type CediaQualifiedTuiResult =
  | { readonly context: CediaTaskContext; readonly args: string[]; readonly environment: NodeJS.ProcessEnv }
  | { readonly reason: string };

/** Prepare the only supported TUI path: explicit task directory, host context, lock and guard. */
export function qualifyCediaTuiLaunch(
  sessionDirectory: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
  launcherDirectory = dirname(fileURLToPath(import.meta.url)),
): CediaQualifiedTuiResult {
  const result = readCediaTaskContext(sessionDirectory);
  if (!("context" in result)) return result;
  const lockExtension = resolveCediaLockExtension(environment, launcherDirectory);
  if (lockExtension === undefined) return { reason: "the trusted Cedia session-lock extension is unavailable" };
  const forbidden = args.map(qualifiedFlag).find(flag => CEDIA_TUI_FORBIDDEN_FLAGS.has(flag));
  if (forbidden !== undefined) return { reason: `\`${forbidden}\` cannot override the host-owned TUI session context` };
  const directory = realpathSync(sessionDirectory);
  if (environment.CEDIA_HOST_SESSION_ID !== undefined && environment.CEDIA_HOST_SESSION_ID !== result.context.taskId)
    return { reason: "CEDIA_HOST_SESSION_ID conflicts with the host-authored task context" };
  if (environment.CEDIA_SESSION_INCARNATION !== undefined && environment.CEDIA_SESSION_INCARNATION !== result.context.incarnation)
    return { reason: "CEDIA_SESSION_INCARNATION conflicts with the host-authored task context" };
  const ownerLock = join(directory, "owner.sqlite");
  return {
    context: result.context,
    args: [...args, "--session", result.context.sessionFile, "--cwd", result.context.cwd, "--trusted-extension", lockExtension],
    environment: {
      ...environment,
      CEDIA_SESSION_OWNER_DIR: directory,
      CEDIA_SESSION_CONTEXT_PATH: join(directory, CEDIA_TASK_CONTEXT_NAME),
      CEDIA_SESSION_LOCK: ownerLock,
      CEDIA_HOST_SESSION_ID: result.context.taskId,
      CEDIA_SESSION_INCARNATION: result.context.incarnation,
      CEDIA_SESSION_FILE: result.context.sessionFile,
      CEDIA_POLICY_CREDIT_GUARD: "1",
      CEDIA_TUI_OWNER_BRIDGE: "1",
    },
  };
}

function hasExplicitSessionDirectory(argv: readonly string[]): boolean {
  return argv.some(argument => argument === "--cedia-session-dir" || argument.startsWith("--cedia-session-dir="));
}

function usage(): string {
  return [
    "usage: cedia-omp [--cedia-session-dir <dir>] <verb> [omp args...]",
    "",
    "Runs the bundled OMP runtime with your arguments. When a session directory is named",
    "(or CEDIA_SESSION_OWNER_DIR is set) and an owner is already running that session, Cedia",
    "either brokers the verb or refuses - it never starts a second executor and never stops one.",
  ].join("\n");
}

/** The runtime this launcher owns: an explicit override, the packaged neighbour, then the dev build. */
export function resolvePinnedRuntime(environment: NodeJS.ProcessEnv = process.env, launcherDirectory = dirname(fileURLToPath(import.meta.url))): string | undefined {
  const candidates = [
    environment.CEDIA_OMP_PATH,
    environment.CEDIA_OMP_BINARY,
    join(launcherDirectory, "omp"),
    join(launcherDirectory, "..", "dist", "omp", "omp"),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
  for (const candidate of candidates) {
    const resolved = resolve(candidate);
    if (existsSync(resolved)) return resolved;
  }
  return undefined;
}

interface ParsedInvocation {
  readonly verb?: string;
  readonly args: string[];
  readonly sessionDirectory?: string;
}

export function parseLauncherArguments(argv: readonly string[], environment: NodeJS.ProcessEnv = process.env): ParsedInvocation {
  const args: string[] = [];
  let sessionDirectory = environment.CEDIA_SESSION_OWNER_DIR;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--cedia-session-dir") {
      sessionDirectory = argv[index + 1];
      index += 1;
      continue;
    }
    if (argument.startsWith("--cedia-session-dir=")) {
      sessionDirectory = argument.slice("--cedia-session-dir=".length);
      continue;
    }
    args.push(argument);
  }
  return { ...(args[0] === undefined ? {} : { verb: args[0] }), args: args.slice(1), ...(sessionDirectory === undefined ? {} : { sessionDirectory }) };
}

export async function runLauncher(argv: readonly string[], environment: NodeJS.ProcessEnv = process.env): Promise<number> {
  const parsed = parseLauncherArguments(argv, environment);
  if (parsed.verb === undefined) {
    process.stderr.write(`${usage()}\n`);
    return EXIT_USAGE;
  }
  const runtime = resolvePinnedRuntime(environment);
  if (runtime === undefined) {
    process.stderr.write("cedia-omp: the bundled OMP runtime was not found. Set CEDIA_OMP_PATH or run `bun run prepare:omp` in a development checkout.\n");
    return EXIT_USAGE;
  }

  const decision = await decideCediaCliInvocation({
    verb: parsed.verb,
    args: parsed.args,
    ...(parsed.sessionDirectory === undefined ? {} : { sessionDirectory: parsed.sessionDirectory }),
  });

  if (decision.action === "refuse") {
    process.stderr.write(`cedia-omp: ${decision.reason}\n`);
    return EXIT_REFUSED;
  }

  if (decision.action === "attach") {
    const record = readCediaOwnerRecord(parsed.sessionDirectory!);
    if (record === undefined) {
      process.stderr.write("cedia-omp: the owner record disappeared before it could be read.\n");
      return EXIT_REFUSED;
    }
    const answer = await askCediaOwner(record.socket, record.token, parsed.verb === "identify" ? "identify" : "status", 2_000);
    if (answer.ok !== true) {
      process.stderr.write(`cedia-omp: the owner refused the request: ${String(answer.error ?? "no reason given")}\n`);
      return EXIT_REFUSED;
    }
    process.stdout.write(`${JSON.stringify(answer, null, 2)}\n`);
    return 0;
  }

  const qualifiedTui = parsed.verb === "launch" && parsed.sessionDirectory !== undefined && hasExplicitSessionDirectory(argv)
    ? qualifyCediaTuiLaunch(parsed.sessionDirectory, parsed.args, environment)
    : undefined;
  if (qualifiedTui !== undefined && "reason" in qualifiedTui) {
    process.stderr.write(`cedia-omp: cannot qualify this TUI launch: ${qualifiedTui.reason}\n`);
    return EXIT_REFUSED;
  }

  // No owner to respect: this is the pinned runtime running the user's verb, with Cedia's launcher
  // as the only path. stdout/stderr stay the child's, so `--print` and friends behave normally.
  const childArgs = qualifiedTui === undefined ? [parsed.verb!, ...parsed.args] : [parsed.verb!, ...qualifiedTui.args];
  const childEnvironment = qualifiedTui === undefined ? { ...environment } : qualifiedTui.environment;
  return await new Promise<number>(resolveExit => {
    const child = spawn(runtime, childArgs, { stdio: "inherit", env: childEnvironment });
    child.once("error", error => {
      process.stderr.write(`cedia-omp: could not start the OMP runtime: ${error.message}\n`);
      resolveExit(EXIT_REFUSED);
    });
    child.once("exit", (code, signal) => resolveExit(code ?? (signal ? 1 : 0)));
  });
}

/**
 * Run only when this file is the entry point.
 *
 * `import.meta.main` is Bun's; the packaged launcher is an ESM bundle Node runs, where that field
 * does not exist, so the guard compares the real entry path instead.
 */
const invokedDirectly = ((): boolean => {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try { return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();

if (invokedDirectly) process.exitCode = await runLauncher(process.argv.slice(2));
