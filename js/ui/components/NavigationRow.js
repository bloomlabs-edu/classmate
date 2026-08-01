/**
 * ui/components/NavigationRow.js
 *
 * The platform-wide standard for *navigation* lists — Subject lists,
 * Unit lists, Concept lists, Student lists, Assessment subject lists.
 * These simply navigate on click; a trailing chevron (›) is the only
 * affordance, never a "⋮" menu. Management actions for the thing a
 * navigation row leads to belong on the screen it navigates *to* (a
 * Settings "⋮" there), not scattered across the list that leads to
 * it — see ui/views/LearningManagementView.js's Subject screen and
 * ui/views/AssessmentManagementView.js's Subject (marks entry) screen
 * for where those actually live now.
 *
 * Deliberately the plainer sibling of
 * ui/components/OverflowMenu.js's createCardRowWithOverflowMenu() —
 * standalone objects (Curriculum cards, Assessment cards, Resource/
 * Worksheet/Quiz cards, Recognition cards) use that one instead, since
 * they carry their own management actions directly on the list.
 */

export function createNavigationRow({ label, onClick }) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'learning-management__choice-option navigation-row';
  row.textContent = label;
  row.addEventListener('click', onClick);
  return row;
}
