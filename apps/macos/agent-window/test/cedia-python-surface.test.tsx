import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CediaShellPanel,
} from "../vendor/synara/apps/web/src/components/chat/CediaShellSurface";
import {
  parseCediaPythonAbortAnswer,
  parseCediaPythonAnswer,
  serverPythonAbortMutationOptions,
  serverPythonExecMutationOptions,
} from "../vendor/synara/apps/web/src/lib/serverReactQuery";

const finished = {
  state: "available",
  revision: 2,
  exitCode: 0,
  output: "3\n",
  outputTruncated: false,
  cancelled: false,
  displayOutputs: 2,
} as const;

describe("Cedia Python surface", () => {
  it("renders Python labels, display-output notes, and the language toggle", () => {
    const html = renderToStaticMarkup(
      <CediaShellPanel command="print(1 + 2)" result={finished} language="python" running={false} error={null} onCommand={() => undefined} onRun={() => undefined} onAbort={() => undefined} onLanguage={() => undefined} />,
    );
    expect(html).toContain("Run Python code");
    expect(html).toContain("2 display outputs not shown");
    expect(html).toContain("Bash shell language");
    expect(html).toContain("Python shell language");
    expect(html).toContain("Exit 0");
    expect(html).not.toContain("Run shell command");
  });

  it("reports a cancelled run without an exit code", () => {
    const html = renderToStaticMarkup(
      <CediaShellPanel command="while True: pass" result={{ ...finished, exitCode: null, cancelled: true }} language="python" running={false} error={null} onCommand={() => undefined} onRun={() => undefined} onAbort={() => undefined} />,
    );
    expect(html).toContain("Cancelled");
  });

  it("keeps Python parsing strict about the result shape", () => {
    expect(parseCediaPythonAnswer(finished)).toEqual(finished);
    expect(parseCediaPythonAnswer({ state: "unavailable", reason: "No OMP runtime is running" })).toEqual({
      state: "unavailable", reason: "No OMP runtime is running",
    });
    expect(() => parseCediaPythonAnswer({ ...finished, exitCode: "zero" })).toThrow();
    expect(() => parseCediaPythonAnswer({ ...finished, output: 7 })).toThrow();
    expect(() => parseCediaPythonAnswer({ ...finished, extra: true })).toThrow();
    expect(() => parseCediaPythonAnswer({ ...finished, displayOutputs: -1 })).toThrow();
    expect(parseCediaPythonAbortAnswer({ state: "available", revision: 1, aborted: true })).toEqual({
      state: "available", revision: 1, aborted: true,
    });
    expect(() => parseCediaPythonAbortAnswer({ state: "available", revision: 1 })).toThrow();
  });

  it("names the Python mutation keys per session", () => {
    const noopClient = { getQueryData: () => undefined, setQueryData: () => undefined, invalidateQueries: () => undefined } as never;
    expect(serverPythonExecMutationOptions({ sessionId: "s", queryClient: noopClient }).mutationKey).toEqual(
      ["server", "mutation", "python", "exec", "s"],
    );
    expect(serverPythonAbortMutationOptions({ sessionId: "s", queryClient: noopClient }).mutationKey).toEqual(
      ["server", "mutation", "python", "abort", "s"],
    );
  });
});
