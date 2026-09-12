/**
 * ui/views/ProgramManagerWeeklyPlansView.js
 *
 * The Program Manager's own cross-classroom "Weekly Plans" — the
 * programme-level front door onto the exact same review lifecycle
 * ui/views/LessonPlanReviewQueueView.js already provides for a single
 * classroom's own co-teachers (see that file's own header comment).
 * Deliberately NOT a redesign: same row shape, same status-badge
 * styling (this file reuses that view's own `.lesson-plan-review-queue*`
 * CSS classes verbatim — no new visual system), same "one flat work
 * queue, not a dashboard" restraint. The one thing a same-classroom
 * queue never needed and this one adds: which classroom and week each
 * row belongs to.
 *
 * Data comes from two places, never duplicated between them:
 *   - `classrooms` — every classroom this Program Manager already
 *     belongs to as a real `classroom.members` entry (see
 *     config/memberRoles.js's own PROGRAM_MANAGER comment for how that
 *     membership is established) — the exact same
 *     `workspaceService.getState().classrooms` every other classroom-
 *     agnostic route (e.g. Curriculum Management) already reads,
 *     already live-subscribed at sign-in via the app's existing
 *     `users/{uid}/classroomRefs` mechanism. No separate "which
 *     classrooms is this PM authorized for" mechanism exists, or is
 *     needed — see this feature's own architecture investigation for
 *     why that reuse is deliberate, not a shortcut.
 *   - `weeklyPlanReviewIndexRepository.getReviewIndexEntriesForClassroomIds()`
 *     — the thin, reference-only cross-classroom index (see
 *     services/weeklyPlanReviewIndexService.js's own header comment for
 *     exactly what it does and does not contain). Never the canonical
 *     LessonPlan content, and never a security boundary on its own (see
 *     firestore.rules' own weeklyPlanReviewIndex block) — opening a row
 *     always navigates to the real, unchanged
 *     `#/classroom/{id}/lesson-plans/{id}/review`
 *     (ui/views/LessonPlanReviewView.js), the one place plan content and
 *     the real review actions (Request Changes/Approve) ever live.
 *
 * Only SUBMITTED entries are ever shown — see
 * weeklyPlanReviewIndexService.filterEntriesNeedingReview()'s own
 * comment for why CHANGES_REQUESTED is deliberately never a Program
 * Manager's own "needs my attention" item (that's the fellow's own turn
 * to act). The existing Submitted vs Resubmitted distinction
 * (services/lessonPlanReviewService.js's own getSubmissionLabel(),
 * persisted onto each index entry as `submissionLabel` at write time —
 * never a second status model) is shown via the exact same status-badge
 * styling LessonPlanReviewQueueView.js already uses.
 *
 * Self-authored entries are excluded the same way
 * LessonPlanReviewQueueView.js already excludes them — a Program
 * Manager reviewing their own plan is nonsensical here too, even though
 * it is realistically rare for a PM to also be a plan's own author.
 */

import * as weeklyPlanReviewIndexRepository from '../../repositories/weeklyPlanReviewIndexRepository.js';
import { filterEntriesNeedingReview, sortReviewIndexEntries } from '../../services/weeklyPlanReviewIndexService.js';
import * as learningRecordService from '../../services/learningRecordService.js';
import { getMondayStartOfWeek, formatWeekDateRange } from '../../utils/dateHelpers.js';
import { createBackButton } from '../components/BackButton.js';
import { createIcon } from '../components/Icon.js';

function getClassroomName(classroom) {
  return classroom?.name || 'A classroom';
}

/** "Sep 7–11" style, reusing the exact same week-range formatting ui/views/WeeklyReportsListView.js/ui/components/WeeklyNetPointsGraph.js already established — never a second date-range format invented for this queue. */
function getWeekDisplayLabel(scheduledDate) {
  if (!scheduledDate) return 'No date set';
  return formatWeekDateRange(getMondayStartOfWeek(scheduledDate));
}

/**
 * `entry.subjectId` is a LearningSubject RECORD id (models/LearningSubject.js's
 * own `id`), not the canonical registry id — matching
 * ui/views/LessonPlanBuilderView.js's own resolveCanonicalSubjectId()
 * doc comment on why those two are different things. This index only
 * ever stores the plan's own raw `subjectId` (a reference, never a
 * title) — the human-readable subject name is resolved live here,
 * against the already-in-hand classroom object, exactly like every
 * other subjectId lookup in this app.
 */
function getSubjectTitle(classroom, subjectId) {
  if (!classroom || !subjectId) return null;
  return learningRecordService.getSubjectById(classroom, subjectId)?.title || null;
}

export function renderProgramManagerWeeklyPlansView(container, { classrooms, currentUser, onBack, onOpenPlanReview }) {
  let entries = null; // null = loading
  let loadError = null;

  const classroomsById = new Map(classrooms.map((classroom) => [classroom.id, classroom]));

  function rerender() {
    renderQueue(container, { classroomsById, entries, loadError }, { onBack, onOpenPlanReview });
  }

  rerender();

  weeklyPlanReviewIndexRepository
    .getReviewIndexEntriesForClassroomIds(classrooms.map((classroom) => classroom.id))
    .then((fetched) => {
      const needingReview = filterEntriesNeedingReview(fetched).filter((entry) => entry.createdByUid !== currentUser?.uid);
      entries = sortReviewIndexEntries(needingReview);
      rerender();
    })
    .catch((error) => {
      console.error('[ProgramManagerWeeklyPlansView] Failed to load the Weekly Plan review index:', error);
      loadError = "Couldn't load Weekly Plans. Check your connection and try again.";
      rerender();
    });
}

function renderQueue(container, { classroomsById, entries, loadError }, handlers) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'lesson-plan-review-queue';

  const header = document.createElement('header');
  header.className = 'lesson-plan-review-queue__header';
  header.appendChild(createBackButton(handlers.onBack));

  const title = document.createElement('h1');
  title.className = 'lesson-plan-review-queue__title';
  title.textContent = 'Weekly Plans';
  header.appendChild(title);

  wrapper.appendChild(header);

  const subtitle = document.createElement('p');
  subtitle.className = 'lesson-plan-review-queue__subtitle';
  subtitle.textContent = 'Submitted plans from the classrooms you review, waiting for your review.';
  wrapper.appendChild(subtitle);

  if (loadError) {
    const error = document.createElement('p');
    error.className = 'lesson-plan-review-queue__error';
    error.textContent = loadError;
    wrapper.appendChild(error);
    container.appendChild(wrapper);
    return;
  }

  if (entries === null) {
    const loading = document.createElement('p');
    loading.className = 'lesson-plan-review-queue__loading';
    loading.textContent = 'Loading…';
    wrapper.appendChild(loading);
    container.appendChild(wrapper);
    return;
  }

  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'lesson-plan-review-queue__empty';
    empty.appendChild(createIcon('check-circle-2', { size: 20 }));
    const text = document.createElement('span');
    text.textContent = "You're all caught up — nothing needs your review right now.";
    empty.appendChild(text);
    wrapper.appendChild(empty);
    container.appendChild(wrapper);
    return;
  }

  const list = document.createElement('div');
  list.className = 'lesson-plan-review-queue__rows';
  entries.forEach((entry) => {
    const classroom = classroomsById.get(entry.classroomId);

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'lesson-plan-review-queue__row';
    row.addEventListener('click', () => handlers.onOpenPlanReview(entry.classroomId, entry.lessonPlanId));

    const textWrap = document.createElement('span');
    textWrap.className = 'lesson-plan-review-queue__row-text';

    const rowTitle = document.createElement('span');
    rowTitle.className = 'lesson-plan-review-queue__row-title';
    rowTitle.textContent = entry.teacherDisplayName || 'A teacher';
    textWrap.appendChild(rowTitle);

    const weekMeta = document.createElement('span');
    weekMeta.className = 'lesson-plan-review-queue__row-meta';
    weekMeta.textContent = getWeekDisplayLabel(entry.scheduledDate);
    textWrap.appendChild(weekMeta);

    const classroomMeta = document.createElement('span');
    classroomMeta.className = 'lesson-plan-review-queue__row-meta';
    const subjectTitle = getSubjectTitle(classroom, entry.subjectId);
    classroomMeta.textContent = subjectTitle ? `${getClassroomName(classroom)} · ${subjectTitle}` : getClassroomName(classroom);
    textWrap.appendChild(classroomMeta);

    row.appendChild(textWrap);

    const badge = document.createElement('span');
    badge.className = 'lesson-plan-review-queue__status-badge';
    badge.textContent = entry.submissionLabel || 'Submitted';
    row.appendChild(badge);

    list.appendChild(row);
  });
  wrapper.appendChild(list);

  container.appendChild(wrapper);
}
