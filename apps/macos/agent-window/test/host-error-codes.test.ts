import { describe, expect, it } from "bun:test";

import { normalizeCediaHostError } from "../src/cedia-adapter";
import { readCediaHostError, tagCediaHostErrorMessage } from "../src/host-error-codes";

/** Exactly what Electron 42.10.0 delivers for a rejected ipcMain.handle (measured). */
function throughElectronIpc(channel: string, thrown: Error): Error {
  return new Error(`Error invoking remote method '${channel}': ${thrown.name}: ${thrown.message}`);
}

describe("Cedia host error transport", () => {
  it("round-trips a code and the host's own words through the Electron message", () => {
    // The main process tags the message; Electron wraps it; the renderer reads it back.
    const tagged = new Error(tagCediaHostErrorMessage("omp_settings_stale_revision", "The effective settings moved: expected revision r1, the runtime reports r2"));
    const delivered = throughElectronIpc("cedia-agent", tagged);

    expect(readCediaHostError(delivered.message)).toEqual({
      code: "omp_settings_stale_revision",
      message: "The effective settings moved: expected revision r1, the runtime reports r2",
    });
    const normalized = normalizeCediaHostError(delivered);
    expect(normalized.code).toBe("omp_settings_stale_revision");
    expect(normalized.message).toBe("The effective settings moved: expected revision r1, the runtime reports r2");
    // The settings surface switches on this code, so it must not carry transport noise.
    expect(normalized.message).not.toContain("cedia-code");
    expect(normalized.message).not.toContain("Error invoking remote method");
  });

  it("leaves an untagged error as the renderer already had it", () => {
    const plain = new Error("Error invoking remote method 'cedia-agent': Error: Unsupported application route");
    expect(readCediaHostError(plain.message)).toEqual({ message: plain.message });
    expect(normalizeCediaHostError(plain)).toBe(plain);
  });
});
