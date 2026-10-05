/** Classifier + summarizer for Cedia.app resident memory, measured from `ps`.
 *
 * Why this exists: the whole app idles near 780MB and spikes near 2GB at
 * startup, and "Electron eats RAM" is not an actionable breakdown. Sampling
 * `ps` and bucketing by process role shows which part actually owns the
 * megabytes: renderers, extension hosts, language servers, the CEDIA host,
 * or the transient OMP rpc-ui process.
 *
 * Pure functions only: no shelling out, no provider calls, no writes.
 */

export type RamBucket =
	| "main"
	| "gpu"
	| "renderer"
	| "extension-host"
	| "language-server"
	| "host"
	| "omp"
	| "other";

export interface RamRow {
	pid: number;
	rssKb: number;
	command: string;
	bucket: RamBucket;
}

export function classifyCediaProcess(command: string): RamBucket {
	const c = command.toLowerCase();
	if (c.includes("runtime/omp/omp") || c.includes("omp --mode")) return "omp";
	if (c.includes("runtime/host/cli") || c.includes("host/cli.js")) return "host";
	if (c.includes("gpu-process")) return "gpu";
	if (c.includes("helper (renderer)") || c.includes("--type=renderer")) return "renderer";
	if (c.includes("jsonservermain") || c.includes("language-features/server")) return "language-server";
	if (c.includes("helper (plugin)") || c.includes("node.mojom.nodeservice")) return "extension-host";
	if (c.includes("contents/macos/cedia")) return "main";
	return "other";
}

export function parsePsLine(line: string): { pid: number; rssKb: number; command: string } | undefined {
	const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*\S)\s*$/);
	if (!m) return undefined;
	return { pid: Number(m[1]), rssKb: Number(m[2]), command: m[3] };
}

export interface RamBucketStat {
	count: number;
	rssMb: number;
}

export interface RamSummary {
	count: number;
	totalMb: number;
	byBucket: Record<RamBucket, RamBucketStat>;
}

export const RAM_BUCKETS: RamBucket[] = [
	"main",
	"gpu",
	"renderer",
	"extension-host",
	"language-server",
	"host",
	"omp",
	"other",
];

export function summarizeRam(rows: RamRow[]): RamSummary {
	const byBucket = Object.fromEntries(
		RAM_BUCKETS.map((b) => [b, { count: 0, rssMb: 0 }]),
	) as Record<RamBucket, RamBucketStat>;
	let totalKb = 0;
	for (const row of rows) {
		totalKb += row.rssKb;
		byBucket[row.bucket].count += 1;
		byBucket[row.bucket].rssMb += row.rssKb / 1024;
	}
	for (const b of RAM_BUCKETS) byBucket[b].rssMb = Math.round(byBucket[b].rssMb);
	return { count: rows.length, totalMb: Math.round(totalKb / 1024), byBucket };
}
