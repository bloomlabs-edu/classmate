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

import { getHomeSummary, getEventFeed, loadCurrentStudentAndClassroom, getWeeklyNetPoints, getAlertsForCurrentStudent, getGoalCycleForCurrentStudent, getUnreadEventCountByCategory } from '../../../services/studentPortalDataService.js';
import { STUDENT_EVENT_CATEGORIES } from '../../../config/studentEventCategories.js';
import { createTeamStandingsBoardElement } from '../../components/TeamStandingsBoard.js';
import { createWeeklyNetPointsSection } from '../../components/WeeklyNetPointsGraph.js';
import * as studentDeviceService from '../../../services/studentDeviceService.js';
import { createAvatarElement } from '../../components/AvatarDisplay.js';
import { createEmptyStateElement } from '../../components/EmptyState.js';
import { formatDate } from '../../../utils/dateHelpers.js';
import { getEventDetailRoute } from '../../../config/studentEventNavigation.js';
import { getEventCopyForViewer } from '../../../services/studentEventService.js';
import { createIcon, createIconBadge, ICON_CATEGORIES } from '../../components/Icon.js';

export async function renderStudentJourneyView(container, { onSessionInvalid, onNavigateToEventDetail, onNavigateToGoals, onNavigateToFeed, onNavigateToNotebooks, onNavigateToLearning, onNavigateToLearningCircle, onNavigateToStudentProfile, onNavigateToTeam, onNavigateToStandings } = {}) {
  container.innerHTML = '';

  const [summary, eventFeed, found, weeklyNetPoints, alerts, goalCycle, unreadFeedCount] = await Promise.all([
    getHomeSummary(),
    getEventFeed(),
    loadCurrentStudentAndClassroom(),
    getWeeklyNetPoints(),
    getAlertsForCurrentStudent(),
    getGoalCycleForCurrentStudent(),
    getUnreadEventCountByCategory(STUDENT_EVENT_CATEGORIES.FEED),
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

  // Explore - the Bento dashboard (see this file's own
  // createBentoCard() below). Replaces the old always-shown alerts
  // panel (pending notebook submissions now surface through the
  // Notebooks card's own subtitle/chip instead - still backed by the
  // exact same getAlertsForCurrentStudent() data as before) and the
  // old plain link buttons for My Goals / Class Feed / Notebooks /
  // Learning / Learning Circle. Every card still calls the exact same
  // on* callback its old link did, on the exact same user action (a
  // click) - only the presentation changed.
  const exploreHeading = document.createElement('h2');
  exploreHeading.className = 'student-home__section-heading';
  exploreHeading.textContent = 'Explore';
  wrapper.appendChild(exploreHeading);

  const bento = document.createElement('div');
  bento.className = 'student-home__bento';

  // My Goals - the hero card. "In progress" counts categories with any
  // goal set at all (pending or approved), matching this same data's
  // only other current consumer (StudentGoalTrackerView.js) treating
  // both states as "there's a goal here." The progress bar is the
  // average overallCompletionPercent across exactly those categories -
  // omitted entirely (not zeroed) when there's nothing to average, per
  // this redesign's own "don't fabricate data" requirement.
  if (onNavigateToGoals) {
    const categoriesWithGoal = (goalCycle?.categories || []).filter((category) => category.goal);
    const goalsInProgress = categoriesWithGoal.length;
    let goalsSubtitle;
    let goalsProgressPercent;
    if (!goalCycle) {
      goalsSubtitle = 'Set your first goal';
    } else if (goalsInProgress === 0) {
      goalsSubtitle = 'No goals set yet';
    } else {
      goalsSubtitle = `${goalsInProgress} goal${goalsInProgress === 1 ? '' : 's'} in progress`;
      goalsProgressPercent =
        categoriesWithGoal.reduce((sum, category) => sum + category.goal.overallCompletionPercent, 0) / goalsInProgress;
    }
    bento.appendChild(
      createBentoCard({
        icon: 'target',
        category: 'activities',
        cardTint: '#FDF1F3',
        title: 'My Goals',
        subtitle: goalsSubtitle,
        progressPercent: goalsProgressPercent,
        isHero: true,
        onClick: onNavigateToGoals,
      })
    );
  }

  // Class Feed - now backed by real data: teacher-authored posts
  // publish a feed_post_created StudentEvent (see
  // services/feedService.js's createPostAsTeacher()), so this card can
  // show a genuine unread count the same way Notebooks already does,
  // rather than the generic placeholder copy it used before that
  // existed. Falls back to the same generic copy when there's nothing
  // unread, per this redesign's own "no fabricated numbers" rule.
  if (onNavigateToFeed) {
    bento.appendChild(
      createBentoCard({
        icon: 'message-circle',
        category: 'teacher',
        cardTint: '#F0F7FD',
        title: 'Class Feed',
        subtitle:
          unreadFeedCount > 0
            ? `${unreadFeedCount} new message${unreadFeedCount === 1 ? '' : 's'}`
            : "See what's new in your class",
        onClick: onNavigateToFeed,
      })
    );
  }

  // Notebooks - the exact same pendingSubmissions this page already
  // fetched for the old alerts panel (getAlertsForCurrentStudent()
  // above), just surfaced here instead. The contextual chip reuses
  // that same list's own first entry's label (already "Subject -
  // NotebookType", e.g. "Science - Classwork") rather than a second,
  // separate lookup.
  if (onNavigateToNotebooks) {
    const pendingCount = alerts.pendingSubmissions.length;
    bento.appendChild(
      createBentoCard({
        icon: 'notebook-text',
        category: 'notebook',
        cardTint: '#F5F2FC',
        title: 'Notebooks',
        subtitle: pendingCount === 0 ? 'All caught up!' : `${pendingCount} note${pendingCount === 1 ? '' : 's'} pending`,
        chip: pendingCount > 0 ? alerts.pendingSubmissions[0].label : null,
        onClick: onNavigateToNotebooks,
      })
    );
  }

  // Learning - no page-level "next up" concept exists yet (that lives
  // deep inside StudentLearningView.js's own
  // loadAndRenderContinueLearning(), never surfaced through
  // studentPortalDataService.js) - "Continue exploring" is this
  // redesign's own explicitly-sanctioned, non-data fallback copy for
  // exactly this case, not a placeholder statistic.
  if (onNavigateToLearning) {
    bento.appendChild(
      createBentoCard({
        icon: 'book-open',
        category: 'progress',
        cardTint: '#F1F8ED',
        title: 'Learning',
        subtitle: 'Continue exploring',
        onClick: onNavigateToLearning,
      })
    );
  }

  // Learning Circle - same reasoning as Class Feed above: no
  // page-level participant/session summary exists yet, so this states
  // what the space is for rather than inventing a presence count.
  if (onNavigateToLearningCircle) {
    bento.appendChild(
      createBentoCard({
        icon: 'graduation-cap',
        category: 'student',
        cardTint: '#FEF4EA',
        title: 'Learning Circle',
        subtitle: 'Discuss, learn and grow together',
        onClick: onNavigateToLearningCircle,
      })
    );
  }

  wrapper.appendChild(bento);

  // The actual, shared Classroom Standings board - the same
  // component Class Mode and the "Team" tab already render, reused
  // directly here, never redesigned or duplicated. QA fix: this
  // previously showed only a compact, collapsed card linking away to
  // a separate screen, which is precisely the "summarized leaderboard
  // instead of the actual Class Mode-style board" pattern this
  // product's own current requirement explicitly calls out to avoid.
  if (found.classroom) {
    const standingsHeading = document.createElement('h2');
    standingsHeading.className = 'student-home__section-heading student-home__section-heading--standings';
    standingsHeading.textContent = 'Class Standings';
    wrapper.appendChild(standingsHeading);

    const standingsSubheading = document.createElement('p');
    standingsSubheading.className = 'student-home__section-subheading';
    standingsSubheading.textContent = 'See how your team is doing';
    wrapper.appendChild(standingsSubheading);

    const standingsSection = document.createElement('div');
    standingsSection.className = 'student-home__standings-section';
    standingsSection.appendChild(
      createTeamStandingsBoardElement({
        classroom: found.classroom,
        onTap: (student) => onNavigateToStudentProfile?.(student.id),
        onTapTeam: (teamId) => onNavigateToTeam?.(teamId),
      })
    );
    wrapper.appendChild(standingsSection);
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
 * One Bento "Explore" destination card - an icon badge, a bold title,
 * one supporting line, and a solid-colored arrow-button affordance,
 * matching the Bento reference this page was redesigned against (see
 * this file's own callers above for exactly what real data each card
 * is given - this function only lays it out, never decides what to
 * show).
 *
 * `category` is one of Icon.js's own ICON_CATEGORIES keys, reused
 * as-is for its tint/icon color pairing rather than inventing a
 * second color system - see Icon.js's own header comment on why only
 * icons ClassMate already uses live there. `cardTint` is this card's
 * own, deliberately lighter background wash (a plain hex, not a
 * token - no existing token models "a pastel card behind a more
 * saturated icon badge") so the badge itself, unchanged from
 * createIconBadge()'s own existing look, still reads as more
 * saturated than the card behind it, matching the reference's layered
 * pastel look.
 *
 * The hero card (`isHero: true`, My Goals only) lays out
 * icon/content/arrow in a single horizontal row with the arrow
 * vertically centered on the far right; every other card stacks icon
 * above title/subtitle, with the optional chip and the arrow sharing
 * one bottom row instead.
 */
function createBentoCard({ icon, category, cardTint, title, subtitle, chip, progressPercent, isHero, onClick }) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'student-home__bento-card' + (isHero ? ' student-home__bento-card--hero' : '');
  card.style.backgroundColor = cardTint;
  if (onClick) card.addEventListener('click', onClick);

  const badge = createIconBadge(icon, category, { size: isHero ? 56 : 44 });
  card.appendChild(badge);

  const content = document.createElement('div');
  content.className = 'student-home__bento-content';

  const titleEl = document.createElement('span');
  titleEl.className = 'student-home__bento-title';
  titleEl.textContent = title;
  content.appendChild(titleEl);

  const subtitleEl = document.createElement('span');
  subtitleEl.className = 'student-home__bento-subtitle';
  subtitleEl.textContent = subtitle;
  content.appendChild(subtitleEl);

  const arrowColor = ICON_CATEGORIES[category]?.icon || '#5B6672';
  const arrow = document.createElement('span');
  arrow.className = 'student-home__bento-arrow' + (isHero ? ' student-home__bento-arrow--hero' : '');
  arrow.setAttribute('aria-hidden', 'true');
  arrow.style.backgroundColor = arrowColor;
  arrow.appendChild(createIcon('arrow-right', { size: isHero ? 18 : 16 }));

  if (typeof progressPercent === 'number') {
    const track = document.createElement('div');
    track.className = 'student-home__bento-progress';
    const fill = document.createElement('div');
    fill.className = 'student-home__bento-progress-fill';
    fill.style.width = `${Math.max(0, Math.min(100, progressPercent))}%`;
    fill.style.backgroundColor = arrowColor;
    track.appendChild(fill);
    content.appendChild(track);
  }

  if (isHero) {
    card.appendChild(content);
    card.appendChild(arrow);
  } else {
    const footer = document.createElement('div');
    footer.className = 'student-home__bento-footer';
    if (chip) {
      const chipEl = document.createElement('span');
      chipEl.className = 'student-home__bento-chip';
      chipEl.style.backgroundColor = ICON_CATEGORIES[category]?.tint || '#EBEDEF';
      chipEl.style.color = arrowColor;
      chipEl.textContent = chip;
      footer.appendChild(chipEl);
    }
    footer.appendChild(arrow);
    content.appendChild(footer);
    card.appendChild(content);
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
