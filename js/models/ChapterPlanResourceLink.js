/**
 * models/ChapterPlanResourceLink.js
 *
 * Lightweight link metadata connecting a ChapterPlan (see
 * models/ChapterPlan.js) to a Resource (see models/Resource.js) —
 * modeled directly on models/ConceptResourceLink.js's own "a link has
 * no meaning independent of both its owner and its Resource, cascades
 * with its owner, never with the Resource" reasoning. Lives inside a
 * ChapterPlan's own `resourceLinks` array — not a first-class
 * aggregate, not its own Firestore collection. Deleting a ChapterPlan
 * deletes its links, but never the Resources they point to.
 *
 * ---------------------------------------------------------------------
 * Why this carries `classroomId`, unlike ConceptResourceLink
 * ---------------------------------------------------------------------
 *
 * A LearningConcept only ever links Resources that already live in its
 * OWN classroom's `classrooms/{classroomId}/resources` subcollection —
 * `classroomId` is implicit from context, so ConceptResourceLink never
 * needs to store it. A ChapterPlan is different: per explicit product
 * direction, multiple Fellows (in different classrooms) may plan the
 * same curriculum chapter, and one Fellow's Chapter Plan may reference
 * a Resource another Fellow already contributed in THEIR OWN
 * classroom. Resolving `resourceId` alone is therefore ambiguous — the
 * same id could theoretically exist under any classroom's own
 * subcollection — so this link stores the owning `classroomId`
 * alongside it, giving `classrooms/{classroomId}/resources/{resourceId}`
 * as one unambiguous path. Referencing a Resource this way never
 * grants write access to it: the Resource's own Firestore rule still
 * requires membership of THAT classroom specifically (see
 * firestore.rules' own `resources` block), completely independent of
 * whether some other classroom's ChapterPlan happens to reference it.
 *
 * `resourceType` — same denormalized-for-display-only convention
 * ConceptResourceLink.js already documents: a copy of the Resource's
 * own `type` at link-creation time, purely so a resource card can
 * render its icon/label without an extra fetch; never authoritative if
 * it and the live Resource's own type ever disagree.
 *
 * `addedAt`/`addedBy` — when this link was created and by which uid
 * (the Chapter Plan's own author, always — a co-author's classroom
 * membership already gates who can edit a ChapterPlan's content at
 * all, so this is provenance, not an access-control field).
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

export function createChapterPlanResourceLink({ id, classroomId, resourceId, resourceType, addedAt, addedBy = null } = {}) {
  return {
    id: id || generateId(),
    classroomId,
    resourceId,
    resourceType,
    addedAt: addedAt || getCurrentIsoDate(),
    addedBy,
  };
}
