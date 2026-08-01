/**
 * ui/views/RecognitionScreenView.js
 *
 * The dedicated Recognition Screen — the "depth" counterpart to the
 * Dashboard's Recognition Wall (see ui/components/RecognitionWidget.js).
 * One category in focus at a time, its full leaderboard, and every
 * period — reached via the Wall's "View All" link or a direct/shared URL.
 *
 * Answers, for whichever category/period is selected:
 *   Who is being celebrated?          -> the Recognition Card
 *   Why are they being celebrated?    -> the Card's reasonText
 *   What time period is this for?     -> the period tabs + Card's period line
 *   How can I explore other recognitions? -> the category chips, grouped
 *
 * Categories are grouped by config/recognitionCategories.js's `group`
 * field (Performance / Growth / Team / Special Recognition) rather than
 * shown as one flat list, so a teacher can see at a glance that
 * recognition isn't just "who scored the most" — Special Recognition's
 * placeholders render as visibly-disabled chips, communicating "more is
 * coming" without any computed data behind them yet.
 *
 * The leaderboard for the selected category/period is embedded directly
 * below its Card (not a separate tab) and expands/collapses in place via
 * ui/components/LeaderboardList.js — never a separate page, keeping this
 * screen self-contained.
 */

import {
  RECOGNITION_CATEGORIES,
  FUTURE_RECOGNITION_PLACEHOLDERS,
  RECOGNITION_GROUP_LABELS,
  RECOGNITION_GROUP_ORDER,
  listRecognitionCategoriesForPeriod,
} from '../../config/recognitionCategories.js';
import * as studentProgressService from '../../services/studentProgressService.js';
import { createRecognitionCardElement } from '../components/RecognitionCard.js';
import { createLeaderboardListElement } from '../components/LeaderboardList.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { createBackButton } from '../components/BackButton.js';

const PERIOD_TABS = [
  { id: 'week', label: 'This Week' },
  { id: 'month', label: 'This Month' },
  { id: 'all_time', label: 'All Time' },
];

function formatLeaderboardValue(category) {
  return (entry) => {
    switch (category.resolverId) {
      case 'stars':
      case 'team_stars':
        return `${entry.stars} \u2b50`;
      case 'streak':
        return `${entry.streak}\u2011day`;
      case 'notebook_completion':
        return `${entry.completionPercent}%`;
      case 'biggest_climber':
        return `+${entry.movement}`;
      default:
        return '';
    }
  };
}

export function renderRecognitionScreenView(container, props) {
  const { classroom, onBack, onNavigatePeriod, onNavigateCategory, onSelectStudent } = props;
  const period = PERIOD_TABS.some((tab) => tab.id === props.period) ? props.period : 'week';

  const availableForPeriod = listRecognitionCategoriesForPeriod(period);
  const categoryId = availableForPeriod.some((category) => category.id === props.categoryId)
    ? props.categoryId
    : availableForPeriod[0]?.id;

  // The currently selected category doesn't support this period (e.g. an
  // old link to Biggest Climber + All Time) — redirect to a valid
  // combination rather than silently rendering something else at the
  // same URL.
  if (categoryId && categoryId !== props.categoryId) {
    onNavigateCategory(period, categoryId);
    return;
  }

  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'recognition-screen';

  const header = document.createElement('header');
  header.className = 'tracker-header';
  const backButton = createBackButton(onBack);
  const title = document.createElement('h1');
  title.className = 'tracker-header__title';
  title.textContent = '\ud83c\udfc6 Recognition';
  header.append(backButton, title);
  wrapper.appendChild(header);

  const periodTabs = document.createElement('div');
  periodTabs.className = 'recognition-screen__period-tabs';
  PERIOD_TABS.forEach((tab) => {
    const tabButton = document.createElement('button');
    tabButton.type = 'button';
    tabButton.className = 'toggle-group__button' + (tab.id === period ? ' toggle-group__button--active' : '');
    tabButton.textContent = tab.label;
    tabButton.addEventListener('click', () => onNavigatePeriod(tab.id));
    periodTabs.appendChild(tabButton);
  });
  wrapper.appendChild(periodTabs);

  const content = document.createElement('div');
  content.className = 'wizard-step-content';

  RECOGNITION_GROUP_ORDER.forEach((groupId) => {
    const realCategoriesInGroup = RECOGNITION_CATEGORIES.filter((category) => category.group === groupId);
    const placeholdersInGroup = FUTURE_RECOGNITION_PLACEHOLDERS.filter((placeholder) => placeholder.group === groupId);

    if (realCategoriesInGroup.length === 0 && placeholdersInGroup.length === 0) return;

    const groupHeading = document.createElement('h3');
    groupHeading.className = 'dashboard-widget__subheading';
    groupHeading.textContent = RECOGNITION_GROUP_LABELS[groupId];
    content.appendChild(groupHeading);

    const chipRow = document.createElement('div');
    chipRow.className = 'dashboard-widget__chip-list';

    realCategoriesInGroup.forEach((category) => {
      const supportsPeriod = category.periods.includes(period);
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className =
        'dashboard-widget__chip recognition-screen__category-chip' +
        (category.id === categoryId ? ' recognition-screen__category-chip--active' : '');
      chip.textContent = `${category.icon} ${category.label}`;
      chip.disabled = !supportsPeriod;
      if (!supportsPeriod) chip.title = `Not available for ${PERIOD_TABS.find((tab) => tab.id === period).label}`;
      chip.addEventListener('click', () => onNavigateCategory(period, category.id));
      chipRow.appendChild(chip);
    });

    placeholdersInGroup.forEach((placeholder) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'dashboard-widget__chip recognition-screen__category-chip';
      chip.textContent = `${placeholder.icon} ${placeholder.label}`;
      chip.disabled = true;
      chip.title = 'Coming soon';
      chipRow.appendChild(chip);
    });

    content.appendChild(chipRow);
  });

  const selectedCategory = RECOGNITION_CATEGORIES.find((category) => category.id === categoryId);

  if (!selectedCategory) {
    content.appendChild(createEmptyStateElement({ message: 'No recognition categories are configured yet.' }));
    wrapper.appendChild(content);
    container.appendChild(wrapper);
    return;
  }

  const winners = studentProgressService.getRecognitionWinners(classroom, selectedCategory.id, period);
  const leaderboard = studentProgressService.getLeaderboard(classroom, selectedCategory.id, period);

  const detailArea = document.createElement('div');
  detailArea.className = 'recognition-screen__detail';

  if (winners.length === 0) {
    const periodLabel = PERIOD_TABS.find((tab) => tab.id === period).label.toLowerCase();
    detailArea.appendChild(
      createEmptyStateElement({ message: `No ${selectedCategory.label} yet ${periodLabel} \u2014 check back soon.` })
    );
  } else {
    detailArea.appendChild(createRecognitionCardElement({ category: selectedCategory, winners, period, variant: 'full', onSelectStudent }));
  }

  const leaderboardHeading = document.createElement('h3');
  leaderboardHeading.className = 'dashboard-widget__subheading';
  leaderboardHeading.textContent = `Leaderboard \u2014 ${selectedCategory.label}`;
  detailArea.appendChild(leaderboardHeading);

  detailArea.appendChild(createLeaderboardListElement({ entries: leaderboard, formatValue: formatLeaderboardValue(selectedCategory), onSelectStudent }));

  content.appendChild(detailArea);
  wrapper.appendChild(content);
  container.appendChild(wrapper);
}
