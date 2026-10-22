/**
 * repositories/firestoreTestimonialsRepository.js
 *
 * The only file that knows the path shape for
 * classrooms/{classroomId}/testimonials/{testimonialId} — a dedicated
 * collection, genuinely separate from
 * repositories/firestoreStudentCommentsRepository.js's own
 * studentComments collection (see models/Testimonial.js's own header
 * comment for why), so firestore.rules can grant classroom-wide
 * (teacher OR student-device) read access to a PUBLISHED testimonial
 * without that same rule ever being able to reach a private comment.
 *
 * Two call shapes, matching the two trust levels firestore.rules
 * itself enforces:
 *   - publishTestimonial/setPublished/listTestimonialsForStudent (incl.
 *     unpublished) are TEACHER-ONLY writes/reads — always via the
 *     teacher's own default-app Firestore instance, exactly like
 *     firestoreStudentCommentsRepository.js.
 *   - listPublishedTestimonialsForStudent is the ONE function a
 *     student-facing code path may call — it queries this collection
 *     ONLY, filtered to `published == true`, and is the sole function
 *     services/testimonialService.js's own getPublishedTestimonialsForStudent()
 *     (the function this app's student-facing views actually call) is
 *     allowed to use. It still runs on whichever Firestore instance the
 *     caller passes in (a student's own per-slot instance, in
 *     practice), matching firestore.rules's own broader, student-
 *     reachable read rule for this one case.
 */

import {
  collection,
  doc,
  setDoc,
  updateDoc,
  getDoc,
  getDocs,
  query,
  where,
  getFirestore,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFirebaseApp } from '../services/firebaseApp.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

function teacherDb() {
  return getFirestore(getFirebaseApp());
}

function testimonialsCollection(db, classroomId) {
  return collection(db, 'classrooms', classroomId, 'testimonials');
}

function testimonialDoc(db, classroomId, testimonialId) {
  return doc(db, 'classrooms', classroomId, 'testimonials', testimonialId);
}

/** Publishes a new testimonial — `testimonial` is already a fully-shaped object from models/Testimonial.js's own createTestimonial(). Teacher-only (see firestore.rules's own create rule for this collection). */
export async function publishTestimonial(classroomId, testimonial) {
  await setDoc(testimonialDoc(teacherDb(), classroomId, testimonial.id), testimonial);
  return testimonial;
}

/** Flips `published` — true to (re)publish, false to unpublish. Never touches `text`/`studentId`/`sourceCommentId` (firestore.rules enforces this at the write level too). Teacher-only. */
export async function setPublished(classroomId, testimonialId, published) {
  await updateDoc(testimonialDoc(teacherDb(), classroomId, testimonialId), {
    published,
    updatedAt: getCurrentIsoDate(),
  });
}

export async function getTestimonialById(classroomId, testimonialId) {
  const snapshot = await getDoc(testimonialDoc(teacherDb(), classroomId, testimonialId));
  return snapshot.exists() ? snapshot.data() : null;
}

/** Every testimonial for one student, any publish state — teacher-only (Student Profile's own "Testimonials" management section). */
export async function listTestimonialsForStudent(classroomId, studentId) {
  const snapshot = await getDocs(query(testimonialsCollection(teacherDb(), classroomId), where('studentId', '==', studentId)));
  return snapshot.docs.map((d) => d.data()).sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
}

/**
 * THE one student-reachable read in this whole feature. `db` is passed
 * in explicitly (mirrors firestoreStudentGoalsRepository.js's own
 * listGoalsForStudent()) — a real caller passes the student's own
 * per-slot Firestore instance (services/studentAuthService.js's
 * getFirestoreForSlot()), never the teacher's default-app instance, so
 * request.auth on the wire is genuinely that student device's own
 * identity. Filters to `published == true` directly in the query
 * itself (not just in application code afterward) — matching
 * firestore.rules's own read rule for this collection, so a listing
 * query can never even attempt to return an unpublished document.
 */
export async function listPublishedTestimonialsForStudent(db, classroomId, studentId) {
  const snapshot = await getDocs(
    query(testimonialsCollection(db, classroomId), where('studentId', '==', studentId), where('published', '==', true))
  );
  return snapshot.docs.map((d) => d.data());
}
