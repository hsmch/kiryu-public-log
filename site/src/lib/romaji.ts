/**
 * ひらがな → ヘボン式ローマ字変換
 * 外部ライブラリ不使用の自前実装
 */

const ROMAJI_TABLE: Record<string, string> = {
  あ: "a", い: "i", う: "u", え: "e", お: "o",
  か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko",
  さ: "sa", し: "shi", す: "su", せ: "se", そ: "so",
  た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to",
  な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no",
  は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
  ま: "ma", み: "mi", む: "mu", め: "me", も: "mo",
  や: "ya", ゆ: "yu", よ: "yo",
  ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro",
  わ: "wa", ゐ: "i", ゑ: "e", を: "o", ん: "n",
  が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go",
  ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo",
  だ: "da", ぢ: "di", づ: "zu", で: "de", ど: "do",
  ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
  ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po",
  きゃ: "kya", きゅ: "kyu", きょ: "kyo",
  しゃ: "sha", しゅ: "shu", しょ: "sho",
  ちゃ: "cha", ちゅ: "chu", ちょ: "cho",
  にゃ: "nya", にゅ: "nyu", にょ: "nyo",
  ひゃ: "hya", ひゅ: "hyu", ひょ: "hyo",
  みゃ: "mya", みゅ: "myu", みょ: "myo",
  りゃ: "rya", りゅ: "ryu", りょ: "ryo",
  ぎゃ: "gya", ぎゅ: "gyu", ぎょ: "gyo",
  じゃ: "ja", じゅ: "ju", じょ: "jo",
  びゃ: "bya", びゅ: "byu", びょ: "byo",
  ぴゃ: "pya", ぴゅ: "pyu", ぴょ: "pyo",
};

/**
 * ひらがな文字列をヘボン式ローマ字に変換
 */
function hiraganaToRomaji(input: string): string {
  let result = "";
  let i = 0;

  while (i < input.length) {
    // 促音（っ）の処理
    if (input[i] === "っ" && i + 1 < input.length) {
      const next = input[i + 1];
      // 次の文字の子音を重ねる（ち→tchi）
      const twoChar = input.slice(i + 1, i + 3);
      const oneChar = input.slice(i + 1, i + 2);
      const nextRomaji = ROMAJI_TABLE[twoChar] ?? ROMAJI_TABLE[oneChar];
      if (nextRomaji) {
        // ch の場合は t を重ねる
        if (nextRomaji.startsWith("ch")) {
          result += "t";
        } else {
          result += nextRomaji[0];
        }
      }
      i++;
      continue;
    }

    // 2文字の拗音を先にチェック
    if (i + 1 < input.length) {
      const twoChar = input.slice(i, i + 2);
      if (ROMAJI_TABLE[twoChar]) {
        result += ROMAJI_TABLE[twoChar];
        i += 2;
        continue;
      }
    }

    // 1文字
    const oneChar = input[i];
    if (ROMAJI_TABLE[oneChar]) {
      result += ROMAJI_TABLE[oneChar];
    }
    // ひらがな以外（空白等）はスキップ

    i++;
  }

  return result;
}

/**
 * 長音処理（ヘボン式パスポート準拠）
 * - ou → o
 * - uu → u
 */
function processLongVowels(romaji: string): string {
  return romaji
    .replace(/ou/g, "o")
    .replace(/uu/g, "u");
}

/**
 * nameReading（ふりがな）からURLスラッグを生成
 * "いいじま　ひでき" → "iijima-hideki"
 */
export function nameToSlug(nameReading: string): string {
  // 全角スペースと半角スペースで分割
  const parts = nameReading.trim().split(/[\s　]+/);

  const romanized = parts.map((part) => {
    const romaji = hiraganaToRomaji(part);
    return processLongVowels(romaji);
  });

  return romanized.join("-");
}
