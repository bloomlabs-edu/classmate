/**
 * services/extractionProviders/extractionProviderRegistry.js
 *
 * Maps a provider id to a provider module. This is the whole
 * mechanism for supporting future extraction providers: adding a real
 * OpenAI/Claude/Gemini/offline provider later means writing one new
 * file (matching manualAiProvider.js's own contract) and adding one
 * line here \u2014 the Concept Extraction workflow itself never changes.
 * Matches the same "one file, one registry line" extension pattern
 * already used elsewhere in this app (see
 * services/plannerStrategies/strategyRegistry.js for the identical
 * shape applied to a different domain, and
 * config/resourceTypeConfig.js for the same idea applied to plain
 * data rather than behavior).
 *
 * Provider contract every module in this registry must satisfy:
 *   id: string \u2014 stable identifier, matches this registry's own key.
 *   label: string \u2014 human-readable name for any future provider picker UI.
 *   requiresManualInput: boolean \u2014 true for a provider whose extract()
 *     needs a teacher-pasted response (see manualAiProvider.js); false
 *     for a provider that calls its own API directly. The one thing
 *     calling code needs to branch on to stay provider-agnostic
 *     otherwise \u2014 whether to show a "paste response" step before
 *     calling extract(), or just show a loading state and call it
 *     directly.
 *   buildPrompt(unitContext): string \u2014 unitContext is
 *     { curriculumName, grade, subject, unitTitle, startPage, endPage, pageText }.
 *   extract(unitContext, { pastedText }?): Promise<{ concepts, errors, metadata }>
 *     \u2014 concepts: [{ number, title, startPage, endPage }],
 *     errors: [{ lineNumber, rawLine }] (only ever non-empty for a
 *     provider that parses raw text \u2014 an automated provider
 *     returning already-structured data may always return `[]` here),
 *     metadata: whatever header fields the provider could resolve
 *     (see conceptImportFormatService.js's own return shape for the
 *     manual provider's version of this).
 */

import * as manualAiProvider from './manualAiProvider.js';

const providers = {
  [manualAiProvider.id]: manualAiProvider,
  // openai: openaiProvider,      // future milestone
  // claude: claudeProvider,      // future milestone
  // gemini: geminiProvider,      // future milestone
  // offline: offlineProvider,    // future milestone
};

export function getProvider(providerId) {
  const provider = providers[providerId];
  if (!provider) {
    const available = Object.keys(providers).join(', ');
    throw new Error(`Unknown extraction provider "${providerId}". Available: ${available}`);
  }
  return provider;
}

/** Every registered provider's own { id, label } \u2014 what a future provider picker UI would list. Today, always just Manual AI. */
export function listProviders() {
  return Object.values(providers).map((provider) => ({ id: provider.id, label: provider.label }));
}

export function registerProvider(providerModule) {
  providers[providerModule.id] = providerModule;
}

/** The provider a fresh Concept Extraction session defaults to \u2014 Manual AI today, since it's the only one that exists. A future automated provider becoming the default is a product decision to make explicitly later, not something this function should guess at. */
export function getDefaultProvider() {
  return manualAiProvider;
}
