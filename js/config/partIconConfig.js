/**
 * config/partIconConfig.js
 *
 * Per-Part icon lookup for a multi-Part Subject's own Parts list (see
 * ui/views/LearningManagementView.js's renderUnitsOrParts()) — the
 * same "keyword match, first wins, always a valid fallback" shape as
 * config/subjectIconConfig.js's getSubjectIconName(), kept as its own
 * separate file rather than merged into that one: a Subject and a Part
 * are matched against completely different vocabularies (Part names
 * are a Social-Science-style subdivision — History/Geography/Civics/
 * Economics — never a Subject title), and subjectIconConfig.js's own
 * rules deliberately collapse History/Geography/Civics all into one
 * 'globe' glyph (correct at the SUBJECT level, where "Social Science"
 * just needs one icon) — reusing that file here would give every Part
 * the same icon, defeating the one thing this lookup exists for: making
 * peer Parts tellable apart (see docs/classmate_ui_consistency_guidelines.md
 * Section 11, "Peer items still need to be tellable apart").
 *
 * Colour stays the single, restrained tint every Parts card already
 * shares (see renderUnitsOrParts()'s own card markup) — only the glyph
 * varies, per that same guideline.
 */

const PART_ICON_RULES = [
  { keywords: ['history'], icon: 'history' },
  { keywords: ['geography'], icon: 'globe' },
  { keywords: ['civics', 'polity', 'political science'], icon: 'users' },
  { keywords: ['economics', 'economy'], icon: 'trending-up' },
  { keywords: ['math'], icon: 'calculator' },
  { keywords: ['science', 'physics', 'chemistry', 'biology'], icon: 'flask-conical' },
  { keywords: ['language', 'grammar', 'literature'], icon: 'languages' },
];

const DEFAULT_PART_ICON = 'folder';

/** The icon name (see ui/components/Icon.js's ICONS) to use for a given Part name — never throws, always returns a real, valid icon name. */
export function getPartIconName(partName) {
  const normalized = (partName || '').toLowerCase();
  const match = PART_ICON_RULES.find((rule) => rule.keywords.some((keyword) => normalized.includes(keyword)));
  return match ? match.icon : DEFAULT_PART_ICON;
}
