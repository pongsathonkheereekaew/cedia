/**
 * Cedia's model-catalog protocol.
 *
 * Why this file exists (§10 item 65c): the row a model picker draws was declared
 * by whoever produced it — the host's `apps/host/src/model-catalog.ts` — and then
 * re-shaped, field by field, in every client that read it. The host's
 * `get_available_models` normalization is the only place that knows what OMP
 * actually answered, so its row is the contract and lives here.
 *
 * One route carries the catalog:
 *   GET /v1/models   OMP's own model list, provider-qualified and cached
 */
import type { ProviderAuthStatus } from "./provider-auth.ts";

/** One rung of a model's reasoning-effort ladder. */
export interface ModelReasoningEffort {
  readonly value: string;
  readonly label: string;
}

/** A context-window size the model may be configured with; one row is the default. */
export interface ModelContextWindowOption {
  readonly value: string;
  readonly label: string;
  readonly isDefault: true;
}

/**
 * One model OMP offers, normalized for a picker.
 *
 * `slug` is the provider-qualified identity a client sends back (`provider/id`);
 * `available: false` with a `reason` means OMP lists the model but will not run
 * it here, which a picker must show rather than hide.
 */
export interface ModelCatalogModel {
  readonly id: string;
  readonly provider?: string;
  readonly slug: string;
  readonly name: string;
  readonly label: string;
  readonly available: boolean;
  readonly reason?: string;
  readonly description?: string;
  readonly upstreamProviderId?: string;
  readonly upstreamProviderName?: string;
  readonly supportedReasoningEfforts?: readonly ModelReasoningEffort[];
  readonly defaultReasoningEffort?: string;
  readonly contextWindow?: number;
  readonly contextWindowOptions?: readonly ModelContextWindowOption[];
  readonly maxOutputTokens?: number;
}

/** One catalog answer: OMP's models, and whether the host served them from its cache. */
export interface ModelCatalogResult {
  readonly models: readonly ModelCatalogModel[];
  readonly source: "omp";
  readonly cached: boolean;
}

/**
 * The provider row a login picker is drawn from.
 *
 * Deliberate projection of {@link ProviderAuthStatus}: the picker shows which
 * provider can be signed in to, and which already is. It never shows credential
 * kinds, the resolving origin, or an OAuth store id, because those belong to the
 * provider-auth settings surface, not the switcher. Every field is taken from
 * the protocol row's own type, so a rename or a retype there cannot leave this
 * shape behind.
 */
export interface LoginProviderOption {
  readonly id: ProviderAuthStatus["id"];
  readonly name: ProviderAuthStatus["name"];
  readonly available?: ProviderAuthStatus["available"];
  readonly authenticated?: ProviderAuthStatus["authenticated"];
}
