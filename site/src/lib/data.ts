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

// --- Population ---

export interface PopulationEntry {
  year: number;
  month?: number;
  population: number;
  households: number;
  source: string;
}

export interface PopulationData {
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

export function getPopulation(): PopulationData | null {
  try {
    const raw = readFileSync(resolve(DATA_DIR, "population.json"), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// --- Budget ---

export interface BudgetItem {
  category: string;
  amount: number;
  ratio?: number;
}

export interface BudgetData {
  fiscalYear: string;
  sourceUrl: string;
  scrapedAt: string;
  generalAccount: {
    total: number;
    revenue: BudgetItem[];
    expenditure: BudgetItem[];
  };
}

export function getBudget(): BudgetData | null {
  try {
    const raw = readFileSync(
      resolve(DATA_DIR, "finance", "budget.json"),
      "utf-8",
    );
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// --- Budget History ---

export interface BudgetHistoryEntry {
  fiscalYear: string;
  fiscalYearLabel: string;
  revenue: number;
  expenditure: number;
  ordinaryBalanceRatio: number;
  fiscalStrengthIndex: number;
  debtServiceRatio: number;
  fundBalance: number;
}

export interface BudgetHistoryData {
  sourceUrl: string;
  scrapedAt: string;
  note: string;
  entries: BudgetHistoryEntry[];
}

export function getBudgetHistory(): BudgetHistoryData | null {
  try {
    const raw = readFileSync(
      resolve(DATA_DIR, "finance", "budget-history.json"),
      "utf-8",
    );
    return JSON.parse(raw);
  } catch {
    return null;
  }
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

// --- Voting Records ---

export interface VoteRecord {
  billNumber: string;
  billTitle: string;
  result: string;
  votes: {
    memberName: string;
    vote: "賛成" | "反対" | "欠席" | "議長" | "退席";
  }[];
}

export interface VotingData {
  session: string;
  sessionSlug: string;
  sourceUrl: string;
  scrapedAt: string;
  records: VoteRecord[];
}

export function getVotingForSession(slug: string): VotingData | null {
  try {
    const raw = readFileSync(
      resolve(DATA_DIR, "voting", `${slug}.json`),
      "utf-8",
    );
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function getAllVotingSlugs(): string[] {
  try {
    const dir = resolve(DATA_DIR, "voting");
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(".json", ""));
  } catch {
    return [];
  }
}

export interface MemberVotingSummary {
  session: string;
  sessionSlug: string;
  billNumber: string;
  billTitle: string;
  result: string;
  vote: "賛成" | "反対" | "欠席" | "議長" | "退席";
}

export function getVotingForMember(memberName: string): {
  records: MemberVotingSummary[];
  summary: {
    total: number;
    yes: number;
    no: number;
    absent: number;
    speaker: number;
  };
} {
  const results: MemberVotingSummary[] = [];
  const slugs = getAllVotingSlugs();
  const normalizedName = memberName.replace(/\s+/g, "");

  for (const slug of slugs) {
    const data = getVotingForSession(slug);
    if (!data) continue;

    for (const record of data.records) {
      const memberVote = record.votes.find(
        (v) => v.memberName.replace(/\s+/g, "") === normalizedName,
      );
      if (memberVote) {
        results.push({
          session: data.session,
          sessionSlug: data.sessionSlug,
          billNumber: record.billNumber,
          billTitle: record.billTitle,
          result: record.result,
          vote: memberVote.vote,
        });
      }
    }
  }

  const sorted = results.sort((a, b) =>
    b.sessionSlug.localeCompare(a.sessionSlug),
  );
  const votable = sorted.filter((r) => r.vote !== "議長");

  return {
    records: sorted,
    summary: {
      total: votable.length,
      yes: votable.filter((r) => r.vote === "賛成").length,
      no: votable.filter((r) => r.vote === "反対").length,
      absent: votable.filter(
        (r) => r.vote === "欠席" || r.vote === "退席",
      ).length,
      speaker: sorted.filter((r) => r.vote === "議長").length,
    },
  };
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

// --- Voting Analysis ---

export interface VotingAnalysis {
  meta: {
    generatedAt: string;
    totalBills: number;
    splitBills: number;
    sessionRange: string;
  };
  agreementMatrix: {
    members: string[];
    factions: string[];
    matrix: number[][];
  };
  factionCohesion: {
    faction: string;
    memberCount: number;
    cohesionRate: number;
    splitBillCount: number;
    totalBillCount: number;
  }[];
  dissenterProfiles: {
    memberName: string;
    faction: string;
    totalVotes: number;
    oppositionCount: number;
    oppositionRate: number;
    themeDistribution: { tag: string; count: number }[];
  }[];
}

export function getVotingAnalysis(): VotingAnalysis | null {
  try {
    const raw = readFileSync(resolve(DATA_DIR, "voting-analysis.json"), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// --- Bill result lookup ---

export function getBillResult(sessionSlug: string, billNumber: string): string | null {
  const session = getSession(sessionSlug);
  if (!session) return null;
  const bill = session.bills.find((b) => b.number === billNumber);
  return bill?.result ?? null;
}

// --- Related tags lookup ---

export function getRelatedTags(
  sessionSlug: string,
  billNumber?: string,
  memberName?: string,
  itemTitle?: string,
): string[] {
  const tags = getTags();
  if (!tags) return [];
  const entry = tags.entries.find((e) => {
    if (e.sessionSlug !== sessionSlug) return false;
    if (billNumber && e.billNumber === billNumber) return true;
    if (memberName && itemTitle && e.memberName === memberName && e.itemTitle === itemTitle) return true;
    return false;
  });
  return entry?.tags ?? [];
}

// --- Schedule ---

export interface ScheduleEntry {
  date: string;
  type: "本会議" | "委員会" | "全員協議会" | "その他";
  session: string;
  description: string;
}

export interface ScheduleData {
  sourceUrl: string;
  scrapedAt: string;
  entries: ScheduleEntry[];
}

export function getSchedule(): ScheduleData | null {
  try {
    const raw = readFileSync(resolve(DATA_DIR, "schedule.json"), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function getUpcomingEntries(limit = 5): ScheduleEntry[] {
  const schedule = getSchedule();
  if (!schedule) return [];
  const today = new Date().toISOString().slice(0, 10);
  return schedule.entries
    .filter((e) => e.date >= today)
    .slice(0, limit);
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
