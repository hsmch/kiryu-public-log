/**
 * お知らせの自動生成スクリプト
 *
 * data/ 配下のファイルを前回のコミットと比較し、
 * 新規追加されたデータに対応するお知らせエントリを
 * announcements.json に自動追記する。
 *
 * 自動生成されるお知らせは type: "update", featured: false。
 * 手動で追加したエントリ（announcement / featured: true）はそのまま保持。
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { announcementsSchema } from "./schemas";

const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../data");
const ANNOUNCEMENTS_PATH = resolve(DATA_DIR, "announcements.json");

interface AnnouncementEntry {
  id: string;
  date: string;
  title: string;
  content: string;
  url?: string;
  type: "announcement" | "update";
  featured: boolean;
  expiresAt?: string;
}

// --- Helpers ---

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * セッションスラグから表示用セッション名を取得する。
 * sessions/{slug}.json の session フィールドを読む。
 */
function getSessionName(slug: string): string {
  try {
    const raw = readFileSync(resolve(DATA_DIR, "sessions", `${slug}.json`), "utf-8");
    const data = JSON.parse(raw);
    return data.session ?? slug;
  } catch {
    return slug;
  }
}

/**
 * git diff で新規追加されたファイルを検出する。
 * CI 環境では HEAD と前のコミットを比較。
 * ファイルが git 管理下にない場合（初回）は空配列を返す。
 */
function getNewFiles(subdir: string): string[] {
  try {
    const output = execSync(
      `git diff --name-only --diff-filter=A HEAD -- "data/${subdir}/"`,
      { encoding: "utf-8", cwd: resolve(DATA_DIR, "..") },
    ).trim();
    if (!output) return [];
    return output.split("\n").map((f) => f.replace(`data/${subdir}/`, "").replace(".json", ""));
  } catch {
    return [];
  }
}

/**
 * git diff で内容が変更されたファイルを検出する（新規追加は除く）。
 */
function getModifiedFiles(subdir: string): string[] {
  try {
    const output = execSync(
      `git diff --name-only --diff-filter=M HEAD -- "data/${subdir}/"`,
      { encoding: "utf-8", cwd: resolve(DATA_DIR, "..") },
    ).trim();
    if (!output) return [];
    return output.split("\n").map((f) => f.replace(`data/${subdir}/`, "").replace(".json", ""));
  } catch {
    return [];
  }
}

/**
 * git diff でルートレベルの変更ファイルを検出する。
 */
function getChangedRootFiles(): string[] {
  try {
    const output = execSync(
      `git diff --name-only HEAD -- "data/*.json"`,
      { encoding: "utf-8", cwd: resolve(DATA_DIR, "..") },
    ).trim();
    if (!output) return [];
    return output.split("\n").map((f) => f.replace("data/", "").replace(".json", ""));
  } catch {
    return [];
  }
}

// --- Announcement generators ---

function generateSessionAnnouncements(): AnnouncementEntry[] {
  const entries: AnnouncementEntry[] = [];
  const newSessions = getNewFiles("sessions");

  for (const slug of newSessions) {
    const name = getSessionName(slug);
    entries.push({
      id: `auto-session-${slug}`,
      date: today(),
      title: `${name}の議案データを追加しました`,
      content: `${name}の議案一覧を公開しました。`,
      url: `/sessions/${slug}`,
      type: "update",
      featured: false,
    });
  }

  return entries;
}

function generateVotingAnnouncements(): AnnouncementEntry[] {
  const entries: AnnouncementEntry[] = [];
  const newVoting = getNewFiles("voting");

  for (const slug of newVoting) {
    const name = getSessionName(slug);
    entries.push({
      id: `auto-voting-${slug}`,
      date: today(),
      title: `${name}の投票記録を追加しました`,
      content: `${name}の議員別投票記録を公開しました。`,
      url: `/sessions/${slug}`,
      type: "update",
      featured: false,
    });
  }

  return entries;
}

function generateQuestionAnnouncements(): AnnouncementEntry[] {
  const entries: AnnouncementEntry[] = [];
  const newQuestions = getNewFiles("questions");

  for (const slug of newQuestions) {
    const name = getSessionName(slug);
    entries.push({
      id: `auto-questions-${slug}`,
      date: today(),
      title: `${name}の一般質問を追加しました`,
      content: `${name}の一般質問データを公開しました。`,
      url: `/sessions/${slug}`,
      type: "update",
      featured: false,
    });
  }

  return entries;
}

function generateFinanceAnnouncements(): AnnouncementEntry[] {
  const entries: AnnouncementEntry[] = [];
  const newFinance = getNewFiles("finance");
  const modifiedFinance = getModifiedFiles("finance");
  const changed = [...new Set([...newFinance, ...modifiedFinance])];

  if (changed.length === 0) return entries;

  // 財政データの変更をまとめて1件のお知らせにする
  const fileLabels: Record<string, string> = {
    budget: "予算",
    "budget-history": "予算経年比較",
    funds: "基金残高",
    benchmarks: "財政指標",
    "budget-annotations": "予算解説",
  };

  const labels = changed
    .map((f) => fileLabels[f] ?? f)
    .join("・");

  entries.push({
    id: `auto-finance-${today()}`,
    date: today(),
    title: `財政データ（${labels}）を更新しました`,
    content: "財政ダッシュボードのデータを最新の情報に更新しました。",
    url: "/finance",
    type: "update",
    featured: false,
  });

  return entries;
}

// --- Main ---

function main() {
  console.log("=== お知らせ自動生成 ===");

  // 既存のお知らせを読み込み
  let existing: { entries: AnnouncementEntry[] } = { entries: [] };
  if (existsSync(ANNOUNCEMENTS_PATH)) {
    try {
      existing = JSON.parse(readFileSync(ANNOUNCEMENTS_PATH, "utf-8"));
    } catch {
      console.warn("  [warn] 既存の announcements.json の読み込みに失敗。新規作成します。");
    }
  }

  const existingIds = new Set(existing.entries.map((e) => e.id));

  // 各種お知らせを生成
  const generated = [
    ...generateSessionAnnouncements(),
    ...generateVotingAnnouncements(),
    ...generateQuestionAnnouncements(),
    ...generateFinanceAnnouncements(),
  ];

  // 重複除外（id ベース）
  const newEntries = generated.filter((e) => !existingIds.has(e.id));

  if (newEntries.length === 0) {
    console.log("  新規お知らせはありません。");
    return;
  }

  console.log(`  ${newEntries.length}件のお知らせを追加します:`);
  for (const entry of newEntries) {
    console.log(`    - ${entry.title}`);
  }

  // 新しいエントリを先頭に追加（新しい順）
  const merged = {
    entries: [...newEntries, ...existing.entries],
  };

  // スキーマ検証
  const validated = announcementsSchema.parse(merged);

  writeFileSync(ANNOUNCEMENTS_PATH, JSON.stringify(validated, null, 2) + "\n");
  console.log(`\n完了: ${newEntries.length}件追加（合計${validated.entries.length}件）`);
}

main();
