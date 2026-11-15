/**
 * FERPA 100%-Local Gradebook Roster Fuzzy Matcher
 * Matches PowerSchool / Infinite Campus / Skyward rosters ("Last, First M.") against
 * Google Classroom / Kahoot / Quizizz / Canvas score exports ("Nickname Last") offline.
 * Zero network calls, zero external dependencies.
 * Browser GUI: https://tools.stillhumanacademy.com/powerschool-google-classroom-roster-matcher
 */

const NICKNAME_CANONICAL = {
  will: "william", liam: "william", bill: "william", billy: "william",
  liz: "elizabeth", beth: "elizabeth", ellie: "elizabeth", eliza: "elizabeth", betty: "elizabeth",
  kate: "katherine", katie: "katherine", kathy: "katherine", catherine: "katherine", catie: "katherine",
  rob: "robert", bob: "robert", bobby: "robert", robby: "robert",
  alex: "alexander", xander: "alexander", lex: "alexander", sasha: "alexander",
  ben: "benjamin", benji: "benjamin",
  chris: "christopher", topher: "christopher",
  matt: "matthew", matty: "matthew",
  josh: "joshua",
  nick: "nicholas", nico: "nicholas",
  abby: "abigail", gail: "abigail",
  maddie: "madison", maddy: "madison",
  sam: "samuel", sammy: "samuel",
  dan: "daniel", danny: "daniel",
  joe: "joseph", joey: "joseph",
  mike: "michael", mikey: "michael",
  tony: "anthony",
  gabby: "gabriella", gabi: "gabriella",
  dave: "david", davey: "david",
  jim: "james", jimmy: "james", jamie: "james",
  tom: "thomas", tommy: "thomas",
  jen: "jennifer", jenny: "jennifer",
  meg: "megan", meghan: "megan",
  steph: "stephanie",
  nate: "nathaniel", nathan: "nathaniel",
  zack: "zachary", zach: "zachary",
  jake: "jacob",
  charlie: "charles", chuck: "charles",
  ted: "theodore", theo: "theodore", teddy: "theodore",
  leo: "leonardo",
  max: "maxwell",
  liv: "olivia",
  bella: "isabella", izzy: "isabella",
  sophie: "sophia",
  vicky: "victoria", tori: "victoria"
};

function detectBestDelimiter(text) {
  const sampleLines = text.split(/\r?\n/).filter((l) => l.trim() !== "").slice(0, 8);
  if (sampleLines.length === 0) return ",";
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestScore = -1;

  for (const c of candidates) {
    const counts = sampleLines.map((ln) => {
      let inQ = false;
      let n = 0;
      for (let i = 0; i < ln.length; i++) {
        if (ln[i] === '"') inQ = !inQ;
        else if (!inQ && ln[i] === c) n++;
      }
      return n;
    });
    const minC = Math.min(...counts);
    const maxC = Math.max(...counts);
    const sumC = counts.reduce((a, b) => a + b, 0);
    if (sumC === 0) continue;
    const consistencyBonus = minC === maxC && minC > 0 ? 1000 : 0;
    const score = consistencyBonus + sumC;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

function parseTableOrCsv(rawInput, sourceDelimiter) {
  let clean = String(rawInput == null ? "" : rawInput);
  if (clean.charCodeAt(0) === 0xfeff) clean = clean.slice(1);
  clean = clean.replace(/^sep=[,;|\t]\r?\n/i, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const delim = sourceDelimiter && sourceDelimiter !== "auto" ? sourceDelimiter : detectBestDelimiter(clean);
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === delim) {
        row.push(field);
        field = "";
      } else if (ch === "\n") {
        row.push(field);
        if (row.some((c) => c.trim() !== "")) rows.push(row);
        row = [];
        field = "";
      } else {
        field += ch;
      }
    }
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);

  return {
    detectedDelimiter: delim,
    headers: rows[0] || [],
    rows: rows.slice(1)
  };
}

export function parseStudentNameParts(rawName, customAliases = {}) {
  const aliasMap = Object.assign({}, NICKNAME_CANONICAL, customAliases || {});
  const s = String(rawName || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv)\.?$/i, "")
    .replace(/[^a-z,\-\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const parenMatch = String(rawName || "").match(/\(([^)]+)\)/);
  const parenNick = parenMatch ? parenMatch[1].toLowerCase().replace(/[^a-z]/g, "") : "";

  let first = "";
  let last = "";

  if (s.includes(",")) {
    const [lastPart, restPart] = s.split(",", 2).map((p) => p.trim());
    last = lastPart;
    const firstTokens = (restPart || "").split(" ").filter(Boolean);
    first = firstTokens[0] || "";
  } else {
    const tokens = s.split(" ").filter(Boolean);
    if (tokens.length === 1) {
      first = tokens[0];
    } else if (tokens.length >= 2) {
      first = tokens[0];
      last = tokens[tokens.length - 1];
    }
  }

  const canonFirst = aliasMap[first] || first;
  const canonParen = parenNick ? aliasMap[parenNick] || parenNick : "";
  return {
    raw: String(rawName || "").trim(),
    first,
    canonFirst,
    canonParen,
    last,
    fullKey: `${canonFirst} ${last}`.trim()
  };
}

export function jaroWinkler(s1, s2) {
  if (s1 === s2) return 1.0;
  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0.0;

  const matchDist = Math.max(0, Math.floor(Math.max(len1, len2) / 2) - 1);
  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);

  let matches = 0;
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDist);
    const end = Math.min(i + matchDist + 1, len2);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0.0;

  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  const jaro = (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, len1, len2); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

export function matchGradebookRosters(targetRosterCsv, sourceScoresCsv, options = {}) {
  const sourceMaxPoints = Number(options.sourceMaxPoints) > 0 ? Number(options.sourceMaxPoints) : null;
  const targetMaxPoints = Number(options.targetMaxPoints) > 0 ? Number(options.targetMaxPoints) : null;
  const customAliases = options.customAliases || {};

  const targetParsed = parseTableOrCsv(targetRosterCsv);
  const sourceParsed = parseTableOrCsv(sourceScoresCsv);

  const tHeaders = targetParsed.headers;
  const sHeaders = sourceParsed.headers;

  const normHeader = (h) => String(h || "").replace(/[_\-]+/g, " ").trim();

  const findCol = (headers, regex, fallback) => {
    const idx = headers.findIndex((h) => regex.test(normHeader(h)));
    return idx >= 0 ? idx : fallback;
  };

  const findNameCol = (headers, fallback) => {
    const exactName = headers.findIndex(
      (h) =>
        !/\b(id|sis|email|login|code|number)\b/i.test(normHeader(h)) &&
        /\b(name|student|player|participant|learner)\b/i.test(normHeader(h))
    );
    return exactName >= 0 ? exactName : fallback;
  };

  const tFirstIdx = tHeaders.findIndex((h) => /^first\s*name$/i.test(normHeader(h)));
  const tLastIdx = tHeaders.findIndex((h) => /^last\s*name$/i.test(normHeader(h)));
  const tNameIdx = findNameCol(tHeaders, 0);
  const tIdIdx = tHeaders.findIndex((h) => /\b(sis|student\s*id|student\s*number|id|email|login)\b/i.test(normHeader(h)));

  const sFirstIdx = sHeaders.findIndex((h) => /^first\s*name$/i.test(normHeader(h)));
  const sLastIdx = sHeaders.findIndex((h) => /^last\s*name$/i.test(normHeader(h)));
  const sNameIdx = findNameCol(sHeaders, 0);
  const sIdIdx = sHeaders.findIndex((h) => /\b(sis|student\s*id|student\s*number|id|email|login)\b/i.test(normHeader(h)));
  const sScoreIdx =
    options.sourceScoreColumnIndex != null
      ? options.sourceScoreColumnIndex
      : findCol(sHeaders, /score|points|grade|total|correct|percent|%/i, sHeaders.length - 1);

  const sourceEntries = sourceParsed.rows.map((r, idx) => {
    const rawName =
      sFirstIdx >= 0 && sLastIdx >= 0
        ? `${r[sFirstIdx] || ""} ${r[sLastIdx] || ""}`.trim()
        : String(r[sNameIdx] || "").trim();
    const rawId = sIdIdx >= 0 ? String(r[sIdIdx] || "").trim().toLowerCase() : "";
    const rawScoreStr = String(r[sScoreIdx] == null ? "" : r[sScoreIdx]).trim();

    let numericScore = null;
    let inferredOutOf = sourceMaxPoints;
    const fracMatch = rawScoreStr.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
    if (fracMatch) {
      numericScore = parseFloat(fracMatch[1]);
      if (!inferredOutOf) inferredOutOf = parseFloat(fracMatch[2]);
    } else {
      const cleanNum = rawScoreStr.replace(/%/g, "").trim();
      if (cleanNum !== "" && !isNaN(parseFloat(cleanNum))) {
        numericScore = parseFloat(cleanNum);
      }
    }

    let finalScore = numericScore;
    if (numericScore !== null && inferredOutOf && targetMaxPoints) {
      finalScore = Number(((numericScore / inferredOutOf) * targetMaxPoints).toFixed(2));
    }

    return {
      idx,
      used: false,
      rawName,
      rawId,
      rawScoreStr,
      finalScore: finalScore !== null ? finalScore : rawScoreStr,
      parts: parseStudentNameParts(rawName, customAliases)
    };
  });

  const outColName = options.assignmentName || sHeaders[sScoreIdx] || "Imported_Score";
  const outputHeaders = [...tHeaders, outColName, "Match_Method", "Match_Confidence"];
  const outputRows = [];
  const matchReport = [];
  let matchedCount = 0;

  for (const tRow of targetParsed.rows) {
    const tRawName =
      tFirstIdx >= 0 && tLastIdx >= 0
        ? `${tRow[tFirstIdx] || ""} ${tRow[tLastIdx] || ""}`.trim()
        : String(tRow[tNameIdx] || "").trim();
    const tRawId = tIdIdx >= 0 ? String(tRow[tIdIdx] || "").trim().toLowerCase() : "";
    const tParts = parseStudentNameParts(tRawName, customAliases);

    let bestCand = null;
    let bestScore = 0;
    let bestMethod = "unmatched";

    for (const s of sourceEntries) {
      if (s.used) continue;

      if (tRawId && s.rawId && (tRawId === s.rawId || tRawId.split("@")[0] === s.rawId.split("@")[0])) {
        bestCand = s;
        bestScore = 1.0;
        bestMethod = "exact_student_id";
        break;
      }

      if (
        tParts.last &&
        s.parts.last &&
        tParts.last.replace(/'/g, "") === s.parts.last.replace(/'/g, "")
      ) {
        if (
          tParts.canonFirst === s.parts.canonFirst ||
          (tParts.canonParen && tParts.canonParen === s.parts.canonFirst) ||
          (s.parts.canonParen && s.parts.canonParen === tParts.canonFirst)
        ) {
          if (0.98 > bestScore) {
            bestCand = s;
            bestScore = 0.98;
            bestMethod =
              tParts.first === s.parts.first
                ? "normalized_middle_initial_strip"
                : "nickname_dictionary_match";
          }
          continue;
        }
      }

      const sim = jaroWinkler(tParts.fullKey, s.parts.fullKey);
      if (sim >= 0.87 && sim > bestScore) {
        bestCand = s;
        bestScore = Number(sim.toFixed(3));
        bestMethod = "fuzzy_jaro_winkler";
      }
    }

    if (bestCand) {
      bestCand.used = true;
      matchedCount++;
      outputRows.push([...tRow, bestCand.finalScore, bestMethod, bestScore]);
      matchReport.push({
        targetStudent: tRawName,
        matchedSourceStudent: bestCand.rawName,
        rawScore: bestCand.rawScoreStr,
        exportedScore: bestCand.finalScore,
        method: bestMethod,
        confidence: bestScore
      });
    } else {
      outputRows.push([...tRow, "", "unmatched", 0]);
      matchReport.push({
        targetStudent: tRawName,
        matchedSourceStudent: "",
        rawScore: "",
        exportedScore: "",
        method: "unmatched",
        confidence: 0
      });
    }
  }

  const escCsv = (row) =>
    row
      .map((c) => {
        const s = String(c == null ? "" : c);
        return s.includes(",") || s.includes('"') || s.includes("\n") ? '"' + s.replace(/"/g, '""') + '"' : s;
      })
      .join(",");

  const cleanGradebookHeaders = [...tHeaders, outColName];
  const cleanGradebookRows = outputRows.map((r) => r.slice(0, cleanGradebookHeaders.length));
  const csvLines = [cleanGradebookHeaders, ...cleanGradebookRows].map(escCsv);
  const auditCsvLines = [outputHeaders, ...outputRows].map(escCsv);

  return {
    totalTargetStudents: targetParsed.rows.length,
    matchedCount,
    unmatchedCount: targetParsed.rows.length - matchedCount,
    headers: cleanGradebookHeaders,
    rows: cleanGradebookRows,
    auditHeaders: outputHeaders,
    auditRows: outputRows,
    matchReport,
    csvOutput: "\ufeff" + csvLines.join("\r\n"),
    auditCsvOutput: "\ufeff" + auditCsvLines.join("\r\n")
  };
}
