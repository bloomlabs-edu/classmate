/**
 * ui/views/AssessmentManagementView.js
 *
 * Assessment Management — a school-administration record-keeping
 * module, deliberately independent of Learning Management. Per
 * explicit product decision: no Concepts, no Learning Resources, no
 * charts, graphs, rankings, report cards, or analytics in this
 * milestone — this is the vertical slice only: Assessment Management
 * -> Create Assessment -> Assessment Home -> Subject -> Student Marks
 * Entry.
 *
 * The only connection to Learning Management anywhere in this file:
 * reading which Subjects exist in this classroom and their current
 * titles (services/assessmentService.js's getSubjectTitle(), itself
 * reading services/learningRecordService.js's getSubjects()). Nothing
 * here reads Units, Concepts, curriculum links, or Resources.
 *
 * Subjects and students are referenced by id, never copied — a
 * Subject renamed in Learning Management, or a student renamed in the
 * roster, is reflected here automatically the next time this renders,
 * since every render resolves the current title/name live rather than
 * reading a value stored on the Assessment itself. See
 * models/AssessmentSubject.js and models/StudentResult.js for the
 * full reasoning.
 */

import { createIcon } from '../components/Icon.js';
import { openCreateAssessmentModal } from '../components/CreateAssessmentModal.js';
import * as assessmentService from '../../services/assessmentService.js';
import * as workspaceService from '../../services/workspaceService.js';

export function renderAssessmentManagementView(container, { classroom, onBack }) {
  let mode = 'home';
  let selectedAssessment = null;
  let selectedAssessmentSubject = null;

  function rerender() {
    renderView(container, mode, { classroom, selectedAssessment, selectedAssessmentSubject }, handlers);
  }

  const handlers = {
    onBack,
    onGoToCreateAssessment: () => {
      openCreateAssessmentModal({
        classroom,
        onAssessmentCreated: () => rerender(),
      });
    },
    onChooseAssessment: (assessment) => {
      selectedAssessment = assessment;
      mode = 'assessment';
      rerender();
    },
    onChooseAssessmentSubject: (assessmentSubject) => {
      selectedAssessmentSubject = assessmentSubject;
      mode = 'subject';
      rerender();
    },
    onBackTo: (targetMode) => {
      mode = targetMode;
      rerender();
    },
    onRecordMarks: (studentId, updates) => {
      assessmentService.recordStudentMarks(selectedAssessmentSubject, studentId, updates);
      workspaceService.save(classroom);
      // No re-render needed for a single field edit — the DOM already
      // reflects what was typed; re-rendering the whole screen on
      // every keystroke would just steal focus from the input.
    },
  };

  rerender();
}

function renderView(container, mode, state, handlers) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'learning-management'; // reuses the same page chrome styling as other modules

  const header = document.createElement('header');
  header.className = 'learning-management__header';

  const isEntryStep = mode === 'home';

  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'btn btn--text';
  backButton.appendChild(createIcon('arrow-left'));
  backButton.append(isEntryStep ? 'Back to Dashboard' : 'Back');
  backButton.addEventListener('click', () => {
    if (isEntryStep) return handlers.onBack();
    const previous = { assessment: 'home', subject: 'assessment' }[mode];
    handlers.onBackTo(previous);
  });
  header.appendChild(backButton);

  const title = document.createElement('h1');
  title.className = 'learning-management__title';
  title.textContent = '\ud83d\udcdd Assessment Management';
  header.appendChild(title);

  wrapper.appendChild(header);

  if (mode === 'assessment') {
    wrapper.appendChild(renderAssessmentStep(state.classroom, state.selectedAssessment, handlers));
  } else if (mode === 'subject') {
    wrapper.appendChild(renderSubjectStep(state.classroom, state.selectedAssessment, state.selectedAssessmentSubject, handlers));
  } else {
    wrapper.appendChild(renderHomeStep(state.classroom, handlers));
  }

  container.appendChild(wrapper);
}

/**
 * Renders exactly the classroom's own persisted Assessments — nothing
 * else. Empty means empty; no suggested or placeholder assessments
 * ever appear.
 */
function renderHomeStep(classroom, handlers) {
  const section = document.createElement('div');
  section.className = 'learning-management__section';

  const assessments = assessmentService.getAssessments(classroom);
  if (assessments.length > 0) {
    const grid = document.createElement('div');
    grid.className = 'learning-management__choice-grid';
    assessments.forEach((assessment) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'learning-management__choice-option';
      button.textContent = assessment.title;
      button.addEventListener('click', () => handlers.onChooseAssessment(assessment));
      grid.appendChild(button);
    });
    section.appendChild(grid);
  }

  const createButton = document.createElement('button');
  createButton.type = 'button';
  createButton.className = 'btn btn--primary';
  createButton.textContent = '+ Create Assessment';
  createButton.addEventListener('click', handlers.onGoToCreateAssessment);
  section.appendChild(createButton);

  return section;
}

/**
 * Lists exactly the Subjects included in this Assessment, by their
 * *current* titles — resolved live via
 * services/assessmentService.js's getSubjectTitle(), not read from
 * anything stored on the AssessmentSubject itself. A Subject that no
 * longer exists (removed from Learning Management since this
 * Assessment was created) is shown honestly rather than hidden or
 * silently skipped.
 */
function renderAssessmentStep(classroom, assessment, handlers) {
  const section = document.createElement('div');
  section.className = 'learning-management__section';

  const heading = document.createElement('p');
  heading.className = 'learning-management__step-heading';
  heading.textContent = assessment.title;
  section.appendChild(heading);

  const grid = document.createElement('div');
  grid.className = 'learning-management__choice-grid';
  assessment.assessmentSubjects.forEach((assessmentSubject) => {
    const title = assessmentService.getSubjectTitle(classroom, assessmentSubject.subjectId);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'learning-management__choice-option';
    button.textContent = title || '(Subject removed)';
    button.addEventListener('click', () => handlers.onChooseAssessmentSubject(assessmentSubject));
    grid.appendChild(button);
  });
  section.appendChild(grid);

  return section;
}

/**
 * Marks entry — the classroom's real, live roster
 * (services/assessmentService.js's getClassroomStudents()), one row
 * per student, each field saving independently as it's edited. A
 * student with no result yet shows a blank row, not a placeholder
 * value; nothing is pre-filled.
 */
function renderSubjectStep(classroom, assessment, assessmentSubject, handlers) {
  const section = document.createElement('div');
  section.className = 'learning-management__section';

  const subjectTitle = assessmentService.getSubjectTitle(classroom, assessmentSubject.subjectId);

  const heading = document.createElement('p');
  heading.className = 'learning-management__step-heading';
  heading.textContent = subjectTitle || '(Subject removed)';
  section.appendChild(heading);

  const maxMarksLine = document.createElement('p');
  maxMarksLine.className = 'learning-management__intro';
  maxMarksLine.textContent = `Maximum Marks: ${assessmentSubject.maximumMarks}`;
  section.appendChild(maxMarksLine);

  const studentsHeading = document.createElement('p');
  studentsHeading.className = 'learning-management__intro';
  studentsHeading.textContent = 'Students';
  section.appendChild(studentsHeading);

  const list = document.createElement('div');
  list.className = 'assessment-marks-entry__list';

  const students = assessmentService.getClassroomStudents(classroom);
  students.forEach((student) => {
    const existingResult = assessmentService.getStudentResult(assessmentSubject, student.id);
    list.appendChild(renderStudentMarksRow(student, existingResult, handlers));
  });
  section.appendChild(list);

  return section;
}

function renderStudentMarksRow(student, existingResult, handlers) {
  const row = document.createElement('div');
  row.className = 'assessment-marks-entry__row';

  const nameEl = document.createElement('span');
  nameEl.className = 'assessment-marks-entry__name';
  nameEl.textContent = student.name;
  row.appendChild(nameEl);

  const marksInput = document.createElement('input');
  marksInput.type = 'number';
  marksInput.className = 'assessment-marks-entry__marks';
  marksInput.placeholder = 'Marks';
  marksInput.value = existingResult && existingResult.marks !== null ? existingResult.marks : '';
  marksInput.addEventListener('change', () => {
    const value = marksInput.value === '' ? null : Number(marksInput.value);
    handlers.onRecordMarks(student.id, { marks: value });
  });
  row.appendChild(marksInput);

  const absentLabel = document.createElement('label');
  absentLabel.className = 'assessment-marks-entry__absent-label';
  const absentCheckbox = document.createElement('input');
  absentCheckbox.type = 'checkbox';
  absentCheckbox.checked = existingResult ? existingResult.absent : false;
  absentCheckbox.addEventListener('change', () => {
    handlers.onRecordMarks(student.id, { absent: absentCheckbox.checked });
  });
  absentLabel.append(absentCheckbox, 'Absent');
  row.appendChild(absentLabel);

  const remarksInput = document.createElement('input');
  remarksInput.type = 'text';
  remarksInput.className = 'assessment-marks-entry__remarks';
  remarksInput.placeholder = 'Remarks';
  remarksInput.value = existingResult ? existingResult.remarks : '';
  remarksInput.addEventListener('change', () => {
    handlers.onRecordMarks(student.id, { remarks: remarksInput.value });
  });
  row.appendChild(remarksInput);

  return row;
}
