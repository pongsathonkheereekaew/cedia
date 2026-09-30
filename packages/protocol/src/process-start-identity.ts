import { execFileSync } from "node:child_process";

const IDENTITY_PREFIX = "darwin-ps-lstart:v1:";
const LSTART_PATTERN = /^(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2} \d{2}:\d{2}:\d{2} \d{4}$/;

/**
 * Read macOS's process start time for a PID. The owner socket still supplies the authenticated
 * identity proof; this kernel-backed value detects records left behind after PID reuse.
 * `ps lstart` is only second-resolution, so callers must always pair it with socket authentication.
 */
export function readCediaProcessStartIdentity(pid: number): string | undefined {
	if (process.platform !== "darwin" || !Number.isSafeInteger(pid) || pid <= 0) return undefined;
	try {
		const start = execFileSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], {
			encoding: "utf8",
			env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
			timeout: 1_000,
			stdio: ["ignore", "pipe", "ignore"],
		}).trim().replace(/\s+/g, " ");
		return LSTART_PATTERN.test(start) ? `${IDENTITY_PREFIX}${start}` : undefined;
	} catch {
		return undefined;
	}
}
