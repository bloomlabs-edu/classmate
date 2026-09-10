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
 */

import { getNavigableWeekStarts, getWeekNavigationInfo } from '../../services/weeklyReportService.js';
import { formatWeekDateRange } from '../../utils/dateHelpers.js';
import { createBackButton } from '../components/BackButton.js';
import { createIcon } from '../components/Icon.js';

export function renderWeeklyReportsListView(container, { classroom, onSelectWeek, onBack, hideBackButton = false }) {
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
  const list = document.createElement('div');
  list.className = 'weekly-reports-list__cards';

  weekStarts.forEach((weekStart) => {
    const info = getWeekNavigationInfo(classroom, weekStart);
    const isRelativeLabel = info.weekLabel === 'This Week' || info.weekLabel === 'Last Week';

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'weekly-reports-list__card' + (info.isCurrentWeek ? ' weekly-reports-list__card--current' : '');
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

    card.appendChild(createIcon('arrow-right', { size: 18 }));

    list.appendChild(card);
  });

  wrapper.appendChild(list);
  container.appendChild(wrapper);
}
