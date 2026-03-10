/**
 * 定例会サマリーの自動生成スクリプト
 *
 * 既存データ（sessions/, voting/, questions/, tags.json）から
 * 各定例会のサマリーを集計・構造化して JSON に出力する。
 * AI要約は使わず、純粋にデータ集計のみ行う。
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { sessionSummarySchema } from "./schemas";

const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../data");
const OUTPUT_DIR = resolve(DATA_DIR, "session-summaries");

// --- Types ---

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

interface VoteEntry {
  memberName: string;
  vote: "賛成" | "反対" | "欠席" | "議長" | "退席";
}

interface VoteRecord {
  billNumber: string;
  billTitle: string;
  result: string;
  votes: VoteEntry[];
}

interface VotingData {
  session: string;
  sessionSlug: string;
  sourceUrl: string;
  scrapedAt: string;
  records: VoteRecord[];
}

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

interface TagEntry {
  type: "bill" | "question";
  sessionSlug: string;
  session: string;
  billNumber?: string;
  billTitle?: string;
  memberName?: string;
  itemTitle?: string;
  tags: string[];
}

interface TagsData {
  generatedAt: string;
  method: string;
  entries: TagEntry[];
}

// --- Data loading ---

function loadSession(slug: string): SessionData | null {
  try {
    const raw = readFileSync(resolve(DATA_DIR, "sessions", `${slug}.json`), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function loadVoting(slug: string): VotingData | null {
  try {
    const raw = readFileSync(resolve(DATA_DIR, "voting", `${slug}.json`), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function loadQuestions(slug: string): QuestionsData | null {
  try {
    const raw = readFileSync(resolve(DATA_DIR, "questions", `${slug}.json`), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function loadTags(): TagsData | null {
  try {
    const raw = readFileSync(resolve(DATA_DIR, "tags.json"), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getAllSessionSlugs(): string[] {
  const dir = resolve(DATA_DIR, "sessions");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""))
    .sort();
}

// --- Summary generation ---

function classifyResult(result: string): string {
  if (result.includes("可決") || result.includes("採択") || result.includes("承認") || result.includes("同意") || result.includes("認定")) return "可決等";
  if (result.includes("否決") || result.includes("不採択")) return "否決等";
  if (result.includes("継続")) return "継続審査";
  if (result.includes("取り下げ")) return "取り下げ";
  return "その他";
}

function generateSummary(
  slug: string,
  session: SessionData,
  voting: VotingData | null,
  questions: QuestionsData | null,
  tagEntries: TagEntry[],
): z.infer<typeof sessionSummarySchema> {
  const bills = session.bills;

  // --- 議案数（分類別） ---
  const billsByCategory: Record<string, number> = {};
  for (const bill of bills) {
    billsByCategory[bill.category] = (billsByCategory[bill.category] || 0) + 1;
  }

  // --- 採決結果の統計 ---
  const results: Record<string, number> = {};
  for (const bill of bills) {
    const key = classifyResult(bill.result);
    results[key] = (results[key] || 0) + 1;
  }

  // --- 全会一致・賛否分裂の集計 ---
  // 投票記録には「賛否が割れた議案のみ」記録されている。
  // 投票記録にない議案は全会一致として扱う。
  // splitCount/splitBills は sessions データに存在する議案のみを対象とし、
  // totalBills と母集団を揃える。
  const splitBills: { number: string; title: string; result: string; yesCount: number; noCount: number }[] = [];

  if (voting) {
    for (const record of voting.records) {
      // billNumber で sessions データを検索、見つからなければ billTitle で逆引き
      let matchingBill = bills.find((b) => b.number === record.billNumber);
      if (!matchingBill && record.billTitle) {
        matchingBill = bills.find((b) => b.title === record.billTitle);
        if (matchingBill) {
          console.warn(`  [warn] ${slug}: 投票記録の議案 ${record.billNumber} を billTitle で sessions の ${matchingBill.number} にマッチ`);
        }
      }
      if (!matchingBill) {
        console.warn(`  [warn] ${slug}: 投票記録の議案 ${record.billNumber} が sessions データに存在しません（スキップ）`);
        continue;
      }

      const votable = record.votes.filter((v) => v.vote !== "議長");
      const hasYes = votable.some((v) => v.vote === "賛成");
      const hasNo = votable.some((v) => v.vote === "反対");
      if (hasYes && hasNo) {
        splitBills.push({
          number: matchingBill.number,
          title: record.billTitle || matchingBill.title,
          result: matchingBill.result,
          yesCount: votable.filter((v) => v.vote === "賛成").length,
          noCount: votable.filter((v) => v.vote === "反対").length,
        });
      }
    }
  }

  const splitCount = splitBills.length;

  // 全会一致の算出: sessions の採決済み議案のうち、賛否分裂でなかったもの
  const votedBillCount = bills.filter((b) => {
    const cls = classifyResult(b.result);
    return cls === "可決等" || cls === "否決等";
  }).length;
  const unanimousCount = Math.max(0, votedBillCount - splitCount);

  // --- 主要テーマ（タグ頻度分析） ---
  const tagCounts = new Map<string, number>();
  for (const entry of tagEntries) {
    for (const tag of entry.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }
  const topThemes = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag]) => tag);

  // --- 一般質問トピック ---
  const questionTopics: { member: string; topics: string[] }[] = [];
  if (questions) {
    for (const mq of questions.questions) {
      questionTopics.push({
        member: mq.memberName,
        topics: mq.items.map((item) => item.title),
      });
    }
  }

  return {
    sessionId: slug,
    sessionName: session.session,
    generatedAt: new Date().toISOString(),
    totalBills: bills.length,
    billsByCategory,
    results,
    unanimousCount,
    splitCount,
    splitBills,
    topThemes,
    questions: questionTopics,
  };
}

// --- Main ---

function main() {
  console.log("=== 定例会サマリー生成 ===");

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const tags = loadTags();
  const slugs = getAllSessionSlugs();

  let generated = 0;
  let skipped = 0;

  for (const slug of slugs) {
    const session = loadSession(slug);
    if (!session) {
      console.warn(`  [skip] ${slug}: session data not found`);
      skipped++;
      continue;
    }

    const voting = loadVoting(slug);
    const questions = loadQuestions(slug);
    const tagEntries = tags?.entries.filter((e) => e.sessionSlug === slug) ?? [];

    const summary = generateSummary(slug, session, voting, questions, tagEntries);

    // Validate with schema
    const validated = sessionSummarySchema.parse(summary);

    const outputPath = resolve(OUTPUT_DIR, `${slug}.json`);
    writeFileSync(outputPath, JSON.stringify(validated, null, 2) + "\n");
    generated++;
  }

  console.log(`\n完了: ${generated}件生成, ${skipped}件スキップ`);
}

main();
