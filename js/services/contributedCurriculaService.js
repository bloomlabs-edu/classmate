/**
 * services/contributedCurriculaService.js
 *
 * "Teachers may contribute new curricula, but once approved they
 * become part of the shared ClassMate Library." This file is
 * deliberately the *only* place a teacher-submitted curriculum lives
 * before that approval — never data/curriculum/manifest.json, which
 * only ever holds the already-approved Library (see
 * services/curriculumLibraryService.js). Submitting never writes into
 * that file or its data; it writes here instead, with status
 * `'pending_review'`.
 *
 * This milestone explicitly simulates the review step rather than
 * building real reviewer tooling — "the important part is the
 * architecture." What matters architecturally, and what this file
 * gets right on purpose:
 *   - A submission's shape is *already* a real Curriculum + Version
 *     (see services/curriculumPackBuilderService.js's exportPackJson())
 *     — approving one is conceptually just moving it from here into
 *     the manifest, not transforming it into a different shape first.
 *   - Nothing here ever mutates curriculumLibraryService.js's data.
 *     The two are separate stores on purpose, so "pending" can never
 *     leak into "browsable" by accident.
 *
 * Persisted to localStorage (not just an in-memory array) so a
 * teacher's pending submissions survive a page reload during this
 * milestone's simulated review — genuinely useful given there's no
 * real reviewer workflow yet to move something out of "pending" any
 * other way. Matches the persistence approach
 * services/studentDeviceService.js already uses elsewhere in this app.
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

const STORAGE_KEY = 'classmate:contributedCurricula';

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    console.error('[contributedCurriculaService] Failed to read from localStorage:', error);
    return [];
  }
}

function writeAll(contributions) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(contributions));
  } catch (error) {
    console.error('[contributedCurriculaService] Failed to write to localStorage:', error);
  }
}

/** Every contribution this browser has ever submitted, most recent first. */
export function getAllContributions() {
  return readAll().sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
}

/**
 * Submits a reviewed pack (see
 * services/curriculumPackBuilderService.js's exportPackJson()) for
 * review. Always starts `'pending_review'` — nothing is ever
 * auto-published, per explicit instruction.
 */
export function submitContribution(packJson) {
  const contributions = readAll();
  const contribution = {
    id: generateId(),
    packJson,
    status: 'pending_review',
    submittedAt: getCurrentIsoDate(),
  };
  contributions.push(contribution);
  writeAll(contributions);
  return contribution;
}

export function getContributionById(id) {
  return readAll().find((c) => c.id === id) || null;
}
