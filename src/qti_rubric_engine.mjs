/**
 * LMS QTI 1.2 / 2.1 Compiler & Canvas SpeedGrader Rubric Matrix Engine
 * Pure JavaScript / Node.js ESM with zero external dependencies.
 * Licensed under MIT. Browser GUI: https://tools.stillhumanacademy.com/canvas-qti-rubric-converter
 */
import zlib from "node:zlib";

export function escapeXml(val) {
  return String(val == null ? "" : val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function stripBom(text) {
  const s = String(text == null ? "" : text);
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

export function deterministicId(prefix, index, seedText) {
  let hash = 2166136261 >>> 0;
  const str = String(prefix) + ":" + String(index) + ":" + String(seedText || "");
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return prefix + "_" + index + "_" + hash.toString(16).padStart(8, "0");
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32Bytes(bytes) {
  let crc = 0xffffffff >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    crc = (CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function utf8Encode(str) {
  return new TextEncoder().encode(String(str));
}

function writeU16LE(buf, offset, val) {
  buf[offset] = val & 0xff;
  buf[offset + 1] = (val >>> 8) & 0xff;
}

function writeU32LE(buf, offset, val) {
  buf[offset] = val & 0xff;
  buf[offset + 1] = (val >>> 8) & 0xff;
  buf[offset + 2] = (val >>> 16) & 0xff;
  buf[offset + 3] = (val >>> 24) & 0xff;
}

/**
 * Builds a valid PKZIP archive (STORE method 0, UTF-8 filenames) in pure JS.
 * @param {Array<{name: string, data: string|Uint8Array}>} entries
 * @returns {Uint8Array}
 */
export function buildZipBytes(entries) {
  const prepared = entries.map((entry) => {
    const cleanName = String(entry.name || "file.txt").replace(/^\/+/, "");
    const nameBytes = utf8Encode(cleanName);
    const dataBytes = entry.data instanceof Uint8Array ? entry.data : utf8Encode(entry.data || "");
    const crc = crc32Bytes(dataBytes);
    return { nameBytes, dataBytes, crc };
  });

  const dosTime = (12 << 11) | (0 << 5) | 0;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;

  let localSize = 0;
  let centralSize = 0;
  for (const item of prepared) {
    localSize += 30 + item.nameBytes.length + item.dataBytes.length;
    centralSize += 46 + item.nameBytes.length;
  }
  const totalSize = localSize + centralSize + 22;
  const out = new Uint8Array(totalSize);

  let localOffset = 0;
  const offsets = [];

  for (const item of prepared) {
    offsets.push(localOffset);
    writeU32LE(out, localOffset, 0x04034b50);
    writeU16LE(out, localOffset + 4, 20);
    writeU16LE(out, localOffset + 6, 0x0800);
    writeU16LE(out, localOffset + 8, 0);
    writeU16LE(out, localOffset + 10, dosTime);
    writeU16LE(out, localOffset + 12, dosDate);
    writeU32LE(out, localOffset + 14, item.crc);
    writeU32LE(out, localOffset + 18, item.dataBytes.length);
    writeU32LE(out, localOffset + 22, item.dataBytes.length);
    writeU16LE(out, localOffset + 26, item.nameBytes.length);
    writeU16LE(out, localOffset + 28, 0);
    out.set(item.nameBytes, localOffset + 30);
    out.set(item.dataBytes, localOffset + 30 + item.nameBytes.length);
    localOffset += 30 + item.nameBytes.length + item.dataBytes.length;
  }

  const centralStart = localOffset;
  let centralCursor = centralStart;

  for (let i = 0; i < prepared.length; i++) {
    const item = prepared[i];
    writeU32LE(out, centralCursor, 0x02014b50);
    writeU16LE(out, centralCursor + 4, 20);
    writeU16LE(out, centralCursor + 6, 20);
    writeU16LE(out, centralCursor + 8, 0x0800);
    writeU16LE(out, centralCursor + 10, 0);
    writeU16LE(out, centralCursor + 12, dosTime);
    writeU16LE(out, centralCursor + 14, dosDate);
    writeU32LE(out, centralCursor + 16, item.crc);
    writeU32LE(out, centralCursor + 20, item.dataBytes.length);
    writeU32LE(out, centralCursor + 24, item.dataBytes.length);
    writeU16LE(out, centralCursor + 28, item.nameBytes.length);
    writeU16LE(out, centralCursor + 30, 0);
    writeU16LE(out, centralCursor + 32, 0);
    writeU16LE(out, centralCursor + 34, 0);
    writeU16LE(out, centralCursor + 36, 0);
    writeU32LE(out, centralCursor + 38, 0);
    writeU32LE(out, centralCursor + 42, offsets[i]);
    out.set(item.nameBytes, centralCursor + 46);
    centralCursor += 46 + item.nameBytes.length;
  }

  writeU32LE(out, centralCursor, 0x06054b50);
  writeU16LE(out, centralCursor + 4, 0);
  writeU16LE(out, centralCursor + 6, 0);
  writeU16LE(out, centralCursor + 8, prepared.length);
  writeU16LE(out, centralCursor + 10, prepared.length);
  writeU32LE(out, centralCursor + 12, centralSize);
  writeU32LE(out, centralCursor + 16, centralStart);
  writeU16LE(out, centralCursor + 20, 0);

  return out;
}

export function parseDelimitedRows(rawText, forcedDelimiter) {
  const text = stripBom(rawText).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!text.trim()) return [];

  let delim = forcedDelimiter;
  if (!delim) {
    const firstLine = text.split("\n")[0] || "";
    const tabs = (firstLine.match(/\t/g) || []).length;
    const commas = (firstLine.match(/,/g) || []).length;
    const semis = (firstLine.match(/;/g) || []).length;
    if (tabs > commas && tabs >= semis) delim = "\t";
    else if (semis > commas) delim = ";";
    else delim = ",";
  }

  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delim) {
        row.push(field);
        field = "";
      } else if (ch === "\n") {
        row.push(field);
        if (row.some((c) => c.trim() !== "")) {
          rows.push(row);
        }
        row = [];
        field = "";
      } else {
        field += ch;
      }
    }
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) {
    rows.push(row);
  }
  return rows;
}

export function serializeCsvRow(cells, delimiter = ",") {
  const d = delimiter || ",";
  return cells
    .map((val) => {
      const s = String(val == null ? "" : val);
      if (s.includes(d) || s.includes('"') || s.includes("\n") || s.includes("\r")) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    })
    .join(d);
}

function normalizeQuestionType(rawType, choices, acceptedAnswers) {
  const t = String(rawType || "").toLowerCase().trim();
  if (t.includes("essay") || t === "es" || t === "open") return "essay_question";
  if (t.includes("short") || t.includes("fib") || t.includes("fill") || t === "sa") {
    return "short_answer_question";
  }
  if (t.includes("mult") && (t.includes("ans") || t.includes("select") || t === "ma" || t === "ms")) {
    return "multiple_answers_question";
  }
  if (t.includes("true") || t === "tf" || t === "t/f") {
    return "true_false_question";
  }
  if (choices && choices.length > 0) {
    const correctCount = choices.filter((c) => c.correct).length;
    if (correctCount > 1) return "multiple_answers_question";
    if (
      choices.length === 2 &&
      choices.every((c) => /^(true|false)$/i.test(c.text.trim()))
    ) {
      return "true_false_question";
    }
    return "multiple_choice_question";
  }
  if (acceptedAnswers && acceptedAnswers.length > 0) {
    return "short_answer_question";
  }
  return "essay_question";
}

export function parseCsvQuestions(rawText) {
  const rows = parseDelimitedRows(rawText);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const looksLikeCsvHeader =
    header.some((h) => h.includes("question") || h === "prompt" || h === "stem") &&
    rows[0].length >= 2;
  if (!looksLikeCsvHeader) return [];

  const idxPrompt = header.findIndex((h) => h.includes("question") || h === "prompt" || h === "stem");
  const idxType = header.findIndex((h) => h === "type" || h.includes("question_type") || h.includes("qtype"));
  const idxPoints = header.findIndex((h) => h.includes("point") || h === "pts" || h === "score");
  const idxCorrect = header.findIndex((h) => h.includes("correct") || h === "answer" || h === "key");
  const idxFeedback = header.findIndex((h) => h.includes("feedback") || h.includes("explanation") || h.includes("rationale"));

  const choiceCols = [];
  header.forEach((h, colIdx) => {
    if (colIdx === idxPrompt || colIdx === idxType || colIdx === idxPoints || colIdx === idxCorrect || colIdx === idxFeedback) {
      return;
    }
    if (
      /^(choice|option|distractor|answer|ans)[\s_]*[a-h1-8]$/i.test(h) ||
      /^[a-f]$/.test(h)
    ) {
      choiceCols.push({ colIdx, label: h });
    }
  });

  const questions = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const prompt = (row[idxPrompt] || "").trim();
    if (!prompt) continue;

    const rawType = idxType >= 0 ? row[idxType] : "";
    const points = idxPoints >= 0 && !isNaN(parseFloat(row[idxPoints])) ? parseFloat(row[idxPoints]) : 1;
    const rawCorrect = idxCorrect >= 0 ? String(row[idxCorrect] || "").trim() : "";
    const feedback = idxFeedback >= 0 ? String(row[idxFeedback] || "").trim() : "";

    const rawChoices = [];
    for (let c = 0; c < choiceCols.length; c++) {
      const txt = String(row[choiceCols[c].colIdx] || "").trim();
      if (txt !== "") {
        rawChoices.push({
          letter: String.fromCharCode(65 + rawChoices.length),
          text: txt,
          correct: false
        });
      }
    }

    const tokens = rawCorrect
      .split(/[,;|]/)
      .map((s) => s.trim())
      .filter(Boolean);

    const acceptedAnswers = [];
    if (rawChoices.length > 0) {
      for (const tok of tokens) {
        const upper = tok.toUpperCase();
        for (let i = 0; i < rawChoices.length; i++) {
          const letter = String.fromCharCode(65 + i);
          const numStr = String(i + 1);
          if (
            upper === letter ||
            upper === "CHOICE " + letter ||
            upper === "OPTION " + letter ||
            upper === numStr ||
            rawChoices[i].text.toLowerCase() === tok.toLowerCase()
          ) {
            rawChoices[i].correct = true;
          }
        }
      }
    } else if (/^(true|false)$/i.test(rawCorrect) || /true|tf/i.test(rawType)) {
      const isTrue = /^t(rue)?$/i.test(rawCorrect || "True");
      rawChoices.push({ letter: "A", text: "True", correct: isTrue });
      rawChoices.push({ letter: "B", text: "False", correct: !isTrue });
    } else if (tokens.length > 0) {
      acceptedAnswers.push(...tokens);
    }

    if (rawChoices.length > 0 && !rawChoices.some((c) => c.correct)) {
      rawChoices[0].correct = true;
    }

    const qType = normalizeQuestionType(rawType, rawChoices, acceptedAnswers);
    questions.push({
      id: deterministicId("q", questions.length + 1, prompt),
      title: "Question " + (questions.length + 1),
      type: qType,
      points: points > 0 ? points : 1,
      prompt,
      choices: rawChoices,
      acceptedAnswers,
      feedback
    });
  }
  return questions;
}

export function parseMarkdownOrNumberedQuestions(rawText) {
  const lines = stripBom(rawText).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const blocks = [];
  let current = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const startsNewQuestion = /^\d+[\.\)]\s+\S/.test(trimmed) || /^#{2,4}\s*Q(uestion)?\s*\d+/i.test(trimmed);
    if (startsNewQuestion && current.some((l) => l.trim() !== "")) {
      blocks.push(current);
      current = [line];
    } else if (trimmed === "" && current.length > 0 && current[current.length - 1].trim() === "") {
      // collapse adjacent blank lines
    } else {
      current.push(line);
    }
  }
  if (current.some((l) => l.trim() !== "")) {
    blocks.push(current);
  }

  const questions = [];
  for (const blk of blocks) {
    const nonEmpty = blk.map((l) => l.trim()).filter(Boolean);
    if (nonEmpty.length === 0) continue;

    let first = nonEmpty[0]
      .replace(/^#{2,4}\s*Q(?:uestion)?\s*\d+[:\.\)]?\s*/i, "")
      .replace(/^\d+[\.\)]\s*/, "");

    let points = 1;
    const ptsMatch = first.match(/\((\d+(?:\.\d+)?)\s*(?:pts?|points?)\)\s*$/i);
    if (ptsMatch) {
      points = parseFloat(ptsMatch[1]);
      first = first.slice(0, ptsMatch.index).trim();
    }

    let explicitType = "";
    const typeTag = first.match(/^\[(MC|MA|TF|SA|ESSAY|FIB)\]\s*/i);
    if (typeTag) {
      explicitType = typeTag[1].toUpperCase();
      first = first.slice(typeTag[0].length).trim();
    }

    const promptLines = [first];
    const choices = [];
    const acceptedAnswers = [];
    let feedback = "";
    let answerKeyLetters = [];

    for (let i = 1; i < nonEmpty.length; i++) {
      const ln = nonEmpty[i];

      const fbMatch = ln.match(/^(?:\.\.\.|feedback:|explanation:|rationale:)\s*(.+)$/i);
      if (fbMatch) {
        feedback = (feedback ? feedback + " " : "") + fbMatch[1].trim();
        continue;
      }

      const ansLine = ln.match(/^(?:answer|ans|correct(?:\s+answer)?)s?\s*[:=]\s*(.+)$/i);
      if (ansLine) {
        const val = ansLine[1].trim();
        answerKeyLetters = val.split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
        continue;
      }

      const cbMatch = ln.match(/^(?:[-*]\s*)?\[([xX\s])\]\s*(.+)$/);
      if (cbMatch) {
        choices.push({
          letter: String.fromCharCode(65 + choices.length),
          text: cbMatch[2].trim(),
          correct: cbMatch[1].toLowerCase() === "x"
        });
        continue;
      }

      const mcMatch = ln.match(/^(\*)?([a-hA-H])[\.\)]\s*(.+)$/);
      if (mcMatch) {
        choices.push({
          letter: mcMatch[2].toUpperCase(),
          text: mcMatch[3].trim(),
          correct: Boolean(mcMatch[1])
        });
        continue;
      }

      const saMatch = ln.match(/^\*\s+(.+)$/);
      if (saMatch && choices.length === 0) {
        acceptedAnswers.push(saMatch[1].trim());
        continue;
      }

      if (choices.length === 0 && acceptedAnswers.length === 0) {
        promptLines.push(ln);
      }
    }

    if (answerKeyLetters.length > 0) {
      if (choices.length > 0) {
        for (const tok of answerKeyLetters) {
          const up = tok.toUpperCase();
          for (const ch of choices) {
            if (ch.letter === up || ch.text.toLowerCase() === tok.toLowerCase()) {
              ch.correct = true;
            }
          }
        }
      } else if (/^(true|false|t|f)$/i.test(answerKeyLetters[0])) {
        const isTrue = /^t(rue)?$/i.test(answerKeyLetters[0]);
        choices.push({ letter: "A", text: "True", correct: isTrue });
        choices.push({ letter: "B", text: "False", correct: !isTrue });
      } else {
        acceptedAnswers.push(...answerKeyLetters);
      }
    }

    const prompt = promptLines.join(" ").trim();
    if (!prompt) continue;

    if (/^true\s+or\s+false\s*[:\-]/i.test(prompt) && choices.length === 0) {
      choices.push({ letter: "A", text: "True", correct: true });
      choices.push({ letter: "B", text: "False", correct: false });
    }

    if (choices.length > 0 && !choices.some((c) => c.correct)) {
      choices[0].correct = true;
    }

    const qType = normalizeQuestionType(explicitType, choices, acceptedAnswers);
    questions.push({
      id: deterministicId("q", questions.length + 1, prompt),
      title: "Question " + (questions.length + 1),
      type: qType,
      points: points > 0 ? points : 1,
      prompt,
      choices,
      acceptedAnswers,
      feedback
    });
  }

  return questions;
}

function unescapeXmlEntities(str) {
  return String(str == null ? "" : str)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function cleanMattextToPlain(rawMattext) {
  const once = unescapeXmlEntities(rawMattext);
  const stripped = once
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, " ")
    .replace(/<[^>]+>/g, "");
  return unescapeXmlEntities(stripped).replace(/\s+/g, " ").trim();
}

export function parseQti12XmlQuestions(rawXml) {
  const xml = stripBom(rawXml || "");
  const itemMatches = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  const questions = [];

  for (let idx = 0; idx < itemMatches.length; idx++) {
    const itemXml = itemMatches[idx];
    const titleAttr = (itemXml.match(/<item\b[^>]*\btitle="([^"]*)"/i) || [])[1] || ("Question " + (idx + 1));

    let metaType = "";
    let points = 1;
    const metaFields = itemXml.match(/<qtimetadatafield>[\s\S]*?<\/qtimetadatafield>/gi) || [];
    for (const mf of metaFields) {
      const lbl = ((mf.match(/<fieldlabel>([\s\S]*?)<\/fieldlabel>/i) || [])[1] || "").trim().toLowerCase();
      const ent = ((mf.match(/<fieldentry>([\s\S]*?)<\/fieldentry>/i) || [])[1] || "").trim();
      if (lbl === "question_type") metaType = ent;
      if (lbl === "points_possible" && !isNaN(parseFloat(ent))) points = parseFloat(ent);
    }

    const presBlock = ((itemXml.match(/<presentation\b[\s\S]*?<\/presentation>/i) || [])[0]) || itemXml;
    const beforeResponse = presBlock.split(/<response_(?:lid|str|num|grp)\b/i)[0] || presBlock;
    const stemMatMatches = beforeResponse.match(/<mattext\b[^>]*>([\s\S]*?)<\/mattext>/gi) || [];
    const prompt = stemMatMatches
      .map((m) => cleanMattextToPlain(m.replace(/^<mattext\b[^>]*>/i, "").replace(/<\/mattext>$/i, "")))
      .filter(Boolean)
      .join(" ")
      .trim();
    if (!prompt) continue;

    const labelMatches = presBlock.match(/<response_label\b[\s\S]*?<\/response_label>/gi) || [];
    const rawChoices = [];
    for (const lm of labelMatches) {
      const ident = ((lm.match(/<response_label\b[^>]*\bident="([^"]+)"/i) || [])[1] || "").trim();
      const matMatch = lm.match(/<mattext\b[^>]*>([\s\S]*?)<\/mattext>/i);
      if (!matMatch) continue;
      const choiceTxt = cleanMattextToPlain(matMatch[1]);
      if (!choiceTxt) continue;
      rawChoices.push({
        ident,
        letter: String.fromCharCode(65 + rawChoices.length),
        text: choiceTxt,
        correct: false
      });
    }

    const correctIdents = new Set();
    const acceptedAnswers = [];
    const respConds = itemXml.match(/<respcondition\b[\s\S]*?<\/respcondition>/gi) || [];
    for (const rc of respConds) {
      const setvarMatch = rc.match(/<setvar\b[^>]*>([\s\S]*?)<\/setvar>/i);
      const scoreVal = setvarMatch ? parseFloat(setvarMatch[1].trim()) : NaN;
      const awardsScore = !setvarMatch ? false : (isNaN(scoreVal) || scoreVal > 0);
      if (!awardsScore) continue;
      const withoutNot = rc.replace(/<not\b[\s\S]*?<\/not>/gi, "");
      const varEquals = withoutNot.match(/<varequal\b[^>]*>([\s\S]*?)<\/varequal>/gi) || [];
      for (const ve of varEquals) {
        const val = unescapeXmlEntities(ve.replace(/^<varequal\b[^>]*>/i, "").replace(/<\/varequal>$/i, "")).trim();
        if (!val) continue;
        correctIdents.add(val);
        if (rawChoices.length === 0) {
          acceptedAnswers.push(val);
        }
      }
    }

    for (const ch of rawChoices) {
      if (correctIdents.has(ch.ident) || correctIdents.has(ch.text)) {
        ch.correct = true;
      }
    }
    if (rawChoices.length > 0 && !rawChoices.some((c) => c.correct)) {
      rawChoices[0].correct = true;
    }

    let feedback = "";
    const fbBlock = (itemXml.match(/<itemfeedback\b[^>]*ident="general_fb"[\s\S]*?<\/itemfeedback>/i) ||
      itemXml.match(/<itemfeedback\b[\s\S]*?<\/itemfeedback>/i) || [])[0];
    if (fbBlock) {
      const fbMat = fbBlock.match(/<mattext\b[^>]*>([\s\S]*?)<\/mattext>/i);
      if (fbMat) feedback = cleanMattextToPlain(fbMat[1]);
    }

    const choices = rawChoices.map((c) => ({
      letter: c.letter,
      text: c.text,
      correct: c.correct
    }));
    const qType = normalizeQuestionType(metaType, choices, acceptedAnswers);
    questions.push({
      id: deterministicId("q", questions.length + 1, prompt),
      title: unescapeXmlEntities(titleAttr),
      type: qType,
      points: points > 0 ? points : 1,
      prompt,
      choices,
      acceptedAnswers,
      feedback
    });
  }

  return questions;
}

async function decompressDeflateRaw(compressedBytes) {
  if (zlib && typeof zlib.inflateRawSync === "function") {
    return new Uint8Array(zlib.inflateRawSync(Buffer.from(compressedBytes)));
  }
  if (typeof DecompressionStream !== "undefined") {
    const ds = new DecompressionStream("deflate-raw");
    const writer = ds.writable.getWriter();
    writer.write(compressedBytes);
    writer.close();
    const reader = ds.readable.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out;
  }
  throw new Error("Deflate decompression unavailable in this environment.");
}

export async function extractQtiXmlFromZipBytes(inputBytes) {
  const buf = inputBytes instanceof Uint8Array ? inputBytes : new Uint8Array(inputBytes);
  const readU16 = (off) => buf[off] | (buf[off + 1] << 8);
  const readU32 = (off) => (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0;
  const decodeUtf8 = (bytes) => new TextDecoder("utf-8").decode(bytes);

  let eocdOffset = -1;
  const minSearch = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= minSearch; i--) {
    if (readU32(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error("Invalid ZIP archive: End of Central Directory signature not found.");
  }

  const totalEntries = readU16(eocdOffset + 10);
  let cdOffset = readU32(eocdOffset + 16);
  const xmlFiles = [];

  for (let e = 0; e < totalEntries && cdOffset + 46 <= buf.length; e++) {
    if (readU32(cdOffset) !== 0x02014b50) break;
    const method = readU16(cdOffset + 10);
    const compSize = readU32(cdOffset + 20);
    const nameLen = readU16(cdOffset + 28);
    const extraLen = readU16(cdOffset + 30);
    const commentLen = readU16(cdOffset + 32);
    const localHeaderOffset = readU32(cdOffset + 42);
    const fileName = decodeUtf8(buf.subarray(cdOffset + 46, cdOffset + 46 + nameLen));
    cdOffset += 46 + nameLen + extraLen + commentLen;

    const lower = fileName.toLowerCase();
    if (!lower.endsWith(".xml")) continue;
    const base = lower.split("/").pop();
    if (base === "imsmanifest.xml" || base === "assessment_meta.xml") continue;

    if (localHeaderOffset + 30 > buf.length || readU32(localHeaderOffset) !== 0x04034b50) continue;
    const localNameLen = readU16(localHeaderOffset + 26);
    const localExtraLen = readU16(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const rawSlice = buf.subarray(dataStart, dataStart + compSize);

    let uncompressed;
    if (method === 0) {
      uncompressed = rawSlice;
    } else if (method === 8) {
      uncompressed = await decompressDeflateRaw(rawSlice);
    } else {
      continue;
    }
    xmlFiles.push({ name: fileName, content: decodeUtf8(uncompressed) });
  }

  const combinedXml = xmlFiles.map((f) => f.content).join("\n");
  return {
    fileCount: xmlFiles.length,
    files: xmlFiles,
    combinedXml
  };
}

export function parseQuestionsInput(rawText, formatHint) {
  const clean = stripBom(rawText || "").trim();
  if (!clean) return [];
  if (formatHint === "qti12" || /<questestinterop\b/i.test(clean) || (/<item\b/i.test(clean) && /<presentation\b/i.test(clean))) {
    return parseQti12XmlQuestions(clean);
  }
  if (formatHint === "csv") {
    return parseCsvQuestions(clean);
  }
  if (formatHint === "markdown" || formatHint === "text") {
    return parseMarkdownOrNumberedQuestions(clean);
  }
  const csvAttempt = parseCsvQuestions(clean);
  if (csvAttempt.length > 0) return csvAttempt;
  return parseMarkdownOrNumberedQuestions(clean);
}

function buildQti12ItemXml(q, idx) {
  const itemIdent = q.id || deterministicId("item", idx + 1, q.prompt);
  const qRef = deterministicId("qref", idx + 1, q.prompt);
  const title = escapeXml(q.title || "Question " + (idx + 1));
  const points = Number(q.points || 1).toFixed(2);
  const promptHtml = escapeXml("<p>" + escapeXml(q.prompt) + "</p>");
  const qType = q.type || "multiple_choice_question";

  const choiceWithIds = (q.choices || []).map((ch, cIdx) => ({
    ...ch,
    ident: deterministicId("resp", (idx + 1) * 100 + cIdx + 1, ch.text)
  }));

  let metadataExtra = "";
  if (choiceWithIds.length > 0) {
    metadataExtra =
      "\n          <qtimetadatafield>\n" +
      "            <fieldlabel>original_answer_ids</fieldlabel>\n" +
      "            <fieldentry>" +
      choiceWithIds.map((c) => c.ident).join(",") +
      "</fieldentry>\n" +
      "          </qtimetadatafield>";
  }

  let presentationBody = "";
  let resprocessingBody = "";

  if (qType === "multiple_choice_question" || qType === "true_false_question") {
    const correctChoice = choiceWithIds.find((c) => c.correct) || choiceWithIds[0];
    const labelsXml = choiceWithIds
      .map(
        (c) =>
          `            <response_label ident="${c.ident}">\n` +
          `              <material>\n` +
          `                <mattext texttype="text/plain">${escapeXml(c.text)}</mattext>\n` +
          `              </material>\n` +
          `            </response_label>`
      )
      .join("\n");

    presentationBody =
      `        <response_lid ident="response1" rcardinality="Single">\n` +
      `          <render_choice>\n${labelsXml}\n` +
      `          </render_choice>\n` +
      `        </response_lid>`;

    resprocessingBody =
      `        <respcondition continue="No">\n` +
      `          <conditionvar>\n` +
      `            <varequal respident="response1">${correctChoice ? correctChoice.ident : ""}</varequal>\n` +
      `          </conditionvar>\n` +
      `          <setvar action="Set" varname="SCORE">100</setvar>\n` +
      `        </respcondition>`;
  } else if (qType === "multiple_answers_question") {
    const labelsXml = choiceWithIds
      .map(
        (c) =>
          `            <response_label ident="${c.ident}">\n` +
          `              <material>\n` +
          `                <mattext texttype="text/plain">${escapeXml(c.text)}</mattext>\n` +
          `              </material>\n` +
          `            </response_label>`
      )
      .join("\n");

    presentationBody =
      `        <response_lid ident="response1" rcardinality="Multiple">\n` +
      `          <render_choice>\n${labelsXml}\n` +
      `          </render_choice>\n` +
      `        </response_lid>`;

    const andClauses = choiceWithIds
      .map((c) =>
        c.correct
          ? `              <varequal respident="response1">${c.ident}</varequal>`
          : `              <not><varequal respident="response1">${c.ident}</varequal></not>`
      )
      .join("\n");

    resprocessingBody =
      `        <respcondition continue="No">\n` +
      `          <conditionvar>\n` +
      `            <and>\n${andClauses}\n` +
      `            </and>\n` +
      `          </conditionvar>\n` +
      `          <setvar action="Set" varname="SCORE">100</setvar>\n` +
      `        </respcondition>`;
  } else if (qType === "short_answer_question") {
    presentationBody =
      `        <response_str ident="response1" rcardinality="Single">\n` +
      `          <render_fib>\n` +
      `            <response_label ident="answer1" rshuffle="No"/>\n` +
      `          </render_fib>\n` +
      `        </response_str>`;

    const accepted = (q.acceptedAnswers || []).filter(Boolean);
    resprocessingBody = accepted
      .map(
        (ans) =>
          `        <respcondition continue="No">\n` +
          `          <conditionvar>\n` +
          `            <varequal respident="response1" case="No">${escapeXml(ans)}</varequal>\n` +
          `          </conditionvar>\n` +
          `          <setvar action="Set" varname="SCORE">100</setvar>\n` +
          `        </respcondition>`
      )
      .join("\n");
  } else {
    presentationBody =
      `        <response_str ident="response1" rcardinality="Single">\n` +
      `          <render_fib>\n` +
      `            <response_label ident="answer1" rshuffle="No"/>\n` +
      `          </render_fib>\n` +
      `        </response_str>`;
    resprocessingBody =
      `        <respcondition continue="No">\n` +
      `          <conditionvar>\n` +
      `            <other/>\n` +
      `          </conditionvar>\n` +
      `        </respcondition>`;
  }

  let feedbackXml = "";
  if (q.feedback) {
    feedbackXml =
      `\n      <itemfeedback ident="general_fb">\n` +
      `        <flow_mat>\n` +
      `          <material>\n` +
      `            <mattext texttype="text/html">${escapeXml("<p>" + escapeXml(q.feedback) + "</p>")}</mattext>\n` +
      `          </material>\n` +
      `        </flow_mat>\n` +
      `      </itemfeedback>`;
  }

  return (
    `      <item ident="${itemIdent}" title="${title}">\n` +
    `        <itemmetadata>\n` +
    `          <qtimetadata>\n` +
    `            <qtimetadatafield>\n` +
    `              <fieldlabel>question_type</fieldlabel>\n` +
    `              <fieldentry>${qType}</fieldentry>\n` +
    `            </qtimetadatafield>\n` +
    `            <qtimetadatafield>\n` +
    `              <fieldlabel>points_possible</fieldlabel>\n` +
    `              <fieldentry>${points}</fieldentry>\n` +
    `            </qtimetadatafield>\n` +
    `            <qtimetadatafield>\n` +
    `              <fieldlabel>assessment_question_identifierref</fieldlabel>\n` +
    `              <fieldentry>${qRef}</fieldentry>\n` +
    `            </qtimetadatafield>${metadataExtra}\n` +
    `          </qtimetadata>\n` +
    `        </itemmetadata>\n` +
    `        <presentation>\n` +
    `          <material>\n` +
    `            <mattext texttype="text/html">${promptHtml}</mattext>\n` +
    `          </material>\n` +
    `${presentationBody}\n` +
    `        </presentation>\n` +
    `        <resprocessing>\n` +
    `          <outcomes>\n` +
    `            <decvar maxvalue="100" minvalue="0" varname="SCORE" vartype="Decimal"/>\n` +
    `          </outcomes>\n` +
    `${resprocessingBody}\n` +
    `        </resprocessing>${feedbackXml}\n` +
    `      </item>`
  );
}

export function compileQti12Package(questions, meta) {
  const opts = meta || {};
  const title = String(opts.title || "Imported Assessment").trim();
  const description = String(opts.description || "").trim();
  const assessmentId = deterministicId("assess", 1, title);
  const manifestId = deterministicId("man", 1, title);
  const metaResId = deterministicId("res_meta", 1, title);

  const totalPoints = questions.reduce((acc, q) => acc + Number(q.points || 1), 0);
  const itemsXml = questions.map((q, idx) => buildQti12ItemXml(q, idx)).join("\n");

  const assessmentXml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.imsglobal.org/xsd/ims_qtiasiv1p2 http://www.imsglobal.org/xsd/ims_qtiasiv1p2p1.xsd">\n` +
    `  <assessment ident="${assessmentId}" title="${escapeXml(title)}">\n` +
    `    <qtimetadata>\n` +
    `      <qtimetadatafield>\n` +
    `        <fieldlabel>cc_maxattempts</fieldlabel>\n` +
    `        <fieldentry>1</fieldentry>\n` +
    `      </qtimetadatafield>\n` +
    `    </qtimetadata>\n` +
    `    <section ident="root_section">\n` +
    `${itemsXml}\n` +
    `    </section>\n` +
    `  </assessment>\n` +
    `</questestinterop>\n`;

  const assessmentMetaXml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<quiz identifier="${assessmentId}" xmlns="http://canvas.instructure.com/xsd/cccv1p0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://canvas.instructure.com/xsd/cccv1p0 https://canvas.instructure.com/xsd/cccv1p0.xsd">\n` +
    `  <title>${escapeXml(title)}</title>\n` +
    `  <description>${escapeXml(description ? "<p>" + escapeXml(description) + "</p>" : "")}</description>\n` +
    `  <shuffle_answers>false</shuffle_answers>\n` +
    `  <scoring_policy>keep_highest</scoring_policy>\n` +
    `  <quiz_type>assignment</quiz_type>\n` +
    `  <points_possible>${totalPoints.toFixed(2)}</points_possible>\n` +
    `</quiz>\n`;

  const assessmentPath = `${assessmentId}/${assessmentId}.xml`;
  const metaPath = `${assessmentId}/assessment_meta.xml`;

  const manifestXml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<manifest identifier="${manifestId}" xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1" xmlns:lom="http://ltsc.ieee.org/xsd/imsccv1p1/LOM/resource" xmlns:imsmd="http://www.imsglobal.org/xsd/imsmd_v1p2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1 http://www.imsglobal.org/xsd/imscp_v1p1.xsd">\n` +
    `  <metadata>\n` +
    `    <schema>IMS Content</schema>\n` +
    `    <schemaversion>1.1.3</schemaversion>\n` +
    `  </metadata>\n` +
    `  <organizations/>\n` +
    `  <resources>\n` +
    `    <resource identifier="${assessmentId}" type="imsqti_xmlv1p2">\n` +
    `      <file href="${assessmentPath}"/>\n` +
    `      <dependency identifierref="${metaResId}"/>\n` +
    `    </resource>\n` +
    `    <resource identifier="${metaResId}" type="associatedcontent/imscc_xmlv1p1/learning-application-resource" href="${metaPath}">\n` +
    `      <file href="${metaPath}"/>\n` +
    `    </resource>\n` +
    `  </resources>\n` +
    `</manifest>\n`;

  const zipBytes = buildZipBytes([
    { name: "imsmanifest.xml", data: manifestXml },
    { name: assessmentPath, data: assessmentXml },
    { name: metaPath, data: assessmentMetaXml }
  ]);

  return {
    assessmentId,
    title,
    questionCount: questions.length,
    totalPoints,
    manifestXml,
    assessmentXml,
    assessmentMetaXml,
    zipBytes
  };
}

export function compileQti21Package(questions, meta) {
  const opts = meta || {};
  const title = String(opts.title || "Imported Assessment").trim();
  const testId = deterministicId("qti21_test", 1, title);
  const manifestId = deterministicId("qti21_man", 1, title);
  const totalPoints = questions.reduce((acc, q) => acc + Number(q.points || 1), 0);

  const itemFiles = [];
  const itemRefsXml = [];
  const resourceXmlList = [];

  questions.forEach((q, idx) => {
    const itemId = deterministicId("qti21_item", idx + 1, q.prompt);
    const fileName = `items/${itemId}.xml`;
    const points = Number(q.points || 1).toFixed(2);
    const qType = q.type || "multiple_choice_question";
    const choices = (q.choices || []).map((c, cIdx) => ({
      ...c,
      ident: "CHOICE_" + String.fromCharCode(65 + cIdx)
    }));

    let responseDecl = "";
    let itemBodyInner = `<p>${escapeXml(q.prompt)}</p>`;

    if (choices.length > 0) {
      const card = qType === "multiple_answers_question" ? "multiple" : "single";
      const maxChoices = qType === "multiple_answers_question" ? 0 : 1;
      const correctVals = choices
        .filter((c) => c.correct)
        .map((c) => `      <value>${c.ident}</value>`)
        .join("\n");
      responseDecl =
        `  <responseDeclaration identifier="RESPONSE" cardinality="${card}" baseType="identifier">\n` +
        `    <correctResponse>\n${correctVals}\n    </correctResponse>\n` +
        `  </responseDeclaration>`;
      const simpleChoices = choices
        .map((c) => `      <simpleChoice identifier="${c.ident}">${escapeXml(c.text)}</simpleChoice>`)
        .join("\n");
      itemBodyInner +=
        `\n    <choiceInteraction responseIdentifier="RESPONSE" shuffle="false" maxChoices="${maxChoices}">\n` +
        `${simpleChoices}\n` +
        `    </choiceInteraction>`;
    } else {
      const acceptedVals = (q.acceptedAnswers || [])
        .map((a) => `      <value>${escapeXml(a)}</value>`)
        .join("\n");
      responseDecl =
        `  <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="string">` +
        (acceptedVals ? `\n    <correctResponse>\n${acceptedVals}\n    </correctResponse>\n  ` : "") +
        `</responseDeclaration>`;
      itemBodyInner +=
        qType === "short_answer_question"
          ? `\n    <p><textEntryInteraction responseIdentifier="RESPONSE" expectedLength="40"/></p>`
          : `\n    <extendedTextInteraction responseIdentifier="RESPONSE" expectedLines="6"/>`;
    }

    const itemXml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<assessmentItem xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1" identifier="${itemId}" title="${escapeXml(q.title || "Question " + (idx + 1))}" adaptive="false" timeDependent="false">\n` +
      `${responseDecl}\n` +
      `  <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float">\n` +
      `    <defaultValue><value>${points}</value></defaultValue>\n` +
      `  </outcomeDeclaration>\n` +
      `  <itemBody>\n    ${itemBodyInner}\n  </itemBody>\n` +
      `  <responseProcessing template="http://www.imsglobal.org/question/qti_v2p1/rptemplates/match_correct"/>\n` +
      `</assessmentItem>\n`;

    itemFiles.push({ name: fileName, data: itemXml });
    itemRefsXml.push(`      <assessmentItemRef identifier="${itemId}" href="../${fileName}"/>`);
    resourceXmlList.push(
      `    <resource identifier="${itemId}" type="imsqti_item_xmlv2p1" href="${fileName}">\n` +
      `      <file href="${fileName}"/>\n` +
      `    </resource>`
    );
  });

  const testPath = `tests/${testId}.xml`;
  const testXml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<assessmentTest xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1" identifier="${testId}" title="${escapeXml(title)}">\n` +
    `  <testPart identifier="part_1" navigationMode="nonlinear" submissionMode="individual">\n` +
    `    <assessmentSection identifier="section_1" title="Main Section" visible="true">\n` +
    `${itemRefsXml.join("\n")}\n` +
    `    </assessmentSection>\n` +
    `  </testPart>\n` +
    `</assessmentTest>\n`;

  const manifestXml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<manifest identifier="${manifestId}" xmlns="http://www.imsglobal.org/xsd/imscp_v1p1">\n` +
    `  <metadata>\n` +
    `    <schema>IMS QTI Package</schema>\n` +
    `    <schemaversion>2.1</schemaversion>\n` +
    `  </metadata>\n` +
    `  <organizations/>\n` +
    `  <resources>\n` +
    `    <resource identifier="${testId}" type="imsqti_test_xmlv2p1" href="${testPath}">\n` +
    `      <file href="${testPath}"/>\n` +
    `    </resource>\n` +
    `${resourceXmlList.join("\n")}\n` +
    `  </resources>\n` +
    `</manifest>\n`;

  const zipBytes = buildZipBytes([
    { name: "imsmanifest.xml", data: manifestXml },
    { name: testPath, data: testXml },
    ...itemFiles
  ]);

  return {
    testId,
    title,
    questionCount: questions.length,
    totalPoints,
    manifestXml,
    testXml,
    itemFiles,
    zipBytes
  };
}

/**
 * Converts a Classic Quizzes QTI 1.2 .zip buffer/Uint8Array or raw QTI 1.2 XML string
 * directly into a spec-valid Canvas New Quizzes IMS QTI 2.1 .zip package.
 */
export async function convertQti12To21(inputBytesOrXml, meta = {}) {
  let rawXml = "";
  let inferredTitle = meta.title || "";
  if (typeof inputBytesOrXml === "string") {
    rawXml = inputBytesOrXml;
  } else {
    const bytes = inputBytesOrXml instanceof Uint8Array ? inputBytesOrXml : new Uint8Array(inputBytesOrXml);
    const isPkZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
    if (isPkZip) {
      const extracted = await extractQtiXmlFromZipBytes(bytes);
      rawXml = extracted.combinedXml;
    } else {
      rawXml = new TextDecoder("utf-8").decode(bytes);
    }
  }
  if (!inferredTitle) {
    const m = rawXml.match(/<assessment\b[^>]*\btitle="([^"]+)"/i);
    if (m && m[1]) inferredTitle = unescapeXmlEntities(m[1]).trim();
  }
  const questions = parseQti12XmlQuestions(rawXml);
  if (questions.length === 0) {
    throw new Error("No valid QTI 1.2 <item> questions found in input.");
  }
  const compiled = compileQti21Package(questions, {
    ...meta,
    title: inferredTitle || "Migrated New Quiz"
  });
  return {
    ...compiled,
    questions
  };
}

export function buildSpreadsheetMlWorkbook(sheets) {
  const wsXml = sheets
    .map((sheet) => {
      const safeName = escapeXml(String(sheet.name || "Sheet").slice(0, 31).replace(/[\\/?*\[\]:]/g, "_"));
      const allRows = [sheet.headers || [], ...(sheet.rows || [])];
      const rowsXml = allRows
        .map((row, rIdx) => {
          const cellsXml = row
            .map((cell) => {
              const isHeader = rIdx === 0;
              const styleAttr = isHeader ? ' ss:StyleID="hdr"' : "";
              if (!isHeader && typeof cell === "number" && Number.isFinite(cell)) {
                return `<Cell${styleAttr}><Data ss:Type="Number">${cell}</Data></Cell>`;
              }
              const str = String(cell == null ? "" : cell);
              if (!isHeader && /^-?\d+(\.\d+)?$/.test(str) && !/^0\d+/.test(str)) {
                return `<Cell${styleAttr}><Data ss:Type="Number">${str}</Data></Cell>`;
              }
              return `<Cell${styleAttr}><Data ss:Type="String">${escapeXml(str)}</Data></Cell>`;
            })
            .join("");
          return `      <Row>${cellsXml}</Row>`;
        })
        .join("\n");

      return (
        `  <Worksheet ss:Name="${safeName}">\n` +
        `    <Table>\n${rowsXml}\n    </Table>\n` +
        `  </Worksheet>`
      );
    })
    .join("\n");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<?mso-application progid="Excel.Sheet"?>\n` +
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\n` +
    ` xmlns:o="urn:schemas-microsoft-com:office:office"\n` +
    ` xmlns:x="urn:schemas-microsoft-com:office:excel"\n` +
    ` xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n` +
    `  <Styles>\n` +
    `    <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Bottom"/></Style>\n` +
    `    <Style ss:ID="hdr"><Font ss:Bold="1"/><Interior ss:Color="#EEF2FF" ss:Pattern="Solid"/></Style>\n` +
    `  </Styles>\n` +
    `${wsXml}\n` +
    `</Workbook>\n`
  );
}

function computeNumericStats(values, maxPoints) {
  const nums = values.filter((v) => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  const n = nums.length;
  if (n === 0) {
    return { count: 0, mean: 0, median: 0, stdDev: 0, masteryCount: 0, masteryPct: 0 };
  }
  const sum = nums.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const median = n % 2 === 1 ? nums[(n - 1) / 2] : (nums[n / 2 - 1] + nums[n / 2]) / 2;
  const variance = nums.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / n;
  const stdDev = Math.sqrt(variance);
  const threshold = (maxPoints > 0 ? maxPoints : 1) * 0.8;
  const masteryCount = nums.filter((v) => v >= threshold - 1e-9).length;
  const masteryPct = (masteryCount / n) * 100;
  return {
    count: n,
    mean: Number(mean.toFixed(2)),
    median: Number(median.toFixed(2)),
    stdDev: Number(stdDev.toFixed(2)),
    masteryCount,
    masteryPct: Number(masteryPct.toFixed(1))
  };
}

export function buildRubricAccreditationMatrix(input) {
  let payload = input;
  if (typeof input === "string") {
    const trimmed = stripBom(input).trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      const parsed = JSON.parse(trimmed);
      payload = Array.isArray(parsed) ? { submissions: parsed } : parsed;
    } else {
      const rows = parseDelimitedRows(trimmed);
      if (rows.length < 2) {
        throw new Error("Rubric input requires at least a header row and one student row.");
      }
      const headers = rows[0].map((h) => h.trim());
      const idxStudent = headers.findIndex((h) => /^(student|student[\s_]*name|name|learner)$/i.test(h) || /student[\s_]*name/i.test(h));
      const fallbackStudent = idxStudent >= 0 ? idxStudent : headers.findIndex((h) => /student|name/i.test(h) && !/section|assignment|sis|login/i.test(h));
      const idxSis = headers.findIndex((h) => /\b(sis[\s_]*user[\s_]*id|sis[\s_]*login[\s_]*id|sis[\s_]*id|login[\s_]*id|student[\s_]*id|email)\b/i.test(h));
      const idxSection = headers.findIndex((h) => /\bsection\b/i.test(h));

      const reserved = new Set([fallbackStudent, idxSis, idxSection].filter((i) => i >= 0));
      const ratingColByPrefix = new Map();
      const commentColByPrefix = new Map();
      headers.forEach((h, cIdx) => {
        if (reserved.has(cIdx)) return;
        if (/^(student|student[\s_]*name|name|id|student[\s_]*id|sis[\s_]*user[\s_]*id|sis[\s_]*login[\s_]*id|sis[\s_]*id|login[\s_]*id|email|section|section[\s_]*name|section[\s_]*id|assignment|course|total|total[\s_]*points|total[\s_]*score|score|final[\s_]*score|points[\s_]*possible|percentage|submitted|submitted[\s_]*at|status|workflow[\s_]*state)$/i.test(h)) {
          reserved.add(cIdx);
          return;
        }
        const ratingMatch = h.match(/^(.+?)\s*(?:\[rating\]|-\s*rating|\brating)$/i);
        if (ratingMatch) {
          reserved.add(cIdx);
          ratingColByPrefix.set(ratingMatch[1].trim().toLowerCase(), cIdx);
          return;
        }
        const commentMatch = h.match(/^(.+?)\s*(?:\[comments?\]|-\s*comments?|\bcomments?)$/i);
        if (commentMatch) {
          reserved.add(cIdx);
          commentColByPrefix.set(commentMatch[1].trim().toLowerCase(), cIdx);
        }
      });

      const criteria = [];
      headers.forEach((h, cIdx) => {
        if (reserved.has(cIdx)) return;
        const maxMatch = h.match(/(?:\(|\[|\s\/\s*)(\d+(?:\.\d+)?)\s*(?:pts?|points?)?[\)\]]?\s*$/i);
        const cleanDesc = h
          .replace(/\s*\[points\s*\/\s*\d+(?:\.\d+)?\]\s*$/i, "")
          .replace(/\s*\(\d+(?:\.\d+)?\s*(?:pts?|points?)?\)\s*$/i, "")
          .trim() || ("Criterion " + (criteria.length + 1));
        const keyLower = cleanDesc.toLowerCase();
        criteria.push({
          id: "crit_" + (criteria.length + 1),
          description: cleanDesc,
          points: maxMatch ? parseFloat(maxMatch[1]) : 5,
          colIdx: cIdx,
          ratingColIdx: ratingColByPrefix.has(keyLower) ? ratingColByPrefix.get(keyLower) : -1,
          commentColIdx: commentColByPrefix.has(keyLower) ? commentColByPrefix.get(keyLower) : -1
        });
      });

      const submissions = [];
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const studentName = fallbackStudent >= 0 ? row[fallbackStudent] : "Student " + r;
        if (!String(studentName || "").trim()) continue;
        if (/^points\s+possible$/i.test(String(studentName).trim())) continue;
        const rubric_assessment = {};
        let total = 0;
        for (const c of criteria) {
          const val = parseFloat(row[c.colIdx]);
          if (!isNaN(val)) {
            const ratingTxt = c.ratingColIdx >= 0 ? String(row[c.ratingColIdx] || "").trim() : "";
            const commentTxt = c.commentColIdx >= 0 ? String(row[c.commentColIdx] || "").trim() : "";
            rubric_assessment[c.id] = {
              points: val,
              rating_id: ratingTxt || undefined,
              comments: commentTxt
            };
            if (ratingTxt) {
              c.ratings = c.ratings || [];
              if (!c.ratings.some((rt) => rt.id === ratingTxt)) {
                c.ratings.push({ id: ratingTxt, description: ratingTxt, points: val });
              }
            }
            total += val;
          }
        }
        submissions.push({
          user_id: "u_" + r,
          user: {
            name: studentName.trim(),
            sis_user_id: idxSis >= 0 ? String(row[idxSis] || "").trim() : "",
            section: idxSection >= 0 ? String(row[idxSection] || "Default Section").trim() : "Default Section"
          },
          workflow_state: "graded",
          score: total,
          rubric_assessment
        });
      }
      payload = {
        assignmentTitle: "Imported Rubric Assessment",
        criteria,
        submissions
      };
    }
  }

  const assignmentTitle = String(
    payload.assignmentTitle ||
      (payload.assignment && payload.assignment.name) ||
      "Course Rubric Assessment"
  );

  let rawCriteria =
    payload.criteria ||
    (payload.assignment && payload.assignment.rubric) ||
    (payload.rubric && payload.rubric.data) ||
    payload.rubric ||
    [];

  const submissions = Array.isArray(payload.submissions) ? payload.submissions : [];
  const usersById = payload.usersById || {};

  if (!Array.isArray(rawCriteria) || rawCriteria.length === 0) {
    const seenIds = new Map();
    for (const sub of submissions) {
      const ra = sub.rubric_assessment || {};
      for (const [cid, entry] of Object.entries(ra)) {
        const pts = typeof entry.points === "number" ? entry.points : 0;
        if (!seenIds.has(cid) || pts > seenIds.get(cid)) {
          seenIds.set(cid, pts);
        }
      }
    }
    rawCriteria = Array.from(seenIds.entries()).map(([cid, maxSeen], idx) => ({
      id: cid,
      description: "Criterion " + (idx + 1) + " (" + cid + ")",
      points: maxSeen > 0 ? maxSeen : 5,
      ratings: []
    }));
  }

  const criteria = rawCriteria.map((c, idx) => {
    const ratingsById = {};
    if (Array.isArray(c.ratings)) {
      for (const rt of c.ratings) {
        if (rt && rt.id) ratingsById[rt.id] = rt.description || "";
      }
    }
    return {
      id: String(c.id || "crit_" + (idx + 1)),
      description: String(c.description || c.long_description || "Criterion " + (idx + 1)).trim(),
      outcomeId: String(c.learning_outcome_id || c.outcome_id || ""),
      points: Number(c.points || 0),
      ratings: Array.isArray(c.ratings) ? c.ratings : [],
      ratingsById
    };
  });

  const maxPossibleFromRubric = criteria.reduce((a, c) => a + (c.points || 0), 0);
  const maxPoints = Number(
    payload.pointsPossible ||
      (payload.assignment && payload.assignment.points_possible) ||
      maxPossibleFromRubric ||
      100
  );

  const matrixHeaders = [
    "Assignment",
    "Student Name",
    "SIS / Login ID",
    "Section",
    "Workflow Status",
    "Submitted At",
    "Total Score",
    "Points Possible",
    "Percentage"
  ];
  for (const c of criteria) {
    matrixHeaders.push(`${c.description} [Points / ${c.points}]`);
    matrixHeaders.push(`${c.description} [Rating]`);
    matrixHeaders.push(`${c.description} [Comments]`);
  }

  const matrixRows = [];
  const perCriterionScores = new Map();
  const perCriterionBySection = new Map();
  const sectionsSet = new Set();

  for (const c of criteria) {
    perCriterionScores.set(c.id, []);
    perCriterionBySection.set(c.id, new Map());
  }

  for (let i = 0; i < submissions.length; i++) {
    const sub = submissions[i];
    const userObj = sub.user || usersById[sub.user_id] || {};
    const studentName = String(
      userObj.sortable_name || userObj.name || sub.student_name || ("Student " + (sub.user_id || i + 1))
    ).trim();
    const sisId = String(userObj.sis_user_id || userObj.login_id || sub.sis_user_id || "").trim();
    const sectionName = String(
      sub.section_name || userObj.section || (payload.sectionsByUserId && payload.sectionsByUserId[sub.user_id]) || "All Sections"
    ).trim();
    sectionsSet.add(sectionName);

    const ra = sub.rubric_assessment || {};
    let computedRubricSum = 0;
    let hasAnyRubricScore = false;

    const criterionCells = [];
    for (const c of criteria) {
      const entry = ra[c.id] || {};
      const hasPts = entry.points !== undefined && entry.points !== null && entry.points !== "" && !isNaN(Number(entry.points));
      const pts = hasPts ? Number(entry.points) : "";
      let ratingLabel = "";
      if (entry.rating_id && c.ratingsById[entry.rating_id]) {
        ratingLabel = c.ratingsById[entry.rating_id];
      } else if (hasPts && c.ratings.length > 0) {
        const exactRating = c.ratings.find((r) => Number(r.points) === pts);
        if (exactRating) ratingLabel = exactRating.description || "";
      }
      const comments = String(entry.comments || "").replace(/\r?\n/g, " ").trim();

      if (hasPts) {
        computedRubricSum += pts;
        hasAnyRubricScore = true;
        perCriterionScores.get(c.id).push(pts);
        const secMap = perCriterionBySection.get(c.id);
        if (!secMap.has(sectionName)) secMap.set(sectionName, []);
        secMap.get(sectionName).push(pts);
      }

      criterionCells.push(pts, ratingLabel, comments);
    }

    const totalScore =
      sub.score !== undefined && sub.score !== null && sub.score !== "" && !isNaN(Number(sub.score))
        ? Number(sub.score)
        : hasAnyRubricScore
        ? Number(computedRubricSum.toFixed(2))
        : "";

    const pct =
      typeof totalScore === "number" && maxPoints > 0
        ? Number(((totalScore / maxPoints) * 100).toFixed(1))
        : "";

    matrixRows.push([
      assignmentTitle,
      studentName,
      sisId,
      sectionName,
      String(sub.workflow_state || "submitted"),
      String(sub.submitted_at || ""),
      totalScore,
      maxPoints,
      pct,
      ...criterionCells
    ]);
  }

  const orderedSections = Array.from(sectionsSet).sort();
  const summaryHeaders = [
    "Criterion ID",
    "Criterion Description",
    "Learning Outcome ID",
    "Max Points",
    "Students Graded (N)",
    "Mean Points",
    "Mean %",
    "Median Points",
    "Std Dev",
    "Mastery Count (>=80%)",
    "Mastery Rate %",
    ...orderedSections.map((sec) => `Section Avg: ${sec}`)
  ];

  const summaryRows = criteria.map((c) => {
    const vals = perCriterionScores.get(c.id) || [];
    const st = computeNumericStats(vals, c.points);
    const meanPct = c.points > 0 && st.count > 0 ? Number(((st.mean / c.points) * 100).toFixed(1)) : 0;
    const secAverages = orderedSections.map((sec) => {
      const secVals = perCriterionBySection.get(c.id).get(sec) || [];
      if (secVals.length === 0) return "";
      const avg = secVals.reduce((a, b) => a + b, 0) / secVals.length;
      return Number(avg.toFixed(2));
    });
    return [
      c.id,
      c.description,
      c.outcomeId,
      c.points,
      st.count,
      st.mean,
      meanPct,
      st.median,
      st.stdDev,
      st.masteryCount,
      st.masteryPct,
      ...secAverages
    ];
  });

  const csvLines = [
    serializeCsvRow(matrixHeaders, ","),
    ...matrixRows.map((r) => serializeCsvRow(r, ","))
  ];
  const matrixCsv = "\ufeff" + csvLines.join("\r\n");

  const summaryCsvLines = [
    serializeCsvRow(summaryHeaders, ","),
    ...summaryRows.map((r) => serializeCsvRow(r, ","))
  ];
  const summaryCsv = "\ufeff" + summaryCsvLines.join("\r\n");

  const workbookXml = buildSpreadsheetMlWorkbook([
    { name: "Student_Criterion_Matrix", headers: matrixHeaders, rows: matrixRows },
    { name: "Accreditation_Summary", headers: summaryHeaders, rows: summaryRows }
  ]);

  return {
    assignmentTitle,
    maxPoints,
    studentCount: matrixRows.length,
    criterionCount: criteria.length,
    sections: orderedSections,
    matrixHeaders,
    matrixRows,
    summaryHeaders,
    summaryRows,
    matrixCsv,
    summaryCsv,
    workbookXml
  };
}

export function buildPrintableQuizHtml(questions, options = {}) {
  const title = escapeXml(options.title || "Printable Assessment");
  const includeKey = options.includeAnswerKey !== false;

  const itemsHtml = questions
    .map((q, i) => {
      const choicesHtml = (q.choices || [])
        .map((c, cIdx) => {
          const letter = c.letter || String.fromCharCode(65 + cIdx);
          const mark = includeKey && c.correct ? ' style="font-weight:700;color:#065f46;"' : "";
          const badge = includeKey && c.correct ? " [Correct]" : "";
          return `<li${mark}><strong>${letter}.</strong> ${escapeXml(c.text)}${badge}</li>`;
        })
        .join("");
      const saHtml =
        includeKey && q.acceptedAnswers && q.acceptedAnswers.length > 0
          ? `<div style="margin-top:6px;font-size:13px;color:#065f46;"><strong>Accepted Key:</strong> ${escapeXml(
              q.acceptedAnswers.join(" | ")
            )}</div>`
          : q.choices && q.choices.length === 0
          ? `<div style="margin-top:14px;border-bottom:1px solid #cbd5e1;height:28px;"></div>`
          : "";

      return (
        `<div style="margin-bottom:18px;page-break-inside:avoid;">` +
        `<div style="font-weight:600;margin-bottom:6px;">${i + 1}. ${escapeXml(q.prompt)} <span style="color:#64748b;font-weight:400;">(${q.points || 1} pts)</span></div>` +
        (choicesHtml ? `<ul style="list-style:none;padding-left:14px;margin:4px 0;">${choicesHtml}</ul>` : "") +
        saHtml +
        `</div>`
      );
    })
    .join("\n");

  return (
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${title}</title>` +
    `<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:780px;margin:32px auto;color:#0f172a;line-height:1.5;}h1{font-size:22px;border-bottom:2px solid #0f172a;padding-bottom:8px;}@media print{button{display:none;}}</style>` +
    `</head><body><button onclick="window.print()" style="float:right;padding:8px 14px;cursor:pointer;">Print / Save PDF</button>` +
    `<h1>${title}${includeKey ? " (Instructor Answer Key)" : ""}</h1>${itemsHtml}</body></html>`
  );
}
