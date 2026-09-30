/**
 * The one place Cedia's host error codes cross the renderer boundary.
 *
 * Electron's IPC transports an error's message and nothing else. Measured against the pinned
 * Electron 42.10.0, a rejected `ipcMain.handle` reaches the renderer as a plain `Error` whose
 * `message` is `Error invoking remote method '<channel>': <name>: <text>` with `code`, `status`
 * and every other own property gone. A renderer that cannot read `omp_settings_stale_revision`
 * cannot offer the safe retry, so the main process writes the code into the message under this
 * tag and the Cedia adapter removes it again.
 *
 * Both halves import this module, so the tag cannot drift between the writer and the reader.
 */

export const CEDIA_HOST_ERROR_CODE_TAG = "cedia-code:";

/** Write the tag the main process puts in front of a host error's own words. */
export function tagCediaHostErrorMessage(code: string, message: string): string {
	return `[${CEDIA_HOST_ERROR_CODE_TAG}${code}] ${message}`;
}

const REMOTE_METHOD_PREFIX = /^Error invoking remote method '[^']*':\s*/;
const ERROR_NAME_PREFIX = /^[A-Za-z_$][A-Za-z0-9_$]*:\s*/;
const CODE_TAG = /\[cedia-code:([A-Za-z0-9_.-]+)\]\s*/;

/**
 * Recover the code and the host's own words from whatever the renderer received.
 *
 * A message without the tag returns unchanged, so an error that never went through the tag
 * path is neither rewritten nor given an invented code.
 */
export function readCediaHostError(message: string): { code?: string; message: string } {
	const tag = CODE_TAG.exec(message);
	if (!tag) return { message };
	const stripped = message
		.replace(REMOTE_METHOD_PREFIX, "")
		.replace(ERROR_NAME_PREFIX, "")
		.replace(CODE_TAG, "")
		.trim();
	return { code: tag[1], message: stripped };
}
