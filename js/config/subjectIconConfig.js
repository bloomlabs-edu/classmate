/**
 * config/subjectIconConfig.js
 *
 * Every Subject card used to render the same 'book-open' icon
 * regardless of what the Subject actually was, so a teacher's Subject
 * grid had no visual variety to scan by — see
 * ui/components/ExistingSubjectsList.js, the only caller. Keyword
 * matching against config/commonSubjectsConfig.js's own curated names
 * (plus a few obvious synonyms a teacher's free-typed "Other" Subject
 * might use), not exact equality — a Subject titled "Mathematics" or
 * "EVS" should still get the right icon, not just the exact strings
 * COMMON_SUBJECTS lists.
 *
 * Deliberately does NOT vary colour per subject — Icon.js's
 * 'teacher' badge tint stays the one, restrained blue every Subject
 * card already uses (see docs/classmate_ui_consistency_guidelines.md
 * Section 3, "Colour creates expression; it does not create
 * complexity") — only the glyph changes, so cards stay visually calm
 * and peer-equal while still being tellable apart at a glance.
 *
 * Order matters: checked top to bottom, first match wins. "Computer"
 * is checked before the plainer "science" match so Computer Science
 * doesn't fall into the flask-conical branch meant for the physical
 * sciences.
 */

const SUBJECT_ICON_RULES = [
  { keywords: ['computer', 'coding', 'ict'], icon: 'monitor' },
  { keywords: ['math'], icon: 'calculator' },
  { keywords: ['science'], icon: 'flask-conical' },
  { keywords: ['social', 'history', 'geography', 'civics'], icon: 'globe' },
  { keywords: ['environmental', 'evs'], icon: 'leaf' },
  { keywords: ['art', 'craft', 'drawing'], icon: 'palette' },
  { keywords: ['hindi', 'tamil', 'telugu', 'kannada', 'marathi', 'sanskrit', 'language'], icon: 'languages' },
  { keywords: ['english', 'reading'], icon: 'book-open' },
];

const DEFAULT_SUBJECT_ICON = 'book-open';

/** The icon name (see ui/components/Icon.js's ICONS) to use for a given Subject title — never throws, always returns a real, valid icon name. */
export function getSubjectIconName(subjectTitle) {
  const normalized = (subjectTitle || '').toLowerCase();
  const match = SUBJECT_ICON_RULES.find((rule) => rule.keywords.some((keyword) => normalized.includes(keyword)));
  return match ? match.icon : DEFAULT_SUBJECT_ICON;
}
