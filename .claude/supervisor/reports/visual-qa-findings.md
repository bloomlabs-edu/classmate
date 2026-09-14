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

## FINDINGS-0003 — Third pass: Bento-consistency-specific audit (4 no-auth routes, 4 viewports, new report format)

- **Date:** 2026-09-13
- **Work item:** `WORK-0013`
- **Run as:** the real `classmate-visual-qa` custom agent type.
- **Scope:** same 4 zero-auth routes as `WORK-0004`/`WORK-0005` — `#/` (Landing), `#/teacher` signed out (Login gate), `#/student` (Student portal entry), `#/visitor` no code (Visitor Access) — at 1440px, 1024px, 768px, 390px. Before running, the agent checked the codebase itself (grepped for `connectAuthEmulator`/demo-mode/mock-auth wiring in `js/services/firebaseApp.js` and elsewhere) and confirmed no safe local/dev auth path exists to reach authenticated screens (dashboard, curriculum, recognition, timetable, etc.) without live production credentials — so "portal-wide" in the originating request could not actually be achieved this pass either; this is a re-verified scope limitation, not a shortcut.
- **Mechanism:** Playwright + Chromium against a local `http-server` (port 8933, stopped afterward) — 16 fresh full-page screenshots (4 routes x 4 viewports). Console/`pageerror` listeners attached (zero fired) and `scrollWidth`/`clientWidth` compared (equal, no overflow) at all 16 combinations.
- **Why this was run rather than treated as a `WORK-0006`-style duplicate skip:** the underlying routes/viewports are identical to `WORK-0005`, and the working tree has not changed since (confirmed via `git status` — same `WORK-0001` files, same untracked `docs/design/`), but the *requested report format* differs materially: a Bento-specific consistency lens, explicit OBSERVED/INFERRED/UNKNOWN confidence framing, systemic-vs-isolated framing, and 6 explicit Bento-assessment questions, none of which `WORK-0004`/`WORK-0005` were asked to produce. Substantive findings reproduced identically to the prior two passes (no drift, as expected since nothing in scope has changed) — this pass's value is the new analytical lens and framing, not new defects.

### Findings

- **FINDING-A01 (WARNING, OBSERVED).** The wordmark "Class" (of "ClassMate") renders in a different blue on Landing versus the Teacher sign-in gate, reproducing identically at all 4 widths. This is the same underlying issue already tracked as `CONFLICT-0002` (first flagged at `WORK-0004`, reconfirmed at `WORK-0005`) — now a third independent confirmation, not a new finding. Overlaps `js/ui/views/LandingView.js`, a `WORK-0001` file. `CONFLICT-0002` updated to record this as a 3rd confirmation; its severity/status/resolution were not changed.
- **FINDING-A02 (WARNING, OBSERVED).** The classroom-code input placeholder "E.G. ABCD12" (shared component, used by both Student entry and Visitor Access) renders in two unrelated colors within the same placeholder string — "E.G." in amber, "ABCD12" in green. Substantively the same placeholder-styling issue first noted at `WORK-0004`/`WORK-0005` (there described as multi-color per character/group), now restated with specific color values and OBSERVED framing. Does not touch any `WORK-0001` file.
- **FINDING-A03 (INFO, OBSERVED).** Inconsistent inline-highlight scope between Student entry's "your" and Visitor Access's "your colleague" in near-identical subtitle copy. Same underlying issue as previously reported at `WORK-0004`/`WORK-0005`, restated with OBSERVED framing. Does not touch any `WORK-0001` file.
- **FINDING-A04 (INFO, OBSERVED).** Large, unstructured empty space below content on all 4 screens, most pronounced at 1440/1024px on the Teacher gate and Visitor Access. This is the same whitespace-balance characteristic already noted at `WORK-0005` (there explicitly recorded as "present and proportionally consistent... noted as a plain observation, not flagged as a defect"), now formally logged as an INFO-severity finding under the Bento-specific lens rather than a passing aside. Partially overlaps `LandingView.js` (one of the 4 screens exhibiting it); the other 3 screens involved (`LoginView.js`, student-portal onboarding, `VisitorAccessView.js`) are not `WORK-0001` files, and the characteristic itself is general/systemic across all 4 screens rather than localized to anything `WORK-0001` is actively changing.
- **FINDING-A05 (INFO, OBSERVED, positive finding).** Zero console/page errors, zero horizontal overflow, clean responsive stacking/reflow across all 16 route x viewport combinations.

### The agent's own 6 explicit answers (specialist's assessment, not a ratified product decision)

1. Bento consistency assessment is necessarily bounded to these 4 entry/gate screens — it cannot speak to Dashboard/Curriculum/Recognition, which are exactly where "Bento" is most on display per the codebase's own Recognition redesign (`WORK-0009`).
2. Strongest example of the Bento system: Landing's two portal-picker cards.
3. Biggest inconsistencies: FINDING-A01 and FINDING-A02.
4. Pages most needing attention: Teacher gate and Visitor Access (combines a hard finding with the emptiest layout).
5. Overall assessment: "mostly one coherent system" — the two color inconsistencies (A01, A02) are what puncture that read.
6. Prioritized list: A01 > A02 > A04 > A03 > A05.

### Classification summary

- **OBSERVED:** all 5 findings above, directly visible and reproduced screenshot-to-screenshot across all 4 widths; the "no breakage" / zero-overflow conclusion for all 16 combinations.
- **INFERRED:** none this run.
- **UNKNOWN:** none for the 4 inspected routes. Authenticated/data-rich routes remain out of reach and are not commented on here — same standing caveat as `WORK-0004`/`WORK-0005`.

### Conflict-log disposition (Supervisor judgment, recorded per the Safety Principle rather than left implicit)

- **FINDING-A01:** already covered by `CONFLICT-0002` — updated to add `WORK-0013` as a 3rd independent confirmation. No new conflict entry.
- **FINDING-A02, FINDING-A03:** do not touch any `WORK-0001` file — no overlap with active work exists to record. No conflict entry.
- **FINDING-A04:** touches `LandingView.js` as 1 of 4 screens exhibiting the same characteristic, but (a) it is INFO severity, (b) it is a general/systemic layout characteristic present identically across all 4 screens (not localized to whatever `WORK-0001` is actually changing in `LandingView.js`), and (c) it was already observed in identical substance at `WORK-0005` without prompting a conflict entry then. Judged not to constitute a new, distinguishable overlap risk beyond what already exists in the record — no new conflict entry created for it. This is a judgment call, recorded here rather than silently applied, so a future session (or the user) can revisit it if they read the registry's "record even at INFO" principle more strictly.

### Not done

No implementation work item created for any finding — this is an audit-only pass. No product code, `docs/design/`, or `WORK-0001` file was modified. No commit, push, or deploy performed.

### CORRECTION APPENDED 2026-09-14 (FINDING-A02 downgraded to false positive; FINDING-A04 characterization corrected)

A task-discovery investigation (see `WORK-0015`) re-examined `FINDING-A02` and `FINDING-A04` above while looking for a small, decision-free UI improvement to hand to a coding-agent orchestration run. Both findings are corrected below. Neither correction was prompted by new screenshots — both were established by direct code/DOM inspection, and by reproducing the `FINDING-A02` visual effect outside the ClassMate codebase entirely.

- **FINDING-A02 — now understood to be a browser/tooling rendering artifact, not a real product defect.** `css/styles.css` has zero `::placeholder` rules for any selector (confirmed by grep — no hits at all), and the actual input elements (`js/ui/student-portal/onboarding/StudentJoinClassroomView.js`, `js/ui/views/VisitorAccessView.js`) carry no `pattern`, `autocomplete`, or `inputmode` attribute that could trigger a browser-native OTP/verification-code color heuristic. Decisively: the same two-tone placeholder-text effect was reproduced on a bare, unstyled `<input>` in a standalone HTML file with no ClassMate CSS or JS involved at all — including on a placeholder with no code-like pattern whatsoever (`"test text here"` also rendered split into two colors). This confirms the effect is a Chromium/Playwright headless-rendering artifact (likely a font-substitution/antialiasing quirk in placeholder-text rendering), not anything in this codebase. **There is nothing to fix in application code.** Future Visual QA runs should not re-flag this as an actionable product defect without this caveat; if it resurfaces, treat it as a test-tooling characteristic to note, not a bug to assign.
- **FINDING-A04 — the "upper-third, empty space below" characterization is corrected.** Direct inspection of `css/styles.css` confirms `.login-view`, `.student-join-code`, and `.landing-view` all already use `display: flex; justify-content: center;` with `min-height: 100vh` (or `100dvh`) — i.e. content is already deliberately, correctly vertically centered, not sitting in the upper third with a dead zone below, as originally described. Independently confirmed by rendering `#/teacher` fresh at 1440x900 and measuring the live DOM: `.login-view` height computed to exactly `window.innerHeight` (900px), `document.documentElement.scrollHeight` was also 900px (no extra scrollable content), and the wordmark/subtitle/button block sat visually centered with roughly symmetric whitespace above and below — not the asymmetric pattern originally reported. The residual, truthful part of the original observation — these are sparse, minimal single-card screens with a lot of overall negative space — still stands, but addressing that would mean deciding what compositional content to add or how to restructure the hierarchy, which is a product/design decision, not a mechanical layout bug. **Not actionable within a decision-free-improvement constraint.**

See `WORK-0015` and `reports/session-reports.md` `REPORT-0017` for the full investigation account, including why `FINDING-A03` was also considered and rejected (requires a content/wording judgment call, out of scope for the same reason).
