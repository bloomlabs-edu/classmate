/**
 * config/activityTypeConfig.js
 *
 * Display metadata for models/Activity.js's `activityType` /
 * `externalProvider` fields — mirrors config/resourceTypeConfig.js's
 * own "keys list + label lookup, not enforced by the model factory"
 * convention. Kahoot is listed as one entry in EXTERNAL_PROVIDER_KEYS,
 * never treated as the foundational external type — a future
 * provider is just another entry here, not a structural change.
 */

export const ACTIVITY_TYPE_KEYS = Object.freeze(['native', 'learning_hub', 'external']);

const ACTIVITY_TYPE_LABELS = {
  native: 'ClassMate',
  learning_hub: 'Learning Hub',
  external: 'External',
};

export function getActivityTypeLabel(activityType) {
  return ACTIVITY_TYPE_LABELS[activityType] || activityType;
}

// quizizz/google-forms/other added for Student-Facing External
// Activities (ClassMate Phase 2) — same provider vocabulary Learning
// Hub's own externalActivities.provider field already uses (see that
// repo's config/notebookBadgeConfig.js-sibling
// external-activity-contribution-service.js PROVIDERS list), so a
// provider badge reads identically on both sides, not a second,
// drifting vocabulary.
export const EXTERNAL_PROVIDER_KEYS = Object.freeze(['kahoot', 'quizizz', 'google-forms', 'other']);

const EXTERNAL_PROVIDER_LABELS = {
  kahoot: 'Kahoot',
  quizizz: 'Quizizz',
  'google-forms': 'Google Forms',
  other: 'Other',
};

export function getExternalProviderLabel(provider) {
  return EXTERNAL_PROVIDER_LABELS[provider] || provider;
}
