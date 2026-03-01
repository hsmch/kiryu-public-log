import * as cheerio from "cheerio";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { questionsSchema } from "./schemas";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const INDEX_URL =
  "https://www.city.kiryu.lg.jp/shigikai/honkaigi/shitsusmon/index.html";
const USER_AGENT = "KiryuPublicLog/1.0 (+https://kiryu.co)";
const DATA_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../data/questions",
);
const REQUEST_INTERVAL_MS = 1000;

// ─── Types ───

interface QuestionItem {
  title: string;
  details: string[];
}

interface MemberQuestion {
  memberName: string;
  order: number;
  items: QuestionItem[];
}

interface QuestionsData {
  session: string;
  sessionSlug: string;
  sourceUrl: string;
  pdfUrl: string;
  scrapedAt: string;
  questions: MemberQuestion[];
}

// ─── Helpers ───

function log(msg: string) {
  console.log(`[scrape-questions] ${msg}`);
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

async function fetchHtml(url: string): Promise<cheerio.CheerioAPI> {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  const html = await response.text();
  return cheerio.load(html);
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

/** 全角数字・全角記号を半角に */
function toHalf(s: string): string {
  return s.replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  );
}

/**
 * セッション名をファイル名スラッグに変換
 * "令和7年第4回定例会" → "r7-4-teireikai"
 */
function sessionToSlug(session: string): string {
  const gannenMatch = session.match(/令和元年/);
  const eraMatch = session.match(/(令和|平成)(\d+)年/);

  let era: string;
  let year: string;
  if (gannenMatch) {
    era = "r";
    year = "1";
  } else if (eraMatch) {
    era = eraMatch[1] === "令和" ? "r" : "h";
    year = eraMatch[2];
  } else {
    return session.replace(/\s+/g, "-");
  }

  const numMatch = session.match(/第(\d+)回/);
  const num = numMatch?.[1] ?? "0";
  const type = session.includes("臨時会") ? "rinjikai" : "teireikai";

  return `${era}${year}-${num}-${type}`;
}

// ─── Year page scraping ───

interface YearPageLink {
  label: string;
  url: string;
}

async function getYearPageLinks(): Promise<YearPageLink[]> {
  const $ = await fetchHtml(INDEX_URL);
  const links: YearPageLink[] = [];

  $("a").each((_, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr("href");
    if (href && /[令平]/.test(text) && /年/.test(text)) {
      links.push({
        label: text,
        url: resolveUrl(href, INDEX_URL),
      });
    }
  });

  return links;
}

interface PdfEntry {
  session: string;
  pdfUrl: string;
  pageUrl: string;
}

async function getPdfLinksFromYearPage(
  yearUrl: string,
): Promise<PdfEntry[]> {
  const $ = await fetchHtml(yearUrl);
  const entries: PdfEntry[] = [];

  const pdfLinks = $("a[href$='.pdf']");

  for (const el of pdfLinks.toArray()) {
    const href = $(el).attr("href");
    if (!href) continue;

    const pdfUrl = resolveUrl(href, yearUrl);
    const linkText = $(el).text().trim();

    let session = "";

    // リンクテキストから定例会名を抽出
    const sessionInLink = linkText.match(
      /(?:令和|平成)(?:\d+|元)年(?:桐生市議会)?第\d+回(?:定例会|臨時会)/,
    );
    if (sessionInLink) {
      session = sessionInLink[0]
        .replace("桐生市議会", "")
        .replace(/\s+/g, "");
    }

    // 近くの見出しから探す
    if (!session) {
      // ページタイトル(H1)から年度を取得
      const h1Text = $("h1").first().text().trim();
      let yearPrefix = "";
      const h1YearMatch = h1Text.match(/((?:令和|平成)(?:\d+|元)年)/);
      if (h1YearMatch) {
        yearPrefix = h1YearMatch[1];
      }

      // 親要素をたどって最も近い見出しを探す
      let node = $(el).parent();
      for (let i = 0; i < 10 && node.length > 0; i++) {
        const prevHeading = node.prevAll("h2, h3").first();
        if (prevHeading.length > 0) {
          const prevText = prevHeading.text().trim();

          // 完全なセッション名が見出しにある場合
          const fullMatch = prevText.match(
            /((?:令和|平成)(?:\d+|元)年(?:桐生市議会)?第\d+回(?:定例会|臨時会))/,
          );
          if (fullMatch) {
            session = fullMatch[1]
              .replace("桐生市議会", "")
              .replace(/\s+/g, "");
            break;
          }

          // 「第X回定例会」のみの見出し（年度はH1から補完）
          const partialMatch = prevText.match(/第(\d+)回(定例会|臨時会)/);
          if (partialMatch && yearPrefix) {
            session = `${yearPrefix}第${partialMatch[1]}回${partialMatch[2]}`;
            break;
          }
        }
        node = node.parent();
      }
    }

    // ファイル名から推定
    if (!session) {
      const fnMatch = href.match(/([rh])(\d+)t(\d+)/i);
      if (fnMatch) {
        const eraName = fnMatch[1].toLowerCase() === "r" ? "令和" : "平成";
        session = `${eraName}${fnMatch[2]}年第${fnMatch[3]}回定例会`;
      }
    }

    if (session) {
      entries.push({ session, pdfUrl, pageUrl: yearUrl });
    }
  }

  return entries;
}

// ─── Coordinate-based PDF parsing ───

interface TextItem {
  text: string;
  x: number;
  y: number;
}

/**
 * PDF テキストアイテムを座標付きで抽出するカスタムレンダラー
 */
function coordinateRenderer(pageData: any): Promise<string> {
  return pageData.getTextContent().then((textContent: any) => {
    const items = textContent.items
      .filter((item: any) => item.str.trim())
      .map((item: any) => ({
        text: item.str,
        x: Math.round(item.transform[4]),
        y: Math.round(item.transform[5]),
      }));
    return JSON.stringify(items);
  });
}

/**
 * テキストアイテムを行にグループ化（y座標が近いもの同士）
 */
function groupIntoRows(items: TextItem[]): TextItem[][] {
  if (items.length === 0) return [];

  // y座標降順（上から下）でソート
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);

  const rows: TextItem[][] = [];
  let currentRow: TextItem[] = [sorted[0]];
  let currentY = sorted[0].y;

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    // y座標が5px以内なら同じ行
    if (Math.abs(item.y - currentY) <= 5) {
      currentRow.push(item);
    } else {
      // x座標でソートして行を確定
      currentRow.sort((a, b) => a.x - b.x);
      rows.push(currentRow);
      currentRow = [item];
      currentY = item.y;
    }
  }
  currentRow.sort((a, b) => a.x - b.x);
  rows.push(currentRow);

  return rows;
}

/**
 * 行内のカラムを判定
 *
 * PDF テーブルのカラム構造（x座標ベース）:
 * - x < 75: 順序番号
 * - 75 ≤ x < 190: 件名カラム（議員名 or 件番号 + タイトル）
 * - 190 ≤ x < 480: 質問項目カラム（番号 + テキスト）
 * - x ≥ 480: 答弁を求める者
 */
type ColumnType = "order" | "item_title" | "detail" | "respondent";

function classifyColumn(x: number): ColumnType {
  if (x < 75) return "order";
  if (x < 190) return "item_title";
  if (x < 480) return "detail";
  return "respondent";
}

interface ParsedRow {
  order: string;
  itemTitle: string;
  detail: string;
  respondent: string;
}

function parseRow(items: TextItem[]): ParsedRow {
  const row: ParsedRow = { order: "", itemTitle: "", detail: "", respondent: "" };

  for (const item of items) {
    const col = classifyColumn(item.x);
    const text = item.text.trim();
    switch (col) {
      case "order":
        row.order += text;
        break;
      case "item_title":
        row.itemTitle += (row.itemTitle ? "" : "") + text;
        break;
      case "detail":
        row.detail += (row.detail ? "" : "") + text;
        break;
      case "respondent":
        row.respondent += text;
        break;
    }
  }

  return row;
}

/** 議員名行の判定: "○番　氏名" */
const MEMBER_NAME_RE = /^(\d+)番\s*(.+)/;

/** ヘッダーや不要行の判定 */
function isHeaderRow(row: ParsedRow): boolean {
  const all = (row.order + row.itemTitle + row.detail + row.respondent).trim();
  if (!all) return true;
  if (all.includes("一般質問通告一覧表")) return true;
  if (all.includes("議員1人の持ち時間") || all.includes("議員１人の持ち時間"))
    return true;
  if (all.includes("質問・答弁は")) return true;
  if (/^議席番号/.test(row.itemTitle)) return true;
  if (/^質問項目/.test(row.detail)) return true;
  if (/^件\s+名$/.test(row.itemTitle.trim())) return true;
  if (/^(答弁を|求める者|件\s+名|順|序)$/.test(all)) return true;
  return false;
}

function parsePdfWithCoordinates(pagesJson: string[]): MemberQuestion[] {
  const members: MemberQuestion[] = [];
  let currentMember: MemberQuestion | null = null;
  let currentItem: QuestionItem | null = null;
  let orderCounter = 0;

  for (const pageJson of pagesJson) {
    let items: TextItem[];
    try {
      items = JSON.parse(pageJson);
    } catch {
      continue;
    }

    const rows = groupIntoRows(items);

    for (const rowItems of rows) {
      const row = parseRow(rowItems);

      // ヘッダー行スキップ
      if (isHeaderRow(row)) continue;

      const itemTitleNorm = toHalf(row.itemTitle.trim());
      const detailNorm = toHalf(row.detail.trim());

      // 議員名行の検出
      const memberMatch = itemTitleNorm.match(MEMBER_NAME_RE);
      if (memberMatch && !detailNorm) {
        // 新しい議員
        orderCounter++;
        currentMember = {
          memberName: memberMatch[2].replace(/\s+/g, ""),
          order: orderCounter,
          items: [],
        };
        members.push(currentMember);
        currentItem = null;
        continue;
      }

      if (!currentMember) continue;

      // 件名番号の検出（item_title カラムに番号がある）
      const itemNumMatch = itemTitleNorm.match(/^(\d+)\s*(.*)/);
      // 質問項目番号の検出（detail カラムに番号がある）
      const detailNumMatch = detailNorm.match(/^(\d+)\s*(.*)/);

      // 件名カラムにテキストがある場合
      if (itemTitleNorm && itemNumMatch) {
        const titleText = itemNumMatch[2];

        if (titleText) {
          // 件名番号 + テキスト → 新しい件名
          currentItem = { title: titleText, details: [] };
          currentMember.items.push(currentItem);
        } else if (!currentItem) {
          // 番号のみ（テキストは次行に続く）
          currentItem = { title: "", details: [] };
          currentMember.items.push(currentItem);
        }
      } else if (itemTitleNorm && !itemNumMatch) {
        // 番号なしの件名テキスト → 常に前の件名の続き（改行された件名）
        if (currentItem) {
          currentItem.title += itemTitleNorm;
        } else {
          // 件名がまだない → 新しい件名
          currentItem = { title: itemTitleNorm, details: [] };
          currentMember.items.push(currentItem);
        }
      }

      // 質問項目カラムにテキストがある場合
      if (detailNorm && currentItem) {
        if (detailNumMatch) {
          const detailText = detailNumMatch[2];
          if (detailText) {
            currentItem.details.push(detailText);
          }
        } else {
          // 番号なし → 前の要旨の続き
          if (currentItem.details.length > 0) {
            currentItem.details[currentItem.details.length - 1] +=
              detailNorm;
          } else {
            // 件名の一部かもしれない
            currentItem.details.push(detailNorm);
          }
        }
      } else if (detailNorm && !currentItem) {
        // 件名がまだない状態で質問項目がある場合は件名を作る
        currentItem = { title: "(不明)", details: [detailNorm] };
        currentMember.items.push(currentItem);
      }
    }
  }

  return members;
}

// ─── Main ───

async function main() {
  log("Fetching year index...");
  const yearLinks = await getYearPageLinks();
  log(`Found ${yearLinks.length} year pages`);

  mkdirSync(DATA_DIR, { recursive: true });

  let totalFiles = 0;
  let totalQuestions = 0;

  for (const yearLink of yearLinks) {
    log(`Fetching: ${yearLink.label}`);
    await sleep(REQUEST_INTERVAL_MS);

    let pdfEntries: PdfEntry[];
    try {
      pdfEntries = await getPdfLinksFromYearPage(yearLink.url);
    } catch (err) {
      log(`  Error fetching year page: ${err}`);
      continue;
    }
    log(`  Found ${pdfEntries.length} PDFs`);

    for (const entry of pdfEntries) {
      const slug = sessionToSlug(entry.session);
      const filePath = resolve(DATA_DIR, `${slug}.json`);

      log(`  Processing: ${entry.session} (${slug})`);
      await sleep(REQUEST_INTERVAL_MS);

      let pdfBuf: Buffer;
      try {
        pdfBuf = await fetchPdf(entry.pdfUrl);
      } catch (err) {
        log(`    Error downloading PDF: ${err}`);
        continue;
      }

      let pdfData;
      try {
        pdfData = await pdfParse(pdfBuf, { pagerender: coordinateRenderer });
      } catch (err) {
        log(`    Error parsing PDF: ${err}`);
        continue;
      }

      // 各ページの JSON を分割して解析
      const pagesJson = pdfData.text.split("\n").filter(Boolean);
      const questions = parsePdfWithCoordinates(pagesJson);

      const data: QuestionsData = {
        session: entry.session,
        sessionSlug: slug,
        sourceUrl: entry.pageUrl,
        pdfUrl: entry.pdfUrl,
        scrapedAt: new Date().toISOString(),
        questions,
      };

      const parsedQuestions = questionsSchema.parse(data);
      writeFileSync(filePath, JSON.stringify(parsedQuestions, null, 2) + "\n", "utf-8");
      log(`    → ${questions.length} members, saved to ${slug}.json`);

      totalFiles++;
      totalQuestions += questions.length;
    }
  }

  log(`Done: ${totalFiles} files, ${totalQuestions} total member questions`);
}

main().catch((err) => {
  console.error("[scrape-questions] Fatal error:", err);
  process.exit(1);
});
