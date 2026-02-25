import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { nameToSlug } from "./romaji";

const DATA_DIR = resolve(process.cwd(), "../data");

export interface CouncilMember {
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

export interface CouncilData {
  sourceUrl: string;
  scrapedAt: string;
  officers: CouncilMember[];
  members: CouncilMember[];
}

export interface Bill {
  number: string;
  title: string;
  result: string;
  category: string;
}

export interface SessionData {
  session: string;
  sourceUrls: string[];
  scrapedAt: string;
  dates: string[];
  bills: Bill[];
  votingRecordPdfUrl: string | null;
}

export function getCouncilMembers(): CouncilData {
  const raw = readFileSync(resolve(DATA_DIR, "council-members.json"), "utf-8");
  return JSON.parse(raw);
}

export function getAllSessions(): { slug: string; data: SessionData }[] {
  const dir = resolve(DATA_DIR, "sessions");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

  return files
    .map((f) => {
      const raw = readFileSync(resolve(dir, f), "utf-8");
      return {
        slug: f.replace(".json", ""),
        data: JSON.parse(raw) as SessionData,
      };
    })
    .sort((a, b) => b.slug.localeCompare(a.slug));
}

export interface UpdateEntry {
  date: string;
  label: string;
  title: string;
  url: string;
  firstSeenAt: string;
}

export interface UpdatesData {
  sourceUrl: string;
  lastCheckedAt: string;
  entries: UpdateEntry[];
}

export function getUpdates(): UpdatesData | null {
  try {
    const raw = readFileSync(resolve(DATA_DIR, "updates.json"), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// --- Finance ---

export interface Fund {
  name: string;
  balance: number;
  category: "一般会計" | "特別会計等";
}

export interface FundsData {
  sourceUrl: string;
  scrapedAt: string;
  asOf: string;
  funds: Fund[];
  generalTotal: number;
  specialTotal: number;
  grandTotal: number;
}

export function getFunds(): FundsData | null {
  try {
    const raw = readFileSync(
      resolve(DATA_DIR, "finance", "funds.json"),
      "utf-8",
    );
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// --- Questions ---

export interface QuestionItem {
  title: string;
  details: string[];
}

export interface MemberQuestion {
  memberName: string;
  order: number;
  items: QuestionItem[];
}

export interface QuestionsData {
  session: string;
  sessionSlug: string;
  sourceUrl: string;
  pdfUrl: string;
  scrapedAt: string;
  questions: MemberQuestion[];
}

export function getQuestionsForSession(slug: string): QuestionsData | null {
  try {
    const raw = readFileSync(
      resolve(DATA_DIR, "questions", `${slug}.json`),
      "utf-8",
    );
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function getAllQuestionSlugs(): string[] {
  try {
    const dir = resolve(DATA_DIR, "questions");
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(".json", ""));
  } catch {
    return [];
  }
}

export function getQuestionsForMember(
  memberName: string,
): { session: string; slug: string; questions: MemberQuestion }[] {
  const results: { session: string; slug: string; questions: MemberQuestion }[] = [];
  const slugs = getAllQuestionSlugs();

  for (const slug of slugs) {
    const data = getQuestionsForSession(slug);
    if (!data) continue;

    // 名前の空白を除去して比較
    const normalizedName = memberName.replace(/\s+/g, "");
    const match = data.questions.find(
      (q) => q.memberName.replace(/\s+/g, "") === normalizedName,
    );
    if (match) {
      results.push({ session: data.session, slug, questions: match });
    }
  }

  return results.sort((a, b) => b.slug.localeCompare(a.slug));
}

export { nameToSlug } from "./romaji";

export function getAllMembersWithSlugs(): { member: CouncilMember; slug: string }[] {
  const data = getCouncilMembers();
  const all = [...data.officers, ...data.members];
  return all.map((m) => ({
    member: m,
    slug: nameToSlug(m.nameReading),
  }));
}

export function getMemberBySlug(slug: string): CouncilMember | null {
  const all = getAllMembersWithSlugs();
  const found = all.find((m) => m.slug === slug);
  return found?.member ?? null;
}

// --- Tags ---

export interface TagEntry {
  type: "bill" | "question";
  sessionSlug: string;
  session: string;
  billNumber?: string;
  billTitle?: string;
  memberName?: string;
  itemTitle?: string;
  tags: string[];
}

export interface TagsData {
  generatedAt: string;
  method: "claude-api" | "rule-based";
  model?: string;
  entries: TagEntry[];
}

export function getTags(): TagsData | null {
  try {
    const raw = readFileSync(resolve(DATA_DIR, "tags.json"), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function getAllTagNames(): string[] {
  const tags = getTags();
  if (!tags) return [];
  const set = new Set<string>();
  for (const e of tags.entries) {
    for (const t of e.tags) set.add(t);
  }
  return [...set].sort();
}

export function getEntriesByTag(tag: string): TagEntry[] {
  const tags = getTags();
  if (!tags) return [];
  return tags.entries.filter((e) => e.tags.includes(tag));
}

export function getTagCounts(): { tag: string; count: number }[] {
  const tags = getTags();
  if (!tags) return [];
  const counts = new Map<string, number>();
  for (const e of tags.entries) {
    for (const t of e.tags) {
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

export function getSession(slug: string): SessionData | null {
  try {
    const raw = readFileSync(
      resolve(DATA_DIR, "sessions", `${slug}.json`),
      "utf-8",
    );
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
