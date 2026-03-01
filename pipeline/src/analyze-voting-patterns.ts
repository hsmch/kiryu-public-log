import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { votingAnalysisSchema } from "./schemas";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../data");
const OUTPUT_PATH = resolve(DATA_DIR, "voting-analysis.json");

// --- Types ---

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

interface CouncilMember {
  seatNumber: number | null;
  name: string;
  faction: string;
}

interface CouncilData {
  officers: CouncilMember[];
  members: CouncilMember[];
}

interface TagEntry {
  type: "bill" | "question";
  sessionSlug: string;
  billNumber?: string;
  billTitle?: string;
  tags: string[];
}

interface TagsData {
  entries: TagEntry[];
}

// --- Output types ---

interface AgreementMatrix {
  members: string[];
  factions: string[];
  matrix: number[][];
}

interface FactionCohesion {
  faction: string;
  memberCount: number;
  cohesionRate: number;
  splitBillCount: number;
  totalBillCount: number;
}

interface DissenterProfile {
  memberName: string;
  faction: string;
  totalVotes: number;
  oppositionCount: number;
  oppositionRate: number;
  themeDistribution: { tag: string; count: number }[];
}

interface VotingAnalysis {
  meta: {
    generatedAt: string;
    totalBills: number;
    splitBills: number;
    sessionRange: string;
  };
  agreementMatrix: AgreementMatrix;
  factionCohesion: FactionCohesion[];
  dissenterProfiles: DissenterProfile[];
}

// --- Helpers ---

function normalizeName(name: string): string {
  return name.replace(/[\s\u3000]+/g, "");
}

// Faction sort order
const FACTION_ORDER = [
  "一心会",
  "そうぞう未来",
  "政策研究会",
  "公明クラブ",
  "クラブ21",
  "日本共産党議員団",
  "無会派",
];

function factionSortKey(faction: string): number {
  const idx = FACTION_ORDER.indexOf(faction);
  return idx >= 0 ? idx : FACTION_ORDER.length;
}

// --- Main ---

function main() {
  console.log("投票パターン分析を開始...");

  // 1. Load council members
  const councilRaw = readFileSync(resolve(DATA_DIR, "council-members.json"), "utf-8");
  const councilData: CouncilData = JSON.parse(councilRaw);
  const allMembers = [...councilData.officers, ...councilData.members];

  // Build member → faction map (normalized name → faction)
  const memberFactionMap = new Map<string, string>();
  const memberSeatMap = new Map<string, number>();
  for (const m of allMembers) {
    memberFactionMap.set(normalizeName(m.name), m.faction);
    memberSeatMap.set(normalizeName(m.name), m.seatNumber ?? 999);
  }

  // 2. Load all voting data
  const votingDir = resolve(DATA_DIR, "voting");
  const votingFiles = readdirSync(votingDir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  console.log(`投票ファイル: ${votingFiles.length}件`);

  const allRecords: { sessionSlug: string; session: string; record: VoteRecord }[] = [];
  const sessions: { slug: string; session: string }[] = [];

  for (const file of votingFiles) {
    const raw = readFileSync(resolve(votingDir, file), "utf-8");
    const data: VotingData = JSON.parse(raw);
    if (!data.records || data.records.length === 0) continue;

    sessions.push({ slug: data.sessionSlug, session: data.session });
    for (const record of data.records) {
      allRecords.push({
        sessionSlug: data.sessionSlug,
        session: data.session,
        record,
      });
    }
  }

  console.log(`有効レコード: ${allRecords.length}件`);

  // 3. Collect all unique member names from voting data
  const memberNameSet = new Set<string>();
  for (const { record } of allRecords) {
    for (const v of record.votes) {
      memberNameSet.add(normalizeName(v.memberName));
    }
  }

  // Sort members by faction order, then seat number
  const memberNames = [...memberNameSet].sort((a, b) => {
    const fA = memberFactionMap.get(a) ?? "無会派";
    const fB = memberFactionMap.get(b) ?? "無会派";
    const fDiff = factionSortKey(fA) - factionSortKey(fB);
    if (fDiff !== 0) return fDiff;
    return (memberSeatMap.get(a) ?? 999) - (memberSeatMap.get(b) ?? 999);
  });

  const memberIndex = new Map<string, number>();
  memberNames.forEach((name, i) => memberIndex.set(name, i));

  console.log(`議員数: ${memberNames.length}名`);

  // 4. Calculate agreement matrix
  // For each pair of members, count bills where both voted (賛成 or 反対) and agreed
  const n = memberNames.length;
  const agreeCount = Array.from({ length: n }, () => new Float64Array(n));
  const totalCount = Array.from({ length: n }, () => new Float64Array(n));

  let splitBillCount = 0;

  for (const { record } of allRecords) {
    // Get votes for this bill, only 賛成/反対
    const votes = new Map<string, string>();
    for (const v of record.votes) {
      if (v.vote === "賛成" || v.vote === "反対") {
        votes.set(normalizeName(v.memberName), v.vote);
      }
    }

    // Check if this is a split vote
    const voteValues = [...votes.values()];
    const hasBoth = voteValues.includes("賛成") && voteValues.includes("反対");
    if (hasBoth) splitBillCount++;

    // For each pair
    const votedMembers = [...votes.keys()].filter((m) => memberIndex.has(m));
    for (let i = 0; i < votedMembers.length; i++) {
      const mi = memberIndex.get(votedMembers[i])!;
      const vi = votes.get(votedMembers[i])!;
      for (let j = i + 1; j < votedMembers.length; j++) {
        const mj = memberIndex.get(votedMembers[j])!;
        const vj = votes.get(votedMembers[j])!;
        totalCount[mi][mj]++;
        totalCount[mj][mi]++;
        if (vi === vj) {
          agreeCount[mi][mj]++;
          agreeCount[mj][mi]++;
        }
      }
    }
  }

  // Build the matrix (0.0-1.0)
  const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) {
        matrix[i][j] = 1.0;
      } else if (totalCount[i][j] > 0) {
        matrix[i][j] = Math.round((agreeCount[i][j] / totalCount[i][j]) * 1000) / 1000;
      } else {
        matrix[i][j] = -1; // no shared votes
      }
    }
  }

  const factions = memberNames.map((m) => memberFactionMap.get(m) ?? "無会派");

  console.log(`賛否分裂議案: ${splitBillCount}件`);

  // 5. Faction cohesion
  const factionMembers = new Map<string, string[]>();
  for (const name of memberNames) {
    const faction = memberFactionMap.get(name) ?? "無会派";
    if (!factionMembers.has(faction)) factionMembers.set(faction, []);
    factionMembers.get(faction)!.push(name);
  }

  const factionCohesion: FactionCohesion[] = [];

  for (const [faction, members] of factionMembers) {
    if (members.length < 2) {
      factionCohesion.push({
        faction,
        memberCount: members.length,
        cohesionRate: 1.0,
        splitBillCount: 0,
        totalBillCount: 0,
      });
      continue;
    }

    let unanimous = 0;
    let split = 0;
    let total = 0;

    for (const { record } of allRecords) {
      const memberVotes: string[] = [];
      for (const v of record.votes) {
        const normalized = normalizeName(v.memberName);
        if (members.includes(normalized) && (v.vote === "賛成" || v.vote === "反対")) {
          memberVotes.push(v.vote);
        }
      }

      if (memberVotes.length < 2) continue;
      total++;

      const allSame = memberVotes.every((v) => v === memberVotes[0]);
      if (allSame) {
        unanimous++;
      } else {
        split++;
      }
    }

    factionCohesion.push({
      faction,
      memberCount: members.length,
      cohesionRate: total > 0 ? Math.round((unanimous / total) * 1000) / 1000 : 1.0,
      splitBillCount: split,
      totalBillCount: total,
    });
  }

  // Sort by FACTION_ORDER
  factionCohesion.sort((a, b) => factionSortKey(a.faction) - factionSortKey(b.faction));

  console.log("会派結束度:");
  for (const fc of factionCohesion) {
    console.log(`  ${fc.faction}: ${(fc.cohesionRate * 100).toFixed(1)}% (${fc.memberCount}名, 分裂${fc.splitBillCount}件/${fc.totalBillCount}件)`);
  }

  // 6. Dissenter profiles
  // Load tags for theme distribution
  let tagsData: TagsData | null = null;
  try {
    const tagsRaw = readFileSync(resolve(DATA_DIR, "tags.json"), "utf-8");
    tagsData = JSON.parse(tagsRaw);
  } catch {
    console.warn("tags.json が読み込めません。テーマ分布はスキップします。");
  }

  // Build a lookup: sessionSlug+billNumber → tags
  const billTagMap = new Map<string, string[]>();
  if (tagsData) {
    for (const entry of tagsData.entries) {
      if (entry.type === "bill" && entry.sessionSlug && entry.billNumber) {
        billTagMap.set(`${entry.sessionSlug}:${entry.billNumber}`, entry.tags);
      }
    }
  }

  const dissenterProfiles: DissenterProfile[] = [];

  for (const name of memberNames) {
    let totalVotes = 0;
    let oppositionCount = 0;
    const themeCount = new Map<string, number>();

    for (const { sessionSlug, record } of allRecords) {
      const memberVote = record.votes.find(
        (v) => normalizeName(v.memberName) === name
      );
      if (!memberVote || (memberVote.vote !== "賛成" && memberVote.vote !== "反対")) continue;

      totalVotes++;
      if (memberVote.vote === "反対") {
        oppositionCount++;
        // Look up tags for this bill
        const tags = billTagMap.get(`${sessionSlug}:${record.billNumber}`) ?? [];
        for (const tag of tags) {
          themeCount.set(tag, (themeCount.get(tag) ?? 0) + 1);
        }
      }
    }

    const themeDistribution = [...themeCount.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);

    dissenterProfiles.push({
      memberName: name,
      faction: memberFactionMap.get(name) ?? "無会派",
      totalVotes,
      oppositionCount,
      oppositionRate: totalVotes > 0 ? Math.round((oppositionCount / totalVotes) * 1000) / 1000 : 0,
      themeDistribution,
    });
  }

  // Sort by opposition rate descending
  dissenterProfiles.sort((a, b) => b.oppositionRate - a.oppositionRate);

  // 7. Session range
  const sortedSessions = sessions.sort((a, b) => a.slug.localeCompare(b.slug));
  const sessionRange =
    sortedSessions.length > 0
      ? `${sortedSessions[0].session}〜${sortedSessions[sortedSessions.length - 1].session}`
      : "";

  // 8. Output
  const output: VotingAnalysis = {
    meta: {
      generatedAt: new Date().toISOString(),
      totalBills: allRecords.length,
      splitBills: splitBillCount,
      sessionRange,
    },
    agreementMatrix: {
      members: memberNames,
      factions,
      matrix,
    },
    factionCohesion,
    dissenterProfiles,
  };

  const parsed = votingAnalysisSchema.parse(output);
  writeFileSync(OUTPUT_PATH, JSON.stringify(parsed, null, 2), "utf-8");
  console.log(`\n出力: ${OUTPUT_PATH}`);
  console.log(`議案総数: ${allRecords.length}, 分裂: ${splitBillCount}, 議員数: ${memberNames.length}`);
}

main();
