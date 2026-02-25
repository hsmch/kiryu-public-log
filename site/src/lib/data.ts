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
