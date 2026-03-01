import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { tagsSchema } from "./schemas";
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

const TAG_CATEGORIES = [
  "財政",
  "教育",
  "福祉・医療",
  "子育て",
  "防災・安全",
  "都市基盤",
  "環境",
  "産業・観光",
  "まちづくり",
  "デジタル化",
  "条例",
  "人事・組織",
  "議会運営",
] as const;

const BATCH_SIZE = 30;

function log(msg: string) {
  console.log(`[generate-tags] ${msg}`);
}

// --- Rule-based fallback ---

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
    [/議[会長席]|発議|動議|意見書|決議|請願|陳情/, "議会運営"],
  ];
  for (const [pattern, tag] of rules) {
    if (pattern.test(title)) tags.push(tag);
  }
  return tags.length > 0 ? tags : ["その他"];
}

// --- Claude API classification ---

interface ClassifyItem {
  id: string;
  text: string;
}

async function classifyBatchWithClaude(
  client: InstanceType<typeof import("@anthropic-ai/sdk").default>,
  items: ClassifyItem[],
): Promise<Map<string, string[]>> {
  const prompt = `以下の桐生市議会の議案・質問タイトルを分類してください。

カテゴリ一覧: ${TAG_CATEGORIES.join(", ")}

ルール:
- 各項目に1〜3個のカテゴリを割り当ててください
- どのカテゴリにも当てはまらない場合は「その他」としてください
- JSONのみで回答してください（説明不要）

回答形式: [{"id":"...","tags":["..."]},...]

項目一覧:
${items.map((i) => `- id:${i.id} "${i.text}"`).join("\n")}`;

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  // Extract JSON array from response
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error("Failed to parse Claude response as JSON array");
  }

  const results: { id: string; tags: string[] }[] = JSON.parse(jsonMatch[0]);
  const map = new Map<string, string[]>();
  for (const r of results) {
    // Validate tags against known categories
    const validTags = r.tags.filter(
      (t) =>
        (TAG_CATEGORIES as readonly string[]).includes(t) || t === "その他",
    );
    map.set(r.id, validTags.length > 0 ? validTags : ["その他"]);
  }
  return map;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  // Collect raw entries (without tags yet)
  const rawEntries: (TagEntry & { _searchText: string; _id: string })[] = [];

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
      rawEntries.push({
        type: "bill",
        sessionSlug: slug,
        session: data.session,
        billNumber: bill.number,
        billTitle: bill.title,
        tags: [],
        _searchText: bill.title,
        _id: `bill:${slug}:${bill.number}`,
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
          rawEntries.push({
            type: "question",
            sessionSlug: slug,
            session: data.session,
            memberName: mq.memberName,
            itemTitle: item.title,
            tags: [],
            _searchText:
              item.title + " " + (item.details || []).join(" "),
            _id: `q:${slug}:${mq.memberName}:${item.title}`,
          });
        }
      }
    }
  } catch {
    log("No questions directory found, skipping");
  }

  log(`Collected ${rawEntries.length} entries to classify`);

  // Determine method: Claude API or rule-based
  const apiKey = process.env.ANTHROPIC_API_KEY;
  let method: "claude-api" | "rule-based" = "rule-based";
  const model = "claude-haiku-4-5-20251001";

  if (apiKey) {
    log("ANTHROPIC_API_KEY found, using Claude API for classification");
    method = "claude-api";

    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });

    // Load existing tags for incremental updates
    let existingTags = new Map<string, string[]>();
    if (existsSync(OUTPUT_PATH)) {
      try {
        const existing: TagsData = JSON.parse(
          readFileSync(OUTPUT_PATH, "utf-8"),
        );
        if (existing.method === "claude-api") {
          for (const e of existing.entries) {
            const key =
              e.type === "bill"
                ? `bill:${e.sessionSlug}:${e.billNumber}`
                : `q:${e.sessionSlug}:${e.memberName}:${e.itemTitle}`;
            existingTags.set(key, e.tags);
          }
          log(`Loaded ${existingTags.size} existing Claude-classified entries`);
        }
      } catch {
        log("Could not load existing tags, will classify all entries");
      }
    }

    // Split into entries that need classification vs already classified
    const toClassify: typeof rawEntries = [];
    for (const entry of rawEntries) {
      const existing = existingTags.get(entry._id);
      if (existing) {
        entry.tags = existing;
      } else {
        toClassify.push(entry);
      }
    }

    log(
      `${rawEntries.length - toClassify.length} already classified, ${toClassify.length} to classify`,
    );

    // Classify in batches
    for (let i = 0; i < toClassify.length; i += BATCH_SIZE) {
      const batch = toClassify.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(toClassify.length / BATCH_SIZE);
      log(`Classifying batch ${batchNum}/${totalBatches} (${batch.length} items)`);

      try {
        const items: ClassifyItem[] = batch.map((e) => ({
          id: e._id,
          text: e._searchText.slice(0, 200), // Truncate to save tokens
        }));
        const results = await classifyBatchWithClaude(client, items);
        for (const entry of batch) {
          entry.tags = results.get(entry._id) || assignTagsByRules(entry._searchText);
        }
      } catch (err) {
        log(`  Batch ${batchNum} failed, falling back to rules: ${err}`);
        for (const entry of batch) {
          entry.tags = assignTagsByRules(entry._searchText);
        }
      }

      if (i + BATCH_SIZE < toClassify.length) {
        await sleep(500); // Rate limiting
      }
    }
  } else {
    log("No ANTHROPIC_API_KEY, using rule-based classification");
    for (const entry of rawEntries) {
      entry.tags = assignTagsByRules(entry._searchText);
    }
  }

  // Build output (strip internal fields)
  const entries: TagEntry[] = rawEntries.map(
    ({ _searchText, _id, ...entry }) => entry,
  );

  const output: TagsData = {
    generatedAt: new Date().toISOString(),
    method,
    ...(method === "claude-api" ? { model } : {}),
    entries,
  };

  const parsedTags = tagsSchema.parse(output);
  writeFileSync(OUTPUT_PATH, JSON.stringify(parsedTags, null, 2) + "\n", "utf-8");
  log(`Generated ${entries.length} tag entries (method: ${method}), saved to ${OUTPUT_PATH}`);

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
