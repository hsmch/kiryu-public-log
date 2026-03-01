import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  existsSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { votingSchema } from "./schemas";

const USER_AGENT = "KiryuPublicLog/1.0 (+https://kiryu.co)";
const SESSIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../data/sessions",
);
const OUTPUT_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../data/voting",
);

interface VoteRecord {
  billNumber: string;
  billTitle: string;
  result: string;
  votes: {
    memberName: string;
    vote: "賛成" | "反対" | "欠席" | "議長" | "退席";
  }[];
}

interface VotingData {
  session: string;
  sessionSlug: string;
  sourceUrl: string;
  scrapedAt: string;
  records: VoteRecord[];
}

function log(msg: string) {
  console.log(`[scrape-voting] ${msg}`);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchPdf(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for PDF ${url}`);
  }
  const arrayBuf = await response.arrayBuffer();
  return Buffer.from(arrayBuf);
}

function normalizeVote(
  s: string,
): "賛成" | "反対" | "欠席" | "議長" | "退席" | null {
  const t = s.trim();
  if (t === "○" || t === "〇" || t === "賛成") return "賛成";
  if (t === "×" || t === "✕" || t === "反対") return "反対";
  if (t === "欠" || t === "欠席") return "欠席";
  if (t.includes("議長")) return "議長";
  if (t === "△" || t === "退" || t === "退席") return "退席";
  return null;
}

function toHalf(s: string): string {
  return s.replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  );
}

/**
 * Check if a character is a CJK ideograph.
 */
function isCJK(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (
    (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
    (code >= 0x3400 && code <= 0x4dbf) // CJK Extension A
  );
}

/**
 * Check if a raw (untrimmed) line is a single CJK character or U+3000 space.
 * Note: JavaScript's .trim() removes U+3000 (ideographic space), so we
 * must check the raw line content.
 */
function getSingleVerticalChar(rawLine: string): string | null {
  // Strip only ASCII whitespace, NOT U+3000
  const stripped = rawLine.replace(/[ \t\r\n]/g, "");
  if (stripped.length !== 1) return null;
  if (isCJK(stripped) || stripped === "\u3000") return stripped;
  return null;
}

/**
 * Check if a raw line is a single hiragana character.
 */
function isHiragana(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= 0x3040 && code <= 0x309f;
}

/**
 * Extract the raw character sequence from the vertical name block in the PDF text.
 * Returns the cleaned string of CJK + U+3000 characters.
 */
function extractNameCharSequence(text: string): string {
  const lines = text.split("\n");

  // Find the first "議員氏名" or "○：賛成" marker
  let nameRegionStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("議員氏名")) {
      nameRegionStart = i;
      break;
    }
  }
  if (nameRegionStart === -1) {
    for (let i = 0; i < lines.length; i++) {
      if (
        lines[i].includes("○：賛成") ||
        lines[i].includes("○:賛成") ||
        lines[i].includes("〇：賛成")
      ) {
        nameRegionStart = i;
        break;
      }
    }
  }
  if (nameRegionStart === -1) return "";

  // Collect single-char vertical lines (CJK, U+3000, hiragana)
  // from the first name block (stop before second "議員氏名")
  const searchStart = Math.max(0, nameRegionStart - 5);
  const searchEnd = Math.min(lines.length, nameRegionStart + 250);

  const allChars: string[] = [];
  let foundFirstCJK = false;

  for (let i = searchStart; i < searchEnd; i++) {
    const stripped = lines[i].replace(/[ \t\r\n]/g, "");

    // Stop at second occurrence of "議員氏名"
    if (i > nameRegionStart && lines[i].includes("議員氏名")) break;

    if (stripped.length !== 1) continue;

    const ch = stripped;
    if (isCJK(ch) || ch === "\u3000" || isHiragana(ch)) {
      if (isCJK(ch)) foundFirstCJK = true;
      if (foundFirstCJK) allChars.push(ch);
    }
  }

  let charStr = allChars.join("");

  // Remove known non-name vertical text patterns
  charStr = charStr.replace(/議長のため採決に加わらず/g, "");
  charStr = charStr.replace(/市長提出/g, "");
  charStr = charStr.replace(/市　長　提　出/g, "");
  charStr = charStr.replace(/議員提出/g, "");
  charStr = charStr.replace(/委員会提出/g, "");
  // Remove all hiragana (from speaker marker remnants)
  charStr = charStr.replace(/[ぁ-ん]/g, "");
  // Remove leftover CJK chars from partial speaker marker: 議長, 採決, 加
  // These appear when the marker is partially matched
  // But be careful -- 議 and 長 could be part of names (unlikely but possible)
  // Instead of removing individual chars, remove known residual patterns
  charStr = charStr.replace(/議長$/g, "");
  charStr = charStr.replace(/^議長/g, "");
  // Remove "議採決加" residual (from incomplete speaker marker removal)
  charStr = charStr.replace(/議採決加/g, "");
  // Remove "提出" at start (from "市長提出" where 市長 was on multi-char lines)
  charStr = charStr.replace(/^提\u3000出/, "");
  charStr = charStr.replace(/^提出/, "");

  return charStr;
}

/**
 * Known family names in Kiryu city council across all periods.
 * Grouped by character count for split disambiguation.
 * 1-char and 3-char family names are explicitly tracked since the default
 * heuristic assumes 2-char family names.
 */
const KNOWN_1CHAR_FAMILIES = new Set(["辻"]);
const KNOWN_3CHAR_FAMILIES = new Set(["久保田", "河原井", "山之内"]);
const KNOWN_2CHAR_FAMILIES = new Set([
  "飯島", "歌代", "渡辺", "関口", "小島", "園田", "北川", "工藤",
  "丹羽", "人見", "近藤", "新井", "岡部", "福島", "佐藤", "周藤",
  "小滝", "伏木", "森山", "周東", "田島", "石渡",
]);

/**
 * Split a sequence of CJK + U+3000 chars into individual names.
 *
 * The char sequence has the pattern:
 *   family1 [U+3000] given1 family2 [U+3000] given2 family3 [U+3000] ... givenN
 *
 * Some names may be missing their U+3000 separator (PDF rendering artifact for
 * long names in narrow columns). We handle this by checking for known 3-char
 * family names when a segment is unexpectedly long.
 */
function splitNamesFromSequence(charStr: string): string[] {
  // First, handle missing U+3000 separators by inserting them for known patterns
  // For names like 久保田裕一 where the U+3000 between family and given is missing,
  // insert it: 久保田[U+3000]裕一
  let fixed = charStr;
  for (const family of KNOWN_3CHAR_FAMILIES) {
    const pattern = new RegExp(family + "(?!\u3000)", "g");
    fixed = fixed.replace(pattern, family + "\u3000");
  }

  // Split by U+3000 (collapsing consecutive spaces)
  const rawSegments: string[] = [];
  let currentSeg = "";

  for (const ch of fixed) {
    if (ch === "\u3000") {
      if (currentSeg.length > 0) {
        rawSegments.push(currentSeg);
        currentSeg = "";
      }
    } else {
      currentSeg += ch;
    }
  }
  if (currentSeg.length > 0) {
    rawSegments.push(currentSeg);
  }

  if (rawSegments.length < 2) return [];

  // Parse names from segments
  // Pattern: [family1, given1+family2, given2+family3, ..., givenN]
  const names: string[] = [];
  let prevFamily = rawSegments[0];

  for (let i = 1; i < rawSegments.length; i++) {
    const seg = rawSegments[i];

    if (i === rawSegments.length - 1) {
      // Last segment is pure given name
      if (prevFamily && seg) {
        names.push(prevFamily + "\u3000" + seg);
      }
      break;
    }

    // Middle segment: split into given_prev + family_next
    // Determine the family name length by checking known family names
    let familyLen = -1;

    // Check for known 3-char family names at the end
    if (familyLen === -1) {
      for (const family of KNOWN_3CHAR_FAMILIES) {
        if (seg.endsWith(family) && seg.length > family.length) {
          familyLen = 3;
          break;
        }
      }
    }

    // Check for known 1-char family names at the end
    if (familyLen === -1) {
      for (const family of KNOWN_1CHAR_FAMILIES) {
        if (seg.endsWith(family) && seg.length > family.length) {
          familyLen = 1;
          break;
        }
      }
    }

    // Check for known 2-char family names at the end
    if (familyLen === -1 && seg.length >= 3) {
      const last2 = seg.slice(-2);
      if (KNOWN_2CHAR_FAMILIES.has(last2)) {
        familyLen = 2;
      }
    }

    // Default to family=2 if no known match
    if (familyLen === -1) {
      familyLen = 2;
    }

    // Validate the split produces valid given name length (1-4 chars)
    const gLen = seg.length - familyLen;
    if (gLen < 1 || gLen > 4) {
      // Try alternative splits
      const altLens = [2, 1, 3];
      for (const fLen of altLens) {
        const g = seg.length - fLen;
        if (g >= 1 && g <= 4 && fLen >= 1 && fLen <= 4) {
          familyLen = fLen;
          break;
        }
      }
    }

    const given = seg.slice(0, seg.length - familyLen);
    const family = seg.slice(seg.length - familyLen);

    if (prevFamily && given) {
      names.push(prevFamily + "\u3000" + given);
    }
    prevFamily = family;
  }

  return names;
}

/**
 * Extract member names from vertical text blocks in PDF.
 */
function extractMemberNames(text: string): string[] {
  const charStr = extractNameCharSequence(text);
  if (!charStr) return [];

  const names = splitNamesFromSequence(charStr);

  // Deduplicate (names may appear twice due to multi-page PDF)
  const seen = new Set<string>();
  const uniqueNames: string[] = [];
  for (const name of names) {
    if (!seen.has(name)) {
      seen.add(name);
      uniqueNames.push(name);
    }
  }

  return uniqueNames;
}

/**
 * Find the speaker (議長) name from the text.
 * Look for "議長のため採決に加わらず" pattern.
 */
function findSpeakerName(
  memberNames: string[],
  text: string,
): string | null {
  // The speaker position is indicated by "議長のため採決に加わらず"
  // appearing in the vertical text near one of the name blocks.
  // Since the text is extracted vertically, it appears as individual chars.
  // However, we can't easily determine which name it's associated with from the text alone.
  // Instead, we detect the speaker from the vote data: the speaker is the member
  // whose column position has no vote symbol (they don't vote).
  return null; // We'll detect from vote data instead
}

/**
 * Extract vote symbols from a text area.
 * Handles both compact format (○○×○○) and spaced format (〇 〇 × 〇 〇).
 */
function extractVoteSymbols(
  text: string,
): ("賛成" | "反対" | "欠席" | "退席")[] {
  const symbols: ("賛成" | "反対" | "欠席" | "退席")[] = [];
  const pattern = /[○×〇✕△]|欠/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const v = normalizeVote(match[0]);
    if (v && v !== "議長") {
      symbols.push(v as "賛成" | "反対" | "欠席" | "退席");
    }
  }
  return symbols;
}

/**
 * Determine the result string from the text following vote symbols.
 */
function extractResult(text: string): string {
  // Common result patterns
  const resultPatterns = [
    "原案可決",
    "修正可決",
    "原案否決",
    "同意",
    "同　　意",
    "同　意",
    "採択",
    "不採択",
    "異議ない旨回答",
    "異議ない旨\n回答",
  ];
  for (const p of resultPatterns) {
    if (text.includes(p)) {
      if (p.includes("同") && p.includes("意")) return "同意";
      if (p.includes("異議ない旨")) return "異議ない旨回答することに決定";
      return p;
    }
  }
  return "";
}

/**
 * Parse the PDF text to extract voting records.
 *
 * The PDF structure (as extracted by pdf-parse) is:
 * 1. Vote data rows: bill number + optional title + vote symbols + result
 * 2. Vertical member name blocks (one char per line)
 * 3. Header labels
 *
 * Two main formats:
 * - Newer (R2+): bill title is inline with bill number
 *   "議案第1号 桐生市手数料条例の一部を改正する条例案\n〇 〇 × 〇 ... 原案可決"
 * - Older (H28-H31): bill title appears separately after all vote data
 *   "議案第1号\n○○×○○...\n原案可決"
 */
function parseVotingText(text: string): VoteRecord[] {
  const normalizedText = toHalf(text);
  const lines = normalizedText.split("\n");

  // Step 1: Extract member names from vertical blocks
  const memberNames = extractMemberNames(normalizedText);
  if (memberNames.length === 0) {
    log("  Warning: Could not extract member names from vertical text");
    return [];
  }
  log(`  Found ${memberNames.length} members: ${memberNames.slice(0, 3).join(", ")}...`);

  // Step 2: Determine expected vote count per bill.
  // One member is the speaker (議長) who doesn't vote.
  // So vote count = memberNames.length - 1
  const expectedVotes = memberNames.length - 1;

  // Step 3: Find the speaker position by looking for "議長のため採決に加わらず"
  // In the PDF text, this appears as vertical text near one of the column positions.
  // We need to find which position (index) in the vote sequence has the speaker marker.
  // The marker "議長のため採決に加わらず" appears between vote symbols in some PDFs.

  // Step 4: Parse bill data
  // Scan through lines looking for bill numbers and their associated vote symbols and results.
  const records: VoteRecord[] = [];

  // Collect all bill entries with their vote lines
  const billPattern =
    /(?:議案第(\d+)号|報告第(\d+)号|請願第(\d+)号|陳情第(\d+)号|発議案第(\d+)号|議第(\d+)号議案|諮問第(\d+)号)/;

  // First pass: collect bill blocks (bill number line + subsequent vote/result lines)
  interface BillBlock {
    billNumber: string;
    titleParts: string[];
    voteSymbols: ("賛成" | "反対" | "欠席" | "退席")[];
    result: string;
    speakerPosition: number; // -1 if not found in this block
  }

  const billBlocks: BillBlock[] = [];
  let i = 0;

  // Detect which lines are part of the vote data area vs name area
  // Vote data area has bill numbers and vote symbols
  // Name area has single-char lines

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      i++;
      continue;
    }

    const billMatch = line.match(billPattern);
    if (!billMatch) {
      i++;
      continue;
    }

    // Determine the full bill number string
    let billNumber = "";
    const fullMatch = line.match(
      /(議案第\d+号|報告第\d+号|請願第\d+号|陳情第\d+号|発議案第\d+号|議第\d+号議案|諮問第\d+号)/,
    );
    if (fullMatch) {
      billNumber = fullMatch[1];
    }

    // Collect title and vote data from this line and subsequent lines
    const titleParts: string[] = [];
    let allVoteSymbols: ("賛成" | "反対" | "欠席" | "退席")[] = [];
    let result = "";
    let speakerPos = -1;

    // Check if this line also contains vote symbols (inline format)
    const afterBillNumber = line.slice(
      line.indexOf(billNumber) + billNumber.length,
    );

    // Extract any title text before vote symbols
    // Title is the text between the bill number and the first vote symbol
    const voteSymbolsInLine = extractVoteSymbols(afterBillNumber);

    if (voteSymbolsInLine.length > 0) {
      // Inline format: title + votes on same or next line
      const firstSymbolIdx = afterBillNumber.search(/[○×〇✕△欠]/);
      if (firstSymbolIdx > 0) {
        const titleText = afterBillNumber.slice(0, firstSymbolIdx).trim();
        if (titleText) titleParts.push(titleText);
      }
      allVoteSymbols.push(...voteSymbolsInLine);

      // Check for result in same line
      result = extractResult(afterBillNumber);
    } else {
      // Title or continuation on this line after bill number
      const titleText = afterBillNumber.trim();
      if (
        titleText &&
        !titleText.match(
          /^(市|議|委|○|×|〇|結|令和|平成|議員|議案番号)/,
        )
      ) {
        titleParts.push(titleText);
      }
    }

    // Continue scanning subsequent lines for vote symbols, title continuation, and result
    i++;
    while (i < lines.length) {
      const nextLine = lines[i].trim();
      if (!nextLine) {
        i++;
        continue;
      }

      // Stop if we hit another bill number
      if (nextLine.match(billPattern)) break;

      // Stop if we hit the name region markers
      if (
        nextLine.match(
          /^(議員氏名|議案番号|○：賛成|〇：賛成|結\s*果|令和\s*\d|平成\s*\d)/,
        )
      )
        break;
      // Stop if we hit vertical single-char name blocks (a line that's a single kanji)
      if (/^[\u4e00-\u9fff]$/.test(nextLine) && lines[i + 1]?.trim().match(/^[\u4e00-\u9fff\u3000　]$/)) break;
      // Stop if we hit category markers
      if (
        nextLine.match(
          /^(市\s*長\s*提\s*出|議\s*長\s*の|議\s*員\s*提|委\s*員\s*会)/,
        ) &&
        !nextLine.includes("議長のため")
      )
        break;

      // Check for "議長のため採決に加わらず" marker in vote line
      if (
        nextLine.includes("議長") ||
        nextLine.includes("議") && lines[i + 1]?.trim() === "長"
      ) {
        // Speaker marker - check if it appears within a vote symbol line
        const combined = nextLine.replace(
          /議\s*長\s*の\s*た\s*め\s*採\s*決\s*に\s*加\s*わ\s*ら\s*ず/g,
          "",
        );
        const votesBeforeMarker = extractVoteSymbols(
          nextLine.split(/議/)[0] || "",
        );
        if (votesBeforeMarker.length > 0) {
          speakerPos = allVoteSymbols.length + votesBeforeMarker.length;
          allVoteSymbols.push(...votesBeforeMarker);
          // Also get votes after the marker
          const afterMarker = nextLine.replace(
            /.*(?:議長のため採決に加わらず|議\s*長\s*の\s*た\s*め[\s\S]*?ず)/,
            "",
          );
          allVoteSymbols.push(...extractVoteSymbols(afterMarker));
        }
        result = result || extractResult(nextLine);
        i++;
        continue;
      }

      // Check for vote symbols
      const lineVotes = extractVoteSymbols(nextLine);
      if (lineVotes.length > 0) {
        allVoteSymbols.push(...lineVotes);
        result = result || extractResult(nextLine);
        i++;
        continue;
      }

      // Check for result text
      const lineResult = extractResult(nextLine);
      if (lineResult) {
        result = lineResult;
        i++;
        continue;
      }

      // Check if this is a title continuation line
      if (
        !nextLine.match(
          /^[○×〇✕△欠]/,
        ) &&
        !nextLine.match(/^(市|議|委)/) &&
        titleParts.length > 0 || allVoteSymbols.length === 0
      ) {
        // Could be title continuation
        if (
          nextLine.length > 1 &&
          !nextLine.match(/^[\u3000　]+$/) &&
          !nextLine.match(/^(市|議|委|○|〇)/)
        ) {
          titleParts.push(nextLine);
          i++;
          continue;
        }
      }

      i++;
    }

    // Only include if we got vote data
    if (allVoteSymbols.length > 0) {
      billBlocks.push({
        billNumber,
        titleParts,
        voteSymbols: allVoteSymbols,
        result,
        speakerPosition: speakerPos,
      });
    }
  }

  // Step 5: Determine speaker position consistently across all bills
  // The speaker position should be the same for all bills in a session.
  // Find the most common position where the vote count matches expectedVotes.

  // First, try to determine speaker position from the vote counts
  let speakerIndex = -1;

  // If we detected speaker position in any block, use that
  for (const block of billBlocks) {
    if (block.speakerPosition >= 0) {
      speakerIndex = block.speakerPosition;
      break;
    }
  }

  // If not found via marker, infer from vote count consistency
  // Most bills should have expectedVotes symbols
  // If a bill has expectedVotes symbols, the speaker is simply absent from the vote data
  if (speakerIndex === -1) {
    // Check if most bills have exactly expectedVotes symbols
    const voteCounts = billBlocks.map((b) => b.voteSymbols.length);
    const hasExpectedVotes = voteCounts.filter(
      (c) => c === expectedVotes,
    ).length;

    if (hasExpectedVotes > billBlocks.length / 2) {
      // Most bills have the right count - speaker is simply not in the vote data
      // We need to figure out which member is the speaker
      speakerIndex = -2; // flag: speaker not in vote data, need to insert
    }
  }

  // Step 6: Build final records
  // Determine which member is the speaker by checking text for "議長のため採決に加わらず"
  // The speaker marker appears near one of the name columns
  let speakerMemberName: string | null = null;

  // Look for the speaker marker position relative to name positions
  // In the PDF text, "議長のため採決に加わらず" appears as vertical text
  // near the corresponding name column
  const speakerMarkerIdx = normalizedText.indexOf("議長のため採決に加わらず");
  if (speakerMarkerIdx === -1) {
    // Try alternate patterns found in PDFs
    const altPatterns = [
      /議\s*長\s*の\s*た\s*め\s*採\s*決\s*に\s*加\s*わ\s*ら\s*ず/,
      /議\n長\nの\nた\nめ\n採\n決\nに\n加\nわ\nら\nず/,
    ];
    // The speaker text appears near specific name positions in the vertical layout.
    // Since we can't easily determine column position from extracted text,
    // we'll use a heuristic: find the name that appears closest to the speaker marker.
  }

  // Alternative approach: in the vote data, the speaker is the member who
  // never has a vote symbol. Count votes per bill and identify the "gap".
  // For most PDFs, all bills have exactly (memberCount - 1) votes,
  // meaning the speaker position is simply not included.

  // Detect speaker from "議長のため" text proximity to names
  // In the raw text, vertical speaker marker chars appear near name chars
  const speakerTextPatterns = [
    "議\n長\nの\nた\nめ\n採\n決\nに\n加\nわ\nら\nず",
    "議\n　\n長\n　\nの\n　\nた\n　\nめ\n　\n採\n　\n決\n　\nに\n　\n加\n　\nわ\n　\nら\n　\nず",
  ];

  // Find speaker by checking which name index has the speaker marker nearby
  // In the extracted text, the speaker vertical marker appears adjacent to
  // the speaker's name vertical block.
  // Let's find the name that appears right before or after the speaker marker.

  // Simple heuristic: find "議長" in lines, then look for nearest name chars
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "議" || trimmed === "長") {
      // Could be start of 議長のため... check following lines
    }
  }

  // If we can't determine the speaker from text layout, use a different approach:
  // Look at the vote counts. If all bills have expectedVotes symbols,
  // find which member name position maps to the "missing" vote slot.
  // Since we know the names are in column order matching the PDF table,
  // and the speaker's column has the marker instead of vote symbols,
  // the speaker name should be at the position where votes are "missing".

  // For now, let's try to detect the speaker from the session data or
  // from a pattern in the PDF text where the speaker name appears
  // right before/after "議長のため採決に加わらず"

  // Look for the full speaker marker as vertical text
  const textForSpeaker = text; // use original text
  const speakerNames = findSpeakerFromVerticalText(textForSpeaker, memberNames);
  if (speakerNames) {
    speakerMemberName = speakerNames;
    log(`  Speaker (議長): ${speakerMemberName}`);
  }

  for (const block of billBlocks) {
    const voteSymbols = block.voteSymbols;
    const billTitle = block.titleParts.join("").replace(/\s+/g, "");

    // Build votes array with speaker
    const votes: VoteRecord["votes"] = [];

    if (voteSymbols.length === expectedVotes && speakerMemberName) {
      // Insert speaker at their position and map other votes
      let voteIdx = 0;
      for (const name of memberNames) {
        if (name === speakerMemberName) {
          votes.push({ memberName: name, vote: "議長" });
        } else {
          if (voteIdx < voteSymbols.length) {
            votes.push({ memberName: name, vote: voteSymbols[voteIdx] });
            voteIdx++;
          }
        }
      }
    } else if (voteSymbols.length === memberNames.length) {
      // One-to-one mapping (speaker voted or is marked in the symbols)
      for (let j = 0; j < memberNames.length; j++) {
        votes.push({
          memberName: memberNames[j],
          vote: voteSymbols[j],
        });
      }
    } else if (
      voteSymbols.length === expectedVotes &&
      !speakerMemberName
    ) {
      // Can't determine speaker, but have correct vote count
      // Try to guess: speaker position from common patterns
      // Skip this record with a warning
      log(
        `  Warning: ${block.billNumber} has ${voteSymbols.length} votes but speaker unknown`,
      );
      // Still include but without speaker identification
      let voteIdx = 0;
      for (const name of memberNames) {
        if (voteIdx < voteSymbols.length) {
          votes.push({ memberName: name, vote: voteSymbols[voteIdx] });
          voteIdx++;
        }
      }
    } else {
      // Mismatch in vote count - skip
      log(
        `  Warning: ${block.billNumber} vote count mismatch: got ${voteSymbols.length}, expected ${expectedVotes} or ${memberNames.length}`,
      );
      continue;
    }

    if (votes.length > 0) {
      records.push({
        billNumber: block.billNumber,
        billTitle,
        result: block.result,
        votes,
      });
    }
  }

  return records;
}

/**
 * Find the speaker name by looking at the vertical text layout.
 * The speaker marker "議長のため採決に加わらず" appears as vertical text
 * near the speaker's name column.
 */
function findSpeakerFromVerticalText(
  text: string,
  memberNames: string[],
): string | null {
  const lines = text.split("\n");

  // Find lines that contain parts of "議長のため採決に加わらず"
  // In vertical layout, each character is on its own line
  const speakerChars = "議長のため採決に加わらず".split("");

  // Find the sequence of lines matching the speaker marker
  for (let i = 0; i < lines.length - speakerChars.length; i++) {
    let match = true;
    for (let j = 0; j < speakerChars.length; j++) {
      const line = lines[i + j].trim();
      // Allow for interleaved spaces
      if (line !== speakerChars[j] && !line.includes(speakerChars[j])) {
        match = false;
        break;
      }
    }

    if (match) {
      // Found the speaker marker. Now look for the nearest name block.
      // Check lines before and after the marker for name characters.
      // The speaker's name should be adjacent to this marker.

      // Look backwards for name characters
      const nameCharsAbove: string[] = [];
      for (let k = i - 1; k >= Math.max(0, i - 20); k--) {
        const t = lines[k].trim();
        if (/^[\u4e00-\u9fff]$/.test(t) || t === "　") {
          nameCharsAbove.unshift(t);
        } else {
          break;
        }
      }

      // Look forwards for name characters
      const nameCharsBelow: string[] = [];
      for (
        let k = i + speakerChars.length;
        k < Math.min(lines.length, i + speakerChars.length + 20);
        k++
      ) {
        const t = lines[k].trim();
        if (/^[\u4e00-\u9fff]$/.test(t) || t === "　") {
          nameCharsBelow.push(t);
        } else {
          break;
        }
      }

      // Try to parse a name from the adjacent characters
      const candidates = [nameCharsAbove, nameCharsBelow];
      for (const chars of candidates) {
        const nameStr = parseSingleName(chars);
        if (nameStr && memberNames.includes(nameStr)) {
          return nameStr;
        }
      }

      // If we found the marker but couldn't determine the name from adjacent chars,
      // try looking at the broader context
      break;
    }
  }

  // Fallback: try matching with space-variant patterns
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "議") {
      // Check if next chars form 長のため...
      const nextChars: string[] = [];
      for (let j = 1; j <= 20 && i + j < lines.length; j++) {
        const t = lines[i + j].trim();
        if (t === "　" || t === "") continue;
        nextChars.push(t);
        if (nextChars.length >= 6) break;
      }
      if (nextChars.join("").startsWith("長のため採決")) {
        // Found it - look for name above or below
        const nameCharsAbove: string[] = [];
        for (let k = i - 1; k >= Math.max(0, i - 20); k--) {
          const t = lines[k].trim();
          if (/^[\u4e00-\u9fff]$/.test(t) || t === "　") {
            nameCharsAbove.unshift(t);
          } else {
            break;
          }
        }

        const nameStr = parseSingleName(nameCharsAbove);
        if (nameStr && memberNames.includes(nameStr)) {
          return nameStr;
        }

        // Try below the marker
        // Find end of marker first
        let markerEnd = i + 1;
        for (; markerEnd < lines.length; markerEnd++) {
          const t = lines[markerEnd].trim();
          if (t === "ず") {
            markerEnd++;
            break;
          }
        }
        const nameCharsBelow: string[] = [];
        for (
          let k = markerEnd;
          k < Math.min(lines.length, markerEnd + 20);
          k++
        ) {
          const t = lines[k].trim();
          if (/^[\u4e00-\u9fff]$/.test(t) || t === "　") {
            nameCharsBelow.push(t);
          } else {
            break;
          }
        }

        const nameBelowStr = parseSingleName(nameCharsBelow);
        if (nameBelowStr && memberNames.includes(nameBelowStr)) {
          return nameBelowStr;
        }
      }
    }
  }

  return null;
}

/**
 * Parse a single name from an array of characters (from vertical text).
 * Characters are like: ['飯', '島', '　', '英', '規']
 * Returns "飯島\u3000英規" format.
 */
function parseSingleName(chars: string[]): string | null {
  if (chars.length < 2) return null;

  // Filter out empty strings
  const filtered = chars.filter((c) => c !== "");
  if (filtered.length < 2) return null;

  let familyPart: string[] = [];
  let spaceSeen = false;
  let givenPart: string[] = [];

  for (const char of filtered) {
    if (char === "　") {
      if (familyPart.length > 0 && !spaceSeen) {
        spaceSeen = true;
      }
    } else {
      if (spaceSeen) {
        givenPart.push(char);
      } else {
        familyPart.push(char);
      }
    }
  }

  if (familyPart.length > 0 && givenPart.length > 0) {
    return familyPart.join("") + "\u3000" + givenPart.join("");
  }
  return null;
}

async function main() {
  log("Loading session data...");

  const sessionFiles = readdirSync(SESSIONS_DIR).filter((f) =>
    f.endsWith(".json"),
  );
  const sessionsWithPdf: { slug: string; session: string; pdfUrl: string }[] =
    [];

  for (const file of sessionFiles) {
    const raw = readFileSync(resolve(SESSIONS_DIR, file), "utf-8");
    const data = JSON.parse(raw);
    if (data.votingRecordPdfUrl) {
      sessionsWithPdf.push({
        slug: file.replace(".json", ""),
        session: data.session,
        pdfUrl: data.votingRecordPdfUrl,
      });
    }
  }

  log(`Found ${sessionsWithPdf.length} sessions with voting record PDFs`);
  mkdirSync(OUTPUT_DIR, { recursive: true });

  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  for (const entry of sessionsWithPdf) {
    const filePath = resolve(OUTPUT_DIR, `${entry.slug}.json`);

    // Skip if already processed
    if (existsSync(filePath)) {
      const existing = JSON.parse(readFileSync(filePath, "utf-8"));
      if (existing.records && existing.records.length > 0) {
        log(`Skipping: ${entry.session} (${entry.slug}) - already exists with ${existing.records.length} records`);
        skipCount++;
        continue;
      }
    }

    log(`Processing: ${entry.session} (${entry.slug})`);
    await sleep(1000);

    let pdfBuf: Buffer;
    try {
      pdfBuf = await fetchPdf(entry.pdfUrl);
    } catch (err) {
      log(`  Error downloading PDF: ${err}`);
      errorCount++;
      continue;
    }

    let pdfData;
    try {
      const pdfParse = (await import("pdf-parse")).default;
      pdfData = await pdfParse(pdfBuf);
    } catch (err) {
      log(`  Error parsing PDF: ${err}`);
      errorCount++;
      continue;
    }

    const records = parseVotingText(pdfData.text);

    const votingData: VotingData = {
      session: entry.session,
      sessionSlug: entry.slug,
      sourceUrl: entry.pdfUrl,
      scrapedAt: new Date().toISOString(),
      records,
    };

    const parsedVoting = votingSchema.parse(votingData);
    writeFileSync(
      filePath,
      JSON.stringify(parsedVoting, null, 2) + "\n",
      "utf-8",
    );
    log(`  => ${records.length} records saved to ${entry.slug}.json`);
    successCount++;
  }

  log(
    `Done: ${successCount} succeeded, ${skipCount} skipped, ${errorCount} failed`,
  );
}

main().catch((err) => {
  console.error("[scrape-voting] Fatal error:", err);
  process.exit(1);
});
