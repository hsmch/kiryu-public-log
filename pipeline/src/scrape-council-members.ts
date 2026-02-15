import * as cheerio from "cheerio";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const TARGET_URL =
  "https://www.city.kiryu.lg.jp/shigikai/about/1003765.html";
const USER_AGENT = "KiryuPublicLog/1.0 (+https://kiryu.co)";
const OUTPUT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../data/council-members.json",
);

interface CouncilMember {
  seatNumber: number | null;
  name: string;
  nameReading: string;
  faction: string;
  committee: string;
  committeeRole: string | null;
  role: string | null;
  electionCount: number | null;
  photoUrl: string | null;
}

interface OutputData {
  sourceUrl: string;
  scrapedAt: string;
  officers: CouncilMember[];
  members: CouncilMember[];
}

function log(msg: string) {
  console.log(`[scrape-council-members] ${msg}`);
}

function resolveUrl(relative: string): string {
  try {
    return new URL(relative, TARGET_URL).href;
  } catch {
    return relative;
  }
}

function parseName(raw: string): { name: string; reading: string } {
  const match = raw.match(/^(.+?)\s*[（(](.+?)[）)]\s*$/);
  if (match) {
    return { name: match[1].trim(), reading: match[2].trim() };
  }
  return { name: raw.trim(), reading: "" };
}

function parseCommittee(raw: string): {
  committee: string;
  committeeRole: string | null;
} {
  const match = raw.match(/^(.+?)\s*[（(](.+?)[）)]\s*$/);
  if (match) {
    return { committee: match[1].trim(), committeeRole: match[2].trim() };
  }
  return { committee: raw.trim(), committeeRole: null };
}

/**
 * <strong>ラベル</strong>値 の形式から、ラベルに対応する値を取り出す。
 * 1つの <p> 内に <br> 区切りで複数行ある構造。
 * cheerio の html() から <br> で分割し、各行のテキストを処理する。
 */
function extractFieldFromLines(
  lines: string[],
  label: string,
): string | null {
  for (const line of lines) {
    if (line.includes(label)) {
      // strong タグ等を除去してテキストだけにする
      const text = line
        .replace(/<[^>]+>/g, "")
        .replace(label, "")
        .replace(/^[\s\u3000]+/, "")
        .trim();
      return text || null;
    }
  }
  return null;
}

function splitByBr(html: string): string[] {
  return html.split(/<br\s*\/?\s*>/i).map((s) => s.trim()).filter(Boolean);
}

function parseOfficers(
  $: cheerio.CheerioAPI,
  startH2: cheerio.Element,
): CouncilMember[] {
  const officers: CouncilMember[] = [];

  // h2 の後の兄弟要素を次の h2 まで走査
  let el = $(startH2).next();
  let currentPhoto: string | null = null;
  let currentRole: string | null = null;

  while (el.length > 0 && el.prop("tagName")?.toLowerCase() !== "h2") {
    const tag = el.prop("tagName")?.toLowerCase();

    if (tag === "p" && el.hasClass("imageleft")) {
      currentPhoto = resolveUrl(el.find("img").attr("src") ?? "");
    } else if (tag === "p" && el.find("strong").length > 0) {
      const text = el.text().trim();

      // "議長" or "副議長" のロールラベル
      if (/^(議長|副議長)$/.test(text)) {
        currentRole = text;
      }

      // "氏名" フィールド
      if (text.includes("氏名")) {
        const nameRaw = text.replace(/氏名/, "").replace(/^[\s\u3000]+/, "").trim();
        const { name, reading } = parseName(nameRaw);
        officers.push({
          seatNumber: null,
          name,
          nameReading: reading,
          faction: "",
          committee: "",
          committeeRole: null,
          role: currentRole,
          electionCount: null,
          photoUrl: currentPhoto,
        });
        currentPhoto = null;
        currentRole = null;
      }
    }

    el = el.next();
  }

  return officers;
}

function parseMembers(
  $: cheerio.CheerioAPI,
  startH2: cheerio.Element,
): CouncilMember[] {
  const members: CouncilMember[] = [];

  // h2 の後のh3を見つけ、各 h3 〜 次の h3/h2 間を処理
  let el = $(startH2).next();

  while (el.length > 0) {
    const tag = el.prop("tagName")?.toLowerCase();

    // セクション終了
    if (tag === "h2") break;

    if (tag === "h3") {
      // h3 の次の兄弟から次の h3/h2 まで集める
      let photoUrl: string | null = null;
      let dataHtml: string | null = null;
      let sibling = el.next();

      while (
        sibling.length > 0 &&
        sibling.prop("tagName")?.toLowerCase() !== "h3" &&
        sibling.prop("tagName")?.toLowerCase() !== "h2"
      ) {
        const sibTag = sibling.prop("tagName")?.toLowerCase();

        if (sibTag === "p" && sibling.hasClass("imageleft")) {
          photoUrl = resolveUrl(sibling.find("img").attr("src") ?? "");
        } else if (sibTag === "p" && sibling.find("strong").length > 0) {
          dataHtml = sibling.html() ?? "";
        }

        sibling = sibling.next();
      }

      if (dataHtml) {
        const lines = splitByBr(dataHtml);

        const nameRaw = extractFieldFromLines(lines, "氏名") ?? "";
        const { name, reading } = parseName(nameRaw);

        const seatRaw = extractFieldFromLines(lines, "議席番号");
        const seatMatch = seatRaw?.match(/(\d+)/);
        const seatNumber = seatMatch ? parseInt(seatMatch[1], 10) : null;

        const committeeRaw =
          extractFieldFromLines(lines, "常任委員会") ?? "";
        const { committee, committeeRole } = parseCommittee(committeeRaw);

        const faction = extractFieldFromLines(lines, "会派") ?? "";

        const electionRaw =
          extractFieldFromLines(lines, "当選回数") ?? "";
        const electionMatch = electionRaw.match(/(\d+)/);
        const electionCount = electionMatch
          ? parseInt(electionMatch[1], 10)
          : null;

        members.push({
          seatNumber,
          name,
          nameReading: reading,
          faction,
          committee,
          committeeRole,
          role: null,
          electionCount,
          photoUrl,
        });
      }

      // sibling まで進める (次のh3の手前)
      el = el.next();
      continue;
    }

    el = el.next();
  }

  return members;
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

  let officers: CouncilMember[] = [];
  let members: CouncilMember[] = [];

  $("h2").each((_, h2) => {
    const text = $(h2).text();
    if (text.includes("議長") && text.includes("副議長")) {
      officers = parseOfficers($, h2);
    } else if (text.includes("議員名簿")) {
      members = parseMembers($, h2);
    }
  });

  log(`Found ${officers.length} officers`);
  log(`Found ${members.length} members`);

  if (officers.length === 0 && members.length === 0) {
    throw new Error(
      "No council members found. HTML structure may have changed.",
    );
  }

  const output: OutputData = {
    sourceUrl: TARGET_URL,
    scrapedAt: new Date().toISOString(),
    officers,
    members,
  };

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + "\n", "utf-8");
  log(`Saved ${officers.length + members.length} members to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("[scrape-council-members] Fatal error:", err);
  process.exit(1);
});
