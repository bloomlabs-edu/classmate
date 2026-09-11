/**
 * ui/views/ReportsView.js
 *
 * The Reports landing page — a real Bento-style launchpad into every
 * existing reporting surface (Recognition, Weekly Reports, Scoreboard
 * Archive), added specifically because none of those three previously
 * had one shared entry point: the sidebar's "Reports" nav item used to
 * jump straight past this and into Scoreboard Archive specifically
 * (see ui/components/TeacherPortalSidebar.js's own updated comment).
 *
 * Deliberately a launchpad, not a second dashboard: each tile shows
 * only a title, a one-line description, and — for Recognition only —
 * a cheap, already-in-memory preview stat (studentProgressService's
 * own synchronous getRecognitionWinners(), no Firestore fetch). Full
 * detail stays inside each destination screen, matching every other
 * "preview card -> full screen" pattern already established in this
 * app (Dashboard's own primary-module cards).
 *
 * Reuses the same asymmetric-grid Bento language
 * ui/views/LearningManagementView.js's own .learning-management__bento
 * established (a prominent tile + secondary tiles, not a uniform grid
 * of identical cards) rather than inventing a second Bento system —
 * see this file's own CSS block (`.reports-bento`), which follows the
 * same shape/tokens.
 */

import { createBackButton } from '../components/BackButton.js';
import { createIcon } from '../components/Icon.js';
import { RECOGNITION_CATEGORIES } from '../../config/recognitionCategories.js';
import * as studentProgressService from '../../services/studentProgressService.js';

function countRecognitionsThisWeek(classroom) {
  return RECOGNITION_CATEGORIES.filter((category) => category.periods.includes('week')).reduce(
    (total, category) => total + studentProgressService.getRecognitionWinners(classroom, category.id, 'week').length,
    0
  );
}

function createReportTile({ icon, title, description, preview, variant, onClick }) {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = `reports-bento__tile${variant ? ` reports-bento__tile--${variant}` : ''}`;
  tile.addEventListener('click', onClick);

  const iconBadge = document.createElement('span');
  iconBadge.className = 'reports-bento__tile-icon';
  iconBadge.appendChild(createIcon(icon, { size: variant === 'hero' ? 26 : 22, strokeWidth: 1.75 }));
  tile.appendChild(iconBadge);

  const titleEl = document.createElement('span');
  titleEl.className = 'reports-bento__tile-title';
  titleEl.textContent = title;
  tile.appendChild(titleEl);

  const descriptionEl = document.createElement('span');
  descriptionEl.className = 'reports-bento__tile-description';
  descriptionEl.textContent = description;
  tile.appendChild(descriptionEl);

  if (preview) {
    const previewEl = document.createElement('span');
    previewEl.className = 'reports-bento__tile-preview';
    previewEl.textContent = preview;
    tile.appendChild(previewEl);
  }

  return tile;
}

export function renderReportsView(container, { classroom, onBack, onOpenRecognition, onOpenWeeklyReports, onOpenScoreboardArchive }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'reports-view';

  const header = document.createElement('div');
  header.className = 'learning-management__header';
  header.appendChild(createBackButton(onBack));
  const title = document.createElement('h1');
  title.className = 'learning-management__title';
  title.textContent = 'Reports';
  header.appendChild(title);
  wrapper.appendChild(header);

  const bento = document.createElement('div');
  bento.className = 'reports-bento';

  const weeklyCount = countRecognitionsThisWeek(classroom);

  bento.appendChild(
    createReportTile({
      icon: 'trophy',
      title: 'Recognition',
      description: 'Who is being celebrated right now — Star Performer, Team Champion, and every current recognition.',
      preview: weeklyCount > 0 ? `${weeklyCount} recognition${weeklyCount === 1 ? '' : 's'} this week` : 'The week is just getting started',
      variant: 'hero',
      onClick: onOpenRecognition,
    })
  );

  bento.appendChild(
    createReportTile({
      icon: 'trending-up',
      title: 'Weekly Standing',
      description: 'Browse any past week’s recognitions and standings.',
      onClick: onOpenWeeklyReports,
    })
  );

  bento.appendChild(
    createReportTile({
      icon: 'history',
      title: 'Scoreboard Archive',
      description: 'Every past Standing Cycle, permanently preserved — scores, teams, and who was recognised.',
      onClick: onOpenScoreboardArchive,
    })
  );

  wrapper.appendChild(bento);
  container.appendChild(wrapper);
}
