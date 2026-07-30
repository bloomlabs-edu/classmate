/**
 * ui/views/LearningManagementView.js
 *
 * Learning Management, rebuilt from a genuinely clean slate — the
 * previous implementation (and everything reachable only from it —
 * see the now-deleted LearningRecordView.js and AddConceptsView.js)
 * is retired entirely, not patched further. This file starts at
 * Phase 1 of an explicit, incremental rebuild and does only what
 * Phase 1 asks for — nothing anticipated, nothing stubbed in early.
 *
 * Phase 1 (this file, right now): title, Back button, "+ Add
 * Subject." That's the whole screen. No subject list (there's nothing
 * to build one from yet), no click behavior on "+ Add Subject" (no
 * mode, no stub, no placeholder), no persistence, no other logic of
 * any kind.
 *
 * Phase 2 (next, not yet built): "+ Add Subject" opens Choose
 * Subject, reusing ui/components/SubjectPicker.js and
 * config/commonSubjectsConfig.js exactly as they already are —
 * chosen specifically to be kept through this rebuild since they're
 * generic and carry no assumption tied to the retired flow. Selecting
 * a subject there does nothing further yet — proving add, persist,
 * and render-only-what's-persisted, before curriculum selection
 * exists at all.
 *
 * Phase 3 (later): Choose Subject -> Choose Curriculum.
 * Phase 4 (later): curriculum selection initializes the Subject's
 * real data — Units, then Concepts — and eventually reconnects the
 * existing Resource Workspace (ui/views/ConceptWorkspaceView.js,
 * services/resourceService.js, models/Resource.js), all of which are
 * untouched and waiting, not rebuilt.
 *
 * Reused, unmodified, verified still reachable and appropriate before
 * being kept: services/curriculumIndexRepository.js and
 * services/curriculumLinkingService.js (Phase 3/4), models/LearningSubject.js,
 * models/LearningUnit.js, models/LearningConcept.js, and
 * services/learningRecordService.js / learningRecordTeacherService.js
 * (Phase 2 onward).
 */

import { createIcon } from '../components/Icon.js';

export function renderLearningManagementView(container, { classrooms, onBack }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'learning-management';

  const header = document.createElement('header');
  header.className = 'learning-management__header';

  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'btn btn--text';
  backButton.appendChild(createIcon('arrow-left'));
  backButton.append('Back to Dashboard');
  backButton.addEventListener('click', onBack);
  header.appendChild(backButton);

  const title = document.createElement('h1');
  title.className = 'learning-management__title';
  title.textContent = '\ud83d\udcda Learning Management';
  header.appendChild(title);

  wrapper.appendChild(header);

  const section = document.createElement('div');
  section.className = 'learning-management__section';

  const addSubjectButton = document.createElement('button');
  addSubjectButton.type = 'button';
  addSubjectButton.className = 'btn btn--primary';
  addSubjectButton.textContent = '+ Add Subject';
  // Deliberately no click handler yet — Phase 2 gives this button its
  // first real behavior. Not a stub, not a placeholder; simply absent
  // until there is something real for it to do.
  section.appendChild(addSubjectButton);

  wrapper.appendChild(section);

  container.appendChild(wrapper);
}
