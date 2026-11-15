import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  parseQuestionsInput,
  compileQti12Package,
  compileQti21Package,
  convertQti12To21,
  extractQtiXmlFromZipBytes,
  buildRubricAccreditationMatrix,
  matchGradebookRosters
} from "../src/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const CLI_BIN = path.join(REPO_ROOT, "bin", "lms-qti-rubric.mjs");
const EXAMPLES_DIR = path.join(REPO_ROOT, "examples");

function buildDeflateZipSingleFile(fileName, contentUtf8) {
  const nameBytes = Buffer.from(fileName, "utf8");
  const rawBytes = Buffer.from(contentUtf8, "utf8");
  const compressed = zlib.deflateRawSync(rawBytes);

  // CRC32 via zlib.crc32 (Node >= 20.15) or fallback loop
  let crc = 0xffffffff >>> 0;
  for (let i = 0; i < rawBytes.length; i++) {
    let c = (crc ^ rawBytes[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    crc = (c ^ (crc >>> 8)) >>> 0;
  }
  crc = (crc ^ 0xffffffff) >>> 0;

  const localHeader = Buffer.alloc(30 + nameBytes.length);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0x0800, 6);
  localHeader.writeUInt16LE(8, 8); // method 8 = DEFLATE
  localHeader.writeUInt16LE(0, 10);
  localHeader.writeUInt16LE(0x5c21, 12);
  localHeader.writeUInt32LE(crc, 14);
  localHeader.writeUInt32LE(compressed.length, 18);
  localHeader.writeUInt32LE(rawBytes.length, 22);
  localHeader.writeUInt16LE(nameBytes.length, 26);
  localHeader.writeUInt16LE(0, 28);
  nameBytes.copy(localHeader, 30);

  const cdHeader = Buffer.alloc(46 + nameBytes.length);
  cdHeader.writeUInt32LE(0x02014b50, 0);
  cdHeader.writeUInt16LE(20, 4);
  cdHeader.writeUInt16LE(20, 6);
  cdHeader.writeUInt16LE(0x0800, 8);
  cdHeader.writeUInt16LE(8, 10);
  cdHeader.writeUInt16LE(0, 12);
  cdHeader.writeUInt16LE(0x5c21, 14);
  cdHeader.writeUInt32LE(crc, 16);
  cdHeader.writeUInt32LE(compressed.length, 20);
  cdHeader.writeUInt32LE(rawBytes.length, 24);
  cdHeader.writeUInt16LE(nameBytes.length, 28);
  cdHeader.writeUInt16LE(0, 30);
  cdHeader.writeUInt16LE(0, 32);
  cdHeader.writeUInt16LE(0, 34);
  cdHeader.writeUInt16LE(0, 36);
  cdHeader.writeUInt32LE(0, 38);
  cdHeader.writeUInt32LE(0, 42);
  nameBytes.copy(cdHeader, 46);

  const cdOffset = localHeader.length + compressed.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdHeader.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localHeader, compressed, cdHeader, eocd]);
}

test("1. CLI md2qti compiles numbered Markdown/Word exam into valid IMS QTI 2.1 & 1.2 ZIP packages", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lms-qti-md-"));
  try {
    const out21 = path.join(tmpDir, "exam_qti21.zip");
    const stdout21 = execFileSync(
      process.execPath,
      [CLI_BIN, "md2qti", path.join(EXAMPLES_DIR, "sample_exam.md"), "-o", out21, "--qti", "2.1", "--title", "Cell Bio Midterm", "--json"],
      { encoding: "utf8" }
    );
    const res21 = JSON.parse(stdout21);
    assert.equal(res21.ok, true);
    assert.equal(res21.questionCount, 5);
    assert.equal(res21.totalPoints, 13);
    assert.equal(res21.qtiVersion, "2.1");

    const zipBytes21 = fs.readFileSync(out21);
    assert.equal(zipBytes21.readUInt32LE(0), 0x04034b50);
    const extracted21 = await extractQtiXmlFromZipBytes(zipBytes21);
    // 1 test XML + 5 assessmentItem XMLs (imsmanifest.xml is skipped by extractQtiXmlFromZipBytes)
    assert.equal(extracted21.fileCount, 6);
    assert.match(extracted21.combinedXml, /<assessmentTest\b[^>]*title="Cell Bio Midterm"/);
    assert.match(extracted21.combinedXml, /cardinality="multiple"/);

    const out12 = path.join(tmpDir, "exam_qti12.zip");
    const stdout12 = execFileSync(
      process.execPath,
      [CLI_BIN, "md2qti", path.join(EXAMPLES_DIR, "sample_exam.md"), "-o", out12, "--qti", "1.2", "--json"],
      { encoding: "utf8" }
    );
    const res12 = JSON.parse(stdout12);
    assert.equal(res12.qtiVersion, "1.2");
    assert.equal(res12.questionCount, 5);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("2. CLI csv2qti compiles Google Forms / spreadsheet CSV quiz into IMS QTI 2.1 ZIP", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lms-qti-csv-"));
  try {
    const outZip = path.join(tmpDir, "forms_qti21.zip");
    const stdout = execFileSync(
      process.execPath,
      [CLI_BIN, "csv2qti", path.join(EXAMPLES_DIR, "sample_forms_quiz.csv"), "-o", outZip, "--json"],
      { encoding: "utf8" }
    );
    const summary = JSON.parse(stdout);
    assert.equal(summary.ok, true);
    assert.equal(summary.questionCount, 3);
    assert.equal(summary.totalPoints, 6);

    const extracted = await extractQtiXmlFromZipBytes(fs.readFileSync(outZip));
    assert.equal(extracted.fileCount, 4); // 1 test + 3 items
    assert.match(extracted.combinedXml, /429 Too Many Requests/);
    assert.match(extracted.combinedXml, /IndexedDB/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("3. CLI qti12to21 migrates DEFLATE-compressed Classic Quizzes QTI 1.2 ZIP to New Quizzes QTI 2.1 ZIP", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lms-qti-mig-"));
  try {
    const mdRaw = fs.readFileSync(path.join(EXAMPLES_DIR, "sample_exam.md"), "utf8");
    const questions = parseQuestionsInput(mdRaw, "markdown");
    const qti12Pkg = compileQti12Package(questions, { title: "Classic Psych Quiz" });

    // Compress QTI 1.2 XML using standard DEFLATE (method 8) just like Canvas Classic Quizzes exports
    const deflateZip = buildDeflateZipSingleFile("quiz_data/assessment_qti12.xml", qti12Pkg.assessmentXml);
    const classicZipPath = path.join(tmpDir, "classic_export.zip");
    fs.writeFileSync(classicZipPath, deflateZip);

    const migratedZipPath = path.join(tmpDir, "new_quizzes_qti21.zip");
    const stdout = execFileSync(
      process.execPath,
      [CLI_BIN, "qti12to21", classicZipPath, "-o", migratedZipPath, "--json"],
      { encoding: "utf8" }
    );
    const res = JSON.parse(stdout);
    assert.equal(res.ok, true);
    assert.equal(res.title, "Classic Psych Quiz");
    assert.equal(res.questionCount, 5);
    assert.equal(res.totalPoints, 13);

    const extracted21 = await extractQtiXmlFromZipBytes(fs.readFileSync(migratedZipPath));
    assert.equal(extracted21.fileCount, 6);
    assert.match(extracted21.combinedXml, /imsqti_v2p1/);
    assert.match(extracted21.combinedXml, /Mitochondrion/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("4. CLI rubric2xls converts Canvas SpeedGrader Rubric CSV into 2-tab Accreditation .xls workbook", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lms-rubric-"));
  try {
    const outXls = path.join(tmpDir, "rubric_matrix.xls");
    const outSummaryCsv = path.join(tmpDir, "summary.csv");
    const stdout = execFileSync(
      process.execPath,
      [
        CLI_BIN,
        "rubric2xls",
        path.join(EXAMPLES_DIR, "sample_speedgrader_rubric.csv"),
        "-o",
        outXls,
        "--summary-out",
        outSummaryCsv,
        "--json"
      ],
      { encoding: "utf8" }
    );
    const res = JSON.parse(stdout);
    assert.equal(res.ok, true);
    assert.equal(res.studentCount, 4); // Skips Canvas 'Points Possible' dummy row automatically
    assert.equal(res.criterionCount, 3);
    assert.equal(res.maxPoints, 20);
    assert.deepEqual(res.sections, ["BIO-101-A", "BIO-101-B"]);

    const xlsXml = fs.readFileSync(outXls, "utf8");
    assert.match(xlsXml, /Worksheet ss:Name="Student_Criterion_Matrix"/);
    assert.match(xlsXml, /Worksheet ss:Name="Accreditation_Summary"/);
    assert.match(xlsXml, /Section Avg: BIO-101-A/);

    const summaryCsv = fs.readFileSync(outSummaryCsv, "utf8");
    assert.match(summaryCsv, /Thesis & Claim/);
    assert.match(summaryCsv, /Mastery Rate %/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("5. CLI match-roster fuzzy-matches PowerSchool SIS names with Classroom/Kahoot nicknames and scales points locally", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lms-roster-"));
  try {
    const outCsv = path.join(tmpDir, "matched.csv");
    const outAudit = path.join(tmpDir, "audit.csv");
    const stdout = execFileSync(
      process.execPath,
      [
        CLI_BIN,
        "match-roster",
        "--target",
        path.join(EXAMPLES_DIR, "sample_powerschool_roster.csv"),
        "--source",
        path.join(EXAMPLES_DIR, "sample_classroom_scores.csv"),
        "--assignment",
        "Unit_3_Quiz_Pct",
        "--source-max",
        "20",
        "--target-max",
        "100",
        "-o",
        outCsv,
        "--audit-out",
        outAudit,
        "--json"
      ],
      { encoding: "utf8" }
    );
    const res = JSON.parse(stdout);
    assert.equal(res.ok, true);
    assert.equal(res.totalTargetStudents, 4);
    assert.equal(res.matchedCount, 4);
    assert.equal(res.unmatchedCount, 0);

    // Verify 18/20 -> 90, 19/20 -> 95, 17/20 -> 85, 20/20 -> 100
    const scores = res.matchReport.map((r) => r.exportedScore);
    assert.deepEqual(scores, [90, 95, 85, 100]);

    const matchedCsv = fs.readFileSync(outCsv, "utf8");
    assert.match(matchedCsv, /Unit_3_Quiz_Pct/);
    assert.match(matchedCsv, /"Carter, William \(Liam\)",10,90/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("6. Programmatic ESM library APIs & zero-dependency guarantee", async () => {
  const pkgJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  assert.equal(pkgJson.dependencies, undefined, "Toolkit must remain 100% zero-dependency");
  assert.equal(pkgJson.license, "MIT");

  const qti12 = compileQti12Package(
    [{ prompt: "2 + 2 = ?", type: "multiple_choice_question", points: 2, choices: [{ letter: "A", text: "4", correct: true }, { letter: "B", text: "5", correct: false }] }],
    { title: "Arithmetic Check" }
  );
  const migrated = await convertQti12To21(qti12.zipBytes);
  assert.equal(migrated.questionCount, 1);
  assert.equal(migrated.title, "Arithmetic Check");
  assert.ok(migrated.zipBytes.byteLength > 200);

  const rubric = buildRubricAccreditationMatrix({
    assignmentTitle: "Lab Report 1",
    pointsPossible: 10,
    criteria: [{ id: "c1", description: "Methodology", points: 10 }],
    submissions: [
      { user_id: "1", user: { name: "Ada Lovelace", section: "Sec 1" }, rubric_assessment: { c1: { points: 9, comments: "Well structured" } } },
      { user_id: "2", user: { name: "Alan Turing", section: "Sec 1" }, rubric_assessment: { c1: { points: 8, comments: "Clear proof" } } }
    ]
  });
  assert.equal(rubric.studentCount, 2);
  assert.equal(rubric.summaryRows[0][10], 100); // 100% mastery (>= 8/10)

  const rosterRes = matchGradebookRosters(
    "SIS_ID,Student\n101,\"Smith, Robert J.\"",
    "Player,Points\nBobby Smith,15"
  );
  assert.equal(rosterRes.matchedCount, 1);
  assert.equal(rosterRes.matchReport[0].method, "nickname_dictionary_match");
});
