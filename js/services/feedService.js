/**
 * services/feedService.js
 *
 * The single service both StudentFeedView.js (student) and
 * FeedModerationView.js (teacher) call for everything Class Feed —
 * mirrors studentGoalsService.js's own exact split: student writes go
 * through their own per-slot Firestore instance (so request.auth.uid
 * on the wire is genuinely their own linked identity), teacher
 * actions go through the teacher's own default-app instance, already
 * trusted via memberUids like every other classroom-scoped write.
 */

import * as studentAuthService from './studentAuthService.js';
import * as studentDeviceService from './studentDeviceService.js';
import * as feedRepository from '../repositories/firestoreFeedRepository.js';

/**
 * Every post for the current student's own classroom, newest-first,
 * with teacher-removed posts and other students' still-pending media
 * filtered out — a student sees their OWN pending media (with a
 * clear "awaiting approval" state, handled by the view), never
 * anyone else's.
 */
export async function getFeedForCurrentStudent() {
  const activeProfile = studentDeviceService.getActiveProfile();
  if (!activeProfile) return [];

  const slotIndex = studentDeviceService.getSlotForStudent(activeProfile.studentId);
  if (slotIndex === null) return [];

  const db = studentAuthService.getFirestoreForSlot(slotIndex);
  const authForSlot = studentAuthService.getAuthForSlot(slotIndex);

  console.log('[FEED-AUTH-DIAG] before ensureAnonymousSignIn', {
    slotIndex,
    classroomId: activeProfile.classroomId,
    appName: authForSlot.app?.name ?? null,
    authCurrentUserExists: !!authForSlot.currentUser,
    authCurrentUserUid: authForSlot.currentUser?.uid ?? null,
  });

  const uid = await studentAuthService.ensureAnonymousSignIn(slotIndex);

  const authAfter = studentAuthService.getAuthForSlot(slotIndex);
  console.log('[FEED-AUTH-DIAG] after ensureAnonymousSignIn', {
    slotIndex,
    returnedUid: uid,
    authCurrentUserExists: !!authAfter.currentUser,
    authCurrentUserUid: authAfter.currentUser?.uid ?? null,
    uidMatchesAuthCurrentUser: uid === (authAfter.currentUser?.uid ?? null),
  });

  console.log('[FEED-AUTH-DIAG] firestore/app identity', {
    slotIndex,
    firestoreAppName: db.app?.name ?? null,
    authAppName: authAfter.app?.name ?? null,
    sameAppInstance: db.app === authAfter.app,
    projectId: db.app?.options?.projectId ?? null,
  });

  console.log('[FEED-AUTH-DIAG] before listPosts', {
    slotIndex,
    classroomId: activeProfile.classroomId,
    path: `classrooms/${activeProfile.classroomId}/feedPosts`,
  });

  let posts;
  try {
    posts = await feedRepository.listPosts(db, activeProfile.classroomId);
  } catch (error) {
    console.error('[FEED-AUTH-DIAG] listPosts failed', {
      slotIndex,
      classroomId: activeProfile.classroomId,
      errorCode: error.code ?? null,
      errorMessage: error.message ?? null,
      authCurrentUserUidAtFailure: studentAuthService.getAuthForSlot(slotIndex).currentUser?.uid ?? null,
    });
    throw error;
  }

  return posts.filter((post) => {
    if (post.removedByTeacher) return false;
    if (post.media && post.media.status === 'pending' && post.studentId !== activeProfile.studentId) return false;
    if (post.media && post.media.status === 'rejected' && post.studentId !== activeProfile.studentId) return false;
    return true;
  });
}

/**
 * Creates a free-form or ClassMate-generated post as the current
 * student. `source`, when present, is shaped exactly like a
 * StudentEvent's own { type, payload } (see
 * config/studentEventNavigation.js) — reused, not reinvented.
 *
 * Returns the new postId on success, or null on a genuine failure
 * (caller should treat null as "did not persist," matching the same
 * explicit convention submitGoalForCurrentStudent() already uses).
 */
export async function createPostAsCurrentStudent({ text, source = null }) {
  const activeProfile = studentDeviceService.getActiveProfile();
  if (!activeProfile) return null;

  const slotIndex = studentDeviceService.getSlotForStudent(activeProfile.studentId);
  if (slotIndex === null) return null;

  const db = studentAuthService.getFirestoreForSlot(slotIndex);
  const uid = await studentAuthService.ensureAnonymousSignIn(slotIndex);

  try {
    return await feedRepository.createPost(db, {
      classroomId: activeProfile.classroomId,
      studentId: activeProfile.studentId,
      uid,
      authorName: activeProfile.studentName,
      text,
      source,
    });
  } catch (error) {
    console.error('[feedService] createPostAsCurrentStudent() failed \u2014 the write was rejected:', error);
    return null;
  }
}

export async function toggleReactionAsCurrentStudent(postId, isReacting) {
  const activeProfile = studentDeviceService.getActiveProfile();
  if (!activeProfile) return false;

  const slotIndex = studentDeviceService.getSlotForStudent(activeProfile.studentId);
  if (slotIndex === null) return false;

  const db = studentAuthService.getFirestoreForSlot(slotIndex);
  const uid = await studentAuthService.ensureAnonymousSignIn(slotIndex);

  try {
    await feedRepository.toggleReaction(db, activeProfile.classroomId, postId, uid, isReacting);
    return true;
  } catch (error) {
    console.error('[feedService] toggleReactionAsCurrentStudent() failed:', error);
    return false;
  }
}

/** Only the post's own author can succeed here — firestore.rules enforces this, not this function. */
export async function deleteOwnPost(postId) {
  const activeProfile = studentDeviceService.getActiveProfile();
  if (!activeProfile) return false;

  const slotIndex = studentDeviceService.getSlotForStudent(activeProfile.studentId);
  if (slotIndex === null) return false;

  const db = studentAuthService.getFirestoreForSlot(slotIndex);

  try {
    await feedRepository.deletePost(db, activeProfile.classroomId, postId);
    return true;
  } catch (error) {
    console.error('[feedService] deleteOwnPost() failed:', error);
    return false;
  }
}

export async function addCommentAsCurrentStudent(postId, text) {
  const activeProfile = studentDeviceService.getActiveProfile();
  if (!activeProfile) return null;

  const slotIndex = studentDeviceService.getSlotForStudent(activeProfile.studentId);
  if (slotIndex === null) return null;

  const db = studentAuthService.getFirestoreForSlot(slotIndex);
  const uid = await studentAuthService.ensureAnonymousSignIn(slotIndex);

  try {
    return await feedRepository.addComment(db, activeProfile.classroomId, postId, {
      studentId: activeProfile.studentId,
      uid,
      authorName: activeProfile.studentName,
      text,
    });
  } catch (error) {
    console.error('[feedService] addCommentAsCurrentStudent() failed:', error);
    return null;
  }
}

export async function listCommentsForCurrentStudent(postId) {
  const activeProfile = studentDeviceService.getActiveProfile();
  if (!activeProfile) return [];

  const slotIndex = studentDeviceService.getSlotForStudent(activeProfile.studentId);
  if (slotIndex === null) return [];

  const db = studentAuthService.getFirestoreForSlot(slotIndex);
  return feedRepository.listComments(db, activeProfile.classroomId, postId);
}

export async function deleteOwnComment(postId, commentId) {
  const activeProfile = studentDeviceService.getActiveProfile();
  if (!activeProfile) return false;

  const slotIndex = studentDeviceService.getSlotForStudent(activeProfile.studentId);
  if (slotIndex === null) return false;

  const db = studentAuthService.getFirestoreForSlot(slotIndex);

  try {
    await feedRepository.deleteComment(db, activeProfile.classroomId, postId, commentId);
    return true;
  } catch (error) {
    console.error('[feedService] deleteOwnComment() failed:', error);
    return false;
  }
}

// --- Teacher-side, all via the teacher's own default-app instance ---

export async function getFeedForClassroom(classroomId) {
  const posts = await feedRepository.listPosts(feedRepository.teacherFirestore(), classroomId);
  return posts.filter((post) => !post.removedByTeacher);
}

export function getPendingMediaPosts(posts) {
  return posts.filter((post) => post.media && post.media.status === 'pending');
}

export async function approveMedia(classroomId, postId) {
  await feedRepository.setMediaStatus(classroomId, postId, 'approved');
}

export async function rejectMedia(classroomId, postId) {
  await feedRepository.setMediaStatus(classroomId, postId, 'rejected');
}

export async function removePostAsTeacher(classroomId, postId) {
  await feedRepository.removePostAsTeacher(classroomId, postId);
}

/**
 * A teacher's own reaction toggle — reuses the exact same
 * feedRepository.toggleReaction() the student path already uses, via
 * the teacher's own already-trusted instance. The existing Firestore
 * rule for reactorUids/commentCount is deliberately not
 * author-restricted (see firestore.rules's own comment on this), so
 * this needed no rules change at all — only this one missing
 * wrapper, matching removePostAsTeacher()'s own established pattern.
 */
export async function toggleReactionAsTeacher(classroomId, postId, uid, isReacting) {
  try {
    await feedRepository.toggleReaction(feedRepository.teacherFirestore(), classroomId, postId, uid, isReacting);
    return true;
  } catch (error) {
    console.error('[feedService] toggleReactionAsTeacher() failed:', error);
    return false;
  }
}

/**
 * A teacher's own comment — reuses the exact same
 * feedRepository.addComment() the student path already uses.
 * `uid` must be the teacher's own real, authenticated uid, matching
 * the existing Firestore rule (`request.resource.data.uid ==
 * request.auth.uid`), same as createPostAsTeacher()'s own uid
 * requirement.
 */
export async function addCommentAsTeacher(classroomId, postId, { uid, authorName, text }) {
  try {
    return await feedRepository.addComment(feedRepository.teacherFirestore(), classroomId, postId, {
      studentId: null,
      uid,
      authorName,
      text,
    });
  } catch (error) {
    console.error('[feedService] addCommentAsTeacher() failed:', error);
    return null;
  }
}

/**
 * Creates a teacher-authored post — reuses the exact same
 * feedRepository.createPost() write path
 * createPostAsCurrentStudent() already uses, and the exact same
 * teacherFirestore() instance every other teacher-side write in this
 * file already uses. `studentId` is null (a teacher-authored post
 * has no associated student); `uid` must be the teacher's own real,
 * authenticated uid — the existing Firestore rule
 * (`request.resource.data.uid == request.auth.uid`) requires it, so
 * this is not a value this function can invent.
 *
 * Returns the new postId on success, or null on a genuine failure —
 * matching createPostAsCurrentStudent()'s own explicit convention.
 */
export async function createPostAsTeacher({ classroomId, uid, authorName, text }) {
  try {
    return await feedRepository.createPost(feedRepository.teacherFirestore(), {
      classroomId,
      studentId: null,
      uid,
      authorName,
      text,
    });
  } catch (error) {
    console.error('[feedService] createPostAsTeacher() failed \u2014 the write was rejected:', error);
    return null;
  }
}

export async function listCommentsForTeacher(classroomId, postId) {
  return feedRepository.listComments(feedRepository.teacherFirestore(), classroomId, postId);
}

export async function removeCommentAsTeacher(classroomId, postId, commentId) {
  await feedRepository.deleteComment(feedRepository.teacherFirestore(), classroomId, postId, commentId);
}
