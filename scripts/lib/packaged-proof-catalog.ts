function record(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/** Validate the model envelope used by the packaged catalog proof. */
export function packagedProofModelSlugs(value: unknown): Set<string> {
	const envelope = record(value);
	if (!envelope || !Array.isArray(envelope.models)) throw new Error("Packaged proof model catalog is not an array");
	return new Set(envelope.models.map((value, index) => {
		const model = record(value);
		const provider = text(model?.provider) ?? text(model?.upstreamProviderId);
		const id = text(model?.id);
		if (!provider || !id) throw new Error(`Packaged proof model row ${index} is missing provider and id`);
		return `${provider}/${id}`;
	}));
}
