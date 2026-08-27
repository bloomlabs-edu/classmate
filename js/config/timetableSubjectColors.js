/**
 * config/timetableSubjectColors.js
 *
 * The soft, pastel subject-strip treatment the approved Timetable
 * reference images use — no such palette existed anywhere in this
 * codebase before (confirmed: config/canonicalSubjectsConfig.js only
 * ever held {id, title}, never a color). Deliberately its own small
 * config file, not folded into canonicalSubjectsConfig.js — that file
 * is the identity registry (see subjectIdentityService.js); this is
 * presentation-only, and a subject typed as free text (with no
 * canonical entry at all) still needs *some* color, via `default`
 * below, which canonicalSubjectsConfig has no equivalent concept for.
 *
 * Each subject gets a soft `tint` (the subject strip's own background)
 * and a stronger `text` color for its label — never used for anything
 * load-bearing (status/understanding), only which subject a period
 * belongs to.
 */

export const TIMETABLE_SUBJECT_COLORS = Object.freeze({
  science: Object.freeze({ tint: '#E6F1FB', text: '#1565C0' }),
  mathematics: Object.freeze({ tint: '#EEEBFB', text: '#6D5AC4' }),
  english: Object.freeze({ tint: '#E3F5E9', text: '#2E8B57' }),
  social_science: Object.freeze({ tint: '#FBE9ED', text: '#C2185B' }),
  hindi: Object.freeze({ tint: '#E1F5F1', text: '#0F9E8E' }),
  computer_science: Object.freeze({ tint: '#E8EAF9', text: '#3949AB' }),
  environmental_studies: Object.freeze({ tint: '#F1F8E3', text: '#689F38' }),
  art: Object.freeze({ tint: '#FDEEE0', text: '#BF5F1A' }),
  default: Object.freeze({ tint: '#EBEDEF', text: '#5B6672' }),
});

/** Never returns undefined — a subject with no explicit entry (a free-typed custom subject) still gets a real, visible color via `default`. */
export function getTimetableSubjectColor(subjectId) {
  return TIMETABLE_SUBJECT_COLORS[subjectId] || TIMETABLE_SUBJECT_COLORS.default;
}

/**
 * Phase V — the same shared per-subject identity above, just mixed
 * down to a much fainter wash suitable for a whole card/row background
 * rather than a small pill (see ui/views/TimetableView.js's period
 * cards, ui/components/TodaysScheduleWidget.js's rows, and the Period
 * Detail panel, which all call this now instead of each inventing its
 * own tint logic). Derived from this file's own existing `text` color
 * via CSS color-mix() — no new colors added to the palette, and the
 * same 8% mix strength already used elsewhere in this app's own
 * "quiet colored surface" convention (see TeacherPortalSidebar's own
 * active-nav-item background, css/styles.css). Deliberately not the
 * already-defined `tint` value directly: `tint` is tuned to sit behind
 * dark badge text at pill size — spread across an entire card it read
 * as too saturated in practice, closer to the "full saturated cell
 * color" this phase explicitly says to avoid.
 */
export function getTimetableSubjectWash(subjectId) {
  const color = getTimetableSubjectColor(subjectId);
  return `color-mix(in srgb, ${color.text} 8%, var(--color-surface))`;
}
