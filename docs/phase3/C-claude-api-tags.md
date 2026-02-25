# C. タグ付けの Claude API 化

## 概要

現在のタグ付け（`generate-tags.ts`）はルールベース（正規表現マッチ）で精度が限られる。Claude API（Haiku）を使って分類精度を向上させる。

## 現状

### 既存のルールベースタグ付け

`pipeline/src/generate-tags.ts` で14カテゴリの正規表現ルール：

| タグ | 正規表現パターン |
|------|---------------|
| 財政 | `予算\|決算\|税\|財政\|基金\|会計` |
| 教育 | `教育\|学校\|児童\|生徒\|給食` |
| 福祉・医療 | `福祉\|介護\|障害\|高齢\|医療\|健康\|国保\|国民健康` |
| 子育て | `子[どもども育]\|保育\|幼稚\|少子\|こども` |
| 防災・安全 | `防災\|消防\|災害\|避難\|安全` |
| 都市基盤 | `道路\|橋\|上下水道\|都市計画\|区画整理\|公園\|水道` |
| 環境 | `環境\|ごみ\|廃棄\|エネルギー\|脱炭素` |
| 産業・観光 | `産業\|商工\|観光\|農[業林]\|雇用\|企業` |
| まちづくり | `人口\|移住\|定住\|空き家\|まちづくり` |
| デジタル化 | `DX\|デジタル\|ICT\|マイナンバー` |
| 条例 | `条例` |
| 人事・組織 | `人事\|職員\|給与\|報酬` |
| その他 | デフォルト（どのルールにもマッチしない場合） |

### 課題
- タイトルにキーワードが含まれない場合「その他」に落ちる
- 複数テーマにまたがる質問の分類が不正確
- 一般質問は要旨が長くキーワードマッチだけでは文脈を拾えない

## 変更対象

- `pipeline/src/generate-tags.ts` — Claude API 呼び出しの追加
- `pipeline/package.json` — `@anthropic-ai/sdk` 依存の追加
- `.github/workflows/collect.yml` — ANTHROPIC_API_KEY シークレットの利用

## やること

### Step 1: Anthropic SDK の導入

```bash
cd pipeline && npm install @anthropic-ai/sdk
```

### Step 2: generate-tags.ts の改修

```typescript
// 方針: バッチ処理でコスト削減
// 1回の API 呼び出しで 20〜50 件をまとめて分類

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const TAG_CATEGORIES = [
  "財政", "教育", "福祉・医療", "子育て", "防災・安全",
  "都市基盤", "環境", "産業・観光", "まちづくり",
  "デジタル化", "条例", "人事・組織", "議会運営"
];

async function classifyBatch(items: { id: string; text: string }[]): Promise<Map<string, string[]>> {
  const prompt = `以下の議案・質問タイトルを分類してください。
カテゴリ: ${TAG_CATEGORIES.join(", ")}
各項目に1〜3個のカテゴリを割り当ててください。
JSON形式で回答: {"結果": [{"id": "...", "tags": ["...", "..."]}]}

${items.map(i => `- id:${i.id} "${i.text}"`).join("\n")}`;

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });
  // レスポンスをパースして Map<id, tags[]> を返す
}
```

### Step 3: ハイブリッド戦略

- **新規エントリ**: Claude API で分類（差分実行）
- **既存エントリ**: ルールベースの結果を保持 or API で再分類
- **フォールバック**: API エラー時はルールベースにフォールバック
- **API キーなし環境**: `ANTHROPIC_API_KEY` 未設定時はルールベースのみ実行

### Step 4: tags.json のメタデータ更新

```json
{
  "generatedAt": "2026-02-26T...",
  "method": "claude-api",
  "model": "claude-haiku-4-5-20251001",
  "entries": [...]
}
```

### Step 5: CI 設定

`.github/workflows/collect.yml` で環境変数を渡す：

```yaml
      - name: Generate tags
        working-directory: pipeline
        run: npm run generate:tags
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

GitHub リポジトリの Settings > Secrets に `ANTHROPIC_API_KEY` を追加する。

## コスト見積もり

- 全エントリ: 約1,500件（議案700 + 質問800）
- バッチサイズ: 30件/回 → 約50回の API 呼び出し
- Haiku: 入力 $0.80/MTok, 出力 $4/MTok
- 概算: 初回全件で $1〜2、以後の差分は数セント/回

## 表示側の変更

`site/src/pages/topics/index.astro` の注記を更新：

```
現在: ※ 自動分類のため、実際の内容と異なる場合があります
更新: ※ AI（Claude）による自動分類です。実際の内容と異なる場合があります
```

## 完了条件

- [ ] `@anthropic-ai/sdk` が pipeline の依存に追加されている
- [ ] `generate-tags.ts` が Claude API で分類を実行する
- [ ] API キーなし環境ではルールベースにフォールバックする
- [ ] `tags.json` の method が `"claude-api"` になる
- [ ] GitHub Secrets に `ANTHROPIC_API_KEY` が設定されている
- [ ] topics ページの注記が更新されている
