/**
 * Cedia's own URI scheme (plan §8.2 O05, §10 item 37).
 *
 * The plan's rule is that a scheme is only registered when a reader exists behind it. This suite
 * proves the reader is real: the bytes come from the host's artifact store, they survive the
 * original file changing, they are scoped to the task that asked, and the runtime's own
 * `host_uri_request` frame gets an answer through the dispatcher it actually calls.
 */
import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../src/artifacts.ts";
import { CEDIA_HOST_URI_SCHEME, parseCediaArtifactUri, readCediaArtifactUri } from "../src/host-uri.ts";
import { OmpHostDispatcher } from "../../../packages/omp-adapter/src/host.ts";

const DIGEST = "a".repeat(64);

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "cedia-host-uri-"));
}

describe("Cedia artifact URI parsing", () => {
  it("accepts exactly one shape", () => {
    expect(parseCediaArtifactUri(`cedia://artifact/${DIGEST}`)).toEqual({ sha256: DIGEST });
  });

  it("refuses anything it would have to guess at", () => {
    for (const raw of [
      `vscode://artifact/${DIGEST}`,
      `cedia://task/${DIGEST}`,
      `cedia://artifact/${DIGEST}?offset=1`,
      `cedia://artifact/${DIGEST}#frag`,
      `cedia://artifact/${DIGEST}/extra`,
      "cedia://artifact/",
      `cedia://artifact/${"A".repeat(64)}`,
      `cedia://artifact/${"a".repeat(63)}`,
      "not a url",
    ]) {
      expect(parseCediaArtifactUri(raw)).toBeUndefined();
    }
  });
});

describe("Cedia artifact reader", () => {
  it("serves the captured bytes even after the workspace file changes", () => {
    const cwd = workspace();
    const stateDir = workspace();
    try {
      writeFileSync(join(cwd, "receipt.txt"), "captured once");
      const store = new ArtifactStore(stateDir);
      const receipt = store.capture("task-1", cwd, "receipt.txt");
      // The workspace copy moves on; the artifact is content-addressed, so this is the whole point.
      writeFileSync(join(cwd, "receipt.txt"), "changed since");

      const answer = readCediaArtifactUri(store, "task-1", `cedia://artifact/${receipt.sha256}`);
      expect(answer.content).toBe("captured once");
      expect(answer.immutable).toBe(true);
      expect(answer.contentType).toBe("text/plain");
      expect(answer.notes?.join(" ")).toContain(receipt.sourcePath);
      expect(answer.notes?.join(" ")).toContain(receipt.sha256);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("keeps one task out of another task's receipts", () => {
    const cwd = workspace();
    const stateDir = workspace();
    try {
      writeFileSync(join(cwd, "receipt.txt"), "task one only");
      const store = new ArtifactStore(stateDir);
      const receipt = store.capture("task-1", cwd, "receipt.txt");
      expect(() => readCediaArtifactUri(store, "task-2", `cedia://artifact/${receipt.sha256}`)).toThrow();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("refuses a URL it does not serve, and bytes that are not text", () => {
    const cwd = workspace();
    const stateDir = workspace();
    try {
      writeFileSync(join(cwd, "binary.bin"), Buffer.from([0x00, 0x01, 0x02]));
      const store = new ArtifactStore(stateDir);
      const binary = store.capture("task-1", cwd, "binary.bin");
      expect(() => readCediaArtifactUri(store, "task-1", "cedia://task/abc")).toThrow("serves cedia://artifact");
      expect(() => readCediaArtifactUri(store, "task-1", `cedia://artifact/${binary.sha256}`)).toThrow("not text");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("answers the runtime's own host_uri_request frame through the dispatcher", async () => {
    const cwd = workspace();
    const stateDir = workspace();
    try {
      writeFileSync(join(cwd, "receipt.txt"), "through the dispatcher");
      const store = new ArtifactStore(stateDir);
      const receipt = store.capture("task-1", cwd, "receipt.txt");
      const sent: unknown[] = [];
      const dispatcher = new OmpHostDispatcher({
        requestTimeoutMs: 5_000,
        send: frame => {
          sent.push(frame);
        },
        authorize: () => true,
      });
      dispatcher.registerUriScheme({
        definition: { scheme: CEDIA_HOST_URI_SCHEME, description: "fixture", immutable: true },
        read: request => readCediaArtifactUri(store, "task-1", String(request.url)),
      });

      // The frame shape is the runtime's own; a read of an artifact answers with its content.
      await dispatcher.handle({
        type: "host_uri_request",
        id: "uri-1",
        operation: "read",
        url: `cedia://artifact/${receipt.sha256}`,
      });
      const result = sent.find(frame => (frame as { type?: string }).type === "host_uri_result") as
        | { id: string; content?: string }
        | undefined;
      expect(result?.id).toBe("uri-1");
      expect(result?.content).toBe("through the dispatcher");

      // A write is refused because the scheme is immutable: there is nothing to write back into a
      // content-addressed receipt.
      sent.length = 0;
      await dispatcher.handle({
        type: "host_uri_request",
        id: "uri-2",
        operation: "write",
        url: `cedia://artifact/${receipt.sha256}`,
        content: "nope",
      });
      const refusal = sent.find(frame => (frame as { type?: string }).type === "host_uri_result") as
        | { error?: string }
        | undefined;
      expect(refusal?.error).toContain("not writable");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
