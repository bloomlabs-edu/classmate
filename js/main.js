/**
 * main.js
 *
 * Application entry point. Sprint 4 added the auth gate; Sprint 5 swaps
 * classroom storage from localStorage to Firestore (see
 * services/workspaceService.js and repositories/firestoreClassroomRepository.js)
 * without changing anything about how views render — workspaceService's
 * public shape (getState/getClassroomById/createClassroom/etc.) is the
 * same as before, so views didn't need to change except passing the
 * classroom being saved (see workspaceService.save(classroom)).
 *
 * Once signed in, workspaceService.initForUser() subscribes to that
 * teacher's classrooms in real time; its callback re-renders the
 * current route automatically whenever the data changes — including
 * from another signed-in device — so nothing here ever needs a manual
 * refresh.
 */

import * as workspaceService from './services/workspaceService.js';
import { logPersistenceEvent } from './services/persistenceLogger.js';
import * as curriculumLibraryService from './services/curriculumLibraryService.js';
import * as authService from './services/authService.js';
import * as accentColorService from './services/accentColorService.js';
import * as classSessionService from './services/classSessionService.js';
import * as accentColorPreferenceService from './services/accentColorPreferenceService.js';
import * as pushNotificationService from './services/pushNotificationService.js';
import * as notificationService from './services/notificationService.js';
import * as feedService from './services/feedService.js';
import { showToast } from './ui/components/Toast.js';
import { ClassroomValidationError, getDisplayName } from './services/classroomService.js';
import * as router from './ui/router.js';
import { renderWelcomeView } from './ui/views/WelcomeView.js';
import { renderLandingView } from './ui/views/LandingView.js';
import { renderStudentPortalShell } from './ui/student-portal/StudentPortalShell.js';
import { renderStudentDeviceFlow } from './ui/student-portal/onboarding/StudentDeviceFlow.js';
import { renderStudentManageProfilesView } from './ui/student-portal/views/StudentManageProfilesView.js';
import * as studentDeviceService from './services/studentDeviceService.js';
import * as studentPortalDataService from './services/studentPortalDataService.js';
import { getEventDetailRoute } from './config/studentEventNavigation.js';
import { renderStudentJourneyView } from './ui/student-portal/views/StudentJourneyView.js';
import { renderStudentAssessmentResultsView } from './ui/student-portal/views/StudentAssessmentResultsView.js';
import { renderStudentGoalTrackerView } from './ui/student-portal/views/StudentGoalTrackerView.js';
import { renderStudentFeedView } from './ui/student-portal/views/StudentFeedView.js';
import { renderStudentNotebooksView } from './ui/student-portal/views/StudentNotebooksView.js';
import { renderStudentLearningView } from './ui/student-portal/views/StudentLearningView.js';
import { renderConceptFeedbackFlowView } from './ui/student-portal/views/ConceptFeedbackFlowView.js';
import { renderStudentLearningCircleView } from './ui/student-portal/views/StudentLearningCircleView.js';
import * as studentAuthService from './services/studentAuthService.js';
import { renderStudentTeamView } from './ui/student-portal/views/StudentTeamView.js';
import { renderStudentRecognitionView } from './ui/student-portal/views/StudentRecognitionView.js';
import { renderStudentTeamDetailView } from './ui/student-portal/views/StudentTeamDetailView.js';
import { renderStudentPublicProfileView } from './ui/student-portal/views/StudentPublicProfileView.js';
import { renderStudentAvatarBuilderView } from './ui/student-portal/views/StudentAvatarBuilderView.js';
import { renderStudentProfileView as renderStudentPortalProfileView } from './ui/student-portal/views/StudentProfileView.js';
import { renderPersonalHubView } from './ui/views/PersonalHubView.js';
import { renderCurriculumManagementView } from './ui/views/CurriculumManagementView.js';
import { renderLearningManagementView } from './ui/views/LearningManagementView.js';
import { renderAssessmentManagementView } from './ui/views/AssessmentManagementView.js';
import { renderGoalManagementView } from './ui/views/GoalManagementView.js';
import { renderGoalDashboardView } from './ui/views/GoalDashboardView.js';
import * as goalService from './services/goalService.js';
import { renderFeedModerationView } from './ui/views/FeedModerationView.js';
import { renderTimetableView } from './ui/views/TimetableView.js';
import { renderScoreboardArchiveView } from './ui/views/ScoreboardArchiveView.js';
import { renderTrackerView } from './ui/views/TrackerView.js';
import { renderTeacherDiagnosticsView } from './ui/views/TeacherDiagnosticsView.js'; // TEMPORARY — see that file's own header comment
import { renderSettingsView } from './ui/views/SettingsView.js';
import { renderSetupWizardView } from './ui/views/SetupWizardView.js';
import { renderStudentProfileView } from './ui/views/StudentProfileView.js';
import { renderStudentAccessView } from './ui/views/StudentAccessView.js';
import { renderActivitiesListView, renderActivityRosterView } from './ui/views/ActivitiesView.js';
import { renderWorkRequestRosterView } from './ui/views/WorkRequestRosterView.js';
import { renderNotebookTrackerView } from './ui/views/NotebookTrackerView.js';
import { renderWorkRequestCreateView } from './ui/views/WorkRequestCreateView.js';
import { renderNotebookCheckpointsView } from './ui/views/NotebookCheckpointsView.js';
import * as workRequestService from './services/workRequestService.js';
import { renderDashboardView } from './ui/views/DashboardView.js';
import { renderLearningProgrammesListView } from './ui/views/LearningProgrammesListView.js';
import { renderLearningProgrammeOverviewView } from './ui/views/LearningProgrammeOverviewView.js';
import { renderLearningProgrammeSettingsView } from './ui/views/LearningProgrammeSettingsView.js';
import { renderProgrammeSessionView } from './ui/views/ProgrammeSessionView.js';
import { renderProgrammeAttendanceView } from './ui/views/ProgrammeAttendanceView.js';
import { renderProgrammeGoalsReviewView } from './ui/views/ProgrammeGoalsReviewView.js';
import { renderProgrammeObservationsView } from './ui/views/ProgrammeObservationsView.js';
import { renderRecognitionScreenView } from './ui/views/RecognitionScreenView.js';
import { renderLoginView } from './ui/views/LoginView.js';
import { renderUserBar } from './ui/components/UserBar.js';
import { openNewClassroomModal } from './ui/components/NewClassroomModal.js';
import { openJoinClassroomModal } from './ui/components/JoinClassroomModal.js';
import { renderTeacherPortalSidebar, hideTeacherPortalSidebar } from './ui/components/TeacherPortalSidebar.js';
import { renderTeacherMobileNav, hideTeacherMobileNav } from './ui/components/TeacherMobileNav.js';

let appContainer = null;
let sidebarContainer = null;
let mobileNavContainer = null;
let userBarContainer = null;
let currentUser = null;
let workspaceLoading = false;
let currentAccentColorId = 'ocean';
// Read synchronously, once, at module load -- Notification.permission
// is a plain browser property, not something that needs an async
// Firestore round-trip the way currentAccentColorId does. Updated
// (and UserBar re-rendered) only from handleEnableNotifications()/
// handleDisableNotifications() below, after the browser's own native
// permission prompt has actually been answered.
let notificationPermissionState = pushNotificationService.getPermissionState();

// In-app notifications — classroom-scoped, unlike
// notificationPermissionState above (a per-device browser setting), so
// this only ever holds data for whichever classroom the current route
// is actually showing (see manageNotificationSubscription() below) —
// empty the rest of the time, so the bell never shows a stale list
// from a previously open classroom.
let notifications = [];
let notificationUnreadCount = 0;
let notificationsUnsubscribe = null;
let notificationsClassroomId = null;

// The separate "detect a new student Feed post while this classroom is
// open" listener (see feedService.js's own
// subscribeToNewStudentPostsForClassroom()) — its own lifecycle,
// tracked independently of notificationsClassroomId/notificationsUnsubscribe
// above, since it's a different Firestore query against a different
// collection (feedPosts, not notifications) serving a different
// purpose (WRITING a notification as a side effect of a new post,
// rather than reading the notifications list itself for the bell).
let feedPostSubscriptionUnsubscribe = null;
let feedPostSubscriptionClassroomId = null;

function handleSelectAccentColor(colorId) {
  currentAccentColorId = colorId;
  accentColorService.applyAccentColor(colorId); // optimistic — applies immediately, doesn't wait on the save below
  accentColorPreferenceService.setPreference(currentUser?.uid, colorId);
  renderUserBar(userBarContainer, {
    user: currentUser,
    onSignOut: handleSignOut,
    onBackToLanding: () => router.navigate('/'),
    currentAccentColorId,
    onSelectAccentColor: handleSelectAccentColor,
    onSelectCustomAccentColor: handleSelectCustomAccentColor,
    notificationPermissionState,
    onEnableNotifications: handleEnableNotifications,
    onDisableNotifications: handleDisableNotifications,
    notificationUnreadCount,
    notifications,
    hasClassroomContext: !!notificationsClassroomId,
    onOpenNotification: handleOpenNotification,
    onNotificationsViewed: handleNotificationsViewed,
  });
}

/**
 * Only ever called from a direct "Enable notifications" click (see
 * ui/components/UserBar.js) -- this is the one call in the whole app
 * that can show the browser's native permission prompt, and it only
 * runs when a teacher explicitly asks for it, never automatically at
 * sign-in.
 */
async function handleEnableNotifications() {
  const result = await pushNotificationService.enableForCurrentUser(currentUser?.uid);
  notificationPermissionState = pushNotificationService.getPermissionState();
  if (result.success) {
    showToast('Notifications enabled');
  } else if (result.reason === 'not-configured') {
    showToast('Notifications are not set up for this app yet.');
  } else if (result.reason === 'permission-denied') {
    showToast('Notifications were blocked. Allow them again from your browser’s site settings.');
  } else {
    showToast('Something went wrong enabling notifications.');
  }
  renderUserBar(userBarContainer, {
    user: currentUser,
    onSignOut: handleSignOut,
    onBackToLanding: () => router.navigate('/'),
    currentAccentColorId,
    onSelectAccentColor: handleSelectAccentColor,
    onSelectCustomAccentColor: handleSelectCustomAccentColor,
    notificationPermissionState,
    onEnableNotifications: handleEnableNotifications,
    onDisableNotifications: handleDisableNotifications,
    notificationUnreadCount,
    notifications,
    hasClassroomContext: !!notificationsClassroomId,
    onOpenNotification: handleOpenNotification,
    onNotificationsViewed: handleNotificationsViewed,
  });
}

/** Reverses handleEnableNotifications() above for this browser -- removes this device's own token from FCM and from users/{uid}.fcmTokens. */
async function handleDisableNotifications() {
  const result = await pushNotificationService.disableForCurrentUser(currentUser?.uid);
  notificationPermissionState = pushNotificationService.getPermissionState();
  showToast(result.success ? 'Notifications turned off' : 'Something went wrong turning off notifications.');
  renderUserBar(userBarContainer, {
    user: currentUser,
    onSignOut: handleSignOut,
    onBackToLanding: () => router.navigate('/'),
    currentAccentColorId,
    onSelectAccentColor: handleSelectAccentColor,
    onSelectCustomAccentColor: handleSelectCustomAccentColor,
    notificationPermissionState,
    onEnableNotifications: handleEnableNotifications,
    onDisableNotifications: handleDisableNotifications,
    notificationUnreadCount,
    notifications,
    hasClassroomContext: !!notificationsClassroomId,
    onOpenNotification: handleOpenNotification,
    onNotificationsViewed: handleNotificationsViewed,
  });
}

/**
 * Starts/stops the live in-app notifications subscription for
 * whichever classroom (if any) the current route is actually showing —
 * called once near the top of renderRoute() with route.classroomId,
 * using the router's own already-parsed value directly rather than
 * waiting for workspaceService.getClassroomById() to resolve, so this
 * doesn't need its own separate classroom-loaded gate. A no-op if the
 * classroom hasn't actually changed since the last call (true for most
 * navigations within the same classroom), so this never tears down and
 * restarts the listener on every single in-classroom navigation —
 * mirrors workspaceCoordinator.js's own "only act on a genuine change"
 * shape.
 */
function manageNotificationSubscription(classroomId) {
  if (classroomId === notificationsClassroomId) return;

  notificationsUnsubscribe?.();
  notificationsUnsubscribe = null;
  notificationsClassroomId = classroomId;
  notifications = [];
  notificationUnreadCount = 0;

  if (!classroomId) return;

  notificationsUnsubscribe = notificationService.subscribeToNotifications(
    classroomId,
    (updated) => {
      notifications = updated;
      notificationUnreadCount = notificationService.countUnread(updated, currentUser?.uid);
      renderUserBar(userBarContainer, {
        user: currentUser,
        onSignOut: handleSignOut,
        onBackToLanding: () => router.navigate('/'),
        currentAccentColorId,
        onSelectAccentColor: handleSelectAccentColor,
        onSelectCustomAccentColor: handleSelectCustomAccentColor,
        onPreviewCustomAccentColor: handlePreviewCustomAccentColor,
        notificationPermissionState,
        onEnableNotifications: handleEnableNotifications,
        onDisableNotifications: handleDisableNotifications,
        notificationUnreadCount,
        notifications,
        hasClassroomContext: !!notificationsClassroomId,
        onOpenNotification: handleOpenNotification,
        onNotificationsViewed: handleNotificationsViewed,
      });
    },
    (error) => console.error('[main] Notifications subscription failed:', error)
  );
}

/**
 * Starts/stops the "detect a new student Feed post while this
 * classroom is open" listener (see feedService.js's own
 * subscribeToNewStudentPostsForClassroom()) — same "no-op if the
 * classroom hasn't actually changed, otherwise unsubscribe the old one
 * and start fresh" shape as manageNotificationSubscription() above,
 * kept as its own separate function/tracked classroomId rather than
 * folded into that one, since this is a different Firestore listener
 * (feedPosts, not notifications) serving a different purpose (writing
 * a notification as a side effect, not reading the notifications list
 * for the bell) — conflating the two would make either one harder to
 * reason about on its own.
 *
 * Requires currentUser?.uid (see subscribeToNewStudentPostsForClassroom()'s
 * own createdByUid requirement) — the caller (renderRoute() below)
 * only ever passes a real classroomId through when currentUser is
 * already known, so by the time classroomId here is truthy,
 * currentUser.uid always is too.
 */
function manageFeedPostSubscription(classroomId) {
  if (classroomId === feedPostSubscriptionClassroomId) return;

  feedPostSubscriptionUnsubscribe?.();
  feedPostSubscriptionUnsubscribe = null;
  feedPostSubscriptionClassroomId = classroomId;

  if (!classroomId) return;

  feedPostSubscriptionUnsubscribe = feedService.subscribeToNewStudentPostsForClassroom(classroomId, currentUser.uid);
}

/**
 * A notification's own click handling: marks it read for this teacher
 * only (every other classroom member's own read state is untouched —
 * see firestore.rules's own update rule for this collection), then
 * navigates to whatever it's actually about, if anything. Reuses the
 * exact same student-profile route every other roster screen already
 * navigates to (see e.g. GoalDashboardView.js's own
 * handlers.onSelectStudent) — not a new destination. A notification
 * with no studentId in its own payload (e.g. "a co-teacher joined")
 * simply has nowhere to navigate; marking it read is this click's only
 * effect.
 *
 * A feed_post_created notification's own payload.postId isn't used
 * for a deep link yet — this app has no per-post scroll-to/highlight
 * destination today, so this navigates to the same classroom-wide Feed
 * route ui/router.js's own 'feed' route already resolves
 * (see js/ui/views/FeedModerationView.js) rather than inventing one.
 * postId is still stored (see services/feedService.js's own
 * createPostAsTeacher()) so a future, more specific destination can
 * use it without a payload shape change.
 */
function handleOpenNotification(notification) {
  if (currentUser?.uid) {
    notificationService.markNotificationRead(notification.classroomId, notification.id, currentUser.uid);
  }
  if (notification.payload?.studentId) {
    router.navigate(`/classroom/${notification.classroomId}/student/${notification.payload.studentId}`);
  } else if (notification.payload?.postId) {
    router.navigate(`/classroom/${notification.classroomId}/feed`);
  }
}

/**
 * Standard "opened and left open" read behavior (see UserBar.js's own
 * scheduleAutoMarkRead()) — called once the popover has actually been
 * open for a short dwell time with real notifications showing. Marks
 * only the ones this teacher hasn't already read (an item clicked
 * individually during that same dwell window is already read by the
 * time this fires, via handleOpenNotification above; re-marking it is
 * harmless, but skipping it here avoids a redundant write). Every
 * `notification` passed in shares the same classroomId — this list
 * only ever comes from the one active classroom subscription (see
 * manageNotificationSubscription()) — so there's no cross-classroom
 * mixing to worry about here.
 */
function handleNotificationsViewed(notifications) {
  if (!currentUser?.uid) return;
  notifications
    .filter((notification) => !(notification.readBy || []).includes(currentUser.uid))
    .forEach((notification) => {
      notificationService.markNotificationRead(notification.classroomId, notification.id, currentUser.uid);
    });
}

/**
 * Spectrum picker drag-end (a real color has been committed, not just
 * previewed) — persists it and updates the tracked state, but
 * deliberately does NOT call renderUserBar(). A full re-render would
 * reset the popover back to closed, which — unlike a single preset
 * click, where closing after a deliberate one-shot choice is the right
 * UX — would be disruptive here: a teacher adjusting hue and then
 * saturation/value in the same sitting would have the whole popover
 * vanish after the very first adjustment. The small edit-button swatch
 * preview will simply reflect this on the next natural re-render
 * (e.g. the next navigation), rather than instantly — an acceptable
 * trade for not disrupting an in-progress color adjustment.
 */
function handleSelectCustomAccentColor(hex) {
  currentAccentColorId = hex;
  accentColorService.applyCustomAccentColor(hex);
  accentColorPreferenceService.setPreference(currentUser?.uid, hex);
}

/**
 * Live preview while dragging the spectrum picker — applies the color
 * to the page immediately (cheap: three CSS custom-property writes),
 * but deliberately does NOT persist or re-render UserBar. The spectrum
 * picker's onChange fires on every pointermove; re-rendering UserBar
 * on every one of those would tear down and rebuild the very element
 * mid-drag (destroying its pointer capture) and spam Firestore writes
 * on every pixel of movement. Only onChangeComplete (drag release)
 * calls the commit path above.
 */
function handlePreviewCustomAccentColor(hex) {
  accentColorService.applyCustomAccentColor(hex);
}

function handleSignIn() {
  authService.signInWithGoogle().catch((error) => {
    console.error('[main] Sign-in failed:', error);
    window.alert('Sign-in didn\u2019t complete. Please try again.');
  });
}

function handleSignOut() {
  logPersistenceEvent('Logout requested');

  if (workspaceService.isAnySaveInProgress()) {
    const leaveAnyway = window.confirm('Changes are still being saved.\n\nLeave anyway?');
    if (!leaveAnyway) return;
  }

  // flushPendingSaves() never rejects (it's built on Promise.allSettled,
  // which resolves regardless of individual outcomes) — waiting for it
  // here closes the real gap the persistence investigation found: a
  // save triggered moments before sign-out is fire-and-forget by
  // design, and nothing previously waited for it to actually reach the
  // server before the auth session tore down.
  workspaceService.flushPendingSaves().then(() => {
    authService.signOutUser().then(() => {
      logPersistenceEvent('Logout completed');
    }).catch((error) => {
      console.error('[main] Sign-out failed:', error);
    });
  });
}

async function handleNewClassroom() {
  let curriculumOptions = [];
  try {
    curriculumOptions = await curriculumLibraryService.getAssignableCurriculumOptions();
  } catch (error) {
    console.error('[main] Failed to load curriculum options for classroom creation:', error);
    // Falls through with an empty list — the modal shows "No curricula
    // available yet" and disables the picker itself, but Curriculum is
    // optional (see ui/components/NewClassroomModal.js's own header
    // comment), so a teacher can still create the classroom without one
    // even if this fetch failed.
  }

  openNewClassroomModal({
    curriculumOptions,
    onCreate: (details, close) => {
      try {
        const classroom = workspaceService.createClassroom(details, currentUser);
        close();
        router.navigate(`/classroom/${classroom.id}/setup`);
      } catch (error) {
        const message =
          error instanceof ClassroomValidationError
            ? error.message
            : 'Something went wrong creating that classroom.';
        window.alert(message);
      }
    },
  });
}

function handleJoinClassroom() {
  openJoinClassroomModal({
    onJoin: (code, { onSuccess, onError }) => {
      workspaceService
        .joinClassroomByCode(code, currentUser.uid, currentUser.displayName)
        .then((result) => {
          if (!result.success) {
            onError(
              result.reason === 'not_found'
                ? 'That Classroom ID doesn\u2019t match any classroom. Double-check it with your co-teacher.'
                : 'Enter the Classroom ID your co-teacher shared with you.'
            );
            return;
          }
          onSuccess();
          router.navigate(`/classroom/${result.classroomId}`);
        })
        .catch((error) => {
          console.error('[main] Failed to join classroom:', error);
          onError('Something went wrong joining that classroom. Please try again.');
        });
    },
  });
}

/**
 * Delete Classroom, from the ⋯ menu on a My Classrooms card — reuses
 * the exact same workspaceService.deleteClassroom() the classroom's
 * own Settings -> Danger Zone button already calls (see
 * ui/views/SettingsView.js's own renderDangerSection()), with the same
 * confirm() wording. This handler only adds the confirm dialog and
 * refreshes the current route afterward so the card disappears
 * immediately — it does not change deleteClassroom() itself, and does
 * not attempt any cleanup beyond what that function already does.
 */
function handleDeleteClassroomFromHome(classroomId) {
  const classroom = workspaceService.getState().classrooms.find((c) => c.id === classroomId);
  if (!classroom) return;

  const confirmed = window.confirm(`Delete "${getDisplayName(classroom)}"? This cannot be undone.`);
  if (!confirmed) return;

  let deleted = false;
  try {
    deleted = workspaceService.deleteClassroom(classroomId);
  } catch (error) {
    console.error('[main] Failed to delete classroom:', error);
  }

  if (!deleted) {
    window.alert('Something went wrong deleting this classroom. Please try again.');
    return;
  }

  renderRoute(router.getCurrentRoute(), 'classroom-deleted');
}

const CLASSROOM_ROUTE_NAMES = [
  'dashboard',
  'tracker',
  'recognition',
  'settings',
  'setup',
  'studentProfile',
  'studentAccess',
  'activitiesList',
  'activityRoster',
  'workRequestRoster',
  'notebookTracker',
  'workRequestCreate',
  'notebookCheckpoints',
  'assessments',
  'goalManagement',
  'learningManagement',
  'feed',
  'timetable',
  'learningProgrammesList',
  'learningProgrammeOverview',
  'learningProgrammeSettings',
  'programmeSession',
  'programmeSessionAttendance',
  'programmeSessionGoals',
  'programmeSessionObservations',
  'diagnostics', // TEMPORARY — see ui/views/TeacherDiagnosticsView.js's own header comment
];

function renderLoadingScreen(container) {
  container.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'welcome-view';
  const message = document.createElement('p');
  message.className = 'welcome-view__subtitle';
  message.textContent = 'Loading your classrooms\u2026';
  wrapper.appendChild(message);
  container.appendChild(wrapper);
}

/**
 * A student notification's own click handling — mirrors main.js's own
 * handleOpenNotification() (the teacher equivalent) in shape, not
 * code: marks it read immediately for this student, then navigates to
 * its own detail screen if it has one. Reuses
 * config/studentEventNavigation.js's own getEventDetailRoute() — the
 * exact same mapping ui/student-portal/views/StudentJourneyView.js's
 * "Your Updates" timeline cards already use for their own click-
 * through (see that file's own renderEventCard()) — not a new
 * destination or a second lookup. An event type with no entry there
 * (star_awarded, badge_awarded — see that file's own header comment)
 * is correctly non-interactive beyond being marked read.
 */
function handleOpenStudentNotificationEvent(event) {
  studentPortalDataService.markEventRead(event.id);
  const detail = getEventDetailRoute(event);
  if (detail) router.navigate(detail.path);
}

/** Standard "opened and left open" read behavior for the student bell — see ui/student-portal/components/StudentNotificationBell.js's own scheduleAutoMarkRead(). Marks every currently-shown event read at once. */
function handleStudentNotificationEventsViewed(events) {
  studentPortalDataService.markEventsRead(events.map((event) => event.id));
}

async function renderStudentPortalMain(route) {
  // The real Milestone 1A behavior: whenever the Student Portal
  // renders (including right after a profile switch navigates
  // somewhere), ensure the currently-active profile's own slot is
  // signed in. Deliberately a call of its own, independent of the
  // temporary diagnostic panel below — that panel's own refresh also
  // happens to trigger sign-in as a side effect, but this call must
  // survive the diagnostic panel's own eventual removal, since it's
  // the actual product behavior, not verification scaffolding.
  studentAuthService.getAuthForActiveProfile().catch((error) => {
    console.error('[studentAuthService] Failed to sign in the active profile\u2019s own slot:', error);
  });

  // STAGE 1 ADDITION (notification architecture audit, Section E) \u2014
  // the student bell's own data, resolved before the shell renders
  // (matching ui/student-portal/views/StudentJourneyView.js's own
  // Promise.all-then-render shape) rather than patched in afterward,
  // since ui/student-portal/StudentPortalShell.js builds the bell
  // inline as part of one synchronous rebuild, same as every other
  // piece of its own chrome.
  const [notificationUnreadCount, notificationEvents] = await Promise.all([
    studentPortalDataService.getUnreadEventCount(),
    studentPortalDataService.getRecentEventsForBell(),
  ]);

  renderStudentPortalShell(appContainer, {
    activeSection: route.section,
    onNavigateSection: (section) => router.navigate(`/student/${section}`),
    onBackToLanding: () => {
      studentPortalDataService.stopClassroomSubscription();
      router.navigate('/');
    },
    notificationUnreadCount,
    notificationEvents,
    onOpenNotificationEvent: handleOpenStudentNotificationEvent,
    onNotificationEventsViewed: handleStudentNotificationEventsViewed,
    renderSectionContent: (content) => {
      if (route.section === 'team' && route.param) {
        renderStudentTeamDetailView(content, {
          teamId: route.param,
          onBack: () => router.navigate('/student/team'),
          onNavigateToStudentProfile: (studentId) => router.navigate(`/student/student-profile/${studentId}`),
        });
      } else if (route.section === 'team') {
        renderStudentTeamView(content, {
          onNavigateToStudentProfile: (studentId) => router.navigate(`/student/student-profile/${studentId}`),
          onNavigateToTeam: (teamId) => router.navigate(`/student/team/${teamId}`),
        });
      } else if (route.section === 'recognition') {
        renderStudentRecognitionView(content, {
          onNavigateToStudentProfile: (studentId) => router.navigate(`/student/student-profile/${studentId}`),
        });
      } else if (route.section === 'student-profile') {
        renderStudentPublicProfileView(content, {
          studentId: route.param,
          onBack: () => router.navigate('/student'),
        });
      } else if (route.section === 'avatar-builder') {
        renderStudentAvatarBuilderView(content, {
          studentId: studentDeviceService.getActiveProfile()?.studentId,
          onBack: () => router.navigate('/student/profile'),
        });
      } else if (route.section === 'manage-students') {
        renderStudentManageProfilesView(content, {
          onBack: () => router.navigate('/student/profile'),
          onProfilesChanged: () => renderRoute(router.getCurrentRoute(), 'student-profiles-changed'),
        });
      } else if (route.section === 'profile') {
        renderStudentPortalProfileView(content, {
          onCustomizeAvatar: () => router.navigate('/student/avatar-builder'),
          onManageStudents: () => router.navigate('/student/manage-students'),
        });
      } else if (route.section === 'assessment-results') {
        renderStudentAssessmentResultsView(content, {
          assessmentId: route.param,
          onBack: () => router.navigate('/student'),
        });
      } else if (route.section === 'concept-feedback') {
        renderConceptFeedbackFlowView(content, {
          lessonId: route.param,
          onDone: () => router.navigate('/student'),
        });
      } else if (route.section === 'goals') {
        renderStudentGoalTrackerView(content, {
          onBack: () => router.navigate('/student'),
        });
      } else if (route.section === 'feed') {
        renderStudentFeedView(content, {
          onBack: () => router.navigate('/student'),
          onNavigateToPath: (path) => router.navigate(path),
          onNavigateToStudentProfile: (studentId) => router.navigate(`/student/student-profile/${studentId}`),
        });
      } else if (route.section === 'notebooks') {
        renderStudentNotebooksView(content, {
          onBack: () => router.navigate('/student'),
        });
      } else if (route.section === 'learning') {
        renderStudentLearningView(content, {
          onBack: () => router.navigate('/student'),
        });
      } else if (route.section === 'learning-circle') {
        renderStudentLearningCircleView(content, {
          onBack: () => router.navigate('/student'),
        });
      } else {
        renderStudentJourneyView(content, {
          // Phase 2 — this fires automatically from inside the view's
          // own data-loading path when the session/profile fails to
          // resolve, not from a click. `replace: true` so it doesn't
          // push a phantom "/student" entry onto the real Back stack
          // for something the student never chose to navigate to —
          // see ui/router.js's own navigate() doc comment.
          onSessionInvalid: () => router.navigate('/student', { replace: true }),
          // The generic event-navigation pattern (see
          // config/studentEventNavigation.js): the view itself never
          // imports the router — it only ever calls back out with an
          // already-built path, matching every other view in this app
          // (onBack, onSelectStudent, etc.).
          onNavigateToEventDetail: (path) => router.navigate(path),
          onNavigateToGoals: () => router.navigate('/student/goals'),
          onNavigateToFeed: () => router.navigate('/student/feed'),
          onNavigateToNotebooks: () => router.navigate('/student/notebooks'),
          onNavigateToLearning: () => router.navigate('/student/learning'),
          onNavigateToLearningCircle: () => router.navigate('/student/learning-circle'),
          onNavigateToStudentProfile: (studentId) => router.navigate(`/student/student-profile/${studentId}`),
          onNavigateToTeam: (teamId) => router.navigate(`/student/team/${teamId}`),
          onNavigateToStandings: () => router.navigate('/student/team'),
        });
      }
    },
  });
}

function renderRoute(route, reason = 'unspecified') {
  logPersistenceEvent(`renderRoute() called`, { reason, routeName: route?.name });

  // Default to hidden — the persistent Teacher Portal sidebar (see
  // ui/components/TeacherPortalSidebar.js) only ever applies inside
  // the classroom-scoped routes below (CLASSROOM_ROUTE_NAMES), which
  // re-shows it explicitly. Every other route (landing, Home, Student
  // Portal, standalone Curriculum Management, login) never had it, so
  // clearing it unconditionally here — rather than hunting down every
  // individual non-classroom branch — is what actually guarantees it
  // never leaks into a screen it was never designed for.
  if (sidebarContainer) hideTeacherPortalSidebar(sidebarContainer);
  if (mobileNavContainer) hideTeacherMobileNav(mobileNavContainer);

  // Notifications are classroom-scoped (see notificationService.js's
  // own header comment) — route.classroomId is undefined for every
  // non-classroom route (landing, Home, Student Portal, Curriculum
  // Management), which correctly tears the subscription down there.
  manageNotificationSubscription(route.classroomId ?? null);

  // Same classroom-scoping as above, but additionally requires
  // currentUser?.uid — this listener performs its own Firestore WRITE
  // (see manageFeedPostSubscription()'s own header comment), which
  // needs a real teacher uid to attribute it to; a signed-out state
  // (currentUser null) can still resolve to a classroom route
  // momentarily during the auth gate below, and must never hold this
  // listener open regardless of what route.classroomId says.
  manageFeedPostSubscription(currentUser?.uid ? (route.classroomId ?? null) : null);

  // Bloom Labs platform-level routes — deliberately checked before the
  // auth gate below. Neither of these is part of Classroom Tracker's
  // own flow; they sit one layer above it (and above Student Portal,
  // once that exists), so no sign-in is required just to see the
  // product picker or the placeholder.
  if (route.name === 'landing') {
    userBarContainer.innerHTML = '';
    renderLandingView(appContainer, {
      onContinueAsTeacher: () => router.navigate('/teacher'),
      onContinueAsStudent: () => router.navigate('/student'),
    });
    return;
  }

  if (route.name === 'studentPortal') {
    userBarContainer.innerHTML = '';

    // Milestone 2 — the Student Portal's own single, permanent live
    // classroom subscription (see
    // services/studentPortalDataService.js's own header comment for
    // the full architecture). Once the device flow has resolved once
    // this session and the subscription is live, a snapshot update
    // re-runs renderRoute() and lands back here — skip re-running
    // device/onboarding resolution entirely and go straight to the
    // main portal render, which is the only thing that actually needs
    // to happen on every subsequent snapshot.
    const activeProfile = studentDeviceService.getActiveProfile();
    if (activeProfile && studentPortalDataService.isClassroomSubscribed(activeProfile.classroomId)) {
      renderStudentPortalMain(route);
      return;
    }

    renderStudentDeviceFlow(appContainer, {
      onResolved: async (studentRef) => {
        await studentPortalDataService.startClassroomSubscription(studentRef.classroomId, () => {
          renderRoute(router.getCurrentRoute(), 'student-portal-live-update');
        });
        renderStudentPortalMain(route);
      },
    });
    return;
  }

  if (!currentUser) {
    userBarContainer.innerHTML = '';
    renderLoginView(appContainer, { onSignIn: handleSignIn });
    return;
  }

  renderUserBar(userBarContainer, {
    user: currentUser,
    onSignOut: handleSignOut,
    onBackToLanding: () => router.navigate('/'),
    currentAccentColorId,
    onSelectAccentColor: handleSelectAccentColor,
    onSelectCustomAccentColor: handleSelectCustomAccentColor,
    onPreviewCustomAccentColor: handlePreviewCustomAccentColor,
    notificationPermissionState,
    onEnableNotifications: handleEnableNotifications,
    onDisableNotifications: handleDisableNotifications,
    notificationUnreadCount,
    notifications,
    hasClassroomContext: !!notificationsClassroomId,
    onOpenNotification: handleOpenNotification,
    onNotificationsViewed: handleNotificationsViewed,
  });

  if (workspaceLoading) {
    renderLoadingScreen(appContainer);
    return;
  }

  if (route.name === 'curriculumManagement') {
    renderCurriculumManagementView(appContainer, {
      onBack: () => router.navigate('/teacher'),
      onOpenLearningManagement: () => {
        renderLearningManagementView(appContainer, {
          classrooms: workspaceService.getState().classrooms,
          onBack: () => router.navigate('/curriculum-management'),
          onOpenCurriculumManagement: () => router.navigate('/curriculum-management'),
        });
      },
    });
    return;
  }

  if (CLASSROOM_ROUTE_NAMES.includes(route.name)) {
    const classroom = workspaceService.getClassroomById(route.classroomId);
    // TEMPORARY — diagnostics deliberately does NOT redirect away when
    // the in-memory classroom is missing; observing that exact gap
    // (in-memory missing, or differing from what's persisted) is this
    // screen's whole reason for existing, not an error state. See
    // ui/views/TeacherDiagnosticsView.js's own header comment.
    if (!classroom && route.name !== 'diagnostics') {
      // Phase 2 — this fires from renderRoute() itself, not a click:
      // hashchange, sign-in/out, and every single Firestore snapshot
      // update for this teacher's classrooms all call renderRoute(),
      // so this redirect can trigger with no user action at all
      // (e.g. mid-hydration, right after sign-in, before the
      // workspace has this classroom loaded yet). `replace: true`
      // keeps it from padding the browser's real Back stack with a
      // phantom "/teacher" entry the user never actually chose to
      // visit — see ui/router.js's own navigate() doc comment.
      router.navigate('/teacher', { replace: true });
      return;
    }

    // Shown for every classroom-scoped route except 'diagnostics',
    // whose whole reason for existing (see the comment above) is
    // tolerating a missing in-memory classroom — the sidebar needs a
    // real classroom object (name, join code, etc.) and would have
    // nothing meaningful to render in exactly that one case.
    if (classroom && sidebarContainer) {
      renderTeacherPortalSidebar(sidebarContainer, { classroom, activeRouteName: route.name });
    }
    if (classroom && mobileNavContainer) {
      renderTeacherMobileNav(mobileNavContainer, { classroomId: classroom.id, activeRouteName: route.name });
    }

    if (route.name === 'diagnostics') {
      renderTeacherDiagnosticsView(appContainer, {
        classroomId: route.classroomId,
        onBack: () => router.navigate(`/classroom/${route.classroomId}`),
      });
      return;
    }

    if (route.name === 'dashboard') {
      renderDashboardView(appContainer, {
        classroom,
        currentUser,
        // The exact same live list UserBar.js's own bell already renders
        // (see manageNotificationSubscription() above) — passed straight
        // through so the Class Feed card's own attention indicator can
        // filter/count it locally, without a second subscription to the
        // same notifications collection.
        notifications,
        onOpenSettings: () => router.navigate(`/classroom/${classroom.id}/settings`),
        onOpenSettingsStudents: () => router.navigate(`/classroom/${classroom.id}/settings/class`),
        onOpenSettingsGroups: () => router.navigate(`/classroom/${classroom.id}/settings/class`),
        onOpenSettingsNotebooks: () => router.navigate(`/classroom/${classroom.id}/settings/learning`),
        onOpenStudentAccess: () => router.navigate(`/classroom/${classroom.id}/student-access`),
        onOpenNotebookTracker: () => router.navigate(`/classroom/${classroom.id}/notebooks`),
        onOpenGroups: () => router.navigate(`/classroom/${classroom.id}/settings/class`),
        onStartClassMode: () => router.navigate(`/classroom/${classroom.id}/class-mode`),
        onSelectNotebook: (subjectId, notebookTypeId) =>
          router.navigate(`/classroom/${classroom.id}/notebooks/${subjectId}/${notebookTypeId}`),
        onOpenRecognition: () => router.navigate(`/classroom/${classroom.id}/recognition`),
        onOpenActivities: () => router.navigate(`/classroom/${classroom.id}/activities`),
        onSelectPendingTask: (taskTypeId, item) => {
          if (item.activityId) {
            router.navigate(`/classroom/${classroom.id}/activities/${item.activityId}`);
          } else if (item.requestId) {
            router.navigate(`/classroom/${classroom.id}/work-requests/${item.requestId}`);
          } else if (item.subjectId && item.notebookTypeId) {
            const dateSegment = item.dateKey ? `/${item.dateKey}` : '';
            router.navigate(`/classroom/${classroom.id}/notebooks/${item.subjectId}/${item.notebookTypeId}${dateSegment}`);
          }
        },
        onSelectStudent: (studentId) => router.navigate(`/classroom/${classroom.id}/student/${studentId}`),
        onNavigateOpenWork: (path) => router.navigate(path),
      });
    } else if (route.name === 'timetable') {
      // Phase W — a classroom-save-triggered remount (reason ===
      // 'workspace-init-onchange', fired by workspaceService's live
      // Firestore listener any time this classroom document changes,
      // including from Timetable's own writes) must not close whatever
      // period-detail panel the teacher currently has open. Every other
      // reason (a genuine 'url-route-changed' navigation, sign-in,
      // etc.) still gets TimetableView's normal clean-slate mount — see
      // that view's own renderTimetableView() header comment.
      renderTimetableView(appContainer, { classroom, currentUser, preserveState: reason === 'workspace-init-onchange' });
    } else if (route.name === 'assessments') {
      renderAssessmentManagementView(appContainer, {
        classroom,
        onBack: () => router.navigate(`/classroom/${classroom.id}`),
        initialAssessmentId: route.assessmentId || null,
        initialView: route.view || null,
        onNavigate: (path) => router.navigate(path),
      });
    } else if (route.name === 'goalManagement') {
      // /goals now opens the Goal Dashboard directly once an active
      // Goal Cycle exists -- the "Open Goal Dashboard" intermediate
      // landing page is redundant once there's an actual dashboard to
      // show. GoalManagementView.js's own home step (create a Goal
      // Cycle) is still needed, and still reached from here, for the
      // one case a dashboard genuinely can't exist yet: no active
      // cycle at all.
      const onBackToClassroom = () => router.navigate(`/classroom/${classroom.id}`);
      if (goalService.getActiveCycle(classroom)) {
        renderGoalDashboardView(appContainer, { classroom, onBack: onBackToClassroom });
      } else {
        renderGoalManagementView(appContainer, { classroom, onBack: onBackToClassroom });
      }
    } else if (route.name === 'learningManagement') {
      renderLearningManagementView(appContainer, {
        classrooms: [classroom],
        onBack: () => router.navigate(`/classroom/${classroom.id}`),
        // Preserves the exact existing "return to the same subject"
        // behavior (see LearningManagementView.js's own call sites,
        // which pass { onBack: () => rerender() }) — only the
        // *initial* entry into Learning Management is now routed;
        // the Curriculum Hub itself is completely untouched, per
        // explicit scope.
        onOpenCurriculumManagement: ({ onBack: returnToLearningManagement }) => {
          renderCurriculumManagementView(appContainer, {
            onBack: returnToLearningManagement,
            onOpenLearningManagement: () => router.navigate(`/classroom/${classroom.id}/learning`),
          });
        },
      });
    } else if (route.name === 'feed') {
      renderFeedModerationView(appContainer, {
        classroom,
        currentUser,
        onBack: () => router.navigate(`/classroom/${classroom.id}`),
        onSelectStudent: (studentId) => router.navigate(`/classroom/${classroom.id}/student/${studentId}`),
      });
    } else if (route.name === 'learningProgrammesList') {
      renderLearningProgrammesListView(appContainer, {
        classroom,
        onBack: () => router.navigate(`/classroom/${classroom.id}`),
        onSelectProgramme: (programmeId) => router.navigate(`/classroom/${classroom.id}/learning-programmes/${programmeId}`),
      });
    } else if (route.name === 'learningProgrammeOverview') {
      renderLearningProgrammeOverviewView(appContainer, {
        classroom,
        programmeId: route.programmeId,
        onBack: () => router.navigate(`/classroom/${classroom.id}/learning-programmes`),
        onOpenSession: (sessionId) =>
          router.navigate(`/classroom/${classroom.id}/learning-programmes/${route.programmeId}/session/${sessionId}`),
        onOpenSettings: () => router.navigate(`/classroom/${classroom.id}/learning-programmes/${route.programmeId}/settings`),
      });
    } else if (route.name === 'learningProgrammeSettings') {
      renderLearningProgrammeSettingsView(appContainer, {
        classroom,
        programmeId: route.programmeId,
        onBack: () => router.navigate(`/classroom/${classroom.id}/learning-programmes/${route.programmeId}`),
      });
    } else if (route.name === 'programmeSession') {
      renderProgrammeSessionView(appContainer, {
        classroom,
        programmeId: route.programmeId,
        sessionId: route.sessionId,
        onBack: () => router.navigate(`/classroom/${classroom.id}/learning-programmes/${route.programmeId}`),
        onOpenAttendance: (sessionId) =>
          router.navigate(`/classroom/${classroom.id}/learning-programmes/${route.programmeId}/session/${sessionId}/attendance`),
        onOpenGoals: (sessionId) =>
          router.navigate(`/classroom/${classroom.id}/learning-programmes/${route.programmeId}/session/${sessionId}/goals`),
        onOpenObservations: (sessionId) =>
          router.navigate(`/classroom/${classroom.id}/learning-programmes/${route.programmeId}/session/${sessionId}/observations`),
      });
    } else if (route.name === 'programmeSessionAttendance') {
      renderProgrammeAttendanceView(appContainer, {
        classroom,
        programmeId: route.programmeId,
        sessionId: route.sessionId,
        onBack: () => router.navigate(`/classroom/${classroom.id}/learning-programmes/${route.programmeId}/session/${route.sessionId}`),
      });
    } else if (route.name === 'programmeSessionGoals') {
      renderProgrammeGoalsReviewView(appContainer, {
        classroom,
        programmeId: route.programmeId,
        sessionId: route.sessionId,
        onBack: () => router.navigate(`/classroom/${classroom.id}/learning-programmes/${route.programmeId}/session/${route.sessionId}`),
      });
    } else if (route.name === 'programmeSessionObservations') {
      renderProgrammeObservationsView(appContainer, {
        classroom,
        programmeId: route.programmeId,
        sessionId: route.sessionId,
        onBack: () => router.navigate(`/classroom/${classroom.id}/learning-programmes/${route.programmeId}/session/${route.sessionId}`),
      });
    } else if (route.name === 'scoreboardArchive' || route.name === 'scoreboardArchiveDetail') {
      renderScoreboardArchiveView(appContainer, {
        classroom,
        archiveId: route.name === 'scoreboardArchiveDetail' ? route.archiveId : null,
        onBack: () => {
          if (route.name === 'scoreboardArchiveDetail') {
            router.navigate(`/classroom/${classroom.id}/scoreboard-archive`);
          } else {
            router.navigate(`/classroom/${classroom.id}/class-mode`);
          }
        },
        onOpenArchive: (archiveId) => {
          if (archiveId) {
            router.navigate(`/classroom/${classroom.id}/scoreboard-archive/${archiveId}`);
          } else {
            router.navigate(`/classroom/${classroom.id}/scoreboard-archive`);
          }
        },
      });
    } else if (route.name === 'recognition') {
      renderRecognitionScreenView(appContainer, {
        classroom,
        period: route.period,
        categoryId: route.categoryId,
        onBack: () => router.navigate(`/classroom/${classroom.id}`),
        onNavigatePeriod: (period) => router.navigate(`/classroom/${classroom.id}/recognition/${period}`),
        onNavigateCategory: (period, categoryId) =>
          router.navigate(`/classroom/${classroom.id}/recognition/${period}/${categoryId}`),
        onSelectStudent: (studentId) => router.navigate(`/classroom/${classroom.id}/student/${studentId}`),
      });
    } else if (route.name === 'tracker') {
      renderTrackerView(appContainer, {
        classroom,
        onBack: () => router.navigate(`/classroom/${classroom.id}`),
        onNotebooks: () => router.navigate(`/classroom/${classroom.id}/notebooks`),
        onOpenScoreboardArchive: () => router.navigate(`/classroom/${classroom.id}/scoreboard-archive`),
        onSelectStudent: (studentId) => router.navigate(`/classroom/${classroom.id}/student/${studentId}`),
      });
    } else if (route.name === 'settings') {
      renderSettingsView(appContainer, {
        classroom,
        currentUser,
        section: route.section,
        onBack: () => router.navigate(`/classroom/${classroom.id}`),
        onNavigateSection: (section) =>
          router.navigate(`/classroom/${classroom.id}/settings/${section}`),
        onOpenStudentAccess: () => router.navigate(`/classroom/${classroom.id}/student-access`),
        onDeleted: () => router.navigate('/teacher'),
        onReopenSetupWizard: () => router.navigate(`/classroom/${classroom.id}/setup`),
        onSelectStudent: (studentId) => router.navigate(`/classroom/${classroom.id}/student/${studentId}`),
      });
    } else if (route.name === 'setup') {
      renderSetupWizardView(appContainer, {
        classroom,
        step: route.step,
        onNavigateStep: (step) =>
          router.navigate(step ? `/classroom/${classroom.id}/setup/${step}` : `/classroom/${classroom.id}/setup`),
        onFinish: () => router.navigate(`/classroom/${classroom.id}`),
      });
    } else if (route.name === 'studentProfile') {
      // BUG FIX — `onBack` used to always go to the classroom
      // dashboard, regardless of where the profile was actually
      // opened from. Reuses this router's own existing, already-
      // working query-string support (see ui/router.js's own
      // parseHash() — `route.query` is parsed there today, just not
      // consumed by any route until now) rather than inventing a new
      // navigation mechanism: a caller that wants Back to return
      // somewhere specific appends `?returnTo=<encoded path>` to the
      // URL it navigates to; this route reads it back if present, and
      // falls through to the exact same dashboard behavior as before
      // when it's absent — every other entry point (Assessment
      // Management, WorkRequest roster, Student Access, etc.) doesn't
      // pass `returnTo` at all, so its own Back behavior is completely
      // unchanged.
      //
      // onNavigateTab also carries `returnTo` forward when present —
      // without this, switching tabs while on the profile would
      // silently drop the return context before the user even
      // reaches Back, since navigating to a new hash without the
      // query string loses it.
      const returnToQuery = route.query?.returnTo ? `?returnTo=${encodeURIComponent(route.query.returnTo)}` : '';
      renderStudentProfileView(appContainer, {
        classroom,
        studentId: route.studentId,
        tab: route.tab,
        onBack: () => router.navigate(route.query?.returnTo || `/classroom/${classroom.id}`),
        onNavigateTab: (tab) => router.navigate(`/classroom/${classroom.id}/student/${route.studentId}/${tab}${returnToQuery}`),
        onOpenStudentAccess: () => router.navigate(`/classroom/${classroom.id}/student-access`),
      });
    } else if (route.name === 'studentAccess') {
      renderStudentAccessView(appContainer, {
        classroom,
        currentUser,
        onBack: () => router.navigate(`/classroom/${classroom.id}`),
        onSelectStudent: (studentId) => router.navigate(`/classroom/${classroom.id}/student/${studentId}`),
      });
    } else if (route.name === 'activitiesList') {
      renderActivitiesListView(appContainer, {
        classroom,
        onBack: () => router.navigate(`/classroom/${classroom.id}`),
        onSelectActivity: (activityId) =>
          router.navigate(`/classroom/${classroom.id}/activities/${activityId}`),
      });
    } else if (route.name === 'activityRoster') {
      renderActivityRosterView(appContainer, {
        classroom,
        activityId: route.activityId,
        onBack: () => router.navigate(`/classroom/${classroom.id}/activities`),
        onSelectStudent: (studentId) => router.navigate(`/classroom/${classroom.id}/student/${studentId}`),
      });
    } else if (route.name === 'workRequestRoster') {
      renderWorkRequestRosterView(appContainer, {
        classroom,
        requestId: route.requestId,
        onBack: () => router.navigate(`/classroom/${classroom.id}`),
        onSelectStudent: (studentId) => router.navigate(`/classroom/${classroom.id}/student/${studentId}`),
      });
    } else if (route.name === 'notebookTracker') {
      renderNotebookTrackerView(appContainer, {
        classroom,
        onBack: () => router.navigate(`/classroom/${classroom.id}`),
        onNavigate: (path) => router.navigate(path),
        onOpenNotebookConfiguration: () => router.navigate(`/classroom/${classroom.id}/settings/learning`),
      });
    } else if (route.name === 'workRequestCreate') {
      renderWorkRequestCreateView(appContainer, {
        classroom,
        subjectId: route.subjectId,
        notebookTypeId: route.notebookTypeId,
        onBack: () => router.navigate(`/classroom/${classroom.id}/notebooks`),
        onCreated: (requestId) => router.navigate(`/classroom/${classroom.id}/work-requests/${requestId}`),
      });
    } else if (route.name === 'notebookCheckpoints') {
      renderNotebookCheckpointsView(appContainer, {
        classroom,
        currentUser,
        subjectId: route.subjectId,
        notebookTypeId: route.notebookTypeId,
        onBack: () => router.navigate(`/classroom/${classroom.id}/notebooks`),
        // BUG FIX — carries this exact Notebook Checkpoints route back
        // through the student profile's own `returnTo` query param
        // (see the studentProfile route's own comment above) so its
        // Back button returns here specifically, not the dashboard.
        onSelectStudent: (studentId) => {
          const returnTo = `/classroom/${classroom.id}/notebooks/${route.subjectId}/${route.notebookTypeId}/checkpoints`;
          router.navigate(`/classroom/${classroom.id}/student/${studentId}?returnTo=${encodeURIComponent(returnTo)}`);
        },
      });
    }
    return;
  }

  const { classrooms } = workspaceService.getState();
  console.log('[main] Home/Welcome decision — classroom count:', classrooms.length);
  if (classrooms.length === 0) {
    renderWelcomeView(appContainer, { onNewClassroom: handleNewClassroom, onJoinClassroom: handleJoinClassroom });
  } else {
    renderPersonalHubView(appContainer, {
      classrooms,
      currentUser,
      onSelectClassroom: (id) => router.navigate(`/classroom/${id}`),
      onNewClassroom: handleNewClassroom,
      onJoinClassroom: handleJoinClassroom,
      onDeleteClassroom: handleDeleteClassroomFromHome,
      onOpenCurriculumManagement: () => router.navigate('/curriculum-management'),
      onOpenTimetable: (classroomId) => router.navigate(`/classroom/${classroomId}/timetable`),
    });
  }
}

/**
 * TEMPORARY STARTUP DIAGNOSTIC — added specifically to chase down a
 * white screen on Chrome for Android that produces no visible error
 * anywhere else (not even the window.onerror-based banner added
 * previously), so mobile devices without DevTools access can still
 * report exactly what failed. Remove once that issue is found and
 * fixed; this is not meant to be permanent application behavior.
 *
 * Replaces the entire page (not an overlay) with the error message,
 * full stack trace, and navigator.userAgent — the exact three things
 * needed to diagnose a failure on a device with no other way to see
 * console output.
 */
function showFatalStartupError(error) {
  document.body.innerHTML =
    '<div style="padding:1.5rem;font-family:monospace;white-space:pre-wrap;' +
    'word-break:break-word;background:#fff3f2;color:#3a0d0d;min-height:100vh;box-sizing:border-box;">' +
    '<h1 style="font-size:1rem;font-family:sans-serif;margin:0 0 1rem;">Startup failed</h1>' +
    '<p style="font-weight:bold;margin:0 0 0.5rem;">' + escapeHtml(String(error && error.message ? error.message : error)) + '</p>' +
    '<p style="margin:0 0 0.25rem;font-size:0.85rem;opacity:0.8;">Stack trace:</p>' +
    '<pre style="font-size:0.75rem;background:#fff;border:1px solid #e3b3b0;border-radius:6px;' +
    'padding:0.75rem;overflow:auto;">' + escapeHtml((error && error.stack) || '(no stack trace available)') + '</pre>' +
    '<p style="margin:1rem 0 0.25rem;font-size:0.85rem;opacity:0.8;">User agent:</p>' +
    '<pre style="font-size:0.75rem;background:#fff;border:1px solid #e3b3b0;border-radius:6px;' +
    'padding:0.75rem;overflow:auto;">' + escapeHtml(navigator.userAgent) + '</pre>' +
    '</div>';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Registers the app's own service-worker.js exactly once per page
 * load -- init() itself only ever runs once, so no extra guard is
 * needed here. Registered as a module worker ({ type: 'module' })
 * specifically so service-worker.js can `import` the same Firebase
 * SDK/config every other file in this app already uses for its own
 * FCM background-message handling (see that file's own header
 * comment) rather than duplicating those values into a second,
 * classic-script service worker. Fire-and-forget: a registration
 * failure (e.g. an unsupported browser) should never block the rest
 * of the app from loading, so this only logs, never throws upward.
 *
 * `updateViaCache: 'none'` — this app is hosted from more than one
 * origin (Firebase Hosting, which already sends
 * Cache-Control: no-cache on every JS file, and GitHub Pages, which
 * does not: it serves service-worker.js itself with a 10-minute HTTP
 * cache). Without this option, a browser's own periodic "has
 * service-worker.js changed?" check on GitHub Pages could be answered
 * from that stale HTTP cache instead of asking the server, silently
 * delaying how soon a new deployment's service worker (and, since
 * this is a module worker, its own `import`ed scripts) is even
 * detected — on top of, and separate from, this file's own Cache
 * Storage fetch strategy below. This option is a browser-level
 * instruction understood by the Service Worker spec itself, not a
 * change to GitHub Pages' hosting config (which this app has no
 * ability to alter, and doesn't need to, for this to work).
 */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/service-worker.js', { type: 'module', updateViaCache: 'none' }).catch((error) => {
    console.error('[main] Service worker registration failed:', error);
  });
}

function init() {
  try {
    appContainer = document.getElementById('app');
    userBarContainer = document.getElementById('user-bar');
    sidebarContainer = document.getElementById('teacher-sidebar');
    mobileNavContainer = document.getElementById('teacher-mobile-nav');

    registerServiceWorker();

    // Registered once — renderRoute() itself checks auth/loading state on
    // every call, so this doesn't need to be re-attached on sign-in/out.
    router.onRouteChange((route) => renderRoute(route, 'url-route-changed'));

    // Browsers do not allow custom dialog text or buttons on
    // beforeunload (a long-standing security restriction, not something
    // any site can override) — this can only trigger the browser's own
    // generic "leave site? changes may not be saved" prompt, not the
    // three-option Continue/Discard/Save dialog used for in-app
    // navigation (see ui/components/UnsavedSessionDialog.js). Still
    // meaningfully protects against an accidental refresh or tab close
    // losing a draft Class Session.
    window.addEventListener('beforeunload', (event) => {
      if (classSessionService.hasAnyUnsavedSession()) {
        event.preventDefault();
        event.returnValue = '';
      }
    });

    authService.initAuth();

    authService.onAuthStateChange((user) => {
      try {
        currentUser = user;

        if (!user) {
          logPersistenceEvent('stopListening() called', { caller: 'auth-callback-signed-out' });
          workspaceService.stopListening();
          currentAccentColorId = 'ocean';
          accentColorService.applyAccentColor('ocean');
          renderRoute(router.getCurrentRoute(), 'auth-callback-signed-out');
          return;
        }

        accentColorPreferenceService.getPreferenceOnce(user.uid).then((storedValue) => {
          currentAccentColorId = storedValue;
          // A stored value is either one of the 5 preset ids, or a raw hex
          // from the spectrum picker (always starts with '#') — each needs
          // its own apply function, since only presets have an authored
          // text-color override (see accentColorConfig.js's Ocean comment).
          if (storedValue.startsWith('#')) {
            accentColorService.applyCustomAccentColor(storedValue);
          } else {
            accentColorService.applyAccentColor(storedValue);
          }
          renderUserBar(userBarContainer, {
            user: currentUser,
            onSignOut: handleSignOut,
            onBackToLanding: () => router.navigate('/'),
            currentAccentColorId,
            onSelectAccentColor: handleSelectAccentColor,
            onSelectCustomAccentColor: handleSelectCustomAccentColor,
            onPreviewCustomAccentColor: handlePreviewCustomAccentColor,
            notificationPermissionState,
            onEnableNotifications: handleEnableNotifications,
            onDisableNotifications: handleDisableNotifications,
            notificationUnreadCount,
            notifications,
            hasClassroomContext: !!notificationsClassroomId,
            onOpenNotification: handleOpenNotification,
            onNotificationsViewed: handleNotificationsViewed,
          });
        });

        workspaceLoading = true;
        renderRoute(router.getCurrentRoute(), 'auth-callback-workspace-loading-start');

        logPersistenceEvent('workspaceService.initForUser() called', { caller: 'auth-callback', uid: user.uid });
        workspaceService
          .initForUser(user.uid, user.displayName, () => {
            workspaceLoading = false;
            renderRoute(router.getCurrentRoute(), 'workspace-init-onchange');
          })
          .catch((error) => {
            console.error('[main] Failed to load classrooms:', error);
            workspaceLoading = false;
            window.alert('We couldn\u2019t load your classrooms. Please check your connection and try again.');
            renderRoute(router.getCurrentRoute(), 'workspace-init-error');
          });
      } catch (error) {
        showFatalStartupError(error);
      }
    });
  } catch (error) {
    showFatalStartupError(error);
  }
}

document.addEventListener('DOMContentLoaded', init);
