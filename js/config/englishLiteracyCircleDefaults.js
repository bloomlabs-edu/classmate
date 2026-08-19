/**
 * config/englishLiteracyCircleDefaults.js
 *
 * The default configuration for one specific Learning Programme
 * TYPE — "English Literacy Circle" — NOT a global ClassMate rule.
 * LSRW (Listening, Speaking, Reading, Writing) is this programme
 * type's own starting data, the same way config/recognitionCategories.js's
 * own categories are just that file's own data, not a hardcoded
 * structure models/LearningProgramme.js itself knows anything about.
 * A future Reading Club or Bridge Programme is simply a different
 * default configuration living in its own config file, imported by
 * whichever service creates that programme type — nothing about
 * models/LearningProgramme.js, services/learningProgrammeService.js,
 * or models/ProgrammeSession.js needs to change to support it.
 *
 * Pure data, no logic — matching config/recognitionCategories.js's
 * and config/pendingTaskTypes.js's own convention exactly. Each
 * category's `suggestedGoals` are plain display strings a student
 * may choose as-is (recorded with `source: 'suggested'`) or use as a
 * starting point before writing their own (`source: 'custom'`) — see
 * models/ProgrammeSession.js's own createProgrammeGoalEntry(). This
 * file is read once, at programme-creation time, to seed a new
 * programme's own `configuration.goalFramework.categories` — it is
 * never referenced again afterward by an existing programme's own
 * session history, per the historical-stability invariant described
 * in models/ProgrammeSession.js's own header comment. Editing this
 * file's own suggestions later changes what a NEWLY created English
 * Literacy Circle starts with; it can never retroactively change an
 * already-created programme's own configuration or any already-
 * recorded session goal.
 */

export const ENGLISH_LITERACY_CIRCLE_GOAL_CATEGORIES = [
  {
    name: 'Listening',
    suggestedGoals: [
      'Watch a 3-minute English video',
      'Listen to an English song and note two words',
      'Follow a short spoken instruction without help',
    ],
  },
  {
    name: 'Speaking',
    suggestedGoals: [
      'Speak with a partner in English',
      'Ask a question in English',
      'Answer in a complete sentence',
    ],
  },
  {
    name: 'Reading',
    suggestedGoals: [
      'Read two pages',
      'Read aloud to a partner',
      'Learn five new words',
    ],
  },
  {
    name: 'Writing',
    suggestedGoals: [
      'Write three sentences about today',
      'Write down one new word and its meaning',
      'Copy a short passage neatly',
    ],
  },
];

/**
 * Built fresh for every new English Literacy Circle — never a shared
 * reference (matching models/Classroom.js's own settings comment:
 * "built fresh for every classroom, never a shared reference"), so
 * one programme's own category ids are never accidentally shared
 * with another's. Category ids are assigned by
 * services/learningProgrammeService.js at creation time, not here —
 * this function returns plain `{ name, suggestedGoals }` pairs; id
 * assignment is a service concern, matching
 * services/goalService.js's own addCategory()'s use of
 * createGoalCategory() to mint an id at the point of use.
 */
export function buildEnglishLiteracyCircleGoalCategories() {
  return ENGLISH_LITERACY_CIRCLE_GOAL_CATEGORIES.map((category) => ({
    name: category.name,
    suggestedGoals: [...category.suggestedGoals],
  }));
}

/**
 * The full default `configuration` for a new English Literacy Circle
 * — passed directly as `createNewLearningProgramme()`'s own
 * `configuration` argument (see services/learningProgrammeService.js).
 * `defaultComponents`/`extensions` stay empty for Phase 1: the
 * product brief's own default component list (Attendance, Daily
 * Goals, Activities, Outcomes, Reflection) is already structurally
 * built into models/ProgrammeSession.js's own fixed fields
 * (`attendance`, `goals`, `activities`, plus `outcome`/`reflection`
 * on each goal entry) rather than needing to be declared as
 * `componentInstances`-driven components at all. Only genuinely
 * optional, programme-specific extensions (e.g. a future "Reading
 * Fluency" numeric tracker) belong in `extensions` — none exist yet
 * for Phase 1.
 */
export function buildEnglishLiteracyCircleConfiguration() {
  return {
    defaultComponents: [],
    extensions: [],
    goalFramework: {
      categories: buildEnglishLiteracyCircleGoalCategories(),
    },
    settings: {},
  };
}
