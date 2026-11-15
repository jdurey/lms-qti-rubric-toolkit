#!/usr/bin/env node
/**
 * lms-qti-rubric CLI
 * Zero-dependency CLI for IMS QTI 1.2 / 2.1 quiz packaging, Classic-to-New Quizzes migration,
 * Canvas SpeedGrader rubric-to-Excel accreditation matrices, and FERPA local roster matching.
 *
 * Non-technical browser GUI & Department 10-Seat Pass:
 *   https://tools.stillhumanacademy.com/canvas-qti-rubric-converter
 */
import fs from "node:fs";
import path from "node:path";
import {
  parseQuestionsInput,
  compileQti12Package,
  compileQti21Package,
  convertQti12To21,
  buildRubricAccreditationMatrix,
  matchGradebookRosters
} from "../src/index.mjs";

const VERSION = "1.0.0";

function printHelp() {
  const msg = `lms-qti-rubric v${VERSION}
Zero-dependency IMS QTI 1.2/2.1 compiler, Canvas SpeedGrader rubric-to-Excel builder, and FERPA roster matcher.
Browser GUI (zero install, 100% client-side): https://tools.stillhumanacademy.com/canvas-qti-rubric-converter

Usage:
  lms-qti-rubric <command> [options]

Commands:
  md2qti <exam.md>                 Convert numbered Markdown/Word exam to IMS QTI 1.2 or 2.1 .zip
  csv2qti <quiz.csv>               Convert Google Forms or spreadsheet CSV to IMS QTI 1.2 or 2.1 .zip
  qti12to21 <classic.zip|quiz.xml> Migrate Classic Quizzes QTI 1.2 .zip/.xml to New Quizzes QTI 2.1 .zip
  rubric2xls <rubric.csv|json>     Convert Canvas SpeedGrader Rubric CSV/JSON to 2-tab Accreditation .xls
  match-roster <sis.csv> <src.csv> Fuzzy-match student names/nicknames locally (FERPA safe, 0 uploads)

Options:
  -o, --out <file>         Output file path (defaults to sensible filename next to input)
  --qti <1.2|2.1>          Target IMS QTI version for md2qti / csv2qti (default: 2.1)
  --title <text>           Assessment title inside QTI manifest and test XML
  --csv-out <file>         Optional Student Criterion Matrix CSV output path (rubric2xls)
  --summary-out <file>     Optional Accreditation Summary CSV output path (rubric2xls)
  --target <sis.csv>       Target SIS gradebook roster CSV (PowerSchool / Infinite Campus / Canvas)
  --source <scores.csv>    Source score export CSV (Google Classroom / Kahoot / Quizizz)
  --assignment <name>      Output score column header for match-roster
  --source-max <pts>       Source max points for score scaling (e.g. 20)
  --target-max <pts>       Target gradebook max points for score scaling (e.g. 100)
  --audit-out <file>       Optional match confidence audit CSV output path (match-roster)
  --json                   Emit machine-readable JSON summary to stdout
  -h, --help               Show this help text
  -v, --version            Show CLI version
`;
  process.stdout.write(msg);
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      flags.help = true;
    } else if (arg === "-v" || arg === "--version") {
      flags.version = true;
    } else if (arg === "--json") {
      flags.json = true;
    } else if (arg === "-o" || arg === "--out") {
      flags.out = argv[++i];
    } else if (arg.startsWith("--") && arg.includes("=")) {
      const eq = arg.indexOf("=");
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        flags[key] = argv[++i];
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function defaultOutPath(inputPath, newSuffix) {
  const dir = path.dirname(inputPath);
  const ext = path.extname(inputPath);
  const base = path.basename(inputPath, ext);
  return path.join(dir, `${base}${newSuffix}`);
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  if (flags.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  const cmd = positional[0];
  if (flags.help || !cmd) {
    printHelp();
    process.exitCode = cmd ? 0 : (flags.help ? 0 : 1);
    return;
  }

  if (cmd === "md2qti" || cmd === "csv2qti") {
    const inputPath = positional[1] || flags.input;
    if (!inputPath) {
      throw new Error(`Missing input file path for '${cmd}'. Run with --help for usage.`);
    }
    const rawText = fs.readFileSync(inputPath, "utf8");
    const formatHint = cmd === "csv2qti" ? "csv" : "markdown";
    const qtiVer = String(flags.qti || "2.1").trim();
    if (qtiVer !== "1.2" && qtiVer !== "2.1") {
      throw new Error(`Unsupported --qti version '${qtiVer}'. Expected '1.2' or '2.1'.`);
    }

    const questions = parseQuestionsInput(rawText, formatHint);
    if (questions.length === 0) {
      throw new Error(`No parseable questions found in '${inputPath}'.`);
    }

    const inferredTitle = flags.title || path.basename(inputPath, path.extname(inputPath));
    const pkg =
      qtiVer === "1.2"
        ? compileQti12Package(questions, { title: inferredTitle })
        : compileQti21Package(questions, { title: inferredTitle });

    const outPath = flags.out || defaultOutPath(inputPath, `_qti${qtiVer.replace(".", "")}.zip`);
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(outPath, Buffer.from(pkg.zipBytes));

    const summary = {
      ok: true,
      command: cmd,
      qtiVersion: qtiVer,
      title: pkg.title,
      questionCount: pkg.questionCount,
      totalPoints: pkg.totalPoints,
      outputZip: path.resolve(outPath),
      bytesWritten: pkg.zipBytes.byteLength
    };
    if (flags.json) {
      process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
    } else {
      process.stdout.write(
        `Compiled ${summary.questionCount} questions (${summary.totalPoints} pts) -> IMS QTI ${qtiVer} ZIP: ${summary.outputZip} (${summary.bytesWritten} bytes)\n`
      );
    }
    return;
  }

  if (cmd === "qti12to21") {
    const inputPath = positional[1] || flags.input;
    if (!inputPath) {
      throw new Error("Missing Classic Quizzes QTI 1.2 .zip or .xml input path.");
    }
    const inputBytes = fs.readFileSync(inputPath);
    const converted = await convertQti12To21(new Uint8Array(inputBytes), {
      title: flags.title || ""
    });
    const outPath = flags.out || defaultOutPath(inputPath, "_new_quizzes_qti21.zip");
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(outPath, Buffer.from(converted.zipBytes));

    const summary = {
      ok: true,
      command: "qti12to21",
      qtiVersion: "2.1",
      title: converted.title,
      questionCount: converted.questionCount,
      totalPoints: converted.totalPoints,
      outputZip: path.resolve(outPath),
      bytesWritten: converted.zipBytes.byteLength
    };
    if (flags.json) {
      process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
    } else {
      process.stdout.write(
        `Migrated ${summary.questionCount} Classic Quiz questions -> New Quizzes QTI 2.1 ZIP: ${summary.outputZip} (${summary.bytesWritten} bytes)\n`
      );
    }
    return;
  }

  if (cmd === "rubric2xls") {
    const inputPath = positional[1] || flags.input;
    if (!inputPath) {
      throw new Error("Missing Canvas SpeedGrader rubric CSV or JSON file path.");
    }
    const rawInput = fs.readFileSync(inputPath, "utf8");
    const matrix = buildRubricAccreditationMatrix(rawInput);
    const outPath = flags.out || defaultOutPath(inputPath, "_accreditation_matrix.xls");
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(outPath, matrix.workbookXml, "utf8");

    if (flags["csv-out"]) {
      fs.mkdirSync(path.dirname(path.resolve(flags["csv-out"])), { recursive: true });
      fs.writeFileSync(flags["csv-out"], matrix.matrixCsv, "utf8");
    }
    if (flags["summary-out"]) {
      fs.mkdirSync(path.dirname(path.resolve(flags["summary-out"])), { recursive: true });
      fs.writeFileSync(flags["summary-out"], matrix.summaryCsv, "utf8");
    }

    const summary = {
      ok: true,
      command: "rubric2xls",
      assignmentTitle: matrix.assignmentTitle,
      studentCount: matrix.studentCount,
      criterionCount: matrix.criterionCount,
      maxPoints: matrix.maxPoints,
      sections: matrix.sections,
      outputXls: path.resolve(outPath)
    };
    if (flags.json) {
      process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
    } else {
      process.stdout.write(
        `Built 2-tab Rubric Accreditation Workbook (${summary.studentCount} students x ${summary.criterionCount} criteria) -> ${summary.outputXls}\n`
      );
    }
    return;
  }

  if (cmd === "match-roster") {
    const targetPath = flags.target || positional[1];
    const sourcePath = flags.source || positional[2];
    if (!targetPath || !sourcePath) {
      throw new Error(
        "match-roster requires target SIS roster CSV and source score CSV (e.g. lms-qti-rubric match-roster sis.csv kahoot.csv -o matched.csv)."
      );
    }
    const targetCsv = fs.readFileSync(targetPath, "utf8");
    const sourceCsv = fs.readFileSync(sourcePath, "utf8");
    const res = matchGradebookRosters(targetCsv, sourceCsv, {
      assignmentName: flags.assignment || undefined,
      sourceMaxPoints: flags["source-max"] ? Number(flags["source-max"]) : undefined,
      targetMaxPoints: flags["target-max"] ? Number(flags["target-max"]) : undefined
    });

    const outPath = flags.out || defaultOutPath(targetPath, "_matched_scores.csv");
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(outPath, res.csvOutput, "utf8");

    if (flags["audit-out"]) {
      fs.mkdirSync(path.dirname(path.resolve(flags["audit-out"])), { recursive: true });
      fs.writeFileSync(flags["audit-out"], res.auditCsvOutput, "utf8");
    }

    const summary = {
      ok: true,
      command: "match-roster",
      totalTargetStudents: res.totalTargetStudents,
      matchedCount: res.matchedCount,
      unmatchedCount: res.unmatchedCount,
      outputCsv: path.resolve(outPath),
      matchReport: res.matchReport
    };
    if (flags.json) {
      process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
    } else {
      process.stdout.write(
        `Matched ${res.matchedCount}/${res.totalTargetStudents} students locally (0 bytes uploaded) -> ${summary.outputCsv}\n`
      );
    }
    return;
  }

  throw new Error(`Unknown command '${cmd}'. Run 'lms-qti-rubric --help' for usage.`);
}

main().catch((err) => {
  process.stderr.write(`Error: ${err && err.message ? err.message : String(err)}\n`);
  process.exit(1);
});
