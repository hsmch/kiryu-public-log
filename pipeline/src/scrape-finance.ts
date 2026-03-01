import * as cheerio from "cheerio";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fundsSchema } from "./schemas";

const SOURCE_URL =
  "https://www.city.kiryu.lg.jp/shisei/zaisei/1007004.html";
const USER_AGENT = "KiryuPublicLog/1.0 (+https://kiryu.co)";
const DATA_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../data/finance",
);

interface Fund {
  name: string;
  balance: number;
  category: "一般会計" | "特別会計等";
}

interface FundsData {
  sourceUrl: string;
  scrapedAt: string;
  asOf: string;
  funds: Fund[];
  generalTotal: number;
  specialTotal: number;
  grandTotal: number;
}

function log(msg: string) {
  console.log(`[scrape-finance] ${msg}`);
}

function parseAmount(text: string): number {
  const cleaned = text.replace(/[,、円\s]/g, "");
  const num = parseInt(cleaned, 10);
  if (isNaN(num)) {
    throw new Error(`Cannot parse amount: "${text}"`);
  }
  return num;
}

async function main() {
  log("Fetching finance page...");
  const response = await fetch(SOURCE_URL, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${SOURCE_URL}`);
  }
  const html = await response.text();
  const $ = cheerio.load(html);

  // 基準日の抽出
  const bodyText = $("#content, #main, .content, body").text();
  const asOfMatch = bodyText.match(
    /(令和\d+年\d+月\d+日)現在/,
  );
  const asOf = asOfMatch?.[1] ?? "";
  log(`As of: ${asOf}`);

  // テーブルの取得
  const tables = $("table");
  log(`Found ${tables.length} tables`);

  const funds: Fund[] = [];
  const categories: ("一般会計" | "特別会計等")[] = [
    "一般会計",
    "特別会計等",
  ];

  // h2見出しでカテゴリを判定
  const h2s = $("h2");
  const tablesByCategory: { category: "一般会計" | "特別会計等"; table: cheerio.Element }[] = [];

  for (const h2 of h2s.toArray()) {
    const h2Text = $(h2).text().trim();
    let category: "一般会計" | "特別会計等" | null = null;

    if (h2Text.includes("一般会計")) {
      category = "一般会計";
    } else if (h2Text.includes("特別会計") || h2Text.includes("定額")) {
      category = "特別会計等";
    }

    if (!category) continue;

    // h2の後のテーブルを探す
    let el = $(h2).next();
    while (el.length > 0 && el.prop("tagName")?.toLowerCase() !== "h2") {
      if (el.prop("tagName")?.toLowerCase() === "table") {
        tablesByCategory.push({ category, table: el[0]! });
        break;
      }
      el = el.next();
    }
  }

  // テーブルが見出しで見つからない場合、順番で割り当て
  if (tablesByCategory.length === 0 && tables.length >= 2) {
    tablesByCategory.push({ category: "一般会計", table: tables[0]! });
    tablesByCategory.push({ category: "特別会計等", table: tables[1]! });
  }

  for (const { category, table } of tablesByCategory) {
    const rows = $(table).find("tr");
    for (const row of rows.toArray()) {
      const cells = $(row).find("td, th");
      if (cells.length < 2) continue;

      const nameCell = cells.eq(0).text().trim();
      const amountCell = cells.eq(cells.length - 1).text().trim();

      // ヘッダー行をスキップ
      if (
        nameCell === "基金名称" ||
        nameCell === "基金名" ||
        nameCell.includes("名称") ||
        amountCell === "金額" ||
        amountCell === "残高"
      ) {
        continue;
      }

      // 空行や合計行をスキップ
      if (!nameCell || !amountCell) continue;
      if (nameCell.includes("合計") || nameCell.includes("計")) continue;

      try {
        const balance = parseAmount(amountCell);
        funds.push({ name: nameCell, balance, category });
      } catch {
        log(`  Skipping row: ${nameCell} / ${amountCell}`);
      }
    }
  }

  log(`Parsed ${funds.length} funds`);

  // 合計の計算
  const generalTotal = funds
    .filter((f) => f.category === "一般会計")
    .reduce((sum, f) => sum + f.balance, 0);
  const specialTotal = funds
    .filter((f) => f.category === "特別会計等")
    .reduce((sum, f) => sum + f.balance, 0);
  const grandTotal = generalTotal + specialTotal;

  // 合計額の検証: ページ上の合計と比較
  const grandTotalMatch = bodyText.match(
    /合計額[　\s]*([0-9,]+)円/,
  );
  if (grandTotalMatch) {
    const expectedTotal = parseAmount(grandTotalMatch[1]);
    if (expectedTotal !== grandTotal) {
      log(
        `WARNING: Calculated total ${grandTotal} != expected ${expectedTotal}`,
      );
    } else {
      log(`Total verified: ${grandTotal.toLocaleString()}円`);
    }
  }

  const data: FundsData = {
    sourceUrl: SOURCE_URL,
    scrapedAt: new Date().toISOString(),
    asOf,
    funds,
    generalTotal,
    specialTotal,
    grandTotal,
  };

  mkdirSync(DATA_DIR, { recursive: true });
  const filePath = resolve(DATA_DIR, "funds.json");
  const parsed = fundsSchema.parse(data);
  writeFileSync(filePath, JSON.stringify(parsed, null, 2) + "\n", "utf-8");
  log(`Saved to ${filePath}`);
  log(
    `Summary: ${funds.length} funds, general=${generalTotal.toLocaleString()}円, special=${specialTotal.toLocaleString()}円, total=${grandTotal.toLocaleString()}円`,
  );
}

main().catch((err) => {
  console.error("[scrape-finance] Fatal error:", err);
  process.exit(1);
});
