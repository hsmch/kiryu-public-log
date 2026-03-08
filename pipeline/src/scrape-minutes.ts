import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { minutesDataSchema } from "./schemas";

const API_BASE = "https://ssp.kaigiroku.net/dnp/search";
const TENANT_ID = "74";
const USER_AGENT = "KiryuPublicLog/1.0 (+https://kiryu.co)";
const REFERER = "https://ssp.kaigiroku.net/tenant/kiryu/MinuteView.html";
const DATA_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../data/minutes",
);
const REQUEST_INTERVAL_MS = 1000;

interface ApiCouncil {
  council_id: number;
  name: string;
}

interface ApiCouncilType {
  councils: ApiCouncil[];
}

interface ApiViewYear {
  view_year: number;
  japanese_year: string;
  council_type: ApiCouncilType[];
}

interface ApiSchedule {
  schedule_id: number;
  name: string;
  page_no: number;
}

interface ApiMinute {
  minute_id: number;
  title: string;
  page_no: number;
  minute_type: string;
  minute_type_code: number;
  body: string;
}

interface Speech {
  id: number;
  type: string;
  typeCode: number;
  speaker: string | null;
  role: string | null;
  body: string;
}

interface Schedule {
  scheduleId: number;
  name: string;
  speeches: Speech[];
}

interface MinutesData {
  session: string;
  councilId: number;
  sourceUrl: string;
  scrapedAt: string;
  schedules: Schedule[];
}

function log(msg: string) {
  console.log(`[scrape-minutes] ${msg}`);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * JSONP レスポンスからJSONを抽出
 * "cb({...})" → {...}
 */
function parseJsonp(text: string): unknown {
  const match = text.match(/^[^(]*\((.+)\)\s*;?\s*$/s);
  if (!match) {
    throw new Error("Failed to parse JSONP response");
  }
  return JSON.parse(match[1]);
}

/**
 * API に POST リクエストを送信
 */
async function apiPost(endpoint: string, params: Record<string, string>): Promise<unknown> {
  const url = `${API_BASE}${endpoint}`;
  const body = new URLSearchParams({
    ...params,
    tenant_id: TENANT_ID,
    power_user: "false",
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded",
      "Referer": REFERER,
    },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  const text = await response.text();
  return parseJsonp(text);
}

/**
 * 会議一覧を取得
 */
async function fetchCouncils(): Promise<{ councilId: number; name: string }[]> {
  const data = await apiPost("/councils/index?callback=cb", {}) as {
    councils: [{ view_years: ApiViewYear[] }];
  };

  const results: { councilId: number; name: string }[] = [];

  for (const viewYear of data.councils[0].view_years) {
    for (const councilType of viewYear.council_type) {
      for (const council of councilType.councils) {
        results.push({
          councilId: council.council_id,
          name: council.name,
        });
      }
    }
  }

  return results;
}

/**
 * 日程一覧を取得
 */
async function fetchSchedules(councilId: number): Promise<ApiSchedule[]> {
  const data = await apiPost("/minutes/get_schedule?callback=cb", {
    council_id: String(councilId),
  }) as { council_schedules: ApiSchedule[] };

  return data.council_schedules;
}

/**
 * 議事録本文を取得
 */
async function fetchMinutes(councilId: number, scheduleId: number): Promise<ApiMinute[]> {
  const data = await apiPost("/minutes/get_minute?callback=cb", {
    council_id: String(councilId),
    schedule_id: String(scheduleId),
  }) as { tenant_minutes: ApiMinute[] };

  return data.tenant_minutes;
}

/**
 * HTML タグを除去してプレーンテキストにする
 */
function stripHtml(html: string): string {
  return html
    .replace(/<\/?(?:pre|PRE|tt|TT|font|FONT)[^>]*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "");
}

/**
 * title フィールドから speaker と role を抽出
 * "議長（人見武男）" → { speaker: "人見武男", role: "議長" }
 * "11番（近藤芽衣）" → { speaker: "近藤芽衣", role: "11番" }
 * "（名簿）" → { speaker: null, role: null }
 * "開議" → { speaker: null, role: null }
 */
function parseSpeaker(title: string): { speaker: string | null; role: string | null } {
  // "（名簿）" パターン
  if (title === "（名簿）" || title === "(名簿)") {
    return { speaker: null, role: null };
  }

  // "役職（氏名）" パターン
  const match = title.match(/^(.+?)(?:[（(])(.+?)(?:[）)])$/);
  if (match) {
    const role = match[1].trim();
    const speaker = match[2].trim();
    return { speaker, role };
  }

  // 役職・名前のない議題系（"開議", "日程第１" 等）
  return { speaker: null, role: null };
}

/**
 * minute_type から発言タイプを抽出
 * "○議長" → "議長", "◆質問" → "質問", "名簿" → "名簿"
 */
function parseMinuteType(minuteType: string): string {
  // 先頭の記号を除去
  return minuteType.replace(/^[○◎◆△▲●■□▽☆★※＊]+/, "").trim();
}

/**
 * body から先頭の発言者プレフィックスを除去
 * "○議長（人見武男）　本日の会議を..." → "本日の会議を..."
 */
function stripSpeakerPrefix(body: string): string {
  // 先頭の記号＋役職（氏名）＋全角スペース パターンを除去
  const stripped = body.replace(
    /^[○◎◆△▲●■□▽☆★※＊]*[^（(）)\s]*(?:[（(][^）)]+[）)])?[\s\u3000]*/,
    "",
  );
  return stripped;
}

/**
 * 会議名が定例会 or 臨時会の本会議かどうか判定
 * "令和　７年　１２月定例会（第４回）" → true
 * "予算特別委員会" → false
 */
function isHonkaigi(name: string): boolean {
  const normalized = name
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFF10 + 0x30))
    .replace(/[\s\u3000]+/g, "");
  return /(?:定例会|臨時会)(?:[（(]第\d+回[）)])?$/.test(normalized);
}

/**
 * 会議名からスラグを生成
 * "令和　７年　１２月定例会（第４回）" → "r7-4-teireikai"
 * "平成３０年　　６月定例会（第２回）" → "h30-2-teireikai"
 * "令和元年　　３月臨時会（第１回）" → "r1-1-rinjikai"
 * "平成３１年/令和元年　　３月定例会（第１回）" → "r1-1-teireikai"
 */
function councilNameToSlug(name: string): string {
  // 全角数字→半角数字、空白除去
  const normalized = name
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFF10 + 0x30))
    .replace(/[\s\u3000]+/g, "");

  // "平成31年/令和元年" → 令和元年として扱う
  let era: string;
  let year: string;

  if (/令和元年/.test(normalized)) {
    era = "r";
    year = "1";
  } else {
    const eraMatch = normalized.match(/(令和|平成)(\d+)年/);
    if (!eraMatch) {
      throw new Error(`Cannot parse era from council name: ${name}`);
    }
    era = eraMatch[1] === "令和" ? "r" : "h";
    year = eraMatch[2];
  }

  const numMatch = normalized.match(/第(\d+)回/);
  const num = numMatch?.[1] ?? "0";
  const type = normalized.includes("臨時会") ? "rinjikai" : "teireikai";

  return `${era}${year}-${num}-${type}`;
}

/**
 * 会議名を正規化（表示用）
 * "令和　７年　１２月定例会（第４回）" → "令和7年第4回定例会"
 */
function normalizeSessionName(name: string): string {
  const normalized = name
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFF10 + 0x30))
    .replace(/[\s\u3000]+/g, "");

  let era: string;
  let year: string;

  if (/令和元年/.test(normalized)) {
    era = "令和";
    year = "1";
  } else if (/平成31年\/令和元年/.test(normalized)) {
    era = "令和";
    year = "1";
  } else {
    const eraMatch = normalized.match(/(令和|平成)(\d+)年/);
    if (!eraMatch) return name;
    era = eraMatch[1];
    year = eraMatch[2];
  }

  const numMatch = normalized.match(/第(\d+)回/);
  const num = numMatch?.[1] ?? "0";
  const type = normalized.includes("臨時会") ? "臨時会" : "定例会";

  return `${era}${year}年第${num}回${type}`;
}

async function main() {
  log("Fetching council list...");
  const councils = await fetchCouncils();
  log(`Found ${councils.length} councils`);

  // 定例会・臨時会の本会議のみフィルタ
  const honkaigi = councils.filter((c) => isHonkaigi(c.name));
  log(`Filtered to ${honkaigi.length} plenary sessions`);

  mkdirSync(DATA_DIR, { recursive: true });

  let totalSessions = 0;
  let totalSpeeches = 0;
  let skipCount = 0;

  for (const council of honkaigi) {
    const slug = councilNameToSlug(council.name);
    const filePath = resolve(DATA_DIR, `${slug}.json`);

    // 差分実行: 既存ファイルはスキップ
    if (existsSync(filePath)) {
      try {
        const existing = JSON.parse(readFileSync(filePath, "utf-8"));
        if (existing.schedules && existing.schedules.length > 0) {
          const speechCount = existing.schedules.reduce(
            (sum: number, s: { speeches: unknown[] }) => sum + s.speeches.length,
            0,
          );
          if (speechCount > 0) {
            log(`Skip: ${slug} (${speechCount} speeches)`);
            skipCount++;
            continue;
          }
        }
      } catch {
        // file is corrupt, re-scrape
      }
    }

    log(`Fetching schedules for: ${council.name} (id=${council.councilId})`);
    await sleep(REQUEST_INTERVAL_MS);
    const apiSchedules = await fetchSchedules(council.councilId);
    log(`  Found ${apiSchedules.length} schedules`);

    const schedules: Schedule[] = [];

    for (const apiSchedule of apiSchedules) {
      log(`  Fetching minutes: ${apiSchedule.name}`);
      await sleep(REQUEST_INTERVAL_MS);
      const minutes = await fetchMinutes(council.councilId, apiSchedule.schedule_id);

      const speeches: Speech[] = minutes.map((m) => {
        const { speaker, role } = parseSpeaker(m.title);
        const rawBody = stripHtml(m.body);
        const body = speaker ? stripSpeakerPrefix(rawBody) : rawBody;

        return {
          id: m.minute_id,
          type: parseMinuteType(m.minute_type),
          typeCode: m.minute_type_code,
          speaker,
          role,
          body: body.trim(),
        };
      });

      schedules.push({
        scheduleId: apiSchedule.schedule_id,
        name: apiSchedule.name,
        speeches,
      });
    }

    const sessionName = normalizeSessionName(council.name);
    const firstScheduleId = apiSchedules[0]?.schedule_id ?? 0;
    const sourceUrl = `https://ssp.kaigiroku.net/tenant/kiryu/MinuteView.html?council_id=${council.councilId}&schedule_id=${firstScheduleId}`;

    const minutesData: MinutesData = {
      session: sessionName,
      councilId: council.councilId,
      sourceUrl,
      scrapedAt: new Date().toISOString(),
      schedules,
    };

    const parsed = minutesDataSchema.parse(minutesData);
    writeFileSync(filePath, JSON.stringify(parsed, null, 2) + "\n", "utf-8");

    const speechCount = schedules.reduce((sum, s) => sum + s.speeches.length, 0);
    log(`  → ${speechCount} speeches in ${schedules.length} schedules → ${slug}.json`);

    totalSessions++;
    totalSpeeches += speechCount;
  }

  log(`Done: ${totalSessions} new, ${skipCount} skipped, ${totalSpeeches} speeches total`);
}

main().catch((err) => {
  console.error("[scrape-minutes] Fatal error:", err);
  process.exit(1);
});
