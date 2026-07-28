/**
 * ui/components/ClassroomHeader.js
 *
 * A slot-based header, used at the top of the Classroom Dashboard.
 * Deliberately generic rather than coupled to any specific widget:
 *
 *   ClassroomHeader
 *   ├── Primary Action     — the single highest-frequency action
 *   ├── Secondary Content  — supporting, glanceable content
 *   └── Classroom Context  — classroom name/subtitle
 *
 * As of the Information Architecture milestone, ui/views/DashboardView.js
 * no longer fills either action slot — both "Start Class Mode" and the
 * "📚 Curriculum" button that used to live here are now two of the
 * three equally-weighted primary-module cards rendered just below this
 * header instead (see renderPrimaryModulesSection() in that file).
 * This component's slots remain fully functional and unchanged; a
 * future phase is free to fill either one again without this file
 * changing at all.
 */

export function createClassroomHeaderElement({ classroomContext, primaryAction, secondaryContent }) {
  const header = document.createElement('header');
  header.className = 'tracker-header classroom-header';

  const contextBlock = document.createElement('div');
  contextBlock.className = 'classroom-header__context';
  contextBlock.appendChild(classroomContext);
  header.appendChild(contextBlock);

  if (primaryAction) {
    const primaryBlock = document.createElement('div');
    primaryBlock.className = 'classroom-header__primary-action';
    primaryBlock.appendChild(primaryAction);
    header.appendChild(primaryBlock);
  }

  if (secondaryContent) {
    const secondaryBlock = document.createElement('div');
    secondaryBlock.className = 'classroom-header__secondary-content';
    secondaryBlock.appendChild(secondaryContent);
    header.appendChild(secondaryBlock);
  }

  return header;
}
