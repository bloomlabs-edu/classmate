/**
 * ui/views/VisitorAccessView.js
 *
 * The Visitor's own front door — no sign-in, no classroom membership,
 * ever (see services/visitorAccessService.js's own header comment for
 * the full reasoning). Mirrors
 * ui/student-portal/onboarding/StudentJoinClassroomView.js's own
 * "enter a code, resolve it, done" shape, but resolves to a sanitized
 * STRUCTURE snapshot (subjects/units/concepts, timetable) rather than
 * a real classroom document — this view never receives, and could
 * never render, a real student's name, score, or notebook, because
 * workspaceService.resolveVisitorAccessCode() never returns any.
 *
 * A persistent "Visitor mode — read-only demo" banner stays on screen
 * throughout, so nobody mistakes a sanitized snapshot for live data —
 * per explicit product direction that Visitor must not look like a
 * quieter version of Co-Teacher access.
 */

import * as workspaceService from '../../services/workspaceService.js';
import { createIcon } from '../components/Icon.js';
import { createBackButton } from '../components/BackButton.js';

const WEEKDAY_LABELS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function renderVisitorAccessView(container, { code, onBack }) {
  if (code) {
    renderResolving(container, { code, onBack });
  } else {
    renderCodeEntry(container, { onBack });
  }
}

function renderCodeEntry(container, { onBack, errorText = null }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'student-join-code';

  wrapper.appendChild(createIcon('eye', { className: 'student-join-code__icon', size: 32, strokeWidth: 1.5 }));

  const title = document.createElement('h1');
  title.className = 'student-join-code__title';
  title.textContent = 'Visit a Classroom';
  wrapper.appendChild(title);

  const subtitle = document.createElement('p');
  subtitle.className = 'student-join-code__subtitle';
  subtitle.textContent = "Enter the visitor code a teacher shared with you — you'll see a read-only demo, no sign-in needed.";
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
    renderResolving(container, { code: value, onBack });
  };
  continueButton.addEventListener('click', submit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit();
  });
  wrapper.appendChild(continueButton);

  if (onBack) wrapper.appendChild(createBackButton(onBack));

  container.appendChild(wrapper);
}

async function renderResolving(container, { code, onBack }) {
  container.innerHTML = '';
  const loading = document.createElement('p');
  loading.className = 'visitor-access__loading';
  loading.textContent = 'Loading demo…';
  container.appendChild(loading);

  let access = null;
  try {
    access = await workspaceService.resolveVisitorAccessCode(code);
  } catch (error) {
    console.error('[VisitorAccessView] Failed to resolve visitor code:', error);
  }

  if (!access || access.revoked) {
    renderCodeEntry(container, {
      onBack,
      errorText: "That link isn't valid anymore. Ask the teacher for a fresh visitor link.",
    });
    return;
  }

  renderDemo(container, { access, onBack });
}

function renderDemo(container, { access, onBack }) {
  container.innerHTML = '';
  const { snapshot } = access;

  const wrapper = document.createElement('div');
  wrapper.className = 'tracker-view visitor-access';

  const banner = document.createElement('div');
  banner.className = 'visitor-access__banner';
  banner.appendChild(createIcon('eye', { size: 16 }));
  const bannerText = document.createElement('span');
  bannerText.textContent = 'Visitor mode — a read-only demo. Real student names, scores, and notebooks are never shown here.';
  banner.appendChild(bannerText);
  wrapper.appendChild(banner);

  const header = document.createElement('header');
  header.className = 'tracker-header';
  if (onBack) header.appendChild(createBackButton(onBack));
  const titleBlock = document.createElement('div');
  titleBlock.className = 'tracker-header__title-block';
  const title = document.createElement('h1');
  title.className = 'tracker-header__title';
  title.textContent = snapshot.classroomName || 'Classroom demo';
  const subtitle = document.createElement('p');
  subtitle.className = 'tracker-header__subtitle';
  subtitle.textContent = [snapshot.gradeSection, snapshot.schoolName].filter(Boolean).join(' • ');
  titleBlock.append(title, subtitle);
  header.appendChild(titleBlock);
  wrapper.appendChild(header);

  const content = document.createElement('div');
  content.className = 'wizard-step-content';
  content.appendChild(renderSubjectsSection(snapshot.subjects));
  content.appendChild(renderTimetableSection(snapshot.timetable));
  wrapper.appendChild(content);

  container.appendChild(wrapper);
}

function renderSubjectsSection(subjects) {
  const section = document.createElement('div');
  section.className = 'settings-section';

  const heading = document.createElement('h2');
  heading.className = 'settings-page-heading';
  heading.textContent = 'Subjects & Curriculum';
  section.appendChild(heading);

  if (!subjects || subjects.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'settings-section__meta';
    empty.textContent = 'No subjects have been set up in this classroom yet.';
    section.appendChild(empty);
    return section;
  }

  subjects.forEach((subject) => {
    const subjectBlock = document.createElement('div');
    subjectBlock.className = 'visitor-access__subject';
    const subjectTitle = document.createElement('h3');
    subjectTitle.className = 'lesson-plan-builder__subheading';
    subjectTitle.textContent = subject.title;
    subjectBlock.appendChild(subjectTitle);

    subject.units.forEach((unit) => {
      const unitRow = document.createElement('p');
      unitRow.className = 'visitor-access__unit';
      const conceptCount = unit.concepts.length;
      unitRow.textContent = `${unit.title} — ${conceptCount} concept${conceptCount === 1 ? '' : 's'}`;
      subjectBlock.appendChild(unitRow);
    });

    section.appendChild(subjectBlock);
  });

  return section;
}

function renderTimetableSection(timetable) {
  const section = document.createElement('div');
  section.className = 'settings-section';

  const heading = document.createElement('h2');
  heading.className = 'settings-page-heading';
  heading.textContent = 'Timetable';
  section.appendChild(heading);

  if (!timetable || !timetable.slots || timetable.slots.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'settings-section__meta';
    empty.textContent = 'No timetable has been set up in this classroom yet.';
    section.appendChild(empty);
    return section;
  }

  const list = document.createElement('div');
  list.className = 'visitor-access__timetable-list';
  timetable.slots
    .slice()
    .sort((a, b) => a.weekday - b.weekday || a.periodNumber - b.periodNumber)
    .forEach((slot) => {
      const row = document.createElement('p');
      row.className = 'visitor-access__timetable-row';
      row.textContent = `${WEEKDAY_LABELS[slot.weekday] || 'Day ' + slot.weekday} · Period ${slot.periodNumber} — ${slot.subjectTitle}`;
      list.appendChild(row);
    });
  section.appendChild(list);

  return section;
}
