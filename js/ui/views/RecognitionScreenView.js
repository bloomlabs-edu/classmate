/**
 * ui/views/RecognitionScreenView.js
 *
 * The dedicated Recognition Screen — "celebrate achievement," not
 * "configure a recognition filter." A ClassMate Bento composition:
 * one dominant hero tile (the currently selected category's winner),
 * grouped supporting tiles for every other recognition (Performance /
 * Growth / Team), a quiet strip for not-yet-defined Special
 * Recognition placeholders, a small Weekly Reports tile, and the full
 * leaderboard underneath — in that priority order, matching this
 * screen's own product goal: the achievement comes first, exploring
 * other categories comes second.
 *
 * REDESIGN SCOPE — this file changed how the page is laid out and
 * styled. It did NOT change:
 *   - which categories exist (config/recognitionCategories.js,
 *     untouched)
 *   - how a winner/leaderboard is computed
 *     (services/studentProgressService.js's getRecognitionWinners()/
 *     getLeaderboard(), called exactly as before, same arguments)
 *   - this function's own external contract (props in, routes,
 *     onNavigatePeriod/onNavigateCategory/onSelectStudent/onBack/
 *     onOpenWeeklyReports) — ui/student-portal/views/
 *     StudentRecognitionView.js and main.js's own teacher route both
 *     keep working unmodified.
 *
 * Recognition category icons stay as the emoji already defined per
 * category (category.icon) — see docs/icon-design-guide.md's own
 * explicit rule: "Don't use an icon for celebration, recognition, or
 * emotion... An outline icon is calm and neutral by design; that's
 * exactly wrong for a moment that's supposed to feel warm." Only
 * genuinely wayfinding elements introduced here (the Weekly Reports
 * tile, the row-select arrow) use the outline ui/components/Icon.js
 * system — the same "which role is this glyph playing" distinction
 * that guide draws between a celebratory 🏅 and a navigational
 * `award` icon.
 *
 * Colour: each recognition GROUP borrows the exact existing
 * ICON_CATEGORIES tint already used across the app — Performance uses
 * 'recognition' (gold, already tied to trophy/star imagery), Growth
 * uses 'progress' (green), Team uses 'groups' (teal) — reusing
 * ui/components/Icon.js's own token set rather than inventing a new
 * palette. The hero tile is the one place that colour goes
 * full-bleed; every supporting tile stays a quiet, neutral surface —
 * "colour used deliberately for recognition," never decoration.
 */

import {
  RECOGNITION_CATEGORIES,
  FUTURE_RECOGNITION_PLACEHOLDERS,
  RECOGNITION_GROUPS,
  RECOGNITION_GROUP_LABELS,
  RECOGNITION_GROUP_ORDER,
  listRecognitionCategoriesForPeriod,
} from '../../config/recognitionCategories.js';
import * as studentProgressService from '../../services/studentProgressService.js';
import { formatKeyStatistic } from '../components/RecognitionCard.js';
import { createLeaderboardListElement } from '../components/LeaderboardList.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { createBackButton } from '../components/BackButton.js';
import { createIcon, ICON_CATEGORIES } from '../components/Icon.js';

const PERIOD_TABS = [
  { id: 'week', label: 'This Week' },
  { id: 'month', label: 'This Month' },
  { id: 'all_time', label: 'All Time' },
];

/** Reuses the exact existing ICON_CATEGORIES tokens (Icon.js) rather than a new palette — see this file's own header comment. */
const GROUP_COLOR_CATEGORY = {
  [RECOGNITION_GROUPS.PERFORMANCE]: 'recognition',
  [RECOGNITION_GROUPS.GROWTH]: 'progress',
  [RECOGNITION_GROUPS.TEAM]: 'groups',
  [RECOGNITION_GROUPS.SPECIAL]: 'settings',
};

/** Unchanged — same formatting this screen has always used for the leaderboard's own value column. */
function formatLeaderboardValue(category) {
  return (entry) => {
    switch (category.resolverId) {
      case 'stars':
      case 'team_stars':
        return `${entry.stars} ⭐`;
      case 'streak':
        return `${entry.streak}‑day`;
      case 'notebook_completion':
        return `${entry.completionPercent}%`;
      case 'biggest_climber':
        return `+${entry.movement}`;
      default:
        return '';
    }
  };
}

function isTeamWinner(winner) {
  return winner.teamName !== undefined;
}

/** "Ava", "Ava & Ben", or "Ava, Ben & Cara" — the same never-artificially-broken-ties philosophy this app already applies everywhere a co-winner list renders. */
function joinWinnerNames(winners) {
  const names = winners.map((winner) => (isTeamWinner(winner) ? winner.teamName : winner.studentName));
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

/** A soft, tinted circle holding a category's own emoji glyph — same .icon-badge shape/sizing every outline icon badge already uses, just holding celebratory emoji text instead of an SVG (see this file's own header comment on why the emoji stays). */
function createEmojiBadge(emoji, colorCategoryKey, size) {
  const colors = ICON_CATEGORIES[colorCategoryKey] || ICON_CATEGORIES.settings;
  const badge = document.createElement('span');
  badge.className = 'icon-badge recognition-bento__emoji-badge';
  badge.style.width = `${size}px`;
  badge.style.height = `${size}px`;
  badge.style.fontSize = `${Math.round(size * 0.5)}px`;
  badge.style.backgroundColor = colors.tint;
  badge.setAttribute('aria-hidden', 'true');
  badge.textContent = emoji;
  return badge;
}

export function renderRecognitionScreenView(container, props) {
  const { classroom, onBack, onNavigatePeriod, onNavigateCategory, onSelectStudent, hideBackButton = false, onOpenWeeklyReports } = props;
  const period = PERIOD_TABS.some((tab) => tab.id === props.period) ? props.period : 'week';

  const availableForPeriod = listRecognitionCategoriesForPeriod(period);
  const categoryId = availableForPeriod.some((category) => category.id === props.categoryId)
    ? props.categoryId
    : availableForPeriod[0]?.id;

  // Unchanged redirect: the currently selected category doesn't support
  // this period (e.g. an old link to Biggest Climber + All Time) —
  // redirect to a valid combination rather than silently rendering
  // something else at the same URL.
  if (categoryId && categoryId !== props.categoryId) {
    onNavigateCategory(period, categoryId);
    return;
  }

  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'recognition-page';

  const header = document.createElement('div');
  header.className = 'recognition-page__header';

  if (!hideBackButton) {
    header.appendChild(createBackButton(onBack));
  }

  const titleRow = document.createElement('div');
  titleRow.className = 'recognition-page__title-row';

  const title = document.createElement('h1');
  title.className = hideBackButton ? 'student-section__title' : 'recognition-page__title';
  title.textContent = '🏆 Recognition';
  titleRow.appendChild(title);

  const periodControl = document.createElement('div');
  periodControl.className = 'recognition-page__period-control';
  PERIOD_TABS.forEach((tab) => {
    const tabButton = document.createElement('button');
    tabButton.type = 'button';
    tabButton.className = 'toggle-group__button' + (tab.id === period ? ' toggle-group__button--active' : '');
    tabButton.textContent = tab.label;
    tabButton.addEventListener('click', () => onNavigatePeriod(tab.id));
    periodControl.appendChild(tabButton);
  });
  titleRow.appendChild(periodControl);

  header.appendChild(titleRow);
  wrapper.appendChild(header);

  const selectedCategory = RECOGNITION_CATEGORIES.find((category) => category.id === categoryId) || null;

  const bento = document.createElement('div');
  bento.className = 'recognition-bento';

  if (!selectedCategory) {
    bento.appendChild(createEmptyStateElement({ message: 'No recognition categories are configured yet.' }));
    wrapper.appendChild(bento);
    container.appendChild(wrapper);
    return;
  }

  // Every category's own winners for THIS period — the exact same
  // getRecognitionWinners() call ui/components/RecognitionWidget.js's
  // Dashboard Wall already makes for every category, reused here so
  // each group tile's row can show a small preview, not just the
  // selected one. `supportsPeriod` (config data, not a calculation)
  // decides whether a row is interactive or quietly disabled.
  const categoryData = RECOGNITION_CATEGORIES.map((category) => {
    const supportsPeriod = category.periods.includes(period);
    return {
      category,
      supportsPeriod,
      winners: supportsPeriod ? studentProgressService.getRecognitionWinners(classroom, category.id, period) : [],
    };
  });
  const selectedEntry = categoryData.find((entry) => entry.category.id === selectedCategory.id);

  bento.appendChild(createHeroTile({ category: selectedCategory, winners: selectedEntry.winners, period, onSelectStudent }));

  const groupsGrid = document.createElement('div');
  groupsGrid.className = 'recognition-bento__groups';

  RECOGNITION_GROUP_ORDER.filter((groupId) => groupId !== RECOGNITION_GROUPS.SPECIAL).forEach((groupId) => {
    const membersInGroup = categoryData.filter((entry) => entry.category.group === groupId);
    if (membersInGroup.length === 0) return;
    groupsGrid.appendChild(
      createGroupTile({ groupId, members: membersInGroup, period, selectedCategoryId: selectedCategory.id, onNavigateCategory })
    );
  });

  if (onOpenWeeklyReports) {
    groupsGrid.appendChild(createWeeklyReportsTile(onOpenWeeklyReports));
  }

  bento.appendChild(groupsGrid);

  if (FUTURE_RECOGNITION_PLACEHOLDERS.length > 0) {
    bento.appendChild(createSpecialRecognitionStrip());
  }

  wrapper.appendChild(bento);

  // Leaderboard — unchanged calculation (getLeaderboard(), same
  // arguments as before), moved below the Bento composition so the
  // achievement itself is what a teacher sees first.
  const leaderboardSection = document.createElement('section');
  leaderboardSection.className = 'recognition-page__leaderboard';

  const leaderboardHeading = document.createElement('h2');
  leaderboardHeading.className = 'recognition-page__leaderboard-heading';
  leaderboardHeading.textContent = `Leaderboard — ${selectedCategory.label}`;
  leaderboardSection.appendChild(leaderboardHeading);

  const leaderboard = studentProgressService.getLeaderboard(classroom, selectedCategory.id, period);
  leaderboardSection.appendChild(
    createLeaderboardListElement({ entries: leaderboard, formatValue: formatLeaderboardValue(selectedCategory), onSelectStudent })
  );

  wrapper.appendChild(leaderboardSection);
  container.appendChild(wrapper);
}

/**
 * The primary tile — obvious visual dominance via a full-bleed tint of
 * the selected category's own group colour, generous but not tall
 * whitespace, and typography-led hierarchy (eyebrow label, then the
 * winner, then the key stat) rather than decoration. Entry animation
 * reuses the exact existing `recognition-card-in` keyframe (already
 * disabled under prefers-reduced-motion — see that rule's own
 * reduced-motion entry in styles.css) rather than a new one.
 */
function createHeroTile({ category, winners, period, onSelectStudent }) {
  const colorCategory = GROUP_COLOR_CATEGORY[category.group] || 'settings';
  const colors = ICON_CATEGORIES[colorCategory];

  const hero = document.createElement('div');
  hero.className = 'recognition-bento__hero';
  hero.style.backgroundColor = colors.tint;

  const topRow = document.createElement('div');
  topRow.className = 'recognition-bento__hero-top';
  topRow.appendChild(createEmojiBadge(category.icon, colorCategory, 52));

  const labelBlock = document.createElement('div');
  labelBlock.className = 'recognition-bento__hero-label-block';
  const eyebrow = document.createElement('span');
  eyebrow.className = 'recognition-bento__hero-eyebrow';
  eyebrow.textContent = category.label;
  labelBlock.appendChild(eyebrow);
  const reason = document.createElement('span');
  reason.className = 'recognition-bento__hero-reason';
  reason.textContent = category.reasonText;
  labelBlock.appendChild(reason);
  topRow.appendChild(labelBlock);

  const periodTag = document.createElement('span');
  periodTag.className = 'recognition-bento__hero-period';
  periodTag.textContent = PERIOD_TABS.find((tab) => tab.id === period).label;
  topRow.appendChild(periodTag);

  hero.appendChild(topRow);

  if (winners.length === 0) {
    const periodLabel = PERIOD_TABS.find((tab) => tab.id === period).label.toLowerCase();
    const empty = document.createElement('p');
    empty.className = 'recognition-bento__hero-empty';
    empty.textContent = `No ${category.label.toLowerCase()} yet ${periodLabel} — check back soon.`;
    hero.appendChild(empty);
    return hero;
  }

  const winnersRow = document.createElement('div');
  winnersRow.className = 'recognition-bento__hero-winners';
  const isTeam = isTeamWinner(winners[0]);

  if (winners.length === 1 && onSelectStudent && !isTeam) {
    const nameButton = document.createElement('button');
    nameButton.type = 'button';
    nameButton.className = 'recognition-bento__hero-winner-name student-name-link';
    nameButton.textContent = winners[0].studentName;
    nameButton.addEventListener('click', () => onSelectStudent(winners[0].studentId));
    winnersRow.appendChild(nameButton);
  } else {
    const nameEl = document.createElement('span');
    nameEl.className = 'recognition-bento__hero-winner-name';
    nameEl.textContent = joinWinnerNames(winners);
    winnersRow.appendChild(nameEl);
  }
  hero.appendChild(winnersRow);

  const stat = document.createElement('p');
  stat.className = 'recognition-bento__hero-stat';
  stat.textContent = formatKeyStatistic(category, winners[0]);
  hero.appendChild(stat);

  return hero;
}

/**
 * One group's own tile (Performance / Growth / Team) — a quiet
 * surface (never a bright per-tile colour) containing a plain row per
 * recognition category in that group, never a card-per-recognition.
 * The currently selected category's row is visually marked; a row
 * whose category doesn't support the current period is quietly
 * disabled (muted, non-interactive, no click handler at all) rather
 * than styled identically to an active one.
 */
function createGroupTile({ groupId, members, period, selectedCategoryId, onNavigateCategory }) {
  const colorCategory = GROUP_COLOR_CATEGORY[groupId] || 'settings';
  const colors = ICON_CATEGORIES[colorCategory];
  const periodLabel = PERIOD_TABS.find((tab) => tab.id === period).label;

  const tile = document.createElement('div');
  tile.className = 'recognition-bento__group';
  tile.style.borderTopColor = colors.icon;

  const heading = document.createElement('h3');
  heading.className = 'recognition-bento__group-heading';
  heading.textContent = RECOGNITION_GROUP_LABELS[groupId];
  tile.appendChild(heading);

  const list = document.createElement('div');
  list.className = 'recognition-bento__group-list';

  members.forEach(({ category, supportsPeriod, winners }) => {
    const isActive = category.id === selectedCategoryId;
    const row = document.createElement('button');
    row.type = 'button';
    row.className =
      'recognition-bento__row' + (isActive ? ' recognition-bento__row--active' : '') + (!supportsPeriod ? ' recognition-bento__row--disabled' : '');
    row.disabled = !supportsPeriod;
    if (!supportsPeriod) {
      row.title = `Not available for ${periodLabel}`;
    } else {
      row.addEventListener('click', () => onNavigateCategory(period, category.id));
    }

    const icon = document.createElement('span');
    icon.className = 'recognition-bento__row-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = category.icon;
    row.appendChild(icon);

    const textBlock = document.createElement('span');
    textBlock.className = 'recognition-bento__row-text';

    const label = document.createElement('span');
    label.className = 'recognition-bento__row-label';
    label.textContent = category.label;
    textBlock.appendChild(label);

    const preview = document.createElement('span');
    preview.className = 'recognition-bento__row-preview';
    if (!supportsPeriod) {
      preview.textContent = `Not available for ${periodLabel}`;
    } else if (winners.length === 0) {
      preview.textContent = 'No winner yet';
    } else {
      preview.textContent = joinWinnerNames(winners);
    }
    textBlock.appendChild(preview);
    row.appendChild(textBlock);

    list.appendChild(row);
  });

  tile.appendChild(list);
  return tile;
}

/**
 * A small supporting tile linking out to Weekly Reports — "Recognition
 * celebrates the current period; Weekly Reports explores the
 * history," per explicit product decision. `calendar`/`arrow-right`
 * are the outline Icon.js system, not emoji: this tile is wayfinding
 * (it labels a destination), not a celebratory moment — see this
 * file's own header comment on that distinction. Only rendered when
 * `onOpenWeeklyReports` is provided, so any caller that omits it
 * (there are none today, but the seam matches every other optional
 * callback already established across this app) simply doesn't show it.
 */
function createWeeklyReportsTile(onOpenWeeklyReports) {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'recognition-bento__weekly-reports';
  tile.addEventListener('click', onOpenWeeklyReports);

  const icon = document.createElement('span');
  icon.className = 'recognition-bento__weekly-reports-icon';
  icon.appendChild(createIcon('calendar', { size: 20 }));
  tile.appendChild(icon);

  const textBlock = document.createElement('span');
  textBlock.className = 'recognition-bento__weekly-reports-text';
  const title = document.createElement('span');
  title.className = 'recognition-bento__weekly-reports-title';
  title.textContent = 'Weekly Reports';
  textBlock.appendChild(title);
  const subtitle = document.createElement('span');
  subtitle.className = 'recognition-bento__weekly-reports-subtitle';
  subtitle.textContent = 'Look back at your class achievements';
  textBlock.appendChild(subtitle);
  tile.appendChild(textBlock);

  tile.appendChild(createIcon('arrow-right', { size: 18 }));

  return tile;
}

/**
 * Special Recognition placeholders (Teacher's Choice, Most Helpful,
 * Best Reader, ...) — deliberately NOT rendered as tiles or pills at
 * the same visual weight as real, active recognitions (the old
 * disabled-chip-row treatment this replaces). A single quiet caption
 * line keeps them discoverable without competing with anything above.
 * No functionality is invented for them — they remain exactly what
 * config/recognitionCategories.js already declares: label + icon,
 * nothing computed.
 */
function createSpecialRecognitionStrip() {
  const strip = document.createElement('p');
  strip.className = 'recognition-bento__special';
  strip.innerHTML = '<strong>Special Recognition</strong> · coming soon — ';
  const names = document.createElement('span');
  names.textContent = FUTURE_RECOGNITION_PLACEHOLDERS.map((placeholder) => `${placeholder.icon} ${placeholder.label}`).join('  ·  ');
  strip.appendChild(names);
  return strip;
}
