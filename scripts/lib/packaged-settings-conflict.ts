/** Pure planning/observation helpers for the native packaged OMP settings proof. */

export const SAFE_OMP_SETTING_PATH = "defaultThinkingLevel";

export interface OmpProofSettingKey {
	readonly path: string;
	readonly type: string;
	readonly credential: boolean;
	readonly ui: boolean;
	readonly values?: readonly string[];
}

export interface OmpProofSettingValue {
	readonly path: string;
	readonly credential: boolean;
	readonly redacted: boolean;
	readonly configured?: boolean;
	readonly tooLarge?: true;
	readonly value?: unknown;
	readonly settingsRevision: string;
}

export interface OmpSettingsConflictPlan {
	readonly path: typeof SAFE_OMP_SETTING_PATH;
	readonly originalValue: string;
	readonly nativeTarget: string;
	readonly routeWinner: string;
	readonly values: readonly string[];
}

const PREFERRED_SAFE_VALUES = ["low", "minimal", "medium", "high", "auto", "xhigh", "max"] as const;

function fail(message: string): never {
	throw new Error(`OMP settings proof: ${message}`);
}

/** Select two distinct values from the runtime-published enum; never invents a choice. */
export function chooseSafeOmpConflictPlan(
	keys: readonly OmpProofSettingKey[],
	value: OmpProofSettingValue,
): OmpSettingsConflictPlan {
	const key = keys.find(candidate => candidate.path === SAFE_OMP_SETTING_PATH);
	if (!key) fail(`the live inventory does not publish ${SAFE_OMP_SETTING_PATH}`);
	if (key.type.trim().toLocaleLowerCase() !== "enum") fail(`${SAFE_OMP_SETTING_PATH} is not an enum`);
	if (key.credential) fail(`${SAFE_OMP_SETTING_PATH} is a credential path`);
	if (!key.ui) fail(`${SAFE_OMP_SETTING_PATH} has no settings UI row`);
	const values = Array.isArray(key.values) ? [...key.values] : [];
	if (values.length < 3 || values.some(entry => typeof entry !== "string" || entry.length === 0)) {
		fail(`${SAFE_OMP_SETTING_PATH} does not publish at least three enum choices`);
	}
	if (value.path !== SAFE_OMP_SETTING_PATH) fail(`the value path is ${value.path}, not ${SAFE_OMP_SETTING_PATH}`);
	if (value.credential || value.redacted || value.tooLarge === true) fail(`${SAFE_OMP_SETTING_PATH} is not a writable non-secret value`);
	if (typeof value.value !== "string" || !values.includes(value.value)) {
		fail(`the live value is not one of the published ${SAFE_OMP_SETTING_PATH} choices`);
	}
	if (value.settingsRevision.trim().length === 0) fail("the live value has no settings revision");
	const ordered = [
		...PREFERRED_SAFE_VALUES.filter(candidate => values.includes(candidate)),
		...values.filter(candidate => !PREFERRED_SAFE_VALUES.includes(candidate as typeof PREFERRED_SAFE_VALUES[number])),
	];
	const nativeTarget = ordered.find(candidate => candidate !== value.value);
	const routeWinner = ordered.find(candidate => candidate !== value.value && candidate !== nativeTarget);
	if (!nativeTarget || !routeWinner) fail(`${SAFE_OMP_SETTING_PATH} has no two values distinct from its current value`);
	return {
		path: SAFE_OMP_SETTING_PATH,
		originalValue: value.value,
		nativeTarget,
		routeWinner,
		values,
	};
}

/** Recognise the host's typed 409 body, without accepting text-only or other errors. */
export function isOmpSettingsStaleResponse(body: unknown): boolean {
	if (!body || typeof body !== "object" || Array.isArray(body)) return false;
	const error = (body as { error?: unknown }).error;
	if (!error || typeof error !== "object" || Array.isArray(error)) return false;
	return (error as { code?: unknown }).code === "omp_settings_stale_revision";
}

/** Require both visible labels from OmpSettingsPanel's conflict row. */
export function observesOmpStaleConflict(bodyText: string): boolean {
	return bodyText.includes("This value is stale and was not written.")
		&& bodyText.includes("Refresh and retry");
}
