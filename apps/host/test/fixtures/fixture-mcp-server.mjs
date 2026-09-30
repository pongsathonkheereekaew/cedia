// Minimal stdio MCP server for Cedia's O06 fixture proofs (MCP 2025-11-25 basics only).
// Newline-delimited JSON-RPC on stdio. One tool, `echo`, no network, no provider calls.
// It stays alive until stdin closes so the runtime's deferred discovery and change
// notifications observe a connected server rather than a handshake that exits.
import readline from "node:readline";

const SERVER = { name: "cedia-fixture-mcp", version: "1" };
const PROTOCOL = "2025-11-25";
const emit = frame => process.stdout.write(`${JSON.stringify(frame)}\n`);

const ok = (id, result) => emit({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => emit({ jsonrpc: "2.0", id, error: { code, message } });

const ECHO_TOOL = {
  name: "echo",
  description: "Echo the text argument back to the caller (Cedia O06 fixture).",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string", description: "Text to echo back." } },
    required: ["text"],
  },
};

readline.createInterface({ input: process.stdin }).on("line", line => {
  if (!line.trim()) return;
  let frame;
  try { frame = JSON.parse(line); } catch { return; }
  if (frame.jsonrpc !== "2.0" || frame.method === undefined) return;
  // Notifications carry no id and get no answer.
  if (frame.id === undefined) return;
  switch (frame.method) {
    case "initialize":
      return ok(frame.id, { protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: SERVER });
    case "ping":
      return ok(frame.id, {});
    case "tools/list":
      return ok(frame.id, { tools: [ECHO_TOOL] });
    case "tools/call": {
      const args = (frame.params ?? {}).arguments ?? {};
      if (frame.params?.name !== "echo") return fail(frame.id, -32602, `Unknown tool: ${String(frame.params?.name ?? "")}`);
      return ok(frame.id, { content: [{ type: "text", text: `echo: ${String(args.text ?? "")}` }] });
    }
    default:
      return fail(frame.id, -32601, `Method not found: ${frame.method}`);
  }
});
