/**
 * services/notebookConfigService.js
 *
 * Manages a classroom's notebook taxonomy — Subjects and Notebook Types
 * (see models/Classroom.js's `notebookConfig`). Deliberately not
 * hardcoded: a teacher adds/renames/removes both from Settings >
 * Notebooks, matching the brief exactly ("the notebook structure must
 * NOT be hardcoded").
 *
 * Notebook Types are linked to a Subject by id (not nested inside it),
 * the same "flat list + id reference" shape already used for
 * learningActivities and settings.badgeCatalog — renaming a subject
 * doesn't require walking into every notebook type that references it.
 */

import { createNotebookSubject } from '../models/NotebookSubject.js';
import { createNotebookType, createDailySettings } from '../models/NotebookType.js';
import { createNotebookReviewCriterion, DEFAULT_NOTEBOOK_REVIEW_CRITERIA } from '../models/NotebookReviewCriterion.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

export function listSubjects(classroom) {
  return classroom.notebookConfig.subjects;
}

export function addSubject(classroom, name) {
  const subject = createNotebookSubject({ name });
  classroom.notebookConfig.subjects.push(subject);
  return subject;
}

export function renameSubject(classroom, subjectId, newName) {
  const subject = classroom.notebookConfig.subjects.find((s) => s.id === subjectId);
  if (subject) subject.name = newName;
  return subject;
}

/** Also removes every notebook type that belonged to this subject. */
export function removeSubject(classroom, subjectId) {
  classroom.notebookConfig.subjects = classroom.notebookConfig.subjects.filter((s) => s.id !== subjectId);
  classroom.notebookConfig.notebookTypes = classroom.notebookConfig.notebookTypes.filter(
    (type) => type.subjectId !== subjectId
  );
}

export function listNotebookTypes(classroom, subjectId) {
  const types = classroom.notebookConfig.notebookTypes;
  return subjectId ? types.filter((type) => type.subjectId === subjectId) : types;
}

export function addNotebookType(classroom, subjectId, name) {
  const type = createNotebookType({ subjectId, name });
  classroom.notebookConfig.notebookTypes.push(type);
  return type;
}

export function renameNotebookType(classroom, typeId, newName) {
  const type = classroom.notebookConfig.notebookTypes.find((t) => t.id === typeId);
  if (type) type.name = newName;
  return type;
}

export function removeNotebookType(classroom, typeId) {
  classroom.notebookConfig.notebookTypes = classroom.notebookConfig.notebookTypes.filter((t) => t.id !== typeId);
}

export function getSubjectById(classroom, subjectId) {
  return classroom.notebookConfig.subjects.find((s) => s.id === subjectId) || null;
}

export function getNotebookTypeById(classroom, typeId) {
  return classroom.notebookConfig.notebookTypes.find((t) => t.id === typeId) || null;
}

/**
 * A notebook type's own tracking mode, defensively defaulted to
 * 'checkpoint' — every notebook type persisted before this field
 * existed has no `trackingMode` at all, and must keep behaving exactly
 * as before (see models/NotebookType.js's own header comment). Every
 * caller that branches on tracking mode should read it through this
 * function, never `notebookType.trackingMode` directly.
 */
export function getTrackingMode(notebookType) {
  return notebookType.trackingMode || 'checkpoint';
}

/**
 * Switches a notebook type between 'checkpoint' and 'daily'. Existing
 * checkpoints/daily-check records for this notebook type are never
 * deleted by this call — switching modes only changes which screen and
 * workflow this notebook type opens into going forward; it does not
 * retroactively touch classroom.checkpoints or classroom.dailyChecks.
 * Turning 'daily' on for the first time seeds a fresh dailySettings
 * (scoring off, default max 5, no excluded dates yet) if one doesn't
 * already exist, so a teacher re-toggling back and forth doesn't lose
 * previously-configured scoring/holiday settings.
 */
export function setTrackingMode(classroom, typeId, trackingMode) {
  const type = getNotebookTypeById(classroom, typeId);
  if (!type) return null;
  type.trackingMode = trackingMode;
  if (trackingMode === 'daily' && !type.dailySettings) {
    type.dailySettings = createDailySettings();
  }
  return type;
}

/** Turns scoring on/off and sets the maximum score for a 'daily' notebook type. No-op (returns null) if this notebook type has no dailySettings yet — call setTrackingMode(..., 'daily') first. */
export function setDailySettings(classroom, typeId, { scoringEnabled, scoreMax } = {}) {
  const type = getNotebookTypeById(classroom, typeId);
  if (!type || !type.dailySettings) return null;
  if (scoringEnabled !== undefined) type.dailySettings.scoringEnabled = scoringEnabled;
  if (scoreMax !== undefined) type.dailySettings.scoreMax = scoreMax;
  return type;
}

/** Adds one excluded (holiday / no-check) date to a 'daily' notebook type — a no-op if it's already present or if this isn't a daily notebook type yet. */
export function addExcludedDate(classroom, typeId, dateKey) {
  const type = getNotebookTypeById(classroom, typeId);
  if (!type || !type.dailySettings) return null;
  if (!type.dailySettings.excludedDates.includes(dateKey)) {
    type.dailySettings.excludedDates.push(dateKey);
  }
  return type;
}

/** Removes one excluded date from a 'daily' notebook type. */
export function removeExcludedDate(classroom, typeId, dateKey) {
  const type = getNotebookTypeById(classroom, typeId);
  if (!type || !type.dailySettings) return null;
  type.dailySettings.excludedDates = type.dailySettings.excludedDates.filter((d) => d !== dateKey);
  return type;
}

// ---------------------------------------------------------------------
// Notebook review criteria (see models/NotebookReviewCriterion.js) — the
// reusable checklist a WorkRequest notebook review scores against (see
// services/notebookReviewService.js, the only reader of this catalog
// besides the Manage Criteria UI itself).
// ---------------------------------------------------------------------

/**
 * Lazily seeds the 4 default criteria the first time this classroom's
 * own `notebookConfig.reviewCriteria` is needed — never a migration.
 * Idempotent and safe to call on every read: a classroom that already
 * has its own (possibly teacher-edited) criteria list is left
 * completely untouched; only a genuinely missing/empty array gets the
 * defaults. Returns the (possibly just-seeded) array.
 */
export function ensureReviewCriteria(classroom) {
  if (!classroom.notebookConfig.reviewCriteria || classroom.notebookConfig.reviewCriteria.length === 0) {
    classroom.notebookConfig.reviewCriteria = DEFAULT_NOTEBOOK_REVIEW_CRITERIA.map((defaultCriterion) =>
      createNotebookReviewCriterion({
        label: defaultCriterion.label,
        isSystemDetermined: defaultCriterion.isSystemDetermined,
        isCustom: false,
        createdAt: getCurrentIsoDate(),
      })
    );
  }
  return classroom.notebookConfig.reviewCriteria;
}

export function listReviewCriteria(classroom) {
  return ensureReviewCriteria(classroom);
}

export function getReviewCriterionById(classroom, criterionId) {
  return ensureReviewCriteria(classroom).find((criterion) => criterion.id === criterionId) || null;
}

/**
 * A teacher adding a reusable custom criterion (e.g. "Correctly
 * labelled diagrams", "Complete answers", "Page numbering") — matches
 * services/badgeService.js's own addBadgeToCatalog() exactly: trims,
 * rejects empty/whitespace-only input, and de-duplicates case-
 * insensitively against every EXISTING label (default or custom alike)
 * so the same criterion can never be added twice under slightly
 * different casing. Returns the new criterion, or `null` if rejected.
 */
export function addCustomReviewCriterion(classroom, label) {
  const criteria = ensureReviewCriteria(classroom);
  const trimmed = (label || '').trim();
  if (!trimmed) return null;

  const alreadyExists = criteria.some((criterion) => criterion.label.toLowerCase() === trimmed.toLowerCase());
  if (alreadyExists) return null;

  const criterion = createNotebookReviewCriterion({ label: trimmed, isSystemDetermined: false, isCustom: true, createdAt: getCurrentIsoDate() });
  criteria.push(criterion);
  return criterion;
}

/**
 * Removes a criterion from the reusable catalog. Never removes the
 * system-determined "Timely submission" criterion (see
 * models/NotebookReviewCriterion.js's own header comment) — a no-op,
 * returning `false`, for that one id specifically. Removing a criterion
 * never touches any NotebookReview that already awarded it: every award
 * snapshots the criterion's own `{id, label}` at the time it was given
 * (see models/NotebookReview.js), so a past award's own meaning is
 * unaffected by a later catalog change.
 */
export function removeReviewCriterion(classroom, criterionId) {
  const criteria = ensureReviewCriteria(classroom);
  const target = criteria.find((criterion) => criterion.id === criterionId);
  if (!target || target.isSystemDetermined) return false;

  classroom.notebookConfig.reviewCriteria = criteria.filter((criterion) => criterion.id !== criterionId);
  return true;
}
