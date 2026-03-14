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

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import type { AnnouncementsData } from "./schemas";
import { announcementsSchema } from "./schemas";

const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../data");
const ANNOUNCEMENTS_PATH = resolve(DATA_DIR, "announcements.json");
const ROOT_DIR = resolve(DATA_DIR, "..");

type AnnouncementEntry = AnnouncementsData["entries"][number];

// --- Helpers ---

function getSessionName(slug: string, cache: Map<string, string>): string {
  const cached = cache.get(slug);
  if (cached) return cached;
  try {
    const raw = readFileSync(resolve(DATA_DIR, "sessions", `${slug}.json`), "utf-8");
    const name = (JSON.parse(raw).session as string) ?? slug;
    cache.set(slug, name);
    return name;
  } catch {
    cache.set(slug, slug);
    return slug;
  }
}

/**
 * git diff で変更されたファイルを検出する。
 * filter: A=新規追加, M=変更, AM=両方
 */
function getDiffFiles(path: string, filter: string): string[] {
  try {
    const output = execSync(
      `git diff --name-only --diff-filter=${filter} HEAD -- "data/${path}"`,
      { encoding: "utf-8", cwd: ROOT_DIR },
    ).trim();
    if (!output) return [];
    return output.split("\n");
  } catch {
    return [];
  }
}

function extractSlug(filePath: string, subdir: string): string {
  return filePath.replace(`data/${subdir}/`, "").replace(".json", "");
}

// --- Session-based announcement config (table-driven) ---

interface SessionAnnouncementConfig {
  subdir: string;
  idPrefix: string;
  titleTemplate: (name: string) => string;
  contentTemplate: (name: string) => string;
}

const SESSION_CONFIGS: SessionAnnouncementConfig[] = [
  {
    subdir: "sessions",
    idPrefix: "auto-session",
    titleTemplate: (n) => `${n}の議案データを追加しました`,
    contentTemplate: (n) => `${n}の議案一覧を公開しました。`,
  },
  {
    subdir: "voting",
    idPrefix: "auto-voting",
    titleTemplate: (n) => `${n}の投票記録を追加しました`,
    contentTemplate: (n) => `${n}の議員別投票記録を公開しました。`,
  },
  {
    subdir: "questions",
    idPrefix: "auto-questions",
    titleTemplate: (n) => `${n}の一般質問を追加しました`,
    contentTemplate: (n) => `${n}の一般質問データを公開しました。`,
  },
];

const FINANCE_LABELS: Record<string, string> = {
  budget: "予算",
  "budget-history": "予算経年比較",
  funds: "基金残高",
  benchmarks: "財政指標",
  "budget-annotations": "予算解説",
};

// --- Generators ---

function generateSessionAnnouncements(
  dateStr: string,
  nameCache: Map<string, string>,
): AnnouncementEntry[] {
  const entries: AnnouncementEntry[] = [];

  for (const config of SESSION_CONFIGS) {
    const newFiles = getDiffFiles(`${config.subdir}/`, "A");
    for (const file of newFiles) {
      const slug = extractSlug(file, config.subdir);
      const name = getSessionName(slug, nameCache);
      entries.push({
        id: `${config.idPrefix}-${slug}`,
        date: dateStr,
        title: config.titleTemplate(name),
        content: config.contentTemplate(name),
        url: `/sessions/${slug}`,
        type: "update",
        featured: false,
      });
    }
  }

  return entries;
}

function generateFinanceAnnouncements(dateStr: string): AnnouncementEntry[] {
  const changed = getDiffFiles("finance/", "AM").map((f) =>
    extractSlug(f, "finance"),
  );

  if (changed.length === 0) return [];

  const labels = changed.map((f) => FINANCE_LABELS[f] ?? f).join("・");

  return [
    {
      id: `auto-finance-${dateStr}`,
      date: dateStr,
      title: `財政データ（${labels}）を更新しました`,
      content: "財政ダッシュボードのデータを最新の情報に更新しました。",
      url: "/finance",
      type: "update",
      featured: false,
    },
  ];
}

// --- Main ---

function main() {
  console.log("=== お知らせ自動生成 ===");

  const dateStr = new Date().toISOString().slice(0, 10);
  const nameCache = new Map<string, string>();

  // 既存のお知らせを読み込み
  let existing: AnnouncementsData = { entries: [] };
  try {
    existing = JSON.parse(readFileSync(ANNOUNCEMENTS_PATH, "utf-8"));
  } catch {
    console.warn("  [warn] 既存の announcements.json の読み込みに失敗。新規作成します。");
  }

  const existingIds = new Set(existing.entries.map((e) => e.id));

  // 各種お知らせを生成
  const generated = [
    ...generateSessionAnnouncements(dateStr, nameCache),
    ...generateFinanceAnnouncements(dateStr),
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
