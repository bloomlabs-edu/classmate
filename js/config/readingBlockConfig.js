/**
 * config/readingBlockConfig.js
 *
 * Every block a Reading resource's content can be made of. The first
 * concrete instance of the "one editor at a time, keyed by
 * resource.type" pattern services/resourceService.js's doc comment
 * already promised — Quiz, Worksheet, and Simulation will each get
 * their own equally small block-config file plus their own content
 * service and editor view, following this exact shape, not a shared
 * generic "content block" system trying to handle every type at once.
 *
 * No logic here, only data — same convention as
 * config/resourceTypeConfig.js and config/learningRecordConfig.js.
 */

export const READING_BLOCK_TYPE_KEYS = Object.freeze(['heading', 'paragraph', 'image_placeholder']);

export const READING_BLOCK_TYPE_LABELS = Object.freeze({
  heading: 'Heading',
  paragraph: 'Paragraph',
  image_placeholder: 'Image Placeholder',
});

/** Icon names from ui/components/Icon.js's existing set only — same reasoning as config/resourceTypeConfig.js's RESOURCE_TYPE_ICONS. */
export const READING_BLOCK_TYPE_ICONS = Object.freeze({
  heading: 'file-text',
  paragraph: 'notebook-text',
  image_placeholder: 'palette',
});

export function getReadingBlockTypeLabel(type) {
  return READING_BLOCK_TYPE_LABELS[type] || type;
}

export function getReadingBlockTypeIcon(type) {
  return READING_BLOCK_TYPE_ICONS[type] || 'file-text';
}
