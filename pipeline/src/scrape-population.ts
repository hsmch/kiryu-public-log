import * as cheerio from "cheerio";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CURRENT_URL =
  "https://www.city.kiryu.lg.jp/shisei/1018369/toukei/index.html";
const HISTORY_URL =
  "https://www.city.kiryu.lg.jp/shisei/1018369/toukei/1003178.html";
const USER_AGENT = "KiryuPublicLog/1.0 (+https://kiryu.co)";
const OUTPUT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../data/population.json",
);

interface PopulationEntry {
  year: number;
  population: number;
  households: number;
  source: string;
}

interface PopulationData {
  city: "桐生市";
  sourceUrl: string;
  scrapedAt: string;
  current: {
    population: number;
    households: number;
    asOf: string;
  };
  history: PopulationEntry[];
}

function log(msg: string) {
  console.log(`[scrape-population] ${msg}`);
}

function parseNumber(text: string): number {
  const cleaned = text.replace(/[,、人世帯\s]/g, "");
  const num = parseInt(cleaned, 10);
  if (isNaN(num)) {
    throw new Error(`Cannot parse number: "${text}"`);
  }
  return num;
}

function convertJapaneseYear(text: string): number | null {
  const match = text.match(/(大正|昭和|平成|令和)(\d+)年/);
  if (!match) return null;
  const era = match[1];
  const eraYear = parseInt(match[2]!, 10);
  switch (era) {
    case "大正":
      return 1911 + eraYear;
    case "昭和":
      return 1925 + eraYear;
    case "平成":
      return 1988 + eraYear;
    case "令和":
      return 2018 + eraYear;
    default:
      return null;
  }
}

async function fetchCurrentPopulation(): Promise<{
  population: number;
  households: number;
  asOf: string;
} | null> {
  log("Fetching current population...");
  try {
    const response = await fetch(CURRENT_URL, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!response.ok) {
      log(`HTTP ${response.status} for current population page`);
      return null;
    }
    const html = await response.text();
    const $ = cheerio.load(html);
    const bodyText = $("body").text();

    const popMatch = bodyText.match(/人口総数[\s]*([0-9,]+)人/);
    const hhMatch = bodyText.match(/世帯数[\s]*([0-9,]+)世帯/);
    const dateMatch = bodyText.match(/(令和\d+年\d+月末?)/);

    if (popMatch && hhMatch) {
      return {
        population: parseNumber(popMatch[1]!),
        households: parseNumber(hhMatch[1]!),
        asOf: dateMatch?.[1] ?? "",
      };
    }

    const tables = $("table");
    for (const table of tables.toArray()) {
      const rows = $(table).find("tr");
      for (const row of rows.toArray()) {
        const cells = $(row).find("td, th");
        const firstCell = cells.eq(0).text().trim();
        if (firstCell.includes("合計") || firstCell.includes("計")) {
          const cellTexts: string[] = [];
          cells.each((_, el) => cellTexts.push($(el).text().trim()));
          if (cellTexts.length >= 4) {
            const population = parseNumber(
              cellTexts[3] ?? cellTexts[cellTexts.length - 2]!,
            );
            const households = parseNumber(cellTexts[cellTexts.length - 1]!);
            return { population, households, asOf: dateMatch?.[1] ?? "" };
          }
        }
      }
    }
    return null;
  } catch (err) {
    log(`Error fetching current population: ${err}`);
    return null;
  }
}

async function fetchHistoricalPopulation(): Promise<PopulationEntry[]> {
  log("Fetching historical population data...");
  try {
    const response = await fetch(HISTORY_URL, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!response.ok) {
      log(`HTTP ${response.status} for history page`);
      return [];
    }
    const html = await response.text();
    const $ = cheerio.load(html);
    const entries: PopulationEntry[] = [];
    const tables = $("table");

    for (const table of tables.toArray()) {
      const rows = $(table).find("tr");
      for (const row of rows.toArray()) {
        const cells = $(row).find("td, th");
        if (cells.length < 3) continue;
        const firstCell = cells.eq(0).text().trim();
        const year = convertJapaneseYear(firstCell);
        if (!year) continue;
        const cellTexts: string[] = [];
        cells.each((_, el) => cellTexts.push($(el).text().trim()));
        try {
          let population: number;
          let households: number;
          if (cellTexts.length >= 5) {
            population = parseNumber(cellTexts[3]!);
            households = parseNumber(cellTexts[4]!);
          } else if (cellTexts.length >= 3) {
            population = parseNumber(cellTexts[1]!);
            households = parseNumber(cellTexts[2]!);
          } else {
            continue;
          }
          entries.push({ year, population, households, source: "国勢調査" });
        } catch {
          // skip unparseable rows
        }
      }
    }
    return entries.sort((a, b) => a.year - b.year);
  } catch (err) {
    log(`Error fetching history: ${err}`);
    return [];
  }
}

async function main() {
  const current = await fetchCurrentPopulation();
  const history = await fetchHistoricalPopulation();

  if (!current && history.length === 0) {
    throw new Error("No population data could be fetched");
  }

  const data: PopulationData = {
    city: "桐生市",
    sourceUrl: HISTORY_URL,
    scrapedAt: new Date().toISOString(),
    current: current ?? { population: 0, households: 0, asOf: "" },
    history,
  };

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(data, null, 2) + "\n", "utf-8");
  log(`Saved to ${OUTPUT_PATH}`);
  log(
    `Summary: current=${data.current.population.toLocaleString()}, history=${history.length} entries`,
  );
}

main().catch((err) => {
  console.error("[scrape-population] Fatal error:", err);
  process.exit(1);
});
