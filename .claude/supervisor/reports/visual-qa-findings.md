# Visual QA findings log

Append-only. One section per specialist run. Findings here are reports, not
decisions — the Supervisor/user decide what (if anything) to do with them.
Corresponding work-registry entries are cross-referenced by `WORK-000N` id.

---

## FINDINGS-0001 — First calibration pass (4 no-auth routes, 2 viewports)

- **Date:** 2026-09-13
- **Work item:** `WORK-0004`
- **Run as:** general-purpose agent carrying the classmate-visual-qa persona inline (the real `classmate-visual-qa` custom agent type exists at `.claude/agents/classmate-visual-qa.md` but this session's agent registry was loaded at startup and doesn't pick up newly created custom agent types — see the operational note in `reports/session-reports.md` REPORT-0003). Findings quality should still be judged as if it were the real agent; the instructions given were the persona's own text.
- **Scope:** `#/` (Landing), `#/teacher` signed out (Login gate), `#/student` (Student portal entry), `#/visitor` no code (Visitor Access) — the only 4 routes reachable with zero authentication. At 1440x900 and 1024x768.
- **Mechanism:** Playwright + Chromium (already cached locally), app served via `npx http-server` on a local port, no production Firebase touched.

### No breakage found
No blank/failed renders, no horizontal overflow, no cut-off text/buttons, no responsive breakage between 1440px and 1024px on any of the 4 routes.

### Findings
1. **Wordmark color inconsistency (Landing vs. Teacher gate).** The "Class" half of "ClassMate" renders in a lighter/softer blue on Landing (`js/ui/views/LandingView.js`) than on the Teacher sign-in gate (`js/ui/views/LoginView.js`) — same word, two different blues, not a rendering artifact. **Flagged as overlapping active work — see `CONFLICT-0002`.**
2. **Code-input placeholder styling.** On both Student entry and Visitor Access, the "E.G. ABCD12" placeholder renders in a monospace font with each character/group in a different, seemingly arbitrary color — inconsistent with the sans-serif type used everywhere else, reads as unintentional rather than a deliberate accent.
3. **Inconsistent inline text-highlight scope.** Student entry highlights only the word "your" in its subtext; Visitor Access highlights two words, "your colleague," in near-identical subtext copy. Same apparent shared component, inconsistent highlight rule between the two call sites.

### Supervisor's read on usefulness (not a product decision, just a calibration note)
The findings are concrete and image-grounded (not generic design commentary), correctly distinguished "nothing wrong" (no false positives invented to look thorough) from real, specific inconsistencies, and correctly flagged the one finding that overlaps active user work rather than treating it as settled. This suggests the visual-judgement approach is viable for the next phase — but this was only 4 static, low-complexity pages; it says nothing yet about performance on dense/data-heavy authenticated screens, which remain out of reach until a safe auth path exists (see the "Auth scope" note in `.claude/agents/classmate-visual-qa.md`).

## FINDINGS-0002 — Second pass: real classmate-visual-qa agent, +768px/390px (4 no-auth routes)

- **Date:** 2026-09-13
- **Work item:** `WORK-0005`
- **Run as:** the real `classmate-visual-qa` custom agent type, loaded correctly this session (the prior `WORK-0004` run had to be carried out by a general-purpose agent impersonating this persona because that session's agent registry hadn't picked up the newly created `.claude/agents/classmate-visual-qa.md` — that limitation is gone now).
- **Scope:** same 4 zero-auth routes as `WORK-0004` — `#/` (Landing), `#/teacher` signed out (Login gate), `#/student` (Student portal entry), `#/visitor` no code (Visitor Access). 1440px and 1024px re-checked for continuity; 768px and 390px are new coverage.
- **Mechanism:** Playwright + Chromium (already present as a devDependency/cached browser), app served via `npx http-server . -p 8931 -c-1` on a local port, no production Firebase touched. Console/page-error listeners attached for every route; none fired on any of the 16 loads. `document.documentElement.scrollWidth` vs `clientWidth` checked programmatically for every route/viewport — equal in all 16 cases (no horizontal overflow anywhere). Capture script was written temporarily inside the repo root (to resolve `node_modules`) and deleted before finishing; `git status` confirmed clean of anything beyond the pre-existing `WORK-0001` state.

### Routes x viewports inspected
All 4 routes at all 4 widths (16 screenshots, full-page):

| Route | 1440 | 1024 | 768 | 390 |
|---|---|---|---|---|
| `#/` Landing | rendered clean | rendered clean | rendered clean | rendered clean |
| `#/teacher` (signed out gate) | rendered clean | rendered clean | rendered clean | rendered clean |
| `#/student` (entry) | rendered clean | rendered clean | rendered clean | rendered clean |
| `#/visitor` (no code) | rendered clean | rendered clean | rendered clean | rendered clean |

"Rendered clean" = not blank, no visible startup-error banner, no console/page errors, no horizontal scroll, no clipped/overflowing text or buttons, no overlapping elements.

### No breakage found (OBSERVED)
- No blank or failed renders on any of the 16 route/viewport combinations.
- No horizontal overflow at any width, including 390px — confirmed both visually and via `scrollWidth === clientWidth`.
- No text/button clipping, no overlapping elements, no broken text wrapping on any route at any width.
- The Landing page's two-column card grid (Teacher Portal / Student Portal) collapses cleanly to a single stacked column at 768px and 390px, with consistent card width, padding, and button sizing at each step down — this is correct, deliberate-looking responsive behavior, not a finding against it.
- Typography scales down proportionally at each width without any sign of an unset/broken breakpoint (e.g. the "ClassMate" wordmark and body copy shrink together, headings stay legible, no orphaned single words in headings).

### Findings carried over from WORK-0004 — reconfirmed at all 4 widths, not new

1. **Wordmark color inconsistency (Landing vs. Teacher gate) — OBSERVED, reconfirmed at all 4 widths.** The "Class" half of "ClassMate" is a lighter/softer blue on Landing (`js/ui/views/LandingView.js`) versus a deeper, more saturated blue on the Teacher sign-in gate (`js/ui/views/LoginView.js`), identically at 1440/1024/768/390px — i.e. this is a fixed color-value difference between the two files, not something that only shows up at certain widths. **CONFLICT — overlaps active work.** `LandingView.js` is one of the five files under `WORK-0001` (user's own in-progress, uncommitted edits). Per instructions, this is flagged as a potential conflict rather than an actionable bug — see `CONFLICT-0002` (updated this run to include `WORK-0005`). It is unknown whether the user's in-progress edit already touches this color, already knows about it, or is unrelated.
2. **Code-input placeholder styling — OBSERVED, reconfirmed at all 4 widths.** On both Student entry and Visitor Access, the "E.G. ABCD12" placeholder text renders in a monospace font with each character/letter-group in a different color (grey/orange/blue-ish tones visible across the string), inconsistent with the sans-serif type used everywhere else on the same screen. Visible identically at all 4 widths — not a viewport-dependent rendering artifact. Does not touch any `WORK-0001` file (shared code-input component is not among the five listed).
3. **Inconsistent inline highlight scope — OBSERVED, reconfirmed at all 4 widths.** Student entry's subtext highlights only the word "your" ("Enter **your** classroom code to get started"); Visitor Access's structurally similar subtext highlights two words, "your colleague" ("Enter the code **your colleague** shared with you to start the tour"). Same apparent shared subtext-highlight styling, different highlight-scope decision between the two call sites. Visible identically at all 4 widths. Does not touch any `WORK-0001` file.

### New for this run (768px / 390px specific)
No new findings distinct from the above. The three carried-over findings are the only presentation issues visible at any width; there is no additional breakage, spacing regression, or layout failure that appears only at 768px or 390px. Whitespace balance (a large empty band above and below the centered content block on Landing, Teacher gate, Student entry, and Visitor Access) is present and proportionally consistent across all 4 widths — noted as a plain observation (OBSERVED), not flagged as a defect, since nothing about it changes or breaks between viewports and the previous run did not flag it as wrong either.

### Classification summary
- **OBSERVED:** all 3 carried-over findings above (directly visible and reproduced screenshot-to-screenshot across all 4 widths); the "no breakage" conclusion for all 16 route/viewport combinations; the whitespace-balance observation.
- **INFERRED:** none this run — nothing required inference beyond what was directly visible in the screenshots.
- **UNCERTAIN:** none this run for the 4 inspected routes. (Authenticated/data-rich routes remain out of reach and are not commented on here.)

### Confidence / reliability note for this run
This was 4 static, low-complexity, no-auth pages at 4 widths each — a straightforward case for visual QA (no dynamic data, no auth-gated state, no animation timing to catch). Confidence in the "no breakage" conclusion is high given the console/page-error instrumentation and the programmatic overflow check backing up the visual read, not just eyeballing. This run says nothing new about performance on dense/data-heavy authenticated screens (Dashboard, Curriculum, Timetable, card grids), which remain out of reach without a safe auth path — same caveat as `WORK-0004`.

## WORK-0006 — Re-run request evaluated as duplicate (no new specialist pass performed)

- **Date:** 2026-09-13
- **Work item:** `WORK-0006` (Supervisor evaluation, not a specialist run)
- **Request:** Run Visual QA on the same 4 zero-auth routes (`#/`, `#/teacher`, `#/student`, `#/visitor`) at 1440/1024/768/390px — identical scope and viewports to `WORK-0005`.
- **Determination:** No new `classmate-visual-qa` run was delegated. `WORK-0005` already covered this exact scope (all 4 routes x all 4 viewports) as the real agent type, with 0 new breakage and the same 3 findings reconfirmed at every width (see FINDINGS-0002 above). `git status` at request time showed the relevant files unchanged since that run — `WORK-0001`'s affected files (including `LandingView.js`) were in the same uncommitted state, and no other route-relevant files had changed. A third identical pass over unchanged rendered output was judged to produce no new information.
- **No new findings.** This entry exists purely as a record of the evaluation, not a new inspection. FINDINGS-0001/FINDINGS-0002 remain the current, complete findings for this scope.
- **Standing note:** this is not a permanent skip rule — see `WORK-0006` notes in `work-registry.json` for what would trigger a fresh pass (WORK-0001 committed/changed, expanded scope, or meaningful time elapsed).
