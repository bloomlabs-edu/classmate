# ClassMate — UI Consistency Guidelines

**Version:** 0.3  
**Status:** Working / Evolving  
**Last updated:** 8 September 2026

---

## Purpose

These guidelines translate the ClassMate branding foundation into practical UI rules.

The goal is **not to make every screen look identical**.

The goal is to make every screen feel like it belongs to the same product.

> **One visual language. Two expressions.**

The Teacher and Student landing pages are the primary visual reference points.

---

# 1. Core ClassMate UI Principles

ClassMate interfaces should feel:

- Clear
- Organized
- Warm
- Approachable
- Modern
- Human
- Quietly playful

The UI should communicate:

> **“I can understand this.”**

And, wherever possible:

> **“This makes my job easier.”**

---

# 2. Teacher vs Student

ClassMate uses one shared design system with two expressions.

## Teacher Mode

**Clarity + Organization**

Prioritize:

- information hierarchy
- scanning
- efficient interaction
- structured layouts
- functional feedback
- appropriate information density

**Feeling:** “Everything is organized.”

## Student Mode

**Joy of Learning**

Prioritize:

- discovery
- curiosity
- visible progress
- breathing room
- expressive colour
- delightful interaction

**Feeling:** “I want to explore this.”

### Rule

> **Differentiate by experience, not by identity.**

Teacher and Student interfaces should clearly belong to the same ClassMate product.

---

# 3. Colour

## Approved Direction

> **Blue + Orange**

The current ClassMate UI colour palette is approved and should be retained.

Do not redesign the palette without a specific functional reason.

## Teacher

Blue is the primary interaction colour.

Use it for:

- primary actions
- active navigation
- selected states
- important interaction cues
- contextual emphasis

## Student

Orange is the primary expressive colour.

Use it for:

- primary actions
- active states
- progress and discovery cues
- moments of emphasis or celebration

## Supporting Colours

Muted purple, green, pink, peach/yellow and other existing supporting colours may be used when they communicate meaningful categories or states.

### Rule

> **Colour creates expression; it does not create complexity.**

Colour should not be the only way meaning is communicated.

## Contrast

Every text/background pairing must be legible at a glance, not just on close inspection.

- Muted/secondary text (timestamps, metadata, helper copy) must remain clearly readable against its surface — if a colour looks "washed out" when squinting, it fails.
- Do not pair a warm accent colour (yellow/orange) as *text* against a pale tint of that *same* family (e.g. orange text on a pale peach background). Use the accent as a background tint with dark ink text, or as an icon/border accent, instead.
- When in doubt, use `--color-ink` or `--color-muted` for body/metadata text and reserve saturated colour for icons, borders, badges and short labels, not paragraphs.

### Rule

> **An accent colour used as a tint needs dark ink text on top of it, not more of itself.**

---

# 4. Page Backgrounds & Surfaces

The default ClassMate environment uses:

- light neutral page backgrounds
- white content surfaces
- subtle borders
- restrained shadows

The visual hierarchy should come primarily from:

1. spacing
2. typography
3. grouping
4. subtle surface differences
5. colour

Avoid excessive shadows or decorative backgrounds.

---

# 5. Page Headers

## Default Page Header

The preferred default Teacher Mode pattern is:

```text
Light background

← Back

Page Title

Content
```

Use dark text for the page title and reserve blue for actions and meaningful states.

### Avoid

Using a large full-width blue title bar as the default page-header treatment.

A coloured header may be used when it has a clear contextual purpose, such as a live classroom/session experience.

### Rule

> **A coloured header is a contextual component, not the default page shell.**

---

# 6. Typography

## Typeface

> **Plus Jakarta Sans**

Use it consistently across the product.

## Hierarchy

Typography should create clear levels between:

- page titles
- section titles
- card titles
- labels
- body text
- supporting metadata

Strong headings should be visually prominent without becoming oversized.

### Teacher

Prioritize:

> hierarchy + scanning + precision

### Student

Prioritize:

> hierarchy + emphasis + invitation

Do not use different typefaces for the two modes.

---

# 7. Bento Layout

Bento is a core ClassMate layout language.

It means:

> **Organizing related information into distinct, purposeful spaces.**

Bento is especially useful for:

- dashboards
- navigation hubs
- collections
- feature discovery
- grouped actions
- summaries

### Teacher Bento

> **Organize complexity.**

### Student Bento

> **Organize possibilities.**

### Rule

> **Bento when it improves comprehension.**

Do not force Bento onto:

- data tables
- complex forms
- calendars
- timelines
- long lists
- full-screen learning experiences

---

# 8. Cards

Cards should be used as meaningful containers, not decoration.

Shared characteristics:

- soft/moderate corner radius
- white or lightly tinted surface
- subtle border
- restrained elevation
- clear hierarchy
- generous internal spacing

## Teacher cards

Prioritize:

> information density + scanning

## Student cards

Prioritize:

> discovery + engagement

Cards may vary in size when their content demands it, but the underlying visual treatment should remain recognizable.

## Containment

A card is a container, not just a border drawn around content.

Avoid:

- content or controls touching a card's own edge
- two cards' borders sitting flush against each other with no visible gap
- text that reads as cramped against its own control's edge (inputs, buttons, badges)

Use generous internal padding (a full spacing step, not a sliver) and a real gap between sibling cards — grouping should be obvious without the borders having to touch to prove it.

### Rule

> **A container should show its own edges, and never anyone else's.**

---

# 9. Buttons & Actions

## Primary action

Primary actions should normally be:

- compact
- visually prominent
- easy to scan
- clearly labelled
- aligned with the current mode colour

### Teacher

Primary action → blue

### Student

Primary action → orange

## Full-width actions

Avoid using full-width coloured bars for ordinary actions such as:

- Add Subject
- Create Assessment
- similar page-level actions

Use a compact button unless the action genuinely benefits from a full-width CTA.

### Rule

> **Action prominence should reflect action importance.**

## Intentional sizing

A button's width should come from its own label and padding, never from stretching to fill whatever container it happens to sit in.

Good:

```text
[ + Add Unit ]
```

Bad:

```text
[                         + Add Unit                         ]
```

A full-width control is appropriate only when there is a deliberate reason for it in that specific context (e.g. a single primary action at the bottom of a narrow modal, or a mobile-only stacked layout) — never as an accidental default.

In practice this most often happens when a button is a direct child of a flex column with the browser's default `align-items: stretch` — every such container should either set `align-items: flex-start` (or an equivalent) for its controls, or give the control its own natural-width rule. Check for this specifically whenever a button looks unexpectedly wide.

Buttons should have:

- a natural, content-based width
- consistent horizontal padding for their size class
- a consistent height within the same context
- a clear visual distinction between primary, secondary, text/ghost and destructive treatments

Do not flatten this hierarchy by making every button the same weight — a screen with one primary, some secondary and one destructive action should make all three legible at a glance.

---

# 10. Navigation

Navigation should remain consistent across the product.

Shared navigation principles:

- simple line icons
- consistent icon sizing
- clear labels
- obvious active state
- restrained colour
- predictable placement

Teacher Mode should emphasize orientation and efficiency.

Student Mode can be slightly more expressive, but navigation must remain familiar.

**Global mode-switch affordances.** Some screens aren't just destinations —
they're a whole different *mode* of using the classroom (Class Mode is the
canonical example: a teacher can be running it while looking at almost any
other classroom screen conceptually, so jumping into it shouldn't require
detouring back through Home/Overview first). Any such mode must be reachable
from the *same* persistent nav surface (sidebar on desktop, bottom nav on
mobile) that's already mounted on every classroom-scoped screen — not a new,
second navigation system, and not "just another large button" bolted onto
one page. It needs its own distinct label and icon so it reads as a mode
switch rather than a peer of Overview/Home (e.g. a "play" glyph, not a
generic "people" icon shared with a roster screen).

**The classroom selector is wayfinding, not a chrome action.** It lives
inside the dark top bar alongside app-level controls (notifications, sign
out), but it answers a different question — "which classroom am I even
in, and can I switch?" — so it needs its own visually distinct surface
(a tinted/outlined pill, not flat text on the bar's background) with
sufficient contrast in its default/hover/focus states, rather than blending
into the rest of the chrome or clashing with it via an unrelated bright
colour. On narrow viewports it should truncate to a short label with a
chevron rather than disappearing or wrapping the bar.

---

# 11. Iconography

Use:

> **Simple, rounded, purposeful line icons.**

Icons should have:

- consistent stroke weight
- rounded geometry
- minimal detail
- high legibility

Icons should improve recognition.

They should not be added merely to make a screen look more decorated.

## Peer items still need to be tellable apart

A set of peer cards/items (Subjects, categories, types) should not all default to the same one icon just because they're structurally equal — that gives a teacher nothing to scan by except re-reading every label. Vary the glyph per item using a small, explicit keyword-to-icon mapping with a sensible fallback, while keeping colour/tint identical across the set (see Section 3 — colour stays restrained; the icon shape carries the variety, not a new colour per item).

---

# 12. Spacing

ClassMate should maintain a generous and predictable spacing rhythm.

Prioritize:

- consistent page margins
- consistent section spacing
- consistent card padding
- consistent grid gaps
- sufficient breathing room

When a screen feels crowded, first examine:

1. spacing
2. hierarchy
3. grouping

before adding more visual elements.

## Breathing room

Every screen needs deliberate space between sections, cards, controls, labels/inputs, and between content and the container's own edge. Nothing should read as accidentally touching an edge — if it does, that's a missing spacing step, not a stylistic choice.

Use the existing spacing scale (`--space-1` through `--space-7`) rather than inventing one-off pixel/rem values. If none of the existing steps feels right in a specific spot, that is a signal to reconsider the layout, not a reason to hand-write a new margin.

---

# 13. Data-Heavy Interfaces

Not every ClassMate page should become Bento.

Tables and matrices are appropriate when the user needs to compare large amounts of structured information.

Examples include:

- assessment gradebooks
- checkpoint matrices
- progress tracking

For these interfaces:

- preserve useful density
- maintain clear headers
- use colour semantically
- keep controls consistent
- avoid decorative card treatments that reduce usable space

### Rule

> **Use the layout that makes the information easiest to understand.**

---

# 14. Semantic Colour

Colour should communicate meaningful states.

Examples:

- success
- needs attention
- developing
- strong
- awaiting action
- error

Semantic colours should be:

- consistent
- distinguishable
- supported by text/icons where appropriate
- legible: a semantic colour used as text must still meet the contrast rule in Section 3 — a status colour that's hard to read has failed at its one job

Use them sparingly and where they carry real meaning (a state, a result, a warning) — not as general decoration.

Never rely solely on colour to communicate an important state.

---

# 15. Empty States

Empty states should be:

- clear
- calm
- useful
- concise

They should tell the user:

1. what is currently empty
2. why it may be empty, if useful
3. what they can do next, when applicable

Avoid oversized illustrations or excessive decoration unless the context benefits from it.

## Compact empty states

The default empty-state treatment (centered, capped width, generous top/bottom padding) is sized for a state that IS the page's entire content. Reusing it unchanged inside an already-bounded container — a Bento tile, a card, a small panel — turns one short sentence into a large void, working against Section 12's own breathing-room rule rather than serving it.

Inside a tile or card, use a compact treatment instead: left-aligned, no forced max-width, modest padding that reads as "one quiet line," not "a whole empty page."

### Rule

> **An empty state's size should match its container, not always the same fixed treatment.**

---

# 16. Illustration & Visual Delight

> **Illustration adds feeling; it should not add complexity.**

Teacher Mode:

> **Quiet confidence**

Student Mode:

> **Curiosity + discovery + joy**

Visual delight should be more expressive in Student Mode, while Teacher Mode should remain focused.

---

# 17. Motion

Motion should be:

- fast
- purposeful
- unobtrusive

Teacher Mode:

> **Motion helps you understand.**

Student Mode:

> **Motion helps you feel progress.**

Avoid motion that delays or distracts from completing a task.

---

# 18. Consistency Test

Before approving a new screen, ask:

### Visual

- Does it use Plus Jakarta Sans?
- Does it use the approved ClassMate colours?
- Does it use the established surface treatment?
- Are radii, borders and shadows consistent?
- Does the spacing feel like ClassMate?

### Structural

- Is the information grouped clearly?
- Is Bento being used where it helps?
- Is another layout more appropriate?
- Is the primary action obvious?

### Mode

For Teacher:

> Does this feel clear and organized?

For Student:

> Does this feel inviting and encourage learning?

### Product

> Could this screen sit next to the existing landing page without feeling like it came from another product?

If the answer is no, identify the specific visual rule that is being violated rather than redesigning the entire screen.

### Baseline defect check

Before calling any screen finished, check it for these — their absence is the baseline, not bonus polish:

- misalignment
- inconsistent or missing spacing
- unintentional sizing (stretched buttons, oversized controls)
- unclear hierarchy
- poor contrast
- broken responsive behaviour at common widths
- missing or unclear interaction affordances (does it look clickable?)
- accidental overlaps or edge collisions
- excessive whitespace in one area next to cramped whitespace in another

A screen with none of these defects is the starting point for "done," not an optional final pass.

---

# 19. Golden References

## Teacher Golden Reference

**Teacher Landing Page**

Use it as the primary reference for:

- page background
- cards
- spacing
- typography
- blue usage
- information hierarchy
- overall density

## Student Golden Reference

**Student Landing Page**

Use it as the primary reference for:

- student colour expression
- Bento composition
- card variety
- visual warmth
- progress/achievement expression
- discovery-oriented layout

These references establish the **visual direction**, not a requirement to copy their exact layouts.

---

# 20. Current Audit Direction

The existing product contains several visual generations.

### Keep / use as references

- Teacher Landing Page
- Classroom Hub
- Live Classroom
- Assessment Gradebook
- Class Feed

### Bring forward

- Classroom Management
- Learning
- Learning Subject Detail
- Assessment Index
- Goals Dashboard
- Teaching Programmes
- Teaching Programme Detail
- Notebook Tracker
- Notebook Checkpoints

The objective is **alignment, not wholesale redesign**.

---

# 21. Priority Consistency Rules

The highest-impact consistency improvements identified so far are:

1. Standardize the default page-header treatment.
2. Standardize primary action/button treatment.
3. Reduce unnecessary full-width blue action bars.
4. Bring older pages into the current card/surface language.
5. Standardize spacing, radii, typography and icon treatment.
6. Preserve data-heavy layouts where they are genuinely useful.
7. Use Bento selectively rather than universally.
8. Preserve the distinction between Teacher clarity and Student joy.

---

# 22. Visual Hierarchy

Hierarchy is communicated primarily through:

- size
- weight
- spacing
- placement
- colour
- grouping
- progressive disclosure (show the next step only once it's relevant)

Do not solve a hierarchy problem by adding another label, heading or paragraph of explanation. If a relationship between two pieces of content isn't obvious from layout alone, fix the layout — don't caption it.

### Rule

> **Show the relationship. Don't narrate it.**

A screen that needs a sentence to explain what's important on it has a hierarchy problem, not a copy problem.

---

# 23. Destructive Actions

Destructive actions (delete, remove, reset) are real functionality and must stay discoverable — but they are not the primary workflow, and their visual treatment should say so.

### Avoid

- a large "DANGER ZONE" heading as the main way a destructive area is communicated
- placing a destructive action with the same visual weight as the page's primary/secondary actions
- dramatic language ("DANGER," "WARNING," all-caps) standing in for actual visual design

### Prefer

- an existing Settings/secondary area, if the page has one — destructive actions belong there by default
- where no such area exists yet, the smallest coherent secondary treatment: a quiet, clearly-set-apart region (e.g. a subtle coloured left border, not a full tinted box) at the bottom of the page, never a prominent mid-page section
- red used semantically — as a border accent, icon colour or button treatment — not as a loud background fill
- a small warning/alert icon paired with a plainly-worded action label (e.g. "Remove Subject") instead of a shouted section heading; the action's own label should say what it does, so a separate "Danger Zone" caption above it adds no information
- a confirmation step (native confirm or a modal) before the action executes, so the visual treatment doesn't have to do all the safety work by itself

### Rule

> **"This is destructive" should come through placement and colour, not through the word DANGER.**

---

# 24. Responsive Design

Layouts must stay intentional at desktop, tablet (~768px) and mobile (~390px) widths — not just "not broken."

Avoid solving small widths by allowing:

- horizontal overflow / a page-level scrollbar
- overlapping controls
- columns so narrow their content wraps unreadably
- controls touching the viewport edge with no margin
- text that becomes illegible at the smaller size

Prefer reflowing multi-column layouts (including Bento grids) to a single column at narrow widths, using the same components rather than a separate mobile-only design. Test at approximately 390px as the baseline mobile check before considering a layout responsive.

---

# 25. Page Containment

Every top-level screen must define its own content width — a `max-width`, centered with `margin: 0 auto`, plus real horizontal padding. The app shell itself imposes none of this (`#app` is a bare flex child), so a screen that skips it runs edge-to-edge at whatever width the surrounding window happens to be, with content touching the viewport edge and any single-column layout (a Bento column included) stretching far past what its own content needs — reading as "oversized" and "empty" even though every individual rule inside it is correct.

Match the width to the screen's shape, not one fixed number everywhere:

- A linear, single-task flow (a builder, a workspace, a form) reads best narrow — roughly 680-780px.
- A browsing hub (a subject/collection grid, a Bento composition) can reasonably run wider — 1000-1200px — since it has real parallel content to use that width for.

### Rule

> **No screen inherits its width by accident. Every screen states it on purpose.**

## Grids: auto-fill, not auto-fit

For a card grid using `repeat(auto-fit, minmax(...))`, a small number of items stretches to fill the whole row — one or two cards can end up rendering far larger than their own content, another oversized-box failure mode with the identical visual symptom as a missing page container. `auto-fill` keeps the unused tracks in place instead of collapsing them, so a card's width is always driven by its own `minmax()`, never by how many peers happen to exist right now. Default to `auto-fill` for this reason; only reach for `auto-fit` with a specific, deliberate reason for wanting existing items to grow into leftover space.

---

# North Star

> **One visual language. Two expressions.**

**Teacher:** Make complexity feel manageable.  
**Student:** Make learning feel inviting.

And underneath both:

> **A mate makes things easier.**
