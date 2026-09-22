import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OmpRpcClient, OmpCommandError, OmpRequestTimeoutError } from "../../../packages/omp-adapter/src/client.ts";
import { ExtensionUiBroker } from "../../../packages/omp-adapter/src/ui.ts";
import { RPC_COMMAND_TYPES, CEDIA_UI_COMMAND_TYPES, isSupportedOmpVersion, OMP_BASELINE_VERSION, type CediaUiCommandType, type RpcCommandType, type RpcCommandPayload, type OmpFrame } from "../../../packages/omp-adapter/src/types.ts";
import type { Command, CommandRequest, Json, Session, SessionEvent, TerminalCheckpoint, UiResponseRequest } from "../../../packages/protocol/src/index.ts";
import { TerminalStateRegistry } from "./terminal-state.ts";
import { DurableStore } from "./store.ts";
import { ProviderAuthManager } from "./provider-auth.ts";
import { collectUsedWorkspacePorts, createWorktree, loadWorkspaceBootstrap, saveSnapshotManifest, workspacePath } from "./workspaces.ts";
import { EditorConnections } from "./editors.ts";
import { NativeEditorBridge } from "./native-editor.ts";
import { OmpHostDispatcher } from "../../../packages/omp-adapter/src/host.ts";
import { suggestWorkspaceMode, type WorkspaceJudge, type WorkspaceSuggestion } from "./workspace-mode.ts";
import { createOmpModelCatalog, type OmpModelCatalog } from "./model-catalog.ts";
import type { ModelCatalogResult } from "../../../packages/protocol/src/models.ts";

export class HostError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 409) { super(message); this.code = code; this.status = status; }
}
export interface HostOptions {
  onDiagnostic?: (message: string) => void;
  store: DurableStore;
  stateDir: string;
  ompExecutable?: string;
  ompEnv?: NodeJS.ProcessEnv;
  ompArgs?: string[];
  lockExtension?: string;
  onEvent?: (event: SessionEvent) => void;
  onFatal?: (error: Error) => void;
  editors?: EditorConnections;
  virtualUi?: boolean;
  nativeBridge?: boolean;
  editorBridge?: boolean;
  /** Opt-in judge for `suggestWorkspaceMode`. Absent means the host has no opinion. */
  workspaceJudge?: WorkspaceJudge;
}
interface Runtime {
  session: Session;
  client?: OmpRpcClient;
  ui: ExtensionUiBroker;
  permissions: ExtensionUiBroker;
  permissionResolvers: Map<string, (allowed: boolean) => void>;
  nativePermissionResolvers: Map<string, (frame: OmpFrame) => void>;
  dispatcher?: OmpHostDispatcher;
  pendingHostFrames: OmpFrame[];
  wireCommands: Map<string, string>;
  activeCommand?: string;
  closing: boolean;
  faulted: boolean;
  timer?: ReturnType<typeof setInterval>;
  /**
   * Headless screen per virtual terminal, when the virtual UI is on. OMP owns the PTY;
   * this keeps the state a reattaching client would otherwise have to replay
   * (docs/maintenance/evidence/terminal-vt-spike-2026-09-16/).
   */
  terminals?: TerminalStateRegistry;
}
interface SidechatMetadata {
  version: 1;
  sourceThreadId: string;
  sourceSessionFile: string;
  createdAt: string;
}
export type SessionView = Session & { sidechatSourceThreadId: string | null };
const terminal = new Set(["completed", "failed", "outcome_unknown", "not_dispatched"]);
const turnCommands = new Set(["prompt", "abort_and_prompt"]);
const json = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** One application host, multiple independently owned OMP sessions. */
export class CediaHost {
  readonly store: DurableStore;
  readonly #options: HostOptions;
  readonly #modelCatalog: OmpModelCatalog;
  readonly #providerAuth: ProviderAuthManager;
  readonly #runtimes = new Map<string, Runtime>();
  readonly #starting = new Map<string, Promise<Session>>();
  readonly #forking = new Map<string, Promise<SessionView>>();
  readonly #stopping = new Map<string, Promise<Session>>();
  readonly #inflight = new Map<string, Promise<Command>>();
  #closing = false;
  #closePromise?: Promise<void>;

  constructor(options: HostOptions) {
    this.#options = options;
    this.store = options.store;
    this.#modelCatalog = createOmpModelCatalog({
      ompExecutable: options.ompExecutable,
      ompEnv: options.ompEnv,
      ompArgs: options.ompArgs,
    });
    // Short-lived OMP metadata workers, the same shape the catalogue uses: no
    // session, transcript, or credential is owned here.
    this.#providerAuth = new ProviderAuthManager({
      ompExecutable: options.ompExecutable,
      ompEnv: options.ompEnv,
      ompArgs: options.ompArgs,
      onChanged: () => this.#modelCatalog.invalidate(),
    });
  }

  createSession(projectId: string, title = "New task", workspaceMode: "local" | "worktree" = "local", id?: string): Session {
    this.#assertOpen();
    const project = this.store.getProject(projectId);
    if (!project) throw new HostError("not_found", "Project not found", 404);
    const session = this.store.createSession({ ...(id === undefined ? {} : { id }), projectId, title, cwd: project.path });
    const directory = join(this.#options.stateDir, "sessions", session.id);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (workspaceMode === "worktree") {
      try {
        const bootstrap = loadWorkspaceBootstrap(project.path);
        const snapshot = createWorktree(project.path, join(this.#options.stateDir, "worktrees", session.id), session.id, {
          allowlist: bootstrap.ignoreAllowlist,
          setupScript: bootstrap.setupScript,
          runScript: bootstrap.runScript,
          portStart: bootstrap.portStart,
          usedPorts: collectUsedWorkspacePorts(this.#options.stateDir),
        });
        saveSnapshotManifest(join(directory, "workspace.json"), snapshot);
        this.store.updateSession(session.id, { cwd: snapshot.cwd });
      } catch (error) {
        this.store.updateSession(session.id, { status: "stopped", archived: true });
        throw error;
      }
    }
    return this.store.updateSession(session.id, { sessionFile: join(directory, "session.jsonl") });
  }

  /**
   * Return the durable host projection plus the sidechat relationship marker.
   * The transcript itself remains in OMP's session file; `sidechat.json` only
   * records the relationship needed to render and re-open the split pane.
   */
  sessionView(session: Session): SessionView {
    return { ...session, sidechatSourceThreadId: this.#readSidechatMetadata(session.id)?.sourceThreadId ?? null };
  }

  listModels(): Promise<ModelCatalogResult> {
    this.#assertOpen();
    return this.#modelCatalog.list();
  }

  /** Provider-auth settings: OMP owns the credentials, this only brokers the calls. */
  providerAuth(): ProviderAuthManager {
    this.#assertOpen();
    return this.#providerAuth;
  }

  /** Create (or idempotently re-open) an OMP-owned fork of a session. */
  async forkSession(sourceId: string, title: string, id: string): Promise<SessionView> {
    const inflight = this.#forking.get(id);
    if (inflight) {
      const result = await inflight;
      if (result.sidechatSourceThreadId === sourceId) return result;
      throw new HostError("sidechat_conflict", "This task id belongs to a different source task", 409);
    }
    const operation = this.#forkSession(sourceId, title, id).finally(() => this.#forking.delete(id));
    this.#forking.set(id, operation);
    return operation;
  }

  async #forkSession(sourceId: string, title: string, id: string): Promise<SessionView> {
    this.#assertOpen();
    const source = this.#session(sourceId);
    if (sourceId === id) throw new HostError("sidechat_conflict", "A sidechat must have a different task id", 409);
    this.#assertOwnedSessionPath(source, source.sessionFile);

    const existing = this.store.getSession(id);
    if (existing) {
      const marker = this.#readSidechatMetadata(id);
      if (marker?.sourceThreadId === sourceId) {
        const starting = this.#starting.get(id);
        if (starting) {
          const started = await starting;
          return this.sessionView(started);
        }
        return this.sessionView(existing);
      }
      throw new HostError("sidechat_conflict", "This task id belongs to a different source task", 409);
    }

    // A freshly-created task has only a projected session path. Let the normal
    // managed OMP runtime materialize it before passing it to `--fork`; this
    // preserves one session owner when multiple sidechats are opened at once.
    if (!existsSync(source.sessionFile)) {
      const started = await this.startSession(source.id);
      if (resolve(started.sessionFile) !== resolve(source.sessionFile) || !existsSync(started.sessionFile)) {
        throw new HostError("session_mismatch", "OMP did not materialize the source session file");
      }
    }

    const project = this.store.getProject(source.projectId);
    if (!project) throw new HostError("not_found", "Source project not found", 404);
    const child = this.createSession(project.id, title, "local", id);
    const directory = join(this.#options.stateDir, "sessions", child.id);
    // A worktree task must fork in the same working directory. OMP copies the
    // transcript, while the child intentionally shares the source's workspace.
    this.store.updateSession(child.id, { cwd: source.cwd });
    const marker: SidechatMetadata = {
      version: 1,
      sourceThreadId: source.id,
      sourceSessionFile: source.sessionFile,
      createdAt: new Date().toISOString(),
    };
    try {
      this.#writeSidechatMetadata(directory, marker);
      const started = await this.startSession(child.id, source.sessionFile);
      return this.sessionView(started);
    } catch (error) {
      // #startSession closes a partially-created OMP client itself. This second
      // stop is for a race where a ready runtime appeared before a later check.
      await this.stopSession(child.id).catch(() => {});
      try { this.store.deleteSession(child.id); } catch { /* The startup path may already have removed it. */ }
      rmSync(directory, { recursive: true, force: true });
      throw error;
    }
  }

  #readSidechatMetadata(id: string): SidechatMetadata | undefined {
    const path = join(this.#options.stateDir, "sessions", id, "sidechat.json");
    if (!existsSync(path)) return undefined;
    try {
      const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      if (value.version !== 1 || typeof value.sourceThreadId !== "string" || typeof value.sourceSessionFile !== "string" || typeof value.createdAt !== "string") return undefined;
      return { version: 1, sourceThreadId: value.sourceThreadId, sourceSessionFile: value.sourceSessionFile, createdAt: value.createdAt };
    } catch {
      return undefined;
    }
  }

  #writeSidechatMetadata(directory: string, metadata: SidechatMetadata): void {
    const path = join(directory, "sidechat.json");
    const temporary = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(metadata), { mode: 0o600 });
    renameSync(temporary, path);
  }

  /**
   * Ask the configured judge whether a request should start in its own worktree.
   *
   * This never changes a session by itself: it returns `undefined` when no judge is configured
   * or the judge has no usable answer, and the caller keeps its own default. `createSession`
   * stays synchronous and unaffected.
   */
  async suggestWorkspaceMode(prompt: string): Promise<WorkspaceSuggestion | undefined> {
    this.#assertOpen();
    const judge = this.#options.workspaceJudge;
    return judge ? suggestWorkspaceMode(judge, prompt) : undefined;
  }

  /** Start a session, optionally asking OMP to create it by forking a source file. */
  startSession(id: string, forkSource?: string): Promise<Session> {
    this.#assertOpen();
    const stopping = this.#stopping.get(id);
    if (stopping) return stopping.then(() => this.startSession(id, forkSource));
    const existing = this.#runtimes.get(id);
    if (existing?.client?.phase === "ready" && !existing.closing) return Promise.resolve(existing.session);
    const starting = this.#starting.get(id);
    if (starting) return starting;
    if (existing) return this.#lost(existing, "OMP process exited").then(() => this.startSession(id, forkSource));
    const operation = this.#startSession(id, forkSource).finally(() => this.#starting.delete(id));
    this.#starting.set(id, operation);
    return operation;
  }

  async #startSession(id: string, forkSource?: string): Promise<Session> {
    const before = this.#session(id);
    if (before.status === "recovery_required") throw new HostError("recovery_required", "Previous work has an unknown outcome. Reconcile before resuming; it will never be replayed automatically.");
    const executable = this.#options.ompExecutable ?? "omp";
    // Probe with the same environment the runtime will be spawned with: a launcher that
    // selects a binary through `ompEnv` has to be described by the version it reports
    // under that environment, not by whatever the host process's own PATH resolves to.
    // Async so a slow launcher cannot freeze every other session's HTTP/command work.
    const version = (await new Promise<string>((resolveVersion, rejectVersion) => {
      execFile(executable, ["--version"], {
        encoding: "utf8",
        timeout: 10_000,
        env: { ...process.env, ...(this.#options.ompEnv ?? {}) },
      }, (error, stdout) => error ? rejectVersion(error) : resolveVersion(stdout));
    })).trim();
    // The baseline is a floor, not a pin: an older runtime than the one the adapter
    // contract was written against is refused by name, and anything newer runs - what it
    // can do is read from its ready frame (the Cedia bridges are capability-gated there),
    // not guessed from its version (see isSupportedOmpVersion).
    if (!isSupportedOmpVersion(version)) {
      throw new HostError("unsupported_omp", `Expected OMP ${OMP_BASELINE_VERSION} or later; received ${version}`);
    }
    const directory = join(this.#options.stateDir, "sessions", before.id);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.#assertOwnedSessionPath(before, before.sessionFile);
    // Rotate the incarnation for the new process, but leave the persisted status alone:
    // `agent_start` owns "running" and the ready path below owns "idle". A crash while
    // starting then leaves an idle task instead of a recovery_required one that never ran.
    const session = this.store.updateSession(id, { incarnation: randomUUID() });
    const runtime: Runtime = {
      session, closing: false, faulted: false, pendingHostFrames: [], wireCommands: new Map(), permissionResolvers: new Map(), nativePermissionResolvers: new Map(),
      permissions: new ExtensionUiBroker({
        send: frame => { runtime.permissionResolvers.get(String(frame.id))?.("confirmed" in frame && frame.confirmed === true); runtime.nativePermissionResolvers.get(String(frame.id))?.({ ...frame }); },
        onEvent: event => this.#record(runtime, { type: "cedia_ui", origin: "cedia_host_policy_v1", event: json(event) }),
      }),
      ui: new ExtensionUiBroker({
        send: async frame => {
          if (!runtime.client || runtime.closing) throw new HostError("unavailable", "OMP is not available");
          await runtime.client.send(frame);
        },
        onEvent: event => this.#record(runtime, { type: "cedia_ui", event: json(event) }),
      }),
      ...(this.#options.virtualUi ? { terminals: new TerminalStateRegistry() } : {}),
    };
    this.#runtimes.set(id, runtime);
    try {
      const lockExtension = this.#options.lockExtension ?? fileURLToPath(new URL("./runtime-lock.ts", import.meta.url));
      runtime.client = await OmpRpcClient.start({ executable, cwd: realpathSync(session.cwd),
        args: ["--no-title", "--cwd", session.cwd,
          ...(forkSource === undefined ? ["--session", session.sessionFile] : ["--fork", forkSource]),
          "--session-dir", directory,
          ...(this.#options.ompArgs ?? []), "--trusted-extension", lockExtension],
        env: {
          ...(this.#options.ompEnv ?? process.env),
          XDG_STATE_HOME: (this.#options.ompEnv ?? process.env).XDG_STATE_HOME ?? join(this.#options.stateDir, "xdg-state"),
          CEDIA_SESSION_LOCK: join(directory, "owner.sqlite"),
          CEDIA_NATIVE_CACHE_DIR: join(this.#options.stateDir, "omp-natives"),
          ...(this.#options.virtualUi ? { CEDIA_RPC_VIRTUAL_UI: "1" } : {}),
          ...(this.#options.nativeBridge ? { CEDIA_RPC_NATIVE_BRIDGE: "1" } : {}),
          ...(this.#options.editorBridge ? { CEDIA_RPC_EDITOR_BRIDGE: "1" } : {}),
        },
        readyTimeoutMs: 20_000, requestTimeoutMs: 30_000,
        onFrame: frame => this.#onFrame(runtime, frame),
      });
      if ((this.#options.nativeBridge || this.#options.editorBridge) && runtime.client.readyFrame?.cediaNativeBridgeVersion !== 1) throw new HostError("unsupported_native_bridge", "This OMP runtime does not support the Cedia native permission bridge");
      if (this.#options.editorBridge && (!this.#options.editors || runtime.client.readyFrame?.cediaEditorBridgeVersion !== 1)) throw new HostError("unsupported_editor_bridge", "This OMP runtime does not support guarded native editor snapshots");
      if (this.#options.virtualUi) await runtime.client.requestCedia("cedia_terminal_negotiate", { version: 1, cols: 100, rows: 30 });
      if (this.#options.editors || this.#options.nativeBridge || this.#options.editorBridge) {
        runtime.dispatcher = new OmpHostDispatcher({ requestTimeoutMs: 125_000, send: frame => runtime.client!.send(frame),
          authorize: (request, signal) => object(request.arguments) && !["apply", "apply_disk", "create", "delete", "move"].includes(String(request.arguments.kind)) ? true : this.#permission(runtime, request, signal),
        });
        if (this.#options.editors) runtime.dispatcher.registerTool({ definition: { name: "cedia_editor", description: "Read or apply guarded edits to this task's native editor buffers. Read returns a handle, documentVersion and sha256; apply must echo these. Never saves automatically.", loadMode: "eager",
          parameters: { type: "object", properties: { kind: { type: "string", enum: ["read", "apply", "inventory", "create", "delete", "move"] }, path: { type: "string" }, destination: { type: "string" }, handle: { type: "object" }, expectedVersion: { type: "number" }, expectedHash: { type: "string" }, edits: { type: "array" }, content: { type: "string" } }, required: ["kind"] } },
          handler: async (request, context) => ({ content: [{ type: "text", text: JSON.stringify(await this.#options.editors!.request(runtime.session.cwd, request.arguments as Record<string, unknown>, context.signal)) }] }),
        });
        if (this.#options.nativeBridge || this.#options.editorBridge) runtime.dispatcher.registerTool({ definition: { name: "cedia_native_permission", description: "Internal OMP permission bridge", parameters: { type: "object" } },
          handler: async (request, context) => ({ content: [{ type: "text", text: JSON.stringify(await this.#nativePermission(runtime, request.arguments, context.signal)) }] }),
        });
        if (this.#options.editorBridge && this.#options.editors) {
          const editor = new NativeEditorBridge(this.#options.editors, runtime.session.cwd);
          runtime.dispatcher.registerTool({ definition: { name: "cedia_native_editor", description: "Internal guarded native editor bridge", parameters: { type: "object" } },
            handler: async (request, context) => ({ content: [{ type: "text", text: JSON.stringify(await editor.handle(request.arguments, context.signal)) }] }),
          });
        }
        for (const frame of runtime.pendingHostFrames.splice(0)) void runtime.dispatcher.handle(frame);
        await runtime.client.request("set_host_tools", { tools: runtime.dispatcher.getToolDefinitions().filter(tool => !tool.name.startsWith("cedia_native_")) });
      }
      const state = (await runtime.client.request("get_state")).data;
      const forkPathInside = object(state) && typeof state.sessionFile === "string" ? this.#pathInsideSessionDirectory(directory, state.sessionFile) : false;
      if (!object(state) || typeof state.sessionFile !== "string" || (forkSource === undefined
        ? resolve(state.sessionFile) !== resolve(session.sessionFile)
        : !forkPathInside)) {
        throw new HostError("session_mismatch", "OMP resumed a different session file");
      }
      runtime.session = this.store.updateSession(id, {
        status: "idle",
        ...(forkSource === undefined ? {} : { sessionFile: state.sessionFile }),
      });
      this.#record(runtime, { type: "cedia_session", session: json(runtime.session), state: json(state) });
      if (forkSource !== undefined) {
        // OMP owns the inherited transcript. Recording this response lets the
        // renderer hydrate the fork from the child session without copying or
        // inventing transcript entries in the host store.
        await runtime.client.request("get_messages");
      }
      await runtime.client.request("set_subagent_subscription", { level: "events" });
      runtime.timer = setInterval(() => {
        if (runtime.client?.phase === "closed" && !runtime.closing) void this.#lost(runtime, "OMP process exited").catch(error => this.#options.onFatal?.(error));
      }, 250);
      runtime.timer.unref?.();
      return runtime.session;
    } catch (error) {
      try { this.#options.onDiagnostic?.(`OMP session startup failed: ${error instanceof Error ? error.message : String(error)}`); } catch { /* Diagnostics must never prevent process cleanup. */ }
      runtime.closing = true;
      runtime.ui.dispose();
      this.#disposePolicy(runtime);
      await runtime.client?.close().catch(() => {});
      this.#runtimes.delete(id);
      this.store.updateSession(id, { status: "stopped" });
      throw error;
    }
  }

  async command(sessionId: string, deviceId: string, request: CommandRequest): Promise<Command> {
    this.#assertOpen();
    if (!RPC_COMMAND_TYPES.includes(request.command as RpcCommandType) && !(CEDIA_UI_COMMAND_TYPES as readonly string[]).includes(request.command)) throw new HostError("invalid_command", "Unknown OMP command", 400);
    const session = this.#session(sessionId);
    const key = `${sessionId}:${request.commandId}`;
    const previous = this.store.getCommand(sessionId, request.commandId);
    if (!previous && request.incarnation !== session.incarnation) throw new HostError("stale_incarnation", "Refresh the task before submitting this command");
    // A start in flight will not dispatch this command, so refuse it transiently instead
    // of claiming a `not_dispatched` row the client would replay forever. A command that
    // already has a row (idempotent replay) is still returned below.
    if (!previous && this.#starting.has(sessionId)) throw new HostError("session_starting", "The OMP session is starting; retry when it is ready", 409);
    if (request.command === "switch_session") this.#assertOwnedSessionPath(session, request.payload?.sessionPath);
    const claim = this.store.claimCommand({ sessionId, commandId: request.commandId, deviceId,
      incarnation: request.incarnation, kind: request.command, payload: request.payload ?? {} });
    if (!claim.created) return this.#inflight.get(key) ?? claim.command;
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime?.client || runtime.client.phase !== "ready" || runtime.closing) {
      return this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: "Start or reconcile the OMP session before sending commands" });
    }
    if (turnCommands.has(request.command) && runtime.activeCommand) {
      return this.store.transitionCommand(sessionId, request.commandId, "not_dispatched", { error: "A prompt is active; use steer, follow_up, or abort first" });
    }
    if (turnCommands.has(request.command)) runtime.activeCommand = request.commandId;
    const operation = this.#dispatch(runtime, request).finally(() => this.#inflight.delete(key));
    this.#inflight.set(key, operation);
    return operation;
  }

  async #dispatch(runtime: Runtime, request: CommandRequest): Promise<Command> {
    const id = runtime.session.id;
    try {
      const options = {
        onRequestId: (wireId: string) => { runtime.wireCommands.set(wireId, request.commandId); },
        // OMP login waits for the OAuth browser/code path (onPrompt timeout 600s).
        ...(request.command === "login" ? { timeoutMs: 600_000 } : {}),
      };
      const ack = (CEDIA_UI_COMMAND_TYPES as readonly string[]).includes(request.command)
        ? await runtime.client!.requestCedia(request.command as CediaUiCommandType, request.payload ?? {}, options)
        : await runtime.client!.request(request.command as RpcCommandType, (request.payload ?? {}) as RpcCommandPayload<RpcCommandType>, options);
      const current = this.store.getCommand(id, request.commandId)!;
      if (!terminal.has(current.status)) {
        const localOnly = object(ack.data) && ack.data.agentInvoked === false;
        const awaitsTurn = turnCommands.has(request.command) && request.command !== "handoff" && !localOnly;
        this.store.transitionCommand(id, request.commandId, awaitsTurn ? "acknowledged" : "completed", { ack: json(ack),
          ...(awaitsTurn ? {} : { result: { meaning: "OMP command acknowledged", data: json(ack.data ?? null) } }) });
        if (!awaitsTurn && runtime.activeCommand === request.commandId) runtime.activeCommand = undefined;
      }
      if (request.command === "cedia_terminal_resize") this.#resizeTerminal(runtime, request.payload);
      if (["new_session", "switch_session", "branch"].includes(request.command)) {
        const state = (await runtime.client!.request("get_state")).data;
        if (object(state) && typeof state.sessionFile === "string") {
          this.#assertOwnedSessionPath(runtime.session, state.sessionFile);
          runtime.session = this.store.updateSession(id, { sessionFile: state.sessionFile });
        }
      }
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(id, request.commandId)) });
    } catch (error) {
      const current = this.store.getCommand(id, request.commandId)!;
      if (!terminal.has(current.status)) {
        const status = error instanceof OmpCommandError ? "failed"
          : error instanceof OmpRequestTimeoutError && error.outcome === "not-dispatched" ? "not_dispatched" : "outcome_unknown";
        this.store.transitionCommand(id, request.commandId, status, { error: String(error) });
      }
      if (runtime.activeCommand === request.commandId && this.store.getCommand(id, request.commandId)?.status !== "outcome_unknown") runtime.activeCommand = undefined;
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(id, request.commandId)) });
    }
    const result = this.store.getCommand(id, request.commandId)!;
    if (terminal.has(result.status) && result.status !== "outcome_unknown") this.#forgetWireCommand(runtime, request.commandId);
    return result;
  }

  async respond(sessionId: string, deviceId: string, request: UiResponseRequest): Promise<Command> {
    this.#assertOpen();
    const session = this.#session(sessionId);
    const previous = this.store.getCommand(sessionId, request.commandId);
    if (!previous && session.incarnation !== request.incarnation) throw new HostError("stale_incarnation", "This interaction belongs to an earlier OMP process");
    const claim = this.store.claimCommand({ sessionId, commandId: request.commandId, deviceId,
      incarnation: request.incarnation, kind: "ui_response", payload: json({ token: request.token, answer: request.answer }) });
    if (!claim.created) return claim.command;
    const runtime = this.#runtimes.get(sessionId);
    try {
      if (!runtime || runtime.closing) throw new HostError("unavailable", "OMP session is not running");
      const broker = runtime.permissions.pendingTokens().includes(request.token) ? runtime.permissions : runtime.ui;
      await broker.respond(request.token, request.answer);
      return this.store.transitionCommand(sessionId, request.commandId, "completed", { result: { meaning: "UI response submitted to OMP; this is not proof of a tool effect" } });
    } catch (error) {
      const status = object(error) && error.code === "send-failed" ? "outcome_unknown" : "not_dispatched";
      return this.store.transitionCommand(sessionId, request.commandId, status, { error: String(error) });
    }
  }

  pendingUi(id: string): Json[] {
    const runtime = this.#runtimes.get(id);
    return runtime ? [...runtime.ui.pendingRequests(), ...runtime.permissions.pendingRequests()].map(event => json(event)) : [];
  }

  reconcile(id: string): Session {
    this.#assertOpen();
    if (this.#runtimes.has(id)) throw new HostError("running", "Stop the live session before reconciliation");
    const session = this.#session(id);
    if (session.status !== "recovery_required") return session;
    return this.store.updateSession(id, { status: "stopped" });
  }

  stopSession(id: string): Promise<Session> {
    const previous = this.#stopping.get(id);
    if (previous) return previous;
    const operation = this.#stopSession(id).finally(() => this.#stopping.delete(id));
    this.#stopping.set(id, operation);
    return operation;
  }

  async #stopSession(id: string): Promise<Session> {
    const starting = this.#starting.get(id);
    if (starting) await starting.catch(() => {});
    const runtime = this.#runtimes.get(id);
    if (!runtime) return this.#session(id);
    runtime.closing = true;
    runtime.ui.dispose();
    this.#disposePolicy(runtime);
    if (runtime.timer) clearInterval(runtime.timer);
    runtime.terminals?.dispose();
    await runtime.client?.close();
    if (this.#runtimes.get(id) === runtime) this.#runtimes.delete(id);
    this.#unknownCommands(id, "OMP session was stopped before completion");
    runtime.session = this.store.updateSession(id, { status: "stopped" });
    this.#record(runtime, { type: "cedia_session", session: json(runtime.session) });
    return runtime.session;
  }

  /**
   * The headless screen per virtual terminal for one session.
   *
   * Read-only and cheap: a client that has just attached (or reattached after the
   * mobile history was trimmed) can render this instead of asking OMP for a redraw.
   * An empty list is an honest answer - the session is not running, the virtual UI is
   * off, or this host has no terminal engine for its platform.
   */
  terminalSnapshots(id: string): readonly TerminalCheckpoint[] {
    this.#assertOpen();
    this.#session(id);
    return this.#runtimes.get(id)?.terminals?.snapshots() ?? [];
  }

  /**
   * Delete a session for good: stop whatever is running, drop the record (commands
   * and events follow through the foreign keys) and remove what the host wrote for
   * the session on disk - its transcript directory and its artifacts.
   *
   * A worktree the session created is deliberately left alone: it can hold the
   * user's uncommitted work, and removing it is a larger promise than deleting a
   * chat. The window that asks for this confirms first ("This action cannot be
   * undone."), so there is no second confirmation here.
   */
  async deleteSession(id: string): Promise<void> {
    this.#assertOpen();
    this.#session(id);
    await this.stopSession(id);
    this.store.deleteSession(id);
    rmSync(join(this.#options.stateDir, "sessions", id), { recursive: true, force: true });
    rmSync(join(this.#options.stateDir, "artifacts", id), { recursive: true, force: true });
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#closing = true;
    return this.#closePromise = (async () => {
      await Promise.allSettled([...this.#starting.values()]);
      await this.#providerAuth.close();
      const results = await Promise.allSettled([...this.#runtimes.keys()].map(id => this.stopSession(id)));
      const failed = results.find(result => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    })();
  }

  /**
   * Apply a client's resize to the headless screen.
   *
   * It runs after OMP acknowledged the command, so the host's grid follows the PTY it
   * is actually describing instead of a request that may not have landed.
   */
  #resizeTerminal(runtime: Runtime, payload: Record<string, Json> | undefined): void {
    const value = payload ?? {};
    const terminalId = typeof value.terminalId === "string" ? value.terminalId : undefined;
    const cols = typeof value.cols === "number" ? value.cols : undefined;
    const rows = typeof value.rows === "number" ? value.rows : undefined;
    if (!terminalId || !cols || !rows) return;
    runtime.terminals?.resize(terminalId, cols, rows);
  }

  #onFrame(runtime: Runtime, frame: OmpFrame): void {
    if (runtime.faulted) return;
    try {
      this.#record(runtime, frame);
      // Every terminal frame passes through here, so this is where the headless screen
      // stays in step with what the clients are being streamed.
      runtime.terminals?.apply(frame);
      runtime.ui.ingest(frame);
      if (typeof frame.type === "string" && ["host_tool_call", "host_tool_cancel", "host_uri_request", "host_uri_cancel"].includes(frame.type)) {
        if (runtime.dispatcher) void runtime.dispatcher.handle(frame);
        else if (this.#options.editors || this.#options.nativeBridge || this.#options.editorBridge) {
          if (runtime.pendingHostFrames.length >= 100) throw new Error("Startup host bridge request capacity reached");
          runtime.pendingHostFrames.push(frame);
        }
      }
      const commandId = typeof frame.id === "string" ? runtime.wireCommands.get(frame.id) : undefined;
      if (frame.type === "agent_start") runtime.session = this.store.updateSession(runtime.session.id, { status: "running" });
      if (frame.type === "prompt_result" && commandId) this.#complete(runtime, commandId, frame);
      if (frame.type === "response" && frame.success === false && commandId) {
        const current = this.store.getCommand(runtime.session.id, commandId);
        if (current && !terminal.has(current.status)) this.store.transitionCommand(runtime.session.id, commandId, "failed", { error: String(frame.error) });
        if (runtime.activeCommand === commandId) runtime.activeCommand = undefined;
      }
      if (frame.type === "agent_end" && frame.isTerminal !== false) {
        if (runtime.activeCommand) this.#complete(runtime, runtime.activeCommand, frame);
        runtime.session = this.store.updateSession(runtime.session.id, { status: "idle" });
      }
    } catch (error) {
      runtime.faulted = true;
      runtime.ui.dispose();
      this.#disposePolicy(runtime);
      void runtime.client?.close().catch(() => {});
      this.#options.onFatal?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  #complete(runtime: Runtime, commandId: string, frame: OmpFrame): void {
    const current = this.store.getCommand(runtime.session.id, commandId);
    if (current && !terminal.has(current.status)) {
      this.store.transitionCommand(runtime.session.id, commandId, "completed", { result: json(frame) });
      this.#record(runtime, { type: "cedia_command", command: json(this.store.getCommand(runtime.session.id, commandId)) });
    }
    if (runtime.activeCommand === commandId) runtime.activeCommand = undefined;
    this.#forgetWireCommand(runtime, commandId);
  }
  #forgetWireCommand(runtime: Runtime, commandId: string) {
    for (const [wireId, id] of runtime.wireCommands) if (id === commandId) runtime.wireCommands.delete(wireId);
  }
  #record(runtime: Runtime, frame: unknown): void {
    const event = this.store.appendEvent(runtime.session.id, runtime.session.incarnation, json(frame));
    this.#options.onEvent?.(event);
  }
  async #lost(runtime: Runtime, reason: string): Promise<void> {
    if (this.#runtimes.get(runtime.session.id) !== runtime || runtime.closing) return;
    runtime.closing = true;
    runtime.ui.dispose();
    this.#disposePolicy(runtime);
    if (runtime.timer) clearInterval(runtime.timer);
    runtime.terminals?.dispose();
    this.#runtimes.delete(runtime.session.id);
    this.#unknownCommands(runtime.session.id, reason);
    runtime.session = this.store.updateSession(runtime.session.id, { status: "recovery_required" });
    this.#record(runtime, { type: "cedia_session", session: json(runtime.session), reason });
  }
  #unknownCommands(id: string, reason: string): void {
    for (const command of this.store.listPendingCommands(id)) {
      if (!terminal.has(command.status)) this.store.transitionCommand(id, command.commandId, "outcome_unknown", { error: reason });
    }
  }
  #permission(runtime: Runtime, request: unknown, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted || runtime.closing) return Promise.resolve(false);
    const id = randomUUID();
    return new Promise(resolve => {
      const finish = (allowed: boolean) => { runtime.permissionResolvers.delete(id); signal.removeEventListener("abort", abort); resolve(allowed && !signal.aborted && !runtime.closing); };
      const abort = () => { runtime.permissions.ingest({ type: "extension_ui_request", id: randomUUID(), method: "cancel", targetId: id }); finish(false); };
      runtime.permissionResolvers.set(id, finish); signal.addEventListener("abort", abort, { once: true });
      this.#record(runtime, { type: "cedia_permission", policyVersion: 1, requestId: id, request: json(request) });
      runtime.permissions.ingest({ type: "extension_ui_request", id, method: "confirm", title: "Allow this editor change?", message: JSON.stringify(request, null, 2), timeout: 30_000 });
    });
  }
  #nativePermission(runtime: Runtime, value: unknown, signal: AbortSignal): Promise<Json> {
    if (!object(value) || value.kind !== "permission" || !object(value.toolCall) || !Array.isArray(value.options) || value.options.length < 1 || value.options.length > 16) return Promise.reject(new Error("Invalid native permission request"));
    const options = value.options;
    const toolCall = value.toolCall;
    const kinds = new Set(["allow_once", "allow_always", "reject_once", "reject_always"]);
    if (options.some(option => !object(option) || typeof option.optionId !== "string" || typeof option.name !== "string" || typeof option.kind !== "string" || !kinds.has(option.kind)) || new Set(options.map(option => option.optionId)).size !== options.length) return Promise.reject(new Error("Invalid permission options"));
    if (signal.aborted || runtime.closing) return Promise.resolve({ outcome: "cancelled" });
    const id = randomUUID();
    const labels = options.map((option, index) => `${index + 1}. ${option.name}`);
    return new Promise(resolve => {
      let settled = false;
      const finish = (outcome: Json) => { if (settled) return; settled = true; runtime.nativePermissionResolvers.delete(id); signal.removeEventListener("abort", abort); try { this.#record(runtime, { type: "cedia_native_permission_outcome", policyVersion: 1, requestId: id, outcome }); resolve(outcome); } catch (error) { resolve({ outcome: "cancelled" }); this.#options.onFatal?.(error instanceof Error ? error : new Error(String(error))); } };
      const abort = () => { runtime.permissions.ingest({ type: "extension_ui_request", id: randomUUID(), method: "cancel", targetId: id }); finish({ outcome: "cancelled" }); };
      runtime.nativePermissionResolvers.set(id, frame => {
        const index = typeof frame.value === "string" ? labels.indexOf(frame.value) : -1;
        const selected = options[index];
        finish(index >= 0 && selected && !signal.aborted && !runtime.closing ? { outcome: "selected", optionId: selected.optionId, kind: selected.kind } : { outcome: "cancelled" });
      });
      signal.addEventListener("abort", abort, { once: true });
      this.#record(runtime, { type: "cedia_native_permission", policyVersion: 1, requestId: id, request: json(value) });
      runtime.permissions.ingest({ type: "extension_ui_request", id, method: "select", title: `${String(toolCall.title ?? "Allow this operation?")}\n${JSON.stringify(toolCall.rawInput ?? {})}`, options: labels, timeout: 120_000 });
    });
  }
  #disposePolicy(runtime: Runtime) { runtime.dispatcher?.dispose(); runtime.permissions.dispose(); for (const finish of [...runtime.permissionResolvers.values()]) finish(false); for (const finish of [...runtime.nativePermissionResolvers.values()]) finish({ type: "extension_ui_response", cancelled: true }); }
  #session(id: string): Session {
    const session = this.store.getSession(id);
    if (!session) throw new HostError("not_found", "Task not found", 404);
    return session;
  }
  #assertOwnedSessionPath(session: Session, path: unknown): void {
    if (typeof path !== "string" || !isAbsolute(path)) throw new HostError("invalid_session_path", "Session path must be absolute", 400);
    try { workspacePath(join(this.#options.stateDir, "sessions", session.id), path); }
    catch { throw new HostError("session_boundary", "Import external OMP sessions into a new task before switching"); }
  }
  #pathInsideSessionDirectory(directory: string, path: string): boolean {
    if (!isAbsolute(path)) return false;
    try {
      workspacePath(directory, path);
      return true;
    } catch {
      return false;
    }
  }
  #assertOpen(): void { if (this.#closing) throw new HostError("closing", "Cedia host is shutting down", 503); }
}
