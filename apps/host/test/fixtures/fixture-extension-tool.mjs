// Deterministic trusted extension that registers one custom tool (O06 dynamic-tool
// proof). No network, no provider access, no state: the tool answers a constant
// string and never leaves the machine.
export default function (api) {
	api.registerTool({
		name: "cedia_smoke_widget",
		label: "Cedia smoke widget",
		description: "Deterministic fixture tool proving an extension-registered tool reaches the session catalog.",
		parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
		approval: "read",
		loadMode: "eager",
		execute: async () => ({ content: [{ type: "text", text: "cedia-smoke-widget-ok" }] }),
	});
}
