/**
 * ui/components/ChapterPlanResourcePickerModal.js
 *
 * The Chapter Plan Editor's own "📎 Attach Resource" entry point —
 * browse this classroom's existing Resource library (see
 * models/Resource.js, services/resourceRepository.js) and attach one to
 * the current Chapter Plan via a lightweight
 * models/ChapterPlanResourceLink.js, or create a brand-new Resource and
 * attach it in the same step. NEVER creates a second Resource system,
 * NEVER copies a Resource's own content, and NEVER grants write access
 * to it — attaching only ever appends a reference (see
 * services/chapterPlanService.js's own addResourceLink()).
 *
 * Scope, deliberately: browsing is limited to THIS classroom's own
 * Resource library (repositories = services/resourceRepository.js's
 * getResourcesForClassroom(), the only fetch this app's Resource system
 * offers — see that file's own header comment). Cross-classroom
 * Resource attachment is still fully SUPPORTED by the data model
 * (models/ChapterPlanResourceLink.js carries its own `classroomId` for
 * exactly this reason) and enforced correctly by firestore.rules — a
 * Fellow can still end up with a resourceLink pointing at another
 * classroom's Resource (e.g. copied by hand, or via a future Spark's
 * own `resourceRefs`) — this modal simply doesn't build a cross-
 * classroom Resource BROWSER in this phase, per the explicit "Sparks
 * and Resources... no generalized search infrastructure" scope. A
 * future phase could add "browse resources referenced by relevant
 * Sparks" as a second tab here without changing this file's own
 * attach/create actions at all.
 */

import * as resourceRepository from '../../services/resourceRepository.js';
import { createResource } from '../../models/Resource.js';
import { RESOURCE_TYPE_KEYS, getResourceTypeLabel } from '../../config/resourceTypeConfig.js';
import * as chapterPlanService from '../../services/chapterPlanService.js';
import * as chapterPlanRepository from '../../repositories/chapterPlanRepository.js';

/**
 * @param {object} options
 * @param {object} options.classroom
 * @param {object} options.chapterPlan
 * @param {string} options.currentUserUid
 * @param {(chapterPlan: object) => void} options.onResourceAttached
 */
export function openChapterPlanResourcePickerModal({ classroom, chapterPlan, currentUserUid, onResourceAttached }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal modal--wide';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Attach Resource');

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  function close() {
    overlay.remove();
  }
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  let resources = null; // null = loading
  let loadError = null;
  let feedback = '';
  let feedbackIsError = false;

  async function attachExisting(resource) {
    feedback = '';
    try {
      chapterPlanService.addResourceLink(chapterPlan, {
        classroomId: classroom.id,
        resourceId: resource.id,
        resourceType: resource.type,
        addedBy: currentUserUid,
      });
      await chapterPlanRepository.saveChapterPlan(classroom.id, chapterPlan);
      feedbackIsError = false;
      feedback = `“${resource.title}” attached to this Chapter Plan.`;
      onResourceAttached(chapterPlan);
      render();
    } catch (error) {
      feedbackIsError = true;
      feedback = error.message || "Couldn't attach this Resource. Try again.";
      render();
    }
  }

  async function createAndAttach({ title, type, url }) {
    feedback = '';
    try {
      const content = type === 'external_link' ? { url, description: null } : null;
      const resource = createResource({ title, type, content, audience: 'teacher' });
      await resourceRepository.saveResource(classroom.id, resource);
      resources = [resource, ...(resources || [])];
      await attachExisting(resource);
    } catch (error) {
      feedbackIsError = true;
      feedback = error.message || "Couldn't create this Resource. Try again.";
      render();
    }
  }

  function render() {
    modal.innerHTML = '';

    const heading = document.createElement('h2');
    heading.className = 'modal__heading';
    heading.textContent = '📎 Attach Resource';
    modal.appendChild(heading);

    if (feedback) {
      const feedbackEl = document.createElement('p');
      feedbackEl.className = `chapter-plan-resource-picker__feedback${feedbackIsError ? ' chapter-plan-resource-picker__feedback--error' : ' chapter-plan-resource-picker__feedback--success'}`;
      feedbackEl.textContent = feedback;
      modal.appendChild(feedbackEl);
    }

    modal.appendChild(renderExistingResourcesSection());
    modal.appendChild(renderCreateResourceSection());

    const actions = document.createElement('div');
    actions.className = 'modal__actions';
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'btn btn--text';
    closeButton.textContent = 'Close';
    closeButton.addEventListener('click', close);
    actions.appendChild(closeButton);
    modal.appendChild(actions);
  }

  function renderExistingResourcesSection() {
    const section = document.createElement('div');
    section.className = 'chapter-plan-resource-picker__section';

    const heading = document.createElement('h3');
    heading.className = 'chapter-plan-resource-picker__section-heading';
    heading.textContent = 'Existing Resources in this classroom';
    section.appendChild(heading);

    if (loadError) {
      const error = document.createElement('p');
      error.textContent = loadError;
      section.appendChild(error);
      return section;
    }

    if (resources === null) {
      const loading = document.createElement('p');
      loading.textContent = 'Loading…';
      section.appendChild(loading);
      return section;
    }

    const alreadyAttachedIds = new Set((chapterPlan.resourceLinks || []).map((link) => link.resourceId));

    if (resources.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'chapter-plan-resource-picker__section-empty';
      empty.textContent = 'No Resources in this classroom yet — create one below.';
      section.appendChild(empty);
      return section;
    }

    const list = document.createElement('div');
    list.className = 'chapter-plan-resource-picker__card-list';
    resources.forEach((resource) => {
      const card = document.createElement('div');
      card.className = 'chapter-plan-resource-picker__card';

      const title = document.createElement('span');
      title.className = 'chapter-plan-resource-picker__card-title';
      title.textContent = resource.title || 'Untitled Resource';
      card.appendChild(title);

      const meta = document.createElement('span');
      meta.className = 'chapter-plan-resource-picker__card-meta';
      meta.textContent = getResourceTypeLabel(resource.type);
      card.appendChild(meta);

      const isAttached = alreadyAttachedIds.has(resource.id);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn--secondary chapter-plan-resource-picker__card-attach-button';
      button.textContent = isAttached ? 'Attached' : 'Attach';
      button.disabled = isAttached;
      button.addEventListener('click', () => attachExisting(resource));
      card.appendChild(button);

      list.appendChild(card);
    });
    section.appendChild(list);

    return section;
  }

  function renderCreateResourceSection() {
    const section = document.createElement('div');
    section.className = 'chapter-plan-resource-picker__section';

    const heading = document.createElement('h3');
    heading.className = 'chapter-plan-resource-picker__section-heading';
    heading.textContent = 'Create a new Resource';
    section.appendChild(heading);

    const titleLabel = document.createElement('label');
    titleLabel.className = 'modal__label';
    titleLabel.textContent = 'Title';
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'modal__input';
    titleLabel.appendChild(titleInput);
    section.appendChild(titleLabel);

    const typeLabel = document.createElement('label');
    typeLabel.className = 'modal__label';
    typeLabel.textContent = 'Type';
    const typeSelect = document.createElement('select');
    typeSelect.className = 'modal__input';
    RESOURCE_TYPE_KEYS.forEach((typeKey) => {
      const option = document.createElement('option');
      option.value = typeKey;
      option.textContent = getResourceTypeLabel(typeKey);
      typeSelect.appendChild(option);
    });
    typeSelect.value = 'external_link';
    typeLabel.appendChild(typeSelect);
    section.appendChild(typeLabel);

    const urlLabel = document.createElement('label');
    urlLabel.className = 'modal__label';
    urlLabel.textContent = 'Link (for External Link)';
    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.className = 'modal__input';
    urlInput.placeholder = 'https://…';
    urlLabel.appendChild(urlInput);
    section.appendChild(urlLabel);

    const createButton = document.createElement('button');
    createButton.type = 'button';
    createButton.className = 'btn btn--primary';
    createButton.textContent = 'Create & Attach';
    createButton.addEventListener('click', () => {
      if (!titleInput.value.trim()) return;
      createAndAttach({ title: titleInput.value.trim(), type: typeSelect.value, url: urlInput.value.trim() });
    });
    section.appendChild(createButton);

    return section;
  }

  render();

  resourceRepository
    .getResourcesForClassroom(classroom.id)
    .then((fetched) => {
      resources = fetched.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      render();
    })
    .catch((error) => {
      console.error('[ChapterPlanResourcePickerModal] Failed to load resources:', error);
      loadError = "Couldn't load Resources. Check your connection and try again.";
      render();
    });
}
