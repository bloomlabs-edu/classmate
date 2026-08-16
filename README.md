# Classroom Tracker

A lightweight, offline-first tool to help Teach For India Fellows track classroom
performance, behavioural observations, and student progress — built with plain
HTML, CSS, and vanilla JavaScript, with no external frameworks or backend
dependencies.

> **Status:** Architecture scaffolding milestone. No features are implemented
> yet — this milestone establishes the project structure only. See
> [`docs/problem-statement.md`](docs/problem-statement.md) for the problem
> this project aims to solve.

---

## Project Structure

```
classroom-tracker/
├── README.md                  # You are here
├── CONTRIBUTING.md            # Guidelines for contributing to this project
├── .editorconfig              # Consistent editor settings across the team
├── .gitignore                 # Files and folders excluded from version control
├── .prettierrc                # Code formatting rules
│
├── docs/
│   └── problem-statement.md   # The problem this project solves, and who it's for
│
├── tests/                     # Test files (structure only — no tests yet)
│
├── assets/
│   ├── icons/                 # Icon assets (not added yet)
│   └── images/                # Static image assets (not added yet)
│
├── index.html              # Application entry point (placeholder)
│
├── css/
│   └── styles.css          # Global stylesheet (placeholder — UI not built yet)
│
├── data/
│   └── sample-classroom.json  # Fictional fixture data for local dev/testing
│
└── js/
    ├── main.js             # Application bootstrap / entry script
    │
    ├── config/             # Centralised configuration and vocabulary
    │   ├── actionTypes.js      # The fixed set of Event types (the action vocabulary)
    │   ├── scoringConfig.js    # How Event types map to derived scores/weights
    │   └── appConfig.js        # General app-wide settings (storage keys, locale, etc.)
    │
    ├── models/             # Plain data structures describing core concepts
    │   ├── Student.js          # Student record shape
    │   ├── Classroom.js        # Classroom / cohort record shape
    │   └── Event.js            # Event record shape — the core unit of the event log
    │
    ├── services/           # Business logic that operates on models
    │   ├── classroomService.js    # Classroom-level operations (create, update, list)
    │   ├── studentService.js      # Student-level operations
    │   └── eventService.js        # Recording and querying Events
    │
    ├── storage/             # Persistence layer (swappable backend)
    │   ├── storageAdapter.js      # Interface/contract all storage adapters follow
    │   └── localStorageAdapter.js # Browser localStorage implementation
    │
    ├── ui/                  # Rendering and DOM-facing code (not built yet)
    │   ├── components/
    │   │   └── README.md        # Notes on planned UI components
    │   └── renderer.js          # Placeholder for DOM rendering logic
    │
    └── utils/               # Small, dependency-free helper functions
        ├── validators.js        # Input validation helpers
        ├── dateHelpers.js       # Date formatting/parsing helpers
        └── idGenerator.js       # Unique ID generation helper
```

### Why this structure?

- **`models/`** — describes *what the data looks like*, with no logic attached.
- **`services/`** — describes *what the app can do* with that data (business
  logic), independent of how it's displayed or stored.
- **`storage/`** — isolates persistence behind an adapter interface, so the
  storage backend (currently browser `localStorage`) can be swapped later
  without touching services or UI.
- **`ui/`** — isolates all DOM manipulation and rendering, so it can be
  changed or rebuilt without affecting business logic.
- **`utils/`** — small, reusable, dependency-free helpers used across layers.
- **`config/`** — centralises the app's vocabulary and tunable settings
  (Event types, scoring weights, general app config) so they aren't
  hardcoded or duplicated across services, models, and the future UI.
- **`data/`** — holds fictional fixture/sample data for local development,
  kept separate from anything a Fellow actually enters.
- **`assets/`** — static, non-code assets (icons, images) used by the UI,
  kept separate from application logic.

This separation keeps each layer independently testable and lets us build
features incrementally without reworking the foundation.

### Event-Driven Architecture

Classroom Tracker is built around a single core concept: the **Event**.
Rather than storing and mutating a student's "current state" directly
(e.g. overwriting a progress field), the app records discrete, timestamped
Events — an academic update, a behavioural note, an attendance mark — and
derives current state, history, and trends from that event log.

- **`models/Event.js`** defines the shape of a single Event.
- **`config/actionTypes.js`** defines the fixed vocabulary of Event types
  the app understands (e.g. `academic`, `behavioural`, `attendance`).
- **`config/scoringConfig.js`** defines how each Event type contributes to
  any derived scores or standings.
- **`services/eventService.js`** contains the logic for recording and
  querying Events.

This approach keeps a full, auditable history of everything logged for a
student or classroom, and makes it straightforward to add new Event types
or scoring rules later without reshaping existing data.

---

## Getting Started

This project has no build step. As of Sprint 4 it has one external
runtime dependency — Firebase Authentication, loaded via CDN for Google
Sign-In — everything else is still plain HTML/CSS/vanilla JS. You'll
need a modern web browser and a local static file server (to avoid
`file://` CORS restrictions, and because Google Sign-In requires a real
`http(s)://` origin).

### 1. Clone the repository

```bash
git clone <repository-url>
cd classroom-tracker
```

### 2. Set up Firebase (Authentication + Firestore)

The app won't sign anyone in or load any classrooms until this is done.
`js/config/firebaseConfig.js` holds your Firebase project's web app
config and is committed to the repository — this isn't a secret;
Firebase's client-side config is designed to be public, since anyone
using the deployed app can already see these values in their browser's
dev tools. Real access control happens through Firestore Security
Rules (see `firestore.rules`) and the Authorized Domains list below,
not through hiding this file. See
[`js/config/firebaseConfig.example.js`](js/config/firebaseConfig.example.js)
for the full checklist and every field's placeholder:

1. Copy `firebaseConfig.example.js` to `firebaseConfig.js` in the same
   folder.
2. Create (or open) a project at the
   [Firebase console](https://console.firebase.google.com).
3. Project Settings → General → "Your apps" → add a Web app, and copy
   its config object into your new `firebaseConfig.js`, replacing the
   placeholders.
4. Authentication → Sign-in method → enable **Google**.
5. Authentication → Settings → Authorized domains → add whatever domain
   you're serving the app from (`localhost` is included by default).
6. Firestore Database → Create database (production mode is fine — the
   security rules below handle access control).
7. Firestore Database → Rules tab → paste the contents of
   [`firestore.rules`](firestore.rules) → Publish. This restricts every
   teacher to their own `teachers/{uid}/classrooms/` documents — see
   that file's comments for what it enforces and why.

### 3. Serve the project locally

Any static file server works, run from the repository root. For example, using Python:

```bash
python3 -m http.server 8000
```

Or using Node's `http-server` (if installed globally):

```bash
npx http-server . -p 8000
```

Or with VS Code's Live Server extension, right-click `index.html` at
the repository root and choose "Open with Live Server."

Then open `http://localhost:8000` in your browser.

### Deployment — automatic, via GitHub Actions

The workflow is: **develop locally → commit → push to GitHub → GitHub
Actions deploys to Firebase Hosting automatically.** There's no manual
deploy command to remember day to day.

- Every push to `main` deploys to the live site
  ([classmate-302c2.web.app](https://classmate-302c2.web.app)) and
  the current `firestore.rules` — see
  `.github/workflows/firebase-hosting-merge.yml`. (Hosting and
  Firestore rules are deployed together as two steps in the same
  workflow — kept in sync deliberately, after a production incident
  where a new Firestore rule was added locally but never reached the
  live project, since Hosting deploys alone don't touch rules at all.)
- Every pull request gets its own temporary preview URL, so changes
  can be reviewed live before merging — see
  `.github/workflows/firebase-hosting-pull-request.yml`. Preview
  channels expire automatically after a few days and never touch the
  live site.
- No build step — this is a plain static HTML/CSS/JS app with no
  bundler, so the checked-out repository is deployed exactly as
  committed, `firebaseConfig.js` included.

**One-time setup for a new clone of this repo** (already done for the
main repository — only relevant if you're setting up your own fork's
deployment):
1. `firebase login`
2. From the repository root: `firebase init hosting:github` — this
   guided command creates a Firebase service account, adds it as an
   encrypted GitHub secret automatically, and asks which branch
   triggers deployment (`main`) and whether to enable PR previews
   (yes).
3. Push — the workflow files above already exist in this repo, so
   this step just needs the GitHub secret it depends on
   (`FIREBASE_SERVICE_ACCOUNT_CLASSMATE_302C2`) to exist for your fork.

**If you ever need to deploy manually** (e.g. testing a change to the
workflow files themselves): `firebase deploy --only hosting` from the
repository root, same as before automation existed.

### 4. Formatting

This project uses [Prettier](https://prettier.io) for consistent code
formatting. Configuration lives in `.prettierrc`. If you have Prettier
installed:

```bash
npx prettier --write .
```

---

## Contributing

Please read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a pull
request.

## Project Status

This milestone covers project scaffolding only:

- [x] Folder structure and modular architecture
- [x] Placeholder files with documented responsibilities
- [x] Project documentation (problem statement, contributing guide)
- [x] Editor and formatting configuration
- [ ] Feature implementation (upcoming milestones)
- [ ] UI build-out (upcoming milestones)

No features have been implemented and no UI has been built as part of this
milestone.
