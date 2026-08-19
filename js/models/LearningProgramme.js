/**
 * models/LearningProgramme.js
 *
 * A Learning Programme is an additional learning context attached to
 * existing students — an after-school English Literacy Circle, a
 * Reading Club, a Bridge Programme, and so on. It is NOT a second
 * classroom, a subject, or a replacement for school attendance, Class
 * Mode scoring, or normal academic grading (see this project's own
 * Learning Programmes Audit Report for the full product framing).
 *
 * Config-sized and bounded — mirrors models/PlanningCycle.js's own
 * storage decision exactly: this model lives embedded on the
 * classroom document (`classroom.learningProgrammes[]`, see
 * models/Classroom.js), never in a subcollection, because the number
 * of programmes a classroom runs is small and doesn't grow
 * unboundedly the way daily session history does (see
 * models/ProgrammeSession.js, which DOES live in its own
 * subcollection for exactly that reason).
 *
 * `classroomIds` (plural) is deliberate, not `classroomId` — per
 * explicit architectural direction, a programme's domain identity
 * must not hard-code "belongs to exactly one classroom forever," even
 * though Phase 1 only ever creates and stores a programme with a
 * single entry in this array, from the one classroom it was created
 * in, and ships no multi-classroom UI or behaviour at all. This is
 * the same "hold a reference, don't assume its cardinality" caution
 * this app already applies elsewhere (see models/Classroom.js's own
 * `curriculumAssignment` — a reference, never a copy).
 *
 * `ownerId`/`facilitatorUids` are plain uid references into the
 * classroom's own existing `members` map (models/Classroom.js) —
 * never a copy of a member's name or role. Resolving a uid to a
 * display name at read time, the same "reference, not copy"
 * convention used throughout this app for student/subject/category
 * references, is a UI-layer concern, not this model's.
 *
 * `status` — 'active' | 'archived'. Archiving a programme must never
 * delete its configuration, its memberships, or (elsewhere) its
 * session history — matching the same "presence in an array/collection
 * is permanent, status flags mark state, nothing is deleted"
 * convention already used by models/GoalCycle.js's own 'closed'
 * cycles.
 *
 * `configuration` holds everything a teacher can tune without
 * touching history: `defaultComponents`/`extensions` are plain,
 * typed config objects (mirrors config/recognitionCategories.js's own
 * "pure data, no logic" shape — a component's own type dispatches to
 * whatever code understands it, added later, not built in Phase 1);
 * `goalFramework.categories` is deliberately generic — `{ id, name,
 * suggestedGoals }`, nothing English- or LSRW-specific in the shape
 * itself, the same way models/GoalCycle.js's own `categories` are
 * generic and LSRW is just that cycle's own starting data (see
 * config/englishLiteracyCircleDefaults.js for where the actual LSRW
 * data lives). `settings` is a free-form bag for whatever a future
 * programme type needs that doesn't yet have its own field.
 *
 * `memberships` — ProgrammeMembership[] (see that model). Embedded
 * here for Phase 1 rather than promoted to its own subcollection,
 * because the expected scale is bounded by classroom roster size, not
 * by time — but every function that reads or writes memberships lives
 * in services/learningProgrammeService.js's own dedicated membership
 * functions, never inlined at call sites, specifically so this
 * storage decision could be revisited later (promoted to a
 * subcollection) without rewriting every caller. History here is
 * never destroyed: a student leaving sets `leftAt` on their own
 * existing entry and never deletes it, the same "presence means it
 * happened" discipline this app already applies to
 * StudentCheckpointRecord and Goal.
 *
 * This model intentionally has NO score, progress, or completion
 * field of any kind — per explicit architectural direction for this
 * phase, and matching this app's own hard-won lesson from the
 * Scoreboard Archive work: a cached, independently-mutable progress
 * number is a duplicated source of truth waiting to drift from the
 * historical data it's supposed to summarize. Progress is a later
 * phase's read-only derivation over ProgrammeSession history, never a
 * field stored here.
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

export function createLearningProgramme({
  id,
  name,
  description = '',
  ownerId = null,
  facilitatorUids = [],
  status = 'active',
  classroomIds = [],
  createdAt,
  updatedAt,
  configuration = {},
  memberships = [],
} = {}) {
  const resolvedCreatedAt = createdAt || getCurrentIsoDate();
  return {
    id: id || generateId(),
    name,
    description,
    ownerId,
    facilitatorUids,
    status,
    classroomIds,
    createdAt: resolvedCreatedAt,
    updatedAt: updatedAt || resolvedCreatedAt,
    configuration: {
      defaultComponents: configuration.defaultComponents || [],
      extensions: configuration.extensions || [],
      goalFramework: {
        categories: configuration.goalFramework?.categories || [],
      },
      settings: configuration.settings || {},
    },
    memberships,
  };
}
