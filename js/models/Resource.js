/**
 * models/Resource.js
 *
 * A Resource belongs to exactly one Concept (see
 * models/LearningConcept.js's `resources` field) and represents one
 * piece of material a teacher intends to attach to it — a reading, an
 * image, a video, a simulation, an activity, a worksheet, a quiz,
 * homework, or an external link (see config/resourceTypeConfig.js for
 * the full type list).
 *
 * `title`, `type`, `status` are metadata, common to every resource
 * type. `content` is not: it's optional, type-specific, and this
 * model deliberately says nothing about its shape — only the type's
 * own content service and model know what belongs there. Reading's
 * shape is `{ blocks: [...] }` (see models/ReadingContent.js,
 * services/readingContentService.js) and lives here once a Reading
 * resource has been opened in its editor at least once; most resource
 * types have no editor yet at all and so simply never populate this
 * field — that's the correct, honest state for them, not a gap to
 * fill in. As each future type (Quiz, Worksheet, Simulation, ...)
 * gets its own editor, it gets its own content shape here the same
 * way, never a shared generic "content" schema every type has to
 * squeeze into.
 *
 * `status` here is deliberately independent of `LearningConcept.status`
 * (taught/not-taught) — a concept can be taught with every one of its
 * resources still in Draft, and a Published resource doesn't imply
 * anything about whether the concept itself has been taught. Same
 * "don't couple things that don't have to be coupled" reasoning
 * documented for that field (see docs/LEARNING_RECORD.md).
 *
 * No `order` field — a resource's position in its Concept's
 * `resources` array *is* its order, the same convention
 * LearningUnit.concepts and LearningSubject.units already use.
 *
 * `updatedAt` — bumped by services/resourceService.js on rename/status
 * change, and by each type's own content service (e.g.
 * services/readingContentService.js) on any content edit. This is
 * what powers the Dashboard's "Continue Working" shortcut to the most
 * recently edited resource across the whole classroom (see
 * ui/views/DashboardView.js) — a teacher resuming work should land on
 * whatever they actually touched last, not whatever was created last.
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

export function createResource({ id, title, type, status = 'draft', content = null, createdAt, updatedAt } = {}) {
  const timestamp = createdAt || getCurrentIsoDate();
  return {
    id: id || generateId(),
    title,
    type,
    status,
    content,
    createdAt: timestamp,
    updatedAt: updatedAt || timestamp,
  };
}
