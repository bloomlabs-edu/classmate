/**
 * ui/components/LeaderboardList.js
 *
 * A reusable, generic ranked list — used today by the Recognition
 * Screen (one leaderboard per selected category/period), and available
 * for anywhere else a ranked list needs rendering later (e.g. a future
 * dedicated Group Leaderboard). Deliberately knows nothing about
 * recognition categories or the Progress Engine: it only renders
 * whatever `entries` and `formatValue` it's given, so it stays reusable
 * without needing to import config/recognitionCategories.js itself.
 *
 * Shows the top 3 by default; "Show all" expands the remaining entries
 * in place, and toggles back to "Show less" — never a separate page or
 * route, so the Recognition Screen stays self-contained.
 */

const COLLAPSED_COUNT = 3;

/** Same reliable, CSS-based rank badge as WeeklySnapshotWidget.js — see that file's doc comment for why emoji medals were replaced (a real cross-platform rendering gap, not just a style preference). */
function createRankIndicator(rank) {
  if (rank > 3) {
    const text = document.createElement('span');
    text.textContent = `#${rank}`;
    return text;
  }
  const badge = document.createElement('span');
  badge.className = `rank-badge rank-badge--${rank}`;
  badge.textContent = String(rank);
  return badge;
}

export function createLeaderboardListElement({ entries, formatValue, onSelectStudent }) {
  const wrapper = document.createElement('div');
  wrapper.className = 'leaderboard-list';

  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state__message';
    empty.textContent = 'No students in this classroom yet.';
    wrapper.appendChild(empty);
    return wrapper;
  }

  const list = document.createElement('ol');
  list.className = 'leaderboard-list__rows';
  wrapper.appendChild(list);

  let expanded = false;

  function renderRows() {
    list.innerHTML = '';
    const visibleEntries = expanded ? entries : entries.slice(0, COLLAPSED_COUNT);

    visibleEntries.forEach((entry) => {
      const row = document.createElement('li');
      row.className = `leaderboard-list__row${entry.rank <= 3 ? ` leaderboard-list__row--rank-${entry.rank}` : ''}`;

      const rank = document.createElement('span');
      rank.className = 'leaderboard-list__rank';
      rank.appendChild(createRankIndicator(entry.rank));

      let name;
      if (onSelectStudent && entry.studentId) {
        name = document.createElement('button');
        name.type = 'button';
        name.className = 'leaderboard-list__name student-name-link';
        name.addEventListener('click', () => onSelectStudent(entry.studentId));
      } else {
        name = document.createElement('span');
        name.className = 'leaderboard-list__name';
      }
      name.textContent = entry.studentName || entry.teamName;

      const value = document.createElement('span');
      value.className = 'leaderboard-list__value';
      value.textContent = formatValue(entry);

      row.append(rank, name, value);
      list.appendChild(row);
    });
  }

  renderRows();

  if (entries.length > COLLAPSED_COUNT) {
    const toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.className = 'btn btn--text leaderboard-list__toggle';
    toggleButton.textContent = 'Show all';
    toggleButton.addEventListener('click', () => {
      expanded = !expanded;
      toggleButton.textContent = expanded ? 'Show less' : 'Show all';
      renderRows();
    });
    wrapper.appendChild(toggleButton);
  }

  return wrapper;
}
