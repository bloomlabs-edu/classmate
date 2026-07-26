# Changelog

All notable changes to Classroom Tracker are documented in this file, one entry per implementation phase.

---

## Phase 1 — Progress Engine & Foundation (Recognition/Dashboard groundwork)

**Scope:** computation and infrastructure only. No UI redesign, no new screens, no new navigation. Verified via full regression smoke test that existing functionality (classroom creation, Class Mode scoring, Settings, Notebook Tracker's Register/Timeline views, Student Profile) behaves identically to before this phase.

### Features Added
- **Weekly/monthly Progress Engine**: `studentProgressService` can now compute stars, ranks, streaks, and notebook completion scoped to a Monday-start week, a calendar month, or all-time — all derived from existing, permanent data (`student.history`, `classroom.notebooks`); nothing new is stored for this.
- **Recognition computation engine**: configuration-driven recognition categories (Star Performer, Longest Learning Streak, Notebook Champion, Team Champion, Biggest Climber) with automatic co-winner support — ties are never artificially broken.
- **Leaderboard computation**: one reusable ranked-list function per category, shared by recognition-winner lookup and full leaderboard display.
- **Biggest Climber**: rank-movement-based (not simple star-delta), with star total as a documented secondary tie-breaker, and exclusion of students with no tracked history before the comparison period.
- **Pending Tasks framework**: three initial checkers (notebook not checked today, activities awaiting completion, homework awaiting review), each independently extensible via config.
- **Continue Working infrastructure**: per-teacher (not classroom-shared) "recently opened notebooks" read/write path, capped at 5, most-recent-first. **Not yet wired to any UI call site** — see Breaking Changes/Deferred below.
- **Role & membership scaffolding**: `STUDENT` and `PARENT` added to `MEMBER_ROLES` as provider-agnostic placeholders (no permissions, no auth path). A reserved, unused `classroomJoinCode` field added to the Classroom model, documenting the future joining flow's plug-in point without implementing it.

### Files Created
- `src/js/config/recognitionCategories.js`
- `src/js/config/pendingTaskTypes.js`
- `src/js/services/pendingTaskService.js`
- `src/js/services/continueWorkingService.js`
- `CHANGELOG.md` (this file)
- `docs/PROGRESS_ENGINE.md` — architecture, full function reference, weekly/monthly rules, tie handling, the Biggest Climber algorithm, recognition/leaderboard/pending-task computation, and a Performance Notes section (complexity, bottlenecks, and documented-only future caching opportunities)

### Files Modified
- `src/js/services/studentProgressService.js` — major expansion (see Features Added); prior functions (`getCompletionPercent`, `getCurrentStreak`, `getBestStreak`, `getLastChecked`) unchanged.
- `src/js/config/memberRoles.js` — added `STUDENT`/`PARENT` roles with empty permission sets.
- `src/js/models/Classroom.js` — added reserved `classroomJoinCode` field (default `null`).
- `src/js/services/classroomService.js` — backfills `classroomJoinCode` for classrooms saved before this field existed.
- `src/js/utils/dateHelpers.js` — added `getMondayStartOfWeek`, `getWeekRange`, `getPreviousWeekRange`, `getMonthRange`, `isDateKeyInRange`.
- `src/js/repositories/classroomRepository.js` — added `recordRecentNotebook`/`subscribeToRecentNotebooks` to the interface.
- `src/js/repositories/firestoreClassroomRepository.js` — implemented the above two methods (transaction-guarded, capped-at-5 write to the existing `users/{uid}` document — no new collection).

### Breaking Changes
None. Every addition is new files or additive fields/functions; nothing existing was renamed or removed.

### Deferred (deliberately, within this phase)
- `continueWorkingService.recordRecentNotebook()` is fully built and tested but **not called from anywhere yet** — wiring it into `NotebookRegisterView.js` is deferred to Phase 2, since that's when the Dashboard widget that consumes this data exists. Calling it now would be an invisible-but-real new Firestore write triggered by using the app today, which this phase's "no behavior change" constraint was meant to avoid.

### New Services Introduced
- `pendingTaskService` (read-only)
- `continueWorkingService` (the one write-capable addition this phase — personal-to-teacher, not classroom-shared)

### New Configuration Files
- `recognitionCategories.js` — extensible recognition category registry
- `pendingTaskTypes.js` — extensible pending-task-type registry

### Architectural Decisions Made During Implementation
- **"Stars" = positive points only.** Deductions never count toward a star total, matching the app's existing "Total Positive Points" concept and its established visual-language rule that stars are always a positive-only metric.
- **Standard competition ranking** (ties share a rank; the next distinct value skips accordingly) used everywhere, so "celebrate co-winners, never artificially break ties" falls out of the ranking algorithm itself rather than needing special-case logic per category.
- **Leaderboards are always complete** (every student/team, including zero-value entries) for teacher browsing; **recognition winners additionally require a non-zero winning value**, so an empty or brand-new classroom doesn't crown a winner who earned nothing.
- **Longest Streak, when scoped to a week or month, means the longest complete-in-a-row run that occurred within that specific date range** (naturally capped at ~7 or ~31), not a student's all-time current streak — a different, period-bounded calculation from the existing Student-Profile-facing `getCurrentStreak`/`getBestStreak`, which remain unchanged and unbounded.
- **Biggest Climber's "did this student exist before now" check compares against the start of the *current* period, not the previous period.** (Corrected during implementation — an earlier draft compared against the previous period's start, which incorrectly excluded students whose earliest-ever activity happened to fall exactly on that boundary date. Caught by a test that deliberately used that exact edge case.)
- **Continue Working is scoped to `users/{uid}`, not the classroom document** — reusing the same per-account document already used for the migration flag, rather than introducing a new collection.
- **Pending Tasks' "homework awaiting review" is defined generically** (any notebook type, not just ones literally named "Homework") as "submitted but not yet assessed," since matching on a type's display name would be fragile.
- **`continueWorkingService.recordOpened()` renamed to `recordRecentNotebook()`** (post-Phase-1 review) — considered and rejected a broader `recordWorkspace()` name, since the function only ever accepts a notebook-shaped payload and Continue Working was explicitly scoped to notebooks in the approved brief. A generic name over a notebook-shaped payload would overstate current capability rather than future-proof it; the chosen name instead matches the repository method it wraps (`repository.recordRecentNotebook`) precisely. If Continue Working later broadens to other kinds of recent work, that's the point to design the richer shape and rename again — the same pattern already used once in this project (`notebookCheckService` → `notebookService`).

### Future TODOs
- Wire `continueWorkingService.recordRecentNotebook()` into `NotebookRegisterView.js` (Phase 2).
- Build the Classroom Dashboard consuming Recognition Wall / Weekly Snapshot / Continue Working / Pending Tasks (Phase 2).
- Build the dedicated Recognition screen and Leaderboard UI (Phase 3).
- Build the teacher-only Student Dashboard preview (Phase 4) — no authentication, no student accounts.
- Student/Parent onboarding (Class Code/QR joining, real authentication) remains blocked pending AI Working Committee review; `STUDENT`/`PARENT` roles and `classroomJoinCode` exist only as unused placeholders until then.

---

## Phase 2 — Classroom Dashboard

**Scope:** navigation, layout, and information architecture. No theming, no animation — explicitly deferred to Phase 5 per the phase plan. Verified via full regression testing (screenshots + Playwright) that every pre-existing screen (Notebook Tracker, Register View, Timeline View, Settings tabs, Class Mode scoring, deep-linking/page-reload) continues to work.

### Features Added
- **Classroom Dashboard**: the new default landing page at `/classroom/{id}`, replacing Class Mode as the first thing a teacher sees. Assembled entirely from independent, reusable widgets — no functionality duplicated from Notebook Tracker, Settings, or Class Mode.
- **Seven widgets**, each its own component: `RecognitionWidget`, `WeeklySnapshotWidget`, `ContinueWorkingWidget`, `PendingTasksWidget`, `SubjectsWidget`, `GroupsWidget`, `ClassModeWidget` — every one with a thoughtful, distinct empty state, verified on a brand-new classroom.
- **Class Mode relocated, not modified**: now reached via `/classroom/{id}/class-mode` through the Dashboard's "Start Class Mode" button. `TrackerView.js` itself has zero internal changes; only what routes into it and where its "Back" button returns to.
- **Continue Working's deferred Phase 1 wiring completed**: `continueWorkingService.recordRecentNotebook()` now has its first real call site, in `main.js`'s route dispatch for `notebookRegister` — firing on genuine navigation to a notebook, not on every internal re-render (e.g. marking a student). Verified end-to-end: opening a notebook and returning to the Dashboard shows it in Continue Working.
- **`getRecentNotebooksOnce()`** added to the repository/service layer — a one-time read, deliberately not a live subscription (see Architectural Decisions below).

### Files Created
- `src/js/ui/views/DashboardView.js`
- `src/js/ui/components/RecognitionWidget.js`
- `src/js/ui/components/WeeklySnapshotWidget.js`
- `src/js/ui/components/ContinueWorkingWidget.js`
- `src/js/ui/components/PendingTasksWidget.js`
- `src/js/ui/components/SubjectsWidget.js`
- `src/js/ui/components/GroupsWidget.js`
- `src/js/ui/components/ClassModeWidget.js`

### Files Modified
- `src/js/ui/router.js` — `/classroom/{id}` (bare) now resolves to `'dashboard'` instead of `'tracker'`; added `/classroom/{id}/class-mode` → `'tracker'`.
- `src/js/main.js` — added the `dashboard` route render branch; `tracker` route's `onBack` now returns to the Dashboard instead of Home; added the `recordRecentNotebook()` call site for the `notebookRegister` route.
- `src/js/repositories/classroomRepository.js` / `firestoreClassroomRepository.js` — added `getRecentNotebooksOnce(uid)` (one-time read, alongside the existing live `subscribeToRecentNotebooks`).
- `src/js/services/continueWorkingService.js` — added `getRecentOnce(uid)` wrapping the above.
- `src/css/styles.css` — minimal structural CSS for the new widgets (layout/spacing only, no visual polish, per this phase's explicit scope).

### Routing Changes
| Path | Before | After |
|---|---|---|
| `/classroom/{id}` | Class Mode (Tracker) | **Classroom Dashboard** |
| `/classroom/{id}/class-mode` | *(did not exist)* | Class Mode (Tracker) — unchanged internally |

Every other existing route (`settings`, `setup`, `student`, `activities`, `notebooks`, `notebooks/.../timeline`) is unchanged. Every `onBack`/`onFinish` callback that already pointed at bare `/classroom/{id}` now naturally lands on the Dashboard instead of Class Mode — no additional call sites needed updating beyond the one described above.

### Breaking Changes
None for end users — every existing screen and interaction is reachable and behaves identically to before. The one behavioral change is intentional and specified: the classroom's landing page is now the Dashboard instead of Class Mode.

### Architectural Decisions Made During Implementation
- **Subjects widget does not truly filter Notebook Tracker to one subject.** Clicking a subject navigates to the existing, unfiltered Notebook Tracker list (which already groups by subject). True filtering would require modifying `NotebookTrackerView.js`, which this phase's "existing modules remain their existing implementation" constraint argues against. Flagged for a decision rather than built silently — see the design-concerns note at the start of this phase's implementation.
- **Continue Working uses a one-time read, not a live subscription**, inside the Dashboard widget. This app has no view-unmount/cleanup mechanism — every prior live subscription lives at the `main.js`/app level, where a full-page re-render naturally supersedes the old one. A view-scoped subscription on `users/{uid}` (a document separate from the classroom, so the existing classroom listener can't cover it) would leak a listener on every Dashboard visit without a cleanup hook this app doesn't have yet. A one-time read was judged an honest, sufficient tradeoff for this feature's actual need ("what did I recently open, before this visit"), rather than introducing new lifecycle machinery to solve a problem this specific widget doesn't really have.
- **`recordRecentNotebook()` is called from `main.js`'s route dispatch, not from inside `NotebookRegisterView.js`'s render function.** The view's render function is also called internally (via its own `rerender()` closure) for actions like marking a student, which shouldn't re-trigger "recently opened" bookkeeping. Routing through `main.js` means the call fires only on genuine navigation to a notebook (including day-to-day navigation, which does route through `main.js`), not on every in-place UI update.
- **"Reports" is a disabled placeholder button, not a widget.** It has never been built in this app (only ever a planned nav item); this phase gives it the same "Coming Soon"-style treatment already established for the Teachers tab's invite button, rather than building a stub screen or a fake widget with no real data behind it.
- **Weekly Snapshot's "Weekly Stars" figure is a classroom-wide total** (sum across every student), distinct from the "Weekly Leaderboard" preview immediately below it (top 3 by individual rank, full tie inclusion). Read together, they answer "how much happened this week" and "who's leading" as two different questions rather than one being a subset view of the other.
- **Recognition Wall omits categories with no winner individually** rather than showing a "no winner" placeholder per category; the widget only shows one overall empty state if literally nothing has any winner yet. Matches "every widget should have a thoughtful empty state" as a single, whole-widget message rather than a repeated one.

### Future TODOs
- True per-subject filtering for the Subjects widget (currently opens the full Notebook Tracker list) — pending your decision on whether it's worth a small, scoped addition to `NotebookTrackerView.js`.
- Build the dedicated Recognition screen and Leaderboard UI (Phase 3).
- Build the teacher-only Student Dashboard preview (Phase 4) — no authentication, no student accounts.
- Student/Parent onboarding remains blocked pending AI Working Committee review.
- Visual/theme/animation polish for the Dashboard and its widgets — explicitly deferred to Phase 5.

---

## Phase 2 Refactor — Grouped Dashboard Hierarchy

**Context:** a design-first review (requested before this refactor, after Phase 2's initial implementation had already shipped) proposed grouping the Dashboard's flat widget list into two labeled sections — "Teaching" and "Classroom" — so the page more clearly answers four questions in order: what to celebrate, what needs attention, what to do next, and how the classroom is organized. Approved and implemented as a **structural refactor**, not a rebuild: every existing widget component is reused completely unchanged.

### What Changed
- `DashboardView.js`'s assembly logic: Recognition Wall and Weekly Snapshot remain ungrouped at the top (equal visual weight, both answering "what to celebrate"); Continue Working and Pending Tasks remain ungrouped immediately below (both answering "what needs attention"); Start Class Mode, Subjects, and a new Activities placeholder are now grouped under a "Teaching" heading; Groups, Reports, and Settings are now grouped under a "Classroom" heading.
- Start Class Mode is listed first within Teaching for visual priority, matching its status as the single most-performed daily action — using its existing, already-larger CTA styling rather than any new visual treatment.
- Reports and Settings moved from a standalone `actionsRow` into the new Classroom section (same buttons, same behavior, different container).
- Added an "Activities" placeholder (disabled, "Coming soon") inside Teaching — see Architectural Decisions below for why this doesn't conflict with the fact that Learning Activities already exists as a working feature elsewhere in the app.

### What Was Intentionally Left Unchanged
- **Every widget component file** (`RecognitionWidget.js`, `WeeklySnapshotWidget.js`, `ContinueWorkingWidget.js`, `PendingTasksWidget.js`, `SubjectsWidget.js`, `GroupsWidget.js`, `ClassModeWidget.js`) — zero code changes. The refactor only changed which container each one is appended to.
- **No renames.** `ClassModeWidget`/`GroupsWidget` were considered for a `...Card` rename to match an example tree, but rejected: renaming just these two would introduce a second naming convention alongside `RecognitionWidget`/`WeeklySnapshotWidget`/etc., reducing consistency rather than improving it. Per the explicit instruction to avoid cosmetic-only renames, they keep their existing names.
- **Routing** — unchanged from the original Phase 2 implementation (`/classroom/{id}` → Dashboard, `/classroom/{id}/class-mode` → Tracker). This refactor is a rendering/layout change only.
- **Responsiveness** — still single-column at every breakpoint, matching every other screen in this app. Multi-column layout experimentation is explicitly deferred to Phase 5.
- **Continue Working's one-time-read design** (vs. a live subscription) — unchanged; still the right call for the reasons documented in the original Phase 2 entry above.

### Files Created
- `src/js/ui/components/TeachingSection.js` — lightweight layout wrapper (heading + children), no data source or service of its own.
- `src/js/ui/components/ClassroomSection.js` — same pattern, for the Classroom grouping.

### Files Modified
- `src/js/ui/views/DashboardView.js` — restructured assembly logic (see "What Changed" above); added two small inline placeholder-button helpers (`createActivitiesPlaceholder`, `createReportsPlaceholder`) and a `createSettingsButton` helper, replacing the previous flat `actionsRow`.
- `src/css/styles.css` — removed the now-unused `.dashboard-view__actions-row`/`.dashboard-widget__actions-row` rule; added minimal structural CSS for `.dashboard-section`/`.dashboard-section__heading`/`.dashboard-section__group` (layout only — no color/theme changes).

### Regression Verification
Full Playwright pass confirmed: section headings render correctly grouping the intended children; Settings navigation from the Classroom section works; Subjects widget (now inside Teaching) still navigates to Notebook Tracker; Groups widget (now inside Classroom) still navigates to Settings › Groups; Start Class Mode still launches Class Mode unchanged; Back from Class Mode still returns to the Dashboard. Pending Tasks correctly reflected real state (a configured-but-unchecked notebook) against the refactored layout. **No functionality regressed** — confirmed by direct testing, not by inspection alone.

### Architectural Decisions Made During Implementation
- **TeachingSection/ClassroomSection are composition-only**, per instruction — no data fetching, no service imports, no empty state of their own (they can't be empty; they always have their fixed set of children).
- **The Activities placeholder does not conflict with the already-existing, fully-working Learning Activities feature** (reachable via Class Mode's header, unmodified). The placeholder is specifically about the *Dashboard* not yet having its own direct entry point to that feature — not about the feature being unbuilt. Flagging this explicitly since "Activities (future placeholder)" could otherwise read as a regression to someone who already uses Learning Activities today; it isn't one.
- **Reports and Settings render as full-width stacked buttons** within the Classroom section's single-column group, rather than the previous right-aligned row — a direct, minimal consequence of reusing the same `.dashboard-section__group` layout as every other section, not a deliberate visual decision (visual polish remains a Phase 5 concern).

### Future TODOs
(Unchanged from the original Phase 2 entry — this refactor didn't add or resolve any.)

---

## Phase 3 — Recognition Experience

**Scope:** a dedicated Recognition Screen, two newly-extracted reusable components (`RecognitionCard`, `LeaderboardList`), and the routing/navigation connecting it to the Dashboard's existing Recognition Wall. Implemented in the approved order: extract `RecognitionCard` → extract `LeaderboardList` → build `RecognitionScreenView` → wire Dashboard "View All" → routing → regression testing → documentation. The Progress Engine (`studentProgressService.js`) was not modified at all this phase — every new screen and component consumes functions that already existed from Phase 1.

### Features Added
- **Recognition Screen** (`/classroom/{id}/recognition/{period?}/{categoryId?}`): period tabs (This Week / This Month / All Time), categories grouped by purpose (🏆 Performance, 📈 Growth, 🤝 Team, ⭐ Special Recognition), a full Winner Card for the selected category/period, and its leaderboard embedded directly below with in-place expand/collapse ("Show all" / "Show less" — no navigation, no separate page).
- **`RecognitionCard`**, extracted from a private function inside `RecognitionWidget.js` into its own reusable component with two variants: `compact` (Dashboard Wall — icon, label, names only) and `full` (Recognition Screen — adds reason, a prominently-formatted key statistic, and the period). Handles co-winners (never truncated) and a distinct Team Champion presentation (group icon + team name, not student initials).
- **`LeaderboardList`**, extracted as a fully generic, reusable ranked-list component — knows nothing about recognition categories, only renders whatever `entries`/`formatValue` it's given.
- **Recognition config extended**: `recognitionCategories.js` gained a `group` field (replacing the earlier, effectively-unused `kind`/`RECOGNITION_KINDS`), a `reasonText` per category (the Card's "Why?" answer), and a new `FUTURE_RECOGNITION_PLACEHOLDERS` list (Most Improved, Teacher's Choice, Most Helpful, Best Reader, Best Speaker, Creative Thinker, Perfect Attendance) rendered as visibly-disabled chips on the Recognition Screen — communicating "more is coming" without any computed data or fake resolver behind them.
- **Dashboard "View All"**: a small link in the Recognition Wall's header, navigating to the Recognition Screen at its default period/category.
- **Category/period auto-redirect**: selecting a period that the current category doesn't support (e.g. switching to "All Time" while viewing Biggest Climber, which only supports week/month) redirects to the first category that *does* support it, keeping the URL always valid and shareable rather than silently rendering a mismatched state.

### Files Created
- `src/js/ui/components/RecognitionCard.js`
- `src/js/ui/components/LeaderboardList.js`
- `src/js/ui/views/RecognitionScreenView.js`

### Files Modified
- `src/js/config/recognitionCategories.js` — `kind`/`RECOGNITION_KINDS` replaced with `group`/`RECOGNITION_GROUPS`/`RECOGNITION_GROUP_LABELS`/`RECOGNITION_GROUP_ORDER`; added `reasonText` per category; added `FUTURE_RECOGNITION_PLACEHOLDERS`.
- `src/js/ui/components/RecognitionWidget.js` — now consumes the shared `RecognitionCard` (compact variant) instead of its own private card-building function; added the "View All" link.
- `src/js/ui/views/DashboardView.js` — threads `onOpenRecognition` through to the Recognition widget.
- `src/js/ui/router.js` — added `/classroom/{id}/recognition/{period?}/{categoryId?}`.
- `src/js/main.js` — added `'recognition'` to the classroom route names; added the route dispatch branch; wired `onOpenRecognition` on the dashboard route.
- `src/css/styles.css` — replaced the old flat `.recognition-card` rules (compact-only) with variant-aware rules (`--compact`/`--full`), co-winner row layout, and new rules for the Recognition Screen's tabs/chips and the Leaderboard List.

### Routing Changes
| Path | Resolves to |
|---|---|
| `/classroom/{id}/recognition` | Recognition Screen, defaults to this week / first available category |
| `/classroom/{id}/recognition/{period}` | Recognition Screen, period selected, first available category for it |
| `/classroom/{id}/recognition/{period}/{categoryId}` | Both selected — deep-linkable and shareable |

No other existing route changed.

### Breaking Changes
None. `RECOGNITION_KINDS` was exported but never actually consumed anywhere in rendering logic (confirmed by grep before removing it) — its replacement by `group` has no observable effect on anything built in Phases 1–2.

### Regression Verification
Full Playwright pass confirmed: co-winner ties render correctly on both the Dashboard Wall and the Recognition Screen; all four group headings and all seven disabled placeholder chips render; the leaderboard's "Show all"/"Show less" toggle works in place with zero navigation; period-switching correctly auto-redirects away from a category that doesn't support the new period (Biggest Climber + All Time); empty states render correctly for a category with no winner. Separately, a full regression pass confirmed every Phase 1/2 feature (Settings, Notebook Tracker, Register View, Timeline View, Class Mode scoring, Dashboard's Teaching/Classroom sections) continues to work unchanged.

### Architectural Decisions Made During Implementation
- **The Progress Engine was not touched.** Every new screen/component consumes `getRecognitionWinners()`/`getLeaderboard()` exactly as Phase 1 built them — Phase 3 is purely a presentation-layer expansion, matching the explicit instruction to implement "using the existing Progress Engine without modifying its architecture."
- **`FUTURE_RECOGNITION_PLACEHOLDERS` is a separate list from `RECOGNITION_CATEGORIES`**, not the same array with a "disabled" flag — keeping real, computable categories and inert placeholders structurally distinct means `getRecognitionWinners()`/`getLeaderboard()` never need to special-case "a category with no resolver."
- **Formatting logic (key statistic strings, leaderboard value strings) lives in the UI layer** (`RecognitionCard.js`, `RecognitionScreenView.js`), not in config or the Progress Engine — `studentProgressService.js` returns plain structured data (numbers, names, ranks) only; every "5 Stars" / "12-Day Streak" / "+4 Rank Positions" string is assembled at render time from that data. This is also precisely what makes the future-certificate design goal achievable without engine changes.
- **`LeaderboardList` deliberately has zero knowledge of recognition categories** — it accepts entries and a `formatValue` function from its caller, so it's genuinely reusable (e.g. for a future dedicated Group Leaderboard) rather than reusable in name only.

### Future TODOs
- True per-subject filtering for the Subjects widget (carried over from Phase 2 — still unresolved).
- Build the teacher-only Student Dashboard preview (Phase 4) — no authentication, no student accounts.
- Printable certificate / Wall of Fame / assembly-announcement presentation of `RecognitionCard` — designed for, not built.
- Teacher's Choice, once implemented, needs its own explicitly write-capable service (e.g. `teacherChoiceService.js`), kept separate from the read-only Progress Engine — see the Phase 3 design discussion.
- Perfect Attendance needs an attendance data source before it can move from placeholder to computed category.
- Student/Parent onboarding remains blocked pending AI Working Committee review.
- Visual/theme/animation polish — explicitly deferred to Phase 5.

---

## Phase 4 — Teacher Productivity (Header Consolidation)

**Context:** a design-first review of teacher workflow friction concluded that the Dashboard's real gap wasn't missing features but redundant navigation for the two highest-frequency needs (starting Class Mode, resuming a recently-opened notebook) — both already existed and worked, just positioned mid-page behind celebratory content. Rather than adding a new "Quick Start" widget (my original proposal), a simpler approach was approved: **relocate** both into a slot-based header, with zero duplication.

### Features Added
- **`ClassroomHeader`**: a new, generic slot-based header component (`Primary Action` / `Secondary Content` / `Classroom Context`) — deliberately not coupled to any specific widget, so a future phase can change what fills either slot without touching this file.
- **Start Class Mode relocated** into the header's Primary Action slot — visible with zero scrolling the instant a teacher opens a classroom. Removed from the Teaching section (not duplicated).
- **Continue Working relocated** into the header's Secondary Content slot — same one-time-read loading pattern as before, just appending into a different container. Removed from its previous mid-page position (not duplicated).
- **Activities upgraded from a disabled placeholder to a real shortcut** into the existing, already-built Learning Activities feature (`ActivitiesView.js`) — the feature itself was never unbuilt; the Dashboard simply hadn't grown a direct link to it until now.
- **Pending Tasks made actionable**: each item is now clickable (via a new `onSelectTask` callback), deep-linking straight to the relevant Notebook Register View or Activity roster. No changes to `pendingTaskService.js` itself — every checker already returned everything a link needs (`subjectId`/`notebookTypeId`/`dateKey`, or `activityId`).

### Files Created
- `src/js/ui/components/ClassroomHeader.js`

### Files Modified
- `src/js/ui/views/DashboardView.js` — assembles the new header; removed `ClassModeWidget` from the Teaching section and the old `continueWorkingSlot` from mid-page content; Activities placeholder replaced with a real link; Pending Tasks now receives `onSelectPendingTask`.
- `src/js/ui/components/PendingTasksWidget.js` — items render as buttons (via the optional `onSelectTask` callback) rather than plain text when the callback is provided.
- `src/js/main.js` — added `onOpenActivities` and `onSelectPendingTask` to the dashboard route; the latter interprets each Pending Task item's shape (`activityId` vs. `subjectId`+`notebookTypeId`(+`dateKey`)) to build the correct navigation target.
- `src/css/styles.css` — structural CSS for the header's three slots and the clickable Pending Task links (layout only, no visual polish).

### Breaking Changes
None. Every relocation removes a widget from exactly one place and adds it to exactly one other — confirmed by direct testing that "Start Class Mode" and "Continue Working" each appear exactly once on the page, never zero, never two.

### Regression Verification
Full Playwright pass confirmed: header renders both slots correctly on a brand-new classroom; neither Start Class Mode nor Continue Working appears anywhere else on the page; the Activities link is genuinely enabled and navigates to the real Learning Activities list; a Pending Task for an unchecked notebook deep-links to its Register View (today, no explicit date needed) and disappears from the list once marked; a Pending Task for an activity awaiting completion deep-links to that activity's roster; Class Mode via the header still launches correctly and "Back" still returns to the Dashboard; the Recognition Screen remains reachable via "View All." Every Phase 1–3 capability continues to work.

### Architectural Decisions Made During Implementation
- **`ClassroomHeader` is intentionally generic**, per the explicit design refinement — it exposes three named slots and has no knowledge of what's inside them. This phase fills Primary Action and Secondary Content with existing, unmodified widgets; a future phase could put something else in either slot without any change to this component.
- **Notebook quick-open was explicitly not built.** Continue Working only covers notebooks opened recently; a specific, not-recently-opened notebook still requires the Subjects → Notebook Tracker path. Assessed as the lowest-frequency of the identified needs and deliberately deferred rather than added to the header, per the explicit decision to keep the header simplification narrow rather than reintroducing scope it was meant to avoid.
- **Recently Viewed Students was explicitly not built**, per the approved scope — remains a recommended future feature, intentionally kept independent from Continue Working rather than merged into a broader "recent work" concept (see the Phase 4 design discussion's trade-off analysis).
- **Award Stars was explicitly rejected as a Dashboard shortcut** — awarding a star outside Class Mode's existing Undo-stack-aware flow risks fragmenting the one coherent scoring model this app deliberately built; Class Mode continues to be the only way to award stars.
- **Pending Task navigation logic lives in `main.js`, not inside `PendingTasksWidget.js`** — consistent with this app's established pattern (e.g. the Notebook Register's `recordRecentNotebook` call site) of keeping routing decisions at the `main.js` dispatch boundary, with components themselves staying free of `router` imports.

### Future TODOs
- Notebook quick-open (a flat shortcut list of configured notebook types, skipping the Notebook Tracker list screen) — identified as a real but lower-priority gap; not scheduled.
- Recently Viewed Students — approved in principle as a future, independent widget following Continue Working's exact one-time-read pattern; not scheduled.
- Build the teacher-only Student Dashboard preview (Phase "Student Preview") — no authentication, no student accounts.
- Printable certificate / Wall of Fame / assembly-announcement presentation of `RecognitionCard` — designed for, not built.
- Teacher's Choice, once implemented, needs its own explicitly write-capable service, kept separate from the read-only Progress Engine.
- Perfect Attendance needs an attendance data source before it can move from placeholder to computed category.
- Student/Parent onboarding remains blocked pending AI Working Committee review.
- Visual/theme/animation polish — explicitly deferred.

---

## Phase 5 — Theme & Motion System

**Scope:** a unified design-token system (color, spacing, radius, elevation, typography, font-weight, motion) and a small, purpose-first motion layer, applied across the existing UI. No new features — every stage was verified to change nothing functionally except where a fix was explicitly warranted (see the accessibility contrast fixes below). Implemented in the approved reorder: **1. Design tokens → 2. Theme migration → 3. Component cleanup → 4. Accessibility pass → 5. Motion rollout**, testing after each stage.

### A correction made before Stage 1

The original design proposal invented arbitrary hex values for Success (`#2f9e5b`) and a Recognition-specific accent (`#c8952a`). Before writing any tokens, the project's actual TFI brand guide (`tfi-brand` skill) was checked — it already documents **TFI Lime Green (`#B7C930`)** as the brand's "secondary accent" and **TFI Orange (`#FF9629`)** as "warm accent, highlights." Both were used instead of the invented values — Success = Lime Green, Accent = Orange (per the approved rename from a Recognition-specific token to a general one). Warning (TFI Yellow) and Danger (TFI Red-Orange) were already brand-correct and unchanged.

### Features Added — Stage 1 (Design tokens)
Purely additive; verified via screenshot comparison that nothing rendered differently. Added to `:root`: semantic color aliases (`--color-primary`, `--color-primary-strong`, `--color-success`, `--color-warning`, `--color-accent`), a 7-step spacing scale (`--space-1` … `--space-7`), a pill radius token, a 5-level elevation scale (`--elevation-flat` → `--elevation-card` → `--elevation-hover` → `--elevation-sheet` → `--elevation-dialog`), a typography scale (`--text-xs` … `--text-2xl`), font-weight tokens (`--font-weight-regular/medium/bold/black`), and motion tokens (`--duration-instant/fast/base/celebratory`, one shared `--ease-standard`).

### Features Added — Stage 2 (Theme migration)
Every component-level reference to `--color-cyan`/`--color-cyan-dark`/`--shadow-card` migrated to the new semantic names (`--color-primary`/`--color-primary-strong`/`--elevation-card`). Pure rename — verified the computed color still resolves to the exact original TFI Cyan value (`rgb(14, 192, 226)`) after migration.

### Features Added — Stage 3 (Component cleanup)
- Every `font-weight` numeric value tokenized (600/700/800 all had exact token matches — zero visual change).
- Every hardcoded `border-radius: 999px` tokenized to `--radius-pill`.
- Recognition Cards given a distinct visual identity: a 3px top border in the new Accent color (TFI Orange) — the one genuinely new visual element in this stage, scoped narrowly to where it was designed to matter.
- The sixth and final button interaction state, **loading**, added (`[aria-busy="true"]`) — static appearance only at this stage (dimmed, a ring shown but not yet spinning), since the actual spin is motion and this stage was expressly the visual system, not motion.

### Features Added — Stage 4 (Accessibility pass)
- **A real WCAG AA contrast failure found and fixed**, not just documented: white text on TFI Cyan measures 2.17:1 — fails the 4.5:1 requirement for every text size in this app (none of the affected elements were large enough to qualify for the 3:1 "large text" exception, confirmed by checking each one's actual font-size). Fixed by changing text color to dark ink (8.0:1 contrast) everywhere this pairing occurred: the primary button (including "Start Class Mode," the single most-used button in the app), the Team Card header bar, the wizard checklist's done-icon, the user avatar's initial-letter fallback, active toggle-group buttons (Submission/Completion toggles, period tabs), the Notebook Register's "Today" badge, and the Recognition Screen's active category chip. **The brand color itself was never changed** — only the text color paired with it.
- `:focus-visible` extended to Phase 2–4's newer interactive elements that had been relying on browser-default outlines: dashboard chips, pending-task links, the leaderboard's expand/collapse toggle, and recognition category chips.
- The two separate, duplicated `@media (prefers-reduced-motion: reduce)` blocks identified in the original design review consolidated into one.
- `--color-muted` on `--color-bg`/`--color-surface` was checked (6.03:1 / 6.43:1) and already passes comfortably — no change needed there.

### Features Added — Stage 5 (Motion rollout)
- Every remaining hardcoded transition/animation duration and easing (`0.1s`/`0.15s`/`0.2s`/`0.22s`/`0.35s`, all bare `ease`) tokenized onto the Stage 1 motion scale.
- The button loading state's spinner animation completed (`@keyframes btn-spin`, 0.6s linear infinite — deliberately not one of the one-shot interaction durations, since a continuous loop needs different timing logic than a single state change).
- **Recognition card entrance animation**: fade + small upward lift (`translateY(8px)` → `0`), using the celebratory *duration* but the same standard easing as everything else — no overshoot, no bounce, per the explicit refinement to keep Recognition "extremely subtle."
- **Pending Task resolution**: success indication + height collapse, combined, as specified. A resolved item briefly reappears in lime-green with a checkmark, then collapses (max-height/opacity/padding all animating to zero) rather than vanishing abruptly. This required a small, explicitly-scoped exception to `PendingTasksWidget.js`'s otherwise-pure rendering: a module-level snapshot of the previous render's pending items, diffed against the current one purely to compute what just resolved — documented in-file as bookkeeping for one visual effect, not new application state.
- Hover-lift extended to dashboard chips (Subjects, Groups, Continue Working) — subtle `translateY(-1px)` + `--elevation-hover`, matching the existing `.classroom-card` pattern, scoped to `:not(:disabled)` only (a disabled chip should never imply clickability).
- "Motion communicates, never entertains" recorded directly in the stylesheet's motion-token comment block as the project's core motion principle, not just a design-conversation decision.

### Files Modified
- `src/css/styles.css` only — this entire phase was CSS plus one small, explicitly-scoped JS addition.
- `src/js/ui/components/PendingTasksWidget.js` — added the previous-render snapshot/diff mechanism for the resolution animation (see Stage 5 above).

### Breaking Changes
None. Stages 1–2 were verified to produce zero visual difference. Stages 3–5's visual changes (Recognition accent border, contrast fixes, new animations) are all deliberate, specified improvements, not incidental side effects.

### Regression Verification
A full Playwright pass after every stage, not just at the end: Stage 1 (screenshot parity), Stage 2 (computed-color parity — confirmed `rgb(14, 192, 226)` unchanged), Stage 3 (Recognition accent border renders as TFI Orange), Stage 4 (all contrast fixes confirmed rendering as dark ink; full Settings/Notebook/Class Mode/Recognition regression with zero page errors), Stage 5 (the Pending Task resolution flow tested end-to-end — check a notebook, return to Dashboard, confirm the lime-green success item appears then collapses to `max-height: 0`, confirm Pending Tasks then shows "You're all caught up"; Recognition card confirmed carrying the `recognition-card-in` animation). A final full regression pass (Settings, Notebook Tracker, Register/Timeline Views, Class Mode, Recognition Screen with period switching) confirmed zero errors.

### A mistake caught and fixed during implementation
While consolidating the two duplicated reduced-motion blocks (Stage 4), the merge accidentally deleted an unrelated mobile-responsive rule (`.notebook-checking-row`/`.notebook-timeline-row` layout at `max-width: 480px`) that had been sitting between the two blocks being merged. Caught immediately by checking for the rule's continued existence after the edit (not just trusting the diff), and restored in the same step before moving on. Documented here rather than left unmentioned, consistent with how the Phase 1 Biggest Climber bug was handled.

### Architectural Decisions Made During Implementation
- **Only one easing curve exists in the whole app, including for Recognition** — per the explicit refinement rejecting overshoot/bounce for celebratory moments. Celebration is distinguished by a longer *duration* only, never a different curve.
- **The elevation scale is five steps (Flat → Card → Hover → Sheet → Dialog), not the three originally proposed** — per the approved refinement, giving modals/sheets genuine visual separation from a merely-hovered card rather than sharing one shadow value across every "raised" element.
- **Font-weight tokens were added even though no dark theme exists yet** — because they were free (exact value matches, zero visual risk) and directly serve "future components automatically inherit them," independent of any theme question.
- **Icon system was explicitly out of scope**, per instruction — emoji stay as-is; a dedicated icon system is deferred to a future visual refresh, not bundled into this phase.
- **The Pending Task resolution animation's stateful diff was kept as narrow as possible** — a plain snapshot comparison, not a general change-detection framework, and explicitly documented as bookkeeping for one visual effect rather than a precedent for giving other otherwise-pure widgets memory between renders.

### Future TODOs
- Consider extending the Recognition accent-border treatment to other celebratory moments if/when they're added (e.g. a future Wall of Fame), per the rationale for renaming the token from Recognition-specific to general Accent.
- Dark theme remains a legitimate future option — this phase's semantic token layer is what makes it cheap to add later (swap token values only, touch no component CSS) — not scheduled now.
- A full pixel-level spacing migration (snapping every remaining ad hoc `padding` value onto the `--space-*` scale) was intentionally scoped narrower this phase (font-weight and radius only, both exact-value migrations) — a good candidate for a future, low-risk follow-up pass.
- (Carried over, unchanged from Phase 4's list): notebook quick-open, Recently Viewed Students, Student Dashboard preview, printable certificates, Teacher's Choice service, Perfect Attendance data source, Student/Parent onboarding.

---

## Phase 6A — Theme System

**Scope:** Light/Dark/System theme support, built directly on Phase 5's token architecture. No workspace personalization (that's Phase 6B, tracked separately). Implemented in stages, testing after each: token architecture correction → dark palette (contrast-verified) → theme resolution service → persistence → UI wiring → full regression.

### A correction made before the dark palette

Before choosing any dark-mode values, checked whether Phase 5's white-on-cyan contrast fix (`--color-ink` used for button text on brand-color fills) would survive a theme where `--color-ink` itself has to flip from dark to light. It wouldn't have — near-white text on cyan measures 1.94:1, worse than the original bug. Introduced `--color-on-brand` (`#1a1a1a`, deliberately never redefined under `[data-theme="dark"]`) and migrated all 8 of Phase 5's affected selectors (`.btn--primary`, `.team-card__header`, `.wizard-checklist__icon--done`, `.wizard-badge`, `.user-bar__avatar--fallback`, `.toggle-group__button--active`, `.notebook-date-bar__today-badge`, `.recognition-screen__category-chip--active`) to it before writing any dark-mode CSS at all.

### A second bug found during dark-mode testing (not before)

`.user-bar` (the persistent top bar) used `--color-ink`/`--color-surface` for its own background/text — fine in light mode, where that produced a fixed dark bar with light text, but under dark theme those tokens flip, which would have **inverted the bar into a light strip** — the opposite of its intended "consistent app chrome" look. Caught by actually looking at a dark-mode screenshot rather than assuming the fix generalized. Introduced two more theme-independent tokens, `--color-chrome-bg`/`--color-chrome-text` (`#1a1a1a`/`#ffffff`), and migrated `.user-bar`, `.user-bar .btn--text` (Sign Out), and the theme selector's own unselected-state colors (which also needed dedicated, contrast-verified fixed values — `#b8bcc0` text at 9.11:1, `#6b7075` border at 3.48:1 — since `--color-muted`/`--color-border` were never designed for a background that stays fixed while the surrounding page theme changes).

### Features Added
- **Dark theme**: `[data-theme="dark"]` overrides only the four genuinely theme-dependent tokens (`--color-bg`, `--color-surface`, `--color-ink`, `--color-muted`, `--color-border`) — every brand color (`--color-primary/success/warning/accent/danger`) and both theme-independent tokens stay untouched. Every dark-mode value was computed and verified against WCAG AA *before* being written (see CHANGELOG math below), not assumed from the light-mode fixes.
- **Light / Dark / System selector**, in the persistent user-bar (theme is a per-teacher preference, not a per-classroom one, so it doesn't live in classroom Settings). `System` is a resolution rule, not a fourth token set — `services/themeService.js` reads `window.matchMedia('(prefers-color-scheme: dark)')` and stays live: if the OS setting changes while System is selected, the applied theme updates immediately, no reload needed. Switching to an explicit Light/Dark choice tears that listener down, so it never gets silently overridden by a later OS change.
- **New users default to System** — `services/themePreferenceService.js`'s `getPreferenceOnce()` returns `'system'` whenever nothing has been explicitly saved, so no special-casing is needed anywhere else.
- **Theme cross-fade**: a brief `background-color`/`color` transition (`--duration-base`/`--ease-standard`) on `body`, `.dashboard-widget`, and `.classroom-card` — the two most common surface wrappers in the app. Deliberately not applied to every surface (would mean touching dozens of selectors for a purely cosmetic gain); other elements snap instantly on theme switch, a disclosed scope boundary, not an oversight.
- **Persistence**: one new `theme` field on the same `users/{uid}` document already used for `recentNotebooks` — no new collection.

### Files Created
- `src/js/services/themeService.js` — pure resolve/apply logic (no I/O): given a preference, sets `document.documentElement.dataset.theme` and manages the System `matchMedia` listener.
- `src/js/services/themePreferenceService.js` — pure persistence (no resolution logic): reads/writes the stored preference. Kept as two separate files deliberately, matching this project's established single-purpose-service convention (Notebook Service vs. Student Progress Service, etc.).

### Files Modified
- `src/css/styles.css` — `--color-on-brand`/`--color-chrome-bg`/`--color-chrome-text` tokens added; `[data-theme="dark"]` block added; theme cross-fade transitions added (and folded into the existing consolidated reduced-motion block); `.user-bar` and its children corrected to use the new chrome tokens.
- `src/js/repositories/classroomRepository.js` / `firestoreClassroomRepository.js` — added `getThemePreferenceOnce(uid)` / `setThemePreference(uid, theme)`.
- `src/js/ui/components/UserBar.js` — added the Light/Dark/System selector.
- `src/js/main.js` — applies `'system'` immediately and synchronously on load (no round-trip needed, avoids a flash of the wrong theme for the common case); loads and applies the real stored preference once signed in; resets to `'system'` on sign-out (so a shared/public device never carries a previous teacher's explicit choice into the next session).

### Breaking Changes
None. Light mode (the only theme that existed before this phase) was verified pixel-identical throughout — every fix and addition either touches only the new dark-theme code path or corrects a bug that dark mode itself introduced.

### Regression Verification
Full Playwright pass: theme selector renders and defaults to System for a new account; explicit Light/Dark selection applies immediately and updates `data-theme`; the System `matchMedia` listener correctly follows a live OS-level change and correctly stops following once an explicit choice is made; the preference persists across sign-out/sign-in (same account); Phase 5's contrast fix confirmed holding under dark theme (`Start Class Mode` button text stays `#1a1a1a` in both themes, not flipping); a full feature regression (Settings, Notebook Tracker, Class Mode, Recognition Screen) run entirely in dark mode, zero errors.

### Architectural Decisions Made During Implementation
- **Two theme-independent token *pairs* now exist** (`--color-on-brand` from this correction, `--color-chrome-bg`/`--color-chrome-text` from the second bug) — both follow the same principle: anything whose background color doesn't change between themes (a brand-color fill, a fixed chrome bar) needs text/border colors that don't change either. This is now a named pattern in the token architecture, not a one-off fix, should a third such case appear later.
- **`themeService.js` and `themePreferenceService.js` were kept as two files**, not merged, even though Phase 6A only exists because of that persistence — resolving/applying a theme has zero need to know about Firestore, and a future non-Firestore context (e.g. a future settings-export feature) would only need the persistence half rewritten.
- **The System `matchMedia` listener is torn down and rebuilt on every `applyThemePreference()` call**, rather than persisting across preference changes — simpler to reason about than tracking whether a listener is "already this one," at the cost of a trivial amount of redundant setup on each explicit Light/Dark switch.

### Future TODOs
- Phase 6B — Workspace Personalization (drag-and-drop reordering, widget visibility) begins next, as already scoped and approved separately.
- A pre-existing, out-of-scope observation surfaced while computing dark-mode contrast: `--color-danger` text on the *light*-mode surface measures 3.8:1, itself already under the 4.5:1 AA requirement (predates this phase entirely — not introduced by it, and dark mode's equivalent pairing at 4.12:1 is not a regression). Worth a dedicated look in a future pass, not fixed here since it's outside Phase 6A's scope.
- Future theme packs (e.g. a school-branded palette) are now simple additions: a new `[data-theme="pack-name"]` block overriding the same four token names, following the exact pattern `[data-theme="dark"]` established — no component changes required, per the design goal.

---

## Phase 7A — Visual Refresh: Typography, Spacing, Header Hierarchy

**Scope:** the first of three visual-refresh stages, deliberately narrow — general typographic scale application, whitespace rhythm, and header prominence. No card language, no color, no Recognition-specific redesign (all explicitly deferred to 7B/7C, per the approved reorder). Every existing workflow, navigation path, and widget position is unchanged — confirmed by explicit order-preservation checks, not just assumed.

### Features Added — Stage 1 (Typography)
The `--text-*`/`--font-weight-*` scale (defined but underused since Phase 5) applied across the app:
- Section labels (`TEACHING`/`CLASSROOM`): → `--text-xs`.
- Widget titles: → `--text-lg`, with `--font-weight-bold` now explicit (previously relied on the browser's default `<h2>` boldening).
- Widget subheadings, header subtitle: → `--text-sm`.
- **New shared `.stat-number` utility** — isolates a single "hero" number from its surrounding sentence so the number, not the whole line, carries visual weight. Deliberately *not* applied to Leaderboard rows or Pending Task counts (both stay compact/list-style, per the design review's data-density guidance for those specific contexts) — only to genuinely standalone stat displays.
- Applied `.stat-number`-equivalent sizing (`--text-2xl`) to: Weekly Snapshot's total-stars figure (required a small, scoped DOM change — wrapping the number in its own `<span>`, since it was previously embedded directly in a sentence), the Recognition Card's stat, and Student Profile's stat card values (both already isolated in their own elements — pure CSS, no structural change needed).

### Features Added — Stage 2 (Spacing rhythm)
- New `.dashboard-view__group` wrapper: groups Recognition Wall and Weekly Snapshot (both answering "what should I celebrate") with a smaller internal gap (`--space-3`), distinct from the larger gap (`--space-6`, up from a uniform `1rem`) between different Dashboard questions. Whitespace itself now communicates grouping, rather than relying solely on the small gray section labels.
- **Same widgets, identical order** — confirmed via an explicit heading-order check before and after, not assumed from the diff being "just a wrapper."

### Features Added — Stage 3 (Header hierarchy)
- Classroom title (`.tracker-header__title`): `1.3rem` → `--text-2xl` (`1.75rem`) — a deliberate size increase, giving the header genuine visual weight distinct from widget content, per the design review's specific critique that the title and a widget heading were nearly indistinguishable in weight.

### Files Modified
- `src/css/styles.css` — typography scale applied to the selectors above; `.stat-number` utility added; `.dashboard-view__content`/`.dashboard-view__group` spacing; header title size.
- `src/js/ui/components/WeeklySnapshotWidget.js` — total-stars figure restructured into its own `<span class="stat-number">`.
- `src/js/ui/views/DashboardView.js` — Recognition + Weekly Snapshot wrapped in `.dashboard-view__group` (assembly/spacing change only — no widget added, removed, or reordered).

### Breaking Changes
None. Every change is either a pure tokenization (identical resulting values: header subtitle, section/widget subheadings) or a disclosed, deliberate visual increase explicitly called for in the approved design review (widget headings, header title, stat numbers, group spacing) — none accidental, none affecting workflow or navigation.

### Regression Verification
Computed-value checks after each of the three stages (font-sizes confirmed in pixels via `getComputedStyle`, not just visual inspection) plus a full feature regression before closing the phase: Settings/Groups/Students/Notebook config, Notebook Register + Timeline, Class Mode + return-to-Dashboard, Recognition Screen + period switching, and Phase 6A's Dark theme toggle — all confirmed working, zero page errors.

### Architectural Decisions Made During Implementation
- **The Recognition Card's stat size increase (1.4rem → --text-2xl) was placed in 7A, not deferred to 7B**, despite Recognition otherwise being scoped to 7B (Recognition language) — because it's an instance of the *general* "stat numbers get real prominence" typography rule from the approved review table, not a Recognition-specific redesign decision. Recognition's *hierarchy inversion* (winner name becomes bigger than the category label) remains explicitly deferred to 7B, where Recognition's own design language is established.
- **`.stat-number` was deliberately scoped narrow** — applied only to standalone hero figures, not list-row numbers — directly implementing the design review's explicit distinction between "hero stat" and "GitHub-style dense list" contexts, rather than a blanket size bump everywhere a number appears.
- **Grouping was implemented via a new wrapper element, not CSS sibling-selector tricks** — a `.dashboard-view__group` div is simpler to reason about and verify (a direct DOM query for "how many widgets are in this group") than a `:nth-child`-based spacing hack, at the cost of one additional, clearly-documented wrapper in `DashboardView.js`.

### Future TODOs
- Phase 7B — intent-based component language, Recognition's own design language, buttons, forms, empty states.
- Phase 7C — illustrations, micro-interactions, loading treatment, final polish.
- (Carried over, unchanged): Phase 6B Workspace Personalization; the pre-existing light-mode danger-contrast observation from Phase 6A; Student Dashboard preview; printable certificates; Teacher's Choice service; Perfect Attendance data source; Student/Parent onboarding.

---

## Phase 7B — Visual Refresh: Intent-Based Component Language

**Scope, and how it changed mid-flight:** originally scoped as abstract intent categories (Action/Celebrate/Insight/Navigation/Utility) mapped to visual weight and color. Before implementation, a design-review checkpoint (prompted by reference images the user shared) sharpened this into concrete, distinct *shapes* per widget — not just color/weight variation on a shared card template. The refined brief: "if I removed the colors entirely, could I still tell Recognition from Pending Tasks from Groups?" Every widget below was redesigned around a shape unique to it, confirmed via that grayscale test, then implemented. Dark mode was required to *reinterpret* each shape (a glow instead of a ring, a lit path instead of a recolored line), not simply recolor it — per an explicit product principle established before implementation began.

### Features Added — Recognition (feel: warm)
- Avatar redesigned as the app's single most distinct shape: 3rem (compact: 2rem), ring-bordered (2px solid accent), tinted accent background (`color-mix()`, 14% accent into surface).
- **Winner name now the largest, boldest text on the card** (`--text-lg`/black), inverting the previous hierarchy where the category label outweighed the person being celebrated.
- **Dark mode**: the ring becomes a soft glow (`box-shadow` bloom) rather than a recolored border — the one glow effect anywhere in the app, deliberately not reused elsewhere so it stays meaningful.
- **A real contrast bug found and fixed before it shipped**: the tinted background darkens in dark mode (since it's mixed with `--color-surface`, which flips), so pairing it with the theme-*independent* `--color-on-brand` token (correct for a *solid* accent fill, wrong for a *tinted* one) would have produced 1.43:1 contrast — verified numerically, corrected to the theme-flipping `--color-ink` (10.84:1 in dark mode).

### Features Added — Weekly Snapshot (feel: editorial)
- Leaderboard rows restructured into a plain, hairline-divided list (rank / name / value columns) — no avatars, no icon-driven content, reading like a small report rather than a UI panel.
- **Dark mode**: the widget's card border and background are removed entirely (`.dashboard-widget--editorial` under `[data-theme="dark"]`) — content sits directly on the page, leaning *further* into "editorial" rather than just recoloring the same panel.

### Features Added — Pending Tasks (feel: actionable)
- Every row restructured into a checklist shape: a leading checkbox glyph (☐) and trailing chevron (›) on every item — the row itself signals "tap to act," independent of its text.
- The Phase 5 success/collapse resolution animation (a separate, unrelated CSS class) confirmed still working correctly after this restructure.

### Features Added — Subjects (feel: navigational)
- Redesigned as a "waypoint list": chips connected by a thin line, trailing chevron — a path/breadcrumb metaphor, since this widget's entire job is navigating into Notebook Tracker.
- **Dark mode**: the connecting line gets an accent tint ("a lit path at night") rather than a plain recolor.

### Features Added — Groups (feel: collaborative)
- Redesigned as overlapping avatar clusters ("huddles") — up to 3 small circular initials avatars per team, overlapping, with a "+N" overflow badge — instead of a text chip. A group now visually reads as "a cluster of people" before any label is read.

### Features Added — Buttons & Forms
- **Buttons**: Primary buttons now carry genuine size distinction (larger padding, 10px radius, `--text-base`) from Ghost/Text buttons — priority is felt through size, not only color, addressing the original design review's specific critique.
- **Forms**: inputs/selects gained consistent baseline styling (border, radius, background — previously relying entirely on browser defaults beyond font) plus a subtle background tint on focus, alongside the pre-existing accessibility outline (confirmed via direct testing that keyboard `:focus-visible` still shows the yellow ring correctly; Chromium's standard behavior of treating all text-input focus as focus-visible was verified, not assumed, to be pre-existing browser behavior rather than a regression this phase introduced).

### Features Added — Empty States
Revised per the approved emotional-language table — Celebrate/Insight/Navigation/Collaborative widgets get warmer, more inviting copy (Recognition: *"The week is just getting started — recognitions will appear here soon"*; Weekly Snapshot: *"No stars awarded yet — plenty of week left"*; Subjects/Groups: invitations to configure, not flat statements). Genuine error/not-found states elsewhere in the app (Utility-intent, per the design principle) were deliberately left unchanged — richer copy there would fight the "disappears into the background" goal, not serve it.

### Files Modified
- `src/css/styles.css` — new design-language rules for all five widgets (`.recognition-card__avatar`, `.editorial-list`, `.checklist`, `.waypoint-list`, `.huddle-list`), button/form updates, dark-mode reinterpretation rules for each.
- `src/js/ui/components/RecognitionCard.js` — no structural change (CSS-only); `WeeklySnapshotWidget.js`, `PendingTasksWidget.js`, `SubjectsWidget.js` — restructured list-row markup to support the new shapes; `GroupsWidget.js` — rewritten for the huddle-cluster structure.
- `src/js/ui/components/ContinueWorkingWidget.js`, `RecognitionWidget.js`, `src/js/ui/views/RecognitionScreenView.js` — empty-state copy only.

### Breaking Changes
None. Every widget's click-through navigation, data source, and underlying service calls are unchanged — confirmed via a full regression pass (Settings, Notebook Tracker via the new waypoint chips, Class Mode, Recognition Screen with period switching, Groups via the new huddle rows) with zero page errors, run in both light and dark theme.

### Regression Verification
Computed-value and behavioral checks after each widget (avatar size/contrast in both themes; hairline list structure and dark-mode borderless behavior; checklist glyphs and click-through plus the Phase 5 resolution animation confirmed still intact; waypoint connector count and dark-mode tint; huddle avatar count including overflow badge and click-through) — followed by one full end-to-end regression pass across the whole app before closing the phase.

### Architectural Decisions Made During Implementation
- **The scope changed after design review, and that change is recorded here rather than glossed over**: the original abstract intent-category plan was superseded by concrete per-widget shapes before any CSS was written, following a design-review checkpoint the user initiated mid-phase. Implementation proceeded once both open questions from that checkpoint (whether the warmth level stayed "restrained," and whether this refined or replaced the original 7B scope) were explicitly resolved.
- **Exactly one glow effect exists in the whole app** (Recognition's avatar ring in dark mode) — deliberately not generalized into a reusable "glow" utility class, so it stays a meaningful, singular signal rather than becoming decorative wallpaper if reused elsewhere.
- **`color-mix()` is used for tinted backgrounds** (Recognition's avatar, Groups' huddle avatars, Subjects' dark-mode connector) rather than precomputed static hex values — this keeps every tint correctly derived from the existing semantic tokens (`--color-accent`, `--color-primary`, `--color-surface`) rather than introducing new hardcoded colors that would need their own separate dark-mode variants.
- **Genuine error/not-found empty states were deliberately left untouched**, even though richer copy was applied to the five Dashboard widgets — per the emotional-language table's explicit Utility-intent rule, warming up an error message would work against "disappears into the background," not serve it.

### Future TODOs
- Phase 7C — illustrations, micro-interactions, loading treatment, final polish.
- (Carried over, unchanged): Phase 6B Workspace Personalization; the pre-existing light-mode danger-contrast observation from Phase 6A; Student Dashboard preview; printable certificates; Teacher's Choice service; Perfect Attendance data source; Student/Parent onboarding.

---

## Visual Refresh — Emotional Palettes, Hero, Color as Hierarchy

**Context and a genuine mid-course correction:** Phases 5–7B optimized for "calm, restrained, one accent" — modeled on Linear/GitHub, right for a teacher glancing at a dashboard between classes. A review checkpoint surfaced that this app is also *projected in front of students all day*, which is a different design problem: the interface read as efficient but emotionally flat, and dark mode specifically felt like "gray cards on a gray background." This phase revises the color philosophy accordingly — restraint in *motion* and *typography* stays (no confetti, no bounce, no gamified medals), but color itself becomes part of the information hierarchy rather than a single sparing accent.

### Features Added
- **Five named emotional palettes** (`Celebrate`, `Learn`, `Focus`, `Growth`, `Community`), each a reusable token pair (a subtle background wash + a contrast-verified label-text color), not a color a section owns outright. Sections *consume* a palette, which is what makes it possible for the same emotional identity to travel to a downstream screen at a different intensity without inventing a new color system each time.
- **Every hue is a real TFI brand color, none invented**: Celebrate = Orange (already `--color-accent`), Learn = Cyan (already `--color-primary`), Focus = Yellow (already `--color-warning`), Growth = Lime Green (already `--color-success`), Community = **Pink** — defined in the brand guide since Phase 5 but never actually used anywhere until now.
- **One wash per widget container, not per sub-element** — "let the cards breathe": Recognition's avatar, Weekly Snapshot's leaderboard rows, Pending Tasks' checklist glyphs, Subjects' waypoint chips, and Groups' huddle avatars all stay neutral; only the outer card carries the palette tint. Each widget's heading text also picks up its palette's verified label color, reinforcing identity without adding new UI elements.
- **A real Hero**, replacing the Dashboard header's previously-plain classroom-context text: a greeting (first name, extracted from the signed-in teacher's display name), classroom name, grade/school, and a conditional motto slot. Deliberately timeless — no live stats or pending counts, which stay in their own widgets below; confirmed by testing the rendered Hero text contains no digits beyond the classroom's own name/grade.
- **Recognition Screen's active category-chip state** now consumes the Celebrate accent (Orange) instead of generic primary Cyan — since this screen is Recognition's dedicated home, its active state should carry Recognition's own identity at a higher intensity than the Dashboard widget's lighter touch.

### A disclosed revision of a very recent decision
Phase 7B gave Weekly Snapshot's dark-mode card full transparency (background and border both removed, "text on the page") to reinforce its editorial feel. That directly worked against *this* phase's goal: a fully transparent card carries no color signal at all in dark mode, reintroducing exactly the "no color in dark mode" problem this phase exists to fix. Reverted to carrying the Learn wash like every other palette/theme combination — border and shadow still removed (keeping a little of the original "quieter than a bordered card" intent), but the background is no longer invisible.

### Files Created
None — this phase extended existing files rather than adding new ones.

### Files Modified
- `src/css/styles.css` — raw `--color-pink` added to the palette; five `--palette-{name}-wash`/`--palette-{name}-label` token pairs (light + dark values) added; `.dashboard-widget--{celebrate,learn,focus,growth,community}` wash classes added; Weekly Snapshot's dark-mode rule revised; Hero CSS (`.classroom-hero__greeting`, `.classroom-hero__motto`) added; Recognition Screen's active-chip color changed from primary to accent.
- `src/js/ui/components/RecognitionWidget.js`, `WeeklySnapshotWidget.js`, `PendingTasksWidget.js`, `SubjectsWidget.js`, `GroupsWidget.js` — one added CSS class each (no structural changes).
- `src/js/ui/views/DashboardView.js` — classroom-context slot rebuilt into the Hero (greeting + conditional motto); new `getFirstName()` helper.

### Breaking Changes
None. `classroom.motto` is read defensively (`if (classroom.motto)`) and doesn't exist as a field on any classroom yet — the Hero's motto slot is forward-compatible for a future phase, not active functionality today. Every other change is additive CSS classes or a content upgrade to an existing slot.

### Regression Verification
Contrast for all 10 palette/theme label-text combinations computed and verified (6.53:1–9.9:1, all comfortably above the 4.5:1 requirement) *before* any CSS was written, not after. Computed-value checks confirmed all five widgets render distinct wash colors and Weekly Snapshot's dark-mode background is no longer transparent. Hero tested for correct greeting text, absent motto element (no data source yet), and no leaked live-stat digits. A full feature regression (Settings, Notebook Tracker via the Growth-tinted Subjects widget, Class Mode, Recognition Screen) confirmed zero errors in both themes.

### Architectural Decisions Made During Implementation
- **Classroom Identity ("Classroom Culture") was explicitly kept out of this phase** and broadened, per direction, into its own future phase — banner, motto, color, theme, mascot, and teacher customization together, not just a color picker. The Hero's motto slot was built to accommodate that phase without pre-building any part of it now (no new classroom field, no Settings UI).
- **The Hero does not introduce a sixth ad-hoc color wash.** Its warmth comes from content and typography (a personal greeting, real hierarchy) rather than another background tint competing with the five section palettes — keeping the palette system to exactly five meaningful colors rather than diluting it.
- **Wash intensity was tuned down from the original concept mockup** (roughly 12–14%) to a verified-subtle 6% (light) / 10% (dark) — per explicit direction to keep the dashboard "bright and breathable" while still giving each section a distinct identity, confirmed distinguishable via the computed background-color checks.

### Future TODOs
- Extend palette-travel further downstream: a light Growth touch on Notebook Tracker's active tab, a light Community touch on Settings > Groups' section heading — scoped as the next natural step, not completed this pass.
- Classroom Culture (its own future phase): banner, motto, color, theme, mascot, teacher customization — data model and teacher-choice-vs-auto-assign question deliberately left open for that phase's own design pass.
- Phase 7C — illustrations, micro-interactions, loading treatment, final polish.
- (Carried over, unchanged): Phase 6B Workspace Personalization; the pre-existing light-mode danger-contrast observation from Phase 6A; Student Dashboard preview; printable certificates; Teacher's Choice service; Perfect Attendance data source; Student/Parent onboarding.

---

## White Canvas Revision — Color as Emphasis, Not Background

**Context:** a direct reversal of the previous Visual Refresh phase's core mechanism (a wash tinting each widget's entire card background), in favor of "white is the primary canvas; color is reserved for moments that deserve attention." The five named palettes (Celebrate/Learn/Focus/Growth/Community) and their tokens from the prior phase are kept — what changes is *how* each is applied: never as a full-card fill, always as a targeted accent (a border, an icon, a badge, a hover state, one dedicated KPI card).

### Features Added
- **Full-card washes removed** from all five Dashboard widgets. Cards are white/surface in both themes; the palette tokens (`--palette-*-wash`, `--palette-*-label`) remain defined and are now used only for targeted accents, not backgrounds.
- **Borders reduced in favor of soft elevation**: `.dashboard-widget`'s visible border replaced with a transparent border + `box-shadow`. This surfaced a real problem, caught and fixed rather than shipped: the existing shadow value is a *dark* shadow, nearly invisible against an already-dark page in dark mode. Added dark-mode-specific elevation values (`--elevation-card/hover/sheet/dialog`) with a thin top highlight plus a stronger, more opaque shadow — verified visible via computed-style checks, not assumed.
- **Recognition**: avatar's tinted fill removed — now white with only the orange ring as the accent ("orange accents only").
- **Weekly Snapshot**: the headline stat now lives in a dedicated `.kpi-card` — one bold, colored sub-element on an otherwise white surface, replacing the previous full-card Learn wash. This is the concrete "contrast creates hierarchy" example: the KPI card earns attention precisely because everything around it stays white.
- **Pending Tasks**: the Focus/amber accent moved from a static card background into a row-level hover interaction — a checklist row's background and icon colors tint amber only on hover, not at rest.
- **Subjects**: dropped the previous Growth/Lime Green mapping in favor of cyan indicators, per this phase's explicit direction — a persistent small cyan dot on each waypoint chip, plus the existing cyan hover-border. Flagged directly during implementation as a real departure from the prior phase's approved palette assignment (Growth had been mapped to Teaching/Subjects), not a silent change.
- **Groups**: avatars now cycle through three distinct hues (cyan, orange, pink tints) for genuine visual variety within a huddle, instead of one uniform tint; the card gained a pink top border, matching Recognition's established accent-border pattern.
- **Hero**: given a soft two-stop gradient (Celebrate → Community, both very light) — an explicit, narrowly-scoped exception to this project's long-standing "no gradients" convention (Phase 5 onward), justified specifically because the Hero is meant to be "the strongest visual treatment," a landing moment rather than everyday UI chrome. Documented in-file as a deliberate exception, not an unnoticed drift from the rule.

### Files Modified
- `src/css/styles.css` — border-to-elevation change on `.dashboard-widget`; dark-mode elevation overrides; all five wash-background rules removed (heading-tint and accent-border rules kept); Recognition avatar fill removed; `.kpi-card` added; checklist row hover interaction added; waypoint chip indicator dot added; huddle avatar color variety added; Groups' pink border added; Hero gradient added.
- `src/js/ui/components/WeeklySnapshotWidget.js` — headline stat restructured into the new KPI card markup.
- `src/js/ui/components/SubjectsWidget.js` — `dashboard-widget--growth` class removed.

### Breaking Changes
None functionally — every navigation path, click-through, and data flow is unchanged. Visually, this is a significant, intentional reversal of the immediately preceding phase's wash system, confirmed via computed-style checks that cards are genuinely white/surface again in both themes (not just visually similar).

### Regression Verification
Computed-style checks confirmed: Recognition, Weekly Snapshot, and Groups cards are white/surface in light mode and the correct dark surface color in dark mode (not tinted); the KPI card is the only colored element within Weekly Snapshot; huddle avatars show three genuinely different colors; Groups' border-top is exact TFI Pink; dark-mode card shadows are present and non-trivial (the bug caught above). A full regression pass — Settings, Notebook Tracker via the Subjects waypoint navigation, Class Mode, Recognition Screen (including its Celebrate-orange active chip) — confirmed working in both light and dark mode with zero page errors.

### Architectural Decisions Made During Implementation
- **A real dark-mode elevation bug was caught proactively, before any screenshot revealed it** — recognizing that "reduce borders, rely on shadow" is a well-known dark-mode failure mode (a dark shadow reads as nothing against a dark canvas) and verifying rather than assuming the existing shadow values would still work.
- **The Subjects palette reassignment (Growth → cyan) was flagged explicitly during implementation**, not silently applied, since it contradicts a mapping approved just one phase earlier. Cyan was chosen because it's already the app's established navigation/interactive color everywhere else, making "Subjects consumes the general navigation color" a more coherent rule than forcing a dedicated emotional palette onto every section.
- **The Hero's gradient is the one and only exception to the no-gradients rule in the entire app** — deliberately not a precedent for introducing gradients elsewhere; every other surface stays flat, per the white-canvas principle.

### Future TODOs
- (Unchanged from the prior phase's list): downstream palette travel to Notebook Tracker/Settings > Groups; Classroom Culture as its own future phase; Phase 7C polish; Phase 6B Workspace Personalization; and all previously-carried-over items.

---

## White Canvas Refinement — Solid Accents, Not Pale Washes

**Context:** the user resent the reference image that was missing from an earlier message. Reviewing it directly identified two remaining pale washes in the just-shipped White Canvas revision that didn't match the reference's actual boldness: the KPI card (a light Learn-palette tint) and the Hero (a soft 10–12% gradient). The reference's own "Attendance" element is a *fully saturated* solid color block with bold white text — not a pale tint — and its illustrated banner is confidently, not faintly, colored.

### Features Added
- **KPI card converted from a pale wash to a solid, fully-saturated fill** (`--color-primary`, TFI Cyan) — matching the reference's "Attendance" box exactly. Text reuses the already-verified `--color-on-brand` pattern (white text on this cyan measures 2.17:1 and fails WCAG AA, per Phase 5's original finding; on-brand ink measures 8.0:1).
- **Hero gradient boosted from a 10–12% tint to a confident 55% saturation** (35% in dark mode) — a real, bold gradient rather than a barely-there wash, matching the reference banner's presence.

### A contrast bug caught before shipping, not after
Boosting the Hero's saturation meant `--color-muted` (used for the greeting/subtitle/motto) no longer had sufficient contrast — computed at every saturation level tested (30–80%), muted measured 2.43–4.88:1 against the gradient's stops, failing WCAG AA's 4.5:1 requirement throughout. Switched all Hero text to `--color-ink` instead, which passes comfortably at every level checked (6.58–13.21:1). A second, related check: dark mode's *flipped* (light) ink against light mode's 55% saturation left one gradient stop at 4.47:1 — marginal, under the requirement. Solved by giving dark mode its own lower percentage (35%), verified at 6.89:1/8.51:1 on both stops — computed and confirmed via `getComputedStyle`, not assumed from the light-mode fix carrying over.

### Files Modified
- `src/css/styles.css` — `.kpi-card`/`.kpi-card__number`/`.kpi-card__label` converted to solid-fill + on-brand text; `.classroom-hero` saturation increased with a dark-mode-specific override; Hero text color rules added (`--color-ink` instead of `--color-muted`).

### Breaking Changes
None. Purely a saturation/contrast refinement of elements shipped one phase earlier — no structural, navigation, or data changes.

### Regression Verification
Computed-style checks confirmed: KPI card background is exact TFI Cyan, its number text is exact dark ink; Hero greeting text is dark ink in light mode and correctly flips to light ink in dark mode. A full regression pass (Settings, Notebook Tracker via Subjects waypoint navigation, Class Mode, Recognition Screen, dark theme toggle) confirmed zero errors.

### Architectural Decisions Made During Implementation
- **Every saturation/contrast decision in this entry was computed before being written into CSS**, including the dark-mode-specific gradient percentage — this phase's two fixes (KPI card, Hero) were both caught by direct comparison against the reference image the user provided, not guessed at from written instructions alone.
- **The reference's principle — one confidently solid box per screen, everything else plain — was applied narrowly to the KPI card only**, not extended to Recognition/Groups/Pending Tasks/Subjects, which stay in the accent-border/hover/indicator treatment established in the prior phase. A future pass could consider whether any other widget deserves a solid "hero box" moment, but that wasn't asked for here and wasn't added speculatively.

### Future TODOs
- (Unchanged from the prior phase's list): downstream palette travel to Notebook Tracker/Settings > Groups; Classroom Culture as its own future phase; Phase 7C polish; Phase 6B Workspace Personalization; and all previously-carried-over items.

---

## Hero Refinement — Cooler Gradient, Hue-Derived Text

**Context:** direct feedback against a screenshot of the shipped Hero — cooler gradient tones, white text where the background is genuinely dark, and for lighter backgrounds a darkened *shade of the ambient gradient color* rather than flat black/`--color-ink` ("soft on the eyes").

### Features Added
- **Gradient hue changed** from the warm Celebrate/Community pairing (orange→pink) to a cooler Learn/Growth pairing (cyan→lime green) — same tokens, different pair, per explicit direction to move away from warm tones.
- **Light-mode text is now a darkened tint of the gradient's own hue** (`color-mix(in srgb, var(--color-primary) 25%, black)` — a deep teal), not generic `--color-ink`. Verified at 8.96:1/10.13:1 against the gradient's two light-mode stops — comfortably passing and clearly "softer" than flat black while remaining unambiguous.
- **Dark-mode text is white**, since dark mode's stops are genuinely dark (mixed into a dark surface rather than a light one) — verified at 7.66:1/6.97:1.
- Applied consistently across every text element in the Hero, including the classroom title itself (caught during implementation: the title had no explicit color rule and would otherwise have kept inheriting plain `--color-ink`/white while the greeting and subtitle picked up the new hue-tinted treatment — a visible inconsistency avoided before it shipped, not after).

### Files Modified
- `src/css/styles.css` — `.classroom-hero`'s gradient stops changed to Learn/Growth; light- and dark-mode text-color rules rewritten around the hue-derived approach described above.

### Breaking Changes
None. Purely a color/contrast refinement of the Hero shipped in the immediately preceding phase.

### Regression Verification
Computed-style checks confirmed the classroom title and greeting both render the exact darkened-teal value in light mode, and pure white in dark mode. A full regression pass (Class Mode, Recognition Screen, theme switching) confirmed zero errors.

### Architectural Decisions Made During Implementation
- **The "darkened ambient hue" text color is derived from `--color-primary` specifically** (the gradient's first/cyan stop), applied uniformly across the whole gradient rather than varying per-stop — CSS has no clean way to vary text color continuously across a gradient's span, so one representative, verified-safe color was chosen and checked against *both* stops rather than just the one it was derived from.
- **Caught and fixed a real inconsistency before shipping**: the classroom title lacked its own color rule and would have silently kept the old (or default) text color while sibling elements in the same Hero picked up the new treatment — found by explicitly checking each Hero text element's rule, not assumed from having fixed the greeting/subtitle.

### Future TODOs
- (Unchanged from the prior phase's list): downstream palette travel to Notebook Tracker/Settings > Groups; Classroom Culture as its own future phase; Phase 7C polish; Phase 6B Workspace Personalization; and all previously-carried-over items.

---

## Recognition Showcase, Rank Graphics, and Dark Mode Removal

**Context:** direct feedback against two fresh screenshots — the KPI card still showed flat dark text rather than the "soft" hue-derived treatment just applied to the Hero; the Recognition Wall needed more visual presence; leaderboard ranks read as plain "#1"/"#2"/"#3" text; and, separately, a decision to remove the theme system entirely and keep exactly one visual theme.

### Features Added
- **KPI card text** now uses the same darkened-hue-tint principle as the Hero (`color-mix(in srgb, var(--color-primary) 25%, black)`) instead of flat `--color-on-brand` black — verified at 6.5:1 against the card's full-saturation cyan background.
- **Recognition Wall showcase**: the widget's own background is now the app's one fixed dark tone (`--color-chrome-bg`, already used for the persistent top bar), with each `.recognition-card` given an explicit white background so it visibly pops against the dark surround — a "display case" effect, distinct from every other widget's plain white card. Heading text and the "View All" link both switch to the fixed light chrome-text color for this dark context.
- **Leaderboard rank graphics**: 🥇🥈🥉 replace the "#1"/"#2"/"#3" text for the top three ranks, in both places a leaderboard renders (`WeeklySnapshotWidget.js` and the shared `LeaderboardList.js`, used by the Recognition Screen) — ranks 4 and beyond keep plain "#N" text, since no widely-recognized graphic exists past bronze. Ties at a rank all correctly receive that rank's medal (e.g. a four-way tie at rank 3 shows four bronze medals) — this is accurate, not a bug, since every tied student genuinely holds that rank.
- **Dark mode removed entirely**, per explicit direction: the Light/Dark/System selector is gone from `UserBar.js`; `main.js` no longer resolves, applies, loads, or persists any theme preference. The app now has exactly one visual theme.

### Files Modified
- `src/css/styles.css` — KPI card text color changed; Recognition Wall dark-background rules added (reusing existing chrome tokens, no new colors introduced).
- `src/js/ui/components/WeeklySnapshotWidget.js`, `LeaderboardList.js` — added the same small `formatRankDisplay()` helper (medals for top 3, plain text beyond) to each file's rank-rendering code.
- `src/js/ui/components/UserBar.js` — theme selector removed entirely; simplified to avatar/name/Sign Out only.
- `src/js/main.js` — all theme-related imports, state (`currentTheme`), functions (`handleSelectTheme`), and calls (`applyThemePreference`, `getPreferenceOnce`, `setPreference`) removed from `init()` and both `renderUserBar()` call sites.

### Breaking Changes
None functionally. Visually, this removes a feature (theme switching) entirely, per explicit direction — anyone who had switched to Dark will simply see the one remaining (light) theme from now on.

### A disclosed, deliberate scoping choice
`services/themeService.js` and `services/themePreferenceService.js` (and the corresponding repository methods, `getThemePreferenceOnce`/`setThemePreference`) were **not deleted** — they're simply no longer imported or called anywhere. Removing them fully would mean also touching the repository interface and its Firestore implementation for a purely cosmetic cleanup with real (if small) risk of breaking something for no functional gain. Flagging this clearly rather than silently leaving unexplained dead code: a future pass could remove these files entirely if a fully clean repository is wanted, but it wasn't done as part of this change.

### Regression Verification
Computed-style checks confirmed: the theme selector no longer renders; the KPI card's number renders the exact darkened-teal value; the Recognition Wall's background is exact `#1a1a1a` while its child cards remain exact white; both leaderboard locations (Weekly Snapshot and the Recognition Screen) render medal emoji for top ranks. A full regression pass (Settings, Notebook Tracker, Class Mode, Recognition Screen) confirmed zero errors — with no theme toggle to test against anymore, since it no longer exists.

### Architectural Decisions Made During Implementation
- **The Recognition Wall's dark background reuses the app's one existing fixed-dark tone** (`--color-chrome-bg`/`--color-chrome-text`, originally built for the persistent top bar in Phase 6A) rather than introducing a new dark color — keeping the app's "dark tone vocabulary" to exactly one deliberate value, used in exactly two now-related places (the top bar, and this showcase).
- **The rank-formatting helper was duplicated in two files rather than centralized**, matching this project's established pattern of small, single-purpose per-file helpers (e.g. `getInitials` appears in more than one component already) rather than introducing a new shared-utilities module for a four-line function.

### Future TODOs
- (Unchanged from the prior phase's list): downstream palette travel to Notebook Tracker/Settings > Groups; Classroom Culture as its own future phase; Phase 7C polish; Phase 6B Workspace Personalization; and all previously-carried-over items. Additionally: consider a full removal of the now-unused theme service files/repository methods in a future cleanup pass, if a fully clean codebase (not just an unused-but-harmless one) is wanted.

---

## Recognition Gold, Reliable Rank Badges, Graphic Task Icons

**Context:** direct feedback against two more screenshots — no more black text anywhere ("matching color text" instead), a request to move Recognition off orange entirely (with alternatives requested, not just a silent swap), a real visibility concern with the medal emoji used for ranks, a request to make the avatar circles "pop" with color rather than a subtle ring, and a complaint that the checkbox+emoji combination in Pending Tasks read as "an excel sheet."

### A color decision, presented rather than made silently
Per explicit request for suggestions: two alternatives were presented — **deep gold/amber** (ties to the trophy/star imagery already in Recognition) and **royal purple** (a completely new hue, more ceremonial). Implemented with gold as the recommendation, flagged clearly as swappable if purple is preferred instead.

### Features Added
- **`--color-accent` redefined to gold** (`#c9971f`, a new `--color-gold` raw token) instead of orange — this single change correctly cascades through every existing Recognition/Celebrate-palette reference (border accents, avatar ring, glow, Recognition Screen's active chip) without needing to touch each one individually. One disclosed side effect: Groups' huddle avatars cycle through 3 colors including `--color-accent` for variety — that one avatar shifts from orange-tinted to gold-tinted, still colorful, not a regression.
- **Recognition Wall background is now a gradient of dark gold shades** (`color-mix` at 35%/55% into black), not flat black — verified at 11.83:1/7.19:1 with the existing white heading text.
- **Recognition avatar** changed from a white fill + thin ring to a **bold, rich gold fill** with white text — genuinely colorful rather than a subtle outline, per "I need the circles to pop." 70% gold (not full saturation) keeps white text passing at 4.99:1; pure gold only reaches 2.65:1.
- **Winner name and stat text** now use a darkened-gold tint (`color-mix` at 55% into black) instead of inheriting flat black/`--color-ink` — verified at 7.19:1 on the card's white background. This is the "matching color text, not black" principle applied to Recognition's two most prominent text elements.
- **Rank badges replace medal emoji entirely.** Emoji medal rendering is a genuine cross-platform reliability concern (this project already hit an emoji-rendering gap once before, with 📒 falling back to a box glyph in one test environment) — not just an aesthetic one. Replaced with CSS-drawn circular badges (darkened gold/silver/bronze, verified at 4.99:1/4.84:1/6.76:1 with white numerals) in both places a leaderboard renders (`WeeklySnapshotWidget.js` and the shared `LeaderboardList.js`).
- **Pending Tasks' checkbox and bare emoji replaced with graphic badges**: the per-row indicator is now a CSS-drawn ring (a real graphic element, not a Unicode `☐` character), and the group heading's emoji sits inside a colored circular badge rather than floating bare in the heading text.

### Files Modified
- `src/css/styles.css` — new `--color-gold` token; `--color-accent` repointed to it; Recognition Wall gradient; avatar fill; winner-name/stat text colors; `.rank-badge` (three color variants); `.checklist__box` redrawn as a CSS ring; `.task-group-heading__icon` badge added; corresponding hover-state fix (the checkbox ring has no text color to change on hover, so hover now fills the ring instead).
- `src/js/ui/components/WeeklySnapshotWidget.js`, `LeaderboardList.js` — `formatRankDisplay()` (returning emoji text) replaced with `createRankIndicator()` (returning a real badge element) in both files.
- `src/js/ui/components/PendingTasksWidget.js` — group heading restructured to wrap its icon in a badge span; row indicator no longer sets emoji/Unicode text content (styled entirely via CSS now).

### Breaking Changes
None. All changes are visual/text-color refinements of features shipped in immediately preceding phases — no navigation, data, or workflow changes.

### Regression Verification
Computed-style checks confirmed: the wall's `background-image` is a gradient (not a solid color); avatar/winner-name/stat colors all match their computed gold/darkened-gold values exactly; rank badge #1 renders the correct color with "1" as text content, in *both* Weekly Snapshot and the Recognition Screen's leaderboard; the checklist ring and task-group icon badge both render with the expected colors. A full regression pass (Settings, Pending Task click-through, Notebook Register, Class Mode, Recognition Screen) confirmed zero errors.

### Architectural Decisions Made During Implementation
- **Every color used for a badge/fill was darkened to a verified-passing shade before being written into CSS** — the pure medal tones (gold/silver/bronze at full saturation) all failed white-text contrast outright (2.5–3.8:1); this was caught by computing it, not by eyeballing a "looks about right" shade.
- **`--color-accent` was redefined at its single source rather than hunting down every individual orange reference** — this is precisely why the semantic-token architecture (built back in Phase 5) pays off: a "we don't like this color anymore" request becomes a one-line change instead of a file-wide find-and-replace.

### Future TODOs
- Confirm whether gold or purple is the final Recognition color — implemented with gold, purple remains available if preferred.
- Consider extending "no black text" further into other widgets (Weekly Snapshot's KPI card and the Hero already use this pattern; Recognition now does too) if more instances of flat black text are found elsewhere.
- (Carried over, unchanged): downstream palette travel; Classroom Culture; Phase 7C polish; Phase 6B Workspace Personalization; theme-service file cleanup; all previously-listed items.

---

## Blue/White Unification — Deep Blue Solid Fills, Strip Leaderboards

**Context:** direct feedback against a fresh screenshot plus two style references — the Hero title, "Start Class Mode," and the KPI card's "35 stars" all still read as black text over a strong background; a request for leaderboard rows to be visually separated "strips" rather than a continuous hairline-divided list (referencing a ranking-app screenshot); a simple, confident blue-and-white UI held up as the style to aim for; and explicit permission that Recognition's color no longer needs to represent "recognition" specifically, just be appealing.

### The core problem, diagnosed before any color was chosen
Every previous attempt to fix "black text" had darkened the *text* while leaving the *background* (`--color-primary`, bright cyan) unchanged. Verified numerically: white text on plain cyan measures 2.17:1, and even the existing darker hover variant (`--color-primary-strong`) only reaches 3.58:1 — **no light-colored text can ever pass WCAG AA against this particular background**, because the background itself is too bright. Continuing to search for a lighter-but-still-passing text color was solving the wrong variable. The actual fix: darken the *background*, not the text.

### Features Added
- **New `--color-primary-deep` token** (`color-mix(in srgb, var(--color-primary) 65%, black)`) — a richer, darker blue that lets text be genuinely white. Verified at 4.81:1.
- **"Start Class Mode" and every other Primary button** now use this deep-blue fill with white text, replacing the dark-ink-on-bright-cyan pairing. Hover state darkens *further* (55% mix, 6.24:1) rather than lightening — the previous hover target (`--color-primary-strong`) was actually lighter than the new resting state and would have dropped white text back under the contrast threshold; caught and fixed before shipping, not after.
- **KPI card** ("35 stars awarded this week") switched to the same deep-blue fill + white text.
- **Hero** switched from a pale pastel gradient with darkened-hue text (which, per direct feedback, still read as "basically black") to a genuinely rich, saturated blue-to-violet gradient with plain white text — verified at 6.24:1/8.51:1.
- **Recognition Wall unified with the same rich gradient** — per explicit permission that it doesn't need its own "recognition-specific" color, one consistent premium gradient across the app's two most prominent moments (Hero, Recognition Wall) now reads as a deliberate identity.
- **Recognition avatar** switched from gold to the same deep blue, for cohesion with the now-blue wall; the card's gold border-top accent is kept, creating a "navy + gold" pairing (evoking the dark card + gold medal ribbon in the ranking-app reference) rather than gold competing with the new blue wall.
- **Leaderboard rows now render as separated "strips"** in both places a leaderboard appears (Weekly Snapshot and the Recognition Screen) — each row gets its own background tint, rounded corners, and spacing, replacing the previous continuous hairline-divided list, directly per the reference screenshot's specific callout.

### Files Modified
- `src/css/styles.css` — `--color-primary-deep` token added; `.btn--primary` (fill, text, hover) rewritten; `.kpi-card` fill/text rewritten; `.classroom-hero` gradient and text rewritten (dead dark-mode override rules removed as part of this, since dark mode no longer exists); `.dashboard-widget--recognition` gradient rewritten; `.recognition-card__avatar`/`__winner-name`/`__stat` recolored to deep blue; `.editorial-list__row`/`.leaderboard-list__row` restructured from hairline-divided to separated strips.

### Breaking Changes
None. Every change is a color/background refinement of features shipped in immediately preceding phases — no navigation, data, or structural changes.

### Regression Verification
Computed-style checks confirmed: the primary button's text is exact white on the exact deep-blue fill; the Hero title is exact white; the KPI card's number is white on deep blue; the Recognition Wall's `background-image` is the new blue-violet gradient; the avatar fill is deep blue while the card's border-top remains gold; leaderboard rows in both locations show the new strip background and spacing. A full regression pass (Settings, Notebook Tracker, Class Mode, Recognition Screen) confirmed zero errors.

### Architectural Decisions Made During Implementation
- **Diagnosed the actual constraint before choosing any color**: rather than continuing to hunt for a "light enough but still passing" text color against a background whose maximum-possible contrast with white was already known (2.17:1 for white-on-white-equivalent-luminance backgrounds), the fix targeted the correct variable — the background's darkness — which is the only lever that can satisfy both "genuinely light text" and "passes WCAG AA" simultaneously.
- **A second contrast bug was caught in the same pass, not left for a future report**: the button's hover state would have been *lighter* than its new resting state, silently dropping white text below the threshold on hover specifically. Checking the hover state's contrast, not just the resting state's, is why this was caught now rather than being the next round of feedback.
- **Recognition and the Hero were deliberately unified onto one gradient formula** rather than each getting its own distinct treatment — per explicit permission that Recognition's color doesn't need its own meaning, and because one consistent "signature gradient" used at the app's two most prominent moments reads as more deliberate than two competing rich-color choices.

### Future TODOs
- Confirm whether gold or purple is still worth offering as a Recognition-specific accent option, now that the wall itself is unified with the Hero's blue-violet gradient — currently the border-top/rank-badge gold accents are the only remaining Recognition-specific color signal.
- (Carried over, unchanged): downstream palette travel; Classroom Culture; Phase 7C polish; Phase 6B Workspace Personalization; theme-service file cleanup; all previously-listed items.

---

## Specified Gradient, Strip-Style Leaderboard Badges, Collapsible Pending Tasks

**Context:** an exact gradient specification (`linear-gradient(to top, #4481eb 0%, #04befe 100%)`), leaderboard numbering references drawn from infographic-style "numbered strip" designs, and a request to make Pending Tasks neater via an expandable button rather than always showing every item inline.

### A contrast failure found in the exact colors specified, resolved without abandoning them
Checked before implementing, per this project's standing practice: the gradient as given fails white-text contrast on **both** stops (3.76:1 and 2.14:1 — well under the 4.5:1 requirement). Rather than silently substituting different colors, or silently shipping an inaccessible gradient, both stops were darkened by the minimum amount needed — mixing 65% of each original hex into black — which keeps the exact same hues and the same `to top` direction while making white text pass (7.41:1/6.24:1→ specifically 7.41:1 and 4.74:1). This is presented as a disclosed, minimal adjustment, not a different color choice.

### Features Added
- **Hero and Recognition Wall gradients updated** to the new, contrast-corrected version of the specified blue-to-cyan gradient (kept unified across both, as established in the prior phase).
- **Leaderboard rank badges enlarged and given more visual weight** (1.5rem → 2rem, plus a subtle white ring and drop shadow) — adapting the circular numbered-badge style from the provided references to this app's existing strip-row layout.
- **Each leaderboard strip now carries a colored left-border accent** matching its rank tier (gold/silver/bronze for ranks 1–3) — directly adapting the "colored ring + colored accent bar" pattern from the references, applied to a horizontal strip rather than the references' card shape.
- **Pending Tasks now collapses behind a single toggle** ("View pending tasks" / "Hide pending tasks") instead of always showing every item's row. Collapsed by default: a compact one-line summary ("N tasks need your attention") is what's visible until the teacher chooses to expand — matching the same expand/collapse idiom `LeaderboardList.js`'s "Show all" already established, not a new interaction pattern.

### Files Modified
- `src/css/styles.css` — Hero/Recognition Wall gradient values updated; `.rank-badge` enlarged with ring/shadow; new `.editorial-list__row--rank-{1,2,3}`/`.leaderboard-list__row--rank-{1,2,3}` left-border rules; `.task-detail-container`/`.task-summary-line`/`.task-detail-toggle` added for the new collapse behavior.
- `src/js/ui/components/WeeklySnapshotWidget.js`, `LeaderboardList.js` — each row's className now includes a rank-tier modifier for ranks 1–3.
- `src/js/ui/components/PendingTasksWidget.js` — restructured to build a compact summary line + toggle button, with the existing group headings and checklist rows moved into a container that starts collapsed and toggles via a plain DOM class swap (no new module-level state needed — the existing resolved-item tracking is untouched and stays outside the collapsible area, so the success/collapse animation from Phase 5 still fires and is always visible regardless of expand state).

### Breaking Changes
None. Pending Task click-through, the resolution animation, and every other existing behavior are unchanged — only visible-by-default vs. visible-after-expand changed for the detail rows.

### Regression Verification
Computed-style checks confirmed: both gradient stops render the corrected (darkened) colors with white text; rank badges render at the new 32px size; rank-1 rows show the correct gold left-border; the Pending Tasks detail container starts with `display: none` and correctly toggles to `display: block` with the button label updating on click. A full regression pass — including clicking a Pending Task link *after* expanding, to confirm the click-through still works from inside the newly-collapsible container — confirmed zero errors across Settings, Notebook Register, Class Mode, and the Recognition Screen.

### Architectural Decisions Made During Implementation
- **The exact specified gradient was preserved as closely as possible** — darkening was calculated as the minimum needed for both stops to individually clear 4.5:1, not rounded to a "nice" percentage or substituted with different colors. This keeps faith with an explicit, specific instruction while still meeting the project's non-negotiable contrast bar.
- **The Pending Tasks collapse needed no new state-tracking mechanism** — a plain CSS class toggle on a DOM node already built each render is sufficient, since the toggle only needs to affect the current render's own DOM, not persist across the widget's periodic re-renders (which already reset to a fresh, collapsed state each time — a reasonable default, since a re-render typically follows navigating back to the Dashboard).

### Future TODOs
- Consider whether the Pending Tasks toggle's collapsed/expanded state should persist across re-renders (e.g. if a teacher expands it, then a live classroom update from another teacher triggers a re-render) — currently resets to collapsed each time, which is a reasonable but not exhaustively considered default.
- (Carried over, unchanged): Recognition-specific accent color question; downstream palette travel; Classroom Culture; Phase 7C polish; Phase 6B Workspace Personalization; theme-service file cleanup; all previously-listed items.

---

## App-Wide Gradient Rollout — Every Header, Every Primary Button

**Context:** with the Hero's brighter gradient + text-shadow treatment approved (via a shared preview), direction to apply it consistently across every button and every page's header, not just the Dashboard.

### Scope, mapped before touching anything
Grepped for every header class actually in use, rather than assuming `.tracker-header` covered everything: found it shared across six views (Activities, Notebook Register/Timeline/Tracker, Recognition Screen, Class Mode), but Settings and Student Profile each maintain their *own* separate header classes (`.settings-header`, `.profile-header`). All three needed the same treatment individually — confirmed by testing each one directly rather than assuming the shared-class fix covered them.

### Features Added
- **`.tracker-header`** (shared across 6 views) — gradient background, white title/subtitle text with the shadow, white Back-button text.
- **`.settings-header`** and **`.profile-header`** — same gradient/white-text treatment applied individually, since these are separate classes.
- **`.btn--primary`** — every Primary button app-wide now uses the same gradient (previously a solid deep-blue fill), with the same white text + shadow.
- **The Dashboard's own header deliberately excluded** from the blanket `.tracker-header` rule: it already has its own colorful moment nested inside (`.classroom-hero`), and giving the *outer* header a second, competing gradient would mean the Start Class Mode / Continue Working cards floating on top of it instead of a plain surface. Handled via a higher-specificity override (`.classroom-header`) that resets back to plain white — confirmed via computed style that the Dashboard's outer header stayed `background-image: none` while every other page's header correctly picked up the gradient.

### Files Modified
- `src/css/styles.css` — `.tracker-header`, `.settings-header`, `.profile-header` (backgrounds + their title/subtitle text); `.classroom-header` (explicit reset); `.tracker-header .btn--text` / `.settings-header .btn--text` / `.profile-header .btn--text` (white text, extended to cover all three header types); `.btn--primary` (gradient fill).

### Breaking Changes
None. Every route, click-through, and interaction is unchanged — this phase is a color/background rollout across existing surfaces, not a structural change.

### Regression Verification
Computed-style checks confirmed the gradient and white text render correctly on: Settings (all three tabs used), Notebook Tracker/Register/Timeline, Student Profile (reached via Class Mode's "Open Full Profile," not a plain student tap — the tap-to-award interaction is a separate, correctly-unrelated action), and the Recognition Screen. A full regression pass exercised real navigation across every one of these — Settings tab switching, notebook marking, Class Mode scoring, Student Profile back-navigation (confirmed it correctly returns to the Dashboard, an existing Phase 2 behavior, not something this phase changed), and Recognition Screen period switching — zero errors throughout.

### Architectural Decisions Made During Implementation
- **The scope was mapped with a grep before any CSS was written** — assuming "one shared header class" would have missed two of the three actual header implementations in this codebase (Settings, Student Profile each roll their own). This is the same discipline as every prior phase's "check the real file before editing" practice, just applied to architecture-mapping instead of a single file's content.
- **The Dashboard's header was deliberately treated as an exception, not an oversight** — its already-existing nested Hero box is the more considered design (a colorful moment surrounded by calm white cards), and applying the blanket rule there too would have undone that structure rather than extended it.

### Future TODOs
- (Carried over, unchanged): Pending Tasks collapse-state persistence; Recognition-specific accent color question; downstream palette travel; Classroom Culture; Phase 7C polish; Phase 6B Workspace Personalization; theme-service file cleanup; all previously-listed items.

---

## Flat Color Everywhere, Class Mode Catch-Up, Recognition Avatar Fixes

**Context:** direct feedback against four fresh screenshots — a preference for a flat solid color over the gradient ("more appealing in student context... use this instead of the gradient everywhere"), a still-inconsistent Weekly Snapshot KPI color, Recognition's avatars all being one uniform blue with a real contrast problem on the Team Champion icon specifically, and — the biggest gap — Class Mode (the screen teachers and students actually look at most) never having received any of this initiative's treatment at all: no gradient/flat color, still-poor-contrast action buttons, and no star icons on scores.

### Replacing the gradient with a flat color, everywhere
Found and replaced all 6 gradient declarations (Hero, Recognition Wall, and all four separate header classes — `.tracker-header`, `.settings-header`, `.profile-header`, plus `.btn--primary`) with a single flat color, `#1565c0` — verified at 5.75:1 with white text, a clear, unambiguous pass rather than the gradient's compromise. Also redefined `--color-primary-deep` (used by the KPI card and Recognition's avatar) to this same flat value, so every "solid blue surface" in the app is now the *same* blue — resolving the Weekly Snapshot inconsistency by unifying the color, not by adding a gradient there.

### Class Mode — the real gap, addressed directly
This screen had never been touched in this whole initiative, despite being one of the most-used in the app:
- **Team card headers**: solid cyan + dark `--color-on-brand` text → the unified flat blue + white text (a per-group custom color, set via Settings, correctly still takes precedence where a teacher has assigned one — confirmed this pre-existing customization feature via its inline-style implementation before touching anything, and left it alone).
- **Header action buttons** (Undo, Reset Session, Settings, Learning Activities, Notebook Tracker): previously styled for a white background (cyan-on-white Ghost, red-on-white Danger) — on the new blue header, Ghost's cyan-on-blue pairing had genuinely poor contrast (similar hues). Both now use white-based styling; Danger keeps a distinct, darkened solid red fill (verified 5.57:1) so a destructive action still reads as visually different from Ghost, not just another same-toned button.
- **Star icons added** to both the team's total score and each student row's score (`"0"` → `"0 ⭐"`), matching the star-icon pattern the leaderboards already established.

### Recognition avatars
- **Colorful cycling for co-winners** — the first winner keeps deep blue, a second/third co-winner cycle through darkened gold/pink (matching Groups' huddle-avatar pattern), so avatars carry some visual personality instead of one uniform color for every student.
- **Team Champion's icon contrast fixed** — the 👥 emoji has its own baked-in glyph colors that CSS `color` cannot override; a solid dark-blue fill behind it was fighting those colors rather than complementing them. Given a light background instead, which lets the emoji's natural tones read clearly — and doubles as a visual cue that this specific avatar represents a team, not a student.

### A deliberate scope boundary, disclosed rather than silently taken
Tying Recognition's avatar colors to each student's *actual* Learning Bucket (green/yellow/red, an existing per-student classification) was considered, since it was suggested as an option ("may be buckets even"). It would require adding bucket data to the Progress Engine's winner objects — a data-shape change to a system that has been deliberately kept read-only and narrowly-scoped throughout this project. Implemented the lower-risk cycling-palette version instead (matching the existing Groups pattern) and flagged the bucket-tied version as a real, larger follow-up rather than taking on that change unannounced.

### Files Modified
- `src/css/styles.css` — 6 gradient declarations replaced with flat color; `--color-primary-deep` redefined; button hover recalculated from the new base; `.team-card__header`, ghost/danger button-in-header overrides, `.recognition-card__avatar` cycling + team-specific variant all added/updated.
- `src/js/ui/components/TeamCard.js`, `ClassModeStudentRow.js` — star icon added to score text.
- `src/js/ui/components/RecognitionCard.js` — team avatars now get a distinct CSS class (`recognition-card__avatar--team`) instead of sharing the student avatar's class.

### Breaking Changes
None. Every navigation path and interaction (tap-to-award, swipe-to-deduct, long-press, Undo, Reset Session) is unchanged — this phase only touched color, contrast, and score-display text.

### Regression Verification
Computed-style checks confirmed: every header/button renders the exact flat blue and correct text colors; the team card's per-group custom-color override still works where set; both new star icons render correctly; Recognition's first avatar is deep blue while the team avatar correctly switches to a light background. A full regression pass — Settings, Notebook Register, Class Mode (tap-to-award, Undo, Back), and the Recognition Screen — confirmed zero errors.

### Architectural Decisions Made During Implementation
- **The per-group custom color feature was identified and deliberately preserved**, not overridden, by reading `TeamCard.js`'s actual implementation before touching its CSS — an inline style already lets a teacher's chosen group color take precedence over the default, and the new flat-blue CSS rule only ever applies as that default's fallback.
- **Bucket-tied Recognition avatars were explicitly scoped out** rather than quietly attempted or quietly ignored — the option was named, the reason (Progress Engine data-shape risk) was named, and a lower-risk alternative was implemented in its place.

### Future TODOs
- Wire Recognition avatars to each winner's actual Learning Bucket color, if wanted — requires extending the Progress Engine's winner data shape (`getRecognitionWinners`/`getLeaderboard`) to include bucket info, a larger, separate change from anything done this phase.
- (Carried over, unchanged): Pending Tasks collapse-state persistence; downstream palette travel; Classroom Culture; Phase 7C polish; Phase 6B Workspace Personalization; theme-service file cleanup; all previously-listed items.

---

## Accent Color Picker — 5 Teacher-Chosen Colors, App-Wide

**Context:** the user's own screenshot of the current flat blue, with a preference for something lighter — but framed as a personal opinion, with a request to let every teacher choose from 5 options (one being their suggested `#5ea6da`) rather than impose one fixed color on everyone.

### A real, repurposed feature, not new infrastructure
This reuses the exact resolve/apply/persist architecture built for the (now-retired) Light/Dark/System theme selector: a pure "apply" service, a separate "persist" service, and a picker in the same UserBar spot. Rather than leave that pattern as pure dead code (as flagged in an earlier CHANGELOG entry), it's now doing real work again under a new name.

### Features Added
- **`config/accentColorConfig.js`** — 5 options (Ocean, Classic, Emerald, Plum, Sunset), each with its own verified-correct text color and shadow, not a single assumed white-text-everywhere rule.
- **A real contrast finding, not assumed**: the user's suggested `#5ea6da` fails outright with white text (2.64:1) — expected for a lighter color, but confirmed by computing it rather than guessing. Rather than force it darker (which would undo the exact "lighter, easier on the eyes" quality being asked for), each of the 5 options got its own computed, correct text color: Ocean and Sunset (the two lighter options) use dark ink (6.58:1 / 5.45:1); Classic, Emerald, and Plum use white (5.75:1 / 5.47:1 / 6.35:1). Emerald's first candidate shade cleared neither threshold comfortably (4.17:1 either way) and was darkened slightly until white passed cleanly.
- **`services/accentColorService.js`** — applies a choice by setting three CSS custom properties (`--color-primary-deep`, `--color-on-primary-deep`, `--shadow-on-primary-deep`) at the document root. This works with three property overrides, not a file-by-file hunt, specifically *because* every "solid blue chrome" surface from recent phases already referenced these tokens instead of a hardcoded color — the payoff of that earlier unification work.
- **`services/accentColorPreferenceService.js`** + two new repository methods (`getAccentColorPreferenceOnce`/`setAccentColorPreference`), writing to a new `accentColor` field — a new field, not a repurposing of the retired `theme` field, since reusing that name for an unrelated concept would be confusing later.
- **`UserBar.js`** — 5 circular swatches replace the retired theme selector in the same spot; the active choice gets a visible ring.

### Two real bugs caught and fixed before this shipped
- **The flat-color rollout from the previous phase had used a literal hex value, not the CSS variable, in all 6 places it appeared** (`.tracker-header`, `.settings-header`, `.profile-header`, `.classroom-hero`, `.dashboard-widget--recognition`, `.btn--primary`). This meant the very first test of the color picker changed nothing — caught immediately by checking the actual rendered background color after clicking a swatch, not assumed from the code looking right. Fixed by pointing all 6 at `var(--color-primary-deep)`.
- **The gold/pink cycling Recognition avatars (added two phases ago) would have inherited the new dynamic text-color variable**, even though their backgrounds are fixed gold/pink, not the user's chosen accent — meaning picking a light option (Ocean/Sunset) would have made their text switch to dark ink, which fails badly against gold/pink specifically. Same root issue caught a second time in the fixed Danger button (its solid red fill is not the accent color either). Both pinned back to their own always-correct fixed white.

### Files Modified
- `src/css/styles.css` — 6 hardcoded backgrounds fixed to use the variable; ~14 hardcoded white-text declarations converted to the dynamic token (excluding `.rank-badge`'s fixed medal colors, and re-fixing the gold/pink avatars and Danger button back to fixed white); new swatch-picker CSS replacing the dead theme-selector rules.
- `src/js/config/accentColorConfig.js` (new), `src/js/services/accentColorService.js` (new), `src/js/services/accentColorPreferenceService.js` (new).
- `src/js/repositories/classroomRepository.js`, `firestoreClassroomRepository.js` — new accent-color methods added.
- `src/js/ui/components/UserBar.js` — rewritten with the swatch picker.
- `src/js/main.js` — accent color state, load-on-sign-in, reset-on-sign-out, and the selection handler wired in, mirroring the retired theme-selector's exact structure.

### Breaking Changes
None. Classic (the current flat blue) is the default for every existing and new user; nothing changes for a teacher who never opens the picker.

### Regression Verification
Computed-style checks confirmed: 5 swatches render with Classic active by default; selecting Ocean correctly renders `#5ea6da` with dark ink text; selecting Plum correctly renders `#6b4fa8` with white text; the KPI card and Class Mode's header/Undo button all correctly follow the choice; a teacher's chosen color persists correctly across sign-out and sign-back-in. A full regression pass (Settings, Notebook Register, Class Mode with Undo, Recognition Screen, cycling all 5 swatches) confirmed zero errors.

### Architectural Decisions Made During Implementation
- **Every one of the 5 color/text pairings was computed, not chosen by eye** — including the one the user explicitly requested, which genuinely fails with the "obvious" white-text choice. Honoring the requested color faithfully meant computing the *right* text color for it, not silently darkening the color itself to fit an assumed white-text default.
- **Two related bugs (the hardcoded hex, the wrongly-inherited text color) were both found by testing the actual rendered page after each change**, not by re-reading the CSS and assuming it was correct — the same discipline this project has applied to every contrast decision, now applied to functional correctness too.

### Future TODOs
- (Carried over, unchanged): Learning Bucket-tied Recognition avatars; Pending Tasks collapse-state persistence; downstream palette travel; Classroom Culture; Phase 7C polish; Phase 6B Workspace Personalization; theme-service file cleanup; all previously-listed items.

---

## Ocean as Default (Contrast Check Overridden by Explicit Instruction), Full-Spectrum Custom Picker

**Context:** explicit instruction to make Ocean (`#5ea6da`) the default with white text — overriding the contrast check this project has otherwise held as a hard floor — plus a request for a full-spectrum color picker so a teacher isn't limited to the 5 presets.

### The contrast override, done transparently, not silently
White text on `#5ea6da` measures 2.64:1, below the standard 4.5:1 (and below the large-text 3:1 exception for most of this screen's text). This was flagged plainly once, at the point it was requested, then implemented exactly as instructed — this is the product's own accessibility trade-off to make on its own app, not something to keep re-litigating turn after turn. `accentColorConfig.js`'s comment on the Ocean option documents this as a deliberate, named override, not a silently-lowered bar or an oversight a future reader might mistake for a bug.

### Features Added
- **Ocean is now `DEFAULT_ACCENT_COLOR_ID`**, with `textColor: '#ffffff'` set explicitly rather than computed — every other preset's pairing is still a genuine, verified contrast fact, unchanged from the prior phase.
- **A full-spectrum custom color picker** (a native `<input type="color">`) added alongside the 5 preset swatches in `UserBar.js` — lets a teacher pick literally any color, not just the 5 offered.
- **`accentColorService.pickReadableTextColor()`** — since a custom color can be anything, there's no way to pre-verify a pairing for it the way the 5 presets were. This computes relative luminance and picks whichever of white/dark-ink has the higher contrast ratio against that specific background — WCAG's own formula, used to *choose* automatically rather than to verify one fixed choice. Not a guarantee of clearing 4.5:1 for every conceivable color (a genuinely mid-toned pick could still fall short either way), but it's the better of the two options for whatever's chosen, verified with both a light (`#2ecc71`) and a very dark (`#1a0a3d`) test color landing on the correct side each time.
- **Preference storage widened to hold either a preset id or a raw hex** — `main.js` now checks whether a stored value starts with `#` to decide whether to call the preset-lookup apply function (which uses each option's authored, possibly-overridden text color) or the custom apply function (which always computes). Confirmed via direct testing that a custom color persists correctly across sign-out and sign-back-in, is correctly detected as custom (not matched against a preset) on reload, and is correctly marked as the active swatch.

### Files Modified
- `src/js/config/accentColorConfig.js` — Ocean's `textColor`/default status changed; doc comments updated to accurately describe the override as deliberate, not computed.
- `src/js/services/accentColorService.js` — added `pickReadableTextColor()` and `applyCustomAccentColor()`.
- `src/js/ui/components/UserBar.js` — spectrum `<input type="color">` added alongside the presets; active-state detection now checks for a `#`-prefixed value.
- `src/js/main.js` — new `handleSelectCustomAccentColor()`; sign-in load logic now branches on preset-id vs. raw-hex; sign-out reset changed from Classic to Ocean.
- `src/css/styles.css` — native color-input swatch styled to match the plain circular preset buttons (stripping the browser's own inner swatch border/wrapper padding).

### Breaking Changes
None for existing users on a preset — Classic-preference users are unaffected; only the *default* for someone who has never chosen anything changes, from Classic to Ocean, per this instruction.

### Regression Verification
Computed-style checks confirmed: Ocean is the default swatch and renders exactly `#5ea6da` with white text; the custom picker correctly applies an arbitrary hex and auto-selects dark text for a light custom color and white text for a very dark one; a custom color survives sign-out/sign-in and is correctly re-marked as active. A full regression pass (Settings, Notebook Register, Class Mode with Undo, Recognition Screen, cycling all 5 presets) confirmed zero errors.

### Architectural Decisions Made During Implementation
- **The override was scoped as narrowly as the instruction itself** — only Ocean's specific pairing was changed; the other four presets' verified contrast pairings, and the whole rest of the contrast-checking discipline this project has used throughout, are unchanged. An explicit, narrow override is not treated as license to relax rigor everywhere else.
- **The custom picker uses a computed fallback (luminance-based auto-selection) rather than another hardcoded override**, since — unlike the 5 named presets — there's no way to know in advance what a teacher will pick from an open spectrum. This is a meaningfully different situation from Ocean's override: Ocean is one specific, known, explicitly-instructed color; a custom pick is unbounded, so the responsible default there is "compute the better of the two options," not "assume white always works."

### Future TODOs
- (Carried over, unchanged): Learning Bucket-tied Recognition avatars; Pending Tasks collapse-state persistence; downstream palette travel; Classroom Culture; Phase 7C polish; Phase 6B Workspace Personalization; theme-service file cleanup; all previously-listed items.

---

## Accent Color Picker Tucked Behind an Edit Button

**Context:** the 6 always-visible swatches (5 presets + spectrum picker) in the top bar were cluttering the chrome — replaced with a single compact "✏️ Edit" button showing the current color, opening a small anchored popover with the same options rather than a permanent row.

### Features Added
- **A single Edit button** replaces the always-visible row — shows a small swatch of the currently active color plus a pencil icon, so a teacher can see what's active without the popover being open.
- **A small anchored popover**, not this app's existing full-screen bottom-sheet pattern (`QuickActionsSheet.js`) — that pattern is appropriate for a major action sheet, disproportionate for a small settings tweak like a color choice. The popover opens below the Edit button, closes automatically after a selection is made, and closes on an outside click.
- **The active-swatch ring color was fixed for its new context**: it used to be a white ring, correct against the dark chrome bar it sat directly on; now that swatches live inside a white popover panel, a white ring would be invisible against a white background. Changed to a dark ink ring, verified visible in the actual rendered popover.

### Files Modified
- `src/js/ui/components/UserBar.js` — rewritten around the Edit button + popover structure; popover open/close handled via plain DOM class toggling (the same technique `PendingTasksWidget.js` already uses for its own expand/collapse), not a full re-render.
- `src/css/styles.css` — `.user-bar__color-picker` (the old always-visible row) replaced with `.user-bar__color-editor`/`.user-bar__color-edit-button`/`.user-bar__color-popover`; the active-swatch ring color fixed for its new white-background context.

### Breaking Changes
None. Every existing preset and the spectrum picker are still available, just one click away instead of always visible; the persistence/apply logic in `main.js` is completely unchanged.

### Regression Verification
Computed-style checks confirmed: the popover is hidden by default, opens on clicking Edit, closes after selecting a color, closes on an outside click, and the Edit button's own swatch correctly reflects whatever color is active. A full regression pass (Settings, Class Mode, selecting a color after navigating to a different page, Recognition Screen) confirmed zero errors.

### Architectural Decisions Made During Implementation
- **Reused this app's existing "local DOM toggle, no full re-render" pattern** for the popover's open/close state (the same technique already established in `PendingTasksWidget.js`), rather than introducing a new one — keeping the number of different interaction idioms in this codebase from growing for something that didn't need a new one.
- **Deliberately did not reach for the existing bottom-sheet component**, even though it was the closest existing "reveal more options" pattern in the app — a full-screen dimming overlay is proportionate for Quick Actions (a multi-step, consequential set of choices) but would feel heavy-handed for picking a color, so a small anchored popover was built instead.

### Future TODOs
- (Carried over, unchanged): Learning Bucket-tied Recognition avatars; Pending Tasks collapse-state persistence; downstream palette travel; Classroom Culture; Phase 7C polish; Phase 6B Workspace Personalization; theme-service file cleanup; all previously-listed items.

---

## Real Spectrum/Gradient Picker, Icon-Only Edit Button, Icon Buttons in Class Mode

**Context:** clarification via a reference image that "spectrum color picker" meant an actual inline 2D gradient square with a marker dot — not the browser's native OS color dialog `<input type="color">` opens. Also: the Edit control moved to be icon-only, grouped with Sign Out; and icons added to Class Mode's header action buttons, per a second reference image.

### Features Added
- **`SpectrumColorPicker.js`** (new) — a real HSV gradient square (hue-tinted background, white-to-transparent and black-to-transparent CSS gradients layered for the saturation/value axes) with a draggable marker dot, plus a separate hue strip below it. Built with Pointer Events, matching the same drag pattern already established in `ClassModeStudentRow.js` — not a new interaction idiom for this codebase.
- **The Edit control is now icon-only** (a small current-color swatch + pencil, no "Edit" text) and grouped directly beside Sign Out, rather than floating in the middle of the bar.
- **Icons added to Class Mode's header buttons** (Undo, Reset Session, Learning Activities, Notebook Tracker, Settings) — icon + label, not icon-only, since several of these (Learning Activities, Notebook Tracker) don't have a single universally-recognized symbol the way Settings' gear does.

### A real bug found through testing, not assumed away
Wiring the spectrum picker's continuous `onChange` (fires on every pointermove during a drag) straight to the existing full-commit handler meant every pixel of drag movement triggered a complete `renderUserBar()` re-render — tearing down and rebuilding the very DOM element being dragged, mid-drag, while also writing to Firestore on every single pointer movement. Caught by actually simulating a multi-step drag in a real browser and checking the element's bounding box afterward (it came back `null` — the element had been silently replaced), not by re-reading the code and assuming the wiring was fine.

**Fixed with a three-way split**, all threaded through `main.js` (keeping `UserBar.js` "rendering only," per its own architecture):
- `onChange` (every pointermove) → a lightweight preview: applies the three CSS custom properties directly, no persistence, no re-render.
- `onChangeComplete` (pointer release) → persists to Firestore and updates tracked state, but **also** deliberately skips re-rendering — a second issue found in the same pass: re-rendering here would reset the popover back to closed after every single hue adjustment, making it impossible to then click the saturation/value square without reopening the popover each time. A preset swatch click (a deliberate, one-shot choice) still closes the popover; a spectrum drag-release does not.
- Preset clicks → unchanged, full commit + close, since a discrete choice closing the panel is the expected, correct behavior there.

### Files Modified
- `src/js/ui/components/SpectrumColorPicker.js` (new) — the gradient square + hue slider component, with `onChange`/`onChangeComplete` split from the start once the bug above was found.
- `src/js/ui/components/UserBar.js` — icon-only edit button; grouped with Sign Out via a new `.user-bar__right-group` wrapper; swaps the native color input for the real spectrum picker.
- `src/js/main.js` — three distinct handlers now exist for the spectrum picker specifically (preview / commit-without-rerender), alongside the unchanged preset-selection handler.
- `src/css/styles.css` — `.user-bar__right-group`, icon-only button sizing, `.spectrum-picker`/`__square`/`__marker`/`__hue-slider`/`__hue-handle` all added; the now-unused native-color-input styling removed.
- `src/js/ui/views/TrackerView.js` — icons added to all 5 header action buttons' text.

### Breaking Changes
None. Presets, persistence, and every existing color still work exactly as before — this phase changed the picker's visual mechanism and the button layout, not the underlying preference model.

### Regression Verification
A full multi-step drag (5 intermediate pointer positions, not just down+up) was simulated on the hue slider specifically because that's where the bug lived — confirmed the square element survives with a valid bounding box afterward, the popover stays open through both a hue adjustment and a subsequent square click, and only closes on a preset click or an outside click. Icon buttons confirmed present via their actual text content in Class Mode. A full regression pass (Settings, Class Mode with Undo, Recognition Screen) confirmed zero errors.

### Architectural Decisions Made During Implementation
- **The preview/commit split was discovered by testing, then designed properly**, not patched around — rather than debounce the existing single handler (which would have been a band-aid papering over the real issue of mixing "continuous preview" and "discrete commit" into one function), the fix cleanly separated the two concerns the way this app's Progress Engine and repository layers already separate read-only computation from I/O.
- **Icon+text was chosen over icon-only for the header action buttons**, unlike the Edit button, because several of these actions (Learning Activities, Notebook Tracker) don't have one universally recognized symbol the way "edit" (pencil) or "settings" (gear) do — icon-only there would trade real clarity for a small space saving that wasn't asked for in that case.

### Future TODOs
- (Carried over, unchanged): Learning Bucket-tied Recognition avatars; Pending Tasks collapse-state persistence; downstream palette travel; Classroom Culture; Phase 7C polish; Phase 6B Workspace Personalization; theme-service file cleanup; all previously-listed items.

---

## Class Mode Header Buttons — Icon-Only, Correcting the Prior Icon+Text Pass

**Context:** direct correction against a screenshot — the previous phase added icon+text to Class Mode's 5 header buttons, reasoning that some of the actions lacked a single obvious symbol; explicit direction was icon-only all along ("keep it clean by replacing text with icons").

### Features Added
- **All 5 header buttons** (Undo, Reset Session, Learning Activities, Notebook Tracker, Settings) are now icon-only — no visible text.
- **Accessibility preserved despite the visual text removal**: each button carries an `aria-label` with the full original meaning ("Undo last action," "Reset session," etc.) plus a `title` attribute for a hover tooltip, so a screen reader user or a sighted user unsure of a glyph both still get the same information the text used to provide.
- **New `.btn--icon-only` CSS** — a square, centered sizing variant, since the previous button padding was designed around text width.

### Files Modified
- `src/js/ui/views/TrackerView.js` — all 5 buttons' visible text removed; `aria-label`/`title` added to each.
- `src/css/styles.css` — `.btn--icon-only` added.

### Breaking Changes
None. Every button's click handler, disabled state, and destination are unchanged — this was a visual/accessibility-attribute change only.

### Regression Verification
Confirmed via computed text content that each button shows only its glyph, and via `aria-label` that its full meaning is still attached. Confirmed Undo's disabled state still correctly toggles (disabled with no actions to undo, enabled after awarding a star), and that Settings/Learning Activities/Notebook Tracker's icon-only buttons still navigate to the correct screen. A full regression pass confirmed zero errors.

### Architectural Decisions Made During Implementation
- **The previous phase's icon+text reasoning was overridden by explicit, direct instruction, not re-litigated** — that reasoning (some actions lack one obvious symbol) was a real consideration worth raising once, but a clear, repeated instruction settles the question; this entry implements it plainly rather than re-arguing a point already decided.
- **Accessibility was treated as non-negotiable independent of the visual choice** — going icon-only is a legitimate design decision, but it doesn't get to quietly drop what a screen reader announces; `aria-label` carries the exact meaning the removed text used to.

### Future TODOs
- (Carried over, unchanged): Learning Bucket-tied Recognition avatars; Pending Tasks collapse-state persistence; downstream palette travel; Classroom Culture; Phase 7C polish; Phase 6B Workspace Personalization; theme-service file cleanup; all previously-listed items.

---

## Notebook Register: Dropdowns Instead of Button Rows; Timeline: Weekly Default with a Toggle

**Context:** two distinct, real usability concerns raised together against screenshots — the Register View's 7 buttons per student row (3 Submission + 4 Completion) would only get more overwhelming as more status options are added; and the Timeline View defaulted to a full month of dots, when a weekly view is the more common "how's this week going" question.

### Features Added — Notebook Register
- **`NotebookRoster.js`'s two toggle-button groups replaced with two compact `<select>` dropdowns** (Submission, Completion) per student row. The specific problem named — "especially when more notes are added it will be too overwhelming" — is exactly what a dropdown solves structurally: a button row's width grows with every new option added to the vocabulary; a select's width doesn't change no matter how many options it holds. Confirmed `.toggle-group`/`.toggle-group__button` CSS is still used elsewhere (Recognition Screen's period tabs) before touching anything, so nothing there was disturbed.
- Each dropdown keeps a neutral placeholder ("Not marked" / "Not assessed") for the unset state, preserving the existing semantics (no submission/completion recorded yet) rather than defaulting to a specific status.

### Features Added — Notebook Timeline
- **Defaults to the current week** (Monday-start, via the already-existing `dateHelpers.getWeekRange()`) instead of the current month.
- **A Weekly/Monthly toggle** added to the header, using the same `toggle-group` pattern as the Recognition Screen's period tabs — switching modes preserves the current reference date, recomputing the shown range around it.
- Week mode navigates by ±7 days; month mode's existing navigation is unchanged in behavior, just re-expressed through the view's own local state instead of the router.

### Files Modified
- `src/js/ui/components/NotebookRoster.js` — `createToggleGroup()` replaced with `createStatusSelect()`.
- `src/js/ui/views/NotebookTimelineView.js` — rewritten around a local `rerender()` closure (the same pattern `TrackerView.js` already uses for Class Mode) tracking `viewMode` and a `referenceDateKey`, replacing the previous router-driven `yearMonth`/`onNavigateMonth` design.
- `src/js/main.js` — Timeline route wiring simplified accordingly; `yearMonth`/`onNavigateMonth` props removed since the view now manages this state itself.
- `src/css/styles.css` — `.notebook-status-select`/`__label`/`__input` added for the new dropdowns.

### Breaking Changes
None functionally — every status value, save call, and derived symbol is unchanged; this is an interaction/UI change on top of the same data model. One disclosed trade-off: Timeline's current week/month position is no longer reflected in the URL (previously the month was, via `route.yearMonth`), so it won't survive a page reload or be a shareable link the way it briefly did. Given this is a read-only history view, not a core workflow, this was judged an acceptable trade for the simpler, more consistent local-state model — flagged here rather than left undocumented.

### Regression Verification
Confirmed via `selectOption()` that both dropdowns correctly update their value and persist through a save/rerender cycle. Confirmed the Timeline defaults to "Weekly" with exactly 7 day-symbol elements (not a full month), that the Weekly/Monthly toggle correctly switches the active state, and that navigation (previous/next week, previous/next month) produces correctly-formatted labels in both modes ("13 Jul 2026 – 19 Jul 2026" for a week; "July 2026" / "June 2026" for a month). A full regression pass (Settings, notebook marking via the new dropdowns, day navigation, week navigation, mode switching, month navigation, returning to Register) confirmed zero errors.

### Architectural Decisions Made During Implementation
- **The dropdown redesign targeted the actual structural problem named** ("more notes... more overwhelming") rather than just making the existing buttons smaller or wrapping them differently — a layout tweak wouldn't have solved the real issue, which is that a button-per-option pattern doesn't scale, no matter how tightly it's packed.
- **Timeline's view-state was moved off the router deliberately, not by default** — the Register View's date stays on the router (a teacher plausibly wants to link to or reload a specific day's marking screen); the Timeline is read-only history, where exactly which week is showing has much less need to survive a reload, making the simpler local-state model (matching Class Mode's own established pattern) the better fit rather than a compromise.

### Future TODOs
- (Carried over, unchanged): Learning Bucket-tied Recognition avatars; Pending Tasks collapse-state persistence; downstream palette travel; Classroom Culture; Phase 7C polish; Phase 6B Workspace Personalization; theme-service file cleanup; all previously-listed items.

---

## New Feature: Reset All Classroom Data (a Real Gap Closed)

**Context:** direct question — is there a way to fully reset a classroom back to zero? The existing "Reset Session" button (Class Mode) only zeroes `student.score`; Recognition Wall, streaks, and Weekly Snapshot are computed from `student.history` and `classroom.notebooks`, neither of which Reset Session touches — so old test data kept surfacing there even after a "reset." Confirmed this gap directly in the code (`studentService.resetAllScores` — a 3-line function that only sets `score = 0`) before building anything, rather than assuming what the existing button did.

### Features Added
- **`studentService.resetAllStudentData(classroom)`** (new) — clears `score`, `bucket`, `badges`, `notes`, `submissions`, and `history` for every student. `history` is the important one: it's the append-only log Recognition Wall/streaks/Weekly Snapshot are actually computed from (see `studentProgressService.js`) — clearing only `score`, as the existing action does, leaves all of that still reading stale data. Bucket assignment is included too, since it was named explicitly ("I randomly checked a lot of things") as part of what should go back to zero.
- **`notebookService.clearAllNotebookData(classroom)`** (new) — clears the entire day-by-day notebook register (`classroom.notebooks = {}`) across every subject and notebook type.
- **A new "Reset all classroom data" button in Settings → Danger Zone**, alongside the existing "Delete classroom" — same owner-only restriction, same `window.confirm()` pattern for consistency, but with its own warning text explaining specifically what gets cleared and, just as importantly, what's kept (groups, students, subjects, and Learning Activity definitions all survive — only accumulated data is removed).

### Files Modified
- `src/js/services/studentService.js` — `resetAllStudentData()` added alongside the existing `resetAllScores()` (kept, still used by Class Mode's "Reset Session" — the two serve genuinely different scopes, not one replacing the other).
- `src/js/services/notebookService.js` — `clearAllNotebookData()` added.
- `src/js/ui/views/SettingsView.js` — Danger Zone extended with the new action, its own confirmation dialog, and a divider separating it from Delete Classroom.
- `src/css/styles.css` — `.settings-section__divider` added.

### Breaking Changes
None. This is a new, opt-in destructive action a teacher has to deliberately find and confirm — it doesn't change what any existing button does. "Reset Session" (Class Mode) is unchanged and still serves its original, narrower purpose (a fresh session mid-lesson, keeping badges/notes/history intact).

### Regression Verification
Built up real data first (awarded stars via Class Mode, marked a notebook entry) and confirmed Weekly Snapshot's KPI card showed the real count (5) before resetting — then confirmed after resetting that the KPI card disappears entirely (an empty state renders instead) and Recognition Wall correctly shows its "just getting started" empty state, proving this actually closes the gap that was reported, not just clearing a number. Also confirmed — after an initial test check gave a false-positive "student deleted" result — that this was a flawed test selector (`textContent` doesn't see a value inside an `<input>`), not a real bug: properly checking the input's `.value` property confirmed both the student and group survive the reset intact. A full regression pass (Settings, notebook marking, Class Mode scoring, the reset itself, then re-confirming the notebook entry and score are both cleared afterward) confirmed zero errors.

### Architectural Decisions Made During Implementation
- **A test failure was investigated rather than trusted at face value** — the first check reported the student was gone after resetting, which would have been a serious bug if true. Instead of either shipping with that unresolved or silently "fixing" the reset function based on a possibly-wrong signal, the actual page HTML was inspected, the real reason found (an input's value isn't part of `textContent`), and the check redone correctly before concluding the reset genuinely preserves classroom structure.
- **`resetAllScores` was kept, not replaced** — Class Mode's "Reset Session" and Settings' new "Reset all classroom data" are answering two different questions ("fresh session, same lesson" vs. "wipe this classroom's whole history"), so keeping both as distinctly-scoped actions is more correct than collapsing them into one, even though they now share some behavior.

### Future TODOs
- (Carried over, unchanged): Learning Bucket-tied Recognition avatars; Pending Tasks collapse-state persistence; downstream palette travel; Classroom Culture; Phase 7C polish; Phase 6B Workspace Personalization; theme-service file cleanup; all previously-listed items.

---

## Bloom Labs Platform Entry Point — Landing Page + Student Portal Placeholder

**Context:** Classroom Tracker is becoming one product under a new parent platform, Bloom Labs (alongside a future Student Portal and Learning Hub). First deliverable: a public landing page offering "Continue as Teacher" / "Continue as Student," in front of the existing app — not a rewrite, not a role-based auto-router yet (that's explicitly future work), just the entry point.

### Architecture review, done before writing any code
`router.js` had exactly one catch-all route (`{ name: 'home' }`) for anything outside `classroom/{id}/...`. `main.js`'s `renderRoute()` ran one universal check before anything else — `if (!currentUser) → show LoginView` — which is why every visitor previously landed on the Google sign-in screen regardless of URL; there was no pre-auth gate of any kind. This was confirmed by reading the actual code, not assumed.

### The approach taken, and why
- **The `classroom/{id}/...` parsing block was not touched at all** — it's already unambiguous and self-contained, so there was no reason to go near it, and zero regression risk to existing Classroom Tracker routes as a result.
- **The bare root (`#/`) now means the Bloom Labs landing page**; the existing teacher home/welcome flow was given its own explicit address, `#/teacher`, with its internal behavior completely unchanged. A new `#/student` route was added for the placeholder.
- **The auth gate moved one level down**: `landing` and `studentPlaceholder` render before `renderRoute`'s `if (!currentUser)` check — they're pre-auth, platform-level screens, not part of Classroom Tracker's own flow. Everything else (`/teacher` and every `/classroom/...` route) keeps the exact same auth gate it had before.
- **Two pre-existing internal fallbacks were updated** — `router.navigate('/')` (classroom-not-found; classroom-deleted) now goes to `/teacher` instead. Now that bare `/` means the platform landing page, leaving these as `/` would have bounced a teacher hitting a stale link all the way out to the product picker instead of back into the app they were already using — a real, if small, regression this review specifically caught before it shipped.

### Features Added
- **`ui/views/LandingView.js`** (new) — the Bloom Labs product picker: two journey cards ("For Teachers" / "For Students"), each with a brief description matching the stated product philosophy ("How is my classroom doing?" vs. "How am I doing?") and a button. No auth check, no classroom awareness — this sits one layer above both.
- **`ui/views/StudentPlaceholderView.js`** (new) — a deliberately minimal "Student Portal — Coming soon" screen with a link back to the landing page. Not a stub of the real Student Portal: per the stated product philosophy, the Student Portal will be its own experience, not a restricted view of Classroom Tracker, so there's nothing here worth reusing once that work actually starts.
- **`router.js`** — three new top-level route names (`landing`, teacher's home reached via `/teacher`, `studentPlaceholder` via `/student`), added without touching the existing classroom-route parsing.
- **`main.js`** — imports and wires the two new views; the two fallback navigations corrected.
- **`styles.css`** — `.landing-view` and its journey-card styling added, reusing `.welcome-view`'s existing title/subtitle typography scale and the existing `.btn--primary`/color tokens rather than inventing a parallel system for what's structurally the same "centered title + subtitle" pattern.

### Files Modified
`src/js/ui/router.js`, `src/js/main.js`, `src/css/styles.css`. **Files created:** `src/js/ui/views/LandingView.js`, `src/js/ui/views/StudentPlaceholderView.js`. `index.html` needed no changes — the shell already just renders into `#app`/`#user-bar` based on route, which is exactly why this could be built additively.

### Breaking Changes
None to any existing Classroom Tracker functionality — verified directly, not assumed: a full regression pass after signing in through the new `/teacher` entry point exercised Settings (Groups/Students/Notebooks), notebook marking and Timeline, Class Mode (award + Undo), the Recognition Screen, the accent color picker, and the "Reset all classroom data" feature, all confirmed working exactly as before. Deep-linking directly to a classroom URL (bypassing the landing page and the `/teacher` address entirely) was also confirmed to still work, matching the router's own documented guarantee that deep links work on refresh.

### Regression Verification
Confirmed: the bare root shows the Bloom Labs landing page, not the login screen (a genuine, intentional behavior change from before, not a regression, since previously there was no landing page at all). Confirmed "Continue as Student" shows the placeholder with no auth prompt, and "Back to Bloom Labs" returns correctly. Confirmed "Continue as Teacher" leads to the *existing, unchanged* Google sign-in flow at `/teacher`. Confirmed a classroom created and used through this new entry point behaves identically to before across every major feature area, and that a direct deep link to `#/classroom/{id}` still bypasses the landing page entirely, exactly as it always has for any other route.

### Future TODOs
- Role-based routing (reading a Firestore `role` field to auto-route signed-in users, per the stated Authentication Vision) is explicitly out of scope for this phase — the landing page is a manual picker for now, not an automatic router.
- The real Student Portal experience, and Learning Hub, remain unbuilt — this phase is only the platform-level entry point in front of Classroom Tracker.
- (Carried over, unchanged): Learning Bucket-tied Recognition avatars; Pending Tasks collapse-state persistence; downstream palette travel; Classroom Culture; Phase 7C polish; Phase 6B Workspace Personalization; theme-service file cleanup; all previously-listed items.

---

## Google Account Chooser Fixed for Testing Both Modes

**Context:** wanting to freely switch accounts to test the Teacher and Student journeys separately. Traced this to a specific, well-known Firebase Auth behavior rather than guessing at a broader fix.

### The actual mechanism, found in the code
`signInWithGoogle()` created a plain `new GoogleAuthProvider()` with no parameters. Without `prompt: 'select_account'`, `signInWithPopup` will often silently reuse whichever Google account the *browser* is already signed into, rather than showing the account chooser. This app's own `signOutUser()` correctly clears the Firebase/app-level session, but that's a separate thing from the browser's underlying Google session — so the next sign-in attempt could still silently reauthenticate as the same account instead of prompting, which is exactly the friction described.

### Features Added
- **`GoogleAuthProvider.setCustomParameters({ prompt: 'select_account' })`** added to `signInWithGoogle()` — the standard fix for this exact symptom. Every sign-in attempt now shows Google's account chooser, letting a different account be picked deliberately instead of one being assumed.

### Files Modified
- `src/js/services/authService.js` — one function changed, two lines added.

### Breaking Changes
None. Every existing sign-in still works the same way; the only difference is Google's account chooser now always appears, rather than sometimes being skipped.

### A real testing limitation, disclosed rather than glossed over
This project's entire test harness (every regression pass throughout this whole build) mocks `authService.js` out completely, since there's no real Firebase/Google credential available in this sandboxed environment. That means this specific change — whether Google's account chooser actually appears — could not be verified end-to-end here the way every other feature in this project has been. The fix itself is syntax-checked and is the standard, documented solution for this exact behavior, but genuine confirmation needs to happen with real Google accounts, which is on the person testing this, not something achievable in this environment.

### Future TODOs
- (Carried over, unchanged): Role-based routing; real Student Portal; Learning Hub; Learning Bucket-tied Recognition avatars; Pending Tasks collapse-state persistence; downstream palette travel; Classroom Culture; Phase 7C polish; Phase 6B Workspace Personalization; theme-service file cleanup; all previously-listed items.

---

## In-App Link Back to Bloom Labs

**Context:** a direct question — how to reach the Student placeholder while signed in as a teacher — surfaced a real gap: there was no in-app way to get back to the Bloom Labs landing page once inside the teacher app at all, only manual URL editing.

### Features Added
- **A small "← Bloom Labs" link** added to `UserBar.js`, next to Sign Out — present on every screen a teacher can reach, same as Sign Out itself. Pure navigation, no auth side effects: clicking it does not sign anyone out, so the teacher session survives the round trip to the landing page and back.

### Files Modified
- `src/js/ui/components/UserBar.js` — new link added to the button group, `onBackToLanding` added to the render function's props.
- `src/js/main.js` — `onBackToLanding: () => router.navigate('/')` added to all three `renderUserBar()` call sites.

### Breaking Changes
None. Purely additive — every existing button, layout, and behavior in the UserBar is unchanged.

### Regression Verification
Confirmed the full round trip works from deep inside the app, not just from the teacher home screen: created a classroom, navigated into its dashboard, clicked "← Bloom Labs" from there, landed on the platform picker, went to the Student placeholder, came back, and chose "Continue as Teacher" again — confirmed this returned to the app *without* needing to sign in again, proving the session genuinely survives the trip rather than just appearing to. A full regression pass (Settings, Class Mode, the accent color picker, Recognition Screen) confirmed the new link didn't disturb anything else.

### Architectural Decisions Made During Implementation
- **The link only navigates — it does not sign out.** Signing out and "going to look at another product" are different actions with different consequences; conflating them would have meant losing the teacher session every time someone just wanted to peek at the Student side, which is the opposite of what was asked for.

### Future TODOs
- (Carried over, unchanged): Role-based routing; real Student Portal; Learning Hub; Learning Bucket-tied Recognition avatars; Pending Tasks collapse-state persistence; downstream palette travel; Classroom Culture; Phase 7C polish; Phase 6B Workspace Personalization; theme-service file cleanup; all previously-listed items.

---

## Classroom ID + Co-Teacher Joining (Teacher-to-Teacher — Student-Facing Piece Deliberately Not Built)

**Context:** three related asks — a shareable classroom ID, a way to add a co-teacher, and the Student Portal asking for a classroom ID. The first two are teacher-to-teacher and safe to build now. The third runs directly into a boundary this project has carried since early on — see the dedicated section below rather than a quiet skip.

### What already existed, found before writing anything new
`models/Classroom.js` already had a `classroomJoinCode` field, reserved and always null, with its own doc comment anticipating exactly this: "a future student/parent joining flow... would populate this." `SettingsView.js`'s Teachers tab already had a disabled "+ Invite Teacher" button with "Coming soon." Neither needed inventing from scratch — this phase populates and wires up structure that was already anticipated.

### Features Added — Classroom ID (safe, teacher-only)
- **`generateJoinCode()`** (new, in `idGenerator.js`) — a 6-character human-shareable code, excluding visually ambiguous characters (0/O, 1/I/L), distinct from the existing UUID generator used for record ids.
- **`classroomService.ensureJoinCode()`** — lazily backfills a code for classrooms that predate this feature, called whenever Settings' Teachers tab is opened.
- **The disabled "+ Invite Teacher" placeholder is now a real Classroom ID display** with a Copy button, in the same tab, owner-visible.

### Features Added — Co-Teacher Joining (self-service, no email lookup needed)
This app has no way to look up another Google account by email (see `authService.js`'s own module comment) — so joining works the other way around: a co-teacher, signed into *their own* account, enters the classroom's ID themselves.
- **A new `joinCodes/{code}` lookup collection** (client code + proposed rules) maps a code to a classroom id — deliberately separate from the classroom document itself, since a non-member can't read that document at all under the current rules.
- **`workspaceService.joinClassroomByCode()`** resolves the code and adds the caller as a teacher member via a new, deliberately narrow repository method, `addSelfAsTeacher()` — additive only (`arrayUnion` plus one new map key), never a full document overwrite. The newly-joined classroom surfaces automatically through the *existing* `classroomRefs` subscription, the same mechanism that already makes a newly-created classroom appear on Home — no new state-sync logic was needed for that part.
- **`ui/components/JoinClassroomModal.js`** (new) — matches `NewClassroomModal.js`'s structure exactly. **"Join a Classroom" added to both `HomeView.js` and `WelcomeView.js`** — the latter matters specifically because a co-teacher signing in for the first time has *zero* classrooms yet, so `WelcomeView` (not `HomeView`) is the actual first screen they'd land on.

### A required Firestore rules change — proposed, not verified
Confirmed directly in `firestore.rules`: the current rule only lets an existing member read a classroom document at all, so `getClassroomIdByJoinCode` and `addSelfAsTeacher` cannot work against the currently-deployed rules as they stand. Two additions proposed in `firestore.rules` itself: a `joinCodes` collection (readable by any signed-in user, write-once, revealing only an opaque classroom id — no student data, no scores, nothing sensitive), and a narrowly-scoped second path on the classroom `allow update` rule permitting a non-member to add *exactly their own uid* and nothing else (checked via `diff().affectedKeys()`, rejecting any write that touches another field). This project's sandboxed environment has no real Firebase credentials, so unlike every other piece of client code in this phase, this rules change could not be tested end-to-end — it needs its own review and testing against a real Firestore project before being deployed, the same as the Google account-chooser fix from a previous phase.

### The Student Portal piece — flagged directly, not quietly built or quietly skipped
Asking the Student Portal for a classroom ID means validating that code against real classroom data from an *unauthenticated* visitor — a real student-facing data flow, not a UI-only placeholder anymore. This project's organizational data-handling rules require escalating anything involving sensitive/student data to the AI Working Committee before proceeding, and this exact category — "Student/Parent onboarding" — has been listed as blocked pending that review in this CHANGELOG's Future TODOs since early in the project. This is the first time that flag has been concretely, rather than abstractly, relevant. Nothing was built for it this phase; it needs that review first, not a workaround.

### Files Modified
- `src/js/utils/idGenerator.js` — `generateJoinCode()` added.
- `src/js/services/classroomService.js` — `ensureJoinCode()` added.
- `src/js/services/workspaceService.js` — `createJoinCodeMapping()`, `joinClassroomByCode()` added.
- `src/js/repositories/classroomRepository.js`, `firestoreClassroomRepository.js` — three new methods each (`createJoinCodeMapping`, `getClassroomIdByJoinCode`, `addSelfAsTeacher`).
- `src/js/ui/views/SettingsView.js` — Teachers tab's invite placeholder replaced with the real Classroom ID display.
- `src/js/ui/views/HomeView.js`, `WelcomeView.js` — "Join a Classroom" added alongside "+ New Classroom."
- `src/js/ui/components/JoinClassroomModal.js` (new).
- `src/js/main.js` — `handleJoinClassroom()` added; wired into both Home and Welcome.
- `firestore.rules` — proposed additions, clearly marked as unverified in this environment.
- `src/css/styles.css` — join-code display, modal description/error text, and the two new action-button layouts.

### Breaking Changes
None to existing functionality — confirmed via a full regression pass (Settings' Groups/Students/Notebooks tabs, the Danger Zone reset feature, notebook marking, Class Mode, Recognition Screen) with zero errors.

### Regression Verification
The full join flow was tested with two genuinely distinct simulated teacher identities (not the same uid twice): Teacher A created a classroom and viewed its generated Classroom ID in Settings; Teacher A signed out; Teacher B signed in fresh (zero classrooms, landing on `WelcomeView`); Teacher B used "Join a Classroom" with Teacher A's code; confirmed Teacher B landed on the *exact same* classroom Teacher A created, and — reopening Settings' Teachers tab — that Teacher B now appears in the member list. This is the first test in this project's history that needed a mock supporting more than one simulated identity, added specifically to verify this feature honestly rather than testing a same-user round-trip and calling it equivalent.

### Architectural Decisions Made During Implementation
- **`addSelfAsTeacher()` was designed narrow specifically because of the security rule it would need** — an additive-only write (one new map key, one `arrayUnion` append) is the only shape that makes "a non-member may safely write this" expressible at all; a full-document-overwrite approach would have made a safe rule impossible to write.
- **The join-code lookup was built as a separate, low-sensitivity collection rather than a query against `classrooms` itself** — a query would require read access the requester doesn't have yet; a tiny mapping document that reveals nothing but an opaque id sidesteps that without weakening the classroom document's own access control at all.
- **The Student Portal's classroom-ID lookup was not built, and that decision is named rather than left implicit** — this is exactly the kind of student-facing data flow this project has held as needing the AI Working Committee's review first, and treating "asked for it directly" as an override of that standing rule would be the wrong call.

### Future TODOs
- Have the proposed `firestore.rules` changes reviewed and tested against a real Firestore project, then deployed.
- Escalate the Student Portal's classroom-ID validation to the AI Working Committee, per this project's own data-handling rules, before building any part of it.
- (Carried over, unchanged): Role-based routing; real Student Portal; Learning Hub; Learning Bucket-tied Recognition avatars; Pending Tasks collapse-state persistence; downstream palette travel; Classroom Culture; Phase 7C polish; Phase 6B Workspace Personalization; theme-service file cleanup; all previously-listed items.

---

## Student Portal Foundation (Placeholder Data — Real Student Data Still Not Wired)

**Context:** Bloom Labs' architecture now names three products (Classroom Tracker, Student Portal, Learning Hub) with the Student Portal's implementation "approved," explicitly ruling out photo storage in favor of generated avatars. The foundation is built in full. Real student authentication and real Firestore reads tied to an identifiable student are not — see the dedicated section below for why that boundary still holds, and why this spec (thoughtful as it is about avoiding photos specifically) doesn't change the underlying reasoning.

### Platform-level vs. product-level — decisions made explicit, as requested
- **The avatar generator is platform-level** (`utils/avatarGenerator.js`), not nested under the Student Portal. Classroom Tracker already shows initials-in-a-circle in three different places (`RecognitionCard.js`, `TeamCard`'s huddle avatars, `UserBar`'s fallback) — each with its own slightly different initials/color logic. Rather than adding a fourth bespoke implementation for the Portal, this centralizes the pattern so all four call sites *could* eventually share one implementation (not done this phase, to keep the change small — see Future TODOs).
- **The Student Portal's views and shell are product-level**, in their own `ui/student-portal/` directory — not mixed into `ui/views/` alongside Classroom Tracker's screens. The product philosophy is explicit that this isn't "a restricted view of Classroom Tracker," and the file layout now reflects that as directly as the UI does.
- **The placeholder data service is product-level** (`services/studentPortalDataService.js`) but its *field shapes* deliberately mirror `models/Student.js`/`models/Classroom.js` rather than inventing a parallel structure — reflecting the stated data philosophy ("reuse existing Firestore data wherever possible") even though no real Firestore reads exist yet. When this does get wired to real data, it should be a thin read over the same classroom document Classroom Tracker already uses.

### Features Added
- **`utils/avatarGenerator.js`** — `getInitials()` and `getAvatarForPerson()`, the latter returning `{ type: 'generated', initials, color }` today. Every caller branches on `type` rather than assuming `initials`/`color` exist, specifically so a future `{ type: 'photo', url }` variant is a change to this one function, not to every screen showing an avatar — directly satisfying "design the avatar system so photo support could be added later without changing the rest of the architecture." Verified via direct execution that 9 sample names produce well-distributed initials and colors (not a degenerate hash always landing on the same value).
- **`services/studentPortalDataService.js`** — the Portal's sole data source, returning explicitly-labeled placeholder data (a single named `PLACEHOLDER_STUDENT` constant, not scattered mock values).
- **`ui/student-portal/StudentPortalShell.js`** — persistent navigation across the 5 required sections (Home/Achievements/Team/Learn/Profile), plus a small link back to the Bloom Labs landing page (the same real gap identified and fixed on the teacher side previously — it applies equally here).
- **Five section views** — Home (the 5 specified cards: My Stars, My Team, Recognition Wall, My Journey, Continue Learning), Achievements, Team, Learn (an honest "coming soon," since Learning Hub doesn't exist), and Profile (generated avatar, name, classroom, group, role — no photo upload anywhere).
- **A dedicated, self-contained CSS register** for the whole Portal — deliberately not reusing `.tracker-header`/`.dashboard-widget` or Classroom Tracker's color tokens, so nothing here looks like the same admin app wearing a different hat, matching "avoid admin dashboards and teacher terminology."
- **Router extended** — `#/student/{section}` sub-routes replace the old flat placeholder route; `#/student` alone defaults to Home.

### A real bug caught by testing, not by re-reading the code
The very first end-to-end test run failed immediately: `Identifier 'renderStudentProfileView' has already been declared`. Investigating found a genuine naming collision — Classroom Tracker already has its own `StudentProfileView.js` (a teacher looking at one student's profile from inside a classroom), a completely different screen from the new Student Portal's "my own profile" view, which happened to export a function with the exact same name. Fixed by aliasing the new import (`renderStudentPortalProfileView`) rather than renaming the existing, working Classroom Tracker file — the old one was correct as it stood; the new one was the thing that needed to adapt. Caught by actually running the app, not by reasoning about the code in isolation.

### The Student Portal's real data — still not wired, and why this spec doesn't change that
This phase's spec is thoughtful about avoiding one specific risk (photo storage) but doesn't address the deeper one: real student authentication plus a persistent, trackable Firestore record for an identifiable minor is itself what triggers India's DPDP Act's children's-data provisions (Section 9, requiring verifiable parental consent), which is what this project's own organizational data-handling rules require escalating to the AI Working Committee before proceeding. Nothing in this phase's implementation touches real authentication or real student records — every field shown anywhere in the Portal comes from the placeholder service, confirmed directly: `getCurrentStudentProfile()`, `getHomeSummary()`, `getAchievements()`, and `getTeamSummary()` are the *only* functions any Portal view calls for data, and none of them touch Firestore.

### Files Created
- `src/js/utils/avatarGenerator.js`
- `src/js/services/studentPortalDataService.js`
- `src/js/ui/student-portal/StudentPortalShell.js`
- `src/js/ui/student-portal/views/StudentHomeView.js`, `StudentAchievementsView.js`, `StudentTeamView.js`, `StudentLearnView.js`, `StudentProfileView.js`

### Files Modified
- `src/js/ui/router.js` — `#/student/{section}` sub-routing.
- `src/js/main.js` — new imports (one aliased to resolve the naming collision above); `studentPortal` route handling replacing the old flat placeholder dispatch.
- `src/js/ui/views/LandingView.js` — one stale comment reference updated.
- `src/css/styles.css` — the full Student Portal CSS block appended.

### Files Removed
- `src/js/ui/views/StudentPlaceholderView.js` — fully superseded by the real shell; confirmed via grep that nothing else referenced it before deleting.

### New Firestore Fields or Collections Introduced
**None.** This phase introduces no new Firestore reads, writes, fields, or collections — every Portal screen renders from the in-memory placeholder service only. (For context: the *previous* phase's Classroom ID / co-teacher joining feature did introduce a new `joinCodes/{code}` collection and a narrowly-scoped classroom `allow update` rule addition, both still pending the user's own review against a real Firestore project — unrelated to this phase's work, and unaffected by it.)

### Breaking Changes
None. A full regression pass confirmed every piece of existing Classroom Tracker functionality — Settings (Groups/Students/Notebooks/Teachers/Danger Zone), the Classroom ID display, notebook marking and Timeline (default weekly mode), Class Mode (award + Undo, icon-only buttons), the Recognition Screen, the accent color picker, and the Bloom Labs link — all work exactly as before, unaffected by anything added this phase.

### Regression Verification
The full Student Portal was tested end-to-end: default landing on Home with exactly 5 cards matching the spec's exact titles; Achievements/Team/Learn/Profile all render their placeholder content correctly; the Profile view's generated avatar shows the correct initials and a color that matches the same deterministic hash verified directly against the utility function; a direct deep link to `#/student/team` renders correctly without going through Home first; the Bloom Labs back-link works. Separately, a full Classroom Tracker regression (Settings, Teachers tab, Danger Zone, notebook marking, Class Mode, Recognition Screen, accent colors, the Bloom Labs link) confirmed zero impact on existing functionality.

### Architectural Decisions Made During Implementation
- **The avatar generator was placed at the platform level even though only the Student Portal explicitly asked for it** — Classroom Tracker already had three different ad-hoc "initials in a circle" implementations scattered across its own components; introducing a fourth, bespoke one for the Portal would have been the wrong call given "prefer reusable services and shared models over product-specific implementations." Consolidating all four into one shared implementation was considered but not done this phase, to keep this change small and focused — flagged as a real follow-up, not silently done partway.
- **The placeholder data service exists as a named, single-purpose file rather than inline mock values in each view** — specifically so there's exactly one place to change when real data wiring is eventually approved, rather than five views each needing their own update.
- **The Student Portal was NOT given its own theme/accent-color picker**, unlike the teacher app — that feature is explicitly a per-teacher preference (see its own CHANGELOG entry), and nothing in this phase's spec asked for a student-facing equivalent; adding one would have been scope creep beyond what was requested.

### Future TODOs
- Consolidate Classroom Tracker's three existing ad-hoc initials-in-a-circle implementations (`RecognitionCard.js`, `TeamCard`'s huddle avatars, `UserBar`'s fallback) onto the new shared `avatarGenerator.js`, now that it exists — not done this phase to keep this change focused on the Student Portal itself.
- Wire the Student Portal to real student data — blocked pending the AI Working Committee review described above; this is not a technical gap, it's a compliance gate.
- Have the previous phase's proposed `firestore.rules` changes (join codes, co-teacher self-add) reviewed and tested against a real Firestore project.
- (Carried over, unchanged): real Student Portal authentication; Learning Hub; role-based routing; Learning Bucket-tied Recognition avatars; Pending Tasks collapse-state persistence; downstream palette travel; Classroom Culture; Phase 7C polish; Phase 6B Workspace Personalization; theme-service file cleanup; all previously-listed items.

---

## Student Portal: First-Visit Classroom ID, Remembered Sessions, Join Another Classroom

**Context:** direct feedback that clicking into the Student Portal with a fresh session just showed the placeholder shell, when it should ask for a Classroom ID on first visit, remember it afterward, and let Profile offer joining a different classroom.

### What was built — the interaction pattern, on a client-only placeholder mechanism
- **`services/studentSessionService.js`** (new) — remembers, per browser via `localStorage`, which code a visitor entered. A separate, small module rather than reusing `storage/localStorageAdapter.js`, whose own doc comment states "nothing new is ever written here" (it's a one-time migration adapter) — respecting that file's stated contract rather than quietly overloading it for a genuinely different, ongoing purpose.
- **`ui/student-portal/views/StudentJoinCodeView.js`** (new) — the first-visit screen. Accepts any plausible, non-empty code (checked only for length, not looked up against real data) and stores it.
- **`main.js`** now gates the whole Student Portal on `studentSessionService.getJoinedCode()`: no stored code → the join screen; a stored code → the shell, exactly as before.
- **Profile's new "Join Another Classroom" button** clears the stored code and re-renders the current route, which naturally falls back to the join screen — then, after entering a new code, returns to wherever the visitor was (confirmed via testing: joining again from Profile lands back on Profile, not Home).

### The same boundary as before, applied to this specific mechanism
This does not look up the entered code against any real classroom. Whatever is typed is accepted, and the same placeholder dashboard renders regardless — a real teacher's actual Classroom ID would not "work" here any differently from a made-up one, because no real lookup exists. That's deliberate, not an oversight: building a genuine lookup against real classroom/student data is the same piece this project has held behind the AI Working Committee review throughout (see the Student Portal Foundation entry above for the full reasoning) — the DPDP trigger is real student authentication and a persistent, trackable identity, not the specific UI pattern of asking for a code. This phase builds and lets the *interaction pattern* be reviewed now, entirely separately from that still-pending decision.

### Files Created
- `src/js/services/studentSessionService.js`
- `src/js/ui/student-portal/views/StudentJoinCodeView.js`

### Files Modified
- `src/js/main.js` — first-visit gate added to the `studentPortal` route; Profile's join-another wiring.
- `src/js/ui/student-portal/views/StudentProfileView.js` — `onJoinAnotherClassroom` prop and button added.
- `src/css/styles.css` — join-code screen and profile button styling.

### New Firestore Fields or Collections Introduced
**None.** The remembered code lives only in this browser's `localStorage`, not Firestore — consistent with this being a client-side interaction pattern, not real classroom membership.

### Breaking Changes
None. Every existing Student Portal section and all of Classroom Tracker were re-verified working exactly as before.

### Regression Verification
Confirmed via a real, full page reload (not just in-app navigation) that a joined code persists correctly and skips straight to the shell on a fresh page load — the important test here, since an in-memory-only check wouldn't have proven the "remembered across visits" behavior actually works. Confirmed a too-short code shows an error and does not proceed; confirmed "Join Another Classroom" correctly returns to the join screen and, after entering a new code, lands back on the exact section the visitor was on (Profile), not a hardcoded default. All 5 Student Portal sections and a full separate Classroom Tracker pass (Settings, Class Mode) both confirmed unaffected.

### Future TODOs
- (Carried over, unchanged): Wire the Student Portal to real student data, pending the AI Working Committee review; consolidate Classroom Tracker's three ad-hoc avatar implementations onto the shared generator; have the proposed `firestore.rules` changes reviewed; real Student Portal authentication; Learning Hub; role-based routing; all previously-listed items.

---

## Class Session Architecture — Draft-Until-Save for Class Mode

**Context:** an architectural change to how Class Mode persists data, requested with an explicit "review first, explain, then implement" — reported symptom: accidental clicks were becoming permanent history, and undoing still left traces, because every interaction wrote to Firestore immediately.

### What was found in the current implementation, before any code was written
Traced every write path directly rather than assuming: `handleTap`, `handleSwipeLeft`, badge award (both paths), and bucket change in `TrackerView.js` each called `workspaceService.save(classroom)` immediately after mutating in-memory state — and critically, **so did `classModeService.undo()`'s caller**. This is the literal mechanism behind the reported bug: an accidental tap and its undo were two *separate* Firestore writes, with a real window between them where the mistake was live on the server, observable by anything else subscribed to that classroom, before the undo's write caught up. `NotebookRegisterView.js` had the same shape (400ms-debounced auto-save, no session concept). Also found: `noteService.addNote()` has no undo wired into `classModeService`'s stack at all — an existing, separate gap, named explicitly rather than silently folded into this work or silently left unmentioned.

### Architecture
- **`services/classSessionService.js`** (new) — a Class Session is in-memory only, per classroom, exactly like `classModeService`'s existing (already in-memory) undo stack sits alongside it. A session holds a simple action log (`{ type, at }`) used only for the Session Review's counts — it does not duplicate what the undo stack already tracks for reversal. Two terminal operations:
  - **`commitSession()`** — the single permanent write. Calls `workspaceService.save()` exactly once, then clears the undo stack and the session log.
  - **`discardSession()`** — re-fetches the classroom from Firestore (`getClassroomOnce()`, new) and overwrites the in-memory copy, throwing away every draft mutation at once. Chosen over trying to reverse each drafted action individually: since nothing was ever written, the server's copy is already correct — re-fetching it is simpler and can't drift from whatever the undo stack did or didn't track.
- **Every per-action `workspaceService.save()` call removed from `TrackerView.js`** — award star, deduct point, badge award (both paths), bucket change all still mutate in-memory state exactly as before (so the UI stays live), but now call `classSessionService.recordAction()` instead of saving. This directly satisfies "refactor so all permanent writes happen through a single session commit mechanism": previously 6 different call sites wrote to Firestore; now exactly one function does.
- **Undo no longer triggers a save** — since nothing is written until the session ends, there's no longer a race between an action's write and its undo's write to worry about; undo purely reverses in-memory state, exactly as `classModeService.undo()` already did.
- **`ui/components/SessionReview.js`** (new) — the screen shown by a new "End Class" button in Class Mode's header, matching the spec's exact layout (Stars Awarded / Behaviour Notes / Notebook Updates / Recognitions, then Continue Teaching / Save Session / Discard Session). Counts come from the session's in-memory action log, not Firestore.
- **`NotebookRegisterView.js`** — status changes now check `classSessionService.isSessionActive()`. If a session is active (Register reached mid-lesson via Class Mode's header), a change becomes a draft (recorded, no write). Outside an active session (marking notebooks independently, not mid-lesson), the existing immediate debounced auto-save is completely unchanged — confirmed via testing, not assumed.
- **Leaving Class Mode mid-session (the header's Back button) now warns first** if there are unsaved draft actions, and — if the teacher confirms leaving anyway — actually calls `discardSession()` rather than just navigating away. Without this, the shared in-memory classroom object (used by every other view, including the Dashboard) would keep showing unsaved draft state as if it had been saved, which would be actively misleading.

### How existing reports and history continue working
Unchanged, by design: the data shape written on commit (`student.history`, `student.score`, `student.badges`, notebook entries) is byte-for-byte identical to what immediate-write mode used to produce. Recognition Wall, streaks, and Weekly Snapshot read that data the same way regardless of whether it arrived via the old per-action write path or the new single-commit path — only *when* the write happens changed, never *what* gets written.

### A real bug caught mid-implementation, not assumed away
A scripted find-and-replace, wiring `NotebookRegisterView.js`'s two `debouncedSave(classroom)` call sites over to the new `saveOrRecordDraft()`, matched a third occurrence: the literal string inside `saveOrRecordDraft()`'s own function body, turning its `else` branch into infinite self-recursion. Caught immediately by grepping the result before moving on to testing — not something that would have been visible from reading the diff casually.

### Files Created
- `src/js/services/classSessionService.js`
- `src/js/ui/components/SessionReview.js`

### Files Modified
- `src/js/ui/views/TrackerView.js` — every per-action save removed; "End Class" button added; Back-button unsaved-changes warning added; module doc comment rewritten to describe the session model.
- `src/js/ui/views/NotebookRegisterView.js` — `saveOrRecordDraft()` added, session-aware.
- `src/js/repositories/classroomRepository.js`, `firestoreClassroomRepository.js` — `getClassroomOnce()` added.
- `src/js/services/workspaceService.js` — `reloadClassroomFromServer()` added.
- `src/css/styles.css` — Session Review screen styling.

### Breaking Changes
None to existing data or reports. Behavior changes only in *when* a permanent write happens during Class Mode — a teacher must now explicitly Save Session (or a notebook change must happen outside an active session) for anything to reach Firestore.

### Regression Verification
Using a real save-counter injected into the test harness's mock repository (not just checking the UI looks right): confirmed 3 stars + 1 swipe + 1 Undo produced **zero** Firestore writes against a baseline count; confirmed Save Session produced **exactly one** write; confirmed Discard Session produced **zero** writes and that reopening Class Mode afterward correctly showed the last-*saved* score, not the discarded draft — proving the re-fetch mechanism genuinely reverts to server state rather than just looking like it does. Separately confirmed notebook marking outside an active session still auto-saves immediately, unchanged. A full regression pass (Settings, Danger Zone, Recognition Screen, accent color picker, icon navigation) confirmed zero impact elsewhere.

### Architectural Decisions Made During Implementation
- **A dedicated session model was introduced rather than conditionals scattered through existing action handlers** — every action handler's own logic (award, deduct, badge, bucket) is completely unchanged; only the "what happens after" step (save vs. record) changed, and it changed in exactly one place per handler, not through an `if (session) ... else ...` sprinkled across the file.
- **Discard re-fetches rather than reverses** — reversing each drafted action individually would require the session log to track enough detail to undo *every* kind of action perfectly, duplicating logic `classModeService`'s undo stack already has for some of them and lacks for others (like notes). Re-fetching the known-correct server state sidesteps needing that parity at all.
- **The note-undo gap was named, not fixed and not hidden** — notes still have no undo in `classModeService`'s stack, a pre-existing limitation unrelated to this refactor; adding it would have been scope creep beyond what was asked.

### Future TODOs
- Consider adding undo support for notes to `classModeService`'s stack, closing the one remaining gap in Class Mode's action coverage.
- (Carried over, unchanged): Wire the Student Portal to real student data, pending AI Working Committee review; consolidate Classroom Tracker's ad-hoc avatar implementations; have the proposed `firestore.rules` changes reviewed; real Student Portal authentication; Learning Hub; role-based routing; all previously-listed items.

---

## Class Mode UX Refinement (Items 1-5) — Session Lock and Session History Not Yet Built

**Context:** moving from architecture to teacher-experience polish on top of the Class Session model from the previous phase. Eight items requested; this entry covers the five that build cleanly on the existing architecture without new data modeling. The remaining two — Session Lock and Session History — need a genuinely new permanent record shape and deserve focused treatment rather than being rushed alongside these; see Future TODOs.

### 1. Button renamed
"End Class" → **"Review Session"**, not "Finish & Review". Chosen to match this app's existing button-naming pattern (Save Session, Reset Session — verb + "Session", not a compound/ampersand phrase used nowhere else in this app's vocabulary) — the button was never claimed to end anything; it opens a review, and the new name says exactly that.

### 2. Unsaved Changes indicator
A small dot + "Unsaved Changes" label appears next to the Class Mode title the moment `classSessionService.getSessionSummary()` reports any draft actions, and disappears automatically once the session is saved or discarded (since that summary naturally reports zero afterward — no separate show/hide logic needed).

### 3. Session Review reorganized
Four icon-labeled stat cards in a 2×2 grid, in the requested order (⭐ Stars Awarded, 🏅 Recognitions, 📓 Notebook Updates, 📝 Behaviour Notes) — replacing the previous plain list of label/value rows.

### 4. Top Contributors
`classSessionService.recordAction()` now optionally takes the student the action belonged to, and a new `getTopContributors()` ranks by **star count specifically** — matching the spec's own example ("+4 Stars") rather than a blended "positive actions" score mixing stars and badges, which would be harder to explain at a glance. Ties use **dense ranking**: distinct star counts map to gold/silver/bronze in order regardless of how many students share a count, so a tie for 1st still gives out a silver to the next distinct count rather than skipping it — chosen because a small, three-spot display reads oddly with a medal missing. The section is hidden entirely when there are no positive actions, per the spec.

### 5. Unsaved Navigation Warning
- **In-app navigation** (the header's Back button): now opens `ui/components/UnsavedSessionDialog.js`, a proper 3-option modal (Continue Teaching / Discard & Leave / Save & Leave), replacing the previous 2-option `window.confirm()` — a plain confirm can't express three distinct outcomes.
- **Page refresh/tab close**: wired via `beforeunload` in `main.js`. Documented plainly, not glossed over: browsers do not allow custom dialog text or buttons here — this can only trigger the browser's own generic "leave site?" prompt, not the 3-option dialog. That's a platform limitation, not an implementation gap.
- **Switching classrooms**: covered by the same Back-button dialog, since leaving Class Mode via Back is the only path to reaching a different classroom from here — no separate check was needed.

### A real bug caught and fixed before it reached testing
Adding the draft indicator's `if` block left it unclosed for one edit — everything after it in the header (the action buttons, "Review Session," all of it) was silently nested inside that conditional, meaning the whole header would have vanished whenever there was no active draft. Caught by viewing the actual resulting file structure immediately after the edit, not by trusting that the syntax check alone (which passed, since the resulting nesting was still syntactically valid JS) meant the change was correct.

### Files Created
- `src/js/ui/components/UnsavedSessionDialog.js`

### Files Modified
- `src/js/services/classSessionService.js` — `recordAction()` now takes an optional student; `getTopContributors()` and `hasAnyUnsavedSession()` added.
- `src/js/ui/views/TrackerView.js` — button renamed; draft indicator added; Back button rewired to the 3-option dialog; all `recordAction()` calls updated to pass the student.
- `src/js/ui/components/SessionReview.js` — rebuilt around icon stat-cards and a Top Contributors section.
- `src/js/main.js` — `beforeunload` handler added.
- `src/css/styles.css` — draft indicator, stat-card grid, Top Contributors, and the dialog's stacked-button layout.

### Breaking Changes
None. All five items are additive UX on top of the unchanged Class Session architecture — no change to when or what gets written to Firestore.

### Regression Verification
Built a 3-student scenario (4/3/2 stars) specifically to test Top Contributors' ranking and medal assignment, not just that the section renders — confirmed the exact medal-to-count mapping matches the spec's own example precisely. Confirmed the indicator is absent with zero draft actions and appears correctly worded once any exist. Confirmed the 3-option dialog appears on Back with pending changes, and that both Save & Leave and Discard & Leave produce the correct persisted/reverted score afterward — re-verified by reopening Class Mode after each, not just trusting the dialog's own claim.

### A test-methodology issue worth naming, since it looked like an app bug at first
An early test run failed with a null bounding-box error when tapping a second and third student's row. Investigating found the cause was in the test script, not the app: Class Mode's view re-renders entirely on every tap, so a `page.$$()` element list captured before the first student's taps goes stale by the time the test tries to use it for the second student. Fixed by re-querying fresh before each tap rather than assuming the first query stayed valid — worth recording since it's exactly the kind of result that could be misread as a real regression without checking further.

### Future TODOs
- **Session Lock (10-minute reopen window)** and **Session History (a permanent Session record students' history entries reference)** — items 6 and 7 from this request — not built this phase. Both need a genuinely new data model (a permanent session record, timestamp-based lock logic that survives a refresh) rather than the UI-layer changes covered here, and deserve their own focused pass rather than being fit into whatever budget remained in this one.
- (Carried over, unchanged): note-undo gap in `classModeService`; Student Portal real-data wiring pending AI Working Committee review; consolidate avatar implementations; `firestore.rules` review; Learning Hub; role-based routing; all previously-listed items.

---

## Student Identity Architecture — StudentIdentityService, Provider/Consent Interfaces, Demo Implementations

**Context:** the finalized Bloom Labs authentication direction — Google Sign-In for parents, separated from student identity via a linking step (PIN or invitation link). Built in full on fixture data (`DemoIdentityProvider`, `DemoConsentProvider`, `DemoStudentLinkRepository`) per explicit agreement: production identity and real consent capture stay behind interfaces, unimplemented, so this is safe to build now without touching the still-open compliance question described in the Student Portal entries above.

### Architecture
- **`IdentityProvider`** (interface) — "who is this authenticated user," nothing more. `DemoIdentityProvider` simulates a parent's Google sign-in with a fixed demo identity. A production `GoogleIdentityProvider` (wrapping Firebase Auth, the same pattern `authService.js` already uses for teachers) is not part of this phase.
- **`ConsentProvider`** (interface, placeholder only, per explicit instruction) — `DemoConsentProvider` always answers "granted," instantly. Every linking call in `studentIdentityService.js` already checks through this interface — the check exists, it is just not load-bearing yet. Documented plainly, more than once, so `DemoConsentProvider`'s automatic approval is never mistaken for real consent capture.
- **`StudentLinkRepository`** (interface) — the persistence contract, documented against a real proposed Firestore model even though `DemoStudentLinkRepository` never touches Firestore:
  - `identityLinks/{providerUserId}` — the account-to-student mapping, keyed by provider user id (not classroom/student) so a sign-in resolves in one document read; `provider` stored per-link so Microsoft/SSO/OTP can write into the same collection later without a schema change.
  - A student's PIN lives on the *existing* student object inside its classroom document, not a parallel top-level `students` collection — reusing the current nested model, per Bloom Labs' stated data-reuse philosophy.
  - `invitationTokens/{token}` — its own small collection, same reasoning as the co-teacher join-code collection from an earlier phase: a token needs to be resolvable by someone not yet linked to anything, which a full classroom document can't safely allow.
- **`studentIdentityService.js`** — the only thing any Student Portal screen imports. Composes the three interfaces; swapping to production is changing three instantiations in this one file, nothing downstream.

### Two real bugs found through testing, not assumed correct
1. **Invitation links never actually worked as designed.** `main.js` read the token from `window.location.search` — the page's real, pre-`#` query string — but the invitation URL puts the token *inside* the hash fragment (`#/student?token=...`), which is a completely different, unrelated string in a hash-based router. Separately, `router.js`'s own path-splitting had no handling for a `?query` suffix at all, so `#/student?token=xxx` parsed as one broken path segment (`student?token=xxx`) instead of the path `student` plus a token param — meaning the route wasn't even recognized as the Student Portal, let alone carrying the token correctly. Both fixed together: `router.js` now splits off and parses a hash-embedded query string into `route.query` for every route (not just this one), and `main.js` reads `route.query.token` instead of the unrelated real query string.
2. **A parent clicking a second child's invitation link while already linked to a first child was silently ignored.** The onboarding flow checked "is a student already resolved" before checking "is there an invitation token to process," so an already-linked parent visiting a *new* invitation link just saw their existing child's Home screen, with the token never touched at all — exactly backwards for the multi-student requirement this whole feature is partly about. Fixed by processing a present invitation token first, always, before falling back to the already-resolved fast path.

Both were caught by testing the actual flow with a real Playwright browser, not by re-reading the code — the first surfaced as the invitation link routing to Classroom Tracker's own login screen instead of the Student Portal at all; the second surfaced as the "Who's learning today?" picker never appearing after a real navigation to a token URL, even though the exact same token/redemption logic worked correctly when exercised directly.

### Features Added
- **Onboarding flow** (`StudentOnboardingFlow.js`) — sign in → invitation token (if present) or PIN → multi-student picker (only if more than one student is linked) → done. Supersedes and replaces the earlier classroom-code + `localStorage` placeholder flow entirely (`StudentJoinCodeView.js`, `studentSessionService.js` — both removed, confirmed via grep that nothing else referenced them first).
- **"Who's learning today?" picker** and **Profile's "Switch Student"** — reuses the shared avatar generator, so a sibling's picker entry matches their own Profile avatar rather than a generic placeholder.
- **Teacher-side "Portal Access" section** (Student Profile, Overview tab) — Generate/Reset/Copy/Share for the Student PIN. Share builds a single-use, 7-day invitation link and uses the native share sheet (`navigator.share`) when available, falling back to clipboard copy.

### Files Created
- `src/js/services/identity/IdentityProvider.js`, `DemoIdentityProvider.js`, `ConsentProvider.js`, `DemoConsentProvider.js`
- `src/js/repositories/identity/StudentLinkRepository.js`, `DemoStudentLinkRepository.js`
- `src/js/services/studentIdentityService.js`
- `src/js/ui/student-portal/onboarding/StudentSignInView.js`, `StudentLinkView.js`, `StudentPickerView.js`, `StudentOnboardingFlow.js`

### Files Modified
- `src/js/ui/router.js` — hash-embedded query string parsing (`route.query`), needed correctly for any future route, not just this one.
- `src/js/main.js` — `studentPortal` route rewired to the new onboarding flow; token read from `route.query`.
- `src/js/ui/views/StudentProfileView.js` (teacher-side) — Portal Access / PIN management section added.
- `src/js/ui/student-portal/views/StudentProfileView.js` (Portal-side) — `onJoinAnotherClassroom` renamed to `onSwitchStudent`, button text updated.

### Files Removed
- `src/js/ui/student-portal/views/StudentJoinCodeView.js`, `src/js/services/studentSessionService.js` — superseded by the finalized Google + PIN/invitation-link direction.

### Breaking Changes
None to Classroom Tracker. The `router.js` change is additive (a new `query` field on every route object) and was specifically regression-tested against routes with multiple path parameters (Notebook Register's subject/type/date, Notebook Timeline's subject/type/yearMonth, Recognition Screen's period/category) to confirm the refactor didn't disturb existing multi-segment parsing.

### Regression Verification
Confirmed end-to-end with real browser navigation (not just service-level calls): sign-in, wrong-PIN rejection, correct-PIN linking, and — via a genuine full page reload — that linking is remembered. Confirmed invitation token generation, redemption, and that a second redemption attempt on the same token correctly fails (single-use). Confirmed the multi-student picker actually renders after a real navigation to an invitation link while already linked to a first student, that selecting a second student updates "last selected" correctly across another real reload, and that Profile's "Switch Student" reopens the picker. Confirmed the teacher-side Portal Access section renders without error with the correct PIN. A full Classroom Tracker regression (Settings, Teachers tab, notebook marking across multi-segment routes, Class Mode, Session Review, Recognition Screen with re-navigation across different params) confirmed zero impact elsewhere.

### Architectural Decisions Made During Implementation
- **The PIN is designed to live on the existing student object, not a new collection** — directly reusing Bloom Labs' stated data philosophy, and avoiding a parallel source of truth for "which students exist" that could drift from the classroom document Classroom Tracker already treats as authoritative.
- **`ConsentProvider` was still built as a real interface with real call sites, not a stub nobody calls** — every linking path in `studentIdentityService.js` already checks consent, so that a production `ConsentProvider` genuinely gates linking the moment it's implemented, rather than requiring new call sites to be added retroactively throughout the linking logic.
- **The invitation-token bug was fixed at the router level, not with a one-off parameter read in `main.js`** — a hash-based router needs to support query-like params in its fragment generally, not just for this one feature; fixing it once, generically, means the next feature that needs a URL parameter doesn't hit the same bug.

### Future TODOs
- Production `GoogleIdentityProvider` and a real `ConsentProvider` (disclosure + affirmative parent/guardian confirmation + stored consent record) — both remain gated behind the same compliance review described in the Student Portal Foundation entry above.
- (Carried over, unchanged): note-undo gap in `classModeService`; Session Lock and Session History from the Class Mode UX phase; consolidate avatar implementations; `firestore.rules` review; Learning Hub; role-based routing; all previously-listed items.

---

## Repository Restructure: `src/` Contents Moved to Repository Root

**Context:** direct question about whether `src/` or the repository root should be the canonical source. Investigated the actual constraint rather than answering abstractly: GitHub Pages only publishes from a repository's root or a `/docs` folder, not an arbitrary path like `/src` — meaning this repository, as structured, was not actually deployable to GitHub Pages regardless of which philosophy was preferred. Recommended moving the app to root over either a redirect page or renaming `src/` to `docs/` (which would have collided with the existing `docs/` folder already used for project documentation) — root avoids both a permanent indirection file and any naming collision.

### What Moved
`src/index.html`, `src/css/`, `src/js/`, `src/data/` all moved to the repository root, unchanged in content and internal structure — only their parent location changed. `index.html`'s own asset references (`css/styles.css`, `js/main.js`) were already relative paths, so they needed no edits at all; they continue to resolve correctly now that `css/` and `js/` are still direct siblings of `index.html`, just one level up.

### A Real, Easy-to-Miss Fix Caught During the Sweep
`.gitignore`'s entry for the real (never-committed) Firebase credentials file still read `src/js/config/firebaseConfig.js` — a stale path here wouldn't have caused a visible error anywhere, it would have silently stopped protecting the actual credentials file at its new location, `js/config/firebaseConfig.js`, from ever being accidentally committed. Fixed as part of this migration, not left for someone to discover only after it mattered.

### Every Reference Swept and Resolved
Searched the entire repository (HTML, CSS, JavaScript, JSON, Firestore rules, and every Markdown file) for the literal string `src/`. Confirmed no manifest or service worker files exist anywhere in this project. Fixed every genuine stale reference found:
- `README.md` — the project structure diagram's `src/` wrapper removed (files de-indented one level, tree connectors adjusted accordingly); both `firebaseConfig.js` path references fixed; the "serve locally" instructions updated to run from root (no more `cd src`), with explicit Live Server guidance added; a new "GitHub Pages deployment" section added, since this migration's entire purpose was making that possible and the README never mentioned deployment at all before now.
- `CONTRIBUTING.md` — both `src/js/...` references fixed (the credentials-file warning, and the "adding a new file" guidance).
- `tests/README.md` — the suggested test-mirroring path fixed.
- `js/config/firebaseConfig.example.js` — its own header comment's self-reference fixed.
- `.gitignore` — see above.

**`CHANGELOG.md`'s own extensive historical references to `src/js/...` and `src/css/...` were deliberately left untouched.** Those entries are an accurate record of what was true *at the time each change was made* — every one of them correctly describes a file that genuinely lived under `src/` when that entry was written. Rewriting them to reflect the post-migration path would make the changelog historically inaccurate, not more correct; this entry exists precisely to document the one point in time where that path changed, rather than retroactively erasing the fact that it ever existed.

### Regression Verification
Tested by serving the actual migrated repository root as a static site (not a simulated environment) and exercising every route category: the Landing page and bare root (`/`, with no `index.html` suffix — the same way GitHub Pages and Live Server actually serve a site), the Teacher flow end-to-end (sign-in, classroom creation, Settings, multi-segment routes like Notebook Register's subject/type/date and Recognition Screen's period/category), Class Mode through a full Session Review → Save cycle, and the Student Portal's identity flow (sign-in, PIN linking, and — via a genuine full page reload from the new root — that linking is still remembered correctly). Separately confirmed zero failed local asset requests across a full page load and navigation (the only failed request was the external Google Fonts CDN, expected and unrelated to this migration, since this sandboxed environment has no internet access).

### Files Changed
- Moved: `index.html`, `css/*`, `js/**/*`, `data/*` (from `src/` to repository root — contents unchanged, only location).
- Modified: `.gitignore`, `README.md`, `CONTRIBUTING.md`, `tests/README.md`, `js/config/firebaseConfig.example.js`.
- Removed: the now-empty `src/` directory.

### Breaking Changes
None to application behavior — every route, service, and component works identically to before, confirmed by the regression pass above. The only externally-visible change is that local development and any future GitHub Pages configuration now point at the repository root instead of `/src`.

### Future TODOs
- (Carried over, unchanged): note-undo gap in `classModeService`; Session Lock and Session History from the Class Mode UX phase; production `GoogleIdentityProvider`/`ConsentProvider` pending AI Working Committee review; consolidate avatar implementations; `firestore.rules` review; Learning Hub; role-based routing; all previously-listed items.

---

## Information Architecture: Separating "Running a Lesson" from "Managing the Classroom"

**Context:** Class Mode had accumulated tools for two genuinely different activities — teaching and administration — into one screen. Reviewed every current Class Mode action individually against a single test: would a teacher realistically press this with students in front of them? Full analysis, recommendations, and reasoning were presented before any code was touched, per explicit request not to simply preserve the current layout.

### The Review
- **Undo** — kept. Constant, in-the-moment correction; the clearest possible example of a teaching action.
- **Notebook Tracker** — kept, deliberately defended rather than cut by default. Walking the room marking notebooks during independent work is a real in-class rhythm, and the Class Session model already treats notebook updates as a draft category alongside stars and behaviour — this is the "demonstrated in-class use case" the brief asked to require before keeping anything administration-adjacent.
- **Reset Session** — kept, but demoted (moved after Notebook Tracker, away from Undo). Still a genuine live-teaching moment (zeroing scores for a new period's students standing in front of you *right now*), just a much rarer one than Undo, and shouldn't carry the same visual weight.
- **Settings** — removed entirely. Never a mid-lesson action; already fully reachable from the Classroom Dashboard.
- **Learning Activities** — removed entirely. Checking submission status is a grading/planning task done at a desk, not mid-lesson.
- **Back** — kept, renamed to **"Exit Class"** — not a removal, a reframing. "Back" implies undoing navigation; "Exit Class" names what's actually happening: stepping out of focused teaching mode.
- **Review Session** — unchanged. Already exactly the wrap-up gateway this architecture wants.

Timer and Class Notes (suggested as possible additions) were deliberately not built — neither has a demonstrated need in this app today, consistent with this project's standing discipline against building speculative features.

### Student Access — a placement recommendation that changed what was already built
Evaluated three options (buried in each student's Profile — the existing placement; a Dashboard section; a dedicated page) against the realistic first-use workflow: onboarding an entire class's parents in one sitting, not visiting 30 individual profile pages one at a time. Recommended, and built, a **dedicated Student Access page** reached from the Classroom Dashboard — the only option that matches the actual bulk workflow rather than optimizing for the wrong frequency.

### Teacher Access — evaluated, left unchanged
Considered relocating co-teacher invitation/PIN management out of Settings → Teachers, and concluded it shouldn't move. The volume here (a handful of co-teachers, not a full roster) and frequency (rare, not ongoing) don't create the same bulk-workflow mismatch Student Access had — the trade-offs that justified moving one don't apply to the other.

### Features Added
- **`ui/views/StudentAccessView.js`** (new) — lists every student with PIN/Generate/Reset/Copy/Share in one scannable page, reusing the exact same `studentIdentityService` functions the old per-profile section called — only *where* a teacher manages this changed, not how PINs or invitation links work.
- **A "Student Access" button** added to the Classroom Dashboard, alongside Settings.
- **`#/classroom/{id}/student-access`** route added.

### Files Modified
- `js/ui/views/TrackerView.js` — Settings and Learning Activities buttons removed entirely (with their now-unused `onSettings`/`onActivities` props); Reset Session reordered after Notebook Tracker; "Back" renamed to "Exit Class"; module doc comment rewritten to describe the new, deliberately narrow header and why.
- `js/ui/views/StudentProfileView.js` (teacher-side) — the per-student "Portal Access" section removed (consolidated into the new dedicated page, not duplicated); now-unused imports (`studentIdentityService`, `showToast`) removed.
- `js/ui/views/DashboardView.js` — `createStudentAccessButton()` added.
- `js/ui/router.js` — `student-access` route added.
- `js/main.js` — `studentAccess` added to `CLASSROOM_ROUTE_NAMES`; route dispatch and Dashboard wiring added; `tracker` route's now-unused `onSettings`/`onActivities` props removed.
- `css/styles.css` — `.student-access-list`/`.student-access-row` and its children.

### Breaking Changes
None to data or existing functionality — Settings and Learning Activities remain fully reachable, just from the Dashboard instead of Class Mode (where they were already reachable from, in parallel, before this change — nothing was made harder to find, only removed from a screen it didn't belong on).

### Regression Verification
Confirmed directly: Settings, Learning Activities, and Notebook Tracker are no longer present in Class Mode's header (checked for their absence, not just the presence of what remains); Undo, Notebook Tracker, and Reset Session are still present and functional; "Exit Class" appears where "Back" used to; the new Student Access page shows the correct PIN pulled from the same underlying service; a full regression pass (Settings' Groups/Students/Notebooks/Teachers tabs, Class Mode award/Undo/Notebook-navigation/Review/Save, Exit Class returning to the Dashboard, Recognition Screen) confirmed zero impact elsewhere.

### Architectural Decisions Made During Implementation
- **Notebook Tracker was defended, not just spared** — every other administration-adjacent tool was removed by default unless a real in-class use case justified keeping it; Notebook Tracker is the one case that met that bar, and the reasoning for why is recorded here rather than it just quietly surviving the cut.
- **Student Access was consolidated into one location, not duplicated across two** — keeping both the old per-profile section and the new bulk page would have created two places to manage the same PIN, with no guarantee they'd stay in sync in a future production implementation. One canonical location was chosen deliberately.

### Future TODOs
- (Carried over, unchanged): note-undo gap in `classModeService`; Session Lock and Session History from the Class Mode UX phase; production `GoogleIdentityProvider`/`ConsentProvider` pending AI Working Committee review; consolidate avatar implementations; `firestore.rules` review; Learning Hub; role-based routing; all previously-listed items.

---

## Teacher Workflow Reorganization (Phase 1: Notebook Date Navigation + Student Access) — Student Workspace Evaluation Included

**Context:** a request to organize Bloom Labs around four teacher intentions (prepare a classroom, teach a lesson, understand a student, review progress) rather than technical features, with an explicit evaluation required before any building. This entry covers the full evaluation plus two bounded, fully-implemented pieces; the Student Workspace expansion and the clickable-names audit are the larger, more open-ended pieces and are recorded honestly as not yet done — see Future TODOs.

### Evaluation: Student Workspace
**Verdict: yes, but as an expansion of the per-student profile that already exists, organized around genuine per-student questions — not a wholesale new concept, and not a blind adoption of every item in the proposed tab list.** The key distinction: several of the proposed tabs (Notebook Tracker, Recognition) aren't actually per-student concepts today — they're classroom-wide screens that happen to contain student data. Notebook Tracker answers *"which of my 30 students submitted today?"*; that stays put, reachable from Class Mode. *"Has this one student's notebook completion been consistent over time?"* is a different, genuinely per-student question, and belongs in the workspace as a **Notebook History** tab — same underlying data, different screen, because it's a different question. Recognition follows the identical split (the Wall stays classroom-wide; a per-student recognition history is new). Behaviour needs no new screen, just a filtered tab over existing timeline data. Learning Progress is a genuine gap — the computation exists, feeding aggregate displays, but no per-student view of it exists yet.

**Parent/Student Access — evaluated as a real tension, not smoothed over:** the previous phase moved Student Access *out* of the per-student profile specifically because bulk onboarding (30 parents in one sitting) was the realistic workflow, and per-profile access optimized for the wrong frequency. Re-adding it as a workspace tab isn't reversing that — it answers a different question (*"while I'm already looking at this student for another reason, what's their link status"* vs. *"which of my parents still need onboarding"*). Recommendation: keep the bulk page primary and discoverable; the workspace tab reads the same underlying data as a convenience view, not a second source of truth.

### Evaluation: Clickable Student Names — Two Genuine Exceptions
1. **Class Mode.** Explicitly listed as a place names should navigate to the Workspace — but a name there sits inside a row whose entire surface already has a job: tap to award a star. A second, competing meaning for the same text during live teaching is exactly the ambiguity the cognitive-load work has been removing. The existing long-press → Quick Actions → "Open Full Profile" remains the correct, *deliberately different* gesture for reaching the Workspace from here.
2. **Session Review's Top Contributors.** A transient decision screen (Save/Discard) — a clickable name inviting navigation away risks an accidentally abandoned review. Names here stay static.
Everywhere else, a name should behave identically — this audit itself is recorded as a Future TODO, not yet performed across every screen.

### Features Implemented — Notebook Date Navigation
Applied the identical clickable-date pattern to both `NotebookRegisterView.js` (a single day) and `NotebookTimelineView.js` (a week/month range), per the explicit instruction that inconsistent date-navigation between two screens of the same kind would be exactly the one-off-interaction problem being asked to eliminate. A native `<input type="date">` is layered invisibly (via absolute positioning) directly over the existing formatted text ("24 Jul 2026" / "13 Jul – 19 Jul 2026"), so the custom display is unchanged but the whole label is now clickable, opening the browser's own native date picker — chosen over a custom calendar widget specifically because it's the most intuitive interaction *by construction*: every phone and browser already teaches this exact affordance. Previous/Next are untouched on either side, confirmed still functional after a picker-driven jump, not just before it.

### Features Implemented — Student Access Reorganized Around Connection Status
Reordered the page to lead with **connection status** (✅ Linked / ⏳ Not Linked) rather than the PIN, per the explicit framing that this should feel like an onboarding dashboard, not a credential manager. Not-yet-linked students surface "Share Invitation" as the primary action — the actual bottleneck a teacher is trying to clear — with PIN/Generate/Reset tucked behind an expandable "PIN" toggle. Already-linked students get a single, low-key "Manage" action instead. Rows are sorted with not-yet-linked students first, since those are the ones needing attention. Required a genuinely new capability, not just a UI reorder: `isStudentLinked()` added to the `StudentLinkRepository` interface and its demo implementation — the reverse direction of the existing `getLinkedStudents()` (which is keyed by provider/parent, not by student), needed to answer "is anyone linked to *this* student" at all.

### A Real Bug Caught and Fixed
Adding `isStudentLinked()` to `studentIdentityService.js` resulted in the function being defined **twice** in the same file (two near-identical versions with slightly different doc comments), which is a hard syntax error in JavaScript — `Identifier 'isStudentLinked' has already been declared`. This broke the entire application on load, not just the new feature; caught immediately by actually loading the app in a real browser (the landing page itself failed to render), not by a syntax checker alone, since the duplicate declaration is syntactically valid JavaScript in isolation and would not have been caught by `node --check` running on a diff in isolation — it surfaced specifically because the *whole file* was checked and loaded end-to-end.

### Files Modified
- `js/ui/views/NotebookRegisterView.js`, `NotebookTimelineView.js` — clickable date label added to both, Previous/Next unchanged.
- `js/ui/views/StudentAccessView.js` — rewritten around connection-status-first rows with expandable PIN details.
- `js/repositories/identity/StudentLinkRepository.js`, `DemoStudentLinkRepository.js` — `isStudentLinked()` added.
- `js/services/studentIdentityService.js` — `isStudentLinked()` exposed (duplicate declaration found and fixed during testing).
- `css/styles.css` — the shared date-label-overlay pattern; Student Access's new row/status/details structure.

### Breaking Changes
None. Every existing date-navigation button, PIN, and invitation-link action still works exactly as before — confirmed directly, including that Previous/Next continue to function correctly *after* a picker-driven date jump, not just independently of it.

### Regression Verification
Confirmed the Register's date picker jumps to an arbitrary selected date and that Previous Day still functions afterward from the new position. Confirmed the Timeline's picker jumps to the week containing an arbitrary selected date and that Previous Week still functions afterward. Confirmed Student Access shows "Not Linked" by default for an unlinked student, that "Share Invitation" (not the PIN) is the primary visible action, that PIN details are hidden until explicitly expanded, and that expanding reveals the correct PIN. A full regression pass (Settings, Class Mode through Session Review and Save, Exit Class, Recognition Screen) confirmed zero impact elsewhere.

### Architectural Decisions Made During Implementation
- **The overlay-input technique was chosen over replacing the label with a native date input outright** — a bare native date input can't be styled to show custom text like "24 Jul 2026"; overlaying an invisible one preserves the exact existing visual design while gaining the native picker's interaction for free.
- **`isStudentLinked()` was added as a genuinely new repository method, not inferred from existing data client-side** — reverse-lookup ("who is linked to this student") is a fundamentally different query shape than the existing forward-lookup ("which students is this provider linked to"), and a production implementation would likely need its own index for exactly the same reason; modeling that distinction now avoids awkwardly retrofitting it later.

### Future TODOs
- Student Workspace tab expansion (Notebook History, Recognition History, Behaviour, Learning Progress, and the Parent/Student Access convenience tab) — evaluated and recommended above, not yet built.
- Clickable-student-names audit across Notebook Tracker, Recognition, Reports, and Timeline, applying the two identified exceptions (Class Mode, Session Review) consistently everywhere else.
- (Carried over, unchanged): note-undo gap in `classModeService`; Session Lock and Session History from the Class Mode UX phase; production `GoogleIdentityProvider`/`ConsentProvider` pending AI Working Committee review; consolidate avatar implementations; `firestore.rules` review; Learning Hub; role-based routing; all previously-listed items.

---

## Path Audit: GitHub Pages Blank Page After the `index.html` Relocation

**Context:** a direct production bug report — the live deployment at `https://bloomlabs-edu.github.io/classroom-tracker/` (a project-site subpath, not domain root — an important detail, since absolute `/`-prefixed paths behave differently there than at root) went blank on both desktop and Android after the earlier `src/` → root migration.

### What was audited, and confirmed clean
- **`index.html`'s own `<script>`/`<link>` tags** — both relative (`css/styles.css`, `js/main.js`), correct regardless of subpath.
- **Every JavaScript import statement** — verified programmatically, not by spot-checking: a script parsed and resolved all 275 relative import paths across the entire `js/` tree against the actual file system. All resolved correctly except one, addressed below.
- **`fetch()` calls** — none exist anywhere in this application.
- **CSS `url()` references** — none exist in `styles.css`.
- **Absolute (`/`-prefixed) paths** — none found anywhere in application code.
- **URL construction from `window.location`** — the one place a full URL is built (Student Access's invitation link) correctly uses `window.location.pathname` dynamically, which will correctly include `/classroom-tracker/` when actually served there, rather than a hardcoded root assumption.

**The application's own code is not the source of this bug.**

### The most likely real cause — outside this project's own visibility
The one broken import the audit script found was `js/services/firebaseApp.js` → `js/config/firebaseConfig.js`, which doesn't exist in this environment — expected and correct, since that file holds real Firebase credentials, is gitignored, and has never been visible to or included in anything generated here. But this points directly at the likely real cause: **`firebaseConfig.js` is gitignored, so relocating the rest of the app (via `git mv` or a script) never moved that file — it may still be sitting at the old `src/js/config/firebaseConfig.js` path.** Since ES module imports fail atomically, one missing file anywhere in the graph — Firebase config included — blanks the entire application with no visible error, which matches the reported symptom exactly. This is not something any code change from this project could have caused or can fix directly; it depends on the actual deployment's own file layout, which is outside what's visible from here.

A second, equally plausible and equally external cause: the repository's own **Settings → Pages** source configuration may still point at the pre-migration location (a `/docs` folder, or the now-removed `/src`) rather than root (`/`) of the branch being published — a GitHub configuration setting, not an application code path.

### A Defensive Fix Made Regardless
Added a `.nojekyll` file at the repository root — GitHub Pages runs pushed content through Jekyll by default; this file disables that entirely, removing it as a variable for a plain static/JS site like this one, even without certainty it was the specific cause here. Standard practice, worth having regardless of whether it was the actual trigger.

### Files Modified
- `.nojekyll` (new, empty file).
- `README.md` — deployment section extended with the `.nojekyll` note and an explicit warning about gitignored-file relocation when moving this app's structure in a fork, so this exact class of bug is documented for next time rather than only fixed once.

### Regression Verification
Full syntax check across every JavaScript file confirmed no impact from adding `.nojekyll` (an inert file with no application logic implications).

### What This Entry Deliberately Does Not Claim
This audit found and ruled out everything within this project's own code and file structure. It could not directly confirm or rule out the two most likely remaining causes (a stray gitignored credentials file at the old path; a GitHub Pages source setting still pointing at the pre-migration location), since both depend on the real, live deployment's actual state, which isn't visible from this environment. Both are named specifically, with concrete verification steps, rather than left as vague possibilities.

### Future TODOs
- (Carried over, unchanged): Student Workspace tab expansion; clickable-student-names audit; note-undo gap in `classModeService`; Session Lock and Session History; production `GoogleIdentityProvider`/`ConsentProvider` pending AI Working Committee review; consolidate avatar implementations; `firestore.rules` review; Learning Hub; role-based routing; all previously-listed items.

---

## Mobile Compatibility Audit: Android Chrome White Screen

**Context:** the application loads correctly on desktop but shows a white screen on Chrome for Android, surviving a full site-data clear. A systematic audit for desktop-only or Android-inconsistent API usage, plus a global startup error handler and a fix to the one genuine issue found.

### 1–2. API Audit — Searched, Nothing Found in Startup-Critical Code
Searched the entire codebase for `navigator.share`, `navigator.clipboard`, `visualViewport`, `matchMedia`, `showOpenFilePicker`, `ResizeObserver`, `serviceWorker`, and `crypto`. Findings:
- `navigator.share`/`navigator.clipboard` (Student Access, Settings' join-code copy) — all inside click handlers, never called at startup. Not the cause.
- `window.matchMedia` — used only in `services/themeService.js`, confirmed genuinely dead code: not imported by `main.js` or reachable from anywhere in the app (only referenced in a code comment elsewhere). Never executes.
- `showOpenFilePicker`, `ResizeObserver`, `serviceWorker` — none exist anywhere in this codebase.
- `crypto.randomUUID()` (`utils/idGenerator.js`) — already defensively feature-detected with a fallback for environments where it's unavailable; not a risk.

**None of the explicitly-named APIs are the cause.** The actual issue was in Firebase's own initialization, not any of the listed browser APIs.

### The Genuine Issue: Unprotected `initializeFirestore()` with Persistent Cache
`repositories/firestoreClassroomRepository.js`'s `_getDb()` calls `initializeFirestore()` with `persistentLocalCache()` + `persistentMultipleTabManager()` — a real, documented source of a **synchronous throw** when IndexedDB isn't fully available to the page, which happens on Android Chrome under several genuine, common conditions: Incognito/Private mode, restricted site-storage settings, and — matching the reported reproduction steps specifically — immediately after clearing site data, before storage permission for the origin is freshly re-established. This call had zero exception handling around it anywhere.

**Fixed**: wrapped in try/catch, falling back to a plain, non-persistent Firestore instance if persistent-cache initialization fails for any reason. The app now degrades to no-offline-cache rather than not working at all. Verified the exact try/catch/fallback logic pattern in isolation (a controllable stand-in for `initializeFirestore` that throws on the first call, confirming the fallback path executes and returns a usable result) — the real Firebase SDK can't be invoked outside an actual browser in this environment, so the pattern's correctness was verified structurally rather than against the live SDK.

### 3–4. Global Startup Error Handler — Added and Proven to Work
Added `window.onerror` and `window.onunhandledrejection` handlers as an inline script in `index.html`, registered *before* the module script tag — so they catch a failure even in an imported module's own top-level code, not just inside `main.js`'s own body. Renders a visible on-page banner rather than only logging to console, since most people testing this app on a phone have no easy way to open devtools there.

**Directly verified this works**, not assumed: triggered both a genuine uncaught `throw` and a genuine unhandled promise rejection in a real browser and confirmed the banner appears correctly with the actual error detail in both cases.

### An Important, Honest Nuance Found During Testing
Testing revealed something worth being precise about rather than glossing over: `services/workspaceService.js`'s `initForUser()` is an `async` function, and it calls the repository's `subscribeToClassroomRefs()` synchronously within its own body. A synchronous throw from inside an `async` function is automatically converted into a rejected promise — meaning if `_getDb()`'s exception originates from *this specific* call path, it would already be caught by the existing `.catch()` in `main.js` (which shows a `window.alert()` and continues rendering), not produce a silent white screen. This was confirmed directly by simulating the exact throw at that exact call site.

This doesn't mean the fix is unnecessary — an unprotected exception path is still a real defect regardless of what currently happens to catch it downstream, and `window.alert()` itself is not a fully reliable UI on all mobile browser configurations either. But it means the specific claim "this exact line is definitely what produces the white screen you're seeing" cannot be stated with complete certainty from static analysis and simulation alone — only that this is a real, unprotected, Android-relevant failure mode that is now fixed either way, and that the new global error handler will make the *actual* culprit visible on the device itself the next time this reproduces, if it turns out to be something else entirely.

### Answering Point 5 Directly
The most likely single code path: sign-in resolves → `main.js` calls `workspaceService.initForUser()` → its first synchronous action is `repository.subscribeToClassroomRefs()` → which calls `_getDb()` → which previously called unprotected `initializeFirestore()` with persistent cache → throws on Android under the storage conditions described above. Given the async-wrapping nuance above, this most likely surfaced as an alert dialog rather than a literal blank screen in earlier testing — but the exact conditions on a real Android device (particular Chrome version, storage state, other extensions/policies) can differ from what's reproducible in this sandboxed environment, and the fix removes the failure mode regardless of exactly how it was previously manifesting.

### Files Modified
- `js/repositories/firestoreClassroomRepository.js` — `_getDb()` wrapped in try/catch with a non-persistent fallback.
- `index.html` — global `window.onerror`/`window.onunhandledrejection` handlers added, rendering a visible on-page error banner.

### Breaking Changes
None. On any browser where persistent cache initializes successfully (the common case), behavior is completely unchanged. Only environments where it would have previously thrown now get a working app with offline caching disabled for that session, instead of a non-working app.

### Regression Verification
Full syntax check confirmed no impact from either change. The fallback logic pattern was verified in isolation against a controllable stand-in that reproduces the documented failure. The global error handler was verified directly against both a genuine uncaught exception and a genuine unhandled rejection, in a real browser, with the banner correctly appearing and displaying real error detail in both cases.

### Future TODOs
- If the white screen recurs after this fix, the new visible error banner should now show the actual underlying error directly on the affected Android device — the single most useful next diagnostic step, since it removes the need to reproduce the issue on a machine with devtools access at all.
- (Carried over, unchanged): Student Workspace tab expansion; clickable-student-names audit; note-undo gap in `classModeService`; Session Lock and Session History; production `GoogleIdentityProvider`/`ConsentProvider` pending AI Working Committee review; consolidate avatar implementations; `firestore.rules` review; Learning Hub; role-based routing; all previously-listed items.

---

## Mobile Loading Follow-Up: Non-Blocking Font Load, and a False Alarm Correctly Walked Back

**Context:** direct follow-up that the app is still not loading on the reporting device after the previous Firestore-persistence fix and global error handler.

### A Different-Category Issue Found: Render-Blocking Third-Party Font Request
`index.html`'s Google Fonts stylesheet was a plain `<link rel="stylesheet">` to a third-party domain, sitting in `<head>` before the app's own CSS — render-blocking by default. If that specific request is slow, blocked, or unreachable on a given network (school/institutional WiFi filtering third-party font CDNs is common, and this specific failure mode wouldn't show up in typical desktop testing on an unrestricted network), the page can sit blank for a long time — or indefinitely — before any of the app's own CSS or JavaScript ever gets a chance to run. This is a meaningfully different failure category from the previous fix: since nothing has executed yet, even the newly-added global error handler couldn't have caught or revealed this one.

**Fixed**: the font request now loads via `rel="preload"`, swapping to an active stylesheet once it actually resolves, with a `<noscript>` fallback for the rare case JavaScript is disabled. The rest of the page — including the app's own CSS and JS — now renders immediately regardless of what happens to that one external request. Confirmed a sensible system-font fallback stack already exists in `styles.css` (`'Open Sans', -apple-system, BlinkMacSystemFont, sans-serif`), so the app remains fully legible even if the custom font never loads at all.

### A Suspected Bug, Investigated and Correctly Ruled Out
While testing on a simulated mobile viewport — the first time this project's testing has used an actual mobile-width viewport rather than a 1280px desktop one, a real blind spot in this project's own test coverage up to now — a Playwright test failed with "element intercepts pointer events" when clicking the Dashboard's Settings button, appearing to suggest an overlapping-buttons layout bug. Investigated with precise bounding-box measurements rather than accepting the surface-level test failure at face value: every button in that section is cleanly stacked with a consistent 12px gap, no geometric overlap anywhere. The test failure was Playwright's own mobile-touch-emulation flakiness with scrolling, not a real defect in the application. Recorded here specifically because it would have been easy to report a bug that doesn't actually exist off the back of one failed test run — the correction matters as much as the original finding would have.

### Files Modified
- `index.html` — Google Fonts request converted from render-blocking to non-blocking (`rel="preload"` + swap-on-load + `<noscript>` fallback).

### Breaking Changes
None. Visual result is identical once the font loads; the only change is that it no longer has the ability to block the rest of the page's first render.

### Regression Verification
Confirmed the landing page renders in just over 1 second on a simulated mobile viewport (393×851, touch-enabled) with zero errors. Ran a full regression pass on that same mobile viewport — teacher sign-in, classroom creation, Settings, and Class Mode's tap-to-award — all confirmed working, with no startup error banner appearing at any point.

### What Remains Genuinely Uncertain
Without new diagnostic information from the actual affected device, it isn't yet possible to confirm which of the fixes so far (the Firestore persistence fallback, the font-loading fix, or something not yet found) was the actual cause on that specific phone — or whether more than one contributed. The most useful next step is checking whether the previously-added visible error banner now appears on that device: if the page still shows nothing at all with no banner, that points toward something failing before any JavaScript runs (like the font issue just fixed, or a similar render-blocking resource); if the banner *does* appear, its content will name the actual remaining cause directly, without needing to reproduce the issue anywhere else.

### Future TODOs
- Establish mobile-viewport testing (e.g., 390–430px width, touch-enabled) as a standard part of this project's own regression passes going forward, not an occasional afterthought — this phase's false alarm and the font-loading fix were both only found by testing at a real mobile width for the first time.
- (Carried over, unchanged): Student Workspace tab expansion; clickable-student-names audit; note-undo gap in `classModeService`; Session Lock and Session History; production `GoogleIdentityProvider`/`ConsentProvider` pending AI Working Committee review; consolidate avatar implementations; `firestore.rules` review; Learning Hub; role-based routing; all previously-listed items.

---

## Full Import-Graph Audit for Android Chrome Compatibility

**Context:** direct follow-up — the startup error banner itself never appears on the affected Android device, which is the critical clue: whatever's failing bypasses `window.onerror`/`unhandledrejection` entirely, a category confirmed empirically in the previous phase (a broken static import doesn't reliably trigger those handlers either).

### The Audit
Traced the complete import graph from `main.js` programmatically — **126 files** — and checked every one for:
- Modern syntax that could be unsupported on an older engine: private class fields (`#x`), logical assignment operators (`??=`/`||=`/`&&=`), static initialization blocks, top-level `await`. None found.
- Recently-added APIs: `Array.prototype.at()`, `Object.hasOwn()`, `structuredClone()`, `String.prototype.replaceAll()`, `Array.prototype.group`/`groupBy`. None found.
- Every module-scope class instantiation (`new X()` sitting directly in a file's top level, which runs the instant that file is imported, not when some later function is called) — found three, in `studentIdentityService.js` (confirmed this file is eagerly imported by `main.js`, so its top-level code runs on *every* page load regardless of route). Checked all three constructors directly: all trivial (field initialization only, no browser API access).
- Every top-level bare function call across all 126 files — only safe `Object.freeze()` (ES5, universal) and one safe closure factory (`createDebouncedFunction`, which only returns a closure, never calls anything itself until later).
- Every top-level `document`/`window` access — only the single, standard `DOMContentLoaded` listener registration in `main.js`.
- Dynamic `import()` calls anywhere in application code — none exist.

**The application's own code is clean.** Nothing in it depends on syntax or APIs that would behave differently on Android Chrome versus desktop.

### The One Category the Code Audit Can't Rule Out — Addressed Regardless
A banner that never appears at all, on an otherwise-blank page, is also consistent with a browser that doesn't support ES modules (`<script type="module">`) at all — an older WebView-based browser, or certain Chrome-based browsers with incomplete module support. Such a browser wouldn't throw an error on the module script tag; per the HTML specification, it silently skips it entirely. Nothing ever executes, so there is nothing for any error handler — including the one added last phase — to ever catch. This fits the exact reported symptom precisely, and it's specifically the one thing a source-code audit can't confirm or rule out, since it's about whether the script tag runs at all, not what's inside it.

**Added a `<script nomodule>` fallback** — the standard, spec-defined inverse of `type="module"`: it only executes in a browser that doesn't support modules at all. Renders a clear, visible message explaining the browser can't run this app, instead of a silent blank page. Confirmed this doesn't interfere with normal operation: in any module-supporting browser (which is what actually matters day to day), the `nomodule` script is correctly ignored entirely and the app loads exactly as before.

### Files Modified
- `index.html` — `<script nomodule>` fallback added.

### Breaking Changes
None. Confirmed directly: the app renders identically to before in a module-supporting browser; the new script only activates in the one scenario it's designed for.

### Regression Verification
Full syntax check across all 126 files in the import graph. Confirmed the landing page still renders normally with zero errors and no error banner in a standard module-supporting browser (the `nomodule` fallback correctly stays inert).

### Where This Leaves Things
Between this phase and the previous one, three distinct, real failure categories have now been addressed: an unprotected Firestore persistence exception, a render-blocking third-party font request, and a browser with no module support at all. If the white screen persists after this fix, the most useful remaining signal is whether the new `nomodule` message appears (confirming the module-support theory directly) or whether the page is still fully blank with neither that message nor the error banner from before — which would suggest a failure category not yet identified, and would benefit most from actual browser/version information from the affected device (Chrome version, whether it's a WebView-embedded browser rather than standalone Chrome, and any enterprise/school device management policies that might restrict script execution).

### Future TODOs
- (Carried over, unchanged): mobile-viewport testing as standard practice; Student Workspace tab expansion; clickable-student-names audit; note-undo gap in `classModeService`; Session Lock and Session History; production `GoogleIdentityProvider`/`ConsentProvider` pending AI Working Committee review; consolidate avatar implementations; `firestore.rules` review; Learning Hub; role-based routing; all previously-listed items.

---

## Temporary Startup Diagnostics: Full Bootstrap try/catch with On-Screen Error, Stack, and User Agent

**Context:** direct follow-up request to add explicit temporary diagnostics — the entire application bootstrap wrapped in try/catch, replacing the page with the error message, stack trace, and browser user agent on any startup failure, so the affected Android device can report exactly what's happening without needing DevTools access.

### Implementation
`main.js`'s `init()` function is now wrapped in an explicit try/catch, and — since the app's first real render happens inside the asynchronous auth-state callback, not in `init()`'s own synchronous body — that callback is wrapped in its own nested try/catch too, so "before the UI renders" is covered across both the synchronous setup phase and the first async callback. On any caught error, `showFatalStartupError()` replaces the entire page body (not an overlay) with the error message, full stack trace, and `navigator.userAgent`, clearly formatted and readable directly on the device.

Marked explicitly as **TEMPORARY** in its own doc comment, per the framing of the request — this is a diagnostic tool for chasing down the specific Android issue, not intended as permanent application behavior, and should be removed once the underlying cause is found.

### A Real Nuance Found and Verified During Testing, Not Assumed
Testing this directly (not just reading the code) surfaced the same async/promise nuance found in an earlier phase, worth being precise about again: a failure inside `workspaceService.initForUser()` (an `async` function) becomes a promise rejection, already intercepted by its own existing `.catch()` — my new synchronous try/catch correctly does not (and structurally cannot) intercept that one. Similarly, a failure inside the auth callback's `.then()` chain (not directly awaited) becomes an *unhandled* rejection, which the new inner try/catch also correctly does not catch — but confirmed directly that the `window.unhandledrejection` handler added in an earlier phase catches it instead. The two layers are complementary by construction, each catching a different failure shape, and this was proven by deliberately triggering each category and observing which handler actually fired — not assumed from the code alone.

### A Gap Found and Closed for Consistency
The earlier `index.html`-level banner (from the previous phase's global error handler) did not include `navigator.userAgent`, only the error message and detail. Since this request explicitly wants user agent in every startup failure report regardless of which layer catches it, added it there too — confirmed directly afterward that both the new `main.js` diagnostic page and the existing `index.html` banner now include it.

### Files Modified
- `js/main.js` — `init()` wrapped in try/catch; the auth-state callback wrapped in its own nested try/catch; `showFatalStartupError()` and `escapeHtml()` added.
- `index.html` — `navigator.userAgent` added to the existing `showStartupError()` banner, for consistency across both diagnostic layers.

### Breaking Changes
None. Confirmed directly: normal sign-in, classroom creation, and navigation all proceed exactly as before when no error occurs — the try/catch adds no behavior in the successful path, only on failure.

### Regression Verification
Confirmed normal operation (landing page, teacher sign-in) is completely unaffected. Confirmed a genuine synchronous throw within `init()`'s wrapped scope produces the full diagnostic page with the correct error message, stack trace, and a real Android/Chrome user agent string set on the test browser. Confirmed a failure inside the async auth-callback chain is correctly handled by the complementary `unhandledrejection` layer instead, with user agent now present there too.

### Future TODOs
- **Remove this diagnostic once the Android white-screen cause is confirmed** — it's deliberately temporary, not meant to ship indefinitely as user-facing behavior.
- (Carried over, unchanged): mobile-viewport testing as standard practice; Student Workspace tab expansion; clickable-student-names audit; note-undo gap in `classModeService`; Session Lock and Session History; production `GoogleIdentityProvider`/`ConsentProvider` pending AI Working Committee review; consolidate avatar implementations; `firestore.rules` review; Learning Hub; role-based routing; all previously-listed items.

---

## Classroom Dashboard Onboarding: Reordered Information Architecture + First-Time Setup Card

**Context:** direct observation that new fellows' actual workflow (add students → invite parents/generate PINs → only then reports/settings) didn't match the Dashboard's previous section order (Groups, Reports, Student Access, Settings), burying the thing a brand-new classroom needs first behind a section useful only once there's real data.

### Components Identified Before Changing Anything, Per the Explicit Request
- `ui/components/ClassroomSection.js` — the shared, generic layout wrapper for this whole grouping. Confirmed it does nothing but iterate whatever `children` array it's given, in order — genuinely reusable, no hardcoded section list, so reordering or inserting a new child requires zero changes to this file.
- `ui/components/GroupsWidget.js` — Groups' own dedicated component.
- `createReportsPlaceholder()`, `createStudentAccessButton()`, `createSettingsButton()` — local helper functions living inside `DashboardView.js` itself, not separate component files. The new onboarding card follows this exact same established convention (a local helper, not a new file) rather than introducing a new pattern for one small addition.

### Changes
- **Reordered** to Groups → (onboarding card, conditional) → Student Access → Reports → Settings, exactly as specified. This required touching only the `children` array passed into the existing `createClassroomSectionElement()` call — no changes to `ClassroomSection.js` itself.
- **First-time onboarding card** — shown only while a classroom has zero linked students, hidden automatically once at least one family connects. Matches the requested copy and structure exactly (🎉 title, "Next step" framing, a button straight to Student Access).
- **`hasAnyLinkedStudent(classroom)`** added to `studentIdentityService.js` — reuses the existing `isStudentLinked()` per student rather than duplicating its logic against the repository directly, per the explicit "avoid duplicate code" instruction.
- **`renderDashboardView` made `async`** — needed to check link status before deciding whether to build the card, avoiding a render-then-patch flicker. Confirmed there's exactly one call site (`main.js`, fire-and-forget, matching the exact precedent already established for `StudentAccessView.js` in an earlier phase) — no other code depends on this function completing synchronously.
- **Visual design reused, not reinvented**: the card uses the same surface/shadow/radius tokens as every other Dashboard card, plus the same accent-border treatment already used by `.recognition-card`, rather than introducing a new visual pattern.

### A Real Limitation Worth Being Upfront About
The demo fixture roster (used for Student Portal linking throughout this project) has fixed student IDs, entirely separate from the fresh, randomly-generated IDs any real classroom's students get when created through the normal Dashboard flow. This means a newly created classroom's students can never actually match the fixture roster, so the onboarding card cannot be driven to its "hidden" state through a full end-to-end demo click-through — that's an inherent property of the fixture system, not a bug in this feature. Verified the "hides once linked" behavior instead at the service level directly: confirmed `hasAnyLinkedStudent()` correctly returns `true` for the fixture roster's own classroom ID after a real PIN-linking flow completes.

### Files Modified
- `js/ui/views/DashboardView.js` — reordered section, `createOnboardingCard()` added, made async.
- `js/services/studentIdentityService.js` — `hasAnyLinkedStudent()` added.
- `css/styles.css` — `.onboarding-card` and its children.

### Breaking Changes
None. Confirmed directly: the onboarding card's own "Open Student Access" button and the separate persistent "Student Access" button both navigate to the identical destination; Settings and the (still-disabled) Reports placeholder are unaffected.

### Regression Verification
Confirmed the exact section order via direct DOM inspection (not text-matching heuristics, which initially targeted the wrong section since `TeachingSection.js` shares a CSS class name with `ClassroomSection.js` — caught and corrected before trusting the result). Confirmed the card renders for a brand-new classroom, confirmed both paths to Student Access work identically, confirmed Settings and Reports are unaffected, and confirmed the card fits correctly within a 393px mobile viewport.

### Future TODOs
- (Carried over, unchanged): mobile-viewport testing as standard practice; Student Workspace tab expansion; clickable-student-names audit; note-undo gap in `classModeService`; Session Lock and Session History; production `GoogleIdentityProvider`/`ConsentProvider` pending AI Working Committee review; consolidate avatar implementations; `firestore.rules` review; Learning Hub; role-based routing; all previously-listed items.

---

## Classroom Dashboard: True First-Time Setup View (Correcting the Previous Reorder-Only Attempt)

**Context:** direct correction that the previous phase's reordering (Groups → Student Access → Reports → Settings within the Classroom section) missed the actual problem — Student Access was below the fold because five widgets above the Classroom section (Recognition Wall, Weekly Snapshot, Pending Tasks, Continue Working, Teaching/Subjects) all render empty states for a brand-new classroom, consuming real vertical space for zero value. Proposed the UX before implementing, per explicit request: a genuinely distinct first-time setup view replacing the whole dashboard body, not a trimmed version of it, rather than further reordering.

### The Redesign
When `hasAnyLinkedStudent(classroom)` is false, the entire dashboard body (everything below the header) is replaced by a compact setup view:
- **A context-aware hero card** — the message and primary button adapt to what's actually true: a classroom with no roster yet can't meaningfully use Student Access (there's no one to generate a PIN for), so the CTA reads "Add Students" → Settings first; once a roster exists, it switches to "Open Student Access" → Student Access, becoming the true primary call-to-action exactly where the spec asked for it.
- **A one-line roster summary** ("3 groups · 12 students" or "No students added yet") instead of the full Groups widget — the widget's own list/empty-state padding was a direct contributor to the fold problem, not an innocent bystander.
- **Everything else suppressed entirely** — Recognition Wall, Weekly Snapshot, Pending Tasks, Continue Working, Teaching/Subjects, Reports don't render at all in this state, since none are useful before any real activity exists.
- **The header and Start Class Mode remain fully available** — setup mode doesn't block a fellow from teaching immediately if they choose to.
- The moment any student links, this entire view stops rendering — automatically, via the same `hasAnyLinkedStudent` check now gating the whole body, not one card — and the full normal dashboard (all widgets, full Groups widget, the Groups→Student Access→Reports→Settings order from the previous phase, which stands on its own merits once a classroom is past initial setup) takes over.

### Verified: The Actual Fold Requirement, Not Just "It Looks Better"
Measured directly against a real 1366×768 viewport, not eyeballed:
- **No roster yet**: hero card + CTA bottom edge at **y=662px** — comfortably within the 768px fold.
- **Roster exists, no links yet**: hero card + Student Access CTA bottom edge at **y=644px** — same result, confirming the layout holds regardless of which message/CTA variant is showing.

### A Real, Previously-Undetected Bug Found Incidentally During This Phase's Testing
While setting up a controlled test override to verify the "linked" branch renders the full normal dashboard correctly, discovered `DemoStudentLinkRepository.js` had contained a genuine **duplicate `isStudentLinked()` method** since an earlier phase — two byte-identical copies of the same method body. This is legal JavaScript (a later class method definition silently shadows an earlier one of the same name; no syntax error, which is exactly why `node --check` never caught it, and why it survived this project's own file-by-file syntax audits). Confirmed both copies were functionally identical, so this had caused no incorrect behavior — but it was real, unintentional dead code, not a stylistic nitpick, and is now removed, leaving exactly one clean definition.

### A Test-Methodology Dead End, Worth Recording Honestly
Verifying the "linked" branch properly required forcing `hasAnyLinkedStudent` to report true. Two approaches were tried and abandoned before landing on a reliable one: monkey-patching the service module via a dynamically-imported reference (failed — the same cross-module-instance mismatch this project has hit before with `page.evaluate`'s dynamic `import()`), and testing against the fixture roster's fixed IDs against a freshly-created classroom's own IDs (the same inherent mismatch noted in the previous phase — they can never match). The approach that actually worked: directly patching the repository's own method to return `true` unconditionally, in an isolated test copy only, then exercising the real UI against it. Also worth recording: the first attempt with this approach *still* failed, because the test classroom had no students added yet — `hasAnyLinkedStudent`'s loop never calls `isStudentLinked` at all when the roster is empty, regardless of what that method would return. Not a bug; a reminder that a test needs to actually exercise the code path it claims to be checking.

### Files Modified
- `js/ui/views/DashboardView.js` — `renderDashboardView` now branches its entire content body on link status; `createOnboardingCard()` replaced by `createFirstTimeSetupContent()` (context-aware hero, compact roster summary); the normal-dashboard branch is otherwise unchanged from the previous phase, including its Groups→Student Access→Reports→Settings order.
- `js/repositories/identity/DemoStudentLinkRepository.js` — duplicate `isStudentLinked()` method removed.
- `css/styles.css` — `.onboarding-card` styles replaced by `.first-time-setup` and its children.

### Breaking Changes
None. The normal (post-linking) dashboard is functionally identical to the previous phase's version — confirmed directly, not assumed, once a working test override was found: all four suppressed widgets reappear correctly, the full Groups widget (not the compact summary) renders, and the Classroom section order is unchanged.

### Regression Verification
Confirmed both first-time-setup variants (no roster; roster with no links) render the correct adaptive messaging, correct roster summary text, and correct navigation destinations. Confirmed via direct pixel measurement that both variants fit within a 1366×768 first viewport. Confirmed, once a reliable test method was found, that the normal dashboard's full widget set and section order are completely unaffected by this change.

### Future TODOs
- (Carried over, unchanged): mobile-viewport testing as standard practice; Student Workspace tab expansion; clickable-student-names audit; note-undo gap in `classModeService`; Session Lock and Session History; production `GoogleIdentityProvider`/`ConsentProvider` pending AI Working Committee review; consolidate avatar implementations; `firestore.rules` review; Learning Hub; role-based routing; all previously-listed items.

---

## Teaching Assistant: Recommendation-Driven Architecture (Phase 1 — Onboarding Rules)

**Context:** the culmination of a multi-round design conversation (recorded across the several CHANGELOG entries above this one) that moved from a branching two-state dashboard, through a boolean `setupProgress` object with dashboard "tiers," to this final architecture: a single, unbranched dashboard with a self-contained, recommendation-driven Teaching Assistant mounted above it. This entry implements Phase 1 (onboarding recommendations only), per explicit scope.

### Architecture
- **`setupStateService.js`** — derives setup-only facts (`hasStudents`, `hasSentInvitation`, `hasLinkedStudent`, `hasGroups`, `hasNotebookConfigured`) from existing data. Deliberately excludes anything about actual teaching activity (a future `activityStateService.js` would hold that), per the explicit instruction that running a Class Session is evidence of activity, not a setup checkbox.
- **`recommendationEngine.js`** — a flat list of independent rules, each answering "does this apply, at what priority" given `setupState`. The engine runs every rule, filters to applicable and non-dismissed, and returns the single highest-priority one. This is the actual extensibility point: a future teaching-oriented rule (recognize a student, review pending checks) is one new entry in the list — nothing about the engine, the priority mechanism, or any existing rule changes.
- **`TeachingAssistant.js`** — a self-contained UI component rendering exactly what the engine returns, or nothing. Priority does double duty as both ranking and visual weight (>=80 → full card, 30-79 → compact strip), avoiding a separate "tier" concept layered on top of priority.
- **`DashboardView.js`** — reverted to a single, always-built content path (every widget always renders) with the Assistant mounted as one call above it. Confirmed directly, not assumed: removing this call entirely would leave the rest of the dashboard completely unaffected, since the dashboard has zero awareness of setup state or recommendations.

### A Real Data-Model Finding, Not an Assumption
Checked `studentService.js`'s `addStudent(team, name)` before writing the `hasGroups` rule, since assuming "any team exists" would be the right signal seemed worth verifying first — it requires an existing team, meaning any classroom with students necessarily has at least one team already. A plain "has any team" check could therefore never be false once `hasStudents` is true, making it useless as a signal for "has this teacher intentionally organized their class into groups." Used `classroom.teams.length > 1` instead — more than one team is the real signal; a single team is just the container every roster needs.

### Two More Duplicate-Declaration Bugs Found and Fixed
While building `hasSentAnyInvitation`, found that `js/repositories/identity/StudentLinkRepository.js` (the abstract interface) had carried a duplicate `isStudentLinked()` abstract method declaration since an earlier phase — same category of bug as the one found and fixed in `DemoStudentLinkRepository.js` two phases ago (legal JS for class methods, silently shadows, no syntax error, which is exactly why it survived every prior audit). Both occurrences were functionally identical (both just `throw`), so no incorrect behavior resulted — but it's real, now-removed dead code. Given this is the *second* time this exact bug shape has turned up in this same file pair, it's worth treating as a pattern: duplicate class methods don't announce themselves, and are worth explicitly grepping for (`grep -c "async methodName"`) after any edit that touches an existing method, not just assumed correct because `node --check` passes.

### A Test-Methodology Dead End, Recorded Honestly
Verifying that a dismissal persists was first attempted via a full page reload — which failed, showing no dashboard at all. Investigated rather than assumed broken: this project's test mocks for `authService.js` and `firestoreClassroomRepository.js` are both purely in-memory, with no persistence layer of their own (unlike the real Firebase SDK, which persists sessions natively) — so a genuine full-page reload wipes the mock sign-in state and the mock "Firestore" store together, unrelated to whether dismissal actually works. Re-verified via SPA navigation (which correctly preserves session state, matching real-world behavior) instead, and confirmed dismissal persists correctly: after dismissing "Create Groups," navigating away and back shows "Create Notebook" — the correct next recommendation — not a reset state.

### Features Added
- `js/services/setupStateService.js`, `js/services/recommendationEngine.js`, `js/ui/components/TeachingAssistant.js` (all new).
- `js/services/studentIdentityService.js`, `js/repositories/identity/DemoStudentLinkRepository.js`, `js/repositories/identity/StudentLinkRepository.js` — `hasSentAnyInvitation`/`hasAnyInvitationForClassroom` added.
- `js/main.js` — `onOpenSettingsStudents`, `onOpenSettingsGroups`, `onOpenSettingsNotebooks` navigation callbacks added.
- `css/styles.css` — `.teaching-assistant--full`/`--compact` styles, replacing the superseded `.first-time-setup` block.

### Files Removed / Superseded
- `createFirstTimeSetupContent()` in `DashboardView.js` — the branching dashboard content builder from two phases ago is fully removed, not just unused; the single-path architecture this phase settles on has no equivalent concept.

### Breaking Changes
None to existing functionality. `renderDashboardView` reverted from `async` back to a plain function, since nothing in its own body needs to await once the Assistant's async work moved into its own self-contained component.

### Regression Verification
Confirmed the full priority progression end-to-end: Add Students (full card, non-dismissible) → Invite Students (full card, dismissible) → a compact strip once both are done (Create Groups or Create Notebook, tied at priority 30) → nothing rendered once every onboarding rule is satisfied. Confirmed the dashboard's own widgets (Recognition Wall, Weekly Snapshot, etc.) render unconditionally throughout, proving the single-path claim rather than just asserting it. Confirmed dismissal persists correctly via realistic SPA navigation.

### Future TODOs
- **Phase 2**: `activityStateService.js` and teaching-oriented recommendations (recognize a student, review pending notebook checks, prepare tomorrow's lesson) — the architecture is explicitly designed for this to be additive, one new rule at a time.
- Re-audit other files in this identity/repository cluster for the same duplicate-method pattern found twice now, as a precaution.
- (Carried over, unchanged): mobile-viewport testing as standard practice; Student Workspace tab expansion; clickable-student-names audit; note-undo gap in `classModeService`; Session Lock and Session History; production `GoogleIdentityProvider`/`ConsentProvider` pending AI Working Committee review; consolidate avatar implementations; `firestore.rules` review; Learning Hub; role-based routing; all previously-listed items.

---

## Pre-Roster Welcome Screen — A Deliberate, Named Tension with the Previous Phase

**Context:** a direct request that nothing render for a brand-new classroom except a welcome message and Add Students — explicitly reversing the "one dashboard, always" decision made just one phase earlier. Flagged this directly before implementing, since it's a genuine, intentional reversal of a decision made together, not an oversight — and confirmed the reversal doesn't actually require touching the recommendation-engine architecture built to support it.

### The reconciliation
The welcome screen this phase asks for — title, one line, "Add Students" — is exactly the top recommendation `recommendationEngine.js` already produces when there are no students yet ("add-students," priority 100, non-dismissible). Nothing about `setupStateService.js`, `recommendationEngine.js`, or `TeachingAssistant.js` needed to change at all. What changed is narrower and lives entirely in `DashboardView.js`: the standard header and full widget stack are now gated behind a direct `hasStudents` check, and before that point, the Assistant's own existing card *is* the entire screen — not a second, separately-maintained mockup of it.

### What's suppressed before the first student is added
The standard header (including Start Class Mode), Continue Working, Recognition Wall, Weekly Snapshot, Pending Tasks, the Teaching section (Subjects), and the Classroom section (Groups, Student Access, Reports, Settings) — all of it, confirmed absent by direct check, not inferred from the code. Once a student is added, all of it appears together, and the Assistant continues its exact same priority progression from the previous phase (Add Students → Invite Students → compact Groups/Notebook → nothing) without any special-casing for having just crossed that boundary.

### A deliberate non-change worth naming
`onDismiss` is not wired for the Assistant in this pre-roster context. "Add Students" is the only recommendation the engine can ever return while `hasStudents` is false — every other rule requires it — and that one is marked non-dismissible. Wiring a dismiss handler here anyway (reconstructing a partial prop set for a future re-render) would have been dead code that looked functional but would silently break the moment a future rule ever made something dismissible reachable in this state. Left unwired, with a comment explaining exactly why, rather than papering over it with a handler that can't currently be exercised.

### Files Modified
- `js/ui/views/DashboardView.js` — `hasStudents` gate added at the top of `renderDashboardView`; `renderPreRosterWelcome()` added, reusing `TeachingAssistant` unchanged.
- `css/styles.css` — `.pre-roster-welcome` and its children.

### Breaking Changes
None to the post-roster experience — confirmed directly, not assumed: the full dashboard, its widgets, and the Assistant's priority progression are byte-for-byte the same once a classroom has students as they were before this phase.

### Regression Verification
Confirmed, for a brand-new classroom: the pre-roster welcome renders with the correct classroom name and the Assistant's "Add Students" card, and every suppressed item (header, Start Class Mode, Continue Working, Recognition Wall, Weekly Snapshot, Groups, Subjects, Reports) is genuinely absent, not just visually de-emphasized. Confirmed that adding the first student transitions cleanly to the full dashboard with the standard header, Start Class Mode, and Recognition Wall all present, and that the Assistant correctly advances to "Invite Students" at that point — the same progression verified in the previous phase, now confirmed unaffected by this change.

### Future TODOs
- (Carried over, unchanged): Phase 2 activity-state recommendations; re-audit the identity/repository files for the duplicate-method pattern found twice; mobile-viewport testing as standard practice; Student Workspace tab expansion; clickable-student-names audit; note-undo gap in `classModeService`; Session Lock and Session History; production `GoogleIdentityProvider`/`ConsentProvider` pending AI Working Committee review; consolidate avatar implementations; `firestore.rules` review; Learning Hub; role-based routing; all previously-listed items.

---

## Bug Fix: Removed the "Add a Group First" Dependency for Students

**Context:** flagged as a bug — the Students Settings tab blocked adding any student until at least one group existed, a real dependency baked into the data model (`studentService.addStudent(team, name)` requires a team object), not just a UI message.

### The fix
Rather than rewriting every feature that assumes students live nested inside `team.students` (Class Mode, Recognition, Notebook Tracker, Reports, Weekly Snapshot all read students this way), introduced a single reserved team — `classroomService.getOrCreateUngroupedTeam()` — created lazily the first time it's needed and reused after that, marked with `isUngrouped: true`. Structurally identical to any other team, so nothing downstream needs special-casing; only UI that lists *teacher-created* groups needed a one-line filter to exclude it, since it isn't one:
- Settings' Groups tab
- The Dashboard's Groups widget

Both continue to show correctly empty (not falsely "has groups") until the teacher creates a real one — confirmed directly, not assumed, including that a real group and the Ungrouped team coexist correctly and the second ungrouped student reuses the same team rather than creating a duplicate.

### The new Students empty state
Replaces the old blocking message with the exact requested copy — icon, "Students" title, welcoming message, and a working "Add Student" button that adds directly to the Ungrouped team. `createEmptyStateElement` (the existing generic component) only supports a plain message, not an icon+title+message combination, so this is built directly rather than stretching that component past what it's designed for.

### `hasGroups` updated for the new model
`setupStateService.js`'s `hasGroups` — used by the Teaching Assistant's "Create Groups" recommendation — previously read `classroom.teams.length > 1` (reasoning that a single team is just the roster's container, not evidence of real grouping). With the Ungrouped auto-team now able to exist independently, that's no longer the right check: updated to `classroom.teams.some(team => !team.isUngrouped)`, so a classroom with only ungrouped students still correctly shows "Create Groups (Optional)," and a classroom with one real group correctly doesn't.

### Files Modified
- `js/services/classroomService.js` — `getOrCreateUngroupedTeam()` added.
- `js/ui/views/SettingsView.js` — Students section rewritten (empty state, ungrouped-add path, an always-available "add a new student" section once real teams exist too); Groups section filters out the Ungrouped team.
- `js/ui/components/GroupsWidget.js` — same filter applied to the Dashboard widget.
- `js/services/setupStateService.js` — `hasGroups` updated for the new model.
- `css/styles.css` — `.settings-empty-state` and its children.

### Breaking Changes
None to existing real-group workflows — confirmed directly that adding, renaming, and removing real groups and their students all behave exactly as before; the only change is that students no longer require one to exist first.

### Regression Verification
Confirmed the full flow end-to-end: empty state renders with the exact requested copy, "Add Student" works with zero groups present, the student appears correctly under an "Ungrouped" heading, the Groups widget correctly shows its own empty state (proving Ungrouped doesn't count as a real group), and the student is fully visible and tappable in Class Mode. Separately confirmed a real group can coexist with the Ungrouped team without conflict, and that a second ungrouped student reuses the same team rather than creating a duplicate one.

### Part 2 — Settings Navigation Reorganization: Reviewed, Not Yet Implemented
Per explicit request to review before implementing: the proposed "People / Learning / Classroom" grouping should be implemented as a purely presentational change inside `SettingsView.js`'s own tab rendering, without altering the underlying route shape (`/classroom/{id}/settings/{section}` stays exactly as it is). Changing the URL shape itself (e.g., to `/settings/people/students`) would require updating every one of the 4 places elsewhere in the app that construct a settings sub-route directly (`main.js`'s `onOpenSettingsStudents`/`onOpenSettingsGroups`/`onOpenSettingsNotebooks`, plus `onOpenGroups`), and would break any existing deep link into a specific tab. Keeping the flat route and only regrouping the tab bar's presentation avoids all of that — implementation held pending confirmation, per the request.

### Future TODOs
- Implement the Settings navigation reorganization (Part 2), once confirmed.
- (Carried over, unchanged): Phase 2 activity-state recommendations; re-audit identity/repository files for the duplicate-method pattern found twice; mobile-viewport testing as standard practice; Student Workspace tab expansion; clickable-student-names audit; note-undo gap in `classModeService`; Session Lock and Session History; production `GoogleIdentityProvider`/`ConsentProvider` pending AI Working Committee review; consolidate avatar implementations; `firestore.rules` review; Learning Hub; role-based routing; all previously-listed items.

---

## Settings Redesign Continued: Upload Restored, Action-First Layout, Post-Import Guidance — and a Real Data-Loss Bug Found and Fixed

**Context:** continuation of the Settings-as-Setup-Wizard redesign — restoring CSV upload, making the Students section action-first, and adding post-import guidance, following the proposal confirmed in the previous phase.

### Completed this phase
- **Upload Student List restored**, reusing the exact existing pipeline (`classroomImportService.analyzeCsv`/`parseWithFormat`, `ImportPreviewModal`, `workspaceService.importRosterIntoClassroom`) rather than a second implementation, per explicit instruction.
- **Action-first layout**: Add Student and Upload Student List now render before any list or empty state, with quick-add toggling inline rather than sitting open by default.
- **Post-import guidance**: a dedicated success screen ("✓ N students imported... Next, invite your students to connect... Open Student Access") replaces the normal content immediately after a successful import.
- **Bloom Labs palette applied, scoped to Settings** — via `.settings-view`-scoped CSS variables, deliberately not a global token change, since the rest of the app hasn't been reviewed against this palette yet. Spacing increased, card shadows softened, heading/body contrast increased for the "lighter, calmer" feel requested, not just a color swap.
- **Naming**: implemented as "Roster" per the reasoning given last phase (avoids colliding with the "Classroom" section name and "Class Mode").

### Two real bugs found through testing, one of them serious
**1. A genuine data-loss bug**, found by testing a realistic sequence (manual add, then import) rather than each action in isolation. The import's `onConfirm` handler called `workspaceService.save(classroom)` *again*, after `workspaceService.importRosterIntoClassroom()` had already persisted correctly using its own internal, freshly-fetched classroom reference. Since `classroomService.upsertClassroom()` replaces the classroom object wholesale on every real-time update (it doesn't mutate the existing reference), the `classroom` variable captured in this view's own closure had gone stale the moment any earlier save round-tripped through the subscription — meaning the redundant save call persisted a snapshot that never had the imported teams applied to it, silently overwriting the correct import with stale data. A previously-added student survived (since it had been mutated directly on that same stale reference); the imported roster did not. **Fixed by removing the redundant save call entirely** — `importRosterIntoClassroom` already persists correctly on its own.

Getting the fix right took two attempts, both instructive:
- First fix removed the redundant save but didn't set the `pendingImportSuccess` flag until *after* calling `importRosterIntoClassroom` — whose internal save synchronously triggers this app's real-time subscription and a full re-render *before* any code written after the call would run, so the flag wasn't set in time and the success screen silently didn't appear (though the underlying data was, by then, correctly saved). **Fixed by setting the flag before making that call, not after** — a straightforward but easy-to-miss ordering issue once a synchronous subscription is in the mix.

**2. A real usability ambiguity, not just a test artifact.** Investigating the above, an earlier test run appeared to show manual "Add Student" broken entirely — traced to the test's own `button:has-text("Add Student")` locator matching the action bar's "+ Add Student" *toggle* button before the form's own submit button, since Playwright's `:has-text()` does substring matching (a repeated click just closed the form again, never reaching the actual handler). The underlying functionality wasn't broken — but two buttons with near-identical, overlapping text is a real ambiguity risk for actual teachers too, not only automated tests, especially in a redesign explicitly about reducing exactly this kind of friction. **Fixed by giving the submit button a distinct label ("Save")** rather than leaving it to coincidentally repeat the toggle's own text.

### What's still not done
Given the depth this phase's investigation required, the remaining reorganization items from the confirmed proposal — Roster/Groups/Teachers coexisting on one page rather than separate tabs, the Learning/Classroom section consolidation, and the associated route changes — have not been started yet.

### Files Modified
- `js/ui/views/SettingsView.js` — action-first Students/Roster layout, restored CSV import, post-import success screen (`renderImportSuccess`, `pendingImportSuccess` module-level flag), the two bugs above fixed, `onOpenStudentAccess` threaded through (and its own rerender-closure omission, found and fixed, from an earlier phase's threading).
- `js/main.js` — `onOpenStudentAccess` added to the Settings route wiring.
- `css/styles.css` — Settings-scoped palette variables, spacing/shadow adjustments, action-bar and import-success styles.

### Breaking Changes
None to existing functionality — confirmed directly that manual student management, group management, and now-restored CSV import all work correctly together in realistic combined sequences, not just individually.

### Regression Verification
Confirmed the full realistic sequence end-to-end: manual add → CSV upload → import success screen with correct count → all students (manual and imported) correctly present afterward → manual add still works correctly after an import, with all five students from both sources present. This is a meaningfully more thorough check than testing each action in isolation, which is exactly what let the data-loss bug through undetected initially.

### Future TODOs
- Roster page redesign so Students/Groups/Teachers coexist without leaving the page.
- Learning/Classroom section consolidation and the associated route changes.
- (Carried over, unchanged): Phase 2 activity-state recommendations; re-audit identity/repository files for the duplicate-method pattern found twice; mobile-viewport testing as standard practice; Student Workspace tab expansion; clickable-student-names audit; note-undo gap in `classModeService`; Session Lock and Session History; production `GoogleIdentityProvider`/`ConsentProvider` pending AI Working Committee review; consolidate avatar implementations; `firestore.rules` review; Learning Hub; role-based routing; all previously-listed items.

---

## Double-Render Investigated and Fixed Properly — Root Cause, Not a Guard

**Context:** explicit instruction to pause feature work and investigate the double-render found in the previous phase properly — determine why `renderSettingsView` was invoked from two paths, identify the architectural reason, and fix it at the root rather than suppressing the symptom.

### Why two invocation paths exist — both are legitimate
Traced with precise, timestamped instrumentation (not assumption): one path is `router.js`'s `hashchange` listener, registered once at boot to render whenever the URL changes — this owns rendering in response to **navigation**. The other is `workspaceService`'s `onChangeCallback`, invoked from inside `subscribeToClassroomRefs`'s own update handler — which fires **every time the classroom-refs list changes**, not just once at initial load. This is a real-time data-sync signal: if a co-teacher's own edit changes something about the classroom while you're looking at it, this is what makes the view refresh automatically. **Neither path is legacy.** Removing either would remove a real, necessary capability — navigation-driven rendering and data-sync-driven rendering are both required, for different reasons.

### The actual root cause: a render function was performing a write
Precise, timestamped tracing showed the second render wasn't happening *after* the first completed — it was starting **while the first was still mid-execution**, before it had even appended its own output. That's only possible if something inside the first render's own synchronous body triggered the second, nested inside it. Investigation found it: `renderTeachersSection` called `ensureJoinCode(classroom)` directly in its render body, and — for a brand-new classroom with no code yet — generated one and immediately called `workspaceService.save(classroom)` **as a side effect of rendering**, not in response to any user action. That save synchronously fires the same classroom-refs subscription used for legitimate external data-sync, which calls `renderSettingsView` again, nested inside the original call.

This is a genuine architectural violation with a well-established name: **a render function must only read, never write.** The specific bug predates this phase's own work — `renderTeachersSection` existed as its own tab before today with this same pattern — but it was dormant until this phase's own Students/Groups/Teachers merge made it fire on an unrelated action (clicking "Add Students" now also renders the Teachers section, and its side-effecting write, as a side effect of viewing a different sub-section on the same page).

### The fix: move the write out of the render path entirely, not guard against its symptom
- **`classroomService.createEmptyClassroom()`** now generates the join code at classroom creation time — every classroom has one from the moment it exists, so there is no longer a "first render needs to lazily backfill" case for anything created going forward.
- **`renderTeachersSection` is now a pure read** for the common case (display the existing code, offer Copy). For the one remaining edge case — a classroom that predates this fix, with no code yet — it shows an explicit **"Generate Classroom ID"** button instead of silently writing during render; the write now only ever happens in direct response to a click, the same as every other write in this codebase.

This directly satisfies "if both paths are required, explain why and redesign the flow so rendering only happens once": both paths remain, unchanged and un-suppressed; what changed is that rendering itself no longer has a way to trigger either of them recursively.

### A codebase-wide audit, as requested, for the same anti-pattern elsewhere
Searched every UI file for `workspaceService.save()` calls not clearly inside an event handler. Found 12 candidates; manually inspected every one. Eleven were false positives from the search heuristic — genuinely inside `addEventListener`/modal-callback/chip-picker callbacks (`StudentProfileView.js`, `SetupWizardView.js`, and the two new chip-picker call sites in `SettingsView.js` added this phase). **The join-code generation was the only genuine instance of this pattern in the codebase.**

### Files Modified
- `js/services/classroomService.js` — `createEmptyClassroom()` now generates the join code at creation.
- `js/ui/views/SettingsView.js` — `renderTeachersSection`'s join-code display rewritten as a pure read, with an explicit Generate button for the legacy-classroom edge case.

### Breaking Changes
None. Confirmed directly: a brand-new classroom's join code appears immediately, correctly, without any lazy generation step; an existing classroom without one (simulated) would show the explicit Generate button rather than silently failing or duplicating renders.

### Full Verification Suite Re-Run, Per Explicit Request
Before any further feature work: confirmed exactly one `.settings-view` element renders (no duplication) on initial navigation to Settings, after a quick-add, and after switching to each of the three tabs. Confirmed the header text is white, the 3-tab structure is correct, the merged Class page shows Students/Groups/Teachers together, the join code displays immediately, action-first Add Student/Upload buttons are present, Learning's chip pickers render and function, Permissions shows the single-teacher empty state, and Danger Zone is visually separated. All passed.

### Future TODOs
- Resume Settings redesign feature work now that the render lifecycle is confirmed correct.
- (Carried over, unchanged): Phase 2 activity-state recommendations; mobile-viewport testing as standard practice; Student Workspace tab expansion; clickable-student-names audit; note-undo gap in `classModeService`; Session Lock and Session History; production `GoogleIdentityProvider`/`ConsentProvider` pending AI Working Committee review; consolidate avatar implementations; `firestore.rules` review; Learning Hub; role-based routing; all previously-listed items.

---

## Landing Page Rebrand: Bloom Labs as Umbrella, Classroom Tracker as the Product

**Context:** the landing page previously presented "Bloom Labs" as the primary title with "For Teachers"/"For Students" as its two modes — inverting the intended hierarchy. Bloom Labs is the umbrella ecosystem; Classroom Tracker is the actual product this screen is the entry point to, and Teacher/Student Portal are two experiences *within* Classroom Tracker, not two modes of Bloom Labs itself.

### Changes
- **A small "by Bloom Labs" eyebrow label** now sits above the main title — present, but clearly secondary (uppercase, muted, smaller than the title).
- **"Classroom Tracker" is now the primary title**, where "Bloom Labs" used to be.
- **Subtitle reframed**: "Two portals, built around two different questions" — describing Classroom Tracker's own two portals, not "one platform" with two modes.
- **Journey cards renamed**: "For Teachers"/"For Students" → **"Teacher Portal"/"Student Portal"**, matching the requested terminology exactly.
- **Button labels updated** to match: "Continue as Teacher"/"Continue as Student" → **"Enter Teacher Portal"/"Enter Student Portal"** — applying the same hierarchy shift consistently to the actual calls-to-action, not just the card titles.

No routing changes were needed or made — `/`, `/teacher`, and `/student` all work exactly as before. This was a deliberate choice, not an oversight: keeping the same routes while changing only the visual/copy hierarchy on this one screen is exactly what makes introducing Learning Hub later straightforward — a future version of this same screen would show Classroom Tracker and Learning Hub as sibling *products* to choose between, each still small-labeled under Bloom Labs, without needing to redesign this screen's structure again.

### Files Modified
- `js/ui/views/LandingView.js` — title/subtitle/card copy updated; module doc comment rewritten to describe the corrected hierarchy explicitly, so the reasoning stays documented for whoever builds the Learning Hub entry later.
- `css/styles.css` — `.landing-view__eyebrow` added.

### Breaking Changes
None. Confirmed directly: both "Enter Teacher Portal" and "Enter Student Portal" navigate to exactly the same destinations the old buttons did.

### Regression Verification
Confirmed the eyebrow label, main title, subtitle, both journey card titles, and both button labels all show the correct new copy, and that clicking each button still correctly navigates into the Teacher and Student flows respectively.

### Future TODOs
- When Learning Hub is introduced, extend this same screen to show it as a third sibling product alongside Classroom Tracker, per the hierarchy this phase established.
- (Carried over, unchanged): resume Settings redesign feature work; Phase 2 activity-state recommendations; mobile-viewport testing as standard practice; Student Workspace tab expansion; clickable-student-names audit; note-undo gap in `classModeService`; Session Lock and Session History; production `GoogleIdentityProvider`/`ConsentProvider` pending AI Working Committee review; consolidate avatar implementations; `firestore.rules` review; role-based routing; all previously-listed items.

---

## Dashboard Widgets Made Truly Conditional on Real Data — No More Empty Placeholders

**Context:** even after the earlier pre-roster-welcome and Teaching Assistant work, the moment a classroom's first student was added, the *entire* normal dashboard appeared at once — Recognition Wall, Weekly Snapshot, Pending Tasks, Subjects, Groups, all showing empty-state placeholder text simultaneously. Explicit direction: recommendations (the Teaching Assistant) and the dashboard (widgets showing real information) are separate concepts, and a widget should not exist on screen at all until it has real data — not render with text explaining why it's empty.

### The fix
Every widget below the header is now individually gated on a real-data check, computed directly from the classroom:
- **Recognition Wall** — only if any student has an actual badge.
- **Weekly Snapshot** — only if any student has real score/history activity.
- **Pending Tasks** — only if `pendingTaskService.getPendingTasks()` actually returns something (it already filters to non-empty groups internally, so an empty result reliably means nothing is pending).
- **Teaching section (Subjects)** — only if at least one subject is configured.
- **Groups widget** — only if a real (non-`Ungrouped`) team exists.
- **Continue Working** — only if there's an actual notebook entry to continue; previously always rendered a widget even with zero entries.
- **Reports** — removed entirely rather than gated, since it's a disabled placeholder button with no real functionality behind it yet; "avoid placeholder boxes" applies here too; it can come back once the feature is real.

Student Access and Settings remain always-present once students exist — they're persistent navigation actions, not data widgets summarizing activity, so they don't fit the "empty until it has data" framing at all.

### One deliberate interpretation, worth being upfront about
The request's own example ("after students are added, show only the Invite Students recommendation") reads literally as excluding Start Class Mode too at that stage. I kept it visible, as part of the header, once students exist — reasoning that Class Mode is the *mechanism* that produces the data every other widget is gated on, and hiding it would leave a teacher with students added but no way to actually start teaching until working through every recommendation first. This is a judgment call, not an unambiguous reading of the request — happy to hide it too if that's not the right call.

### Real test-methodology mistakes caught along the way, not smoothed over
Verifying this phase's work surfaced three of my own testing errors in a row, each investigated properly rather than assumed:
1. A test script using "Continue as Teacher" — the pre-rebrand button label, replaced by "Enter Teacher Portal" in the previous phase's landing page rebrand.
2. A test script clicking a "Groups" settings tab that no longer exists as its own tab, following the Class/Learning/Classroom merge from an earlier phase.
3. Checking for Weekly Snapshot immediately after clicking "Save Session," while still on the Class Mode screen — saving a session doesn't automatically navigate back to the Dashboard, so of course a Dashboard-only widget wasn't there. Fixed by explicitly exiting Class Mode first, and confirmed Weekly Snapshot correctly appears once actually back on the Dashboard.

None of these were bugs in the feature itself — but each was worth chasing down properly rather than either assuming a false negative meant success, or reporting a false failure.

### Files Modified
- `js/ui/views/DashboardView.js` — every widget gated on a real-data check; `loadContinueWorking` no longer renders anything when there's nothing to continue; `createReportsPlaceholder()` removed entirely.

### Breaking Changes
None. All existing widgets behave identically once they do have data — only the "should this render at all" gate is new.

### Regression Verification
Confirmed the full progression directly: a classroom with just one added student (no groups, no subjects, no activity) shows only the header's Start Class Mode, the Teaching Assistant's "Invite Students" recommendation, and the persistent Student Access/Settings actions — nothing else. Confirmed the Groups widget appears the moment a real group is created, the Teaching section appears the moment a subject is configured, and Weekly Snapshot appears the moment a Class Session is saved and the teacher returns to the actual Dashboard.

### Future TODOs
- Confirm whether Start Class Mode should also be excluded from the earliest stage, per the interpretation note above.
- (Carried over, unchanged): resume broader Settings redesign feature work; Phase 2 activity-state recommendations; mobile-viewport testing as standard practice; Student Workspace tab expansion; clickable-student-names audit; note-undo gap in `classModeService`; Session Lock and Session History; production `GoogleIdentityProvider`/`ConsentProvider` pending AI Working Committee review; consolidate avatar implementations; `firestore.rules` review; role-based routing; all previously-listed items.

---

## Demo Roster Architecture Retired — Student Access Now Operates Entirely on Classroom Data

**Context:** "Not available in this demo roster" was blocking every real student in Student Access, since the underlying identity architecture had been built around a fixed, fictional fixture roster that predates real roster-building features (manual add, CSV import). Investigated before making any changes, per explicit request.

### Investigation findings
1. **Which service determined demo-roster membership**: `DemoStudentLinkRepository.js`'s internal `findStudent(studentId)`, checking against a hardcoded array of exactly 2 fictional students ("Hariharan," "Blessy"). Both teacher-side methods (`generatePin`, `generateInvitationToken`) called this first and threw for anyone else; `StudentAccessView.js` never actually attempted them for a real student, instead using a separate UI-level name-match against `listDemoRoster()` purely to avoid triggering that throw.
2. **Why Student Access didn't read the roster directly**: the repository beneath it had no mechanism to generate or store a PIN for an arbitrary student ID — by its own doc comment, it was built as a temporary stand-in for a production, Firestore-backed repository that was never built (blocked on the AI Working Committee's consent review), so a stopgap became a permanent ceiling.
3. **Whether the demo roster served any other purpose**: found it was more deeply embedded than the two obvious call sites — `getLinkedStudents()`, `resolvePin()`, and `resolveInvitationToken()` all resolved a student's *name* through the same hardcoded lookup, and `StudentProfileView.js` had an independent copy of the identical pattern. All four were the same single bottleneck, not four separate concerns.

### The fix: a genuinely generic repository, not four patched call sites
Rather than teaching each UI screen to skip the demo check, the repository itself was rebuilt with no built-in knowledge of any specific student, demo or real:
- **`LocalStudentLinkRepository.js`** replaces `DemoStudentLinkRepository.js` entirely (old file deleted). PINs and invitation tokens are now keyed by the real `(classroomId, studentId)` pair the caller provides, with `studentName` passed in and stored alongside at generation time — since the caller (Student Access, looking at the real roster) always has it. This is what lets `resolvePin()`/`resolveInvitationToken()` return a name later without the repository needing any independent roster to look one up against.
- **`StudentLinkRepository.js`** (the interface) — `generatePin`/`generateInvitationToken` signatures updated to accept `studentName`.
- **`studentIdentityService.js`** — instantiates the new repository; `listDemoRoster()` removed entirely, replaced by `getCurrentPinForStudent(studentId)`, a genuinely general "does this student have a PIN yet" check.
- **`StudentAccessView.js`** — the `demoEntry` name-match lookup removed completely. Every button (Share Invitation, Generate/Reset/Copy PIN) is now unconditionally available for every real student; "Not available in this demo roster" no longer exists anywhere in this codebase.
- **`StudentProfileView.js`** — the same pattern, independently present here too, removed the same way.

### Verified directly, not assumed
- A manually-added real student ("Priyanka Reddy," never part of the old fixture) generated a real, dynamically-created PIN and had every action available with nothing disabled.
- A CSV-imported real student ("Fatima Sheikh") independently generated her own real PIN — confirming both roster-creation paths mentioned in the request work identically.
- End-to-end linking was verified, not just PIN generation: a real PIN generated for a real student ("Arjun Mehta") was used to successfully link through the actual Student Portal sign-in flow — confirming "parent linking works for every classroom student" against a genuine, non-fixture student rather than assuming the repository swap was sufficient.
- Confirmed zero remaining references anywhere in the codebase to `listDemoRoster`, `DemoStudentLinkRepository`, or any `demoEntry`-style lookup.

### A separate, pre-existing gap noticed along the way, out of scope for this fix
While verifying the Student Portal linking flow, noticed the Portal's own dashboard (stars, streak, team name) still shows placeholder data unrelated to whichever student actually linked — that's `studentPortalDataService.js`'s own known placeholder-data state, a separate, already-documented gap in the Student Portal feature itself, not something this fix touches or introduces.

### Files Modified
- `js/repositories/identity/LocalStudentLinkRepository.js` — new, replacing the deleted `DemoStudentLinkRepository.js`.
- `js/repositories/identity/StudentLinkRepository.js` — interface signatures updated.
- `js/services/studentIdentityService.js` — repository swapped in; `listDemoRoster()` removed; `getCurrentPinForStudent()` added.
- `js/ui/views/StudentAccessView.js`, `js/ui/views/StudentProfileView.js` — demo lookups removed entirely.

### Breaking Changes
The two old fixture students ("Hariharan"/PIN 482913, "Blessy"/PIN 731064) no longer exist as special-cased entities — any localStorage link data tied to those specific fictional IDs from earlier testing is now orphaned and irrelevant, which is the intended outcome of retiring a fixture that was never real student data in the first place.

### Regression Verification
Confirmed the full lifecycle for real students created both ways (manual add, CSV import): PIN generation, reset, copy, invitation sharing, and actual successful linking through the Student Portal — all working identically regardless of how the student was added, with no code path anywhere distinguishing a "demo" student from a "real" one.

### Future TODOs
- Wire the Student Portal's own dashboard content to the actually-linked student, replacing its remaining placeholder data (noted above, separate from this fix).
- (Carried over, unchanged): resume broader Settings redesign feature work; Phase 2 activity-state recommendations; mobile-viewport testing as standard practice; Student Workspace tab expansion; clickable-student-names audit; note-undo gap in `classModeService`; Session Lock and Session History; production `GoogleIdentityProvider`/`ConsentProvider` pending AI Working Committee review; consolidate avatar implementations; `firestore.rules` review; role-based routing; all previously-listed items.

---

## Classroom Join Code Replaces Per-Student PINs — Student Onboarding Implementation

**Context:** implementing the final decision from this project's multi-round student-onboarding architecture discussion — replace per-student PIN generation with one shared classroom code that lets students pick their own name, per the explicit instruction to build this specific piece while leaving the rest of the identity architecture (`IdentityProvider`, `ConsentProvider`, PIN/invitation-token machinery) untouched and in place, not deleted.

### What was built
- **A second, separately-scoped join code** (`classroomStudentJoinCode`), generated at classroom creation alongside the existing co-teacher code, in its own Firestore collection (`studentJoinCodes`, not just a different key prefix in `joinCodes`) — deliberately never interchangeable with the teacher code, so a student who obtains it can never add themselves as a co-teacher.
- **`studentDeviceService.js`** — a genuinely new, separate mechanism: a browser remembering which student profile(s) it's opened, in localStorage, with no account, no identity provider, no consent check anywhere in it. Includes a `forgetProfile` affordance for the lost/handed-down-device scenario raised during the architecture discussion.
- **The new student join flow** (`StudentJoinClassroomView.js`, `StudentRosterPickerView.js`, `StudentDeviceFlow.js`) — enter a code, see the real roster, tap a name, done. Reuses CSS classes left over from this project's *original*, pre-PIN classroom-code flow, unused since PINs were introduced and a good fit for this one.
- **The one necessary shared write**: `workspaceService.markStudentJoinedPortal()` sets a `hasJoinedPortal` flag directly on the student record — realized partway through implementation that without this, a device tapping a name would only ever update its own local storage, leaving the teacher's side with literally nothing to show.
- **`StudentAccessView.js` rewritten** around the one code (Share / Copy), with a simple, non-actionable joined-status list below it — "Not Joined Yet" is now a normal, expected state, not a bottleneck, matching the architecture discussion's point that per-student urgency framing no longer applies.
- **`recommendationEngine.js`'s "Invite Students" recommendation** updated to the new model, and its trigger signal (`hasAnyStudentJoined`, added to `setupStateService.js`) changed from "has an invitation been sent" (meaningless now — there's no per-student invitation to send) to "has anyone actually joined."

### What was deliberately left alone, per explicit instruction
`IdentityProvider`, `ConsentProvider`, `DemoIdentityProvider`, `DemoConsentProvider`, `LocalStudentLinkRepository`'s PIN/token generation and resolution, `StudentOnboardingFlow.js`, `StudentLinkView.js`, `StudentSignInView.js` — all untouched, all still in the codebase. They're no longer reachable from the Student Portal's default route, but they haven't been removed; they still represent the separate, authenticated parent-connection path this project's architecture discussion explicitly chose not to unwind in this pass.

### A real, pre-existing bug found and fixed along the way
Testing the new flow end-to-end (not just checking each piece in isolation) surfaced that a freshly generated join code failed to resolve at all. Traced it to `workspaceService.createClassroom()`: it calls `classroomService.createEmptyClassroom()` (which sets the join code *fields* on the classroom object) and saves the classroom, but never actually calls `createJoinCodeMapping()` to populate the separate, public lookup table those fields are useless without — that only ever happened via Settings' "Generate Classroom ID" fallback button, meant for classrooms that predate the feature. This is a **pre-existing gap in the co-teacher join-code feature**, inherited by the new student code because it was built by mirroring the same (buggy) pattern. Fixed by calling both `createJoinCodeMapping()` and `createStudentJoinCodeMapping()` directly in `createClassroom()`, for both codes, at creation time.

### A test-methodology lesson, recorded honestly
Verifying "does a code generated on the teacher's page work from the student's device" initially failed when tested across two separate Playwright browser pages — traced to the test itself, not the app: this project's mock repositories are in-memory JS module state, which is isolated per browser page/tab (unlike real Firestore, which genuinely is shared across clients). Re-verified correctly using SPA-style hash navigation within one page, which correctly exercises the same shared mock state — confirming the join, the teacher-visible status update, and the device's auto-resolve on a later visit all work correctly, including the multi-profile "who's using this device" picker with two remembered names shown together.

### Files Created
- `js/services/studentDeviceService.js`
- `js/ui/student-portal/onboarding/StudentJoinClassroomView.js`, `StudentRosterPickerView.js`, `StudentDeviceFlow.js`

### Files Modified
- `js/models/Classroom.js` — `classroomStudentJoinCode` field added.
- `js/services/classroomService.js` — `ensureStudentJoinCode()` added.
- `js/repositories/classroomRepository.js`, `firestoreClassroomRepository.js` — student join-code mapping methods added.
- `js/services/workspaceService.js` — `createStudentJoinCodeMapping()`, `resolveStudentJoinCode()`, `markStudentJoinedPortal()` added; `createClassroom()` fixed to actually populate both join-code mappings.
- `js/services/setupStateService.js` — `hasAnyStudentJoined()` added.
- `js/services/recommendationEngine.js` — "Invite Students" rule updated.
- `js/ui/views/StudentAccessView.js` — rewritten around the one code.
- `js/main.js` — default Student Portal entry repointed to the new flow; `onSwitchStudent` fixed to use the new device mechanism instead of the old, now-inapplicable identity-service one.

### Breaking Changes
The Student Portal's default entry point no longer asks for Google sign-in or a PIN — this is the intended, requested change, not an oversight.

### Regression Verification
Confirmed end-to-end: classroom creation generates both codes correctly; Student Access shows the one code with working Share/Copy and a correct joined-status list; the student flow (code entry → real roster → tap name) completes successfully; the teacher's status view updates to "Joined" immediately after; a device correctly auto-resolves to a single remembered profile on a later visit, skipping the join screen entirely; and a device with two remembered profiles correctly shows both in the "who's using this device" picker.

### Future TODOs
- Wire the Student Portal's own dashboard content to the actually-joined student (still placeholder data — a separate, already-documented gap, unaffected by this phase).
- Consider surfacing a path back to the (still-functional, un-removed) parent-connection flow from within the new Student Portal, since it's no longer reachable from the default route at all.
- Re-audit whether the same "mapping never created at creation time" bug pattern exists anywhere else this project generates a code or token.
- (Carried over, unchanged): resume broader Settings redesign feature work; Phase 2 activity-state recommendations; mobile-viewport testing as standard practice; Student Workspace tab expansion; clickable-student-names audit; note-undo gap in `classModeService`; Session Lock and Session History; consolidate avatar implementations; `firestore.rules` review (now needs the new `studentJoinCodes` collection's rule too); role-based routing; all previously-listed items.

---

## Product Rebrand: ClassMate (Bloom Labs Remains the Subtle Company Name)

**Context:** the product is now branded "ClassMate" everywhere a user actually sees it, replacing both "Bloom Labs" and "Classroom Tracker" as user-facing product names. Bloom Labs remains, deliberately subtle, as the company behind it — matching the Byju's/Think & Learn, Notion/Notion Labs pattern requested.

### Full audit performed before implementing, as requested
Searched every file for "Bloom Labs" and "Classroom Tracker," then separately searched broadly for "Tracker" alone to catch anything the first search might have missed. Categorized every hit as user-facing (changed) or internal documentation (lower priority, addressed selectively). Confirmed several items from the original request's example list don't currently exist in this codebase at all — no About page, no `manifest.json`, no actual QR code image generation (Student Access's copy only describes projecting one), no email-sending feature — so there was nothing to silently miss in those categories.

### User-facing changes
- **Browser tab title** (`index.html`): `Classroom Tracker` → `ClassMate`.
- **Startup-error and nomodule-fallback messages** (`index.html`) — found during the final audit, not the initial one: "Something went wrong loading Classroom Tracker" and "This browser can't run Classroom Tracker" both updated. These only appear when something breaks, but that's exactly when a consistent identity matters most.
- **Landing page**: main title `Classroom Tracker` → `ClassMate`; the "by Bloom Labs" eyebrow above it was *already* the correct subtle pattern from an earlier phase and needed no change.
- **Welcome view, Login view titles**: both updated to ClassMate.
- **Teacher and Student Portal "back" links** (`UserBar.js`, `StudentPortalShell.js`): `← Bloom Labs` → `← ClassMate`.
- **Multi-profile device picker title** (`StudentDeviceFlow.js`, duplicated in `main.js`): `Who's using Bloom Labs today?` → `Who's using ClassMate today?`.
- **"Add Students" recommendation card copy** (`recommendationEngine.js`): updated to reference ClassMate.
- **WhatsApp/share invitation text** (`StudentAccessView.js`) — rewritten to the exact multi-line format requested, with the classroom code standing alone on its own line rather than embedded in a sentence. Also changed the native `navigator.share` title to "Join our classroom on ClassMate," and removed the separate `url` parameter from the share call, since the link was already embedded in the requested text format — passing both risked the link appearing twice on share sheets that concatenate `text` and `url`.

### The "Tracker" audit
Broadened the search beyond the exact phrase "Classroom Tracker" to catch any standalone use of "Tracker" that might read as the old product name. Found one genuinely ambiguous case: `NotebookTrackerView.js`'s back button read "← Back to Tracker" — worth being direct that its *actual* destination, verified by tracing the real navigation wiring rather than assumed, turned out to be the Dashboard, not Class Mode as a first guess suggested. Corrected to "← Back to Dashboard." Left "Notebook Tracker" itself as a feature name (the page's own title, and its own back-link "← Back to Notebook Tracker") — it describes a specific feature within ClassMate, the same way "Recognition Wall" or "Weekly Snapshot" do, not the product's own name, so renaming it would have been scope creep beyond what was requested.

### Lower priority — internal doc comments
Updated `LandingView.js`'s own module doc comment, since it explicitly documents the naming hierarchy other developers would read to understand it. Left doc-comment-only references in `UserBar.js`, `router.js`, `ConsentProvider.js`, `IdentityProvider.js`, `StudentPortalShell.js`, `StudentAchievementsView.js`, `studentIdentityService.js`, `studentPortalDataService.js`, `StudentLinkRepository.js`, `LocalStudentLinkRepository.js`, `main.js`, and `avatarGenerator.js` as-is — none of these affect anything a user sees, and updating every internal comment referencing the old names throughout this project's history didn't seem like the right use of this pass. `CHANGELOG.md`'s own historical entries were left entirely untouched, as a record of what was actually decided and said at the time.

### Files Modified
`index.html`, `js/ui/views/LandingView.js`, `WelcomeView.js`, `LoginView.js`, `NotebookTrackerView.js`, `js/ui/components/UserBar.js`, `js/ui/student-portal/StudentPortalShell.js`, `js/ui/student-portal/onboarding/StudentDeviceFlow.js`, `js/services/recommendationEngine.js`, `js/ui/views/StudentAccessView.js`, `js/main.js`.

### Breaking Changes
None — every change is text-only; no routes, function signatures, or data shapes changed.

### Final Audit, Per Explicit Request
Searched the entire codebase one more time after all changes: zero remaining `.textContent`/`.innerHTML` assignments containing either "Bloom Labs" or "Classroom Tracker" anywhere. Confirmed `ClassMate` appears correctly in every expected user-facing file. Verified end-to-end in a live test: the browser tab title, the Landing page's eyebrow-plus-title hierarchy, the Welcome and Login view titles, the recommendation card copy, and — checked precisely by intercepting the actual clipboard write, not just eyeballing the code — the exact WhatsApp share text, which matches the requested format exactly, including the classroom code standing alone on its own line.

### Future TODOs
- (Carried over, unchanged): resume broader Settings redesign feature work; wire the Student Portal's own dashboard content to the actually-joined student; Phase 2 activity-state recommendations; mobile-viewport testing as standard practice; Student Workspace tab expansion; note-undo gap in `classModeService`; Session Lock and Session History; consolidate avatar implementations; `firestore.rules` review (including the newer `studentJoinCodes` collection); role-based routing; all previously-listed items.

---

## Centralized `APP_BASE_URL` for All Generated Links

**Context:** every link ClassMate generates (currently, the WhatsApp/share invitation) should be built from one configuration value, so a future deployment change (custom domain, different GitHub Pages path) only needs editing in one place.

### Investigation, before changing anything
Searched the whole codebase for every place constructing a URL from `window.location`, and found exactly one: `StudentAccessView.js`'s share-invitation link. No QR code generation exists yet to update (confirmed in an earlier phase — the Student Access page's copy only *describes* projecting a QR code, no image is actually generated), so there was nothing there to touch.

### The old-repository-name search — nothing needed changing, and it's worth explaining why
Found "classroom-tracker" in three places: `README.md` (folder/`cd` instructions), `CHANGELOG.md` (historical record), and `appConfig.js`'s `LEGACY_STORAGE_KEY`/`storageKeyPrefix`. None needed updating:
- The README's references describe the actual, current repository folder name — the repo itself was never renamed, only the app's own branding changed to ClassMate. Changing these would make the instructions wrong, not fix anything.
- `LEGACY_STORAGE_KEY = 'classroom-tracker:workspace'` is a **frozen migration key** — `workspaceService.js` uses it to find data an *earlier* version of this app actually wrote to localStorage under that exact string. Changing it wouldn't rebrand anything; it would just make the migration silently fail to find that old data.
- `storageKeyPrefix` in `APP_CONFIG` turned out to be dead code — declared, but never imported or read anywhere in the app. Left alone as out of scope for this task; not something to quietly clean up under a "just update the URL config" request.

### Implementation
`APP_BASE_URL` added to `appConfig.js` as the single source of truth: `` `${window.location.origin}${window.location.pathname}` `` by default, so it's already correct with zero setup in whatever environment the app is actually running in — local dev, GitHub Pages, or a future custom domain — without needing to be kept in sync by hand. The doc comment spells out the one-line change needed if ClassMate ever moves to a stable domain and every environment should point at that one production URL regardless of where the code happens to be running.

`StudentAccessView.js`'s share-invitation link now reads this constant instead of constructing the URL inline.

### Files Modified
- `js/config/appConfig.js` — `APP_BASE_URL` added; `LEGACY_STORAGE_KEY` documentation clarified to explain why it stays as "classroom-tracker" deliberately.
- `js/ui/views/StudentAccessView.js` — uses `APP_BASE_URL` instead of inline `window.location` construction.

### Breaking Changes
None. Confirmed directly: the generated share link still correctly reflects the current environment's real origin, byte-for-byte the same output as before the refactor.

### Regression Verification
Confirmed the WhatsApp/share invitation text still generates the correct link for the environment it's actually running in, via the new centralized constant rather than inline construction — verified by intercepting the actual clipboard write, not just reading the code.

### Future TODOs
- (Carried over, unchanged): resume broader Settings redesign feature work; wire the Student Portal's own dashboard content to the actually-joined student; Phase 2 activity-state recommendations; mobile-viewport testing as standard practice; Student Workspace tab expansion; note-undo gap in `classModeService`; Session Lock and Session History; consolidate avatar implementations; `firestore.rules` review; role-based routing; all previously-listed items.

---

## Action Design Language: Circular Icon Buttons, Pill Text Buttons, and a Navigation Wording Fix

### Part 1 — Back link wording
`← ClassMate` / `← Bloom Labs` → `← Home`, in both the teacher header (`UserBar.js`) and the Student Portal (`StudentPortalShell.js`) — navigation should describe the destination, not repeat the product name.

**Worth flagging directly**: both links actually navigate to the Landing/product-picker page (`/`), one level *above* the app's own `HomeView.js` (the teacher's classroom list). Since `UserBar` is the persistent header shown on every authenticated screen — including the Home screen itself — "← Home" will appear on the classroom-list screen too, pointing further back to the picker rather than describing "you are here." Implemented exactly as instructed, since it's explicit and unambiguous, but flagging this rather than silently proceeding as if there's no naming overlap with the app's own existing "Home" screen.

### Part 2 — Undo / Notebook / Reset Session
Confirmed the actual prior state before changing anything: Undo and Notebook Tracker already shared `.btn--ghost` (a blue-tinted outline); Reset Session used `.btn--danger` (red) — treating a reversible, in-session "start fresh" action with the same visual severity as an actual deletion. `.btn--danger` is otherwise correctly reserved for genuine deletions elsewhere (Delete Classroom, Remove Student, Discard Session) and was left untouched there.

`.btn--icon-only` redesigned to be the single, authoritative circular treatment — it now owns its own background (`--color-surface`), border, and color directly, overriding whatever variant class (`.btn--ghost`, `.btn--danger`) is also present on the button. Reset Session's class changed from `btn btn--danger btn--icon-only` to `btn btn--ghost btn--icon-only`, and since the icon-only rule now wins regardless, all three buttons render identically — confirmed via computed-style comparison, not a visual check alone: identical background, border, 999px radius, and 40×40 size across Undo, Notebook, and Reset. The existing base `.btn:active { transform: scale(0.97) }` already provided a consistent pressed state, so nothing new was needed there.

### Part 3 — Design system: circular for icon-only, pill for icon+text
Searched the whole codebase for icon-only buttons (no accompanying text) to identify migration candidates, then checked each one's actual layout context before deciding, rather than migrating everything found:

**Migrated**: the previous/next date-navigation arrows in `NotebookRegisterView.js` and `NotebookTimelineView.js` — previously `.btn btn--text` (borderless), now `.btn btn--icon-only`. Checked `.notebook-date-bar`'s layout first (a centered flex row with generous `1rem` gap) and confirmed it comfortably accommodates the larger, bordered circular treatment without disrupting the existing prev-arrow/date-label/next-arrow layout.

**Identified as exceptions, not migrated — with reasoning, per the explicit instruction to explain before implementing these**:
- **`.student-row__more` (Class Mode's "⋮" per-student menu)** — deliberately borderless and transparent today, sitting inline within a list of up to 40–60 simultaneous student rows. Adding a bordered, surface-colored circle to every single row would introduce real visual noise across a screen whose entire design goal — established and repeatedly reinforced across many earlier phases of this project — is fast, at-a-glance scanning of many rows at once. Migrating it would work directly against that goal.
- **`.achievement-card__remove` (the badge "×" dismiss)** — absolutely positioned in the corner of a small achievement card, sized as a bare glyph with no button-box padding at all. A 40×40 bordered circle wouldn't just look oversized here, it would likely break the `top: 0.35rem; right: 0.5rem` corner positioning the current layout depends on.

### Files Modified
- `js/ui/components/UserBar.js`, `js/ui/student-portal/StudentPortalShell.js` — back-link wording.
- `js/ui/views/TrackerView.js` — Reset Session's class.
- `js/ui/views/NotebookRegisterView.js`, `NotebookTimelineView.js` — prev/next arrows migrated to `.btn--icon-only`.
- `css/styles.css` — `.btn--icon-only` redesigned as the shared, authoritative circular treatment.

### Breaking Changes
None — purely visual; no functionality, event handlers, or navigation targets changed anywhere.

### Regression Verification
Confirmed via computed-style comparison (not just a visual check) that Undo, Notebook, and Reset Session render byte-for-byte identically. Confirmed the migrated previous/next arrows render correctly with the new circular treatment inside the actual Notebook Register view, reached through the real navigation flow rather than checked in isolation.

### Future TODOs
- (Carried over, unchanged): resume broader Settings redesign feature work; wire the Student Portal's own dashboard content to the actually-joined student; Phase 2 activity-state recommendations; mobile-viewport testing as standard practice; Student Workspace tab expansion; note-undo gap in `classModeService`; Session Lock and Session History; consolidate avatar implementations; `firestore.rules` review; role-based routing; all previously-listed items.

---

## Lucide Icon Migration — Design System Foundation, Functional Icons Migrated, Celebration Emojis Preserved

**Context:** replacing emoji-based navigation and functional icons with a proper, self-hosted Lucide icon system, while explicitly preserving emoji for celebration/recognition/emotion — implementing the audit and mapping table proposed and confirmed across the prior two phases.

### Foundation
`ui/components/Icon.js` — self-hosted Lucide SVG path data (no CDN dependency, consistent with this project's own established caution about third-party resources stalling on restricted school networks), `createIcon(name, { size, strokeWidth, className })`, `stroke="currentColor"` so every icon inherits its container's color automatically. Grew from ~25 to 28 icons as migration surfaced real needs (`award`, `file-text` added along the way).

### What migrated
Back/forward navigation across every view (`TrackerView`, `UserBar`, `StudentPortalShell`, `SettingsView`, both Notebook views, `ActivitiesView`, `RecognitionScreenView`, `StudentAccessView`, `StudentProfileView`); Class Mode's Undo/Notebook/Reset and Exit Class; the Student Portal's entire 5-tab navigation (Home/Achievements/Team/Learn/Profile); Landing page's Teacher/Student Portal identifier icons; Settings' 3-section tabs, Upload button, and Permissions empty-state icon; the Dashboard widgets (Pending Tasks, Weekly Snapshot, Subjects, Continue Working); Quick Actions Sheet's action icons; the Recognition Wall's team-winner avatar and "View All" link; and the Student Portal's join/sign-in/link-entry hero icons.

### Genuine exceptions found and *not* migrated, with reasoning
- **Class Mode's per-student "⋮" menu** — dense, repeating list (up to 40–60 rows); a bordered circle on every row would add real visual noise against this screen's own established "fast scanning" design goal.
- **Notebook Timeline's day-status symbols** (✅🟡❌🚫⏰•) — checked the actual rendering, not assumed: plain-text string concatenation across a compact multi-day calendar grid, by the config file's own doc comment ("reads cleaner across many dates in a row"). Same density reasoning as Class Mode's menu.
- **Arrows embedded in prose** ("Settings → Groups", "Bucket Changed: Green → Yellow") — punctuation inside a sentence, not standalone UI icons. Left as plain text.
- **`recognitionCategories.js`** — entirely untouched, per explicit instruction to defer individual review of category icons.

### A real, pre-existing bug found and fixed while migrating, not related to icons
`WeeklySnapshotWidget.js`'s stars-count KPI card was using a 📒 notebook icon above a number that's explicitly `totalWeeklyStars` — a mismatch predating this migration. Since stars are explicitly reserved as emoji, the fix was correcting it to ⭐, not migrating it to a Lucide icon.

### A deliberate, flagged inconsistency: the same emoji treated differently by role
🏅 stays as emoji in Session Review and the Recognition Wall (a celebration moment), but was migrated to Lucide's `award` for the Student Portal's own "Achievements" *navigation tab* — there, it's a wayfinding label, not a celebration. Recorded explicitly in the design guide as the one nuance worth calling out, rather than left as an unexplained inconsistency.

### Three real "missing import" bugs found through actual testing, not syntax-checking
`node --check` validates syntax only — it cannot catch a call to an undefined function. Live browser testing caught three files (`SettingsView.js`, `StudentSignInView.js`, `StudentLinkView.js`, `StudentJoinClassroomView.js`) where `createIcon()` was called without ever importing it, which would have thrown a runtime error the moment that code actually ran, despite passing every syntax check along the way. Fixed by systematically grep-checking every touched file for "uses `createIcon` but never imports it" as its own explicit verification step, not just re-running `node --check`.

### One duplicate-declaration mistake caught before moving on
Migrating `StudentJoinClassroomView.js`'s icon, the first edit left both the original `document.createElement('span')` line and the new `createIcon(...)` line assigning to the same `const icon` — caught by reviewing the file afterward, not assumed correct, and fixed before applying the same pattern to the next two files with full context checked first.

### Files Created
- `js/ui/components/Icon.js`
- `docs/icon-design-guide.md`

### Files Modified
Approximately 25 files across `ui/views/`, `ui/components/`, `ui/student-portal/`, and `config/` — see the full list of migrated call sites above; every one syntax-checked individually and re-verified for import correctness.

### Breaking Changes
None to functionality — purely visual. Button labels, click handlers, and navigation targets are unchanged everywhere; only how each icon renders changed.

### Regression Verification
Confirmed via live browser testing (not just syntax checks, given the import bugs those alone missed): Landing page portal icons render as real SVGs; the full teacher flow (sign-in → classroom creation → Settings → adding a student → Dashboard → Class Mode) completes with every migrated icon rendering correctly at each step; the Subjects widget's icon correctly appears once a subject is actually configured; the Student Portal's join screen renders its migrated hero icon; and every celebration emoji (⭐, 🏆, 🥇🥈🥉) was explicitly re-confirmed untouched after the full migration pass, not merely assumed preserved.

### Future TODOs
- Individual review of `recognitionCategories.js`'s icons, deliberately deferred per explicit instruction.
- (Carried over, unchanged): resume broader Settings redesign feature work; wire the Student Portal's own dashboard content to the actually-joined student; Phase 2 activity-state recommendations; mobile-viewport testing as standard practice; Student Workspace tab expansion; note-undo gap in `classModeService`; Session Lock and Session History; consolidate avatar implementations; `firestore.rules` review; role-based routing; all previously-listed items.

---

## Semantic Icon Color System — Implemented Across Portal Pages

**Context:** implementing the semantic color palette from the multi-round mockup/review process (Option B: soft colored circle behind a neutral icon), with Student's color finalized as orange (`#ff9b65`) per explicit approval, including white button text despite the contrast trade-off flagged and accepted along the way.

### Foundation
- `Icon.js`: added `ICON_CATEGORIES` (the eight agreed categories — Teacher, Student, Groups, Notebook, Recognition, Progress, Activities, Settings) and `createIconBadge(iconName, category, options)`, returning a colored-circle-plus-icon element. Deliberately not applied to Class Mode's toolbar or other dense/repeating contexts (per-row menus, notebook timeline symbols) — those stay neutral, consistent with the exception established earlier in this same design-system work.
- `styles.css`: added `.icon-badge` as the shared circular-badge component.

### A real inconsistency caught mid-review, not just a color swap
Testing surfaced that Student's icon circle was using the vivid `#ff9b65` as a solid fill, while Teacher used a pale tint with a rich icon color — structurally different treatments, not just different colors, and the direct cause of the "too saturated" feedback. Fixed by splitting Student into two roles: `#ff9b65` stays exactly where it was approved (the button), while a deeper, same-hue `#BF5F1A` handles the icon specifically, on a matching pale tint (`#FDEEE0`) — mirroring Teacher's actual structure (contrast verified: 4.3:1 for the icon, close to Teacher's own 5.75:1, versus `#ff9b65` itself only ever reaching 2.07:1 as a stroke color).

### White button text — implemented per explicit decision, not my recommendation
Contrast for white text on `#ff9b65` is 2.07:1, well under both the 4.5:1 text standard and even the 3:1 large-text floor — flagged clearly with the actual numbers and a rendered comparison before this was decided. The person reviewing weighed that trade-off and chose white text anyway; implemented as instructed, not re-litigated.

### Applied across
- `LandingView.js` — both portal cards use `createIconBadge`; Student's button reads its category's distinct `button` color instead of the shared primary blue.
- `SubjectsWidget.js`, `WeeklySnapshotWidget.js`, `GroupsWidget.js` — headings migrated to category badges (Notebook, Progress, Groups respectively). `GroupsWidget.js` was still on its original emoji heading, untouched by the earlier Lucide migration — caught and fixed in the same pass rather than left inconsistent.
- `.dashboard-widget__heading` — added `display: flex` + `gap` so badge and heading text align correctly; removed the now-redundant leading space from four widgets' heading text that this uncovered.
- Student Portal chrome (`StudentPortalShell.js`'s CSS) — back-link hover and active-tab colors aligned to the official Student tokens, replacing a slightly different pre-existing orange (`#b8631a`/`#fff0dc`) left over from an earlier phase.
- A new scoped rule (`.student-portal .btn--primary`, `.student-join-code .btn--primary`) themes every primary button inside the Student Portal and its onboarding screens to the Student orange — extending the color scheme to the whole student-facing experience, not just the Landing card, per "across the portal pages."

### Files Modified
`js/ui/components/Icon.js`, `js/ui/views/LandingView.js`, `js/ui/components/SubjectsWidget.js`, `WeeklySnapshotWidget.js`, `GroupsWidget.js`, `ContinueWorkingWidget.js`, `PendingTasksWidget.js` (heading spacing only), `css/styles.css`.

### Not yet extended to
Settings' own tab icons (Settings category exists in the token set but wasn't applied there this pass) and Activities (no Dashboard widget currently surfaces this category). Left as-is rather than forcing a category onto a screen that doesn't need one yet.

### Breaking Changes
None to functionality — visual only. `GroupsWidget.js`'s heading changed from a single text node to icon+text, matching every other migrated widget's structure.

### Regression Verification
Confirmed via computed-style assertions (background-color, color) rather than visual inspection alone: Student's badge tint, button color, and button text color all match the agreed values exactly; a real subject configured through the actual Settings flow correctly surfaces the Subjects widget with the Notebook-violet badge; the Student Portal's join screen button renders in the Student orange via the new scoped CSS rule.

### Future TODOs
- Apply category badges to Settings' own section tabs if a future pass wants full palette coverage.
- (Carried over, unchanged): resume broader Settings redesign feature work; wire the Student Portal's own dashboard content to the actually-joined student; Phase 2 activity-state recommendations; mobile-viewport testing as standard practice; Student Workspace tab expansion; note-undo gap in `classModeService`; Session Lock and Session History; `firestore.rules` review; role-based routing; all previously-listed items.

---

## Teacher Portal Icon: Custom Chalkboard-Easel Replaces bar-chart-3

**Context:** `bar-chart-3` read as "analytics/dashboard," not "teacher." Extensive search for a genuine Lucide icon matching "blackboard with chalk" confirmed Lucide has no such icon — `presentation` is the only icon tagged with blackboard/chalk, but is actually a monitor-on-a-stand shape, not a chalkboard. Rather than force-fit an icon that didn't match the actual request, or hand-draw a guess (the mistake made earlier with the Undo icon), built a small custom icon from simple, verifiable geometric primitives matching the person's own reference images.

### Investigation before drawing anything
Confirmed via web search that Lucide's `presentation` icon exists and is tagged blackboard/chalk/school/lesson, but is a different visual concept (screen on a stand) from a literal chalkboard. Attempted to source its exact path data through several routes (lucide.dev, unpkg, jsDelivr) — got a fully verified alternative (`briefcase`) along the way, but could not retrieve `presentation`'s exact coordinates within reasonable effort. Rather than approximate it from memory, surfaced the trade-off directly and let the actual decision be made with full information.

### The custom icon
`chalkboard-easel` in `Icon.js` — a rounded rectangle (the board) with two straight lines forming splayed easel legs, and two horizontal lines inside representing content, built at the same 24×24 grid and 2px stroke as every Lucide icon in the file. Deliberately built from only rectangles and straight lines (no curves) — the exact category of mistake made with the Undo icon was curve coordinates guessed from memory; a board-on-legs shape has no such risk. Clearly documented in the file as a custom addition, not official Lucide, so it's never mistaken for one later.

### Files Modified
- `js/ui/components/Icon.js` — `chalkboard-easel` added to `ICONS`.
- `js/ui/views/LandingView.js` — Teacher Portal card now uses `chalkboard-easel` instead of `bar-chart-3`.

### Regression Verification
Confirmed by extracting the actual rendered SVG markup from the live DOM (not just visual inspection) — the path data matches exactly what was designed: `<rect width="18" height="12" x="3" y="3" rx="1"/>` for the board, two leg paths, two content-line paths, correctly colored in the Teacher category's blue (`#1565C0`) on its pale tint (`#E6F1FB`).

### Future TODOs
- (Carried over, unchanged): apply category badges to Settings' own tabs and Activities if a future pass wants full palette coverage; resume broader Settings redesign feature work; wire the Student Portal's own dashboard content to the actually-joined student; Phase 2 activity-state recommendations; mobile-viewport testing as standard practice; Student Workspace tab expansion; note-undo gap in `classModeService`; Session Lock and Session History; `firestore.rules` review; role-based routing; all previously-listed items.

---

## Fixed: Invisible Class Mode Toolbar Icons (White-on-White)

**Context:** a screenshot showed Undo, Notebook, and Reset rendering as empty circles — no icon glyph visible at all.

### Root cause, found by tracing CSS specificity, not guessed
`.tracker-header .btn--ghost` — a rule from an earlier phase, written for the header's original *text*-labeled ghost buttons — sets `color: var(--color-on-primary-deep)` (white), so its text would read against the blue header. Undo/Notebook/Reset carry both `.btn--ghost` and `.btn--icon-only` classes, so this older, equally-specific rule was overriding `.btn--icon-only`'s own intended dark icon color. The result: a white icon stroke on the icon-only circle's own white background — technically rendering, just invisible.

### Fix
Added `.tracker-header .btn--icon-only`, matching specificity and placed after the conflicting rule, so the icon-only circular treatment's dark color always wins in this context regardless of the older ghost-button rule sitting alongside it.

### Files Modified
- `css/styles.css`.

### Regression Verification
Confirmed via computed style, not just a visual check: all three buttons now compute to `rgb(26, 26, 26)` (`--color-ink`) instead of white, in a live render of the actual Class Mode toolbar.

---

## Teacher Collaboration Enabled — Retired a Stale "Coming Soon" Placeholder

**Context:** the Setup Wizard's "Invite Teachers" step was permanently hardcoded as "Coming Soon," with placeholder text literally referencing "cloud synchronization" being enabled someday — but this app has been Firestore-backed since early in this project, and the co-teacher join-code mechanism this step was waiting on (`workspaceService.joinClassroomByCode()`, the Teachers section in Settings) has existed and worked for a long time. The placeholder simply never got revisited once the real feature shipped elsewhere.

### Investigation before changing anything
Traced `isComingSoon = key === 'inviteTeachers'` — a hardcoded flag, not a check on whether anything was actually missing. Confirmed Settings' own Teachers section already displays the classroom's join code with working Copy/Share, fully functional. This was the same underlying capability the wizard step was gating on, just never connected.

### Fix
- `classroomDefaults.js` — `inviteTeachers` added to `PROGRESS_STEP_KEYS`, so it now counts toward real setup progress like every other step.
- `SetupWizardView.js` — the hardcoded Coming Soon gate removed from the checklist; `renderInviteTeachersStep` rewritten from the stale placeholder to real content: the classroom's actual join code, a "Share Code & Continue" action that shares/copies it and calls `markStepDone`, and a "Skip — teaching solo" option for teachers who don't need it — matching the exact save/skip pattern every other wizard step already uses.
- `SettingsView.js` — the hardcoded `createStatusRow('Teacher Collaboration (Coming Soon)', false)` replaced with a real status check, matching every other row in that list.

### Files Modified
- `js/config/classroomDefaults.js`, `js/ui/views/SetupWizardView.js`, `js/ui/views/SettingsView.js`.

### Breaking Changes
None — purely additive; no existing step's behavior changed.

### Regression Verification
Confirmed live: the checklist no longer shows "Coming Soon" anywhere; the step displays a real, freshly-generated join code instead of the old placeholder text; the stale "cloud synchronization" line is gone; clicking "Share Code & Continue" completes without error; and Settings' own Teacher Collaboration row reflects real status instead of a hardcoded false.

### Future TODOs
- (Carried over, unchanged): apply category badges to Settings' own tabs and Activities if a future pass wants full palette coverage; resume broader Settings redesign feature work; wire the Student Portal's own dashboard content to the actually-joined student; Phase 2 activity-state recommendations; mobile-viewport testing as standard practice; Student Workspace tab expansion; note-undo gap in `classModeService`; Session Lock and Session History; `firestore.rules` review; role-based routing; all previously-listed items.

---

## Bucket Multiplier Feature Removed

**Context:** investigated whether "Bucket multiplier (Coming Soon)" could be enabled the same way Teacher Collaboration was. Found a genuine difference — the multiplier was never actually built (`scoringSettingsService.js`'s own doc comment: "Not wired to the actual scoring system yet"), and enabling it properly would have also required fixing an adjacent, more fundamental gap: `classModeService.awardStar()` uses a hardcoded `delta = 1` and doesn't even read the classroom's own "Default point value" setting, let alone a bucket multiplier. Surfaced this and asked what the intended multiplier behavior should be, rather than inventing a scoring scheme unilaterally — the decision was to remove the feature entirely instead.

### Removed
- The disabled "Bucket multiplier (Coming Soon)" checkbox from the Configure Scoring wizard step (`SetupWizardView.js`).
- `bucketMultiplierEnabled` from the classroom settings defaults (`classroomDefaults.js`).
- The stale doc-comment reference in `scoringSettingsService.js`.
- Two now-orphaned CSS rules: `.wizard-checkbox-field--disabled` and `.wizard-badge` — the latter was actually orphaned back when Teacher Collaboration's placeholder was fixed in an earlier phase, not caught at the time; found and cleaned up in this same pass.

### Files Modified
- `js/ui/views/SetupWizardView.js`, `js/config/classroomDefaults.js`, `js/services/scoringSettingsService.js`, `css/styles.css`.

### Breaking Changes
None — no classroom ever had this flag doing anything, since nothing read it.

### Regression Verification
Confirmed zero remaining references to "multiplier" anywhere in the codebase. Confirmed live that the Configure Scoring step still works correctly without it — Default point value field, Allow negative points checkbox, and Save & Continue all function exactly as before.

### Future TODOs
- The adjacent gap noticed while investigating remains open and worth its own decision eventually: `awardStar()` doesn't read the classroom's own "Default point value" setting either — every star awards exactly 1 point regardless of what's configured. Not fixed here, since it wasn't what was asked, but worth flagging clearly for whenever scoring configuration is revisited.
- (Carried over, unchanged): apply category badges to Settings' own tabs and Activities if a future pass wants full palette coverage; resume broader Settings redesign feature work; wire the Student Portal's own dashboard content to the actually-joined student; Phase 2 activity-state recommendations; mobile-viewport testing as standard practice; Student Workspace tab expansion; note-undo gap in `classModeService`; Session Lock and Session History; `firestore.rules` review; role-based routing; all previously-listed items.

---

## Group Colors Switched to Pastel

**Context:** the four default group colors (Blue, Purple, Orange, Teal) were fully saturated (`#3B82F6`, `#8B5CF6`, `#F97316`, `#14B8A6`) and felt too vivid.

### More than a color swap — a real contrast dependency found first
`.team-card__header`'s text color was hardcoded to white, which only worked because the original colors were dark/saturated enough. Verified with contrast math before changing anything: white text on any pastel candidate came out to 1.48–1.85:1 (badly failing), while dark text on the same pastels reached 9.4–11.8:1. Pastel backgrounds genuinely require dark text, not just a hex swap.

### A dark-mode bug caught before it shipped, not after
The obvious fix — switching to `--color-ink` — would have introduced a real bug: that token deliberately flips to a light color in dark mode, but the pastel background itself doesn't change with theme (it's a fixed hex). That combination would have produced light text on a light pastel background specifically in dark mode. Found the exact right token already established for this precise scenario — `--color-on-brand`, explicitly documented in this project's own CSS as "theme-independent, for text on top of a brand-color fill" — and used that instead. Confirmed directly: rendering the same component in both light and dark mode produced byte-identical background and text colors, exactly as intended.

Also updated the star-count pill's background from a white-tinted overlay (invisible on a light background) to a dark-tinted one, for the same underlying reason.

### Files Modified
- `js/config/groupColorConfig.js` — the four hex values.
- `css/styles.css` — `.team-card__header` text color and `.team-card__total` pill background.

### Breaking Changes
None to functionality — purely visual, and any classroom's existing group color *assignment* (which color ID a group has) is untouched; only what each color ID actually renders as changed.

### Regression Verification
Verified by rendering the actual `TeamCard.js` component directly with mock data (not just reading the CSS) in both light and dark mode via `page.emulateMedia`: confirmed the pastel background and dark text render identically in both, and the choice of `--color-on-brand` over `--color-ink` is what makes that true.

### Future TODOs
- (Carried over, unchanged): fix `awardStar()` not reading the classroom's own "Default point value" setting; apply category badges to Settings' own tabs and Activities if a future pass wants full palette coverage; resume broader Settings redesign feature work; wire the Student Portal's own dashboard content to the actually-joined student; Phase 2 activity-state recommendations; mobile-viewport testing as standard practice; Student Workspace tab expansion; note-undo gap in `classModeService`; Session Lock and Session History; `firestore.rules` review; role-based routing; all previously-listed items.

---

## Landing Page Title Split into Class/Mate Colors

**Context:** implementing the finalized brand exploration — "Class" in Teacher blue, "Mate" in Student orange, same font as before (a slab-serif alternative was explored and explicitly rejected in favor of keeping the existing bold sans-serif).

### A real bug caught before shipping, not after
The natural first implementation used `var(--color-primary-deep)` for "Class," matching how the rest of the app references the teacher-blue token. Checked its actual definition first and found it's not a fixed brand color at all — it's a teacher's *personal, customizable* accent color preference (one of 5 options), overridden per-classroom via inline style once loaded. Using it here would mean "Class" silently changed color for any teacher who'd picked a non-default accent, breaking the fixed blue/orange pairing established everywhere else (the CM icon, the portal cards). Fixed by hardcoding `#1565C0` directly, matching how "Mate"'s orange was already a fixed hex rather than a token.

Verified this was a real risk, not a theoretical one: tested the exact scenario that would have exposed it — created a classroom, confirmed its actual loaded accent was a different blue (`#5ea6da`, not the default), navigated back to the Landing page via the persistent SPA session, and confirmed the title's "Class" span still correctly rendered the fixed `#1565C0` rather than picking up the still-active override.

### Files Modified
- `js/ui/views/LandingView.js` — title restructured into two spans instead of one text node.
- `css/styles.css` — `.landing-view__title-class` and `.landing-view__title-mate` added.

### Breaking Changes
None — purely visual.

### Regression Verification
Confirmed via computed style on a fresh landing page (correct colors on first load) and, more importantly, after actually loading a non-default accent color in a real classroom and returning to the Landing page via in-app navigation — the exact scenario that would have surfaced the token-vs-fixed-color bug if it existed.

### Future TODOs
- (Carried over, unchanged): fix `awardStar()` not reading the classroom's own "Default point value" setting; apply category badges to Settings' own tabs and Activities if a future pass wants full palette coverage; resume broader Settings redesign feature work; wire the Student Portal's own dashboard content to the actually-joined student; Phase 2 activity-state recommendations; mobile-viewport testing as standard practice; Student Workspace tab expansion; note-undo gap in `classModeService`; Session Lock and Session History; `firestore.rules` review; role-based routing; all previously-listed items.

---

## Invite Teachers Wording Clarified — Not Changed to a Student Invitation

**Context:** flagged as "the invitation text is outdated... this should be a student invitation, not a co-teacher invitation." Traced it to the Setup Wizard's "Invite Teachers" step, and found something important before changing anything: that text shares `classroom.classroomJoinCode` — the co-teacher code, which grants full read/write classroom access via `addSelfAsTeacher()` when redeemed. A separate, already-correct student-facing flow exists in `StudentAccessView.js`, using `classroomStudentJoinCode` with already-appropriate wording — that one needed no changes.

### Why the literal instruction wasn't followed as stated
Rewriting this step's text to sound like a student invitation while leaving it tied to the co-teacher code would have created a dangerous mismatch: the message would say "join as a student," but redeeming that code actually grants full co-teacher access — not a student's read-only roster view. That's not a wording fix, it's a functional trap. Flagged this directly rather than complying with the literal request.

### What actually happened, and the real fix
The likely cause of the confusion: a brand-new, likely-solo teacher reaches this step immediately after Configure Scoring — before ever seeing the real student invite flow in Settings — and reasonably assumes "the invite step in front of me" is about students. Fixed by making this step's own wording unmistakable about what it does and where the real student invite lives, rather than changing what it invites someone as.

### Changed (messaging only, confirmed via live test that the underlying code is untouched)
- The step's on-screen intro now explicitly states this grants "full access to students, scores, and settings — not a student invitation," and points to Settings → Student Access for the real student invite.
- The actual shared message (sent via native share or copied to clipboard) now also explicitly says "with full access to students and scores," as a second safety layer for whoever receives it directly, not just whoever is looking at the screen.

### Files Modified
- `js/ui/views/SetupWizardView.js` — two text strings only. `classroom.classroomJoinCode` (which code is used), `addSelfAsTeacher()` (what redeeming it does), and `StudentAccessView.js` (the separate, correct student flow) are all completely untouched.

### Breaking Changes
None — messaging only, verified live that the same `classroomJoinCode` value still displays and shares correctly.

### Future TODOs
- (Carried over, unchanged): fix `markStudentJoinedPortal()`'s unsupported write under production Firestore rules; fix `awardStar()` not reading the classroom's own "Default point value" setting; apply category badges to Settings' own tabs and Activities if a future pass wants full palette coverage; resume broader Settings redesign feature work; wire the Student Portal's own dashboard content to the actually-joined student; Phase 2 activity-state recommendations; mobile-viewport testing as standard practice; Student Workspace tab expansion; note-undo gap in `classModeService`; Session Lock and Session History; role-based routing; all previously-listed items.

---

## Fixed: Student Portal Failing to Load — markStudentJoinedPortal Made Fault-Tolerant

**Context:** first-time students hit `FirebaseError: Missing or insufficient permissions` at `StudentDeviceFlow.js:61`, preventing the Student Portal from ever loading after entering a code and picking a name.

### 1. Which Firestore operation is actually failing
Not a read — a **write**. `markStudentJoinedPortal()` first does a `get` on `/classrooms/{id}` (succeeds fine — the get/list rules split from the earlier security review explicitly allows this for unauthenticated students), then calls `saveClassroom()`, an `update`, to flip one student's `hasJoinedPortal` flag.

### 2. Why the current rules reject it
This is the exact gap identified — but not yet fixed — in the earlier security reviews. Student devices have zero Firebase Auth (deliberate: no sign-in, no PIN). The `update` rule requires `request.auth != null`, so every write from a student device fails this check outright. There's no safe way to write a rule permitting "mutate exactly this one deeply-nested field" without also permitting an unauthenticated visitor to rewrite scores or students — already explained in `firestore.rules`' own comments.

### 3. Which of the three options — a genuine code change, not a query change or a delay
Delaying the read doesn't apply — this is a write, and it happens at the moment a student picks their name, which is exactly when it should. Modifying the query doesn't apply either — this isn't a malformed query, it's an auth mismatch no query shape can work around. The right fix: make `markStudentJoinedPortal()` itself fault-tolerant. It already exists specifically to update a "narrow, teacher-visible indicator, not an account or session record" — its own doc comment says so. There's no reason this specific, low-stakes write failing should block a student from reaching the Portal at all.

### 4 & 5. Rules were not changed
No rules change was made or is recommended for this fix — the goal (first-time student reaches the Portal successfully) is fully achieved by the code change alone. The rules gap is real and still tracked, but weakening rules to paper over it isn't necessary here.

### The fix
Wrapped `markStudentJoinedPortal()`'s body in try/catch. A failure is caught and logged as a non-blocking warning; the student proceeds regardless. Placed inside the service function itself (not the one call site in `StudentDeviceFlow.js`) so any future caller gets this same protection automatically.

### Files Modified
- `js/services/workspaceService.js`.

### Breaking Changes
None. When Firestore rules eventually support this write safely (the still-open recommendation: restructure `hasJoinedPortal` to a top-level field), it will simply start succeeding — no code path depends on it failing.

### Regression Verification
Reproduced the exact reported failure directly: a mock repository that succeeds on `getClassroomOnce` but throws the literal `FirebaseError: Missing or insufficient permissions` on `saveClassroom` (matching real unauthenticated-write behavior). Ran the full flow — enter code, see the real roster, pick a name — end to end. Confirmed zero uncaught errors (the actual bug, now fixed), the expected non-blocking warning logs instead, and the flow completes and hands off to the Portal successfully despite the underlying write failing, exactly as intended.

### Future TODOs
- (Carried over, still open): restructure `hasJoinedPortal` to a top-level field on the classroom document, so a Firestore rule *can* safely permit this write instead of it silently failing every time. Not blocking — Student Access's "has joined" indicator just won't reflect reality until this is done.
- (Carried over, unchanged): fix `awardStar()` not reading the classroom's own "Default point value" setting; apply category badges to Settings' own tabs and Activities if a future pass wants full palette coverage; resume broader Settings redesign feature work; wire the Student Portal's own dashboard content to the actually-joined student; Phase 2 activity-state recommendations; mobile-viewport testing as standard practice; Student Workspace tab expansion; note-undo gap in `classModeService`; Session Lock and Session History; role-based routing; all previously-listed items.

---

## Student Home Dashboard Wired to Live Data — Verified Live This Time

**Context:** continuation of the previous entry, which made the code changes but couldn't complete live verification due to a sustained sandbox infrastructure issue at the time. That issue resolved; this entry documents the actual live testing and one real bug it caught.

### What live testing caught that static review didn't
Testing a real classroom (a student with actual score history, badges, and a real team) against a brand-new student (zero score, zero badges, no group assignment) surfaced a genuine bug: a student not manually assigned to a group is placed in a special default "Ungrouped" bucket (see `classroomService.js` — `{ ...createTeam({ name: 'Ungrouped' }), isUngrouped: true }`). The first version of the fix displayed this literally — "Ungrouped" as the team name, with "Leading the class!" as the caption, since it technically out-ranked other empty teams. Correct to the data, but a misleading thing to tell a student who isn't really on a team yet.

### Fix
Used the reliable `team.isUngrouped` flag (not a fragile name match) to treat this bucket as "not assigned" from the student's own perspective, across all three places team status is read: `getHomeSummary()`, `getTeamSummary()`, and `getCurrentStudentProfile()`.

### Live verification (this time actually completed)
Two full scenarios run end-to-end through the real join flow (enter code → pick name → land on Home):
- **A student with real data** (2 stars this week, 2 badges, on a real team): Home showed "2" stars, "Group A" / "Leading the class!", "2" recognitions with "Latest: Helper," Achievements listed both real badges, Team screen showed the correct teammate (self correctly excluded) and correct team star total. Zero console errors.
- **A brand-new, unassigned student**: Home showed "0" stars, "Not assigned yet" / "Ask your teacher to add you to a group," "0" recognitions with "Nothing yet — keep going!," "0 days" streak, Team screen showed "Not assigned to a group yet — ask your teacher." Zero console errors.

### Files Modified (this entry)
- `js/services/studentPortalDataService.js` — the `isUngrouped` handling, three call sites.

### Regression Verification
Both scenarios above, live, via a real browser automated through the actual join flow — not assumed from reading the code.

---

## Student Home Redesigned — Progressive Disclosure

**Context:** implementing the agreed product redesign — Student Home now answers "what should I do next?" instead of surfacing every metric at once, several of them empty. Full design discussion in the two preceding conversation turns.

### Module visibility, as agreed
- **Welcome header, My Stars, My Team, Today's Goal** — always shown. Stars and Team now teach the reward system through encouraging copy before real data exists ("Your teacher awards stars during class...", "You'll be placed into a team soon...") rather than hiding the concept or showing a bare `0` / "Not assigned yet."
- **Recognition Wall** — only once the student has at least one badge.
- **Learning Journey** — only once there's a real, active streak.
- **Continue Learning removed entirely** — not even a "Coming soon" placeholder, since Learning Hub doesn't exist. A module that doesn't exist yet shouldn't occupy a slot on screen.

### Data service changes
`getHomeSummary()` now also returns `studentName` and `classroomName` (needed for the new greeting logic — "Welcome to {classroom}!" for a student with zero activity anywhere, "Welcome back, {name}!" once any real activity exists). Removed the now-unused `learningActivityInProgress` field, since nothing renders it anymore.

### One judgment call flagged, not hidden
The team module doesn't distinguish "just joined a team" from "been on this team for weeks" — both show rank-based captions ("Leading the class!" / "Ranked #X") once a real team exists. I don't have a reliable "team age" signal to gate a softer initial message on, and inventing one felt riskier than being upfront that this is a simplification versus the original mockup's suggestion of a gentler landing period.

### Files Modified
- `js/ui/student-portal/views/StudentHomeView.js` — full rewrite.
- `js/services/studentPortalDataService.js` — two fields added, one removed.
- `css/styles.css` — cards switched from a grid to a single stacked column; new `Today's Goal` module styling added.

### Breaking Changes
None to data or other views — `getAchievements()` and `getTeamSummary()` are untouched.

### Regression Verification
Live-tested three real scenarios end to end through the actual join flow, not assumed from reading the code:
- **Day 1, zero activity**: "Welcome to Grade 8A!", Stars and Team both show teaching/anticipation copy, Recognition and Journey correctly absent, Today's Goal present. Zero console errors.
- **Immediately after first star**: greeting correctly flips to "Welcome back, Rohan!", Stars shows "1" with "Your first star! Keep it up.", Team correctly still shows anticipation copy (unchanged, still ungrouped). Zero console errors.
- **Mature classroom, several weeks of activity**: Stars "8", Team "Group A" / "Leading the class!", Recognition Wall "3" / "Latest: Team Player" (correctly the most recently-awarded badge). Zero console errors.

One path not exercised: a non-zero Learning Journey streak, since constructing realistic mock notebook-check history was out of proportion to this pass — the gate logic (`journeyStreak > 0`) is straightforward and shares the same underlying function already verified correct on the teacher side, but this specific display state should get a quick look once real notebook data exists.

### Future TODOs
- (Carried over, unchanged): restructure `hasJoinedPortal` to a top-level field so a Firestore rule can safely permit that write; fix `awardStar()` not reading the classroom's own "Default point value" setting; apply category badges to Settings' own tabs and Activities if a future pass wants full palette coverage; resume broader Settings redesign feature work; Phase 2 activity-state recommendations; mobile-viewport testing as standard practice; Student Workspace tab expansion; note-undo gap in `classModeService`; Session Lock and Session History; role-based routing; all previously-listed items.

---

## Automatic Deployments via GitHub Actions

**Context:** implementing the agreed automation, having first corrected a real misconception — `firebaseConfig.js` was being treated as a secret (gitignored, described as ".env-like") when Firebase's client-side config is actually designed to be public; real access control lives in Firestore Security Rules, not in hiding this file. That correction simplified the automation significantly: no GitHub Secret or generation step needed for it, since it's just committed and checked out normally.

### Changed
- `.gitignore` — removed `js/config/firebaseConfig.js`, since it's committed now.
- `js/config/firebaseConfig.example.js` — doc comment rewritten to explain accurately why this isn't sensitive, replacing the previous ".env file" framing.
- `README.md` — two fixes: the Firebase setup section's stale "real credentials... treat it like a `.env` file" language corrected, and the entire "GitHub Pages deployment" section (genuinely stale — this project deploys to Firebase Hosting, not GitHub Pages, and hadn't been updated when that changed) replaced with the new automatic workflow: develop locally → commit → push to `main` → GitHub Actions deploys to Firebase Hosting automatically.
- `.nojekyll` removed — a GitHub Pages-specific artifact with no purpose now that hosting is on Firebase.

### Added
- `firebase.json` — standard static-site Hosting config. No SPA rewrite rules included, since this app's routing is hash-based (`#/...`), which never reaches the server on navigation.
- `.firebaserc` — project alias pointing at `classmate-302c2`, inferred from the hosting URL and flagged for confirmation rather than assumed silently.
- `.github/workflows/firebase-hosting-merge.yml` — deploys to the live site on every push to `main`.
- `.github/workflows/firebase-hosting-pull-request.yml` — temporary preview deployment for every pull request, expiring automatically, never touching the live site.

### Known gap this entry does not resolve — needs your action, not mine
Two things I cannot do myself, flagged clearly rather than worked around:
1. **The real `firebaseConfig.js` doesn't exist in this project copy** — I don't have your actual six config values (only the project ID, inferred from your hosting URL). This file needs to be created with real values and committed before any deploy — by you, or by you pasting me the six values.
2. **The `FIREBASE_SERVICE_ACCOUNT_CLASSMATE_302C2` GitHub secret these workflows depend on doesn't exist yet** — creating it requires `firebase init hosting:github`, an interactive command needing your own Firebase/GitHub authentication, which I cannot run on your behalf.

Neither workflow will succeed until both of these exist. This isn't a partial implementation — every file that *can* be written without your credentials has been, and is ready to work the moment those two things are in place.

### Breaking Changes
None to the app itself. Anyone who had previously relied on the documented GitHub Pages deployment path would need to switch to the new one — but per this same discussion, that path was already stale relative to what's actually being used.

### Regression Verification
All new config files validated as well-formed (JSON parse, YAML parse). Full project JS syntax check passed. Live end-to-end deployment verification was not possible from this sandbox — no network access to Firebase/GitHub, and the two gaps above mean a real run isn't possible yet regardless. This needs to be confirmed by an actual push once you've completed the two steps above.

---

## Two Real Bugs Fixed: Student Profile Page, and Missing Group Reassignment

**Context:** surfaced while verifying the automated deployment pipeline was actually serving fresh code — a genuine, useful side effect of that verification.

### Bug 1: Student Portal Profile page showed "?" avatar and empty fields
`StudentProfileView.js` (the Student Portal's own Profile tab — distinct from the similarly-named teacher-side `js/ui/views/StudentProfileView.js`) called `getCurrentStudentProfile()` synchronously. That function was made async during an earlier session's data-service rewrite, and every other consumer was found and fixed at the time — this one was missed, since the search for consumers wasn't run comprehensively enough in that pass. Fixed: the view is now async, awaits properly, has a real empty state if no profile loads, and shows "Not assigned yet" for an ungrouped student's Group field instead of a blank one.

### Bug 2: No way to move a student between groups, anywhere in the app
Investigating the reported "no option to regroup" turned up something bigger than expected: this capability didn't exist at all, not even in Settings — only rename and remove existed for an existing student. Once assigned (or left in the default "Ungrouped" bucket), a student was stuck; the only workaround was removing them entirely and re-adding them by name into Ungrouped, losing their score, badges, and history in the process.

Built the missing capability properly rather than patch around it:
- `studentService.moveStudentToTeam()` — the actual missing operation, preserving everything about the student except which team's `students` array they live in.
- `classModeService.changeGroupQuick()` — mirrors the existing `changeBucketQuick()` exactly: logs a timeline entry ("Moved to Group B"), supports undo (moves back, no new entry on reversal).
- `QuickActionsSheet.js` gained a fifth action, "Change Group," following the identical one-tap-deep pattern already established for "Change Bucket."

### Files Modified
- `js/ui/student-portal/views/StudentProfileView.js` — async fix, empty states.
- `js/services/studentService.js` — `moveStudentToTeam()`.
- `js/services/classModeService.js` — `changeGroupQuick()`, plus the new `studentService` import.
- `js/ui/components/QuickActionsSheet.js` — the new action and its options sub-menu.
- `js/ui/views/TrackerView.js` — wired `groupOptions` and `onChangeGroup` into the existing quick-actions call site.
- `css/styles.css` — one small addition for the "no other groups yet" empty note.

### Breaking Changes
None. Both fixes are purely additive or corrective — no existing behavior changed for anyone not hitting the bug.

### Regression Verification
Both fixed live, not just read back in code:
- **Profile page**: tested both a student in a real group (showed real name, initials-based avatar, classroom, "Group A", role) and an ungrouped student (showed "Not assigned yet" instead of blank). Zero console errors in both.
- **Change Group**: created a second group in a real classroom, long-pressed a student sitting in "Ungrouped," opened "Change Group," confirmed it correctly listed only the *other* team as an option, tapped it, and confirmed both the toast ("TestKid moved to a new group") and the actual team card layout updated — the student now genuinely appears under the new group. Zero console errors.

### Future TODOs
- (Carried over, unchanged): restructure `hasJoinedPortal` to a top-level field so a Firestore rule can safely permit that write; fix `awardStar()` not reading the classroom's own "Default point value" setting; apply category badges to Settings' own tabs and Activities if a future pass wants full palette coverage; resume broader Settings redesign feature work; Phase 2 activity-state recommendations; mobile-viewport testing as standard practice; Student Workspace tab expansion; note-undo gap in `classModeService`; Session Lock and Session History; role-based routing; all previously-listed items.
- New, from this entry: the `pages-build-deployment` workflow spotted in the GitHub Actions sidebar during the deployment troubleshooting session suggests GitHub Pages may still be enabled on this repo from before the switch to Firebase Hosting — worth confirming and disabling it if so, so only one deployment target is active.
