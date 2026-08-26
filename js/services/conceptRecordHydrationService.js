/**
 * services/conceptRecordHydrationService.js
 *
 * The async half of the Phase N storage migration's read-side
 * compatibility strategy — see services/conceptRecordMerge.js for the
 * pure merge logic this wraps.
 *
 * Fallback order, across the two functions below working together:
 *   1. A record actually present in classrooms/{id}/studentConceptRecords
 *      — fetched here, merged onto Student.learningRecord in memory.
 *   2. Whatever the legacy embedded student.learningRecord[conceptId]
 *      already held — untouched, since mergeConceptRecordsIntoClassroom()
 *      only ever overwrites keys it actually received new data for.
 *   3. learningRecordService.getStudentConceptRecord()'s own existing
 *      default-record contract, for a conceptId neither storage has
 *      anything for — also untouched, since that function's own
 *      "return a default rather than undefined" behavior already
 *      handles a missing map entry, before or after this migration.
 *
 * Deliberately NOT called from anywhere broad/global
 * (services/workspaceService.js's own getClassroomOnce()/
 * subscribeToClassroom(), services/studentPortalDataService.js's own
 * loadCurrentStudentAndClassroom()) — both would add a Firestore read
 * to every single classroom load across the whole app, most of which
 * have nothing to do with Learning Record. Instead, called explicitly,
 * only from the small number of real consumers that actually read
 * per-student concept data — see each function's own call sites.
 */

import * as studentDeviceService from './studentDeviceService.js';
import * as studentAuthService from './studentAuthService.js';
import * as conceptRecordsRepository from '../repositories/firestoreStudentConceptRecordsRepository.js';
import { mergeConceptRecordsIntoClassroom } from './conceptRecordMerge.js';

/**
 * Teacher-side hydration — fetches every student's record for a
 * bounded set of concept ids (a single concept for
 * ConceptWorkspaceView.js's Student Progress tab; one Lesson's own
 * executed concept ids for TimetableView.js's feedback panel) via the
 * teacher's own default-app Firestore instance, then merges them onto
 * `classroom` in place.
 *
 * A no-op (no read at all) for an empty conceptIds array, so a caller
 * with nothing yet to hydrate (e.g. a Lesson with zero executed
 * concepts) never issues a pointless query.
 */
export async function hydrateConceptRecordsForConcepts(classroom, conceptIds) {
  if (!conceptIds || conceptIds.length === 0) return classroom;

  const records = await conceptRecordsRepository.listRecordsForConcepts(classroom.id, conceptIds);
  return mergeConceptRecordsIntoClassroom(classroom, records);
}

/**
 * Student-side hydration — fetches every record belonging to ONE
 * specific student, across the whole classroom (bounded by how many
 * concepts that one student has personally touched, never by the
 * classroom's full syllabus — see the repository's own
 * listRecordsForStudent() header comment), via that student's own
 * per-slot Firestore instance, then merges them onto `classroom` in
 * place.
 *
 * Called explicitly from services/studentPortalDataService.js's own
 * getConceptFeedbackForLesson() and
 * ui/student-portal/views/StudentLearningView.js — the only two real
 * per-student concept-record readers today.
 *
 * A silent no-op (returns `classroom` unchanged) if this student's
 * device has no approved profile slot — mirrors this app's own
 * established "degrade quietly, never throw" convention for a session
 * that's somehow already invalid by the time this runs.
 */
export async function hydrateConceptRecordsForStudent(classroom, student) {
  const slotIndex = studentDeviceService.getSlotForStudent(student.id);
  if (slotIndex === null) return classroom;

  const db = studentAuthService.getFirestoreForSlot(slotIndex);
  const uid = await studentAuthService.ensureAnonymousSignIn(slotIndex);

  const records = await conceptRecordsRepository.listRecordsForStudent(db, classroom.id, { uid });
  return mergeConceptRecordsIntoClassroom(classroom, records);
}
