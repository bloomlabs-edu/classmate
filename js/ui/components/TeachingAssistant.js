/**
 * ui/components/TeachingAssistant.js
 *
 * A self-contained component that renders exactly one thing: whatever
 * services/recommendationEngine.js's getTopRecommendation() returns
 * for this classroom, or nothing at all if nothing applies. The
 * dashboard mounts this once, above its own single, unbranched
 * content — this component can be deleted or replaced entirely
 * without the dashboard itself needing any changes, and the dashboard
 * has zero awareness of setup state, recommendations, or priorities.
 *
 * Priority does double duty, deliberately, rather than needing a
 * separate "tier" concept: >=80 renders as a full, prominent card;
 * 30-79 renders as a compact strip; nothing applicable renders
 * nothing. This is what gives the "gradually steps back" feel
 * without a second mechanism bolted on top of priority.
 *
 * Dismissal is per-recommendation, keyed by the recommendation's
 * stable `id` (see classroom.dismissedRecommendations) — dismissing
 * one recommendation never suppresses an unrelated one, including any
 * added in a future phase.
 */

import * as setupStateService from '../../services/setupStateService.js';
import * as recommendationEngine from '../../services/recommendationEngine.js';
import * as workspaceService from '../../services/workspaceService.js';

export async function renderTeachingAssistant(container, { classroom, onOpenSettingsStudents, onOpenStudentAccess, onOpenSettingsGroups, onOpenSettingsNotebooks, onDismiss }) {
  container.innerHTML = '';

  const setupState = await setupStateService.getSetupState(classroom);
  const dismissedIds = classroom.dismissedRecommendations || [];

  const recommendation = recommendationEngine.getTopRecommendation(setupState, dismissedIds, {
    onOpenSettingsStudents,
    onOpenStudentAccess,
    onOpenSettingsGroups,
    onOpenSettingsNotebooks,
  });

  if (!recommendation) return; // nothing applies — render nothing, not an empty shell

  const isFullCard = recommendation.priority >= 80;

  const card = document.createElement('div');
  card.className = 'teaching-assistant' + (isFullCard ? ' teaching-assistant--full' : ' teaching-assistant--compact');

  const textBlock = document.createElement('div');
  textBlock.className = 'teaching-assistant__text';

  const title = document.createElement('p');
  title.className = 'teaching-assistant__title';
  title.textContent = recommendation.title;
  textBlock.appendChild(title);

  if (isFullCard) {
    const description = document.createElement('p');
    description.className = 'teaching-assistant__description';
    description.textContent = recommendation.description;
    textBlock.appendChild(description);
  }

  card.appendChild(textBlock);

  const actions = document.createElement('div');
  actions.className = 'teaching-assistant__actions';

  recommendation.actions.forEach(({ label, onNavigate }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = isFullCard ? 'btn btn--primary' : 'btn btn--ghost';
    button.textContent = label;
    button.addEventListener('click', onNavigate);
    actions.appendChild(button);
  });

  if (recommendation.dismissible) {
    const dismissButton = document.createElement('button');
    dismissButton.type = 'button';
    dismissButton.className = 'btn btn--text';
    dismissButton.textContent = 'Dismiss';
    dismissButton.setAttribute('aria-label', `Dismiss: ${recommendation.title}`);
    dismissButton.addEventListener('click', () => {
      classroom.dismissedRecommendations = [...dismissedIds, recommendation.id];
      workspaceService.save(classroom);
      onDismiss?.();
    });
    actions.appendChild(dismissButton);
  }

  card.appendChild(actions);
  container.appendChild(card);
}
