/** Sample resident memory of a running Cedia.app, broken down by process role.
 *
 * Why this exists: startup spikes near 2GB and idle settles near 780MB, and a
 * single total cannot say which part owns it. This samples `ps`, keeps only
 * Cedia.app processes, buckets them with scripts/lib/cedia-ram.ts and prints
 * a per-role table plus the total. No provider calls, no Keychain access.
 * With --out <path> it also writes a JSON receipt with the git revision.
 *
 * usage: bun scripts/measure-ram.ts [--out /tmp/cedia-ram.json]
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { RAM_BUCKETS, classifyCediaProcess, parsePsLine, summarizeRam, type RamRow } from "./lib/cedia-ram.ts";

const outIdx = process.argv.indexOf("--out");
const outPath = outIdx >= 0 ? process.argv[outIdx + 1] : undefined;
if (outIdx >= 0 && !outPath) {
	console.error("measure-ram: --out needs a file path");
	process.exit(2);
}

let revision = "unknown";
try {
	revision = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
} catch {
	// Detached trees still get a usable memory sample without a revision.
}

const ps = execFileSync("ps", ["-ax", "-o", "pid=,rss=,command="], { encoding: "utf8" });
const rows: RamRow[] = [];
for (const line of ps.split("\n")) {
	const parsed = parsePsLine(line);
	if (!parsed) continue;
	if (!parsed.command.includes("Cedia.app")) continue;
	rows.push({ ...parsed, bucket: classifyCediaProcess(parsed.command) });
}

if (rows.length === 0) {
	console.error("measure-ram: no Cedia.app processes found. Launch with bun scripts/launch-cedia-personal.ts first.");
	process.exit(1);
}

const summary = summarizeRam(rows);
const stamp = new Date().toISOString();
console.log(`cedia ram @ ${stamp} rev ${revision}: ${summary.count} procs, ${summary.totalMb}MB total`);
for (const bucket of RAM_BUCKETS) {
	const stat = summary.byBucket[bucket];
	if (stat.count === 0) continue;
	console.log(`  ${bucket}: ${stat.count}x ${stat.rssMb}MB`);
}
for (const row of [...rows].sort((a, b) => b.rssKb - a.rssKb).slice(0, 8)) {
	console.log(`  pid ${row.pid} ${Math.round(row.rssKb / 1024)}MB [${row.bucket}] ${row.command.slice(0, 100)}`);
}

if (outPath) {
	writeFileSync(
		outPath,
		JSON.stringify({ timestamp: stamp, revision, summary, rows }, null, 2),
	);
	console.log(`receipt: ${outPath}`);
}
