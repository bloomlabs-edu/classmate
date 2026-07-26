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
import * as authService from './services/authService.js';
import * as continueWorkingService from './services/continueWorkingService.js';
import * as accentColorService from './services/accentColorService.js';
import * as classSessionService from './services/classSessionService.js';
import * as accentColorPreferenceService from './services/accentColorPreferenceService.js';
import { ClassroomValidationError } from './services/classroomService.js';
import * as router from './ui/router.js';
import { renderWelcomeView } from './ui/views/WelcomeView.js';
import { renderLandingView } from './ui/views/LandingView.js';
import { renderStudentPortalShell } from './ui/student-portal/StudentPortalShell.js';
import { renderStudentDeviceFlow } from './ui/student-portal/onboarding/StudentDeviceFlow.js';
import { renderStudentRosterPickerView } from './ui/student-portal/onboarding/StudentRosterPickerView.js';
import * as studentDeviceService from './services/studentDeviceService.js';
import { renderStudentHomeView } from './ui/student-portal/views/StudentHomeView.js';
import { renderStudentAchievementsView } from './ui/student-portal/views/StudentAchievementsView.js';
import { renderStudentTeamView } from './ui/student-portal/views/StudentTeamView.js';
import { renderStudentLearnView } from './ui/student-portal/views/StudentLearnView.js';
import { renderStudentProfileView as renderStudentPortalProfileView } from './ui/student-portal/views/StudentProfileView.js';
import { renderHomeView } from './ui/views/HomeView.js';
import { renderTrackerView } from './ui/views/TrackerView.js';
import { renderSettingsView } from './ui/views/SettingsView.js';
import { renderSetupWizardView } from './ui/views/SetupWizardView.js';
import { renderStudentProfileView } from './ui/views/StudentProfileView.js';
import { renderStudentAccessView } from './ui/views/StudentAccessView.js';
import { renderActivitiesListView, renderActivityRosterView } from './ui/views/ActivitiesView.js';
import { renderNotebookTrackerView } from './ui/views/NotebookTrackerView.js';
import { renderNotebookRegisterView } from './ui/views/NotebookRegisterView.js';
import { renderNotebookTimelineView } from './ui/views/NotebookTimelineView.js';
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
  authService.signOutUser().catch((error) => {
    console.error('[main] Sign-out failed:', error);
  });
}

function handleNewClassroom() {
  openNewClassroomModal({
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
  'notebookTracker',
  'notebookRegister',
  'notebookTimeline',
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
    onBackToLanding: () => router.navigate('/'),
    renderSectionContent: (content) => {
      if (route.section === 'achievements') {
        renderStudentAchievementsView(content);
      } else if (route.section === 'team') {
        renderStudentTeamView(content);
      } else if (route.section === 'learn') {
        renderStudentLearnView(content);
      } else if (route.section === 'profile') {
        renderStudentPortalProfileView(content, {
          onSwitchStudent: async () => {
            const remembered = studentDeviceService.getRememberedProfiles();
            if (remembered.length < 2) return; // nothing to switch to
            renderStudentRosterPickerView(content, {
              title: "Who's using Bloom Labs today?",
              students: remembered,
              onSelect: (studentRef) => {
                studentDeviceService.setLastActiveProfile(studentRef);
                renderRoute(router.getCurrentRoute());
              },
            });
          },
        });
      } else {
        renderStudentHomeView(content);
      }
    },
  });
}

function renderRoute(route) {
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

    renderStudentDeviceFlow(appContainer, {
      onResolved: () => renderStudentPortalMain(route),
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

  if (CLASSROOM_ROUTE_NAMES.includes(route.name)) {
    const classroom = workspaceService.getClassroomById(route.classroomId);
    if (!classroom) {
      router.navigate('/teacher');
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
          } else if (item.subjectId && item.notebookTypeId) {
            const dateSegment = item.dateKey ? `/${item.dateKey}` : '';
            router.navigate(`/classroom/${classroom.id}/notebooks/${item.subjectId}/${item.notebookTypeId}${dateSegment}`);
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
      });
    } else if (route.name === 'notebookTracker') {
      renderNotebookTrackerView(appContainer, {
        classroom,
        onBack: () => router.navigate(`/classroom/${classroom.id}`),
        onSelectNotebook: (subjectId, notebookTypeId) =>
          router.navigate(`/classroom/${classroom.id}/notebooks/${subjectId}/${notebookTypeId}`),
      });
    } else if (route.name === 'notebookRegister') {
      continueWorkingService.recordRecentNotebook(currentUser?.uid, {
        classroomId: classroom.id,
        subjectId: route.subjectId,
        notebookTypeId: route.notebookTypeId,
      });
      renderNotebookRegisterView(appContainer, {
        classroom,
        subjectId: route.subjectId,
        notebookTypeId: route.notebookTypeId,
        dateKey: route.dateKey,
        currentUser,
        onBack: () => router.navigate(`/classroom/${classroom.id}/notebooks`),
        onNavigateDate: (dateKey) =>
          router.navigate(`/classroom/${classroom.id}/notebooks/${route.subjectId}/${route.notebookTypeId}/${dateKey}`),
        onOpenTimeline: () =>
          router.navigate(`/classroom/${classroom.id}/notebooks/${route.subjectId}/${route.notebookTypeId}/timeline`),
        onSelectStudent: (studentId) => router.navigate(`/classroom/${classroom.id}/student/${studentId}`),
      });
    } else {
      renderNotebookTimelineView(appContainer, {
        classroom,
        subjectId: route.subjectId,
        notebookTypeId: route.notebookTypeId,
        onBack: () => router.navigate(`/classroom/${classroom.id}/notebooks/${route.subjectId}/${route.notebookTypeId}`),
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
    router.onRouteChange(renderRoute);

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
          workspaceService.stopListening();
          currentAccentColorId = 'ocean';
          accentColorService.applyAccentColor('ocean');
          renderRoute(router.getCurrentRoute());
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
        renderRoute(router.getCurrentRoute());

        workspaceService
          .initForUser(user.uid, user.displayName, () => {
            workspaceLoading = false;
            renderRoute(router.getCurrentRoute());
          })
          .catch((error) => {
            console.error('[main] Failed to load classrooms:', error);
            workspaceLoading = false;
            window.alert('We couldn\u2019t load your classrooms. Please check your connection and try again.');
            renderRoute(router.getCurrentRoute());
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
