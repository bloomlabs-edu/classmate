/**
 * ui/views/NotebookTrackerView.js
 *
 * The classroom-level Notebook landing page — a pure launcher now,
 * per explicit product decision: "Notebook Type → Checkpoints"
 * directly, with the old "Notebook Type → Notebook Check →
 * Checkpoints" middle layer removed from this workflow entirely.
 *
 * The old "Notebook Check" card grid (fed by
 * services/workTypes/NotebookWorkType.js's own getActiveWork()/
 * getStartActions(), leading to ui/views/WorkRequestCreateView.js —
 * a genuinely different flow from Checkpoints) and the separate
 * "Checkpoints" text-link list are both gone from this page, replaced
 * by one unified grid of Notebook Type cards
 * (createNotebookTypeCard() below) — each one a plain, clickable
 * destination straight to its own real Checkpoints screen
 * (ui/views/NotebookCheckpointsView.js, via the exact, unmodified
 * notebookCheckpoints route in ui/router.js). Neither
 * NotebookWorkType.js nor WorkRequestCreateView.js was touched at
 * all — "starting a new notebook check" still exists as a real
 * capability, it's simply no longer surfaced on this specific
 * landing page.
 *
 * "Configure Notebook Types" is deliberately phrased as a doorway
 * out, not an action that belongs to this screen — per the frozen
 * Operational Work / Configuration boundary, this tracker is
 * operational; adding a new Subject/Notebook Type is configuration,
 * and the panel should read as "you are about to leave this space,"
 * not as "this is one more thing this screen does." Visually set
 * apart from the Notebook card grid by explicit product decision
 * (dashed border, not a solid card surface) — configuration should
 * recede, not compete with real operational work for attention. It
 * links straight to the existing Settings → Notebooks screen; nothing
 * here duplicates that screen's own creation form.
 *
 * Header/typography — per the new UI consistency guidelines
 * (docs/classmate_ui_consistency_guidelines.md), this screen's own
 * header no longer uses the shared, older .tracker-header full-width
 * blue bar: light background, dark title text, matching the "Default
 * Page Header" pattern those guidelines establish as the default
 * (Notebook Tracker is explicitly named in that doc's own "Bring
 * forward" list). This page is also scoped to the newly-approved
 * Plus Jakarta Sans typeface (see .notebook-tracker-view in
 * css/styles.css) — deliberately scoped to only this page for now,
 * not applied app-wide, since no other screen has migrated yet.
 */

import * as workRequestService from '../../services/workRequestService.js';
import * as notebookConfigService from '../../services/notebookConfigService.js';
import { getClassroomStudents } from '../../services/assessmentService.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { createBackButton } from '../components/BackButton.js';
import { createIcon, createIconBadge } from '../components/Icon.js';

export function renderNotebookTrackerView(container, { classroom, onBack, onNavigate, onOpenNotebookConfiguration }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  // 'notebook-tracker-view' is this screen's own scoping class — for
  // the header treatment below (light background, not the shared
  // .tracker-header's full-width blue bar) and the Plus Jakarta Sans
  // typeface override, both per the new UI consistency guidelines
  // (docs/classmate_ui_consistency_guidelines.md's own "Default Page
  // Header" rule and Notebook Tracker's explicit "Bring forward"
  // listing) — deliberately NOT applied to the shared .tracker-header/
  // --font-body used by other screens, which haven't been migrated
  // yet. 'activities-view' is kept for this page's existing, unrelated
  // structural/spacing rules, shared with a few sibling views.
  wrapper.className = 'activities-view notebook-tracker-view';

  const header = document.createElement('header');
  header.className = 'notebook-tracker__page-header';
  const backButton = createBackButton(onBack);
  const title = document.createElement('h1');
  title.className = 'notebook-tracker__page-header-title';
  title.textContent = 'Notebook Tracker';
  header.append(backButton, title);
  wrapper.appendChild(header);

  const content = document.createElement('div');
  content.className = 'wizard-step-content notebook-tracker__content';

  content.appendChild(renderPageIntro());

  const needsAttention = workRequestService.getStudentsNeedingAttention(classroom);
  if (needsAttention.length > 0) {
    content.appendChild(renderNeedsAttentionSection(needsAttention, classroom, onNavigate));
  }

  const configuredNotebooks = listConfiguredNotebooks(classroom);
  if (configuredNotebooks.length === 0) {
    content.appendChild(createEmptyStateElement({ message: 'No subjects or notebook types configured yet.' }));
  } else {
    const grid = document.createElement('div');
    grid.className = 'notebook-tracker__bento-grid';
    configuredNotebooks.forEach(({ subject, notebookType }) => {
      grid.appendChild(createNotebookTypeCard(subject, notebookType, classroom, onNavigate));
    });
    content.appendChild(grid);
  }

  content.appendChild(createConfigureNotebookTypesPanel(onOpenNotebookConfiguration));

  wrapper.appendChild(content);
  container.appendChild(wrapper);
}

/**
 * A compact page introduction — establishes what this screen is
 * without competing for vertical space with the real content below.
 * Reuses createIconBadge()'s existing 'notebook' category (see
 * ui/components/Icon.js's own ICON_CATEGORIES) rather than inventing a
 * new tint, the same restrained pastel accent every notebook card
 * below also uses.
 */
function renderPageIntro() {
  const intro = document.createElement('div');
  intro.className = 'notebook-tracker__intro';
  intro.appendChild(createIconBadge('notebook-text', 'notebook', { size: 40 }));

  const text = document.createElement('div');
  text.className = 'notebook-tracker__intro-text';

  const heading = document.createElement('h2');
  heading.className = 'notebook-tracker__intro-heading';
  heading.textContent = 'My Notebooks';
  text.appendChild(heading);

  const subtitle = document.createElement('p');
  subtitle.className = 'notebook-tracker__intro-subtitle';
  subtitle.textContent = 'Track and manage notebooks across your classes.';
  text.appendChild(subtitle);

  intro.appendChild(text);
  return intro;
}

/**
 * Classroom-wide "who needs attention" — the one genuine teacher-side
 * gap identified before implementing anything else: per-student
 * history already existed (workRequestService.getStudentSummary()),
 * but only ever visible one student at a time via their own profile.
 * This surfaces the pattern directly, without a teacher needing to
 * already suspect a specific student. Each row links straight to
 * that exact, already-existing drill-down (StudentProfileView's own
 * 'notebooks' tab) — no new destination invented.
 */
/** Every configured Subject x Notebook Type combination — the same enumeration NotebookWorkType.js's own getStartActions() already does internally, reused directly here since this section needs the same list for a genuinely different purpose (a permanent destination, not a start-action). */
function listConfiguredNotebooks(classroom) {
  const notebooks = [];
  notebookConfigService.listSubjects(classroom).forEach((subject) => {
    notebookConfigService.listNotebookTypes(classroom, subject.id).forEach((notebookType) => {
      notebooks.push({ subject, notebookType });
    });
  });
  return notebooks;
}

/**
 * A selectable destination, not an operational status card — per
 * explicit product decision, this is deliberately simpler than
 * ui/components/OperationalWorkCard.js (no status line, no separate
 * button; the whole card is the click target), matching the "choose
 * a notebook, see its checkpoints" mental model directly. Navigates
 * straight to the exact, unmodified Checkpoints route
 * (ui/router.js's own notebookCheckpoints route,
 * ui/views/NotebookCheckpointsView.js) — no new routing, no new
 * model.
 *
 * Information hierarchy (redesign): the Subject is the primary,
 * large-text identity of this card; Notebook Type ("Homework,"
 * "Classwork," or whatever else a teacher has typed into Settings >
 * Notebooks) is metadata describing it, shown as a small pill rather
 * than folded into the title. The same Subject can therefore appear
 * on more than one card, once per configured Notebook Type -- that is
 * correct, not a duplicate. No "Active" pill is shown: the current
 * data model (models/NotebookType.js) has no status/enabled field at
 * all, and every configured type is implicitly current simply by
 * existing -- inventing a status label with nothing real behind it
 * would misrepresent this as tracked data it isn't.
 */
function createNotebookTypeCard(subject, notebookType, classroom, onNavigate) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'notebook-tracker__bento-card';
  card.addEventListener('click', () => {
    // Reusable across any notebook type — never a Handwriting-specific
    // branch. See models/NotebookType.js/services/dailyCheckService.js.
    const destination = notebookConfigService.getTrackingMode(notebookType) === 'daily' ? 'daily' : 'checkpoints';
    onNavigate(`/classroom/${classroom.id}/notebooks/${subject.id}/${notebookType.id}/${destination}`);
  });

  const top = document.createElement('div');
  top.className = 'notebook-tracker__bento-card-top';
  top.appendChild(createIconBadge('notebook-text', 'notebook', { size: 40 }));

  const arrow = document.createElement('span');
  arrow.className = 'notebook-tracker__bento-arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.appendChild(createIcon('arrow-right', { size: 16 }));
  top.appendChild(arrow);
  card.appendChild(top);

  const title = document.createElement('span');
  title.className = 'notebook-tracker__bento-title';
  title.textContent = subject.name;
  card.appendChild(title);

  const pill = document.createElement('span');
  pill.className = 'notebook-tracker__bento-pill';
  pill.textContent = notebookType.name;
  card.appendChild(pill);

  const description = document.createElement('span');
  description.className = 'notebook-tracker__bento-description';
  description.textContent = `Track ${notebookType.name.toLowerCase()} notebooks`;
  card.appendChild(description);

  return card;
}

function renderNeedsAttentionSection(needsAttention, classroom, onNavigate) {
  const section = document.createElement('div');
  section.className = 'notebook-tracker__attention';

  const heading = document.createElement('p');
  heading.className = 'notebook-tracker__attention-heading';
  heading.textContent = '\u26a0\ufe0f Needs Attention';
  section.appendChild(heading);

  const students = getClassroomStudents(classroom);
  const list = document.createElement('div');
  list.className = 'notebook-tracker__attention-list';

  needsAttention.forEach(({ studentId, count }) => {
    const student = students.find((s) => s.id === studentId);
    if (!student) return; // a student who has since left the roster — nothing meaningful to show

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'notebook-tracker__attention-row';
    const name = document.createElement('span');
    name.textContent = student.name;
    const badge = document.createElement('span');
    badge.className = 'notebook-tracker__attention-badge';
    badge.textContent = `${count} issue${count === 1 ? '' : 's'}`;
    row.append(name, badge);
    row.addEventListener('click', () => onNavigate(`/classroom/${classroom.id}/student/${studentId}/notebooks`));
    list.appendChild(row);
  });

  section.appendChild(list);
  return section;
}

/**
 * Deliberately styled and worded as a doorway out of this operational
 * screen, not an action this screen performs — see this file's own
 * header comment for why "Configure" rather than "+ Add" is the
 * correct grammar here. Redesigned as a large dashed bento-style
 * action panel, visually set apart from the real Notebook cards above
 * (a dashed border, not the same solid-surface card treatment) so
 * configuration still reads as a secondary, administrative doorway
 * rather than another operational destination competing with them.
 * Uses the real Lucide 'settings' icon (ui/components/Icon.js) rather
 * than a plain gear character glyph, matching this app's own
 * docs/icon-design-guide.md rule that functional icons use the icon
 * system, not emoji/text glyphs.
 */
function createConfigureNotebookTypesPanel(onOpenNotebookConfiguration) {
  const panel = document.createElement('div');
  panel.className = 'notebook-tracker__configure-panel';

  panel.appendChild(createIcon('settings', { size: 24, className: 'notebook-tracker__configure-panel-icon' }));

  const heading = document.createElement('p');
  heading.className = 'notebook-tracker__configure-panel-heading';
  heading.textContent = 'Configure Notebook Types';
  panel.appendChild(heading);

  const description = document.createElement('p');
  description.className = 'notebook-tracker__configure-panel-description';
  description.textContent = 'Add, edit or remove notebook types for your classrooms.';
  panel.appendChild(description);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn--secondary notebook-tracker__configure-panel-button';
  button.textContent = 'Configure Now →';
  button.addEventListener('click', () => onOpenNotebookConfiguration());
  panel.appendChild(button);

  return panel;
}
