/**
 * models/ChapterPlanSparkRef.js
 *
 * Lightweight reference metadata connecting a ChapterPlan (see
 * models/ChapterPlan.js) to a Spark (see models/Spark.js) — modeled
 * directly on models/ChapterPlanResourceLink.js's own "a link has no
 * meaning independent of both its owner and the thing it points to,
 * cascades with its owner, never with the thing it points to"
 * reasoning, itself modeled on models/ConceptResourceLink.js. Lives
 * inside a ChapterPlan's own `sparkRefs` array — not a first-class
 * aggregate, not its own Firestore collection. Deleting a ChapterPlan
 * deletes its refs, but never the Sparks they point to; removing one
 * ref removes only that one association, never the canonical Spark
 * (see services/chapterPlanService.js's own removeSparkRef()).
 *
 * Deliberately holds NONE of the Spark's own content — no title,
 * description, instructions, sparkType, or anything else. Per explicit
 * product direction ("Chapter Plans reference Sparks; they never copy
 * Spark content"), resolving a ref to the actual Spark's own current
 * content always requires a real fetch (see
 * repositories/sparkRepository.js's own getSparkById()) — this ref is
 * the pointer, never a cache or snapshot of what it points to. Unlike
 * ChapterPlanResourceLink, this carries no `classroomId`: Sparks are a
 * top-level, non-classroom-scoped collection (`sparks/{sparkId}` — see
 * models/Spark.js's own header comment), so `sparkId` alone is already
 * an unambiguous path (`sparks/{sparkId}`), with no classroom to
 * disambiguate against the way a classroom-scoped Resource needs.
 *
 * `section` — WHICH part of the Chapter Plan this Spark was found
 * useful for, addressed with the same "a controlled set of keys, never
 * arbitrary free text" convention this app already uses for every
 * other section-addressing scheme (models/LessonPlan.js's own
 * LESSON_PLAN_SECTION_KEYS, models/ChapterPlan.js's own
 * CHAPTER_PLAN_SECTION_KEYS) — see
 * models/ChapterPlan.js's own CHAPTER_PLAN_SPARK_SECTIONS for the
 * actual allowed values and why exactly those three. A Spark may be
 * referenced in more than one section (a `[chapterPlanId, sparkId]`
 * pair is not unique — a `[chapterPlanId, sparkId, section]` triple
 * is), per explicit product direction; only a duplicate
 * (sparkId, section) pair within the SAME plan is prevented (see
 * services/chapterPlanService.js's own addSparkRef()).
 *
 * `addedBy`/`addedAt` — who referenced this Spark into this plan, and
 * when — provenance for THIS reference, not for the Spark itself (the
 * Spark's own `createdByUid`/`createdAt`, resolved separately, is what
 * still says who originally authored the idea — see models/Spark.js).
 * Always this plan's own author in practice (classroom-membership rules
 * already gate who can edit a ChapterPlan's content at all — see
 * firestore.rules' own `chapterPlans` block), so this is provenance,
 * not an access-control field, the same distinction
 * models/ChapterPlanResourceLink.js's own header comment already draws
 * for its own `addedBy`.
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

export function createChapterPlanSparkRef({ id, sparkId, section, addedAt, addedBy = null } = {}) {
  return {
    id: id || generateId(),
    sparkId,
    section,
    addedAt: addedAt || getCurrentIsoDate(),
    addedBy,
  };
}
