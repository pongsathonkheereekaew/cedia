import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CediaShellPanel,
} from "../vendor/synara/apps/web/src/components/chat/CediaShellSurface";
import {
  parseCediaBashAbortAnswer,
  parseCediaBashAnswer,
  serverBashAbortMutationOptions,
  serverBashExecMutationOptions,
} from "../vendor/synara/apps/web/src/lib/serverReactQuery";

const finished = {
  state: "available",
  revision: 2,
  exitCode: 0,
  output: "hi\n",
  outputTruncated: false,
  cancelled: false,
  timedOut: false,
  images: 0,
} as const;

describe("Cedia shell surface", () => {
  it("offers Run idle and Abort while running, and shows the result plainly", () => {
    const idle = renderToStaticMarkup(
      <CediaShellPanel command="" result={null} running={false} error={null} onCommand={() => undefined} onRun={() => undefined} onAbort={() => undefined} />,
    );
    expect(idle).toContain("Run shell command");
    expect(idle).toContain("Runs in the task session");

    const running = renderToStaticMarkup(
      <CediaShellPanel command="sleep 20" result={null} running={true} error={null} onCommand={() => undefined} onRun={() => undefined} onAbort={() => undefined} />,
    );
    expect(running).toContain("Abort shell command");
    expect(running).not.toContain("Run shell command");

    const done = renderToStaticMarkup(
      <CediaShellPanel command="printf hi" result={finished} running={false} error={null} onCommand={() => undefined} onRun={() => undefined} onAbort={() => undefined} />,
    );
    expect(done).toContain("Exit 0");
    expect(done).toContain("hi");

    const cancelled = renderToStaticMarkup(
      <CediaShellPanel command="sleep 20" result={{ ...finished, cancelled: true }} running={false} error={null} onCommand={() => undefined} onRun={() => undefined} onAbort={() => undefined} />,
    );
    expect(cancelled).toContain("Cancelled");
  });

  it("keeps shell parsing strict about the result shape", () => {
    expect(parseCediaBashAnswer(finished)).toEqual(finished);
    expect(parseCediaBashAnswer({ state: "unavailable", reason: "No OMP runtime is running" })).toEqual({
      state: "unavailable", reason: "No OMP runtime is running",
    });
    expect(() => parseCediaBashAnswer({ ...finished, exitCode: "zero" })).toThrow();
    expect(() => parseCediaBashAnswer({ ...finished, output: 7 })).toThrow();
    expect(() => parseCediaBashAnswer({ ...finished, extra: true })).toThrow();
    expect(parseCediaBashAbortAnswer({ state: "available", revision: 1, aborted: true })).toEqual({
      state: "available", revision: 1, aborted: true,
    });
    expect(() => parseCediaBashAbortAnswer({ state: "available", revision: 1 })).toThrow();
  });

  it("names the shell mutation keys per session", () => {
    const noopClient = { getQueryData: () => undefined, setQueryData: () => undefined, invalidateQueries: () => undefined } as never;
    expect(serverBashExecMutationOptions({ sessionId: "s", queryClient: noopClient }).mutationKey).toEqual(
      ["server", "mutation", "bash", "exec", "s"],
    );
    expect(serverBashAbortMutationOptions({ sessionId: "s", queryClient: noopClient }).mutationKey).toEqual(
      ["server", "mutation", "bash", "abort", "s"],
    );
  });
});
