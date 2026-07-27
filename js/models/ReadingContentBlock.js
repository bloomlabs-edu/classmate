/**
 * models/ReadingContentBlock.js
 *
 * One block inside a Reading resource's content (see
 * models/ReadingContent.js, config/readingBlockConfig.js's
 * READING_BLOCK_TYPE_KEYS: heading, paragraph, image_placeholder).
 *
 * One shared `text` field for all three block types rather than a
 * different field name per type (`heading` vs `caption` vs ...) —
 * for a heading or paragraph it's the written text; for an image
 * placeholder it's the caption describing what image will eventually
 * go there. Keeping one field name is what makes the editor and the
 * read-only renderer able to loop over blocks generically instead of
 * branching on field names as well as on type.
 *
 * No `order` field — a block's position in ReadingContent.blocks *is*
 * its order, the same convention every other ordered list in this app
 * already uses (LearningUnit.concepts, LearningConcept.resources, ...).
 */

import { generateId } from '../utils/idGenerator.js';

export function createReadingContentBlock({ id, type, text = '' } = {}) {
  return {
    id: id || generateId(),
    type,
    text,
  };
}
