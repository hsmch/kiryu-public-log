import * as cheerio from "cheerio";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scheduleSchema } from "./schemas";

const TARGET_URL =
  "https://www.city.kiryu.lg.jp/shigikai/honkaigi/nittei/";
const USER_AGENT = "KiryuPublicLog/1.0 (+https://kiryu.co)";
const OUTPUT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../data/schedule.json",
);

interface ScheduleEntry {
  date: string;
  type: "本会議" | "委員会" | "全員協議会" | "その他";
  session: string;
  description: string;
}

interface ScheduleData {
  sourceUrl: string;
  scrapedAt: string;
  entries: ScheduleEntry[];
}

function log(msg: string) {
  console.log(`[scrape-schedule] ${msg}`);
}

function classifyType(text: string): ScheduleEntry["type"] {
  if (/本会議/.test(text)) return "本会議";
  if (/委員会/.test(text)) return "委員会";
  if (/全員協議会/.test(text)) return "全員協議会";
  return "その他";
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
  const entries: ScheduleEntry[] = [];

  // 日程ページのリンク一覧から各定例会の日程ページURLを取得
  const sessionLinks: { url: string; session: string }[] = [];
  $("a").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const text = $(el).text().trim();
    if (/定例会|臨時会/.test(text) && /nittei/.test(href)) {
      sessionLinks.push({
        url: new URL(href, TARGET_URL).href,
        session: text,
      });
    }
  });

  log(`Found ${sessionLinks.length} session links`);

  // 各定例会の日程ページを取得してパース
  for (const link of sessionLinks) {
    log(`  Fetching ${link.session}...`);
    await new Promise((r) => setTimeout(r, 1000));

    try {
      const res = await fetch(link.url, {
        headers: { "User-Agent": USER_AGENT },
      });
      if (!res.ok) {
        log(`  Warning: HTTP ${res.status} for ${link.url}`);
        continue;
      }
      const pageHtml = await res.text();
      const page = cheerio.load(pageHtml);

      // テーブルから日程を抽出
      page("table tr").each((_, tr) => {
        const cells = page(tr).find("td, th");
        if (cells.length < 2) return;

        const dateText = page(cells[0]).text().trim();
        const descText = page(cells[1]).text().trim();

        // 日付パース（例: "3月1日（月）" → "2026-03-01"）
        const dateMatch = dateText.match(/(\d+)月(\d+)日/);
        if (dateMatch) {
          const month = parseInt(dateMatch[1], 10);
          const day = parseInt(dateMatch[2], 10);
          // 年度は session 名から推定
          const yearMatch = link.session.match(/(令和\d+)年/);
          if (yearMatch) {
            const reiwaYear = parseInt(
              yearMatch[1].replace("令和", ""),
              10,
            );
            const year = 2018 + reiwaYear;
            const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            entries.push({
              date,
              type: classifyType(descText),
              session: link.session,
              description: descText,
            });
          }
        }
      });
    } catch (err) {
      log(`  Error: ${err}`);
    }
  }

  if (entries.length === 0) {
    log("No schedule entries found from scraping. Keeping existing data if available.");
    return;
  }

  entries.sort((a, b) => a.date.localeCompare(b.date));

  const output: ScheduleData = {
    sourceUrl: TARGET_URL,
    scrapedAt: new Date().toISOString(),
    entries,
  };

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  const parsed = scheduleSchema.parse(output);
  writeFileSync(OUTPUT_PATH, JSON.stringify(parsed, null, 2) + "\n", "utf-8");
  log(`Saved ${entries.length} entries to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("[scrape-schedule] Fatal error:", err);
  process.exit(1);
});
