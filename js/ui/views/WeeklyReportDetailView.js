/**
 * ui/views/WeeklyReportDetailView.js
 *
 * One week's own Weekly Report — a celebratory record, not a dense
 * analytics dashboard: the week's recognitions up top (Top Team,
 * Scoreboard Topper, Top Climber, and whichever other Recognition
 * categories had a winner that week — see
 * services/weeklyReportService.js's own getWeeklyReport()), then that
 * week's own Team Standings and Student Standings underneath.
 *
 * Every number on this screen is derived from `student.history` for
 * the SELECTED week's own date range — never the live scoreboard, and
 * never the current week's data — via functions that already existed
 * before this feature (services/studentProgressService.js's
 * Recognition dispatch, services/teamStatisticsService.js's standings
 * with movement). This view only lays them out.
 *
 * "One component, two consumers," matching
 * ui/views/RecognitionScreenView.js's own established pattern:
 * `hideBackButton` for the Student Portal's own top-of-stack framing,
 * and `viewerStudentId` (Student Portal only) adds one small "Your
 * Week" personalization card — the student's own rank/score/movement
 * and team result, pulled from the exact same standings data already
 * computed for the boards below, never a second calculation.
 *
 * STUDENT PRIVACY: this view only ever renders fields
 * teamStatisticsService/studentProgressService already return for
 * standings/recognition — studentId, studentName, teamId, teamName,
 * score/stars, rank, movement, streak, completion %. There is no
 * bucket, badge, note, or behaviour/redemption field anywhere in that
 * data, so nothing sensitive exists here to accidentally expose to a
 * student viewing a classmate's row — the exact same data the
 * existing Recognition Screen already shows every student today (see
 * ui/student-portal/views/StudentRecognitionView.js, which reuses
 * RecognitionScreenView.js verbatim, full leaderboard included).
 */

import { getWeeklyReport } from '../../services/weeklyReportService.js';
import * as teamStatisticsService from '../../services/teamStatisticsService.js';
import { getWeekRange } from '../../utils/dateHelpers.js';
import { createWeekNavHeaderElement } from '../components/WeekNavHeader.js';
import { attachSwipeNavigation } from '../../utils/swipeNavigation.js';
import { createRecognitionCardElement } from '../components/RecognitionCard.js';
import { createClassroomStandingsBoardElement } from '../components/ClassroomStandingsBoard.js';
import { createStudentStandingsBoardElement } from '../components/StudentStandingsBoard.js';
import { createBackButton } from '../components/BackButton.js';
import { createEmptyStateElement } from '../components/EmptyState.js';

/** "this week" / "last week" / "the week of Aug 24–28" — a natural phrase for the standings boards' own aria-labels (see ClassroomStandingsBoard.js/StudentStandingsBoard.js's own `periodLabel`). */
function toPeriodPhrase(weekLabel) {
  if (weekLabel === 'This Week') return 'this week';
  if (weekLabel === 'Last Week') return 'last week';
  return `the week of ${weekLabel}`;
}

export function renderWeeklyReportDetailView(container, { classroom, weekAnchorDateKey, onBack, onNavigateWeek, onSelectStudent, onSelectTeam, hideBackButton = false, viewerStudentId = null }) {
  container.innerHTML = '';

  const report = getWeeklyReport(classroom, weekAnchorDateKey);
  const weekRange = getWeekRange(report.weekStart);
  const periodPhrase = toPeriodPhrase(report.weekLabel);

  const wrapper = document.createElement('div');
  wrapper.className = 'weekly-report';

  if (!hideBackButton) {
    const header = document.createElement('header');
    header.className = 'tracker-header';
    header.appendChild(createBackButton(onBack));
    const title = document.createElement('h1');
    title.className = 'tracker-header__title';
    title.textContent = '📅 Weekly Report';
    header.appendChild(title);
    wrapper.appendChild(header);
  }

  wrapper.appendChild(
    createWeekNavHeaderElement({
      weekLabel: report.weekLabel,
      canGoPrevious: report.canGoPrevious,
      canGoNext: report.canGoNext,
      onPrevious: () => onNavigateWeek(report.previousWeekStart),
      onNext: () => onNavigateWeek(report.nextWeekStart),
      rowClassName: 'weekly-report__nav',
      buttonClassName: 'weekly-report__nav-button',
      titleClassName: 'weekly-report__nav-title',
    })
  );

  // Swipe target is a SIBLING of the nav header above, never an
  // ancestor containing it — attaching swipe (and its own
  // setPointerCapture()) to an element that also contains the Prev/
  // Next buttons would hijack their own click (a captured pointer's
  // subsequent click event is retargeted to the capturing element,
  // confirmed while building this: real pointer-driven clicks on the
  // buttons stopped working once swipe was mistakenly attached to the
  // whole page wrapper). ui/components/WeeklyNetPointsGraph.js's own
  // swipe never had this bug because its swipe target (the chart) and
  // its nav buttons were always siblings, not nested — this restores
  // that same, correct relationship.
  const content = document.createElement('div');
  content.className = 'weekly-report__content';
  attachSwipeNavigation(content, {
    onPrevious: () => onNavigateWeek(report.previousWeekStart),
    onNext: () => onNavigateWeek(report.nextWeekStart),
    canGoPrevious: report.canGoPrevious,
    canGoNext: report.canGoNext,
  });

  if (viewerStudentId) {
    content.appendChild(createYourWeekCard(classroom, viewerStudentId, weekRange, periodPhrase));
  }

  const recognitionsSection = document.createElement('div');
  recognitionsSection.className = 'weekly-report__recognitions';

  if (report.recognitions.length === 0) {
    recognitionsSection.appendChild(createEmptyStateElement({ message: `No recognitions yet for ${report.weekLabel === 'This Week' ? 'this week' : report.weekLabel} — check back once stars start being awarded.` }));
  } else {
    report.recognitions.forEach(({ category, winners }) => {
      recognitionsSection.appendChild(createRecognitionCardElement({ category, winners, period: report.weekLabel, variant: 'full', onSelectStudent }));
    });
  }
  content.appendChild(recognitionsSection);

  content.appendChild(
    createClassroomStandingsBoardElement({
      classroom,
      period: weekRange,
      heading: '🏆 Team Standings',
      periodLabel: periodPhrase,
      onSelectTeam,
    })
  );

  content.appendChild(
    createStudentStandingsBoardElement({
      classroom,
      period: weekRange,
      heading: '⭐ Student Standings',
      periodLabel: periodPhrase,
      onSelectStudent,
      highlightStudentId: viewerStudentId,
    })
  );

  wrapper.appendChild(content);
  container.appendChild(wrapper);
}

/**
 * The Student Portal's own small personalization — this student's own
 * rank/score/movement for the week, plus their team's own rank/score.
 * Pulled from the exact same getClassLeaderboardWithMovement()/
 * getTeamStandingsWithMovement() calls the boards below already make
 * — not a second calculation, just picking out one entry each.
 */
function createYourWeekCard(classroom, studentId, weekRange, periodPhrase) {
  const card = document.createElement('div');
  card.className = 'weekly-report__your-week';

  const heading = document.createElement('h2');
  heading.className = 'weekly-report__your-week-heading';
  heading.textContent = '🙋 Your Week';
  card.appendChild(heading);

  const studentEntry = teamStatisticsService.getClassLeaderboardWithMovement(classroom, weekRange).find((entry) => entry.studentId === studentId);

  if (!studentEntry) {
    const empty = document.createElement('p');
    empty.className = 'weekly-report__your-week-line';
    empty.textContent = `No activity recorded for you ${periodPhrase}.`;
    card.appendChild(empty);
    return card;
  }

  const teamEntry = studentEntry.teamId
    ? teamStatisticsService.getTeamStandingsWithMovement(classroom, weekRange).find((entry) => entry.teamId === studentEntry.teamId)
    : null;

  const movementWord = { up: 'climbed', down: 'dropped', same: 'stayed at' }[studentEntry.movement];
  const movementPhrase =
    studentEntry.movement === 'same'
      ? `you stayed at rank #${studentEntry.rank}`
      : `you ${movementWord} to rank #${studentEntry.rank} (${studentEntry.movement === 'up' ? '+' : '-'}${studentEntry.movementAmount})`;

  const line = document.createElement('p');
  line.className = 'weekly-report__your-week-line';
  line.textContent = `${studentEntry.score} ⭐ ${periodPhrase} — ${movementPhrase}.`;
  card.appendChild(line);

  if (teamEntry) {
    const teamLine = document.createElement('p');
    teamLine.className = 'weekly-report__your-week-line';
    teamLine.textContent = `${teamEntry.teamName} finished #${teamEntry.rank} with ${teamEntry.score} ⭐ ${periodPhrase}.`;
    card.appendChild(teamLine);
  }

  return card;
}
