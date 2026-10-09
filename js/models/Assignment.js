/**
 * models/Assignment.js
 *
 * One discrete, teacher-given learning task within an Assignment
 * Category (identified by `categoryId`) — a worksheet, graphic
 * organizer, case study, practice task, research task, project,
 * anything a teacher names. Originally mirrored models/Checkpoint.js's
 * own shape exactly (teacher-named, no curriculum-unit concept baked
 * in). `conceptIds` below is a deliberate, later departure from that
 * precedent — see its own field comment.
 *
 * Deliberately NOT "homework" — may be completed in class or at home;
 * this model has no location/timing concept at all, matching the
 * explicit product instruction not to equate the two.
 *
 * ---------------------------------------------------------------------
 * NOT the same thing as models/LearningActivity.js
 * ---------------------------------------------------------------------
 *
 * models/LearningActivity.js's own header comment calls itself "ClassMate's
 * own 'Assignment' abstraction" (per
 * docs/LEARNING_HUB_INTEGRATION_CONTRACT.md, which formally defines
 * `assignmentId = LearningActivity.id` for cross-product use). THIS
 * model shares that English word by coincidence of product naming, not
 * by design — it is a separate, Checkpoint-shaped, multi-aspect-rated
 * worksheet/task tracker (see models/AssignmentCategory.js's own
 * `aspects`), with no `activityId`, no Learning Hub launch capability,
 * and a different per-student tracking shape (an open ratings map, not
 * a single status enum). Both models independently link to the SAME
 * `models/LearningConcept.js` via `conceptIds` (see below) — that
 * shared Concept id is the only bridge between them; neither one
 * references the other directly, and nothing here should be read as
 * superseding or merging with LearningActivity.
 *
 * `records` is sparse, same convention as Checkpoint.records — see
 * models/StudentAssignmentRecord.js's own header comment.
 *
 * `order` is a plain integer a teacher can freely reassign — same
 * "display ordering only, never inferred" rule as Checkpoint.order.
 *
 * `conceptIds` — the same `conceptIds: []` convention already
 * established by models/Lesson.js, models/LessonPlan.js,
 * models/ChapterPlan.js, and models/Spark.js: a plain array of
 * classroom-local models/LearningConcept.js ids, resolved live at read
 * time (via services/learningRecordService.js's getConceptById()),
 * NEVER copied/denormalized here. Empty by default — linking an
 * Assignment to one or more Concepts is optional. The reverse
 * direction ("which Assignments reference this Concept") is
 * deliberately NOT a stored back-reference on the Concept — it's a
 * plain filter, see services/assignmentService.js's own
 * listAssignmentsForConcept() (mirrors services/sparkService.js's
 * identical `sparks.filter(s => s.conceptIds.includes(conceptId))`
 * pattern). Curriculum context (Subject/Unit) is never duplicated here
 * either — it's recovered by walking up from the linked Concept via
 * learningRecordService.findConcept(), the same way Lesson Plans
 * already do, so there is no parallel Assignment-owned taxonomy.
 *
 * `resourceUrl` — an optional plain link (e.g. a Google Drive/Docs/
 * Slides/Forms URL, a video, an external reading — anything, not only
 * a worksheet) a teacher can attach so students/co-teachers can open
 * the actual material this Assignment is about. Named generically on
 * purpose (NOT `worksheetUrl`, an earlier, narrower name this field
 * briefly had before this still-unshipped feature's own requirements
 * audit caught it — renamed at zero migration cost, since no
 * committed code or deployed classroom document has ever used the old
 * name). Deliberately NOT a file upload: this app has no file-storage
 * infrastructure anywhere (confirmed absent — no Firebase Storage, no
 * upload SDK), and inventing one was out of scope for this pass. A
 * link-only field mirrors models/Resource.js's own existing
 * 'external_link' type rather than building new infrastructure.
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

export function createAssignment({
  id,
  categoryId,
  title,
  description = '',
  givenDate,
  dueDate = '',
  order = 0,
  createdAt,
  records = [],
  conceptIds = [],
  resourceUrl = '',
} = {}) {
  return {
    id: id || generateId(),
    categoryId,
    title,
    description,
    givenDate: givenDate || getCurrentIsoDate(),
    dueDate,
    order,
    createdAt: createdAt || getCurrentIsoDate(),
    records,
    conceptIds,
    resourceUrl,
  };
}
