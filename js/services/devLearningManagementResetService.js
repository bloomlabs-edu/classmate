/**
 * services/devLearningManagementResetService.js
 *
 * DEVELOPER-ONLY UTILITY — not a production feature. Exists solely to
 * support rapid iteration on Learning Management's architecture while
 * it's still being rebuilt; remove this file and its one caller (see
 * ui/views/LearningManagementView.js's "Developer Utilities" section)
 * before shipping to real teachers.
 *
 * Deliberately kept in its own file, separate from
 * services/learningRecordTeacherService.js (a real, production
 * service), so removal later is a clean, contained deletion — one
 * file and one UI block, not logic threaded through code meant to
 * stay.
 *
 * Resets exactly one classroom's Learning Management data —
 * `classroom.learningRecord.subjects` — back to empty. Since every
 * LearningSubject owns its own Units (models/LearningUnit.js), which
 * in turn own their own Concepts (models/LearningConcept.js), and
 * every linkedCurriculumIndexId/linkedCurriculumUnitId reference
 * lives on those same objects (see
 * services/curriculumLinkingService.js), clearing this one array
 * removes all of it in one step: Subjects, Units, Concepts, and
 * curriculum links together, with nothing left orphaned.
 *
 * Deliberately does NOT touch:
 *   - classroom.teams (students, attendance) — a different module
 *   - classroom.curriculumAssignment — the older Library-assignment
 *     field, set at classroom creation; a classroom detail, not
 *     Learning Management data
 *   - the teacher's own Curriculum Indexes
 *     (services/curriculumIndexRepository.js) — those are a
 *     teacher-level asset, reusable across classrooms, not owned by
 *     any single classroom; resetting one classroom's Learning
 *     Management must never delete the curricula themselves
 *   - anything else on the classroom object
 *
 * Mutates in memory only — matches this app's own established
 * convention (see services/learningRecordTeacherService.js and
 * others): the caller is responsible for calling
 * services/workspaceService.js's save() afterward.
 */

export function resetLearningManagementData(classroom) {
  classroom.learningRecord.subjects = [];
}
