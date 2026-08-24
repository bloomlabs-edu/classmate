/**
 * services/adminAnalyticsService.js
 *
 * The read-side of the Admin Dashboard — the only file in this app that
 * ever reads the `admins` or `analyticsEvents` collections (see
 * firestore.rules: both are unreadable by anyone else). Kept
 * deliberately separate from services/analyticsEventService.js (the
 * write-side, imported broadly across the app) so that "who can read
 * aggregate usage data" stays a property of exactly one small file,
 * never accidentally imported into a teacher-facing view.
 *
 * "Total teachers"/"Total students" are computed over every
 * analyticsEvents document ever written; everything else here is
 * scoped to whatever `since` the caller passes in (see
 * ui/views/AdminDashboardView.js's Today/7 days/30 days toggle). This
 * runs one unfiltered query over the whole collection so both numbers
 * come from a single read — acceptable at today's usage volume, but
 * it is the one thing that will eventually need a Cloud
 * Function/scheduled aggregation instead, once the event log itself
 * grows large (see this feature's own PR notes for the full
 * reasoning).
 *
 * Student counts are an explicit approximation, not a real roster
 * scan: `class_session_started`/`point_awarded`/`point_deducted`
 * events each carry a `meta.rosterSize` snapshot (see
 * ui/views/TrackerView.js) captured at the moment they were logged;
 * this file takes the most recent one per classroomId and sums those.
 * A classroom that never fired one of those three event types simply
 * isn't counted — documented in the dashboard's own footnote, not
 * hidden.
 */

import {
  getFirestore,
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  orderBy,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFirebaseApp } from './firebaseApp.js';

const ROSTER_SNAPSHOT_TYPES = ['class_session_started', 'point_awarded', 'point_deducted'];

function db() {
  return getFirestore(getFirebaseApp());
}

/**
 * Treats "permission denied" (a non-admin's own uid has no admins/{uid}
 * document) identically to "not found" — the caller only ever needs a
 * boolean, never a reason.
 */
export async function checkIsAdmin(uid) {
  if (!uid) return false;
  try {
    const snap = await getDoc(doc(db(), 'admins', uid));
    return snap.exists();
  } catch (error) {
    return false;
  }
}

function toDate(value) {
  // Firestore Timestamp -> JS Date. Defensive: a document read back
  // an instant after being written (before the server timestamp has
  // resolved in a local cache) could momentarily lack this — such a
  // document is skipped rather than crashing the whole dashboard.
  return value && typeof value.toDate === 'function' ? value.toDate() : null;
}

/**
 * Latest rosterSize per classroomId, from whichever of the 3
 * roster-snapshot event types occurs most recently in `events`.
 */
function latestRosterSizeByClassroom(events) {
  const latestAt = new Map();
  const rosterSize = new Map();

  events.forEach((event) => {
    if (!ROSTER_SNAPSHOT_TYPES.includes(event.type)) return;
    if (!event.classroomId || typeof event.meta?.rosterSize !== 'number') return;

    const seenAt = latestAt.get(event.classroomId);
    if (!seenAt || event.createdAt > seenAt) {
      latestAt.set(event.classroomId, event.createdAt);
      rosterSize.set(event.classroomId, event.meta.rosterSize);
    }
  });

  return rosterSize;
}

function sumValues(map) {
  let total = 0;
  map.forEach((value) => {
    total += value;
  });
  return total;
}

function countByType(events, type) {
  return events.filter((event) => event.type === type).length;
}

function distinctUidCount(events, type) {
  return new Set(events.filter((event) => event.type === type).map((event) => event.uid)).size;
}

/**
 * One entry per calendar day from `since` (inclusive) to today
 * (inclusive), counting every event of any type on that day — filled
 * with 0 for days with no activity, so the chart never has gaps.
 */
function buildDailySeries(events, since) {
  const countByDay = new Map();
  events.forEach((event) => {
    const dayKey = event.createdAt.toISOString().slice(0, 10);
    countByDay.set(dayKey, (countByDay.get(dayKey) || 0) + 1);
  });

  const series = [];
  const cursor = new Date(since.getFullYear(), since.getMonth(), since.getDate());
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  while (cursor <= today) {
    const dayKey = cursor.toISOString().slice(0, 10);
    series.push({ date: dayKey, count: countByDay.get(dayKey) || 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return series;
}

/**
 * @param {Date} since - start of the selected time range (Today/7
 *   days/30 days — see AdminDashboardView.js). Only affects the
 *   windowed fields below; totalTeachers/totalStudents are always
 *   all-time.
 */
export async function getDashboardStats(since) {
  const snapshot = await getDocs(query(collection(db(), 'analyticsEvents'), orderBy('createdAt', 'asc')));

  const allEvents = snapshot.docs
    .map((docSnap) => {
      const data = docSnap.data();
      const createdAt = toDate(data.createdAt);
      return createdAt ? { ...data, createdAt } : null;
    })
    .filter(Boolean);

  const windowedEvents = allEvents.filter((event) => event.createdAt >= since);

  return {
    totalTeachers: distinctUidCount(allEvents, 'teacher_signed_in'),
    totalStudents: sumValues(latestRosterSizeByClassroom(allEvents)),
    activeTeachers: distinctUidCount(windowedEvents, 'teacher_signed_in'),
    activeStudents: sumValues(latestRosterSizeByClassroom(windowedEvents)),
    classesCreated: countByType(windowedEvents, 'class_created'),
    classSessionsConducted: countByType(windowedEvents, 'class_session_started'),
    lessonsOpened: countByType(windowedEvents, 'lesson_opened'),
    assessmentsCompleted: countByType(windowedEvents, 'assessment_completed'),
    pointsAwarded: countByType(windowedEvents, 'point_awarded'),
    pointsDeducted: countByType(windowedEvents, 'point_deducted'),
    chartSeries: buildDailySeries(windowedEvents, since),
  };
}
