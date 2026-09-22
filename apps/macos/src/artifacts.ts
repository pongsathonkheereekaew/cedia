import * as vscode from "vscode";
import { mkdir, writeFile } from "node:fs/promises";
import { join, extname } from "node:path";
import type { CediaHostClient } from "./api.ts";
import { downloadArtifact } from "./artifact-transfer.ts";
import type { ArtifactReceipt } from "../../../packages/protocol/src/artifacts.ts";
export async function showArtifacts(client: CediaHostClient, sessionId: string, cacheDirectory: string): Promise<void> {
  const receipts = await client.listArtifacts(sessionId);
  const picked = await vscode.window.showQuickPick([{ label: "Capture a file…", receipt: undefined as ArtifactReceipt | undefined }, ...receipts.map(receipt => ({ label: receipt.name, description: `${receipt.size.toLocaleString()} bytes · ${receipt.sha256.slice(0, 12)}`, receipt }))], { title: "Task artifacts" });
  if (!picked) return;
  let receipt = picked.receipt;
  if (!receipt) {
    const path = await vscode.window.showInputBox({ title: "Capture artifact", prompt: "File path inside this task's project. Cedia keeps a verified copy." });
    if (!path?.trim()) return;
    receipt = await client.captureArtifact(sessionId, path.trim());
  }
  const bytes = await downloadArtifact(client, sessionId, receipt);
  await mkdir(cacheDirectory, { recursive: true, mode: 0o700 });
  const extension = extname(receipt.name); const safeExtension = /^\.[a-zA-Z0-9]{1,12}$/.test(extension) ? extension : ".bin";
  const path = join(cacheDirectory, `${receipt.sha256}${safeExtension}`);
  await writeFile(path, bytes, { mode: 0o600 });
  const action = await vscode.window.showQuickPick(["Preview", "Save a copy…"], { title: receipt.name });
  if (action === "Preview") await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(path));
  if (action === "Save a copy…") {
    const target = await vscode.window.showSaveDialog({ saveLabel: "Save artifact copy" });
    if (target) await vscode.workspace.fs.writeFile(target, bytes);
  }
}
