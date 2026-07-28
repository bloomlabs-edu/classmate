/**
 * ui/router.js
 *
 * A small hash-based router — no library, matching the project's
 * "vanilla only" constraint. Recognises:
 *   #/                                        -> Bloom Labs landing page (product picker)
 *   #/teacher                                 -> Classroom Tracker home (or welcome, decided by main.js) — the
 *                                                 existing teacher app's own entry point, unchanged in behavior
 *   #/student/{section?}                      -> Student Portal (journey/team/profile; journey if omitted)
 *   #/classroom/{id}                          -> dashboard (the classroom's landing page)
 *   #/classroom/{id}/class-mode               -> tracker (today's Class Mode — unchanged, just relocated)
 *   #/classroom/{id}/settings/{section?}      -> settings
 *   #/classroom/{id}/setup/{step?}            -> setup wizard (no step = overview)
 *   #/classroom/{id}/student/{studentId}/{tab?} -> student profile
 *   #/classroom/{id}/activities               -> learning activities list
 *   #/classroom/{id}/activities/{activityId}  -> one activity's roster
 *   #/classroom/{id}/notebooks                                       -> notebook tracker list (Subject × Notebook Type)
 *   #/classroom/{id}/notebooks/{subjectId}/{typeId}/{dateKey?}        -> register view (today if dateKey omitted)
 *   #/classroom/{id}/notebooks/{subjectId}/{typeId}/timeline/{yearMonth?} -> timeline view (current month if omitted)
 *   #/classroom/{id}/recognition/{period?}/{categoryId?}     -> recognition screen (defaults resolved by the view itself)
 *   #/curriculum-management                   -> Curriculum Management (admin tool — create/review/save Curriculum
 *                                                 Packs; not classroom-scoped, since a pack is shared across every
 *                                                 classroom, not owned by one — see ui/views/CurriculumManagementView.js)
 * Deep links work on refresh since the route is derived from the URL,
 * not from in-memory state.
 *
 * Bloom Labs platform note: the bare root used to mean "Classroom
 * Tracker home" (back when this was the only product). It now means
 * the platform's own landing page, and the teacher app's home has its
 * own explicit address (#/teacher) instead — everything below that,
 * including every classroom/{id}/... route, is completely unchanged.
 * A deep link straight to #/teacher or #/classroom/{id}/... still
 * skips the landing page entirely, same as it always has for any
 * other route — no new logic was needed for that, it just falls out
 * of how hash parsing already works here.
 */

function parseHash() {
  const rawHash = window.location.hash.replace(/^#\/?/, '');
  // A hash-based router's own "query string" lives inside the
  // fragment (e.g. #/student?token=xxx), not in the page's real
  // window.location.search — that's a separate, unrelated thing that
  // lives before the #. Split it off before parsing path segments, or
  // e.g. "student?token=xxx" would be read as one broken path segment
  // instead of the path "student" plus a token param.
  const [pathPart, queryPart] = rawHash.split('?');
  const query = Object.fromEntries(new URLSearchParams(queryPart || ''));
  const parts = pathPart.split('/').filter(Boolean);
  // Attached to every route this resolves to (see resolvePathParts()
  // below) — most routes ignore it, but any route can read
  // route.query for its own hash-embedded params, the same way
  // #/student?token=xxx does today.
  return { ...resolvePathParts(parts), query };
}

function resolvePathParts(parts) {
  if (parts[0] === 'classroom' && parts[1]) {
    if (parts[2] === 'class-mode') {
      return { name: 'tracker', classroomId: parts[1] };
    }
    if (parts[2] === 'recognition') {
      return { name: 'recognition', classroomId: parts[1], period: parts[3] || null, categoryId: parts[4] || null };
    }
    if (parts[2] === 'settings') {
      return { name: 'settings', classroomId: parts[1], section: parts[3] || 'general' };
    }
    if (parts[2] === 'student-access') {
      return { name: 'studentAccess', classroomId: parts[1] };
    }
    if (parts[2] === 'setup') {
      return { name: 'setup', classroomId: parts[1], step: parts[3] || null };
    }
    if (parts[2] === 'student' && parts[3]) {
      return { name: 'studentProfile', classroomId: parts[1], studentId: parts[3], tab: parts[4] || null };
    }
    if (parts[2] === 'activities') {
      if (parts[3]) {
        return { name: 'activityRoster', classroomId: parts[1], activityId: parts[3] };
      }
      return { name: 'activitiesList', classroomId: parts[1] };
    }
    if (parts[2] === 'notebooks') {
      const subjectId = parts[3];
      const notebookTypeId = parts[4];

      if (!subjectId || !notebookTypeId) {
        return { name: 'notebookTracker', classroomId: parts[1] };
      }
      if (parts[5] === 'timeline') {
        return { name: 'notebookTimeline', classroomId: parts[1], subjectId, notebookTypeId, yearMonth: parts[6] || null };
      }
      return { name: 'notebookRegister', classroomId: parts[1], subjectId, notebookTypeId, dateKey: parts[5] || null };
    }
    // A stale bookmark to the old #/classroom/{id}/learning-record
    // URL (retired — Learning Record is opened by a direct function
    // call from ui/views/DashboardView.js's "Manage Lessons" button
    // now, not routed) simply falls through to the dashboard below
    // rather than erroring.
    return { name: 'dashboard', classroomId: parts[1] };
  }

  if (parts[0] === 'teacher') {
    return { name: 'home' };
  }

  if (parts[0] === 'curriculum-management') {
    return { name: 'curriculumManagement' };
  }

  if (parts[0] === 'student') {
    const section = parts[1] || 'journey';
    return { name: 'studentPortal', section };
  }

  if (parts.length === 0) {
    return { name: 'landing' };
  }

  // Anything unrecognized falls back to the teacher app's own home,
  // matching this router's existing "unknown route -> home" behavior
  // rather than silently landing on the platform picker for a typo'd
  // or stale URL.
  return { name: 'home' };
}

export function navigate(path) {
  window.location.hash = path;
}

export function getCurrentRoute() {
  return parseHash();
}

export function onRouteChange(callback) {
  window.addEventListener('hashchange', () => callback(parseHash()));
}
