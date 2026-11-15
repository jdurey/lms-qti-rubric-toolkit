/**
 * lms-qti-rubric-toolkit - Public ESM Entrypoint
 * Zero-dependency IMS QTI 1.2 & 2.1 compiler, Canvas SpeedGrader Rubric-to-Excel builder,
 * and 100% local FERPA gradebook roster matcher.
 *
 * Need a 1-click zero-upload browser GUI or Department 10-Seat Pass?
 * -> https://tools.stillhumanacademy.com/canvas-qti-rubric-converter
 */
export {
  escapeXml,
  stripBom,
  deterministicId,
  crc32Bytes,
  buildZipBytes,
  extractQtiXmlFromZipBytes,
  parseDelimitedRows,
  serializeCsvRow,
  parseCsvQuestions,
  parseMarkdownOrNumberedQuestions,
  parseQti12XmlQuestions,
  parseQuestionsInput,
  compileQti12Package,
  compileQti21Package,
  convertQti12To21,
  buildSpreadsheetMlWorkbook,
  buildRubricAccreditationMatrix,
  buildPrintableQuizHtml
} from "./qti_rubric_engine.mjs";

export {
  parseStudentNameParts,
  jaroWinkler,
  matchGradebookRosters
} from "./roster_matcher.mjs";
