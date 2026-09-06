/**
 * ui/views/VisitorAccessView.js
 *
 * The "Classroom Tour" — presented to the invitee as an invitation to
 * explore a colleague's classroom, never as a permissions/access
 * screen. Underneath, this is still exactly Visitor Access (see
 * services/visitorAccessService.js's own header comment): no sign-in,
 * no classroom membership, ever — this file only changes how that's
 * PRESENTED, never what's technically allowed. Every word choice here
 * deliberately avoids "read-only," "not a member," "limitations," or
 * anything else that frames the experience in terms of what the
 * visitor can't do; the actual restrictions are enforced entirely by
 * services/workspaceService.js's resolveVisitorAccessCode() and
 * firestore.rules' own visitorAccessCodes rule, not by anything in
 * this view.
 *
 * Structure: a welcome screen, then a 5-section tour (Classroom ->
 * Learning -> Timetable -> Lesson Planning -> Explore ClassMate) with
 * a quiet stepper nav — deliberately NOT a conventional product-tour
 * overlay (no dimmed backdrop, no arrows pointing at UI chrome). Every
 * section is freely, directly clickable from the nav at all times
 * (no locked/sequential gating) — the "subtle way to explore without
 * following the guided order" this feature's own product direction
 * asked for, achieved by simply never locking anything, rather than a
 * second, separate "skip" affordance.
 */

import * as workspaceService from '../../services/workspaceService.js';
import { SAMPLE_LESSON_PLAN_QUESTIONS } from '../../services/visitorAccessService.js';
import { createIcon } from '../components/Icon.js';
import { createBackButton } from '../components/BackButton.js';

const WEEKDAY_LABELS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const TOUR_SECTIONS = [
  { key: 'classroom', number: '01', label: 'Classroom' },
  { key: 'learning', number: '02', label: 'Learning' },
  { key: 'timetable', number: '03', label: 'Timetable' },
  { key: 'lessonPlanning', number: '04', label: 'Lesson Planning' },
  { key: 'explore', number: '05', label: 'Explore ClassMate' },
];

export function renderVisitorAccessView(container, { code, onBack, onExploreClassMate }) {
  if (code) {
    renderResolving(container, { code, onBack, onExploreClassMate });
  } else {
    renderCodeEntry(container, { onBack, onExploreClassMate });
  }
}

function renderCodeEntry(container, { onBack, onExploreClassMate, errorText = null }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'student-join-code';

  wrapper.appendChild(createIcon('eye', { className: 'student-join-code__icon', size: 32, strokeWidth: 1.5 }));

  const title = document.createElement('h1');
  title.className = 'student-join-code__title';
  title.textContent = 'Explore a Classroom';
  wrapper.appendChild(title);

  const subtitle = document.createElement('p');
  subtitle.className = 'student-join-code__subtitle';
  subtitle.textContent = 'Enter the code your colleague shared with you to start the tour.';
  wrapper.appendChild(subtitle);

  if (errorText) {
    const notice = document.createElement('p');
    notice.className = 'student-join-code__error';
    notice.textContent = errorText;
    wrapper.appendChild(notice);
  }

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'student-join-code__input';
  input.placeholder = 'e.g. ABCD12';
  input.autocapitalize = 'characters';
  input.maxLength = 6;
  wrapper.appendChild(input);

  const continueButton = document.createElement('button');
  continueButton.type = 'button';
  continueButton.className = 'btn btn--primary btn--large';
  continueButton.textContent = 'Continue';
  const submit = () => {
    const value = input.value.trim();
    if (!value) return;
    renderResolving(container, { code: value, onBack, onExploreClassMate });
  };
  continueButton.addEventListener('click', submit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit();
  });
  wrapper.appendChild(continueButton);

  if (onBack) wrapper.appendChild(createBackButton(onBack));

  container.appendChild(wrapper);
}

async function renderResolving(container, { code, onBack, onExploreClassMate }) {
  container.innerHTML = '';
  const loading = document.createElement('p');
  loading.className = 'visitor-access__loading';
  loading.textContent = 'Opening the classroom tour…';
  container.appendChild(loading);

  let access = null;
  try {
    access = await workspaceService.resolveVisitorAccessCode(code);
  } catch (error) {
    console.error('[VisitorAccessView] Failed to resolve tour code:', error);
  }

  if (!access || access.revoked) {
    renderCodeEntry(container, {
      onBack,
      onExploreClassMate,
      errorText: "This tour link isn't active anymore. Ask your colleague for a new one.",
    });
    return;
  }

  renderWelcome(container, { access, onBack, onExploreClassMate });
}

function renderWelcome(container, { access, onBack, onExploreClassMate }) {
  container.innerHTML = '';
  const { snapshot } = access;

  const wrapper = document.createElement('div');
  wrapper.className = 'classroom-tour-welcome';

  const eyebrow = document.createElement('p');
  eyebrow.className = 'classroom-tour-welcome__eyebrow';
  eyebrow.textContent = '👋 Welcome to ClassMate';
  wrapper.appendChild(eyebrow);

  const title = document.createElement('h1');
  title.className = 'classroom-tour-welcome__title';
  title.textContent = `Explore ${snapshot.classroomName || 'this classroom'}`;
  wrapper.appendChild(title);

  if (snapshot.gradeSection) {
    const grade = document.createElement('p');
    grade.className = 'classroom-tour-welcome__grade';
    grade.textContent = snapshot.gradeSection;
    wrapper.appendChild(grade);
  }

  const intro = document.createElement('p');
  intro.className = 'classroom-tour-welcome__intro';
  intro.textContent = 'Your colleague has invited you to explore their classroom and see how ClassMate brings teaching, learning and classroom routines together.';
  wrapper.appendChild(intro);

  const startButton = document.createElement('button');
  startButton.type = 'button';
  startButton.className = 'btn btn--primary btn--large';
  startButton.textContent = 'Start the tour →';
  startButton.addEventListener('click', () => renderTour(container, { access, onBack, onExploreClassMate, sectionIndex: 0 }));
  wrapper.appendChild(startButton);

  if (onBack) wrapper.appendChild(createBackButton(onBack));

  container.appendChild(wrapper);
}

function renderTour(container, { access, onBack, onExploreClassMate, sectionIndex }) {
  container.innerHTML = '';
  const { snapshot } = access;
  const goTo = (index) => renderTour(container, { access, onBack, onExploreClassMate, sectionIndex: index });

  const wrapper = document.createElement('div');
  wrapper.className = 'classroom-tour';

  wrapper.appendChild(renderTourNav(sectionIndex, goTo));

  const stage = document.createElement('div');
  stage.className = 'classroom-tour__stage';

  const section = TOUR_SECTIONS[sectionIndex];
  if (section.key === 'classroom') stage.appendChild(renderClassroomSection(snapshot));
  else if (section.key === 'learning') stage.appendChild(renderLearningSection(snapshot));
  else if (section.key === 'timetable') stage.appendChild(renderTimetableSection(snapshot));
  else if (section.key === 'lessonPlanning') stage.appendChild(renderLessonPlanningSection(snapshot));
  else if (section.key === 'explore') stage.appendChild(renderExploreSection(onExploreClassMate));

  wrapper.appendChild(stage);

  const footer = document.createElement('div');
  footer.className = 'classroom-tour__footer';

  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'btn btn--ghost';
  backButton.textContent = '← Back';
  backButton.disabled = sectionIndex === 0;
  backButton.addEventListener('click', () => goTo(sectionIndex - 1));
  footer.appendChild(backButton);

  if (sectionIndex < TOUR_SECTIONS.length - 1) {
    const nextButton = document.createElement('button');
    nextButton.type = 'button';
    nextButton.className = 'btn btn--primary';
    nextButton.textContent = 'Next →';
    nextButton.addEventListener('click', () => goTo(sectionIndex + 1));
    footer.appendChild(nextButton);
  }

  wrapper.appendChild(footer);

  container.appendChild(wrapper);
}

/**
 * The quiet stepper — "01 Classroom / 02 Learning / ..." plus a
 * subtle row of progress dots, never "step 2 of 5" or a percentage.
 * Every label is directly clickable at all times: nothing here is
 * ever locked, so a visitor who wants to jump straight to "Timetable"
 * simply can.
 */
function renderTourNav(sectionIndex, goTo) {
  const nav = document.createElement('nav');
  nav.className = 'classroom-tour__nav';

  const labels = document.createElement('div');
  labels.className = 'classroom-tour__nav-labels';
  TOUR_SECTIONS.forEach((section, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'classroom-tour__nav-label' + (index === sectionIndex ? ' classroom-tour__nav-label--active' : '');
    button.setAttribute('aria-current', index === sectionIndex ? 'step' : 'false');
    const number = document.createElement('span');
    number.className = 'classroom-tour__nav-number';
    number.textContent = section.number;
    const label = document.createElement('span');
    label.textContent = section.label;
    button.append(number, label);
    button.addEventListener('click', () => goTo(index));
    labels.appendChild(button);
  });
  nav.appendChild(labels);

  const dots = document.createElement('div');
  dots.className = 'classroom-tour__progress';
  dots.setAttribute('role', 'progressbar');
  dots.setAttribute('aria-valuemin', '1');
  dots.setAttribute('aria-valuemax', String(TOUR_SECTIONS.length));
  dots.setAttribute('aria-valuenow', String(sectionIndex + 1));
  dots.setAttribute('aria-label', `Section ${sectionIndex + 1} of ${TOUR_SECTIONS.length}`);
  TOUR_SECTIONS.forEach((section, index) => {
    const dot = document.createElement('span');
    dot.className = 'classroom-tour__progress-dot' + (index <= sectionIndex ? ' classroom-tour__progress-dot--filled' : '');
    dots.appendChild(dot);
  });
  nav.appendChild(dots);

  return nav;
}

// ---- 01. Classroom ----------------------------------------------------

function renderClassroomSection(snapshot) {
  const section = document.createElement('div');
  section.className = 'classroom-tour__section classroom-tour__section--hero';

  const eyebrow = document.createElement('p');
  eyebrow.className = 'classroom-tour__eyebrow';
  eyebrow.textContent = '01 · The Classroom';
  section.appendChild(eyebrow);

  const heading = document.createElement('h2');
  heading.className = 'classroom-tour__heading';
  heading.textContent = snapshot.classroomName || 'This classroom';
  section.appendChild(heading);

  const meta = document.createElement('p');
  meta.className = 'classroom-tour__meta';
  meta.textContent = [snapshot.gradeSection, snapshot.schoolName].filter(Boolean).join(' • ');
  section.appendChild(meta);

  const explanation = document.createElement('p');
  explanation.className = 'classroom-tour__explanation';
  explanation.textContent = 'In ClassMate, a classroom is where a teacher brings everything together — the subjects being taught, the timetable, and how lessons are planned.';
  section.appendChild(explanation);

  return section;
}

// ---- 02. Learning -------------------------------------------------------

function renderLearningSection(snapshot) {
  const section = document.createElement('div');
  section.className = 'classroom-tour__section';

  const eyebrow = document.createElement('p');
  eyebrow.className = 'classroom-tour__eyebrow';
  eyebrow.textContent = '02 · What are students learning?';
  section.appendChild(eyebrow);

  const explanation = document.createElement('p');
  explanation.className = 'classroom-tour__explanation';
  explanation.textContent = 'Teachers organise learning around subjects, units and concepts.';
  section.appendChild(explanation);

  const subjects = snapshot.subjects || [];
  if (subjects.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'classroom-tour__empty';
    empty.textContent = 'This classroom hasn’t set up its subjects yet.';
    section.appendChild(empty);
    return section;
  }

  const accordion = document.createElement('div');
  accordion.className = 'classroom-tour__accordion';

  subjects.forEach((subject, subjectIndex) => {
    const subjectRow = document.createElement('div');
    subjectRow.className = 'classroom-tour__accordion-row';

    const subjectButton = document.createElement('button');
    subjectButton.type = 'button';
    subjectButton.className = 'classroom-tour__accordion-toggle';
    subjectButton.appendChild(createIcon('arrow-right', { size: 14 }));
    const subjectLabel = document.createElement('span');
    subjectLabel.textContent = subject.title;
    subjectButton.appendChild(subjectLabel);
    const unitCount = document.createElement('span');
    unitCount.className = 'classroom-tour__accordion-count';
    unitCount.textContent = `${subject.units.length} unit${subject.units.length === 1 ? '' : 's'}`;
    subjectButton.appendChild(unitCount);
    subjectRow.appendChild(subjectButton);

    const unitList = document.createElement('div');
    unitList.className = 'classroom-tour__unit-list';
    unitList.hidden = true;
    subject.units.forEach((unit) => {
      const unitRow = document.createElement('p');
      unitRow.className = 'classroom-tour__unit-row';
      unitRow.textContent = `${unit.title} — ${unit.concepts.length} concept${unit.concepts.length === 1 ? '' : 's'}`;
      unitList.appendChild(unitRow);
    });
    subjectRow.appendChild(unitList);

    subjectButton.classList.toggle('classroom-tour__accordion-toggle--expanded', false);
    subjectButton.addEventListener('click', () => {
      unitList.hidden = !unitList.hidden;
      subjectButton.classList.toggle('classroom-tour__accordion-toggle--expanded', !unitList.hidden);
    });

    accordion.appendChild(subjectRow);
  });

  section.appendChild(accordion);
  return section;
}

// ---- 03. Timetable -------------------------------------------------------

function renderTimetableSection(snapshot) {
  const section = document.createElement('div');
  section.className = 'classroom-tour__section';

  const eyebrow = document.createElement('p');
  eyebrow.className = 'classroom-tour__eyebrow';
  eyebrow.textContent = '03 · When does learning happen?';
  section.appendChild(eyebrow);

  const explanation = document.createElement('p');
  explanation.className = 'classroom-tour__explanation';
  explanation.textContent = 'The timetable connects what students are learning to the rhythm of the school day.';
  section.appendChild(explanation);

  const slots = snapshot.timetable?.slots || [];
  if (slots.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'classroom-tour__empty';
    empty.textContent = 'This classroom hasn’t set up its timetable yet.';
    section.appendChild(empty);
    return section;
  }

  const byWeekday = new Map();
  slots.forEach((slot) => {
    if (!byWeekday.has(slot.weekday)) byWeekday.set(slot.weekday, []);
    byWeekday.get(slot.weekday).push(slot);
  });

  const list = document.createElement('div');
  list.className = 'classroom-tour__timetable';
  Array.from(byWeekday.keys())
    .sort((a, b) => a - b)
    .forEach((weekday) => {
      const dayBlock = document.createElement('div');
      dayBlock.className = 'classroom-tour__timetable-day';

      const dayLabel = document.createElement('h3');
      dayLabel.className = 'classroom-tour__timetable-day-label';
      dayLabel.textContent = WEEKDAY_LABELS[weekday] || `Day ${weekday}`;
      dayBlock.appendChild(dayLabel);

      byWeekday
        .get(weekday)
        .sort((a, b) => a.periodNumber - b.periodNumber)
        .forEach((slot) => {
          const row = document.createElement('p');
          row.className = 'classroom-tour__timetable-row';
          row.textContent = `P${slot.periodNumber} · ${slot.subjectTitle}`;
          dayBlock.appendChild(row);
        });

      list.appendChild(dayBlock);
    });
  section.appendChild(list);

  return section;
}

// ---- 04. Lesson Planning -------------------------------------------------

/**
 * A clearly-labeled EXAMPLE, never this classroom's real lesson-plan
 * content (see services/visitorAccessService.js's own
 * SAMPLE_LESSON_PLAN_QUESTIONS doc comment for why — the sanitized
 * snapshot deliberately never includes real lesson plans at all).
 */
function renderLessonPlanningSection(snapshot) {
  const section = document.createElement('div');
  section.className = 'classroom-tour__section';

  const eyebrow = document.createElement('p');
  eyebrow.className = 'classroom-tour__eyebrow';
  eyebrow.textContent = '04 · How does a teacher plan a lesson?';
  section.appendChild(eyebrow);

  const explanation = document.createElement('p');
  explanation.className = 'classroom-tour__explanation';
  explanation.textContent = 'Every lesson in ClassMate is planned around the same 5 Questions — here’s an example, not one of this classroom’s real lessons:';
  section.appendChild(explanation);

  const list = document.createElement('div');
  list.className = 'classroom-tour__questions';
  SAMPLE_LESSON_PLAN_QUESTIONS.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'classroom-tour__question-row';
    const number = document.createElement('span');
    number.className = 'classroom-tour__question-number';
    number.textContent = item.number;
    row.appendChild(number);
    const textWrap = document.createElement('div');
    const question = document.createElement('p');
    question.className = 'classroom-tour__question-text';
    question.textContent = item.question;
    textWrap.appendChild(question);
    const description = document.createElement('p');
    description.className = 'classroom-tour__question-description';
    description.textContent = item.description;
    textWrap.appendChild(description);
    row.appendChild(textWrap);
    list.appendChild(row);
  });
  section.appendChild(list);

  return section;
}

// ---- 05. Explore ClassMate -----------------------------------------------

function renderExploreSection(onExploreClassMate) {
  const section = document.createElement('div');
  section.className = 'classroom-tour__section classroom-tour__section--hero';

  const eyebrow = document.createElement('p');
  eyebrow.className = 'classroom-tour__eyebrow';
  eyebrow.textContent = '05 · Explore ClassMate';
  section.appendChild(eyebrow);

  const heading = document.createElement('h2');
  heading.className = 'classroom-tour__heading';
  heading.textContent = "That's ClassMate.";
  section.appendChild(heading);

  const explanation = document.createElement('p');
  explanation.className = 'classroom-tour__explanation';
  explanation.textContent = 'A classroom where learning, planning and classroom experience come together.';
  section.appendChild(explanation);

  if (onExploreClassMate) {
    const ctaButton = document.createElement('button');
    ctaButton.type = 'button';
    ctaButton.className = 'btn btn--primary btn--large';
    ctaButton.textContent = 'Create your own classroom →';
    ctaButton.addEventListener('click', onExploreClassMate);
    section.appendChild(ctaButton);
  }

  return section;
}
