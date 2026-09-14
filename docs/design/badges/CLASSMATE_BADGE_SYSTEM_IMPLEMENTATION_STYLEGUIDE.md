# ClassMate / Learning Hub
## Badge System — Implementation Style Guide
### Claude Code Reference · v1.0

**Status:** Design direction locked  
**Primary use:** Implementation reference for Claude Code  
**Scope:** Badge system foundation + Weekly Standing badges

---

## 1. Purpose

This document defines the visual and interaction rules Claude Code must follow when implementing badges in ClassMate / Learning Hub.

It is the implementation source of truth for the current badge system.

The system must be designed so that additional badge types can be introduced later without requiring a redesign of the underlying badge architecture.

---

## 2. Core Design Principle

> **One badge system. Many ways to achieve. Progressive recognition.**

Badges should feel:

- Game-inspired
- Rewarding
- Collectible
- Modern
- Friendly
- Educational
- Visually exciting

They should not feel:

- 3D
- Photorealistic
- Metallic
- Corporate
- Military
- Childish
- Like school certificates

---

## 3. Current Scope

The first badge family is:

### Weekly Standing

Current recognition types:

1. **Winning Team Member**
2. **Team Topper**
3. **Climber**
4. **Helper**

These are the only currently defined badge types.

### Important

The implementation **must not assume these four are the complete badge system**.

Additional badge families and recognition types will be added later.

The architecture should support:

```text
Badge System
├── Weekly Standing
│   ├── Winning Team Member
│   ├── Team Topper
│   ├── Climber
│   └── Helper
│
├── Future Badge Family
│   └── ...
│
└── Future Badge Family
    └── ...
```

Do not hard-code the UI around exactly four badges.

---

## 4. Badge Data Model

A badge should conceptually have the following properties:

```text
badge
├── id
├── family
├── recognitionType
├── title
├── description
├── icon
├── colorTheme
├── level
├── visualStage
├── milestone
└── earnedCount
```

### Required distinction

**recognitionType** and **level** are independent.

For example:

```text
recognitionType: winning-team-member
colorTheme: amber
level: 7
```

The colour communicates **what the badge represents**.

The level communicates **how many times it has been earned**.

---

## 5. Colour Architecture

## Critical rule

> **Colour represents recognition type, never level.**

Current colour assignments:

| Recognition type | Theme |
|---|---|
| Winning Team Member | Amber / Gold |
| Team Topper | Blue |
| Climber | Green |
| Helper | Purple |

A badge must retain its recognition colour regardless of level.

### Example

```text
Winning Team Member LV 1 → Amber
Winning Team Member LV 5 → Amber
Winning Team Member LV 10 → Amber
Winning Team Member LV 25 → Amber
```

Do not change the badge to another colour to indicate progression.

---

## 6. Colour Tokens

Implement each recognition colour as a **theme**, not as a single hard-coded colour.

Conceptually:

```text
badge-theme-amber
├── primary
├── dark
├── light
├── surface
└── accent

badge-theme-blue
├── primary
├── dark
├── light
├── surface
└── accent

badge-theme-green
├── primary
├── dark
├── light
├── surface
└── accent

badge-theme-purple
├── primary
├── dark
├── light
├── surface
└── accent
```

This allows future badge types to introduce additional themes without restructuring components.

Use the existing ClassMate design tokens where available.

Do not create arbitrary colours for individual badges.

---

## 7. Badge Shape

The core badge shape is:

> **Flat shield / emblem hybrid**

The shape should communicate:

- Achievement
- Belonging
- Progress
- Collectibility

The badge should not look like a literal school shield.

It should be a **modern gaming-inspired emblem**.

---

## 8. Badge Anatomy

The standard badge consists of:

```text
       ┌───────────────┐
       │  Outer shape  │
       │               │
       │    ★ ICON ★   │
       │               │
       │───────────────│
       │    RIBBON     │
       └───────────────┘
              LV
```

Primary components:

### 1. Outer silhouette

The main shield/emblem shape.

### 2. Inner field

Provides contrast for the central icon.

### 3. Recognition icon

Communicates what the badge represents.

### 4. Star

Represents achievement.

### 5. Ribbon / label

Contains the short badge name.

### 6. Level indicator

Communicates cumulative progress.

Not every element must be visible at every size.

---

## 9. Flat Vector Requirement

Badges must use a **flat-vector visual language**.

### Allowed

- Solid fills
- Layered vector shapes
- Geometric forms
- Flat highlights
- Flat shadows
- Outlines
- Negative space
- Small decorative shapes
- Simple colour variations within the same theme

### Avoid

- Realistic gradients
- Gloss
- Chrome
- Metallic texture
- Bevels
- Photorealistic lighting
- 3D extrusion
- Glass effects
- Realistic drop shadows

### Important

The badge may contain multiple layers and strong visual depth, but that depth must come from **flat geometric construction**, not 3D rendering.

---

## 10. Typography

ClassMate's primary typeface is:

> **Plus Jakarta Sans**

Use it consistently throughout the product.

Badge typography should use the same type family but can use:

- Extra Bold / Bold weights
- Uppercase
- Tight composition
- Strong contrast
- Compact line breaks

Do not introduce a decorative display font simply to make the badges feel game-like.

The gaming character should come from:

- Shape
- Weight
- Composition
- Colour
- Iconography
- Layering

---

## 11. Level System

Levels are **unlimited**.

The system must support:

```text
LV 1
LV 2
LV 3
...
LV 10
...
LV 20
...
LV 50
...
LV 100
...
```

Do not implement a maximum level.

Do not display:

> MAX LEVEL

unless a future product decision explicitly introduces a cap.

---

## 12. Meaning of Level

For Weekly Standing:

> **Level = number of weeks the recognition has been earned.**

Example:

A learner who has been part of the winning team five times:

```text
Winning Team Member
LV 5
```

A learner who has been a winning team member twenty-three times:

```text
Winning Team Member
LV 23
```

The numerical level should always remain accurate.

---

## 13. Visual Level Stages

Although levels are unlimited, badge artwork evolves through five visual stages.

### Stage 1 — Starting Out

**LV 1–2**

Base emblem.

Visual elements:

- Shield
- Central icon
- Star
- Basic border

---

### Stage 2 — Building

**LV 3–4**

Add moderate visual progression.

Possible elements:

- Additional star
- Secondary border
- Outer points
- Small decorative accents

---

### Stage 3 — Established

**LV 5–9**

First significant badge evolution.

Possible elements:

- Larger outer silhouette
- Additional geometric layers
- Multiple stars
- Laurel elements
- Decorative rays

---

### Stage 4 — Elite

**LV 10–19**

Strong achievement treatment.

Possible elements:

- Expanded frame
- Larger star treatment
- Rays
- Laurel
- Crown-like geometry where appropriate

---

### Stage 5 — Master

**LV 20+**

Highest standard visual stage.

Possible elements:

- Full emblem frame
- Laurel / wings
- Strong outer geometry
- Premium framing
- Distinctive silhouette

Still flat vector.

---

## 14. Milestones

Recommended visual milestones:

```text
LV 1   → First achievement
LV 5   → Established
LV 10  → Elite
LV 20  → Master
LV 50  → Legend
```

Milestones are **visual progression points**, not level caps.

After LV 50:

```text
LV 51
LV 52
LV 53
...
```

The badge remains in the Master/Legend visual family unless a future design decision introduces additional stages.

---

## 15. Do Not Add Unlimited Visual Complexity

Level numbers are unlimited.

Visual complexity is not.

Do not create progressively more decorative badges forever.

Once a badge reaches its highest defined visual stage, continue increasing the numerical level while maintaining the established visual language.

Example:

```text
LV 20
LV 21
LV 35
LV 50
LV 87
```

All may use the Master visual treatment.

The number communicates continued progress.

---

## 16. Stars

Stars are a visual progression device.

Early levels may correspond naturally to star count:

```text
LV 1 → ★
LV 2 → ★★
LV 3 → ★★★
```

However, do not continue adding stars indefinitely.

At higher levels, use a fixed decorative star treatment while the level number communicates the actual count.

Avoid:

```text
LV 37 → ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★
```

---

## 17. Current Recognition Identities

## Winning Team Member

### Meaning

The learner was part of the highest-scoring team that week.

### Theme

Amber / Gold

### Central visual direction

Team / group icon + star

### Supporting visual language

Team success, shared achievement, collective effort.

---

## Team Topper

### Meaning

The learner achieved the highest individual score within their team that week.

### Theme

Blue

### Central visual direction

Crown + star

### Supporting visual language

Excellence, achievement, leadership.

Avoid making the visual feel hierarchical or superior.

---

## Climber

### Meaning

The learner showed the strongest improvement compared with the previous week.

### Theme

Green

### Central visual direction

Rising graph / upward movement + star

### Supporting visual language

Growth, progress, momentum.

---

## Helper

### Meaning

The learner meaningfully supported classmates.

### Theme

Purple

### Central visual direction

People / connection / helping gesture + star

### Supporting visual language

Contribution, support, community.

Helper must have equal visual importance to the other recognition types.

---

## 18. Icon System — Future Extension Point

The badge system should **not permanently hard-code the current icons as the final ClassMate icon system**.

A future ClassMate icon system may be developed around the badge theme.

Potential future direction:

> **Geometric, flat, bold achievement iconography**

When that happens, badge icons should be replaceable without changing the badge component architecture.

Conceptually:

```text
Badge
├── theme
├── icon
├── title
├── level
└── stage
```

The badge should consume an icon rather than embedding an icon directly into the component logic.

Future iconography should remain:

- Flat
- Geometric
- Recognisable
- Bold
- Consistent
- Legible at small sizes

Do not invent a large icon library as part of the initial implementation unless explicitly requested.

---

## 19. Responsive Behaviour

Badges must work across:

- Desktop
- Tablet
- Mobile

Required approximate sizes:

```text
24px
32px
48px
64px
96px
128px
160px+
```

At small sizes, simplify rather than shrink every detail.

### Small badge

Keep:

- Outer silhouette
- Recognition colour
- Central icon
- Star

Remove or simplify:

- Small decorative accents
- Fine lines
- Multiple stars
- Tiny text

---

## 20. Badge and UI Are Separate

Do not treat the badge artwork itself as the entire UI.

A badge component may be presented with:

```text
[ BADGE ]

Winning Team Member
LV 5
5 weeks earned
```

The surrounding UI can communicate:

- Description
- Progress
- Next milestone
- Date earned
- Achievement history

Do not overload the artwork with information.

---

## 21. Student Profile

The profile should show the learner's current level for each earned Weekly Standing badge.

Example:

```text
Weekly Standing

[ Team Member ]   [ Team Topper ]
     LV 5              LV 2

[ Climber ]       [ Helper ]
     LV 7              LV 3
```

Each badge can display:

- Current artwork
- Badge name
- Level

Additional details should be outside the artwork.

---

## 22. Badge Detail

A badge detail view may show:

```text
Winning Team Member

        [ BADGE ]

          LV 7

       7 weeks earned

    ● ● ● ● ● ● ● ○ ○ ○

Next milestone
3 more wins → LV 10
```

The exact UI can evolve, but the conceptual hierarchy should remain:

**Badge → Name → Level → Progress → Next milestone**

---

## 23. Component Architecture

Where possible, implement one reusable badge component rather than separate bespoke components for each recognition type.

Conceptually:

```text
<Badge
  family="weekly-standing"
  type="winning-team-member"
  level={5}
/>
```

The component determines:

```text
type
→ theme
→ icon
→ title

level
→ visualStage
→ milestone treatment
```

This prevents duplication.

---

## 24. Do Not Hard-Code Level Artwork

Avoid code such as:

```text
if level === 1
if level === 2
if level === 3
if level === 4
if level === 5
...
```

Instead, derive a visual stage.

Conceptually:

```text
getBadgeStage(level)

1–2   → starting
3–4   → building
5–9   → established
10–19 → elite
20+   → master
```

This ensures levels above 20 work automatically.

---

## 25. Future Badge Families

The architecture must support future families.

For example:

```text
family: weekly-standing
family: learning
family: collaboration
family: exploration
family: milestone
```

These names are examples, not locked future categories.

Do not assume that all future badges will use exactly the same recognition logic as Weekly Standing.

The shared visual foundation should remain reusable, while individual badge families may define their own award rules.

---

## 26. What Is Locked

Claude Code should treat the following as design constraints unless the user explicitly changes them:

### Locked

- Flat-vector visual style
- Gaming-inspired achievement language
- Shield / emblem base shape
- Recognition colour represents badge type
- Level is independent of colour
- Levels are unlimited
- Visual progression happens through stages
- Weekly Standing has four current badge types
- Plus Jakarta Sans remains the product typeface
- Badges should work at small sizes
- 3D rendering is not part of the visual language
- Future badge types must be supported
- Icon system may evolve later

---

## 27. What Is Intentionally Not Locked

Do not make permanent assumptions about:

- Exact future badge categories
- Future icon library
- Exact SVG paths
- Exact icon shapes
- Future badge families
- Future milestone names
- Future visual stages beyond Master
- Exact pixel dimensions for every context
- Exact colour hex values if existing ClassMate tokens already define them

When an existing ClassMate design token or component already exists, **reuse it rather than creating a parallel system**.

---

## 28. Design Quality Checklist

Before considering badge implementation complete:

### Visual

- [ ] Flat-vector appearance
- [ ] No 3D/extruded treatment
- [ ] Shield/emblem silhouette
- [ ] Recognition colour is correct
- [ ] Central icon is recognisable
- [ ] Star is present where appropriate
- [ ] Typography follows ClassMate system
- [ ] Badge feels collectible and rewarding

### Progression

- [ ] LV 1 works
- [ ] LV 3 works
- [ ] LV 5 visual milestone works
- [ ] LV 10 visual milestone works
- [ ] LV 20 visual milestone works
- [ ] Levels above 20 work
- [ ] Level does not change recognition colour
- [ ] Numerical level remains unlimited

### Responsive

- [ ] Badge works at 24–32px
- [ ] Badge works at 48–64px
- [ ] Badge works at 96px+
- [ ] Small decorative details simplify appropriately
- [ ] Badge remains recognisable without surrounding text

### Architecture

- [ ] Badge component is reusable
- [ ] Recognition type is data-driven
- [ ] Theme is data-driven
- [ ] Level stage is calculated
- [ ] Future badge types can be added without rewriting the component
- [ ] Icon can be replaced independently
- [ ] No hard-coded assumptions about exactly four badges

---

## 29. Claude Code Implementation Rule

Before making changes to badge-related UI:

1. Read this document.
2. Inspect the existing ClassMate design system and components.
3. Reuse existing tokens and patterns where possible.
4. Do not introduce a competing badge system.
5. Do not invent new badge categories, colours, rarity systems, or level rules without explicit instruction.
6. Preserve the distinction between:
   - recognition type
   - level
   - visual stage
7. Ensure the implementation remains extensible for future badge families and a future ClassMate icon system.

When a design decision is ambiguous, **preserve the existing system rather than introducing a new visual convention**.

---

## 30. Core System Formula

The implementation should preserve this model:

> **COLOUR = WHAT KIND OF RECOGNITION**  
> **ICON = WHAT THE RECOGNITION MEANS**  
> **LEVEL = HOW MANY TIMES IT HAS BEEN EARNED**  
> **VISUAL STAGE = HOW FAR THE BADGE HAS EVOLVED**  
> **STAR = ACHIEVEMENT / PROGRESSION**

This is the foundational badge architecture for ClassMate / Learning Hub.
