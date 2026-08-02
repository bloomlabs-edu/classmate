/**
 * config/studentEventCategories.js
 *
 * The category tags shown on every Student Event Feed card (see
 * models/StudentEvent.js, ui/student-portal/views/StudentJourneyView.js).
 * Per explicit design: a single continuous timeline sorted newest
 * first, with a category tag on each card — not grouped sections.
 *
 * This milestone only wires publishers for Recognition (badges,
 * stars) and Assessment (published) — Learning, Classroom, Team, and
 * Announcement exist here now so future features can use them without
 * this file changing again, the same "the enum exists ahead of the
 * feature that needs it" pattern already used for Assessment's own
 * `status` field (see models/Assessment.js).
 */

export const STUDENT_EVENT_CATEGORIES = {
  RECOGNITION: 'Recognition',
  ASSESSMENT: 'Assessment',
  LEARNING: 'Learning',
  CLASSROOM: 'Classroom',
  TEAM: 'Team',
  ANNOUNCEMENT: 'Announcement',
};
