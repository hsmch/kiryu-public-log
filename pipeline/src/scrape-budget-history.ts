/**
 * 桐生市 財政状況経年データの取得スクリプト
 *
 * 群馬県「市町村財政状況資料集」（Excel）から桐生市の経年データを抽出する。
 * Excel ファイルはセル結合が多く列位置が年度ごとに変わりうるため、
 * 値検索ベースで必要なセルを特定する。
 *
 * データソース:
 *   - R5: https://www.pref.gunma.jp/uploaded/attachment/677288.xlsx
 *   - R4: https://www.pref.gunma.jp/uploaded/attachment/642005.xlsx
 *
 * 使い方: npm run scrape:budget-history
 * 更新頻度: 年1回（決算確定後）
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../data");
const OUTPUT_PATH = resolve(DATA_DIR, "finance", "budget-history.json");

interface BudgetHistoryEntry {
  fiscalYear: string; // e.g. "R05", "R04"
  fiscalYearLabel: string; // e.g. "令和5年度"
  revenue: number; // 歳入決算額（千円）
  expenditure: number; // 歳出決算額（千円）
  ordinaryBalanceRatio: number; // 経常収支比率（%）
  fiscalStrengthIndex: number; // 財政力指数
  debtServiceRatio: number; // 実質公債費比率（%）
  fundBalance: number; // 基金残高合計（百万円）
}

interface BudgetHistoryData {
  sourceUrl: string;
  scrapedAt: string;
  note: string;
  entries: BudgetHistoryEntry[];
}

// Excel download URLs for each fiscal year file
const EXCEL_SOURCES = [
  {
    url: "https://www.pref.gunma.jp/uploaded/attachment/677288.xlsx",
    label: "令和5年度",
  },
  {
    url: "https://www.pref.gunma.jp/uploaded/attachment/642005.xlsx",
    label: "令和4年度",
  },
];

function log(msg: string) {
  console.log(`[scrape-budget-history] ${msg}`);
}

async function fetchExcel(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

type WS = XLSX.WorkSheet;

function getCell(ws: WS, r: number, c: number): unknown {
  const cell = ws[XLSX.utils.encode_cell({ r, c })];
  return cell ? cell.v : null;
}

function findCellValue(
  ws: WS,
  value: unknown,
  maxRow = 20,
  maxCol = 120,
): { r: number; c: number } | null {
  const range = XLSX.utils.decode_range(ws["!ref"]!);
  for (let r = 0; r <= Math.min(maxRow, range.e.r); r++) {
    for (let c = 0; c <= Math.min(maxCol, range.e.c); c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.v === value) return { r, c };
    }
  }
  return null;
}

function extractFromExcel(buf: Buffer): {
  current: BudgetHistoryEntry;
  previous: BudgetHistoryEntry;
} {
  const wb = XLSX.read(buf);
  const ws = wb.Sheets["総括表"];
  const ds = wb.Sheets["データシート"];

  // Find revenue cell position by searching for known header pattern
  // Row 3 has 歳入総額, and the value is 8 cols to the right of the year label
  // The year label at row 2 contains "年度(千円)"

  // Find year columns by searching for label pattern
  const range = XLSX.utils.decode_range(ws["!ref"]!);
  let curYearCol = -1;
  let prevYearCol = -1;
  let curYearLabel = "";
  let prevYearLabel = "";

  for (let c = 50; c <= Math.min(80, range.e.c); c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: 2, c })];
    if (cell && typeof cell.v === "string" && cell.v.includes("年度(千円)")) {
      if (curYearCol === -1) {
        curYearCol = c;
        curYearLabel = cell.v.replace("(千円)", "").trim();
      } else if (prevYearCol === -1) {
        prevYearCol = c;
        prevYearLabel = cell.v.replace("(千円)", "").trim();
      }
    }
  }

  // Find ratio columns similarly
  let curRatioCol = -1;
  let prevRatioCol = -1;

  for (let c = 80; c <= Math.min(120, range.e.c); c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: 2, c })];
    if (
      cell &&
      typeof cell.v === "string" &&
      cell.v.includes("年度(千円･％)")
    ) {
      if (curRatioCol === -1) {
        curRatioCol = c;
      } else if (prevRatioCol === -1) {
        prevRatioCol = c;
      }
    }
  }

  function yearLabelToCode(label: string): string {
    const m = label.match(/令和(\d+)/);
    if (m) return `R${m[1].padStart(2, "0")}`;
    const m2 = label.match(/平成(\d+)/);
    if (m2) return `H${m2[1].padStart(2, "0")}`;
    return label;
  }

  // Extract fund data from データシート
  // Row 70: year headers, Row 71-73: fund data
  const fundYears: string[] = [];
  for (let c = 1; c <= 5; c++) {
    const v = getCell(ds, 70, c);
    if (v) fundYears.push(String(v));
  }

  function getFundTotal(yearCode: string): number {
    const idx = fundYears.indexOf(yearCode);
    if (idx === -1) return 0;
    const c = idx + 1;
    const a = Number(getCell(ds, 71, c)) || 0;
    const b = Number(getCell(ds, 72, c)) || 0;
    const d = Number(getCell(ds, 73, c)) || 0;
    return a + b + d;
  }

  const curCode = yearLabelToCode(curYearLabel);
  const prevCode = yearLabelToCode(prevYearLabel);

  const current: BudgetHistoryEntry = {
    fiscalYear: curCode,
    fiscalYearLabel: curYearLabel,
    revenue: Number(getCell(ws, 3, curYearCol)) || 0,
    expenditure: Number(getCell(ws, 4, curYearCol)) || 0,
    ordinaryBalanceRatio: Number(getCell(ws, 4, curRatioCol)) || 0,
    fiscalStrengthIndex: Number(getCell(ws, 7, curRatioCol)) || 0,
    debtServiceRatio: Number(getCell(ws, 12, curRatioCol)) || 0,
    fundBalance: getFundTotal(curCode),
  };

  const previous: BudgetHistoryEntry = {
    fiscalYear: prevCode,
    fiscalYearLabel: prevYearLabel,
    revenue: Number(getCell(ws, 3, prevYearCol)) || 0,
    expenditure: Number(getCell(ws, 4, prevYearCol)) || 0,
    ordinaryBalanceRatio: Number(getCell(ws, 4, prevRatioCol)) || 0,
    fiscalStrengthIndex: Number(getCell(ws, 7, prevRatioCol)) || 0,
    debtServiceRatio: Number(getCell(ws, 12, prevRatioCol)) || 0,
    fundBalance: getFundTotal(prevCode),
  };

  return { current, previous };
}

async function main() {
  log("Starting budget history scrape...");

  const allEntries = new Map<string, BudgetHistoryEntry>();

  for (const source of EXCEL_SOURCES) {
    log(`Downloading: ${source.label} (${source.url})`);
    const buf = await fetchExcel(source.url);
    const { current, previous } = extractFromExcel(buf);

    // Use current year data (more authoritative from its own file)
    if (!allEntries.has(current.fiscalYear)) {
      allEntries.set(current.fiscalYear, current);
      log(
        `  ${current.fiscalYearLabel}: 歳入${(current.revenue / 1000000).toFixed(0)}百万円, 歳出${(current.expenditure / 1000000).toFixed(0)}百万円`,
      );
    }
    if (!allEntries.has(previous.fiscalYear)) {
      allEntries.set(previous.fiscalYear, previous);
      log(
        `  ${previous.fiscalYearLabel}: 歳入${(previous.revenue / 1000000).toFixed(0)}百万円, 歳出${(previous.expenditure / 1000000).toFixed(0)}百万円`,
      );
    }
  }

  // Sort by fiscal year
  const entries = [...allEntries.values()].sort((a, b) =>
    a.fiscalYear.localeCompare(b.fiscalYear),
  );

  const output: BudgetHistoryData = {
    sourceUrl:
      "https://www.pref.gunma.jp/site/shichousonzai/636041.html",
    scrapedAt: new Date().toISOString(),
    note: "群馬県「市町村財政状況資料集」より。金額は千円単位、基金残高は百万円単位。",
    entries,
  };

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(output, null, 2) + "\n",
    "utf-8",
  );
  log(`Saved ${entries.length} entries to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("[scrape-budget-history] Fatal error:", err);
  process.exit(1);
});
