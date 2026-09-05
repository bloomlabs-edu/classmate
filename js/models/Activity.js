/**
 * models/Activity.js
 *
 * An Activity is a reusable, launchable learning experience attached to
 * exactly one Concept — the ClassMate-side half of the future
 * Learning Hub / external-provider (e.g. Kahoot) integration (see
 * docs/LEARNING_HUB_INTEGRATION_CONTRACT.md for the full contract).
 *
 * Deliberately NOT the same shape as models/Resource.js, despite the
 * surface similarity (both are Concept-attached, independently
 * persisted references to external content): a Resource is
 * many-to-many with Concepts and knows nothing about being assigned,
 * scored, or launched (see docs/UNIFIED_PLATFORM_ARCHITECTURE.md).
 * An Activity is the opposite on every one of those points — it
 * belongs to exactly one Concept (`conceptId` is required), it has a
 * scoring configuration, and it exists specifically to be launched by
 * a student and to report back a result. Conflating the two would
 * blur Resource's own deliberately narrow, concept-agnostic charter.
 *
 * `destination` is opaque to ClassMate by design — for `activityType:
 * 'learning_hub'` it's whatever Learning Hub itself uses to identify
 * the experience (mirrors the existing, UI-layer-only
 * `resource.content.kind === 'learning_hub_experience'` pattern in
 * ui/views/ConceptWorkspaceView.js, generalized here into a real,
 * scoring-aware model); for `activityType: 'external'` it's a plain
 * URL. ClassMate never parses or executes it.
 *
 * `scoreMax: null` means this Activity is unscored — a completed
 * result with no numeric score is a fully valid outcome, not a
 * missing one (see the Result contract on
 * services/learningActivityService.js's setSubmissionStatus()).
 *
 * Persisted in its own Firestore subcollection,
 * `classrooms/{classroomId}/activities/{activityId}` (see
 * repositories/activityRepository.js) — the same reasoning
 * services/resourceRepository.js's own header comment gives for
 * Resources: independent lifecycle, reusable, shouldn't count against
 * the classroom document's own size.
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

export function createActivity({
  id,
  conceptId,
  title,
  description = '',
  activityType = 'native',
  externalProvider = null,
  destination = null,
  scoreMax = null,
  createdAt,
  updatedAt,
} = {}) {
  const timestamp = createdAt || getCurrentIsoDate();
  return {
    id: id || generateId(),
    conceptId,
    title,
    description,
    activityType,
    externalProvider,
    destination,
    scoreMax,
    createdAt: timestamp,
    updatedAt: updatedAt || timestamp,
  };
}
