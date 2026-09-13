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
