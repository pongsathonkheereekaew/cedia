/** The status vocabulary owned by OMP's native TodoTool. */
export type OmpTodoTaskStatus = "pending" | "in_progress" | "completed" | "blocked";

export type OmpTodoTask = {
  readonly content: string;
  readonly status: OmpTodoTaskStatus;
  readonly blocker?: string;
};

export type OmpTodoPhase = {
  readonly name: string;
  readonly tasks: readonly OmpTodoTask[];
};

export type OmpTodoSnapshot =
  | { readonly state: "available"; readonly revision: number; readonly phases: readonly OmpTodoPhase[] }
  | { readonly state: "unavailable"; readonly reason: string };

/** The only runtime operation this projection needs. */
export type OmpTodosClient = {
  readonly phase: string;
  readonly request: (
    command: "get_state",
    payload?: Record<string, never>,
  ) => Promise<{ readonly data?: unknown }>;
};

export const NO_OMP_TODOS_RUNTIME_REASON = "No OMP runtime is running; Cedia cannot read this task's progress.";
export const NO_OMP_TODOS_STATE_REASON = "The OMP runtime did not return todo phases in get_state.";

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  return value;
}

function exact(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const keys = new Set(allowed);
  for (const key of Object.keys(value)) if (!keys.has(key)) throw new TypeError(`${label} has an unknown field ${key}`);
}

/** Parse OMP's complete todo phase list without inventing defaults or partial rows. */
export function parseOmpTodoPhases(value: unknown): OmpTodoPhase[] {
  if (!Array.isArray(value)) throw new TypeError("OMP todo phases must be an array");
  return value.map((phase, phaseIndex) => {
    const item = record(phase, `OMP todo phase ${phaseIndex}`);
    exact(item, ["name", "tasks"], `OMP todo phase ${phaseIndex}`);
    const name = text(item.name, `OMP todo phase ${phaseIndex} name`);
    if (!Array.isArray(item.tasks)) throw new TypeError(`OMP todo phase ${phaseIndex} tasks must be an array`);
    const tasks = item.tasks.map((task, taskIndex) => {
      const row = record(task, `OMP todo task ${phaseIndex}.${taskIndex}`);
      exact(row, ["content", "status", "blocker"], `OMP todo task ${phaseIndex}.${taskIndex}`);
      const status: OmpTodoTaskStatus = row.status as OmpTodoTaskStatus;
      if (status !== "pending" && status !== "in_progress" && status !== "completed" && status !== "blocked") {
        throw new TypeError(`OMP todo task ${phaseIndex}.${taskIndex} has an unsupported status`);
      }
      const content = text(row.content, `OMP todo task ${phaseIndex}.${taskIndex} content`);
      const blocker = row.blocker === undefined ? undefined : text(row.blocker, `OMP todo task ${phaseIndex}.${taskIndex} blocker`);
      return { content, status, ...(blocker === undefined ? {} : { blocker }) };
    });
    return { name, tasks };
  });
}

function responseData(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "data")) {
    return (value as { data?: unknown }).data;
  }
  return value;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Per-session projection of OMP's own todo phases. It never starts a runtime and never turns a
 * missing or malformed answer into an empty list.
 */
export class OmpTodos {
  #client: OmpTodosClient | undefined;
  #phases: readonly OmpTodoPhase[] | undefined;
  #revision = 0;
  #unavailableReason: string;

  constructor(options: { readonly client?: OmpTodosClient; readonly unavailableReason?: string } = {}) {
    this.#client = options.client;
    this.#unavailableReason = options.unavailableReason ?? NO_OMP_TODOS_RUNTIME_REASON;
  }

  setClient(client: OmpTodosClient | undefined): void {
    this.#client = client;
    if (!client) this.#clearUnavailable(NO_OMP_TODOS_RUNTIME_REASON);
  }

  /** Seed from the already-issued startup `get_state` answer. */
  seedFromState(state: unknown): void {
    try {
      const item = record(responseData(state), "OMP get_state");
      if (!Object.hasOwn(item, "todoPhases")) throw new TypeError(NO_OMP_TODOS_STATE_REASON);
      this.#set(parseOmpTodoPhases(item.todoPhases));
    } catch (error) {
      this.#keepOrUnavailable(errorText(error));
    }
  }

  /** Read `get_state` once for a live session, retaining known phases on a malformed answer. */
  async seed(): Promise<void> {
    const client = this.#client;
    if (!client || client.phase !== "ready") {
      this.#clearUnavailable(NO_OMP_TODOS_RUNTIME_REASON);
      return;
    }
    try {
      const response = await client.request("get_state");
      this.seedFromState(responseData(response));
    } catch (error) {
      this.#keepOrUnavailable(errorText(error));
    }
  }

  /** Re-read `get_state` after a turn boundary. */
  async refresh(): Promise<void> {
    const client = this.#client;
    if (!client || client.phase !== "ready") {
      this.#clearUnavailable(NO_OMP_TODOS_RUNTIME_REASON);
      return;
    }
    try {
      const response = await client.request("get_state");
      this.seedFromState(responseData(response));
    } catch (error) {
      this.#keepOrUnavailable(errorText(error));
    }
  }

  /** Fold one native `tool_execution_end` TodoTool result into the cache. */
  update(frame: unknown): void {
    try {
      const item = record(frame, "OMP frame");
      if (item.type !== "tool_execution_end" || item.toolName !== "todo") return;
      const result = record(item.result, "OMP todo tool result");
      const details = record(result.details, "OMP todo tool details");
      this.#set(parseOmpTodoPhases(details.phases));
    } catch {
      // Runtime frames are advisory input. A malformed or partial result must not poison the
      // last complete projection.
    }
  }

  snapshot(): OmpTodoSnapshot {
    if (this.#phases === undefined) return { state: "unavailable", reason: this.#unavailableReason };
    return { state: "available", revision: this.#revision, phases: this.#phases };
  }

  #set(phases: readonly OmpTodoPhase[]): void {
    const next = phases.map(phase => ({ name: phase.name, tasks: phase.tasks.map(task => ({ ...task })) }));
    if (this.#phases !== undefined && JSON.stringify(this.#phases) === JSON.stringify(next)) {
      this.#unavailableReason = "";
      return;
    }
    this.#phases = next;
    this.#revision += 1;
    this.#unavailableReason = "";
  }

  #keepOrUnavailable(reason: string): void {
    if (this.#phases === undefined) this.#unavailableReason = reason;
  }

  #clearUnavailable(reason: string): void {
    this.#phases = undefined;
    this.#unavailableReason = reason;
  }
}
