# LMS QTI 1.2 / 2.1, Canvas SpeedGrader Rubric-to-Excel & FERPA Roster Toolkit

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](./package.json)
[![Node.js >= 18](https://img.shields.io/badge/node-%3E%3D18.0.0-339933.svg)](./package.json)
[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-Install_Free-0f766e.svg)](https://chromewebstore.google.com/detail/canvas-assessment-rubric/aholdfpbhfiipondaloaooenjpfeccnp)

> [!TIP]
> **Prefer a 1-click Chrome Extension or browser GUI with zero command line setup?**
> - **Free Manifest V3 Chrome Extension (`activeTab` only, works on custom `.edu` Canvas domains):** [**Install Canvas Assessment & Rubric Matrix Exporter on Chrome Web Store**](https://chromewebstore.google.com/detail/canvas-assessment-rubric/aholdfpbhfiipondaloaooenjpfeccnp)
> - **Browser Converters (`0` student bytes uploaded, Department 10-Seat Passes available):** **[tools.stillhumanacademy.com](https://tools.stillhumanacademy.com)**
>
> - **All-in-One Canvas QTI & Rubric Suite:** [tools.stillhumanacademy.com/canvas-qti-rubric-converter](https://tools.stillhumanacademy.com/canvas-qti-rubric-converter)
> - **Canvas SpeedGrader Rubric Export to Excel (`.xls`):** [tools.stillhumanacademy.com/canvas-speedgrader-rubric-to-excel](https://tools.stillhumanacademy.com/canvas-speedgrader-rubric-to-excel)
> - **Classic Quizzes QTI 1.2 to New Quizzes QTI 2.1 Converter:** [tools.stillhumanacademy.com/canvas-qti-1-2-to-2-1-converter](https://tools.stillhumanacademy.com/canvas-qti-1-2-to-2-1-converter)
> - **Word / Markdown Quiz to Canvas QTI `.zip` Converter:** [tools.stillhumanacademy.com/word-quiz-to-canvas-qti-converter](https://tools.stillhumanacademy.com/word-quiz-to-canvas-qti-converter)
> - **Google Forms CSV to Canvas QTI `.zip` Converter:** [tools.stillhumanacademy.com/google-forms-to-canvas-qti-converter](https://tools.stillhumanacademy.com/google-forms-to-canvas-qti-converter)
> - **FERPA Local Gradebook Roster Matcher (PowerSchool / Google Classroom):** [tools.stillhumanacademy.com/powerschool-google-classroom-roster-matcher](https://tools.stillhumanacademy.com/powerschool-google-classroom-roster-matcher)

---

## Why This Toolkit Exists

University instructional designers, K-12 teachers, and accreditation leads hit four recurring LMS bottlenecks every term:

1. **Canvas SpeedGrader rubric export to Excel:** Canvas buries per-criterion rubric scores, ratings, and comments inside nested SpeedGrader views or raw JSON instead of giving accreditation committees a clean **Criterion-by-Student `.xls` matrix** with mastery rates (`>= 80%`) and section averages.
2. **Classic Quizzes to New Quizzes QTI 2.1 migration:** Legacy exports package assessments in IMS QTI 1.2 (`<questestinterop>`), whereas Canvas New Quizzes expects IMS QTI 2.1 (`<assessmentTest>` + per-question `<assessmentItem>` XMLs + `imsmanifest.xml`).
3. **Word quiz or Google Forms CSV to Canvas QTI `.zip`:** Re-typing 50-question Word exams or Google Forms spreadsheets into an LMS question bank takes hours when a deterministic compiler can build the `.zip` archive in milliseconds.
4. **FERPA gradebook roster matching:** Syncing scores from Google Classroom, Kahoot, or Quizizz (`Liam Carter`, `Liz Chen`) back into PowerSchool, Infinite Campus, or Skyward (`"Carter, William (Liam)"`, `"Chen, Elizabeth M."`) breaks Excel `VLOOKUP`, and pasting student names into cloud AI chatbots violates school FERPA policies.

`lms-qti-rubric-toolkit` solves all four workflows offline with **zero external npm dependencies** and **zero network calls**.

---

## Quick Start (CLI)

Clone or install globally with Node.js `>= 18`:

```bash
git clone https://github.com/jdurey/lms-qti-rubric-toolkit.git
cd lms-qti-rubric-toolkit
npm test
```

### 1. Word / Numbered Markdown Exam to Canvas QTI `.zip` (`md2qti`)

Supports Multiple Choice (`*b)`), Multiple Answers (`[x]`), True/False, Short Answer (`* accepted`), Essay (`[ESSAY]`), point tags (`(2 pts)`), and item feedback (`Feedback: ...`).

```bash
node ./bin/lms-qti-rubric.mjs md2qti ./examples/sample_exam.md \
  --qti 2.1 \
  --title "Biology 101 Midterm" \
  -o ./bio101_qti21.zip
```

Pass `--qti 1.2` if importing into legacy Classic Quizzes instead of Canvas New Quizzes.

### 2. Google Forms / Spreadsheet CSV to QTI `.zip` (`csv2qti`)

```bash
node ./bin/lms-qti-rubric.mjs csv2qti ./examples/sample_forms_quiz.csv \
  --qti 2.1 \
  -o ./forms_quiz_qti21.zip
```

### 3. Classic Quizzes QTI 1.2 `.zip` to New Quizzes QTI 2.1 `.zip` (`qti12to21`)

Reads both DEFLATE-compressed and uncompressed Classic Quizzes `.zip` exports (or standalone `.xml` files) and compiles a spec-valid IMS QTI 2.1 package:

```bash
node ./bin/lms-qti-rubric.mjs qti12to21 ./classic_quiz_export.zip \
  -o ./new_quizzes_qti21.zip
```

### 4. Canvas SpeedGrader Rubric CSV / JSON to 2-Tab Excel Matrix (`rubric2xls`)

Generates a multi-worksheet SpreadsheetML `.xls` workbook containing:
- **Tab 1 (`Student_Criterion_Matrix`):** Student Name, SIS ID, Section, Total Score, Percentage, plus `[Points]`, `[Rating]`, and `[Comments]` columns for every rubric criterion (automatically skipping Canvas's dummy `"Points Possible"` row).
- **Tab 2 (`Accreditation_Summary`):** Per-criterion N, Mean, Median, Standard Deviation, Mastery Count (`>= 80%`), Mastery Rate %, and per-section averages for ABET / AACSB / regional accreditation packets.

```bash
node ./bin/lms-qti-rubric.mjs rubric2xls ./examples/sample_speedgrader_rubric.csv \
  -o ./bio101_accreditation_matrix.xls \
  --summary-out ./bio101_criterion_summary.csv
```

### 5. 100% Local FERPA Gradebook Roster Matcher (`match-roster`)

Matches `"Last, First M."` SIS rosters against nickname-heavy activity exports using exact ID match, canonical nickname dictionary (`Liam <-> William`, `Liz <-> Elizabeth`, `Katie <-> Katherine`, `Bobby <-> Robert`), middle-initial stripping, and Jaro-Winkler similarity, with optional point scaling (`18/20 -> 90`):

```bash
node ./bin/lms-qti-rubric.mjs match-roster \
  --target ./examples/sample_powerschool_roster.csv \
  --source ./examples/sample_classroom_scores.csv \
  --assignment "Unit_3_Quiz" \
  --source-max 20 \
  --target-max 100 \
  -o ./powerschool_ready_import.csv \
  --audit-out ./match_confidence_audit.csv
```

---

## Programmatic Node.js / ESM Library Usage

```js
import fs from "node:fs";
import {
  parseQuestionsInput,
  compileQti21Package,
  convertQti12To21,
  buildRubricAccreditationMatrix,
  matchGradebookRosters
} from "lms-qti-rubric-toolkit";

// 1. Compile Markdown exam to IMS QTI 2.1 .zip bytes
const questions = parseQuestionsInput(fs.readFileSync("./examples/sample_exam.md", "utf8"), "markdown");
const qti21 = compileQti21Package(questions, { title: "Midterm Exam" });
fs.writeFileSync("./midterm_qti21.zip", Buffer.from(qti21.zipBytes));

// 2. Migrate Classic Quizzes QTI 1.2 .zip buffer to QTI 2.1
const migrated = await convertQti12To21(fs.readFileSync("./classic_quiz.zip"));
console.log(`Migrated ${migrated.questionCount} items to QTI 2.1`);

// 3. Build 2-tab Canvas Rubric Accreditation .xls workbook
const rubric = buildRubricAccreditationMatrix(
  fs.readFileSync("./examples/sample_speedgrader_rubric.csv", "utf8")
);
fs.writeFileSync("./rubric_matrix.xls", rubric.workbookXml, "utf8");

// 4. Match FERPA student rosters 100% offline
const matched = matchGradebookRosters(
  fs.readFileSync("./examples/sample_powerschool_roster.csv", "utf8"),
  fs.readFileSync("./examples/sample_classroom_scores.csv", "utf8"),
  { sourceMaxPoints: 20, targetMaxPoints: 100, assignmentName: "Lab_Quiz_3" }
);
console.log(`Matched ${matched.matchedCount}/${matched.totalTargetStudents} students`);
```

---

## Browser Web App & Department Licensing

For faculty, K-12 teachers, and instructional design teams who want drag-and-drop previews, printable answer-key PDFs, batch exports, or a **Department 10-Seat Pass** without installing Node.js:

- **Launch the Zero-Upload Web Suite:** [https://tools.stillhumanacademy.com](https://tools.stillhumanacademy.com)

All browser conversions execute locally inside Web Workers / client-side JavaScript so student names, grades, and exam banks never leave the user's device.

## License

MIT License. See [LICENSE](./LICENSE).
