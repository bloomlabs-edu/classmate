/**
 * models/Resource.js
 *
 * A Resource is an independent Learning Hub asset — one piece of
 * reusable teaching material (a reading, an image, a video, a
 * simulation, an activity, a worksheet, a quiz, homework, or an
 * external link; see config/resourceTypeConfig.js for the full type
 * list). It has no owning Concept and no knowledge that Concepts
 * exist at all: a Resource is fully valid and usable with zero
 * Concepts referencing it, and the same Resource can be linked from
 * any number of Concepts at once. That connection lives entirely on
 * the Concept side, as a lightweight ConceptResourceLink (see
 * models/ConceptResourceLink.js, models/LearningConcept.js's own
 * `resourceLinks` field) — this file and services/resourceRepository.js
 * know nothing about Concepts, by design. See
 * docs/UNIFIED_PLATFORM_ARCHITECTURE.md for the full domain-boundary
 * reasoning: Curriculum answers "what should be taught," Learning Hub
 * (this model) answers "how."
 *
 * Persisted in its own Firestore subcollection,
 * `classrooms/{classroomId}/resources/{resourceId}` (see
 * services/resourceRepository.js) — not embedded in the classroom
 * document, so a growing library of resource content never counts
 * against that document's own size, and editing one resource is a
 * single small write rather than rewriting a larger structure.
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

/**
 * `audience` — who this resource is for: 'student', 'teacher', or
 * 'both'. Additive; existing resources created before this field
 * existed simply have it undefined, not migrated. Per explicit
 * product decision, an undefined audience is treated as
 * student-*invisible* by every student-facing read (see
 * resourceService.js's own getStudentVisibleResources()) —
 * deliberately conservative, so no pre-existing resource silently
 * becomes visible to students without a teacher's own explicit
 * choice. New resources default to 'teacher' here (not 'both'),
 * matching that same conservative default for anything freshly
 * created too, until a teacher-facing audience control exists.
 */
import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

export function createResource({ id, title, type, status = 'draft', content = null, audience = 'teacher', createdAt, updatedAt } = {}) {
  const timestamp = createdAt || getCurrentIsoDate();
  return {
    id: id || generateId(),
    title,
    type,
    status,
    content,
    audience,
    createdAt: timestamp,
    updatedAt: updatedAt || timestamp,
  };
}
