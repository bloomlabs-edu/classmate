/**
 * ui/views/StudentAccessView.js
 *
 * A dedicated page answering the teacher's actual question: "which
 * parents have already connected?" — connection status first, PIN as
 * secondary information you expand into, not the headline. Reorganized
 * from an earlier version of this page that led with the PIN/credential
 * itself; that answered "what's this student's PIN" well but made the
 * more common question ("who still needs onboarding?") something a
 * teacher had to work out by scanning raw codes rather than being told
 * directly. See this project's CHANGELOG for the full reasoning.
 *
 * Every PIN/link action here still calls services/studentIdentityService.js
 * — nothing about how PINs or invitation links actually work changed,
 * only what's shown first and what's tucked behind "Manage."
 */

import * as studentIdentityService from '../../services/studentIdentityService.js';
import { showToast } from '../components/Toast.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { getDisplayName } from '../../services/classroomService.js';

export async function renderStudentAccessView(container, { classroom, onBack }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'tracker-view';

  const header = document.createElement('header');
  header.className = 'tracker-header';

  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'btn btn--text';
  backButton.textContent = '\u2190 Back';
  backButton.addEventListener('click', onBack);

  const titleBlock = document.createElement('div');
  titleBlock.className = 'tracker-header__title-block';
  const title = document.createElement('h1');
  title.className = 'tracker-header__title';
  title.textContent = 'Student Access';
  const subtitle = document.createElement('p');
  subtitle.className = 'tracker-header__subtitle';
  subtitle.textContent = getDisplayName(classroom);
  titleBlock.append(title, subtitle);

  header.append(backButton, titleBlock);
  wrapper.appendChild(header);

  const note = document.createElement('p');
  note.className = 'profile-section__meta';
  note.style.padding = '0 1.5rem';
  note.textContent = 'Which parents have connected, and who still needs an invitation.';
  wrapper.appendChild(note);

  const allStudents = classroom.teams.flatMap((team) => team.students.map((student) => ({ student, team })));
  const content = document.createElement('div');
  content.className = 'wizard-step-content';

  if (allStudents.length === 0) {
    content.appendChild(createEmptyStateElement({ message: 'There are no students in this classroom yet.' }));
  } else {
    const list = document.createElement('div');
    list.className = 'student-access-list';

    // Resolved up front so rows can render in one pass, sorted with
    // not-yet-linked students first — those are the ones actually
    // needing the teacher's attention right now.
    const rowsData = await Promise.all(
      allStudents.map(async ({ student, team }) => ({
        student,
        team,
        isLinked: await studentIdentityService.isStudentLinked(classroom.id, student.id),
      }))
    );
    rowsData.sort((a, b) => Number(a.isLinked) - Number(b.isLinked));

    rowsData.forEach(({ student, team, isLinked }) => {
      list.appendChild(
        createStudentAccessRow(classroom, student, team, isLinked, () => renderStudentAccessView(container, { classroom, onBack }))
      );
    });
    content.appendChild(list);
  }

  wrapper.appendChild(content);
  container.appendChild(wrapper);
}

function createStudentAccessRow(classroom, student, team, isLinked, rerender) {
  const row = document.createElement('div');
  row.className = 'student-access-row';

  const nameBlock = document.createElement('div');
  nameBlock.className = 'student-access-row__main';

  const nameEl = document.createElement('p');
  nameEl.className = 'student-access-row__name';
  nameEl.textContent = team ? `${student.name} \u00b7 ${team.name}` : student.name;
  nameBlock.appendChild(nameEl);

  const statusEl = document.createElement('p');
  statusEl.className = 'student-access-row__status' + (isLinked ? ' student-access-row__status--linked' : '');
  statusEl.textContent = isLinked ? '\u2705 Linked' : '\u23f3 Not Linked';
  nameBlock.appendChild(statusEl);

  row.appendChild(nameBlock);

  const actions = document.createElement('div');
  actions.className = 'student-access-row__actions';

  // Demo-only lookup by name, since the fixture repository doesn't
  // index PINs by this app's real classroom/student ids — a
  // production repository would read the PIN directly off the student
  // object instead (see repositories/identity/StudentLinkRepository.js's
  // own doc comment on where a PIN actually lives in that model).
  const demoEntry = studentIdentityService.listDemoRoster().find((entry) => entry.studentName === student.name);

  if (isLinked) {
    // Linked students get a single, low-key "Manage" action — the PIN
    // isn't the headline once a parent's already connected; expanding
    // reveals it only if the teacher actually needs to reset access.
    const manageButton = document.createElement('button');
    manageButton.type = 'button';
    manageButton.className = 'btn btn--ghost';
    manageButton.textContent = 'Manage';
    manageButton.addEventListener('click', () => {
      const details = row.querySelector('.student-access-row__details');
      details.hidden = !details.hidden;
    });
    actions.appendChild(manageButton);
  } else {
    // Not-yet-linked students get the primary action front and
    // center: send the invitation. This is the actual bottleneck the
    // teacher is trying to clear.
    const shareButton = document.createElement('button');
    shareButton.type = 'button';
    shareButton.className = 'btn btn--primary';
    shareButton.textContent = 'Share Invitation';
    shareButton.disabled = !demoEntry;
    shareButton.addEventListener('click', () => shareInvitation(classroom, student, demoEntry));
    actions.appendChild(shareButton);

    const detailsToggle = document.createElement('button');
    detailsToggle.type = 'button';
    detailsToggle.className = 'btn btn--ghost';
    detailsToggle.textContent = 'PIN';
    detailsToggle.addEventListener('click', () => {
      const details = row.querySelector('.student-access-row__details');
      details.hidden = !details.hidden;
    });
    actions.appendChild(detailsToggle);
  }

  row.appendChild(actions);

  // The secondary, expandable area — PIN plus Generate/Reset/Copy,
  // hidden by default. This is exactly the information the earlier
  // version of this page led with; it's still fully available, just
  // no longer the first thing a teacher has to parse.
  const details = document.createElement('div');
  details.className = 'student-access-row__details';
  details.hidden = true;

  const pinValue = document.createElement('span');
  pinValue.className = 'student-access-row__pin';
  pinValue.textContent = demoEntry ? demoEntry.pin : 'Not available in this demo roster';
  details.appendChild(pinValue);

  const generateButton = document.createElement('button');
  generateButton.type = 'button';
  generateButton.className = 'btn btn--ghost';
  generateButton.textContent = demoEntry ? 'Reset PIN' : 'Generate PIN';
  generateButton.disabled = !demoEntry;
  generateButton.addEventListener('click', async () => {
    await studentIdentityService.generatePinForStudent(classroom.id, demoEntry.studentId);
    showToast('New PIN generated');
    rerender();
  });
  details.appendChild(generateButton);

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'btn btn--ghost';
  copyButton.textContent = 'Copy PIN';
  copyButton.disabled = !demoEntry;
  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(demoEntry.pin);
      copyButton.textContent = 'Copied!';
      setTimeout(() => { copyButton.textContent = 'Copy PIN'; }, 1500);
    } catch (error) {
      console.error('[StudentAccessView] Failed to copy PIN:', error);
      window.alert(`Student PIN: ${demoEntry.pin}`);
    }
  });
  details.appendChild(copyButton);

  row.appendChild(details);
  return row;
}

async function shareInvitation(classroom, student, demoEntry) {
  if (!demoEntry) return;
  const token = await studentIdentityService.generateInvitationTokenForStudent(classroom.id, demoEntry.studentId, 7);
  const link = `${window.location.origin}${window.location.pathname}#/student?token=${token}`;
  const shareText = `Link your Google account to ${student.name} on Bloom Labs: ${link}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Bloom Labs Student Portal', text: shareText, url: link });
      return;
    } catch (error) {
      // User cancelled the native share sheet, or it's unavailable — fall through to copy.
    }
  }
  try {
    await navigator.clipboard.writeText(link);
    showToast('Invitation link copied \u2014 expires in 7 days, single use');
  } catch (error) {
    console.error('[StudentAccessView] Failed to copy invitation link:', error);
    window.alert(shareText);
  }
}
