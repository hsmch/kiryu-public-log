import * as cheerio from "cheerio";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { updatesSchema } from "./schemas";

const TARGET_URL = "https://www.city.kiryu.lg.jp/shigikai/index.html";
const USER_AGENT = "KiryuPublicLog/1.0 (+https://kiryu.co)";
const OUTPUT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../data/updates.json",
);

interface UpdateEntry {
  date: string; // YYYY-MM-DD
  label: string; // "更新" | "新規"
  title: string;
  url: string;
  firstSeenAt: string;
}

interface UpdatesData {
  sourceUrl: string;
  lastCheckedAt: string;
  entries: UpdateEntry[];
}

function log(msg: string) {
  console.log(`[scrape-updates] ${msg}`);
}

function resolveUrl(relative: string): string {
  try {
    return new URL(relative, TARGET_URL).href;
  } catch {
    return relative;
  }
}

/**
 * "2月13日（金曜日）" → { month: 2, day: 13 }
 */
function parseDate(raw: string): { month: number; day: number } | null {
  const match = raw.match(/(\d{1,2})月(\d{1,2})日/);
  if (!match) return null;
  return { month: parseInt(match[1], 10), day: parseInt(match[2], 10) };
}

/**
 * 年なし日付から YYYY-MM-DD を推定する。
 * 現在1月で日付が12月の場合は前年とみなす。
 */
function inferFullDate(month: number, day: number): string {
  const now = new Date();
  let year = now.getFullYear();

  // 現在1月で日付が11-12月 → 前年
  if (now.getMonth() + 1 <= 1 && month >= 11) {
    year--;
  }

  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function loadExisting(): UpdatesData | null {
  if (!existsSync(OUTPUT_PATH)) return null;
  try {
    const raw = readFileSync(OUTPUT_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function entryKey(e: Pick<UpdateEntry, "date" | "title" | "url">): string {
  return `${e.date}|${e.title}|${e.url}`;
}

async function main() {
  log(`Fetching ${TARGET_URL}`);

  const response = await fetch(TARGET_URL, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const html = await response.text();
  log(`Fetched ${html.length} bytes`);

  const $ = cheerio.load(html);

  // 「新着更新情報」の h2 を探す
  let targetH2: cheerio.Element | null = null;
  $("h2").each((_, h2) => {
    if ($(h2).text().includes("新着更新情報")) {
      targetH2 = h2;
    }
  });

  if (!targetH2) {
    throw new Error(
      "「新着更新情報」セクションが見つかりません。HTML構造が変更された可能性があります。",
    );
  }

  // h2 の次の ul を取得
  const ul = $(targetH2).next("ul");
  if (ul.length === 0) {
    throw new Error(
      "新着更新情報の ul が見つかりません。HTML構造が変更された可能性があります。",
    );
  }

  const now = new Date().toISOString();
  const scraped: UpdateEntry[] = [];

  ul.find("li.box").each((_, li) => {
    const $li = $(li);

    // 日付
    const dateRaw = $li.find("span.date").text().trim();
    const parsed = parseDate(dateRaw);
    if (!parsed) {
      log(`Warning: 日付をパースできません: "${dateRaw}"`);
      return;
    }
    const date = inferFullDate(parsed.month, parsed.day);

    // ラベル（更新 or 新規）
    let label = "更新";
    if ($li.find("span.labelnew").length > 0) {
      label = "新規";
    } else if ($li.find("span.labelupdate").length > 0) {
      label = "更新";
    }

    // タイトルとURL
    const $a = $li.find("span.newsli a");
    const title = $a.text().trim();
    const href = $a.attr("href") ?? "";
    const url = href ? resolveUrl(href) : "";

    if (!title) {
      log(`Warning: タイトルが空のエントリをスキップしました`);
      return;
    }

    scraped.push({ date, label, title, url, firstSeenAt: now });
  });

  log(`Scraped ${scraped.length} entries from page`);

  if (scraped.length === 0) {
    throw new Error(
      "新着情報が0件です。HTML構造が変更された可能性があります。",
    );
  }

  // 既存データとの差分検出
  const existing = loadExisting();
  const existingKeys = new Set(
    existing?.entries.map((e) => entryKey(e)) ?? [],
  );

  const newEntries = scraped.filter((e) => !existingKeys.has(entryKey(e)));
  log(`New entries: ${newEntries.length}`);

  // 既存エントリを保持しつつ、新規エントリを先頭に追加
  const mergedEntries = [
    ...newEntries,
    ...(existing?.entries ?? []),
  ];

  const output: UpdatesData = {
    sourceUrl: TARGET_URL,
    lastCheckedAt: now,
    entries: mergedEntries,
  };

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  const parsed = updatesSchema.parse(output);
  writeFileSync(OUTPUT_PATH, JSON.stringify(parsed, null, 2) + "\n", "utf-8");
  log(`Saved ${mergedEntries.length} entries (${newEntries.length} new) to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("[scrape-updates] Fatal error:", err);
  process.exit(1);
});
