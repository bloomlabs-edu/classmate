/**
 * models/ConceptResourceLink.js
 *
 * Lightweight link metadata connecting a Concept to a Resource (see
 * models/Resource.js) — not a first-class aggregate, not its own
 * Firestore collection. Lives inside a Concept's own `resourceLinks`
 * array (see models/LearningConcept.js), the same "array position is
 * order" convention this app already uses for LearningUnit.concepts
 * and LearningSubject.units — no separate sortIndex field, since this
 * app has no precedent for keeping two sources of truth for order in
 * sync, and every existing embedded-list model here avoids exactly
 * that.
 *
 * This is a deliberate DDD conclusion, not a shortcut: a link has no
 * meaning or lookup path independent of both its Concept and its
 * Resource (nobody ever looks one up on its own terms), and it cascades
 * with its Concept — deleting a Concept deletes its links, but never
 * the Resources they pointed to. That's the textbook signature of
 * being part of the Concept aggregate, not a peer aggregate root, the
 * same way an OrderLineItem lives inside an Order even though the
 * Product it references is very much its own independent entity
 * elsewhere. See docs/UNIFIED_PLATFORM_ARCHITECTURE.md for the full
 * reasoning this conclusion came from.
 *
 * Fields:
 *   id           - this link's own identity, for finding/removing/
 *                  reordering it within its Concept's array — the same
 *                  reason Team/Student/Unit/Part all carry their own
 *                  id despite being array items, not because a link
 *                  has independent meaning outside that array.
 *   resourceId   - the Resource this link points to (see
 *                  models/Resource.js, services/resourceRepository.js)
 *                  — a reference only, never a copy of the resource's
 *                  own data. Resolving it to the actual Resource
 *                  requires the classroom's resource cache (see
 *                  services/resourceService.js's getResources()) since
 *                  Resources no longer live on the Concept itself.
 *   resourceType - denormalized copy of the Resource's own `type` at
 *                  link-creation time, purely so a resource card can
 *                  render its icon/label even in the moment right
 *                  after creation, before any cache refresh — never
 *                  treated as authoritative if it and the live
 *                  Resource's own type ever disagree; the Resource's
 *                  own `type` always wins.
 *   addedAt      - ISO date string, when this link was created.
 *   addedBy      - the uid of whichever teacher created this link, or
 *                  null for links created before this field existed,
 *                  or by migration.
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

export function createConceptResourceLink({ id, resourceId, resourceType, addedAt, addedBy = null } = {}) {
  return {
    id: id || generateId(),
    resourceId,
    resourceType,
    addedAt: addedAt || getCurrentIsoDate(),
    addedBy,
  };
}
