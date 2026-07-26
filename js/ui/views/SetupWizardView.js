/**
 * ui/views/SetupWizardView.js
 *
 * The post-creation onboarding flow: an overview checklist (progress bar
 * + step list) and five individual step screens (Import Students, Assign
 * Learning Buckets, Customize Groups, Configure Scoring, Invite
 * Teachers). Every step can be skipped — skipping advances to the next
 * step without marking it done, so the checklist stays an honest record
 * of what's actually been set up (see services/setupProgressService.js).
 * Teachers can reopen this wizard from Settings at any time (see
 * ui/views/SettingsView.js's General section).
 *
 * Like ui/views/SettingsView.js, this file calls straight into services
 * and mutates the classroom object directly, persisting via
 * workspaceService.save(classroom) after each change.
 */

import * as workspaceService from '../../services/workspaceService.js';
import * as classroomImportService from '../../services/classroomImportService.js';
import { ClassroomImportError } from '../../services/classroomImportService.js';
import * as teamService from '../../services/teamService.js';
import * as bucketService from '../../services/bucketService.js';
import * as scoringSettingsService from '../../services/scoringSettingsService.js';
import * as setupProgressService from '../../services/setupProgressService.js';
import { BUCKET_KEYS, BUCKET_LABELS } from '../../config/bucketConfig.js';
import { DEFAULT_GROUP_COLORS, getDefaultGroupColor } from '../../config/groupColorConfig.js';
import { openImportPreviewModal } from '../components/ImportPreviewModal.js';

// Linear step order (excludes "classroomDetails", which is captured at
// creation and shown in the checklist as already done, not as a step
// screen of its own).
const STEP_KEYS = ['importStudents', 'assignBuckets', 'customizeGroups', 'configureScoring', 'inviteTeachers'];

const STEP_LABELS = {
  importStudents: 'Import Students',
  assignBuckets: 'Assign Learning Buckets',
  customizeGroups: 'Customize Groups',
  configureScoring: 'Configure Scoring',
  inviteTeachers: 'Invite Teachers',
};

// Bucket data detected during the Import Students step, held only for
// the current session (not persisted) so the Assign Learning Buckets
// step can offer to import it. Keyed by classroom id since more than one
// classroom's wizard could theoretically be mid-flow across tabs.
const pendingImportBucketsByClassroomId = new Map();

export function renderSetupWizardView(container, { classroom, step, onNavigateStep, onFinish }) {
  container.innerHTML = '';

  if (!step) {
    renderOverview(container, classroom, { onNavigateStep, onFinish });
    return;
  }

  renderStepScreen(container, classroom, step, { onNavigateStep, onFinish });
}

function renderOverview(container, classroom, { onNavigateStep, onFinish }) {
  const wrapper = document.createElement('div');
  wrapper.className = 'wizard-overview';

  const title = document.createElement('h1');
  title.className = 'wizard-overview__title';
  title.textContent = 'Complete Your Classroom Setup';

  const subtitle = document.createElement('p');
  subtitle.className = 'wizard-overview__subtitle';
  subtitle.textContent = 'Finish these steps now or return later at any time.';

  const progressPercent = setupProgressService.computeProgressPercent(classroom);
  const progressWrapper = document.createElement('div');
  progressWrapper.className = 'wizard-progress';

  const progressTrack = document.createElement('div');
  progressTrack.className = 'wizard-progress__track';
  const progressFill = document.createElement('div');
  progressFill.className = 'wizard-progress__fill';
  progressFill.style.width = `${progressPercent}%`;
  progressTrack.appendChild(progressFill);

  const progressLabel = document.createElement('p');
  progressLabel.className = 'wizard-progress__label';
  progressLabel.textContent = `Setup progress: ${progressPercent}%`;

  progressWrapper.append(progressTrack, progressLabel);

  const checklist = document.createElement('ul');
  checklist.className = 'wizard-checklist';

  checklist.appendChild(
    createChecklistRow({ label: 'Classroom Details', done: true, interactive: false })
  );

  STEP_KEYS.forEach((key) => {
    const done = setupProgressService.isStepDone(classroom, key);
    checklist.appendChild(
      createChecklistRow({
        label: STEP_LABELS[key],
        done,
        interactive: true,
        onClick: () => onNavigateStep(key),
      })
    );
  });

  const finishButton = document.createElement('button');
  finishButton.type = 'button';
  finishButton.className = 'btn btn--primary btn--large';
  finishButton.textContent = 'Go to Tracker';
  finishButton.addEventListener('click', onFinish);

  wrapper.append(title, subtitle, progressWrapper, checklist, finishButton);
  container.appendChild(wrapper);
}

function createChecklistRow({ label, done, interactive, onClick }) {
  const item = document.createElement('li');
  item.className = 'wizard-checklist__item';

  const row = document.createElement(interactive ? 'button' : 'div');
  if (interactive) row.type = 'button';
  row.className = 'wizard-checklist__row';
  if (interactive) row.addEventListener('click', onClick);

  const icon = document.createElement('span');
  icon.className = 'wizard-checklist__icon' + (done ? ' wizard-checklist__icon--done' : '');
  icon.textContent = done ? '\u2713' : '';
  icon.setAttribute('aria-hidden', 'true');

  const text = document.createElement('span');
  text.className = 'wizard-checklist__label';
  text.textContent = label;

  row.append(icon, text);
  item.appendChild(row);
  return item;
}

function renderStepScreen(container, classroom, step, { onNavigateStep, onFinish }) {
  const wrapper = document.createElement('div');
  wrapper.className = 'wizard-step-screen';

  const header = document.createElement('header');
  header.className = 'wizard-step-header';

  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'btn btn--text';
  backButton.textContent = '\u2190 Back to Setup';
  backButton.addEventListener('click', () => onNavigateStep(null));

  const title = document.createElement('h1');
  title.className = 'wizard-step-header__title';
  title.textContent = STEP_LABELS[step] || 'Setup';

  header.append(backButton, title);

  const content = document.createElement('div');
  content.className = 'wizard-step-content';

  const advance = () => {
    const currentIndex = STEP_KEYS.indexOf(step);
    const nextStep = STEP_KEYS[currentIndex + 1];
    if (nextStep) {
      onNavigateStep(nextStep);
    } else {
      onFinish();
    }
  };

  const stepRenderers = {
    importStudents: renderImportStudentsStep,
    assignBuckets: renderAssignBucketsStep,
    customizeGroups: renderCustomizeGroupsStep,
    configureScoring: renderConfigureScoringStep,
    inviteTeachers: renderInviteTeachersStep,
  };

  const renderer = stepRenderers[step];
  if (renderer) {
    renderer(content, classroom, { advance, finish: onFinish });
  }

  wrapper.append(header, content);
  container.appendChild(wrapper);
}

function renderImportStudentsStep(content, classroom, { advance }) {
  const intro = document.createElement('p');
  intro.className = 'wizard-step__intro';
  intro.textContent =
    'Import your roster from a CSV. We support groups-as-columns, a Student Name + Group list, or just a list of names \u2014 we\u2019ll detect which one you have.';
  content.appendChild(intro);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.csv';
  fileInput.hidden = true;

  const chooseButton = document.createElement('button');
  chooseButton.type = 'button';
  chooseButton.className = 'btn btn--primary';
  chooseButton.textContent = 'Choose CSV File';
  chooseButton.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    fileInput.value = '';
    if (!file) return;

    let analysis;
    try {
      const csvText = await file.text();
      analysis = classroomImportService.analyzeCsv(csvText);
    } catch (error) {
      window.alert('Something went wrong reading that file. Please check the CSV and try again.');
      return;
    }

    openImportPreviewModal({
      formats: analysis.formats,
      initialFormatId: analysis.detected.id,
      getPreview: (formatId) => {
        try {
          const { teams } = classroomImportService.parseWithFormat(formatId, analysis.rows);
          return { teams };
        } catch (error) {
          const message =
            error instanceof ClassroomImportError
              ? error.message
              : 'Could not parse this file with the selected format.';
          return { teams: [], error: message };
        }
      },
      onConfirm: (formatId) => {
        try {
          const { teams, buckets } = classroomImportService.parseWithFormat(formatId, analysis.rows);
          workspaceService.importRosterIntoClassroom(classroom.id, teams);
          setupProgressService.markStepDone(classroom, 'importStudents');
          workspaceService.save(classroom);
          if (buckets && Object.keys(buckets).length > 0) {
            pendingImportBucketsByClassroomId.set(classroom.id, buckets);
          }
          advance();
        } catch (error) {
          const message = error instanceof ClassroomImportError ? error.message : 'Something went wrong importing that file.';
          window.alert(message);
        }
      },
      onCancel: () => {},
    });
  });

  const skipButton = document.createElement('button');
  skipButton.type = 'button';
  skipButton.className = 'btn btn--text';
  skipButton.textContent = 'Skip this step';
  skipButton.addEventListener('click', advance);

  const actions = document.createElement('div');
  actions.className = 'wizard-step__actions';
  actions.append(chooseButton, skipButton);

  content.append(actions, fileInput);
}

function renderAssignBucketsStep(content, classroom, { advance }) {
  const pendingBuckets = pendingImportBucketsByClassroomId.get(classroom.id) || null;
  const hasImportedBuckets = Boolean(pendingBuckets) && Object.keys(pendingBuckets).length > 0;

  if (hasImportedBuckets) {
    renderImportedBucketsPrompt(content, classroom, pendingBuckets, advance);
    return;
  }

  renderNoBucketDataPrompt(content, classroom, advance);
}

function renderImportedBucketsPrompt(content, classroom, pendingBuckets, advance) {
  const prompt = document.createElement('p');
  prompt.className = 'wizard-step__intro';
  prompt.textContent = 'We found learning bucket information. Would you like to import it?';
  content.appendChild(prompt);

  const actions = document.createElement('div');
  actions.className = 'wizard-step__actions';

  const importButton = document.createElement('button');
  importButton.type = 'button';
  importButton.className = 'btn btn--primary';
  importButton.textContent = 'Import Buckets';
  importButton.addEventListener('click', () => {
    bucketService.applyBucketsToClassroom(classroom, pendingBuckets);
    setupProgressService.markStepDone(classroom, 'assignBuckets');
    workspaceService.save(classroom);
    pendingImportBucketsByClassroomId.delete(classroom.id);
    advance();
  });

  const skipButton = document.createElement('button');
  skipButton.type = 'button';
  skipButton.className = 'btn btn--text';
  skipButton.textContent = 'Skip';
  skipButton.addEventListener('click', () => {
    pendingImportBucketsByClassroomId.delete(classroom.id);
    advance();
  });

  actions.append(importButton, skipButton);
  content.appendChild(actions);
}

function renderNoBucketDataPrompt(content, classroom, advance) {
  const prompt = document.createElement('p');
  prompt.className = 'wizard-step__intro';
  prompt.textContent = 'Would you like to assign learning buckets now?';
  content.appendChild(prompt);

  const actions = document.createElement('div');
  actions.className = 'wizard-step__actions';

  const assignNowButton = document.createElement('button');
  assignNowButton.type = 'button';
  assignNowButton.className = 'btn btn--primary';
  assignNowButton.textContent = 'Assign Now';
  assignNowButton.addEventListener('click', () => {
    content.innerHTML = '';
    renderManualBucketAssignment(content, classroom, advance);
  });

  const laterButton = document.createElement('button');
  laterButton.type = 'button';
  laterButton.className = 'btn btn--text';
  laterButton.textContent = 'Later';
  laterButton.addEventListener('click', advance);

  actions.append(assignNowButton, laterButton);
  content.appendChild(actions);
}

function renderManualBucketAssignment(content, classroom, advance) {
  const allStudents = classroom.teams.flatMap((team) => team.students);

  if (allStudents.length === 0) {
    const message = document.createElement('p');
    message.className = 'wizard-step__intro';
    message.textContent = 'There are no students to assign buckets to yet.';
    content.appendChild(message);

    const skipButton = document.createElement('button');
    skipButton.type = 'button';
    skipButton.className = 'btn btn--text';
    skipButton.textContent = 'Continue';
    skipButton.addEventListener('click', advance);
    content.appendChild(skipButton);
    return;
  }

  const table = document.createElement('div');
  table.className = 'wizard-bucket-table';

  const headerRow = document.createElement('div');
  headerRow.className = 'wizard-bucket-table__row wizard-bucket-table__row--header';
  const nameHeader = document.createElement('span');
  nameHeader.textContent = 'Student Name';
  const bucketHeader = document.createElement('span');
  bucketHeader.textContent = 'Bucket';
  headerRow.append(nameHeader, bucketHeader);
  table.appendChild(headerRow);

  const selections = new Map();

  allStudents.forEach((student) => {
    const row = document.createElement('div');
    row.className = 'wizard-bucket-table__row';

    const name = document.createElement('span');
    name.textContent = student.name;

    const select = document.createElement('select');
    const noneOption = document.createElement('option');
    noneOption.value = '';
    noneOption.textContent = '\u2014';
    select.appendChild(noneOption);
    BUCKET_KEYS.forEach((bucketKey) => {
      const option = document.createElement('option');
      option.value = bucketKey;
      option.textContent = BUCKET_LABELS[bucketKey];
      if (student.bucket === bucketKey) option.selected = true;
      select.appendChild(option);
    });

    selections.set(student, select);
    row.append(name, select);
    table.appendChild(row);
  });

  content.appendChild(table);

  const actions = document.createElement('div');
  actions.className = 'wizard-step__actions';

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'btn btn--primary';
  saveButton.textContent = 'Save & Continue';
  saveButton.addEventListener('click', () => {
    selections.forEach((select, student) => {
      bucketService.assignBucket(student, select.value || null);
    });
    setupProgressService.markStepDone(classroom, 'assignBuckets');
    workspaceService.save(classroom);
    advance();
  });

  actions.appendChild(saveButton);
  content.appendChild(actions);
}

function renderCustomizeGroupsStep(content, classroom, { advance }) {
  if (classroom.teams.length === 0) {
    const message = document.createElement('p');
    message.className = 'wizard-step__intro';
    message.textContent = 'No groups yet \u2014 import students first, or skip this step and add groups later from Settings.';
    content.appendChild(message);

    const skipButton = document.createElement('button');
    skipButton.type = 'button';
    skipButton.className = 'btn btn--text';
    skipButton.textContent = 'Skip this step';
    skipButton.addEventListener('click', advance);
    content.appendChild(skipButton);
    return;
  }

  const intro = document.createElement('p');
  intro.className = 'wizard-step__intro';
  intro.textContent = 'Rename groups or change their colour. Red, yellow, and green are reserved for Learning Buckets.';
  content.appendChild(intro);

  const rows = [];

  classroom.teams.forEach((team, index) => {
    const row = document.createElement('div');
    row.className = 'wizard-group-row';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'wizard-group-row__name';
    nameInput.value = team.name;

    let selectedColor = team.color || getDefaultGroupColor(index);
    const swatchWrapper = document.createElement('div');
    swatchWrapper.className = 'color-swatch-picker';

    DEFAULT_GROUP_COLORS.forEach((color) => {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'color-swatch' + (color.id === selectedColor ? ' color-swatch--selected' : '');
      swatch.style.backgroundColor = color.hex;
      swatch.title = color.label;
      swatch.setAttribute('aria-label', color.label);
      swatch.addEventListener('click', () => {
        selectedColor = color.id;
        swatchWrapper.querySelectorAll('.color-swatch').forEach((el) => el.classList.remove('color-swatch--selected'));
        swatch.classList.add('color-swatch--selected');
      });
      swatchWrapper.appendChild(swatch);
    });

    row.append(nameInput, swatchWrapper);
    content.appendChild(row);

    rows.push({ team, nameInput, getColor: () => selectedColor });
  });

  const actions = document.createElement('div');
  actions.className = 'wizard-step__actions';

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'btn btn--primary';
  saveButton.textContent = 'Save & Continue';
  saveButton.addEventListener('click', () => {
    rows.forEach(({ team, nameInput, getColor }) => {
      const newName = nameInput.value.trim();
      if (newName) teamService.renameTeam(classroom, team.id, newName);
      teamService.updateTeamColor(classroom, team.id, getColor());
    });
    setupProgressService.markStepDone(classroom, 'customizeGroups');
    workspaceService.save(classroom);
    advance();
  });

  const skipButton = document.createElement('button');
  skipButton.type = 'button';
  skipButton.className = 'btn btn--text';
  skipButton.textContent = 'Skip';
  skipButton.addEventListener('click', advance);

  actions.append(saveButton, skipButton);
  content.appendChild(actions);
}

function renderConfigureScoringStep(content, classroom, { advance }) {
  const currentSettings = scoringSettingsService.getScoringSettings(classroom);

  const intro = document.createElement('p');
  intro.className = 'wizard-step__intro';
  intro.textContent = 'Set the default point value and whether negative points are allowed. You can change these later.';
  content.appendChild(intro);

  const pointLabel = document.createElement('label');
  pointLabel.className = 'wizard-field';
  pointLabel.textContent = 'Default point value';
  const pointInput = document.createElement('input');
  pointInput.type = 'number';
  pointInput.min = '1';
  pointInput.value = currentSettings.defaultPointValue;
  pointLabel.appendChild(pointInput);
  content.appendChild(pointLabel);

  const negativeLabel = document.createElement('label');
  negativeLabel.className = 'wizard-checkbox-field';
  const negativeCheckbox = document.createElement('input');
  negativeCheckbox.type = 'checkbox';
  negativeCheckbox.checked = currentSettings.allowNegativePoints;
  negativeLabel.append(negativeCheckbox, document.createTextNode(' Allow negative points'));
  content.appendChild(negativeLabel);

  const actions = document.createElement('div');
  actions.className = 'wizard-step__actions';

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'btn btn--primary';
  saveButton.textContent = 'Save & Continue';
  saveButton.addEventListener('click', () => {
    const parsedValue = Number(pointInput.value);
    scoringSettingsService.updateScoringSettings(classroom, {
      defaultPointValue: Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 1,
      allowNegativePoints: negativeCheckbox.checked,
    });
    setupProgressService.markStepDone(classroom, 'configureScoring');
    workspaceService.save(classroom);
    advance();
  });

  const skipButton = document.createElement('button');
  skipButton.type = 'button';
  skipButton.className = 'btn btn--text';
  skipButton.textContent = 'Skip';
  skipButton.addEventListener('click', advance);

  actions.append(saveButton, skipButton);
  content.appendChild(actions);
}

function renderInviteTeachersStep(content, classroom, { finish }) {
  const intro = document.createElement('p');
  intro.className = 'wizard-step__intro';
  intro.textContent =
    "This adds another teacher to this classroom, with full access to students, scores, and settings — not a student invitation. If you're teaching solo, skip this. Looking to invite students? That's a separate code, in Settings \u2192 Student Access, once you've finished setup.";
  content.appendChild(intro);

  const codeDisplay = document.createElement('div');
  codeDisplay.className = 'invite-students-card__code';
  codeDisplay.textContent = classroom.classroomJoinCode || 'Generating…';
  content.appendChild(codeDisplay);

  const actions = document.createElement('div');
  actions.className = 'wizard-step__actions';

  const shareButton = document.createElement('button');
  shareButton.type = 'button';
  shareButton.className = 'btn btn--primary';
  shareButton.textContent = 'Share Code & Continue';
  shareButton.addEventListener('click', async () => {
    const code = classroom.classroomJoinCode;
    const shareText = `Join ${classroom.classroomName || 'our classroom'} on ClassMate as a co-teacher, with full access to students and scores. Classroom Code: ${code}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Join our classroom', text: shareText });
      } catch (error) {
        // Cancelled or unavailable — fall through to marking done anyway, the code is still visible on screen.
      }
    } else {
      try {
        await navigator.clipboard.writeText(shareText);
      } catch (error) {
        console.error('[SetupWizardView] Failed to copy join code:', error);
      }
    }
    setupProgressService.markStepDone(classroom, 'inviteTeachers');
    workspaceService.save(classroom);
    finish();
  });

  const skipButton = document.createElement('button');
  skipButton.type = 'button';
  skipButton.className = 'btn btn--text';
  skipButton.textContent = 'Skip — teaching solo';
  skipButton.addEventListener('click', finish);

  actions.append(shareButton, skipButton);
  content.appendChild(actions);
}
