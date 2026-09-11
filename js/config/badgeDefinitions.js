/**
 * config/badgeDefinitions.js
 *
 * The Badge & Achievement Engine's own data-driven catalog — see
 * docs/design/badges/CLASSMATE_BADGE_SYSTEM_IMPLEMENTATION_STYLEGUIDE.md
 * for the full design spec this file implements.
 *
 * Deliberately modeled on config/recognitionCategories.js's own
 * "plain data, one array, add an entry rather than rewrite a screen"
 * shape — same architectural principle, applied to a genuinely
 * different concept: recognitionCategories.js drives *live*, ephemeral
 * weekly recognition (recomputed on demand, never persisted);
 * BADGE_DEFINITIONS drives *persistent, leveled* achievements, each
 * backed by real services/achievementService.js Achievement Events.
 * The two systems intentionally coexist rather than merge — "Team
 * Champion" (a live weekly recognition, positive-stars-only) and
 * "Winning Team Member" (a persistent badge, net-standing-based) are
 * related in spirit but different computations; see
 * services/badgeAwardRules/winningTeamMemberRule.js's own header
 * comment for why they must not be conflated.
 *
 * Only `winning-team-member` has a real award rule wired up right now
 * (services/badgeAwardRules/winningTeamMemberRule.js). The other three
 * Weekly Standing recognition types from the style guide are listed
 * here as REAL badge definitions (so the UI/architecture never assumes
 * "exactly one badge exists") but have no award rule yet — nothing
 * awards them until a future rule is explicitly implemented, per
 * explicit scope ("Only implement Winning Team Member awarding now").
 */

export const BADGE_FAMILIES = Object.freeze({
  WEEKLY_STANDING: 'weekly-standing',
});

/**
 * Recognition colour = WHAT KIND of recognition, never level (see
 * style guide Section 5/30). Each theme is a small palette, not a
 * single hex, so a future badge surface (a filled card, a subtle
 * background wash, a border accent) always has the right shade
 * without inventing one ad hoc. Every value below is reused directly
 * from ui/components/Icon.js's own ICON_CATEGORIES — never a new,
 * parallel colour invented for badges specifically.
 */
export const BADGE_THEMES = Object.freeze({
  amber: { primary: '#C9971D', dark: '#8a6110', light: '#FBF0D9', surface: '#FFFCF5', accent: '#E4B94A' },
  blue: { primary: '#5ea6da', dark: '#2f6ea3', light: '#E6F1FB', surface: '#F7FBFE', accent: '#8DC2EA' },
  green: { primary: '#4C9A2A', dark: '#356b1d', light: '#EAF5E3', surface: '#F6FBF3', accent: '#7FBE5C' },
  purple: { primary: '#6D5AC4', dark: '#493c87', light: '#EEEBFB', surface: '#F8F7FD', accent: '#9689D6' },
});

/**
 * Every currently-defined badge, across every family. `family` +
 * `recognitionType` together are a badge's real identity — an
 * Achievement Event always names both (see models/AchievementEvent.js)
 * rather than a single combined string, so a future family can reuse
 * a recognitionType name (e.g. "milestone") without colliding.
 *
 * `icon` names an existing ui/components/Icon.js glyph — per the style
 * guide's own Section 18 ("the badge should consume an icon rather
 * than embedding one directly into the component logic"), swapping
 * this string is the entire cost of changing a badge's icon later.
 */
export const BADGE_DEFINITIONS = Object.freeze([
  {
    family: BADGE_FAMILIES.WEEKLY_STANDING,
    recognitionType: 'winning-team-member',
    title: 'Winning Team Member',
    description: 'Part of the highest-scoring team when a Standing Cycle closed, with a non-negative standing of their own.',
    icon: 'users',
    theme: 'amber',
  },
  {
    family: BADGE_FAMILIES.WEEKLY_STANDING,
    recognitionType: 'team-topper',
    title: 'Team Topper',
    description: 'Highest individual standing within their own team for a Standing Cycle.',
    icon: 'award',
    theme: 'blue',
  },
  {
    family: BADGE_FAMILIES.WEEKLY_STANDING,
    recognitionType: 'climber',
    title: 'Climber',
    description: 'Strongest improvement compared with the previous Standing Cycle.',
    icon: 'trending-up',
    theme: 'green',
  },
  {
    family: BADGE_FAMILIES.WEEKLY_STANDING,
    recognitionType: 'helper',
    title: 'Helper',
    description: 'Meaningfully supported classmates.',
    icon: 'user-plus',
    theme: 'purple',
  },
]);

export function getBadgeDefinition(family, recognitionType) {
  return BADGE_DEFINITIONS.find((badge) => badge.family === family && badge.recognitionType === recognitionType) || null;
}

/**
 * Visual stage thresholds — style guide Section 13/24. A lookup table,
 * not `if (level === 1) ... if (level === 2) ...`: adding a stage or
 * moving a threshold later is a one-line change here, never a
 * component rewrite. Ordered ascending by `min`; getBadgeStage() below
 * picks the last one the level still qualifies for.
 */
export const BADGE_STAGES = Object.freeze([
  { id: 'starting-out', label: 'Starting Out', min: 1 },
  { id: 'building', label: 'Building', min: 3 },
  { id: 'established', label: 'Established', min: 5 },
  { id: 'elite', label: 'Elite', min: 10 },
  { id: 'master', label: 'Master', min: 20 },
]);

/** The visual stage a given level falls into — level 0 (not yet earned) has no stage. */
export function getBadgeStage(level) {
  if (!level || level < 1) return null;
  let stage = BADGE_STAGES[0];
  for (const candidate of BADGE_STAGES) {
    if (level >= candidate.min) stage = candidate;
  }
  return stage;
}

/**
 * Milestones are visual progression *markers*, never level caps (style
 * guide Section 14) — LV 51 is valid and still reads as Master. Used
 * only to compute "how many more to the next milestone" for progress
 * copy; nothing here ever stops the level from incrementing past 50.
 */
export const BADGE_MILESTONES = Object.freeze([1, 5, 10, 20, 50]);

/** The next milestone strictly above `level`, or null once past the last one (the level itself keeps climbing — see this file's own header comment). */
export function getNextMilestone(level) {
  return BADGE_MILESTONES.find((milestone) => milestone > level) ?? null;
}
