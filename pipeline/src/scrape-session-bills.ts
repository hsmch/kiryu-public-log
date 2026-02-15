import * as cheerio from "cheerio";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const GIKETSU_INDEX_URL =
  "https://www.city.kiryu.lg.jp/shigikai/honkaigi/gian/giketsu/index.html";
const USER_AGENT = "KiryuPublicLog/1.0 (+https://kiryu.co)";
const DATA_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../data/sessions",
);
const REQUEST_INTERVAL_MS = 1000;

interface Bill {
  number: string;
  title: string;
  result: string;
  category: string;
}

interface SessionData {
  session: string;
  sourceUrls: string[];
  scrapedAt: string;
  dates: string[];
  bills: Bill[];
  votingRecordPdfUrl: string | null;
}

interface SessionLink {
  label: string;
  url: string;
  sessionKey: string;
  category: string;
}

function log(msg: string) {
  console.log(`[scrape-session-bills] ${msg}`);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function resolveUrl(href: string, base: string): string {
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

async function fetchPage(url: string): Promise<cheerio.CheerioAPI> {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  const html = await response.text();
  return cheerio.load(html);
}

/**
 * セッション名からキーを抽出（カテゴリ部分を除去）
 * 例: "平成27年第1回定例会市長提出議案議決結果" → "平成27年第1回定例会"
 */
function extractSessionKey(label: string): string {
  const match = label.match(
    /((?:令和|平成)\d+年(?:第\d+回)?(?:定例会|臨時会))/,
  );
  // "令和元年" 対応
  if (!match) {
    const gannenMatch = label.match(
      /(令和元年(?:第\d+回)?(?:定例会|臨時会))/,
    );
    return gannenMatch?.[1] ?? label;
  }
  return match[1];
}

/**
 * リンクテキストからカテゴリを推定
 */
function inferCategory(label: string): string {
  if (label.includes("請願")) return "請願";
  if (label.includes("議員提出") || label.includes("委員会")) {
    return "委員会・議員提出議案";
  }
  if (label.includes("議員個人") || label.includes("賛否")) {
    return "賛否記録";
  }
  return "市長提出議案";
}

async function getYearUrls(): Promise<{ label: string; url: string }[]> {
  const $ = await fetchPage(GIKETSU_INDEX_URL);
  const years: { label: string; url: string }[] = [];

  $("a").each((_, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr("href");
    if (href && text.includes("議決結果") && /[令平]/.test(text)) {
      years.push({
        label: text,
        url: resolveUrl(href, GIKETSU_INDEX_URL),
      });
    }
  });

  return years;
}

/**
 * 年度ページからセッションリンクを取得（新旧両形式対応）
 */
async function getSessionLinks(yearUrl: string): Promise<SessionLink[]> {
  const $ = await fetchPage(yearUrl);
  const links: SessionLink[] = [];

  $("a").each((_, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr("href");
    if (!href) return;

    // 定例会・臨時会関連のリンクを収集（賛否PDFは除外）
    const isSession =
      (text.includes("定例会") || text.includes("臨時会")) &&
      text.includes("議決結果");
    // 旧形式: カテゴリ別ページ（市長提出・議員提出・請願）
    const isOldFormatCategory =
      (text.includes("定例会") || text.includes("臨時会")) &&
      (text.includes("市長提出") ||
        text.includes("議員提出") ||
        text.includes("請願結果"));

    if (isSession || isOldFormatCategory) {
      const category = inferCategory(text);
      // 賛否記録は別途扱うのでスキップ
      if (category === "賛否記録") return;

      links.push({
        label: text,
        url: resolveUrl(href, yearUrl),
        sessionKey: extractSessionKey(text),
        category,
      });
    }
  });

  return links;
}

/**
 * テーブルから議案データを抽出
 */
function parseBillsFromTable(
  $: cheerio.CheerioAPI,
  table: cheerio.Element,
  defaultCategory: string,
): { date: string; bills: Bill[] } {
  const caption = $(table).find("caption").text().trim();
  const bills: Bill[] = [];

  $(table)
    .find("tr")
    .each((_, tr) => {
      const th = $(tr).find("th[scope='row']");
      const tds = $(tr).find("td");

      if (th.length === 0 || tds.length < 2) return;

      const number = th.text().replace(/\u00a0/g, " ").trim();
      if (number === "議案番号" || number === "請願番号") return;

      const title = tds.eq(0).text().trim();
      const result = tds.eq(1).text().replace(/\u00a0/g, " ").trim();

      if (number && title) {
        bills.push({ number, title, result, category: defaultCategory });
      }
    });

  return { date: caption, bills };
}

/**
 * 新形式ページ: h2セクションでカテゴリ分けされている
 */
function parseNewFormatPage(
  $: cheerio.CheerioAPI,
  url: string,
): { dates: string[]; bills: Bill[]; pdfUrl: string | null } {
  const allBills: Bill[] = [];
  const dates: string[] = [];
  let pdfUrl: string | null = null;

  const h2s = $("h2");
  let foundCategory = false;

  for (const h2 of h2s.toArray()) {
    const h2Text = $(h2).text().trim();
    let category: string | null = null;

    if (h2Text === "市長提出議案") category = "市長提出議案";
    else if (h2Text.includes("委員会") || h2Text.includes("議員提出"))
      category = "委員会・議員提出議案";
    else if (h2Text.includes("請願")) category = "請願";

    if (!category) continue;
    foundCategory = true;

    let el = $(h2).next();
    while (el.length > 0 && el.prop("tagName")?.toLowerCase() !== "h2") {
      if (el.prop("tagName")?.toLowerCase() === "table") {
        const { date, bills } = parseBillsFromTable($, el[0]!, category);
        if (date && !dates.includes(date)) dates.push(date);
        allBills.push(...bills);
      }
      el = el.next();
    }
  }

  // 議員個々の賛否 PDF
  $("a[href$='.pdf']").each((_, el) => {
    const text = $(el).text();
    if (text.includes("賛否")) {
      pdfUrl = resolveUrl($(el).attr("href") ?? "", url);
    }
  });

  return foundCategory
    ? { dates, bills: allBills, pdfUrl }
    : { dates: [], bills: [], pdfUrl: null };
}

/**
 * 旧形式ページ: カテゴリ別に分かれた単独ページ
 */
function parseOldFormatPage(
  $: cheerio.CheerioAPI,
  category: string,
): { dates: string[]; bills: Bill[] } {
  const allBills: Bill[] = [];
  const dates: string[] = [];

  $("table").each((_, table) => {
    const { date, bills } = parseBillsFromTable($, table, category);
    if (date && !dates.includes(date)) dates.push(date);
    allBills.push(...bills);
  });

  return { dates, bills: allBills };
}

function sessionKeyToFilename(key: string): string {
  // "令和元年" → "r1"
  let era: string;
  let year: string;
  const gannenMatch = key.match(/令和元年/);
  const eraMatch = key.match(/(令和|平成)(\d+)年/);

  if (gannenMatch) {
    era = "r";
    year = "1";
  } else if (eraMatch) {
    era = eraMatch[1] === "令和" ? "r" : "h";
    year = eraMatch[2];
  } else {
    return key.replace(/\s+/g, "-");
  }

  const numMatch = key.match(/第(\d+)回/);
  const num = numMatch?.[1] ?? "0";
  const type = key.includes("臨時会") ? "rinjikai" : "teireikai";

  return `${era}${year}-${num}-${type}`;
}

async function main() {
  log("Fetching year index...");
  const years = await getYearUrls();
  log(`Found ${years.length} years`);

  mkdirSync(DATA_DIR, { recursive: true });

  let totalSessions = 0;
  let totalBills = 0;

  for (const year of years) {
    log(`Fetching sessions for: ${year.label}`);
    await sleep(REQUEST_INTERVAL_MS);
    const links = await getSessionLinks(year.url);
    log(`  Found ${links.length} links`);

    // セッションごとにグループ化
    const grouped = new Map<string, SessionLink[]>();
    for (const link of links) {
      const existing = grouped.get(link.sessionKey) ?? [];
      existing.push(link);
      grouped.set(link.sessionKey, existing);
    }

    for (const [sessionKey, sessionLinks] of grouped) {
      const sessionData: SessionData = {
        session: sessionKey,
        sourceUrls: [],
        scrapedAt: new Date().toISOString(),
        dates: [],
        bills: [],
        votingRecordPdfUrl: null,
      };

      for (const link of sessionLinks) {
        log(`  Parsing: ${link.label}`);
        await sleep(REQUEST_INTERVAL_MS);

        const $ = await fetchPage(link.url);
        sessionData.sourceUrls.push(link.url);

        // 新形式を試す
        const newResult = parseNewFormatPage($, link.url);
        if (newResult.bills.length > 0) {
          sessionData.bills.push(...newResult.bills);
          for (const d of newResult.dates) {
            if (!sessionData.dates.includes(d)) sessionData.dates.push(d);
          }
          if (newResult.pdfUrl) {
            sessionData.votingRecordPdfUrl = newResult.pdfUrl;
          }
        } else {
          // 旧形式にフォールバック
          const oldResult = parseOldFormatPage($, link.category);
          sessionData.bills.push(...oldResult.bills);
          for (const d of oldResult.dates) {
            if (!sessionData.dates.includes(d)) sessionData.dates.push(d);
          }
        }
      }

      const filename = sessionKeyToFilename(sessionKey);
      const filePath = resolve(DATA_DIR, `${filename}.json`);
      writeFileSync(
        filePath,
        JSON.stringify(sessionData, null, 2) + "\n",
        "utf-8",
      );
      log(
        `    → ${sessionData.bills.length} bills → ${filename}.json`,
      );

      totalSessions++;
      totalBills += sessionData.bills.length;
    }
  }

  log(`Done: ${totalSessions} sessions, ${totalBills} bills total`);
}

main().catch((err) => {
  console.error("[scrape-session-bills] Fatal error:", err);
  process.exit(1);
});
