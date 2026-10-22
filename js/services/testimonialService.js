/**
 * services/testimonialService.js
 *
 * STUDENT-FACING. The ONE function anything under ui/student-portal/
 * (or services/studentPortalDataService.js, the Student Portal's own
 * single data-access seam) may ever call for this feature —
 * getPublishedTestimonialsForStudent() below. It is structurally unable
 * to ever read a private comment:
 *   - It never imports services/commentService.js or
 *     repositories/firestoreStudentCommentsRepository.js at all,
 *     anywhere in this file — there is no code path here that could
 *     reach the studentComments collection even by mistake.
 *   - It only ever calls repositories/firestoreTestimonialsRepository.js's
 *     own listPublishedTestimonialsForStudent() — the one function in
 *     that repository that filters to `published == true` directly in
 *     its own Firestore query (not just in application code
 *     afterward), matching firestore.rules's own read rule for this
 *     collection.
 *   - Every raw result is passed through
 *     services/testimonialBuilder.js's own selectPublicTestimonialFields()
 *     before ever being returned — a last-line allowlist that strips
 *     anything beyond {id, studentId, text, workItemLabel,
 *     publishedAt}, even if the raw document somehow carried more.
 *
 * `firestoreTestimonialsRepository.js` and `studentAuthService.js` are
 * deliberately dynamically (not statically) imported — both
 * transitively touch the Firebase browser-CDN, which only resolves in
 * a real browser (see services/studentEventService.js's own header
 * comment for this exact, already-established pattern and why it
 * matters: a static top-level import of either would make simply
 * IMPORTING this file fail under plain Node, breaking
 * `node --test` for any test that only needs the pure half of this
 * feature). The `overrides` parameter exists for exactly that testing
 * need — see tests/services/testimonialService.test.js: a test passes
 * a fake `repo`/`getDb` so this function's own selection logic can be
 * verified with zero network access and zero real Firestore.
 */

import { selectPublicTestimonialFields } from './testimonialBuilder.js';

async function defaultGetDb() {
  const studentDeviceService = await import('./studentDeviceService.js');
  const activeProfile = studentDeviceService.getActiveProfile();
  if (!activeProfile) return null;

  const slotIndex = studentDeviceService.getSlotForStudent(activeProfile.studentId);
  if (slotIndex === null) return null;

  const studentAuthService = await import('./studentAuthService.js');
  await studentAuthService.ensureAnonymousSignIn(slotIndex);
  return studentAuthService.getFirestoreForSlot(slotIndex);
}

/**
 * Every PUBLISHED testimonial for one student, safe to show on their
 * public profile or their own Student Portal — never a private
 * comment, never an unpublished testimonial, and never any field
 * beyond testimonialBuilder.js's own PUBLIC_TESTIMONIAL_FIELDS
 * allowlist, no matter what the underlying query returns.
 */
export async function getPublishedTestimonialsForStudent(classroomId, studentId, overrides = {}) {
  const repo = overrides.repo || (await import('../repositories/firestoreTestimonialsRepository.js'));
  const getDb = overrides.getDb || defaultGetDb;

  const db = await getDb();
  if (!db) return [];

  const raw = await repo.listPublishedTestimonialsForStudent(db, classroomId, studentId);
  return raw.map(selectPublicTestimonialFields);
}
