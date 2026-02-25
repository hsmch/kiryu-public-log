import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../data");
const OUTPUT_PATH = resolve(DATA_DIR, "tags.json");

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
  method: "claude-api" | "rule-based";
  model?: string;
  entries: TagEntry[];
}

function log(msg: string) {
  console.log(`[generate-tags] ${msg}`);
}

function assignTagsByRules(title: string): string[] {
  const tags: string[] = [];
  const rules: [RegExp, string][] = [
    [/予算|決算|税|財政|基金|会計/, "財政"],
    [/教育|学校|児童|生徒|給食/, "教育"],
    [/福祉|介護|障害|高齢|医療|健康|国保|国民健康/, "福祉・医療"],
    [/子[どもども育]|保育|幼稚|少子|こども/, "子育て"],
    [/防災|消防|災害|避難|安全/, "防災・安全"],
    [/道路|橋|上下水道|都市計画|区画整理|公園|水道/, "都市基盤"],
    [/環境|ごみ|廃棄|エネルギー|脱炭素/, "環境"],
    [/産業|商工|観光|農[業林]|雇用|企業/, "産業・観光"],
    [/人口|移住|定住|空き家|まちづくり/, "まちづくり"],
    [/DX|デジタル|ICT|マイナンバー/, "デジタル化"],
    [/条例/, "条例"],
    [/人事|職員|給与|報酬/, "人事・組織"],
  ];
  for (const [pattern, tag] of rules) {
    if (pattern.test(title)) tags.push(tag);
  }
  return tags.length > 0 ? tags : ["その他"];
}

async function main() {
  const entries: TagEntry[] = [];

  // Process sessions (bills)
  const sessionsDir = resolve(DATA_DIR, "sessions");
  const sessionFiles = readdirSync(sessionsDir).filter((f) =>
    f.endsWith(".json"),
  );

  for (const file of sessionFiles) {
    const slug = file.replace(".json", "");
    const raw = readFileSync(resolve(sessionsDir, file), "utf-8");
    const data = JSON.parse(raw);

    for (const bill of data.bills || []) {
      entries.push({
        type: "bill",
        sessionSlug: slug,
        session: data.session,
        billNumber: bill.number,
        billTitle: bill.title,
        tags: assignTagsByRules(bill.title),
      });
    }
  }

  // Process questions
  const questionsDir = resolve(DATA_DIR, "questions");
  try {
    const questionFiles = readdirSync(questionsDir).filter((f) =>
      f.endsWith(".json"),
    );
    for (const file of questionFiles) {
      const slug = file.replace(".json", "");
      const raw = readFileSync(resolve(questionsDir, file), "utf-8");
      const data = JSON.parse(raw);

      for (const mq of data.questions || []) {
        for (const item of mq.items || []) {
          const searchText =
            item.title + " " + (item.details || []).join(" ");
          entries.push({
            type: "question",
            sessionSlug: slug,
            session: data.session,
            memberName: mq.memberName,
            itemTitle: item.title,
            tags: assignTagsByRules(searchText),
          });
        }
      }
    }
  } catch {
    log("No questions directory found, skipping");
  }

  const output: TagsData = {
    generatedAt: new Date().toISOString(),
    method: "rule-based",
    entries,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + "\n", "utf-8");
  log(`Generated ${entries.length} tag entries, saved to ${OUTPUT_PATH}`);

  // Print tag summary
  const tagCounts = new Map<string, number>();
  for (const e of entries) {
    for (const t of e.tags) {
      tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
    }
  }
  log("Tag summary:");
  for (const [tag, count] of [...tagCounts.entries()].sort(
    (a, b) => b[1] - a[1],
  )) {
    log(`  ${tag}: ${count}`);
  }
}

main().catch((err) => {
  console.error("[generate-tags] Fatal error:", err);
  process.exit(1);
});
