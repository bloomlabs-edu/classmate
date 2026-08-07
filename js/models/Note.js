/**
 * models/Note.js
 *
 * A single Teacher Note on a student — a small dated record rather than
 * one long free-text field, so notes read as a chronological log (see
 * services/noteService.js). `teacherName` is free text, not a link to
 * models/Member.js — there's no login yet, so the app can't know who's
 * actually typing; a teacher just types their own name each time.
 *
 * `createdAt` — when the note was actually written. Never renamed,
 * never repurposed: it already truthfully represents authorship time,
 * and changing it would touch every already-persisted note for zero
 * new truth.
 *
 * `aboutDate` — the one genuinely new field. What the note is actually
 * ABOUT may have happened earlier than the moment a teacher got
 * around to writing it down — "today Arun volunteered to read aloud"
 * can be written days later, still correctly dated to when it
 * happened, not when it was typed. Defaults to `createdAt` when not
 * given, since "this note is about right now" is the correct default
 * for the common case where nothing retroactive is being described.
 *
 * Per the frozen platform principle, software is an archive, never an
 * author: `aboutDate` lets a teacher record a true fact about *when*
 * something happened, but this model — and everything built on it —
 * must never infer, rank, or flag which notes matter more than
 * others. That judgment belongs entirely to whoever reads them later.
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

export function createNote({ id, teacherName = '', content, createdAt, aboutDate } = {}) {
  const resolvedCreatedAt = createdAt || getCurrentIsoDate();
  return {
    id: id || generateId(),
    teacherName,
    content,
    createdAt: resolvedCreatedAt,
    aboutDate: aboutDate || resolvedCreatedAt,
  };
}
