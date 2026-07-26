# ClassMate Icon Design Guide

This is part of ClassMate's design system, not a one-off note about an icon swap. It exists so every future screen makes the same calls this migration made, without re-deriving the reasoning from scratch each time.

## When to use an icon

Use an icon when it labels a **screen, action, or status** — something a teacher or student needs to *find* or *understand at a glance*, not something they need to *feel*. Back/forward navigation, Settings tabs, Undo/Reset/Notebook actions, and status indicators (complete/incomplete/pending) are all wayfinding devices. An icon's job is to be understood in under a second, ideally without even reading the label next to it.

## When not to use an icon

**Don't use an icon for celebration, recognition, or emotion.** A star awarded to a student, a trophy on the Recognition Wall, a medal ranking, a streak counter — these represent an earned or felt moment, not a destination or a status. An outline icon is calm and neutral by design; that's exactly wrong for a moment that's supposed to feel warm. See "When emojis are appropriate" below.

**Don't use an icon in a dense, repeating list or grid.** Class Mode's per-student row menu and the Notebook Timeline's day-by-day status grid both deliberately kept small, plain glyphs instead of bordered icon components — in a screen showing dozens of rows or cells at once, a compact glyph scans faster than a bordered circle repeated dozens of times. If a new screen shows many repeated small indicators side by side, treat that density the same way before reflexively reaching for the icon system.

**Don't use an icon to replace prose.** "Settings → Groups" inside a sentence is punctuation, not a UI icon — leave arrows like that as plain text. Only convert something to an icon when it's a standalone, tappable, or purely visual element on its own.

## Outline vs. filled

**Outline only, everywhere, no exceptions today.** Every icon in `ui/components/Icon.js` is stroke-based (`fill="none"`, `stroke="currentColor"`). This is a single, absolute rule specifically so no future screen has to make a filled-vs-outline judgment call per icon — consistency here is worth more than any single icon looking marginally better filled. If a genuine need for a filled/active state ever comes up (e.g., a toggled-on state), that's a new design decision to make deliberately, not something to slip in ad hoc.

## Sizing

- **20px** is the default, used for icon+text pill buttons and most standalone icons.
- **16px** for icons sitting inside compact contexts — Settings tabs, small labeled buttons.
- **28–32px** for a single, prominent identity icon on its own screen (Landing page portals, the Student join/sign-in screens' hero icon).

Pick from these three, don't invent a fourth size for one spot. If nothing fits, that's a sign the layout needs solving some other way, not a new size added quietly.

## Stroke width

**2px is the default; 1.5px only for large (28px+) hero icons**, where a 2px stroke starts to look heavy at that size. Never go below 1.5 or above 2 — a thinner stroke starts to disappear on lower-resolution displays, a thicker one stops looking like the rest of the system.

## Spacing

Icon+text buttons use a **0.5rem gap** between the icon and its label, enforced by the `.btn:has(.icon)` rule rather than per-button margin — this is why every migrated button lines up identically without needing to remember a spacing value each time. Icon-only circular buttons are unchanged from the existing `.btn--icon-only` sizing (40×40px, established in the action-design-language pass).

## Accessibility

Every icon created by `createIcon()` is `aria-hidden="true"` and `focusable="false"` by default — **the icon is never the accessible name**. The rule this enforces: any button or link using an icon must already carry a visible text label, or an explicit `aria-label`/`title` on the parent element, exactly as every migrated button in this pass does. If a new icon-only button doesn't have one of those two things, that's a bug to fix before shipping, not an acceptable gap.

## When emojis are appropriate

Emoji are reserved for **celebration, recognition, achievement, and emotion** — moments where warmth matters more than precision:

- ⭐ — the core star-award symbol
- 🏆 🏅 🎖 — recognition and badges
- 🥇 🥈 🥉 — achievement ranking
- 🎉 — celebration moments
- 🔥 — streaks specifically (not every "fire" use — confirm the context is genuinely a motivational streak, not a status)

**Recognition category icons** (`config/recognitionCategories.js`) are a deliberately separate, deferred decision — not yet reviewed individually, and not to be treated as settled either way until that review happens.

**The same emoji can mean different things in different roles** — this is the one nuance worth stating explicitly, because it's counterintuitive. 🏅 stays as emoji when it represents an actual earned badge in a celebratory moment (Session Review, the Recognition Wall), but the Student Portal's own "Achievements" *navigation tab* uses 🏅's Lucide equivalent (`award`) instead — because in that spot, it's not celebrating anything, it's labeling where to find celebrations. When adding a new icon, ask which role it's playing, not just which glyph looks right.

## Adding a new icon

1. Check the celebration/functional test above before reaching for Lucide by default.
2. If it's functional, check whether an existing name in `ICONS` already fits before adding a new one — the set should grow deliberately, not duplicate.
3. Copy the icon's official Lucide SVG path data into `ui/components/Icon.js`'s `ICONS` map — self-hosted, not a CDN reference, consistent with why this system exists in the first place (see that file's own doc comment).
4. Use `createIcon(name, { size, strokeWidth, className })` — never hand-build a new inline `<svg>` elsewhere in the app.
