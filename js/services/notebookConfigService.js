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
