import { describe, expect, it } from "bun:test";
import { CliUsageError, parseCliArgs, runCli, runCliOp, type CliHttp } from "../src/cli-client.ts";

function stubHttp(routes: Record<string, { status: number; body: unknown }>): { http: CliHttp; calls: Array<{ method: string; path: string; body?: unknown }> } {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const http: CliHttp = async (method, path, body) => {
    calls.push({ method, path, body });
    const key = `${method} ${path.split("?")[0]}`;
    const route = routes[key] ?? routes[`${method} *`];
    if (!route) throw new Error(`Unexpected call ${key}`);
    return route;
  };
  return { http, calls };
}

describe("cedia-host argument parsing", () => {
  it("lists sessions with an optional project filter", () => {
    expect(parseCliArgs(["sessions"])).toEqual({ verb: "sessions", projectId: undefined });
    expect(parseCliArgs(["sessions", "--project", "p1"])).toEqual({ verb: "sessions", projectId: "p1" });
  });

  it("rejects a bad workspace mode", () => {
    expect(() => parseCliArgs(["session-create", "--project", "p"])).not.toThrow();
    expect(() => parseCliArgs(["session-create", "--project", "p", "--mode", "cloud"])).toThrow(CliUsageError);
  });

  it("rejects contradictory session-set flags and empty sets", () => {
    expect(() => parseCliArgs(["session-set", "s1", "--archive", "--unarchive"])).toThrow(CliUsageError);
    expect(() => parseCliArgs(["session-set", "s1"])).toThrow(CliUsageError);
    const op = parseCliArgs(["session-set", "s1", "--title", "T", "--pin"]);
    expect(op).toEqual({ verb: "session-set", id: "s1", title: "T", archived: undefined, pinned: true });
  });

  it("requires a message for turn verbs", () => {
    expect(() => parseCliArgs(["send", "s1"])).toThrow(CliUsageError);
    const op = parseCliArgs(["send", "s1", "--message", "hi", "--wait", "--timeout-ms", "5000"]);
    expect(op).toMatchObject({ verb: "turn", command: "prompt", id: "s1", wait: true, timeoutMs: 5000 });
  });

  it("reads the message from a file reader", () => {
    const op = parseCliArgs(["steer", "s1", "--message-file", "m.txt"], () => "file text");
    expect(op).toMatchObject({ verb: "turn", command: "steer", message: "file text" });
    expect(() => parseCliArgs(["steer", "s1", "--message-file", "m.txt"], () => { throw new Error("no"); })).toThrow(CliUsageError);
  });

  it("rejects unknown rpc commands but accepts every canonical one", () => {
    expect(() => parseCliArgs(["rpc", "s1", "nope"])).toThrow(CliUsageError);
    expect(parseCliArgs(["rpc", "s1", "compact", "--payload", "{}"])).toMatchObject({ verb: "rpc", command: "compact" });
    expect(parseCliArgs(["rpc", "s1", "handoff"])).toMatchObject({ verb: "rpc", payload: {} });
  });

  it("parses approval answers by shape", () => {
    expect(parseCliArgs(["approve", "s1", "--command-id", "c", "--token", "t", "--answer", "true"])).toMatchObject({ answer: true });
    expect(parseCliArgs(["approve", "s1", "--command-id", "c", "--token", "t", "--answer", '{"cancelled":true}'])).toMatchObject({ answer: { cancelled: true } });
    expect(parseCliArgs(["approve", "s1", "--command-id", "c", "--token", "t", "--answer", "yes, run it"])).toMatchObject({ answer: "yes, run it" });
  });

  it("shows help for empty or help verbs", () => {
    expect(parseCliArgs([])).toEqual({ verb: "help" });
    expect(parseCliArgs(["--help"])).toEqual({ verb: "help" });
  });
});

describe("cedia-host request execution", () => {
  it("addresses a turn with the live incarnation", async () => {
    const { http, calls } = stubHttp({
      "GET *": { status: 200, body: { id: "s1", incarnation: "inc-9" } },
      "POST *": { status: 200, body: { commandId: "c1", status: "acknowledged" } },
    });
    const out: string[] = [];
    const code = await runCliOp(
      { verb: "turn", command: "prompt", id: "s1", message: "hi", commandId: "c1", wait: false, timeoutMs: 1000 },
      { http, stdout: text => out.push(text) },
    );
    expect(code).toBe(0);
    expect(calls.map(call => `${call.method} ${call.path.split("?")[0]}`)).toEqual([
      "GET /v1/sessions/s1",
      "POST /v1/sessions/s1/commands",
    ]);
    expect(calls[1]!.body).toMatchObject({ commandId: "c1", incarnation: "inc-9", command: "prompt", payload: { message: "hi" } });
    expect(JSON.parse(out.join(""))).toMatchObject({ commandId: "c1" });
  });

  it("follows chunked response references to the full body", async () => {
    const full = JSON.stringify({ diff: "x".repeat(10) });
    const { http, calls } = stubHttp({
      "GET *": { status: 200, body: { cediaResponseReference: { sha256: "a".repeat(64), length: full.length } } },
    });
    const paging: CliHttp = async (method, path, body) => {
      if (path.startsWith("/v1/responses/")) {
        const offset = Number(new URL(path, "http://x").searchParams.get("offset") ?? 0);
        return { status: 200, body: { sha256: "a".repeat(64), offset, length: full.length, text: full.slice(offset, offset + 24_000) } };
      }
      return http(method, path, body);
    };
    const out: string[] = [];
    const code = await runCliOp({ verb: "review", id: "s1" }, { http: paging, stdout: text => out.push(text) });
    expect(code).toBe(0);
    expect(JSON.parse(out.join(""))).toEqual(JSON.parse(full));
    expect(calls.map(call => `${call.method} ${call.path.split("?")[0]}`)).toEqual(["GET /v1/sessions/s1/review"]);
  });

  it("waits for a turn to settle when asked", async () => {
    const states = [
      { status: 200, body: [{ commandId: "c1", status: "acknowledged" }] },
      { status: 200, body: [{ commandId: "c1", status: "completed", result: { meaning: "done" } }] },
    ];
    let n = 0;
    const { http, calls } = stubHttp({ "GET *": { status: 200, body: { id: "s1", incarnation: "i" } }, "POST *": { status: 200, body: { commandId: "c1", status: "acknowledged" } } });
    const polling: CliHttp = async (method, path, body) => {
      if (path.endsWith("/commands") && method === "GET") return states[Math.min(n++, states.length - 1)]!;
      return http(method, path, body);
    };
    const out: string[] = [];
    const code = await runCliOp(
      { verb: "turn", command: "prompt", id: "s1", message: "hi", commandId: "c1", wait: true, timeoutMs: 5000 },
      { http: polling, stdout: text => out.push(text), sleep: async () => {} },
    );
    expect(code).toBe(0);
    expect(JSON.parse(out.join(""))).toMatchObject({ settled: { status: "completed" } });
    expect(calls.length).toBeGreaterThan(0);
  });

  it("reports usage and offline hosts with distinct exits", async () => {
    const err: string[] = [];
    expect(await runCli(["bogus-verb"], { stderr: text => err.push(text) })).toBe(2);
    expect(err.join("")).toContain("Unknown verb");
    const off: string[] = [];
    expect(await runCli(["sessions"], {
      readDescriptor: () => { throw new Error("no host"); },
      stderr: text => off.push(text),
    })).toBe(1);
    expect(JSON.parse(off.join(""))).toMatchObject({ error: { code: "host_offline" } });
  });
});
