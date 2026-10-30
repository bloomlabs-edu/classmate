# Contributing to Classroom Tracker

Thank you for helping build Classroom Tracker. This guide covers how the
project is organised and how to contribute changes cleanly.

## Ground Rules

- **No frameworks, no build step.** This project intentionally uses plain
  HTML, CSS, and vanilla JavaScript. Please don't introduce bundlers,
  frameworks, or external runtime dependencies without discussing it with
  the team first.
- **Respect the layer boundaries** described in the `README.md` project
  structure:
  - `models/` — data shape only, no logic
  - `services/` — business logic, no DOM access
  - `storage/` — persistence only, hidden behind `storageAdapter.js`
  - `ui/` — rendering and DOM only, no business logic
  - `utils/` — small, dependency-free helpers
  - `config/` — the app's vocabulary and tunable settings (Event types,
    scoring weights, general config); no logic beyond simple constants/maps
- **This project is event-driven.** Everything a Fellow logs — an academic
  update, a behavioural note, an attendance mark — is recorded as an
  `Event` (see `models/Event.js`) rather than overwriting a student's
  state directly. When adding a new kind of thing to log, add it as a new
  Event `type` in `config/actionTypes.js` rather than introducing a
  parallel, non-Event data structure.
- **Never commit sensitive personal data.** Do not commit contact details,
  government identity numbers, health/medical information, caste or
  religion data, or photos/videos of students — in code, comments, sample
  data, or test fixtures. If a feature seems to require this kind of data,
  escalate to the AI Working Committee before implementing it.
- **Never commit real credentials.** `js/config/firebaseConfig.js`
  holds live Firebase project credentials and is gitignored — treat it
  like a `.env` file. Never overwrite it with placeholder values, never
  regenerate it, and never include it in an exported/shared copy of the
  project. `firebaseConfig.example.js` is the template new contributors
  copy from; only that file should ever be edited or committed.

## Getting Set Up

See the "Getting Started" section in `README.md` for how to run the project
locally.

## Branching & Commits

- **Use a dedicated Git worktree for each independent feature or fix** —
  run `node scripts/newWorktree.mjs short-description`, which creates
  `feature/short-description` off `main` in a sibling directory
  (`../classmate-short-description`). This repo's primary checkout is not
  the default place for parallel feature work — see `AGENTS.md` for the
  full policy (this applies to AI agents and human contributors alike).
- Keep commits focused and descriptive
- Write commit messages in the imperative mood, e.g. `Add classroom service
  for creating classrooms`
- Review `git diff --cached` before every commit

## Code Style

- Formatting is enforced by Prettier — see `.prettierrc`. Run
  `npx prettier --write .` before committing.
- Editor defaults (indentation, line endings, charset) are defined in
  `.editorconfig` — most editors pick this up automatically.
- Use descriptive names for functions and variables; prefer clarity over
  cleverness.
- Keep functions small and single-purpose.

## Pull Requests

- Describe **what** changed and **why**, not just a list of files touched
- Link to any related issue or milestone
- Keep pull requests scoped to a single feature or fix where possible
- Note any new placeholder files that were filled in, and which
  architectural layer they belong to

## Adding a New File

When adding a new file to `js/`, place it in the layer it belongs to
(`models/`, `services/`, `storage/`, `ui/`, `utils/`, or `config/`) and add
a short header comment describing its purpose, following the style already
used in the placeholder files.

## Questions

If anything about the architecture or conventions is unclear, please raise
it with the team before working around it — it's easier to adjust the
structure early than to refactor later.
