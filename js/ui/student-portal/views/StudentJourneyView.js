/**
 * ui/student-portal/views/StudentJourneyView.js
 *
 * "Journey" — the Student Portal's own landing page. In order: the
 * shared Classroom Standings board (see
 * ui/components/TeamStandingsBoard.js), welcome, today's goal,
 * "My Goals," a compact progress summary, the Stars/Streak modules,
 * then the Student Event Feed ("Your Updates").
 *
 * Standings lead the page per explicit product decision: "the
 * classroom competition is the heartbeat of the Student Portal...
 * personal progress exists to improve those standings" — the same
 * philosophy a sports broadcast opens with the table, not an
 * individual's own stats. Everything below the board is,
 * structurally, motivation toward improving it.
 *
 * "Your Updates" replaces what used to be two separate, static
 * sections here — Recognition Wall (computed weekly categories) and
 * My Badges (manually-awarded Behaviour Badges) — with a single,
 * continuous timeline, newest first, tagged by category rather than
 * grouped into sections. See services/studentEventService.js and
 * models/StudentEvent.js for the system this is built on; this
 * milestone wires exactly three publishers (Badge awarded, Stars
 * awarded, Assessment published) — everything else (Learning Hub,
 * attendance, assignments, teacher notes, announcements, ...) can
 * publish into this same feed later without this view ever changing,
 * since every card here reads only category/title/message/createdAt —
 * nothing type-specific.
 *
 * The Team tab still exists as its own destination — for now, also
 * rendering this exact same shared standings component (never a
 * copy), pending the full team-browsing/public-profile drill-down
 * experience it's meant to grow into.
 *
 * All data comes from studentPortalDataService.js; this view only
 * decides what to show and how to phrase it, never fetches anything
 * itself.
 */

import { getHomeSummary, getEventFeed, loadCurrentStudentAndClassroom, getWeeklyNetPoints } from '../../../services/studentPortalDataService.js';
import { createWeeklyNetPointsSection } from '../../components/WeeklyNetPointsGraph.js';
import * as studentDeviceService from '../../../services/studentDeviceService.js';
import { createAvatarElement } from '../../components/AvatarDisplay.js';
import { createEmptyStateElement } from '../../components/EmptyState.js';
import { formatDate } from '../../../utils/dateHelpers.js';
import { getEventDetailRoute } from '../../../config/studentEventNavigation.js';
import { getEventCopyForViewer } from '../../../services/studentEventService.js';

export async function renderStudentJourneyView(container, { onSessionInvalid, onNavigateToEventDetail, onNavigateToGoals, onNavigateToStudentProfile, onNavigateToTeam, onNavigateToStandings } = {}) {
  container.innerHTML = '';

  const [summary, eventFeed, found, weeklyNetPoints] = await Promise.all([
    getHomeSummary(),
    getEventFeed(),
    loadCurrentStudentAndClassroom(),
    getWeeklyNetPoints(),
  ]);

  const wrapper = document.createElement('div');
  wrapper.className = 'student-journey';

  if (!summary) {
    // The same stale-session recovery as
    // ui/student-portal/onboarding/StudentDeviceFlow.js's own startup
    // check, for the rarer case where a teacher deletes the classroom
    // *while* a student is already sitting on this screen, rather than
    // at the next app open. Clears the now-invalid device profile and
    // hands off to the caller (see js/main.js) to re-render the
    // Student Portal entry point, which re-runs that same startup
    // validation and correctly lands on Join Classroom — a recovery
    // path, not a dead end with a "try rejoining" instruction and no
    // way to act on it.
    studentDeviceService.clearAllApprovedProfiles();
    if (onSessionInvalid) {
      onSessionInvalid();
      return;
    }
    const notice = document.createElement('p');
    notice.className = 'student-home__empty-notice';
    notice.textContent = "We couldn't load your data right now. Try rejoining your classroom.";
    wrapper.appendChild(notice);
    container.appendChild(wrapper);
    return;
  }

  const hasAnyActivity = summary.starsThisWeek > 0 || summary.journeyStreak > 0 || summary.recognitionCount > 0 || eventFeed.length > 0;

  // Welcome — the first thing a student sees, per explicit product
  // decision reversing the earlier "standings first" hierarchy: this
  // screen is ME -> MY GOALS -> MY PROGRESS, with class/team
  // comparison accessible on demand, not leading the page.
  const greetingRow = document.createElement('div');
  greetingRow.className = 'student-journey__greeting-row';
  greetingRow.appendChild(createAvatarElement({ studentId: summary.studentId, name: summary.studentName, size: 56, useDefaultIfMissing: true }));
  const greeting = document.createElement('h1');
  greeting.className = 'student-home__greeting';
  greeting.textContent = hasAnyActivity
    ? `Welcome back, ${summary.studentName}! \ud83d\udc4b`
    : `Welcome to ${summary.classroomName}! \ud83d\udc4b`;
  greetingRow.appendChild(greeting);
  wrapper.appendChild(greetingRow);

  // "My Goals" — Goals Phase 1's own entry point into
  // StudentGoalTrackerView.js. Always shown (not conditional on a
  // cycle actually existing) so a student always knows where to look;
  // that view's own empty state handles "no active cycle yet"
  // gracefully if they tap through before one exists.
  if (onNavigateToGoals) {
    const goalsLink = document.createElement('button');
    goalsLink.type = 'button';
    goalsLink.className = 'student-home__goals-link';
    goalsLink.textContent = '\ud83c\udfaf My Goals \u2192';
    goalsLink.addEventListener('click', onNavigateToGoals);
    wrapper.appendChild(goalsLink);
  }

  // Class Standings — compact and collapsed by default, per explicit
  // product decision: the classroom comparison is secondary to a
  // student's own goals/progress, not the hero content of this
  // screen. Navigates straight to the existing, real standings screen
  // (ui/student-portal/views/StudentTeamView.js, the same one the
  // "Team" nav tab already opens) — no standings logic duplicated or
  // rebuilt here, just a doorway to it.
  if (onNavigateToStandings) {
    const standingsCard = document.createElement('button');
    standingsCard.type = 'button';
    standingsCard.className = 'student-home__standings-card';
    standingsCard.addEventListener('click', onNavigateToStandings);

    const standingsText = document.createElement('span');
    standingsText.className = 'student-home__standings-text';
    const standingsTitle = document.createElement('span');
    standingsTitle.className = 'student-home__standings-title';
    standingsTitle.textContent = '\ud83c\udfc6 Class Standings';
    const standingsSubtitle = document.createElement('span');
    standingsSubtitle.className = 'student-home__standings-subtitle';
    standingsSubtitle.textContent = 'See how your team is doing';
    standingsText.append(standingsTitle, standingsSubtitle);

    const chevron = document.createElement('span');
    chevron.className = 'student-home__standings-chevron';
    chevron.textContent = '\u203a';
    chevron.setAttribute('aria-hidden', 'true');

    standingsCard.append(standingsText, chevron);
    wrapper.appendChild(standingsCard);
  }

  // Compact Progress Summary — one line, not a re-statement of every
  // module below in full-card form. Only includes a clause once
  // there's something real to say for it.
  if (hasAnyActivity) {
    const summaryParts = [];
    if (summary.starsThisWeek > 0) summaryParts.push(`${summary.starsThisWeek} \u2b50 this week`);
    if (summary.journeyStreak > 0) summaryParts.push(`${summary.journeyStreak}-day streak`);
    if (summary.recognitionCount > 0) summaryParts.push(`${summary.recognitionCount} badge${summary.recognitionCount === 1 ? '' : 's'}`);
    if (summaryParts.length > 0) {
      const summaryStrip = document.createElement('p');
      summaryStrip.className = 'student-journey__summary-strip';
      summaryStrip.textContent = summaryParts.join(' \u00b7 ');
      wrapper.appendChild(summaryStrip);
    }
  }

  const modules = document.createElement('div');
  modules.className = 'student-home__modules';

  // Stars — always shown. Teaching copy before the first star, real
  // value once one exists.
  if (summary.starsThisWeek > 0) {
    modules.appendChild(
      createModule({
        icon: '\u2b50',
        title: 'My Stars',
        value: String(summary.starsThisWeek),
        caption: summary.starsThisWeek === 1 ? 'Your first star! Keep it up.' : 'earned this week',
      })
    );
  } else {
    modules.appendChild(
      createModule({
        icon: '\u2b50',
        title: 'My Stars',
        lines: ['Your teacher awards stars during class.', "You'll see them here as you participate."],
      })
    );
  }

  // Current Streak — only once there's a real streak to show.
  if (summary.journeyStreak > 0) {
    modules.appendChild(
      createModule({
        icon: '\ud83d\udd25',
        title: 'Current Streak',
        value: `${summary.journeyStreak} day${summary.journeyStreak === 1 ? '' : 's'}`,
        caption: 'keep it going!',
      })
    );
  }

  wrapper.appendChild(modules);

  wrapper.appendChild(createWeeklyNetPointsSection(weeklyNetPoints, 'How your points moved this week'));

  // Your Updates — the Student Event Feed (see
  // services/studentEventService.js, models/StudentEvent.js): a
  // single continuous timeline, newest first, tagged by category —
  // not grouped sections. Deliberately generic (see renderEventCard()
  // below): every card reads only category/title/message/createdAt,
  // so a brand-new future publisher never requires a change here.
  const updatesSection = document.createElement('div');
  updatesSection.className = 'student-journey__section';
  const updatesTitle = document.createElement('h2');
  updatesTitle.className = 'student-journey__section-title';
  updatesTitle.textContent = '\ud83d\udce3 Your Updates';
  updatesSection.appendChild(updatesTitle);

  if (eventFeed.length === 0) {
    updatesSection.appendChild(
      createEmptyStateElement({ message: 'Nothing yet \u2014 updates from your teacher will show up here.' })
    );
  } else {
    const timeline = document.createElement('div');
    timeline.className = 'student-event-feed';
    eventFeed.forEach((event) => {
      timeline.appendChild(renderEventCard(event, onNavigateToEventDetail, 'self'));
    });
    updatesSection.appendChild(timeline);
  }
  wrapper.appendChild(updatesSection);

  container.appendChild(wrapper);
}

function createModule({ icon, title, value, caption, lines }) {
  const card = document.createElement('div');
  card.className = 'student-home__card';

  const iconEl = document.createElement('span');
  iconEl.className = 'student-home__card-icon';
  iconEl.setAttribute('aria-hidden', 'true');
  iconEl.textContent = icon;

  const titleEl = document.createElement('h2');
  titleEl.className = 'student-home__card-title';
  titleEl.textContent = title;

  card.append(iconEl, titleEl);

  if (lines) {
    lines.forEach((line) => {
      const lineEl = document.createElement('p');
      lineEl.className = 'student-home__card-caption';
      lineEl.textContent = line;
      card.appendChild(lineEl);
    });
  } else {
    const valueEl = document.createElement('p');
    valueEl.className = 'student-home__card-value';
    valueEl.textContent = value;
    const captionEl = document.createElement('p');
    captionEl.className = 'student-home__card-caption';
    captionEl.textContent = caption;
    card.append(valueEl, captionEl);
  }

  return card;
}

/**
 * A single Student Event Feed card — deliberately generic, per this
 * file's own header comment: reads only category/title/message/
 * createdAt, the same four fields every publisher (Recognition today;
 * Learning Hub, attendance, teacher notes, announcements, ... later)
 * already provides on every StudentEvent (see models/StudentEvent.js).
 * No per-type or per-category branching logic here at all, by design —
 * that's what lets a brand-new future publisher ship without ever
 * touching this function. The category tag's own visual styling
 * (color-coding per category) lives in CSS, keyed off the category
 * name itself, not decided here.
 *
 * Clickability is the one exception, and it's still generic: this
 * function never checks `event.type` itself — it asks
 * config/studentEventNavigation.js's getEventDetailRoute() whether
 * this event has a registered detail screen at all. An event type
 * with no entry there (every category before Assessment Results, and
 * any future publisher that never gets its own detail screen) renders
 * exactly as it always has — a plain, non-interactive notification.
 */
/**
 * Shared between this file's own Journey timeline (the event's own
 * recipient, viewing their own history — `viewer: 'self'`) and
 * ui/student-portal/views/StudentPublicProfileView.js (a different
 * student viewing someone else's public profile — `viewer: 'peer'`).
 * Deliberately takes `viewer` as an explicit parameter rather than
 * assuming one internally — confirmed by direct trace that this
 * function has two real, distinct callers with two genuinely
 * different correct answers for the same event data.
 */
export function renderEventCard(event, onNavigateToEventDetail, viewer = 'self') {
  const detail = getEventDetailRoute(event);

  const card = document.createElement(detail ? 'button' : 'div');
  card.className = 'student-event-card';
  if (detail) {
    card.type = 'button';
    card.classList.add('student-event-card--clickable');
    card.addEventListener('click', () => onNavigateToEventDetail?.(detail.path));
  }

  const tag = document.createElement('span');
  tag.className = `student-event-card__tag student-event-card__tag--${event.category.toLowerCase()}`;
  tag.textContent = event.category;
  card.appendChild(tag);

  const copy = getEventCopyForViewer(event, viewer);

  const title = document.createElement('p');
  title.className = 'student-event-card__title';
  title.textContent = copy.title;
  card.appendChild(title);

  if (copy.message) {
    const message = document.createElement('p');
    message.className = 'student-event-card__message';
    message.textContent = copy.message;
    card.appendChild(message);
  }

  const time = document.createElement('p');
  time.className = 'student-event-card__time';
  time.textContent = formatDate(event.createdAt);
  card.appendChild(time);

  if (detail) {
    const cta = document.createElement('span');
    cta.className = 'student-event-card__cta';
    cta.textContent = `${detail.ctaLabel} \u2192`;
    card.appendChild(cta);
  }

  return card;
}
