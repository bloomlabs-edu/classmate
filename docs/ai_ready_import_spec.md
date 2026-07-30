# ClassMate — AI-Ready Import Format Specification

**Status:** Official, permanent specification for AI-Ready Import.
**Parser:** `services/canonicalUnitExtractionService.js`
**Companion path:** "Import from Textbook (Experimental)" remains available separately for raw, unconverted Tables of Contents. This specification governs the recommended path only.

Every rule and example below has been verified directly against the actual parser, not written from memory.

---

## 1. The Exact Canonical Format

```
CURRICULUM: <free text — optional, ignored by the parser>

PART: <Part name>
<unit number>|<unit title>|<printed page number>
<unit number>|<unit title>|<printed page number>

PART: <next Part name>
<unit number>|<unit title>|<printed page number>
```

A minimal, complete file needs nothing but unit lines:

```
1|Measurement|1
2|Force and Pressure|12
```

---

## 2. Grammar / Parsing Rules

The complete rule set — nothing beyond this list is inferred or guessed at:

1. **Input is read line by line.** Each line is trimmed of leading/trailing whitespace before anything else happens.

2. **Blank lines are always ignored.** Never an error, anywhere in the file.

3. **A `CURRICULUM:` line is accepted and ignored.** Case-insensitive on the keyword. Everything after it is documentation only — the parser never reads it. It exists purely so a human (or an AI regenerating the file later) can tell what the file is about at a glance.

4. **A `PART:` line starts a new Part.** Case-insensitive on the keyword (`PART:`, `part:`, `Part:` are equivalent). Everything after the colon, trimmed, becomes that Part's name **exactly as written** — no formatting, casing, or "does this look like a real subject" checks of any kind.

5. **A unit line has exactly three fields, separated by exactly two `|` characters:**
   ```
   <number>|<title>|<page>
   ```
   - Whitespace around each field is trimmed and ignored (`1 | Measurement | 1` is identical to `1|Measurement|1`).
   - `<number>` must be one or more digits, nothing else.
   - `<title>` must be non-empty after trimming. It may contain any characters, including commas, apostrophes, and colons — the `|` is the only character with special meaning.
   - `<page>` must be one or more digits, nothing else.
   - A line with any other number of `|`-separated fields (two, four, or more) is **not** a unit line.

6. **Every unit line is assigned to the most recent `PART:` line above it.** Units appearing before any `PART:` line — or in a file with no `PART:` line at all — are assigned to a single default Part named **General**. This is why a single-subject curriculum (e.g., plain Science) never needs to write a `PART:` line at all.

7. **Unit numbers restart freely per Part** and are never checked for sequence or uniqueness. `History`'s Unit 1 and `Geography`'s Unit 1 are two different, valid units — the format trusts the input.

8. **Any line that is not blank, not a `CURRICULUM:` line, not a `PART:` line, and does not parse as a valid three-field unit line is reported as an error** — never silently dropped, and never causes the rest of the import to fail. Every successfully parsed unit above and below a malformed line is still imported.

That is the entire grammar. There is no "and then guess" step anywhere in it.

---

## 3. Three Complete Examples

### Science

```
CURRICULUM: Grade 8 Science

PART: General
1|Measurement|1
2|Force and Pressure|12
3|Light|22
4|Heat|35
```

### Social Science

```
CURRICULUM: Grade 8 Social Science

PART: History
1|Advent of the Europeans|1
2|From Trade to Territory|11
3|Rural Life and Society|26

PART: Geography
1|Rocks and Soils|85
2|Weather and Climate|95

PART: Civics
1|How the State Government Works|168

PART: Economics
1|Money, Savings and Investments|226
2|Public and Private Sectors|238
```

### English

```
CURRICULUM: Grade 8 English

PART: Literature
1|The Gift of the Magi|1
2|A Photograph|14
3|Villa for Sale|22

PART: Grammar
1|Tenses and Their Uses|48
2|Active and Passive Voice|56

PART: Writing
1|Letter Writing|70
2|Notice and Agenda|78
3|Report Writing|84
```

---

## 4. Five Valid Examples

Each of these parses with zero errors — confirmed by running them through the parser directly.

**V1 — No `PART:` line at all (defaults to General):**
```
1|Measurement|1
```
→ 1 unit, Part = "General".

**V2 — Extra whitespace around the pipes:**
```
1 | Measurement | 1
```
→ Identical result to `1|Measurement|1`. Whitespace around each field is always trimmed.

**V3 — A title containing commas and an apostrophe:**
```
3|People's Revolt, and Aftermath|26
```
→ The entire middle field is the title, verbatim. Only `|` is a delimiter — punctuation inside a title is never a problem.

**V4 — Lowercase `part:` keyword:**
```
part: History
1|Advent|1
```
→ Works identically to `PART: History`. The keyword is case-insensitive.

**V5 — Units before the first `PART:` line:**
```
1|Foo|1
PART: History
1|Bar|5
```
→ 2 units: "Foo" lands in the default "General" Part; "Bar" lands in "History".

---

## 5. Five Invalid Examples

Each of these produces **zero units for that line** and **one reported error** — the rest of a file still imports normally around them.

**I1 — Missing a field (only 2, not 3):**
```
3|People's Revolt
```
❌ Invalid — the page number is missing entirely. Reported as: `Line 1, Expected: <number>|<title>|<page>, Received: 3|People's Revolt`.

**I2 — An extra field (4, not 3):**
```
1|Measurement|1|June
```
❌ Invalid — a fourth field (here, a Month column) makes this 4 fields, not 3. The canonical format has exactly three fields; extra columns must be removed during conversion, not appended.

**I3 — Non-numeric unit number:**
```
one|Measurement|1
```
❌ Invalid — the first field must be digits only. Spell out numbers as digits: `1`, not `one`.

**I4 — Non-numeric page number:**
```
1|Measurement|one
```
❌ Invalid — same rule applies to the third field.

**I5 — Comma used instead of a pipe:**
```
1,Measurement,1
```
❌ Invalid — this is not treated as three fields at all; the whole line has zero `|` characters, so it fails the "exactly three pipe-separated fields" check outright. The pipe (`|`) is the only valid delimiter.

---

## 6. Ready-to-Copy AI Conversion Prompt

Paste this into Claude, ChatGPT, Gemini, or any other AI assistant, along with a copy of (or a photo/PDF of) the textbook's actual Table of Contents.

~~~
Convert the following textbook Table of Contents into this exact plain-text format. Follow these rules exactly:

1. Start with one line: CURRICULUM: <curriculum name, e.g. "Grade 8 Social Science">
2. If the subject has multiple sections (e.g. History, Geography, Civics, Economics for Social Science; or Literature, Grammar, Writing for English), write one "PART: <section name>" line before each section's units. Unit numbering restarts at 1 within each Part — that's expected and correct.
3. If the subject has no real sections (e.g. plain Science or Maths), write a single line: PART: General
4. Every unit is its own line in exactly this format, with no extra spaces of your own choosing beyond the pipes:
   <unit number>|<unit title>|<printed page number>
5. Use only digits for the unit number and page number. Do not include Roman numerals, footnotes, or any extra text in those two fields.
6. Do not include any other columns from the original Table of Contents (Month, Semester, Learning Outcome, Notes, marks, duration, etc.) — only unit number, title, and page number.
7. Do not add commentary, explanations, headers, or markdown formatting (no code fences, no bullet points) — output only the plain text in the exact format described above.
8. If a printed page number is genuinely not available for a unit, write 0 for that unit's page number rather than omitting the field.

Here is the Table of Contents to convert:

[PASTE THE TEXTBOOK'S TABLE OF CONTENTS HERE]
~~~
