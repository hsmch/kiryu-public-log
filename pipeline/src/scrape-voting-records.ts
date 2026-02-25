import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  existsSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
  if (t === "退" || t === "退席") return "退席";
  return null;
}

function toHalf(s: string): string {
  return s.replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  );
}

function parseVotingText(text: string): VoteRecord[] {
  const lines = text
    .split("\n")
    .map((l) => toHalf(l.trim()))
    .filter(Boolean);

  const records: VoteRecord[] = [];
  let memberNames: string[] = [];
  let dataStartIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const namePattern = /[\u4e00-\u9fff]{1,4}[\s\u3000]+[\u4e00-\u9fff]{1,4}/g;
    const names = line.match(namePattern);

    if (names && names.length >= 3) {
      memberNames = names.map((n) => n.replace(/\s+/g, "\u3000"));
      dataStartIndex = i + 1;
      break;
    }
  }

  if (memberNames.length === 0 || dataStartIndex < 0) {
    log("  Warning: Could not find member name header row");
    return records;
  }

  log(`  Found ${memberNames.length} members in header`);

  for (let i = dataStartIndex; i < lines.length; i++) {
    const line = lines[i];
    const billMatch = line.match(
      /(議案第\d+号|報告第\d+号|請願第\d+号|陳情第\d+号|発議案第\d+号)/,
    );
    if (!billMatch) continue;

    const billNumber = billMatch[1];
    const afterNumber = line.slice(
      line.indexOf(billNumber) + billNumber.length,
    );
    const titleMatch = afterNumber.match(
      /\s*(.+?)(?:\s*[○×〇✕欠退議]|\s*賛成|\s*反対|\s*$)/,
    );
    const billTitle = titleMatch ? titleMatch[1].trim() : "";

    const voteSymbols: string[] = [];
    const symbolPattern = /[○×〇✕]|欠席?|退席?|議長/g;
    let match;
    const voteArea = line.slice(line.indexOf(billNumber));
    while ((match = symbolPattern.exec(voteArea)) !== null) {
      const v = normalizeVote(match[0]);
      if (v) voteSymbols.push(v);
    }

    const yesCount = voteSymbols.filter((v) => v === "賛成").length;
    const noCount = voteSymbols.filter((v) => v === "反対").length;
    const result =
      noCount === 0 ? "全会一致" : yesCount > noCount ? "賛成多数" : "反対多数";

    if (voteSymbols.length === memberNames.length) {
      const votes = memberNames.map((name, idx) => ({
        memberName: name,
        vote: voteSymbols[idx] as VoteRecord["votes"][0]["vote"],
      }));
      records.push({ billNumber, billTitle, result, votes });
    }
  }

  return records;
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
  let errorCount = 0;

  let skipCount = 0;

  for (const entry of sessionsWithPdf) {
    const filePath = resolve(OUTPUT_DIR, `${entry.slug}.json`);

    if (existsSync(filePath)) {
      log(`Skip ${entry.slug} (already exists)`);
      skipCount++;
      continue;
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

    writeFileSync(
      filePath,
      JSON.stringify(votingData, null, 2) + "\n",
      "utf-8",
    );
    log(`  → ${records.length} records saved to ${entry.slug}.json`);
    successCount++;
  }

  log(
    `Done: ${successCount} succeeded, ${errorCount} failed, ${skipCount} skipped`,
  );
}

main().catch((err) => {
  console.error("[scrape-voting] Fatal error:", err);
  process.exit(1);
});
