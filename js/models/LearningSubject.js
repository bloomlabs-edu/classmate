/**
 * models/LearningSubject.js
 *
 * The root of the Learning Record syllabus tree: Subject -> Unit ->
 * Concept (see models/LearningUnit.js, models/LearningConcept.js).
 * Stored as an array on classroom.learningRecord.subjects (see
 * models/Classroom.js) — order matters for display, so this factory
 * self-generates its id the same way Team/Student/NotebookSubject do.
 *
 * Deliberately named "LearningSubject", not "Subject" — this app
 * already has a distinct, unrelated `NotebookSubject`
 * (models/NotebookSubject.js, e.g. "English" as a Notebook Tracker
 * category). The two are conceptually similar (both are "a subject
 * taught in this classroom") but structurally and operationally
 * independent — a Learning Record subject's units/concepts have
 * nothing to do with a classroom's configured notebook types, and
 * nothing in this file or its services imports from or refers to the
 * Notebook Tracker in either direction.
 */

import { generateId } from '../utils/idGenerator.js';

export function createLearningSubject({ id, title, units = [] } = {}) {
  return {
    id: id || generateId(),
    title,
    units,
  };
}
