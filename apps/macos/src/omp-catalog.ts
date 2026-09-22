/*
 * OMP model catalog over the host command envelope.
 *
 * Item-56 home for the catalog readers the native chat surface used to own:
 * `get_available_models` / `get_state` / `get_login_providers` /
 * `cedia_get_model_roles` through `CediaHostClient.sendCommand`, projected by
 * `chat-sessions-map.ts` into honest snapshots (never an invented fallback).
 * The native registration (`chat-sessions.ts`) is gone; the configure-roles
 * command and the bundle adapter are the readers.
 */

import { randomUUID } from "node:crypto";
import type { CediaHostClient } from "./api.ts";
import type { Command, Session } from "../../../packages/protocol/src/index.ts";
import {
	currentModelFromOmpState,
	getAvailableModelsRequest,
	getLoginProvidersRequest,
	getModelRolesRequest,
	getOmpStateRequest,
	normalizeOmpLoginProviders,
	normalizeOmpModels,
	normalizeOmpModelRoles,
	projectOmpModelSnapshot,
	type OmpAdvertisedModel,
	type OmpCurrentModel,
	type OmpLoginProvider,
	type OmpModelRoles,
	type OmpModelSnapshot,
} from "./chat-sessions-map.ts";

export type { OmpAdvertisedModel, OmpLoginProvider, OmpModelRoles, OmpModelSnapshot };
export { normalizeOmpModels, projectOmpModelSnapshot };

/**
 * List OMP's advertised models through the existing host command envelope
 * (`get_available_models:{}` -> ack/result `.models`). No new host route;
 * failures propagate so callers can degrade honestly to an empty catalog.
 */
export async function fetchOmpModels(client: CediaHostClient, session: Session): Promise<OmpAdvertisedModel[]> {
	const result = await client.sendCommand(session.id, getAvailableModelsRequest(session, randomUUID()));
	return normalizeOmpModels(result.result ?? result.ack);
}

/**
 * Read OMP's current model via `get_state`, id and provider together (undefined when unadvertised).
 *
 * The provider travels with the id because the catalogue can carry one id from several providers,
 * and the row - not the id - is what names a model's reasoning ladder.
 */
export async function fetchOmpCurrentModel(client: CediaHostClient, session: Session): Promise<OmpCurrentModel | undefined> {
	const result = await client.sendCommand(session.id, getOmpStateRequest(session, randomUUID()));
	return currentModelFromOmpState(result.result ?? result.ack);
}

/**
 * Honest OMP catalog snapshot: models plus the current id when still
 * advertised, annotated with `needs_auth` from `get_login_providers` when OMP
 * has that data. Never throws and never invents a fallback — host failures
 * yield an empty catalog (and empty login data) so the picker stays
 * honest-disabled. An explicit `options.loginProviders` wins (fixture
 * injection); otherwise the providers are fetched best-effort in this same
 * path and a fetch failure degrades to unannotated rather than throwing.
 */
export async function fetchOmpModelSnapshot(
	client: CediaHostClient,
	session: Session,
	options: {
		readonly loginProviders?: readonly OmpLoginProvider[];
		readonly log?: (message: string) => void;
		/** A `get_available_models` answer the caller already has, so it is not asked twice. */
		readonly catalog?: Command;
	} = {},
): Promise<OmpModelSnapshot> {
	let models: OmpAdvertisedModel[] = [];
	let current: OmpCurrentModel | undefined;
	if (options.catalog) {
		models = normalizeOmpModels(options.catalog.result ?? options.catalog.ack);
	} else {
		try {
			models = await fetchOmpModels(client, session);
		} catch (error) {
			options.log?.(`Cedia could not list OMP models: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	try {
		current = await fetchOmpCurrentModel(client, session);
	} catch (error) {
		options.log?.(`Cedia could not read the OMP model state: ${error instanceof Error ? error.message : String(error)}`);
	}
	let loginProviders = options.loginProviders;
	if (loginProviders === undefined) {
		try {
			const result = await client.sendCommand(session.id, getLoginProvidersRequest(session, randomUUID()));
			loginProviders = normalizeOmpLoginProviders(result.result ?? result.ack);
		} catch (error) {
			options.log?.(`Cedia could not list OMP login providers: ${error instanceof Error ? error.message : String(error)}`);
			loginProviders = undefined;
		}
	}
	const snapshot = projectOmpModelSnapshot(models, current?.id, loginProviders, current?.provider);
	// The level OMP reports for that model arrives in the same `get_state` answer. It is kept only
	// beside a selected model, and the composer's chip drops it again if the row's own ladder does
	// not contain it (`thinkingPickerGroupForModel`), so it can never be shown against a model that
	// does not accept it.
	if (snapshot.selectedModelId && current?.thinkingLevel) {
		return { ...snapshot, selectedThinkingLevel: current.thinkingLevel };
	}
	return snapshot;
}

/**
 * The catalog, read from a session that can actually answer it.
 *
 * OMP's catalog is global, but only a live OMP process holds it: a session the host has not
 * started answers `get_available_models` with `not_dispatched` ("Start or reconcile the OMP
 * session before sending commands" - the host's own guard), which is what left the picker
 * honestly-disabled in every window that had not sent a prompt yet. So a refused read starts
 * that session once and asks again. Starting mints a new incarnation, so the retry reads the
 * session `start` returned instead of the one that was refused.
 *
 * A send can also lose a race with a host refresh and fail on a stale incarnation
 * ("Refresh the task before submitting this command"), so a failed first send re-reads the session
 * once and retries with the incarnation the host now holds — one retry, never more.
 *
 * Bounded to one start and one retry, and it still degrades honestly: a retry that fails, a start
 * that fails, or a catalog OMP genuinely does not advertise, leaves the empty snapshot the picker
 * renders as disabled.
 */
async function snapshotWithOmpRuntime(
	client: CediaHostClient,
	session: Session,
	log: (message: string) => void,
): Promise<OmpModelSnapshot> {
	let current = session;
	for (let attempt = 0; attempt < 2; attempt++) {
		let catalog: Command;
		try {
			catalog = await client.sendCommand(current.id, getAvailableModelsRequest(current, randomUUID()));
		} catch (error) {
			const failure = error instanceof Error ? error.message : String(error);
			if (attempt > 0) {
				log(`Cedia could not list OMP models: ${failure}`);
				return { models: [], hasModels: false };
			}
			try {
				const refreshed = await client.getSession(current.id);
				log(`Cedia is retrying the OMP model list with session '${refreshed.id}' incarnation '${refreshed.incarnation}' (was '${current.incarnation}').`);
				current = refreshed;
			} catch (refreshError) {
				log(`Cedia could not re-read the session before retrying the OMP model list: ${refreshError instanceof Error ? refreshError.message : String(refreshError)}`);
			}
			continue;
		}
		if (catalog.status !== "not_dispatched") {
			return fetchOmpModelSnapshot(client, current, { log, catalog });
		}
		try {
			const running = await client.startSession(current.id);
			return await fetchOmpModelSnapshot(client, running, { log });
		} catch (error) {
			log(`Cedia could not start the OMP session to list models: ${error instanceof Error ? error.message : String(error)}`);
			return fetchOmpModelSnapshot(client, current, { log, catalog });
		}
	}
	return { models: [], hasModels: false };
}

/**
 * List the global OMP catalog through any available session purely as the
 * query envelope; the models are not attributed to that session. The catalog
 * itself is global to OMP. No sessions at all means honestly empty. Never
 * throws — callers stay honest-disabled on failure.
 */
export async function fetchGlobalOmpModelSnapshot(
	getClient: () => Promise<CediaHostClient>,
	log: (message: string) => void,
	token?: { readonly isCancellationRequested: boolean },
): Promise<OmpModelSnapshot> {
	try {
		const client = await getClient();
		const sessions = await client.listSessions();
		const probe = sessions.find(candidate => !candidate.archived) ?? sessions[0];
		if (probe && !(token?.isCancellationRequested ?? false)) {
			return await snapshotWithOmpRuntime(client, probe, log);
		}
	} catch (error) {
		log(`Cedia could not list OMP models: ${error instanceof Error ? error.message : String(error)}`);
	}
	return { models: [], hasModels: false };
}

/**
 * Fetch the configured model roles through the same envelope the catalog uses.
 * Roles are global to OMP, so any session can answer; no sessions means honestly
 * empty. Never throws — the picker then shows no role labels rather than failing.
 */
export async function fetchOmpModelRoles(
	getClient: () => Promise<CediaHostClient>,
	log: (message: string) => void,
): Promise<OmpModelRoles> {
	try {
		const client = await getClient();
		const sessions = await client.listSessions();
		const probe = sessions.find(candidate => !candidate.archived) ?? sessions[0];
		if (!probe) return { cycleOrder: [], roles: [] };
		const session = probe.status === "running" ? probe : await client.startSession(probe.id);
		const result = await client.sendCommand(session.id, getModelRolesRequest(session, randomUUID()));
		if (result.status === "not_dispatched" || result.status === "failed") {
			return { cycleOrder: [], roles: [] };
		}
		return normalizeOmpModelRoles(result.result ?? result.ack);
	} catch (error) {
		log(`Cedia could not read OMP model roles: ${error instanceof Error ? error.message : String(error)}`);
		return { cycleOrder: [], roles: [] };
	}
}
