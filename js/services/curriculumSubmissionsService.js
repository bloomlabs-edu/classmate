/**
 * services/curriculumSubmissionsService.js
 *
 * Curriculum Library Data Integrity milestone: the Curriculum Library
 * must only ever display curricula that have actually been uploaded
 * and published — never hardcoded sample data. This file is the one
 * place that distinction is real and enforced. Every curriculum in
 * the Library (see services/curriculumLibraryService.js's
 * getLibrary()) originated as a submission here that an admin
 * reviewed and explicitly published; nothing reaches a teacher's
 * Browse Curriculum Library screen any other way.
 *
 * A submission is a reviewed pack (see
 * services/curriculumReviewService.js's exportPackJson(), which
 * captures the full standardized metadata — Curriculum Name, Board,
 * Grade, Subject, Academic Year, Version, Language, Publisher —
 * before extraction even happens) plus a lifecycle:
 *
 *   'pending_review'  — submitted, not yet visible to anyone browsing
 *                        the Library. Set by submitContribution().
 *   'published'        — reviewed and approved (see publishSubmission()),
 *                        now real, browsable Library content.
 *
 * This milestone still doesn't build full reviewer *tooling* — no
 * audit trail, no rejection flow, no multi-reviewer workflow — "the
 * important part is the architecture" carries over from the earlier
 * Global Curriculum Library milestone. What's different now: the
 * publish step is real, not simulated. A submission an admin actually
 * publishes here is indistinguishable, from this point on, from any
 * other Library content — there is no second, hardcoded path data
 * can take to appear in the Library.
 *
 * `reviewStatus` ('official' | 'community') is decided at publish
 * time by whoever reviews the submission — not self-declared by the
 * contributor — see ui/views/CurriculumManagementView.js's Review
 * Submissions screen.
 *
 * One submission covers one Grade + Subject's worth of content (the
 * same scope a Curriculum Pack has always had). A single Curriculum +
 * Version in the Library — the thing a teacher actually assigns to a
 * class — is assembled by *grouping* published submissions that share
 * a curriculum name and version label; see
 * services/curriculumLibraryService.js's getPublishedLibrary() for
 * that grouping. Contributing a second subject under an
 * already-published curriculum+version adds to that same version,
 * rather than creating a duplicate.
 *
 * Persisted to localStorage — same approach
 * services/studentDeviceService.js already uses elsewhere in this
 * app — so submissions and published curricula both survive a page
 * reload, with no real backend behind this milestone yet.
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

const STORAGE_KEY = 'classmate:curriculumSubmissions';

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    console.error('[curriculumSubmissionsService] Failed to read from localStorage:', error);
    return [];
  }
}

function writeAll(submissions) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(submissions));
  } catch (error) {
    console.error('[curriculumSubmissionsService] Failed to write to localStorage:', error);
  }
}

/** Every submission ever made in this browser, most recent first — pending and published alike. */
export function getAllSubmissions() {
  return readAll().sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
}

export function getPendingSubmissions() {
  return getAllSubmissions().filter((s) => s.status === 'pending_review');
}

/** Only what's actually reached the Curriculum Library — see this file's own header comment. */
export function getPublishedSubmissions() {
  return getAllSubmissions().filter((s) => s.status === 'published');
}

export function getSubmissionById(id) {
  return readAll().find((s) => s.id === id) || null;
}

/**
 * Submits a reviewed pack for review. Always starts 'pending_review'
 * — nothing is ever auto-published, per explicit instruction.
 */
export function submitContribution(packJson) {
  const submissions = readAll();
  const submission = {
    id: generateId(),
    packJson,
    status: 'pending_review',
    reviewStatus: null,
    submittedAt: getCurrentIsoDate(),
    publishedAt: null,
  };
  submissions.push(submission);
  writeAll(submissions);
  return submission;
}

/**
 * The one place "published" actually happens — see this file's own
 * header comment. `reviewStatus` is the admin's call, made right now,
 * not something the contributor set when submitting.
 */
export function publishSubmission(id, { reviewStatus }) {
  const submissions = readAll();
  const submission = submissions.find((s) => s.id === id);
  if (!submission) return null;
  submission.status = 'published';
  submission.reviewStatus = reviewStatus;
  submission.publishedAt = getCurrentIsoDate();
  writeAll(submissions);
  return submission;
}
