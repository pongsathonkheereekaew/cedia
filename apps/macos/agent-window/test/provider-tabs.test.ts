import { expect, it } from 'bun:test';

import {
	buildProviderTabRows,
	moveComposerModelPickerUpstreamTab,
	resolveComposerModelPickerInitialTab,
	resolveComposerModelPickerUpstreamTabs,
} from '../vendor/synara/apps/web/src/components/chat/ComposerModelPicker.logic';
import { resolveOmpUpstreamProviderTab } from '../../../../scripts/lib/omp-native-confirm-picker.ts';
import { ProviderGlyphIcon, resolveProviderGlyphId } from '../vendor/synara/apps/web/src/components/ProviderIcon';

it('derives one user-facing tab per OMP upstream provider and never exposes OMP', () => {
	const options = [
		{
			slug: 'openai-codex/gpt-5.5',
			name: 'GPT-5.5',
			upstreamProviderId: 'openai-codex',
			upstreamProviderName: 'OpenAI Codex',
		},
		{
			slug: 'openai-codex/gpt-5.4',
			name: 'GPT-5.4',
			upstreamProviderId: 'openai-codex',
			upstreamProviderName: 'OpenAI Codex',
		},
		{
			slug: 'anthropic/claude-sonnet-4-6',
			name: 'Claude Sonnet 4.6',
			upstreamProviderId: 'anthropic',
			upstreamProviderName: 'Anthropic',
		},
		// A duplicated catalog row must not create a second tab or model row.
		{
			slug: 'openai-codex/gpt-5.5',
			name: 'GPT-5.5 (duplicate)',
			upstreamProviderId: 'openai-codex',
			upstreamProviderName: 'OpenAI Codex',
		},
	];

	const tabs = resolveComposerModelPickerUpstreamTabs(options);
	 expect(tabs.map((tab) => tab.label)).toEqual(['OpenAI Codex', 'Anthropic']);
	 expect(tabs.every((tab) => tab.provider === 'omp')).toBe(true);
	 expect(tabs.some((tab) => tab.label === 'OMP')).toBe(false);

	const openAiTab = tabs[0];
	 expect(openAiTab).toBeDefined();
	 expect(
		buildProviderTabRows({
			provider: 'omp',
			options,
			query: '',
			selectedModel: 'openai-codex/gpt-5.5',
			upstreamProviderId: openAiTab?.upstreamProviderId,
		}),
	).toHaveLength(2);
});

it('opens on the upstream tab that owns the selected provider-qualified model', () => {
	const options = [
		{
			slug: 'openai-codex/gpt-5.5',
			name: 'GPT-5.5',
			upstreamProviderId: 'openai-codex',
			upstreamProviderName: 'OpenAI Codex',
		},
		{
			slug: 'anthropic/claude-sonnet-4-6',
			name: 'Claude Sonnet 4.6',
			upstreamProviderId: 'anthropic',
			upstreamProviderName: 'Anthropic',
		},
	];
	const tabs = resolveComposerModelPickerUpstreamTabs(options);

	 expect(
		resolveComposerModelPickerInitialTab({
			provider: 'omp',
			model: 'anthropic/claude-sonnet-4-6',
			options,
			upstreamTabs: tabs,
		}),
	).toBe(tabs[1]?.tab);
});

it('resolves the proof target by stable tab id and supports the sole visible upstream tab fallback', () => {
	const tabs = [
		{ label: 'Starred', stableTabId: null },
		{ label: 'OpenCode Go', stableTabId: 'upstream:opencode-go' },
		{ label: 'Anthropic', stableTabId: 'upstream:anthropic' },
	];
	expect(resolveOmpUpstreamProviderTab(tabs, 'opencode-go')).toEqual(tabs[1]);
	expect(resolveOmpUpstreamProviderTab([
		{ label: 'Starred', stableTabId: null },
		{ label: 'opencode-go', stableTabId: null },
	], 'opencode-go')).toEqual({ label: 'opencode-go', stableTabId: null });
	expect(resolveOmpUpstreamProviderTab([
		{ label: 'Starred', stableTabId: null },
		{ label: 'OpenCode Go', stableTabId: null },
		{ label: 'Anthropic', stableTabId: null },
	], 'opencode-go')).toBeUndefined();
});

it('moves upstream provider tabs without changing their stable ids', () => {
	const tabs = resolveComposerModelPickerUpstreamTabs([
		{ slug: 'openai/gpt', name: 'GPT', upstreamProviderId: 'openai', upstreamProviderName: 'OpenAI' },
		{ slug: 'anthropic/claude', name: 'Claude', upstreamProviderId: 'anthropic', upstreamProviderName: 'Anthropic' },
	]);
	expect(moveComposerModelPickerUpstreamTab(tabs, 'upstream:anthropic', 'upstream:openai').map(tab => tab.tab)).toEqual([
		'upstream:anthropic',
		'upstream:openai',
	]);
});

it('projects upstream provider additions and removals from updated OMP model catalogs', () => {
	const baselineOptions = [
		{ slug: 'openai-codex/gpt-5.5', name: 'GPT-5.5', upstreamProviderId: 'openai-codex', upstreamProviderName: 'OpenAI Codex' },
	];
	const baselineTabs = resolveComposerModelPickerUpstreamTabs(baselineOptions);
	expect(baselineTabs.map(tab => tab.tab)).toEqual(['upstream:openai-codex']);

	const providerAddedOptions = [
		...baselineOptions,
		{
			slug: 'opencode-go/muse-spark-1.3-contributor',
			name: 'Muse Spark 1.3 Contributor',
			upstreamProviderId: 'opencode-go',
			upstreamProviderName: 'OpenCode Go',
		},
	];
	const addedTabs = resolveComposerModelPickerUpstreamTabs(providerAddedOptions);
	expect(addedTabs.map(tab => tab.tab)).toEqual(['upstream:openai-codex', 'upstream:opencode-go']);
	expect(addedTabs[0]?.tab).toBe(baselineTabs[0]?.tab);
	expect(addedTabs.find(tab => tab.upstreamProviderId === 'opencode-go')?.label).toBe('OpenCode Go');
	expect(buildProviderTabRows({
		provider: 'omp',
		options: providerAddedOptions,
		query: '',
		selectedModel: null,
		upstreamProviderId: 'opencode-go',
	}).map(row => [row.model, row.name, row.upstreamProviderId])).toEqual([
		['opencode-go/muse-spark-1.3-contributor', 'Muse Spark 1.3 Contributor', 'opencode-go'],
	]);

	const providerRemovedOptions = providerAddedOptions.filter(option => option.upstreamProviderId !== 'opencode-go');
	const removedTabs = resolveComposerModelPickerUpstreamTabs(providerRemovedOptions);
	expect(removedTabs.map(tab => tab.tab)).toEqual(['upstream:openai-codex']);
	expect(buildProviderTabRows({
		provider: 'omp',
		options: providerRemovedOptions,
		query: '',
		selectedModel: null,
		upstreamProviderId: 'opencode-go',
	})).toEqual([]);
});

it('resolves bundled marks for upstream providers instead of falling back to a globe', () => {
	 expect(resolveProviderGlyphId('openrouter')).toBe('openrouter');
	 expect(resolveProviderGlyphId('openai-codex')).toBe('openai');
	 expect(resolveProviderGlyphId('anthropic')).toBe('anthropic');
	 expect(resolveProviderGlyphId('meta-llama')).toBe('meta');
	 expect(resolveProviderGlyphId('unknown-provider')).toBeNull();
});

it('renders a real SVG mark after provider-id resolution', () => {
	 const element = ProviderGlyphIcon({ providerId: 'mistralai', className: 'mark' });
	 expect(element.type).toBe('svg');
	 expect(element.props.viewBox).toBe('0 0 24 24');
	 expect(element.props.children.length).toBeGreaterThan(0);
	 const commandCode = ProviderGlyphIcon({ providerId: 'commandcode', className: 'mark' });
	 expect(commandCode.type).toBe('svg');
	 expect(commandCode.props.viewBox).toBe('0 0 137 137');
	 expect(commandCode.props.children.type).toBe('image');
	 expect(commandCode.props.children.props.href).toContain('commandcode.svg');
});
