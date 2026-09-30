import readline from "node:readline";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

if (process.argv.includes("--version")) {
  process.stdout.write("omp/18.4.3\n");
  process.exit(0);
}
const emit = frame => process.stdout.write(`${JSON.stringify(frame)}\n`);
const model = { id: "fixture-model", name: "Fixture model", provider: "fixture", reasoning: true, thinking: ["low", "medium", "high"], contextWindow: 128000, maxTokens: 4096, input: ["text"] };
const arg = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const raceGateDir = process.env.CEDIA_SEND_RACE_GATE_DIR;
const forkSource = arg("--fork");
const sessionFile = forkSource ? join(arg("--session-dir"), "fixture-fork.jsonl") : arg("--session");
let messages = [];
try { messages = JSON.parse(readFileSync(forkSource ?? sessionFile, "utf8")); } catch {}
const persist = () => {
  if (!sessionFile) return;
  mkdirSync(dirname(sessionFile), { recursive: true });
  writeFileSync(sessionFile, JSON.stringify(messages));
};
persist();
/**
 * OMP's rewind points, as `get_branch_messages` reports them: the session's user messages that
 * carry text, each with the entry id its position in the transcript gives it.
 */
const branchPoints = () => messages.flatMap((message, index) => {
  const text = Array.isArray(message.content)
    ? message.content.filter(part => part.type === "text").map(part => part.text ?? "").join("")
    : typeof message.content === "string" ? message.content : "";
  return message.role === "user" && text ? [{ entryId: `entry-${index}`, text }] : [];
});
let active;
let thinkingLevel = "medium";
const response = (command, data) => emit({ type: "response", command: command.type, id: command.id, success: true, data });
emit({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1, 2], maxFrameBytes: 1024 * 1024, maxReassembledFrameBytes: 64 * 1024 * 1024 });
readline.createInterface({ input: process.stdin }).on("line", async line => {
  const command = JSON.parse(line);
  switch (command.type) {
    case "negotiate_protocol": return response(command, { protocolVersion: command.protocolVersion });
    case "get_state": return response(command, { model, thinkingLevel, isStreaming: !!active, sessionFile, contextUsage: { tokens: messages.length ? 32000 : 0, contextWindow: model.contextWindow, percent: messages.length ? 25 : 0 } });
    case "get_available_models": return response(command, { models: [model] });
    case "get_login_providers": return response(command, { providers: [{ id: "fixture", name: "Fixture", authenticated: true }] });
    case "get_messages": return response(command, { messages });
    case "get_branch_messages": return response(command, { messages: branchPoints() });
    // OMP's rewind. `branch(entryId)` cuts the conversation at the selected user message - the
    // entry and everything after it leave the active path, which is what its own `/rewind`
    // selector does - and hands that message's text back for editor pre-fill. The fixture keeps
    // one flat array, so branching is the slice before the selected message.
    case "branch": {
      const index = messages.findIndex((message, position) => `entry-${position}` === command.entryId);
      const selected = index < 0 ? undefined : messages[index];
      const point = branchPoints().find(entry => entry.entryId === command.entryId);
      if (!selected || selected.role !== "user" || !point) {
        return emit({ type: "response", command: command.type, id: command.id, success: false, error: "Invalid entry ID for branching" });
      }
      messages = messages.slice(0, index);
      persist();
      return response(command, { text: point.text, cancelled: false });
    }
    case "get_commands": return response(command, { commands: [] });
    case "get_model_roles": return response(command, { roles: [], cycleOrder: [] });
    case "set_model":
      if (command.modelId !== model.id || command.provider !== model.provider) {
        return emit({ type: "response", command: command.type, id: command.id, success: false, error: "Unknown fixture model" });
      }
      return response(command, { model });
    case "set_thinking_level": thinkingLevel = command.level; return response(command, { level: thinkingLevel });
    // The host treats a scheme it registered but the runtime did not echo as a refusal, so the
    // fixture answers with the scheme names it installed, mirroring a compliant runtime.
    case "set_host_uri_schemes": return response(command, { schemes: (command.schemes ?? []).map(entry => entry.scheme) });
    case "abort":
      if (active) clearTimeout(active);
      active = undefined;
      response(command, {});
      emit({ type: "agent_end", isTerminal: true, messages: [] });
      return;
    case "prompt": {
      // Packaged race proof only: hold OMP's prompt ACK while a second real
      // renderer commits a newer shared-draft revision. The gate is opt-in and
      // lives under that proof's temporary directory.
      if (raceGateDir && !existsSync(join(raceGateDir, "prompt-ack-released"))) {
        mkdirSync(raceGateDir, { recursive: true });
        writeFileSync(join(raceGateDir, "prompt-received.json"), JSON.stringify({
          id: command.id,
          text: command.message,
          at: new Date().toISOString(),
        }));
        const waitForRelease = () => new Promise(resolve => {
          const poll = () => existsSync(join(raceGateDir, "release-prompt-ack"))
            ? resolve()
            : setTimeout(poll, 10);
          poll();
        });
        await waitForRelease();
      }
      response(command, { accepted: true });
      if (raceGateDir) writeFileSync(join(raceGateDir, "prompt-ack-released"), `${Date.now()}\n`);
      emit({ type: "agent_start" });
      const user = { role: "user", content: [{ type: "text", text: command.message }], timestamp: Date.now() };
      messages.push(user);
      emit({ type: "message_start", message: user });
      emit({ type: "message_end", message: user });
      const assistant = { role: "assistant", content: [{ type: "text", text: `Fixture response: ${command.message}` }], timestamp: Date.now(), provider: model.provider, model: model.id, stopReason: "stop" };
      emit({ type: "message_start", message: { ...assistant, content: [] } });
      active = setTimeout(() => {
        emit({ type: "message_update", message: assistant, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: assistant.content[0].text, partial: assistant } });
        emit({ type: "message_end", message: assistant });
        messages.push(assistant);
        persist();
        emit({ type: "prompt_result", id: command.id, result: {} });
        emit({ type: "agent_end", isTerminal: true, messages: [assistant] });
        active = undefined;
      }, 250);
      return;
    }
    default: return response(command, {});
  }
});
