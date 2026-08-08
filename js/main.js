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
import { ClassroomValidationError } from './services/classroomService.js';
import * as router from './ui/router.js';
import { renderWelcomeView } from './ui/views/WelcomeView.js';
import { renderLandingView } from './ui/views/LandingView.js';
import { renderStudentPortalShell } from './ui/student-portal/StudentPortalShell.js';
import { renderStudentDeviceFlow } from './ui/student-portal/onboarding/StudentDeviceFlow.js';
import { renderStudentManageProfilesView } from './ui/student-portal/views/StudentManageProfilesView.js';
import * as studentDeviceService from './services/studentDeviceService.js';
import * as studentPortalDataService from './services/studentPortalDataService.js';
import { renderStudentJourneyView } from './ui/student-portal/views/StudentJourneyView.js';
import { renderStudentAssessmentResultsView } from './ui/student-portal/views/StudentAssessmentResultsView.js';
import { renderStudentGoalTrackerView } from './ui/student-portal/views/StudentGoalTrackerView.js';
import { renderStudentTeamView } from './ui/student-portal/views/StudentTeamView.js';
import { renderStudentTeamDetailView } from './ui/student-portal/views/StudentTeamDetailView.js';
import { renderStudentPublicProfileView } from './ui/student-portal/views/StudentPublicProfileView.js';
import { renderStudentAvatarBuilderView } from './ui/student-portal/views/StudentAvatarBuilderView.js';
import { renderStudentProfileView as renderStudentPortalProfileView } from './ui/student-portal/views/StudentProfileView.js';
import { renderHomeView } from './ui/views/HomeView.js';
import { renderCurriculumManagementView } from './ui/views/CurriculumManagementView.js';
import { renderLearningManagementView } from './ui/views/LearningManagementView.js';
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
import * as workRequestService from './services/workRequestService.js';
import { renderDashboardView } from './ui/views/DashboardView.js';
import { renderRecognitionScreenView } from './ui/views/RecognitionScreenView.js';
import { renderLoginView } from './ui/views/LoginView.js';
import { renderUserBar } from './ui/components/UserBar.js';
import { openNewClassroomModal } from './ui/components/NewClassroomModal.js';
import { openJoinClassroomModal } from './ui/components/JoinClassroomModal.js';

let appContainer = null;
let userBarContainer = null;
let currentUser = null;
let workspaceLoading = false;
let currentAccentColorId = 'ocean';

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

function renderStudentPortalMain(route) {
  renderStudentPortalShell(appContainer, {
    activeSection: route.section,
    onNavigateSection: (section) => router.navigate(`/student/${section}`),
    onBackToLanding: () => {
      studentPortalDataService.stopClassroomSubscription();
      router.navigate('/');
    },
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
      } else if (route.section === 'goals') {
        renderStudentGoalTrackerView(content, {
          onBack: () => router.navigate('/student'),
        });
      } else {
        renderStudentJourneyView(content, {
          onSessionInvalid: () => router.navigate('/student'),
          // The generic event-navigation pattern (see
          // config/studentEventNavigation.js): the view itself never
          // imports the router — it only ever calls back out with an
          // already-built path, matching every other view in this app
          // (onBack, onSelectStudent, etc.).
          onNavigateToEventDetail: (path) => router.navigate(path),
          onNavigateToGoals: () => router.navigate('/student/goals'),
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
      router.navigate('/teacher');
      return;
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
      renderStudentProfileView(appContainer, {
        classroom,
        studentId: route.studentId,
        tab: route.tab,
        onBack: () => router.navigate(`/classroom/${classroom.id}`),
        onNavigateTab: (tab) => router.navigate(`/classroom/${classroom.id}/student/${route.studentId}/${tab}`),
        onOpenStudentAccess: () => router.navigate(`/classroom/${classroom.id}/student-access`),
      });
    } else if (route.name === 'studentAccess') {
      renderStudentAccessView(appContainer, {
        classroom,
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
    }
    return;
  }

  const { classrooms } = workspaceService.getState();
  console.log('[main] Home/Welcome decision — classroom count:', classrooms.length);
  if (classrooms.length === 0) {
    renderWelcomeView(appContainer, { onNewClassroom: handleNewClassroom, onJoinClassroom: handleJoinClassroom });
  } else {
    renderHomeView(appContainer, {
      classrooms,
      onSelectClassroom: (id) => router.navigate(`/classroom/${id}`),
      onNewClassroom: handleNewClassroom,
      onJoinClassroom: handleJoinClassroom,
      onOpenCurriculumManagement: () => router.navigate('/curriculum-management'),
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

function init() {
  try {
    appContainer = document.getElementById('app');
    userBarContainer = document.getElementById('user-bar');

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
