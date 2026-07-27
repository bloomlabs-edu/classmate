/**
 * config/resourceTypeConfig.js
 *
 * Every resource type a Concept can hold (see models/Resource.js), and
 * a resource's own lifecycle status — bundled in one file the same
 * way config/learningRecordConfig.js bundles its three related enums
 * together rather than splitting into three tiny files. Adding a new
 * type — the platform vision names a future AI Tutor type explicitly —
 * means adding one entry to RESOURCE_TYPE_KEYS/LABELS/ICONS, not
 * touching CRUD, reordering, cards, or Resource Details in
 * services/resourceService.js or ui/views/ConceptWorkspaceView.js,
 * none of which know or care what a type *is*.
 *
 * No logic here, only data.
 */

export const RESOURCE_TYPE_KEYS = Object.freeze([
  'reading',
  'image',
  'video',
  'simulation',
  'activity',
  'worksheet',
  'quiz',
  'homework',
  'external_link',
]);

export const RESOURCE_TYPE_LABELS = Object.freeze({
  reading: 'Reading',
  image: 'Image',
  video: 'Video',
  simulation: 'Simulation',
  activity: 'Activity',
  worksheet: 'Worksheet',
  quiz: 'Quiz',
  homework: 'Homework',
  external_link: 'External Link',
});

/**
 * Icon names from ui/components/Icon.js's existing set only — no new
 * icon paths invented for this (see that file's own established
 * caution about hand-guessing icon geometry from memory). Where no
 * close match exists (video, worksheet), falls back to a generic
 * document icon rather than forcing a poor metaphor.
 */
export const RESOURCE_TYPE_ICONS = Object.freeze({
  reading: 'book-open',
  image: 'palette',
  video: 'file-text',
  simulation: 'chalkboard-easel',
  activity: 'clipboard-list',
  worksheet: 'notebook-text',
  quiz: 'check-circle-2',
  homework: 'calendar',
  external_link: 'arrow-right',
});

export function getResourceTypeLabel(type) {
  return RESOURCE_TYPE_LABELS[type] || type;
}

export function getResourceTypeIcon(type) {
  return RESOURCE_TYPE_ICONS[type] || 'file-text';
}

/**
 * A resource's lifecycle, independent of any concept-level state (see
 * models/Resource.js's own doc comment for why). Every resource starts
 * 'draft' — nothing is ever auto-published.
 */
export const RESOURCE_STATUS_KEYS = Object.freeze(['draft', 'published', 'archived']);

export const RESOURCE_STATUS_LABELS = Object.freeze({
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
});

export function getResourceStatusLabel(status) {
  return RESOURCE_STATUS_LABELS[status] || RESOURCE_STATUS_LABELS.draft;
}
