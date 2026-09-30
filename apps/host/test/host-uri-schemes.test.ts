import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EditorConnections } from "../src/editors.ts";
import { CediaHost } from "../src/service.ts";
import { DurableStore } from "../src/store.ts";

const fixture = fileURLToPath(new URL("./fixtures/fake-host-launcher", import.meta.url));
const fixtureNode = process.env.CEDIA_FIXTURE_NODE
  ?? (existsSync("/Users/pond/.caret-tools/node-v24.18.0-darwin-arm64/bin/node")
    ? "/Users/pond/.caret-tools/node-v24.18.0-darwin-arm64/bin/node"
    : process.execPath);

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

/**
 * OMP refuses host commands until its own startup interaction completes (code
 * `cedia_initializing`). A startup custom that waits for user input must not fail
 * session startup: scheme registration defers and retries before a later command.
 */
describe("host URI scheme startup deferral", () => {
  it("starts the session past a startup-gate refusal and installs the schemes on the next command", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cedia-uri-schemes-"));
    const projectPath = join(directory, "project");
    mkdirSync(projectPath, { recursive: true });
    const commandLog = join(directory, "commands.jsonl");
    const diagnostics: string[] = [];
    const store = DurableStore.open({ stateDir: directory, recover: false });
    const project = store.createProject({ path: projectPath, name: "URI schemes" });
    const editors = new EditorConnections();
    const host = new CediaHost({
      store,
      stateDir: directory,
      editors,
      ompExecutable: fixture,
      ompEnv: {
        CEDIA_NODE: fixtureNode,
        CEDIA_FAKE_SCHEMES_GATE: "startup-once",
        CEDIA_FAKE_COMMAND_LOG: commandLog,
      },
      onDiagnostic: message => { diagnostics.push(message); },
    });
    cleanups.push(() => host.close().catch(() => {}));
    cleanups.push(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
    const session = host.createSession(project.id, "URI schemes session");
    const started = await host.startSession(session.id);
    expect(started.status).toBe("idle");
    expect(diagnostics.some(message => message.includes("deferred until after startup"))).toBe(true);
    const schemesAtStartup = readFileSync(commandLog, "utf8").split("\n")
      .filter(line => line.includes('"set_host_uri_schemes"'));
    expect(schemesAtStartup).toHaveLength(1);

    const state = await host.command(session.id, "owner", {
      commandId: "uri-schemes-retry",
      incarnation: started.incarnation,
      command: "get_state",
    });
    expect(state.status).toBe("completed");
    const schemesAfterCommand = readFileSync(commandLog, "utf8").split("\n")
      .filter(line => line.includes('"set_host_uri_schemes"'));
    expect(schemesAfterCommand).toHaveLength(2);
    await host.stopSession(session.id);
  });
  it("reports a persistent non-gate scheme refusal once without failing commands", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cedia-uri-schemes-refused-"));
    const projectPath = join(directory, "project");
    mkdirSync(projectPath, { recursive: true });
    const diagnostics: string[] = [];
    const store = DurableStore.open({ stateDir: directory, recover: false });
    const project = store.createProject({ path: projectPath, name: "URI schemes refused" });
    const editors = new EditorConnections();
    const host = new CediaHost({
      store,
      stateDir: directory,
      editors,
      ompExecutable: fixture,
      ompEnv: { CEDIA_NODE: fixtureNode, CEDIA_FAKE_SCHEMES_GATE: "startup-once-then-refuse" },
      onDiagnostic: message => { diagnostics.push(message); },
    });
    cleanups.push(() => host.close().catch(() => {}));
    cleanups.push(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
    const session = host.createSession(project.id, "URI schemes refused session");
    const started = await host.startSession(session.id);
    expect(started.status).toBe("idle");
    for (const commandId of ["uri-retry-one", "uri-retry-two"]) {
      const state = await host.command(session.id, "owner", {
        commandId,
        incarnation: started.incarnation,
        command: "get_state",
      });
      expect(state.status).toBe("completed");
    }
    const retries = diagnostics.filter(message => message.includes("Host URI scheme retry failed"));
    expect(retries).toHaveLength(1);
    await host.stopSession(session.id);
  });
});
