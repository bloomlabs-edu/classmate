/**
 * ui/views/WeeklyReportsListView.js
 *
 * Weekly Reports — the week picker. Every navigable week, newest
 * (current) first, back through the earliest week any student in this
 * classroom has recorded history (see
 * services/weeklyReportService.js's own getNavigableWeekStarts() —
 * this view computes nothing itself). Tapping a week opens
 * ui/views/WeeklyReportDetailView.js for that week specifically.
 *
 * "One component, two consumers," matching this app's own established
 * Recognition pattern (ui/views/RecognitionScreenView.js /
 * ui/student-portal/views/StudentRecognitionView.js): the Teacher
 * Portal and Student Portal both render this exact same list —
 * `hideBackButton` is the only thing that differs, same convention
 * StudentRecognitionView.js already uses.
 *
 * Bento composition (browser-feedback pass, 2026-09-11, visual
 * refinement round): the current week is a hero card, the next few
 * are secondary cards, everything older collapses into a compact
 * historical grid — the same "hero + secondary + historical" language
 * ui/views/ScoreboardArchiveView.js's own landing page and
 * ui/views/ReportsView.js already use, not a fourth independent Bento
 * system.
 *
 * Recognition preview: a "week" here is a plain calendar range, not a
 * Standing Cycle — but Achievement Events carry a real `cycleId`
 * (a services/scoreboardArchiveService.js Archive id), so a week gets
 * a recognition preview only when a real archive's own `createdAt`
 * actually falls inside that week's Monday-Sunday span. This is
 * genuinely generic: whichever badge types have real events for that
 * archive appear, via the exact same
 * achievementService.groupEventsForRecognitionWall() the Recognition
 * Wall and Scoreboard Archive landing page already use — no
 * Winning-Team-Member-specific branch anywhere in this file.
 *
 * The Achievement Event fetch is wrapped defensively: this view is
 * also rendered for the Student Portal's own lower-trust, per-slot
 * anonymous identity, which is never a member of `classroom.memberUids`
 * (see firestore.rules' own achievementEvents rule) — a permission
 * error there is expected, not a bug, and simply means no recognition
 * previews render for that caller; the week list itself is completely
 * unaffected.
 */

import { getNavigableWeekStarts, getWeekNavigationInfo } from '../../services/weeklyReportService.js';
import { formatWeekDateRange, getWeekRange, isDateKeyInRange } from '../../utils/dateHelpers.js';
import * as scoreboardArchiveService from '../../services/scoreboardArchiveService.js';
import * as achievementService from '../../services/achievementService.js';
import { createBadge } from '../components/Badge.js';
import { BADGE_SIZES } from '../../config/badgeDefinitions.js';
import { createBackButton } from '../components/BackButton.js';
import { createIcon } from '../components/Icon.js';

export async function renderWeeklyReportsListView(container, { classroom, onSelectWeek, onBack, hideBackButton = false }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'weekly-reports-list';

  if (hideBackButton) {
    const title = document.createElement('h1');
    title.className = 'student-section__title';
    title.textContent = '📅 Weekly Reports';
    wrapper.appendChild(title);
  } else {
    const header = document.createElement('header');
    header.className = 'tracker-header';
    header.appendChild(createBackButton(onBack));
    const title = document.createElement('h1');
    title.className = 'tracker-header__title';
    title.textContent = '📅 Weekly Reports';
    header.appendChild(title);
    wrapper.appendChild(header);
  }

  const intro = document.createElement('p');
  intro.className = 'weekly-reports-list__intro';
  intro.textContent = 'A permanent record of the class’s week-by-week achievements — nothing here ever disappears, even after the scoreboard resets.';
  wrapper.appendChild(intro);

  const weekStarts = getNavigableWeekStarts(classroom);

  // See this file's own header comment — fails quietly for the
  // Student Portal's own lower-trust identity.
  let archives = [];
  let allEvents = [];
  try {
    [archives, allEvents] = await Promise.all([
      scoreboardArchiveService.listArchives(classroom.id),
      achievementService.listAllEvents(classroom.id),
    ]);
  } catch (error) {
    console.error('[WeeklyReportsListView] Failed to load recognition previews:', error);
  }

  const bento = document.createElement('div');
  bento.className = 'weekly-reports-list__bento';

  const [heroWeek, ...remaining] = weekStarts;
  const secondaryWeeks = remaining.slice(0, 3);
  const historicalWeeks = remaining.slice(3);

  if (heroWeek) {
    bento.appendChild(createWeekCard(heroWeek, classroom, archives, allEvents, onSelectWeek, 'hero'));
  }

  if (secondaryWeeks.length > 0) {
    const secondaryRow = document.createElement('div');
    secondaryRow.className = 'weekly-reports-list__secondary-row';
    secondaryWeeks.forEach((weekStart) => secondaryRow.appendChild(createWeekCard(weekStart, classroom, archives, allEvents, onSelectWeek, 'secondary')));
    bento.appendChild(secondaryRow);
  }

  if (historicalWeeks.length > 0) {
    const historicalGrid = document.createElement('div');
    historicalGrid.className = 'weekly-reports-list__historical-grid';
    historicalWeeks.forEach((weekStart) => historicalGrid.appendChild(createWeekCard(weekStart, classroom, archives, allEvents, onSelectWeek, 'compact')));
    bento.appendChild(historicalGrid);
  }

  wrapper.appendChild(bento);
  container.appendChild(wrapper);
}

/** The real Standing Cycle (if any) whose own close date falls inside this calendar week — see this file's own header comment on why a week and a cycle are related but distinct concepts. */
function findArchiveForWeek(weekStart, archives) {
  const range = getWeekRange(weekStart);
  return archives.find((archive) => isDateKeyInRange(archive.createdAt.slice(0, 10), range)) || null;
}

function createWeekCard(weekStart, classroom, archives, allEvents, onSelectWeek, variant) {
  const info = getWeekNavigationInfo(classroom, weekStart);
  const isRelativeLabel = info.weekLabel === 'This Week' || info.weekLabel === 'Last Week';

  const card = document.createElement('button');
  card.type = 'button';
  card.className = `weekly-reports-list__card weekly-reports-list__card--${variant}` + (info.isCurrentWeek ? ' weekly-reports-list__card--current' : '');
  card.addEventListener('click', () => onSelectWeek(weekStart));

  const textBlock = document.createElement('span');
  textBlock.className = 'weekly-reports-list__card-text';

  const label = document.createElement('span');
  label.className = 'weekly-reports-list__card-label';
  label.textContent = info.weekLabel;
  textBlock.appendChild(label);

  // Older weeks' own label IS already the date range (e.g. "Aug 24–28")
  // — only "This Week"/"Last Week" need the range spelled out
  // separately underneath, matching the product brief's own example.
  if (isRelativeLabel) {
    const sub = document.createElement('span');
    sub.className = 'weekly-reports-list__card-sub';
    sub.textContent = formatWeekDateRange(weekStart);
    textBlock.appendChild(sub);
  }

  card.appendChild(textBlock);

  if (info.isCurrentWeek) {
    const badge = document.createElement('span');
    badge.className = 'weekly-reports-list__card-badge';
    badge.textContent = 'Current';
    card.appendChild(badge);
  }

  // Recognition preview — only when a real Standing Cycle closed
  // during this week. Compact/historical cards keep this brief (badge
  // + count only); the hero/secondary variants have room for the
  // count spelled out.
  const archive = findArchiveForWeek(weekStart, archives);
  if (archive) {
    const cycleEvents = allEvents.filter((event) => event.cycleId === archive.id);
    const groups = achievementService.groupEventsForRecognitionWall(cycleEvents);
    if (groups.length > 0) {
      const recognizedCount = groups.reduce((sum, group) => sum + group.recipients.length, 0);
      const preview = document.createElement('span');
      preview.className = 'weekly-reports-list__card-recognition';
      const badgeSize = variant === 'compact' ? BADGE_SIZES.small : BADGE_SIZES.compact;
      groups.forEach((group) => {
        preview.appendChild(createBadge({ family: group.definition.family, recognitionType: group.definition.recognitionType, level: 1, size: badgeSize, showLevel: false }));
      });
      const countText = document.createElement('span');
      countText.textContent = `${recognizedCount} recognised`;
      preview.appendChild(countText);
      card.appendChild(preview);
    }
  }

  card.appendChild(createIcon('arrow-right', { size: 18 }));

  return card;
}
