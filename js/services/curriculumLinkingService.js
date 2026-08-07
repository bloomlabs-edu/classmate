/**
 * services/curriculumLinkingService.js
 *
 * KNOWN FUTURE CHANGE — not yet implemented, deliberately deferred:
 * this file currently *copies* every Unit onto the Subject at
 * assignment time (buildUnitsFromCurriculumIndex(), below). The
 * agreed direction is to replace this with a live reference instead —
 * "Curriculum structure is shared. Teacher work is owned by the
 * classroom." — where a Subject stores only its
 * `linkedCurriculumIndexId`, Units are resolved from the Curriculum
 * Index at read time rather than duplicated, and Concepts resolve
 * from those Units the same way. Curriculum evolution should
 * eventually be handled by curriculum *versioning* (an existing
 * classroom stays on the version it was assigned to until a teacher
 * explicitly upgrades it), not by each Subject holding its own frozen
 * copy of Units. Versioning itself is out of scope for now; the
 * requirement is only that today's copy-based approach not make that
 * later move harder than it has to be. This change is intentionally
 * deferred until Concepts and Resources are being built, since that's
 * the point where the copy-vs-reference decision actually has teeth —
 * revisit the internal representation there, not before.
 *
 * The data flow this backs, verified and unchanged from the intended
 * design: Subject -> Assigned Curriculum -> Units -> Concepts. A
 * Subject does not own its own Units independent of a curriculum — it
 * has none until a curriculum is assigned, and every Unit it then has
 * is derived from that curriculum's own data, not hand-authored or
 * hardcoded on the Subject itself.
 *
 * Reverted, per explicit product decision: creating a Subject and
 * assigning it a curriculum are one combined step again, not two
 * separate ones. "+ Add Subject" (see
 * ui/components/AddSubjectModal.js) now runs Choose Subject -> Choose
 * Curriculum -> the Subject is created only once both are chosen (via
 * createSubjectWithCurriculum(), below) — this avoids an "incomplete"
 * Subject existing with no curriculum at all. If a teacher cancels
 * curriculum selection partway through, nothing is created.
 * ui/components/AssignCurriculumModal.js and its "no curriculum
 * assigned" path (see ui/components/CurriculumMetadataLine.js) still
 * exist and are still used, but only defensively now — for a Subject
 * whose Curriculum Index was later deleted, or a genuinely legacy
 * Subject predating this change, not as part of the normal creation
 * flow anymore.
 *
 * Per the finalized architecture: Curriculum Management owns
 * Curriculum/Parts/Units; Concept Builder (not yet built) is the only
 * thing that will ever create Concepts. Assigning a curriculum
 * creates every Unit immediately — every one of them with
 * `concepts: []` — and creates nothing at the Concept level, on
 * purpose, not as a gap to fill in later.
 *
 * This is deliberately additive, not a replacement for
 * services/curriculumLibraryService.js's own existing
 * materializeUnitAndConcept() + classroom.curriculumAssignment path.
 * That mechanism links a classroom to an officially *published*
 * curriculum from the moderated Library, lazily creating Units/
 * Concepts as a teacher browses. This one assigns a teacher's own,
 * possibly-still-draft Curriculum Index to a Subject, eagerly, since a
 * Curriculum Index's full Units list already exists in one place at
 * assignment time — there's no browsing-driven reason to create them
 * lazily. The two mechanisms serve genuinely different sources and
 * neither replaces the other.
 */

import * as learningRecordService from './learningRecordService.js';
import { createLearningSubject } from '../models/LearningSubject.js';
import { createLearningUnit } from '../models/LearningUnit.js';

/** Whether this classroom already has a Subject with this specific Curriculum Index assigned — what keeps the same curriculum from being assigned twice. */
export function isCurriculumIndexLinked(classroom, curriculumIndexId) {
  return learningRecordService.getSubjects(classroom).some((subject) => subject.linkedCurriculumIndexId === curriculumIndexId);
}

/**
 * "Assign Curriculum"'s own data: given a Subject's own canonical
 * `subjectId` (e.g. "mathematics" — see
 * services/subjectIdentityService.js for how that id was assigned),
 * which of the teacher's own Curriculum Indexes could back it?
 * Compares `subjectId === subjectId` only — never display text. This
 * is the actual fix for a real, confirmed bug: two independently-typed
 * "subject" text fields ("Maths" in Learning Management, "Mathematics"
 * in Curriculum Management) were being compared as strings, so a
 * curriculum that visibly existed and was fully ready never matched.
 * The fix isn't a smarter string comparison — it's that this function
 * no longer receives or looks at subject text at all. Excludes
 * anything already assigned to another Subject in this classroom, so
 * an already-used curriculum is never offered again.
 */
export function findAvailableCurriculumIndexesForSubject(classroom, allCurriculumIndexes, subjectId) {
  return allCurriculumIndexes.filter(
    (index) => index.curriculum.subjectId === subjectId && !isCurriculumIndexLinked(classroom, index.id)
  );
}

function buildUnitsFromCurriculumIndex(curriculumIndex) {
  // Not a silent workaround for the reported crash — a Curriculum
  // Index missing `units` or `parts` entirely is a real, honest error
  // condition (almost certainly a document predating the current
  // schema guarantee — see services/curriculumIndexRepository.js's
  // createIndex(), which has always initialized both together). This
  // throws a clear, specific message naming exactly which Curriculum
  // Index and which field, instead of letting `.map()` on `undefined`
  // produce an opaque "Cannot read properties of undefined" with no
  // indication of which document or field caused it.
  if (!Array.isArray(curriculumIndex.parts) || !Array.isArray(curriculumIndex.units)) {
    throw new Error(
      `Curriculum Index "${curriculumIndex.id}" (${curriculumIndex.curriculum?.name ?? 'unknown'}) is missing its parts/units arrays \u2014 this looks like a document created before the current schema, not a bug in this function. It cannot be assigned until that's resolved.`
    );
  }

  const partNameById = new Map(curriculumIndex.parts.map((part) => [part.id, part.name]));
  const hasMultipleParts = curriculumIndex.parts.length > 1;

  // TEMPORARY DIAGNOSTIC — tracing whether THIS function, in THIS
  // deployed session, actually has the fixed logic or not. See this
  // project's own investigation into the partName/undefined Firestore
  // rejection bug.
  console.error(`[buildUnitsFromCurriculumIndex] TEMPORARY DIAGNOSTIC \u2014 curriculumIndex.parts.length =`, curriculumIndex.parts.length, `hasMultipleParts =`, hasMultipleParts);

  return curriculumIndex.units.map((unit) => {
    const args = {
      title: unit.title,
      linkedCurriculumUnitId: unit.id,
      number: unit.number ?? null,
    };
    // Only included at all when there's a real value to give it — see
    // createLearningUnit()'s own header comment for why passing
    // `partName: undefined` explicitly here was the actual root cause
    // of a real production bug (Firestore rejects any field whose
    // value is `undefined`).
    if (hasMultipleParts) {
      args.partName = partNameById.get(unit.partId);
    }
    console.error(`[buildUnitsFromCurriculumIndex] TEMPORARY DIAGNOSTIC \u2014 args passed to createLearningUnit() for unit "${unit.title}":`, `'partName' in args?`, 'partName' in args, JSON.stringify(args));
    const result = createLearningUnit(args);
    console.error(`[buildUnitsFromCurriculumIndex] TEMPORARY DIAGNOSTIC \u2014 result returned for unit "${unit.title}":`, `'partName' in result?`, 'partName' in result, JSON.stringify(result));
    return result;
  });
}

/**
 * Assigns a Curriculum Index to an *already-existing* Subject —
 * mutates that Subject in place, materializing every Unit from the
 * curriculum's own data (carrying `partName` only when the curriculum
 * has more than one real Part — a single-Part ("General") curriculum
 * produces Units with no `partName` at all, so Learning Management
 * never shows Part grouping a teacher never asked for).
 *
 * Atomic by construction: every Unit is built in memory first; only
 * once that's fully succeeded are `linkedCurriculumIndexId` and
 * `units` set on the Subject together, in one step. If anything
 * throws while building Units, the Subject is left completely
 * unchanged — it never ends up with a curriculum link but no Units,
 * or Units but no link.
 *
 * Does not check isCurriculumIndexLinked() itself — callers (see
 * ui/components/AssignCurriculumModal.js) are expected to have
 * already filtered an already-assigned Curriculum Index out of what's
 * offered, so assignment is never attempted twice in the first place.
 *
 * Kept and still used for the defensive "no curriculum assigned" path
 * (a legacy Subject, or one whose Curriculum Index was deleted after
 * assignment) — see ui/components/AssignCurriculumModal.js. The
 * normal creation flow (see createSubjectWithCurriculum(), below) no
 * longer goes through this function.
 */
export function assignCurriculumToSubject(classroom, subject, curriculumIndex) {
  const units = buildUnitsFromCurriculumIndex(curriculumIndex);
  subject.linkedCurriculumIndexId = curriculumIndex.id;
  subject.units = units;
  return subject;
}

/**
 * Creates a brand-new Subject with a curriculum already assigned, in
 * one atomic step — the reverted, combined workflow: Choose Subject
 * -> Choose Curriculum -> the Subject is created only once both are
 * chosen (see ui/components/AddSubjectModal.js). If the teacher
 * cancels curriculum selection, nothing is created at all, because
 * nothing is created until this function is actually called.
 *
 * `subjectId` is passed in explicitly (assigned by
 * services/subjectIdentityService.js at the moment the teacher chose
 * or typed the subject name) rather than copied from
 * `curriculumIndex.curriculum.subjectId` — by the time this runs,
 * findAvailableCurriculumIndexesForSubject() has already confirmed
 * they match, but the Subject's own identity is decided by what the
 * teacher chose for the Subject, not silently inferred from whichever
 * curriculum happened to get selected.
 *
 * Atomic the same way assignCurriculumToSubject() is: the complete
 * Subject — title, subjectId, curriculum link, and every Unit — is
 * built in memory first, using the model factory directly rather than
 * services/learningRecordTeacherService.js's own createSubject()
 * (which would push an incomplete Subject immediately). Only once
 * that's fully built is it pushed into
 * `classroom.learningRecord.subjects`, in one step. If Unit
 * construction throws, nothing has been added to the classroom's real
 * data yet.
 */
export function createSubjectWithCurriculum(classroom, subjectTitle, subjectId, curriculumIndex) {
  const units = buildUnitsFromCurriculumIndex(curriculumIndex);
  const subject = createLearningSubject({
    title: subjectTitle,
    subjectId,
    linkedCurriculumIndexId: curriculumIndex.id,
    units,
  });

  const learningRecord = classroom.learningRecord || (classroom.learningRecord = { subjects: [] });
  if (!learningRecord.subjects) learningRecord.subjects = [];
  learningRecord.subjects.push(subject);

  return subject;
}

/**
 * The Notebook Subject (services/notebookConfigService.js's own
 * `classroom.notebookConfig.subjects`) and the Learning Hub's own
 * Subject (`classroom.learningRecord.subjects`) are two genuinely
 * separate entities today, confirmed directly — neither references
 * the other by id anywhere in this codebase. Matching by name is the
 * only honest bridge available without inventing a formal link that
 * doesn't exist; if a teacher names them differently ("Science" vs.
 * "General Science"), this correctly finds nothing, rather than
 * guessing.
 *
 * Returns the real LearningUnit array for display in a "Learning
 * Context" picker (see ui/views/WorkRequestCreateView.js), or an
 * empty array if no matching Learning Hub Subject exists at all —
 * never an error, since a classroom legitimately may not have set up
 * Learning Hub at all.
 */
export function getUnitsForNotebookSubject(classroom, notebookSubjectName) {
  const learningSubject = (classroom.learningRecord?.subjects || []).find(
    (subject) => subject.title.trim().toLowerCase() === notebookSubjectName.trim().toLowerCase()
  );
  return learningSubject ? learningSubject.units || [] : [];
}
