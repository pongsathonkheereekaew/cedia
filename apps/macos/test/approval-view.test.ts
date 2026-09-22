import { describe, expect, it } from "bun:test";
import {
	APPROVAL_OFFLINE_LINE,
	APPROVAL_REQUIRED_REASON,
	approvalCanSubmit,
	approvalDefaultFocus,
	approvalDisplayStatus,
	approvalFieldKind,
	approvalFocusTarget,
	approvalIdentityLines,
	approvalNeedsExpand,
	approvalOfflineLine,
	approvalOptionRows,
	approvalSubmitBlockedReason,
	approvalTimeoutLine,
	approvalTimeoutRemaining,
} from "../src/approval-view.ts";

const pending = {
	token: "tok-1",
	requestId: "req-9",
	sessionId: "s1",
	incarnation: "inc-1",
	method: "confirm",
	cwd: "/work",
	tool: "bash",
	target: "rm -rf tmp",
	timeout: 5_000,
	receivedAt: 1_000,
};

describe("approval view", () => {
	it("keeps a current request pending and lists its identity", () => {
		expect(approvalDisplayStatus(pending, { sessionId: "s1", incarnation: "inc-1", connection: "running" }, 2_000)).toBe("pending");
		expect(approvalCanSubmit("pending", "running")).toBe(true);
		expect(approvalIdentityLines(pending)).toEqual([
			"Request req-9",
			"Method confirm",
			"Tool bash",
			"Target rm -rf tmp",
			"cwd /work",
			"Session s1",
			"Incarnation inc-1",
		]);
	});

	it("marks stale incarnation and timeout as readonly", () => {
		expect(approvalDisplayStatus(pending, { sessionId: "s1", incarnation: "inc-2" }, 2_000)).toBe("stale");
		expect(approvalDisplayStatus(pending, { sessionId: "s1", incarnation: "inc-1" }, 7_000)).toBe("timeout");
		expect(approvalCanSubmit("timeout", "running")).toBe(false);
		expect(approvalCanSubmit("pending", "offline")).toBe(false);
	});

	it("classifies exactly the interactive methods OMP can send", () => {
		expect(approvalFieldKind("confirm")).toBe("confirm");
		expect(approvalFieldKind("select")).toBe("select");
		expect(approvalFieldKind("input")).toBe("input");
		expect(approvalFieldKind("editor")).toBe("editor");
		// A method outside the wire union has no control; it is never guessed at.
		expect(approvalFieldKind("password")).toBe("unsupported");
		expect(approvalFieldKind("multi_select")).toBe("unsupported");
		expect(approvalFieldKind("schemaform")).toBe("unsupported");
		expect(approvalFieldKind("toString")).toBe("unsupported");
		expect(approvalDefaultFocus(true)).toBe("cancel");
		expect(approvalDefaultFocus(false)).toBe("submit");
		expect(approvalNeedsExpand("short")).toBe(false);
		expect(approvalNeedsExpand("x".repeat(81))).toBe(true);
	});

	it("aligns option details by index without inventing extra options", () => {
		expect(approvalOptionRows(undefined, [{ description: "Ghost" }])).toEqual([]);
		expect(approvalOptionRows(["a", "b"], [{ description: "First" }, { description: "Second" }])).toEqual([
			{ value: "a", label: "a", description: "First" },
			{ value: "b", label: "b", description: "Second" },
		]);
		expect(
			approvalOptionRows(["keep", "", "c"], [
				{ description: "skipped empty" },
				{ description: "not aligned" },
				{ description: "Gamma" },
				{ description: "extra" },
			]),
		).toEqual([
			{ value: "keep", label: "keep", description: "skipped empty" },
			{ value: "c", label: "c", description: "Gamma" },
		]);
	});

	it("reports remaining timeout and expired copy without inventing a clock", () => {
		expect(approvalTimeoutRemaining(undefined, 1_000, 1_500)).toBeUndefined();
		expect(approvalTimeoutRemaining(0, 1_000, 1_500)).toBeUndefined();
		expect(approvalTimeoutRemaining(5_000, undefined, 1_500)).toBeUndefined();
		expect(approvalTimeoutRemaining(5_000, 1_000, 2_500)).toBe(3_500);
		expect(approvalTimeoutRemaining(5_000, 1_000, 8_000)).toBe(0);
		expect(approvalTimeoutLine(undefined)).toBe("");
		expect(approvalTimeoutLine(1)).toBe("Expires in 1s");
		expect(approvalTimeoutLine(1_500)).toBe("Expires in 2s");
		expect(approvalTimeoutLine(0)).toBe("Expired");
	});

	it("blocks submit for required fields and offline hosts, and focuses invalid or dangerous controls", () => {
		expect(approvalOfflineLine("running")).toBeUndefined();
		expect(approvalOfflineLine("connected")).toBeUndefined();
		expect(approvalOfflineLine("online")).toBeUndefined();
		expect(approvalOfflineLine("offline")).toBe(APPROVAL_OFFLINE_LINE);
		expect(approvalOfflineLine(undefined)).toBe(APPROVAL_OFFLINE_LINE);
		expect(approvalCanSubmit("pending", "online")).toBe(false);
		expect(approvalSubmitBlockedReason({ method: "confirm", required: true, value: "" })).toBeUndefined();
		expect(approvalSubmitBlockedReason({ method: "input", required: true, value: true })).toBeUndefined();
		expect(approvalSubmitBlockedReason({ method: "input", required: true, value: "   " })).toBe(APPROVAL_REQUIRED_REASON);
		expect(approvalSubmitBlockedReason({ method: "editor", required: true })).toBe(APPROVAL_REQUIRED_REASON);
		expect(approvalSubmitBlockedReason({ method: "input", required: true, value: "keep spaces" })).toBeUndefined();
		expect(approvalSubmitBlockedReason({ method: "select", required: true, value: "" })).toBe(APPROVAL_REQUIRED_REASON);
		expect(approvalSubmitBlockedReason({ method: "select", required: true, value: "a" })).toBeUndefined();
		expect(approvalSubmitBlockedReason({ method: "select", required: false, value: "" })).toBeUndefined();
		expect(approvalFocusTarget({ invalid: true, dangerous: true })).toBe("control");
		expect(approvalFocusTarget({ dangerous: true })).toBe("cancel");
		expect(approvalFocusTarget({})).toBe("submit");
	});
});
