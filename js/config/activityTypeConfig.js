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

export const EXTERNAL_PROVIDER_KEYS = Object.freeze(['kahoot']);

const EXTERNAL_PROVIDER_LABELS = {
  kahoot: 'Kahoot',
};

export function getExternalProviderLabel(provider) {
  return EXTERNAL_PROVIDER_LABELS[provider] || provider;
}
