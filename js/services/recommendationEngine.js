/**
 * services/recommendationEngine.js
 *
 * Each recommendation is an independent rule: given setupState (and,
 * in the future, activityState), does this apply, and at what
 * priority? The engine's only job is to run every rule, keep the ones
 * that apply and haven't been dismissed, and return the single
 * highest-priority one — the Teaching Assistant always renders
 * whatever this returns, nothing else.
 *
 * This is the actual extensibility point of the whole feature: adding
 * a future teaching-oriented recommendation (recognize a student,
 * review pending notebook checks, prepare tomorrow's lesson) means
 * writing one new rule function and adding it to RULES below —
 * nothing about the engine, the priority mechanism, or any existing
 * rule needs to change.
 *
 * Phase 1 deliberately contains only onboarding rules — see this
 * project's CHANGELOG for the full design history this reflects.
 * Every recommendation carries a stable `id`, which is what dismissal
 * is keyed on (see classroom.dismissedRecommendations) — dismissing
 * one recommendation never affects any other, including ones added
 * later.
 */

const RULES = [
  {
    id: 'add-students',
    category: 'onboarding',
    priority: 100,
    dismissible: false, // the one truly required step; dismissing it wouldn't make the classroom any more ready to teach
    applies: (setupState) => !setupState.hasStudents,
    build: ({ onOpenSettingsStudents }) => ({
      title: "Let's build your classroom roster",
      description: 'Add your students so you can start awarding stars, tracking notebooks, and everything else ClassMate does.',
      actions: [{ label: 'Add Students', onNavigate: onOpenSettingsStudents }],
    }),
  },
  {
    id: 'invite-students',
    category: 'onboarding',
    priority: 80,
    dismissible: true,
    applies: (setupState) => setupState.hasStudents && !setupState.hasAnyStudentJoined,
    build: ({ onOpenStudentAccess }) => ({
      title: 'Nice, your roster is coming together',
      description: "Now let's get your students in — share your classroom code once and they'll pick their own name to join.",
      actions: [{ label: 'Invite Students', onNavigate: onOpenStudentAccess }],
    }),
  },
  {
    id: 'create-groups',
    category: 'onboarding',
    priority: 30,
    dismissible: true,
    applies: (setupState) => setupState.hasStudents && !setupState.hasGroups,
    build: ({ onOpenSettingsGroups }) => ({
      title: 'Whenever you\u2019re ready, you can organize your class into groups',
      description: 'Totally optional — plenty of teachers do just fine without them.',
      actions: [{ label: 'Create Groups', onNavigate: onOpenSettingsGroups }],
    }),
  },
  {
    id: 'create-notebook',
    category: 'onboarding',
    priority: 30,
    dismissible: true,
    applies: (setupState) => setupState.hasStudents && !setupState.hasNotebookConfigured,
    build: ({ onOpenSettingsNotebooks }) => ({
      title: 'Whenever you\u2019re ready, you can set up your first notebook',
      description: 'Prepare a subject and notebook type so you can start tracking submissions during class.',
      actions: [{ label: 'Create Notebook', onNavigate: onOpenSettingsNotebooks }],
    }),
  },
];

/**
 * Returns the single highest-priority applicable, non-dismissed
 * recommendation, fully built and ready to render — or null if
 * nothing applies. `navigationCallbacks` is passed straight through
 * to whichever rule matches, so each rule only ever receives the
 * specific callback(s) it actually needs.
 */
export function getTopRecommendation(setupState, dismissedIds, navigationCallbacks) {
  const applicable = RULES.filter((rule) => rule.applies(setupState) && !dismissedIds.includes(rule.id));
  if (applicable.length === 0) return null;

  const top = applicable.reduce((best, rule) => (rule.priority > best.priority ? rule : best));
  return {
    id: top.id,
    category: top.category,
    priority: top.priority,
    dismissible: top.dismissible,
    ...top.build(navigationCallbacks),
  };
}
