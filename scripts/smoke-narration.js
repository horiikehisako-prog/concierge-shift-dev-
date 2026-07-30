const fs = require("node:fs");
const path = require("node:path");

const endpoint = process.env.NARRATION_ENDPOINT
  || "https://concierge-shift-dev.vercel.app/api/generate-narration";
const caseName = process.argv[2] || "calm-male";

const cases = {
  "chieno-91": {
    textbook: "001_90代女性_家族を支えた暮らし.md",
    theme: "家族愛",
    tags: ["90代", "女性", "家族", "笑顔", "旅行", "手芸"],
    hearingSheet: {
      deceasedName: "堀池 チエノ",
      narrationName: "チエノ",
      age: "91",
      gender: "女性",
      familyRelation: "子",
      deceasedDate: "2026-07-20",
      ceremonyType: "葬儀",
      familyMemories: "いつも笑っている顔しか思い出せないほど、よく笑う人だった。歌ったり踊ったりする姿を、家族はいつも可愛いと感じていた。",
      memorableEvents: "親子三代で六甲、小倉、下関、博多へ旅行した。いずれも誕生日月の十月だった。",
      hobbies: "手芸を楽しみ、野菜や花を育てていた。",
      personality: "明るく前向きで、人と接することが大好きだった。思い立ったらすぐに行動した。",
      favoritePhrases: "「人の悪口を言ってはいけない」とよく話していた。",
      valuedThings: "家族を大切にしていた。",
      familyFeelings: "その明るさを見習い、前向きに歩んでいきたい。",
    },
  },
  "smiling-family-female": {
    textbook: "008_80代女性_笑い声の絶えない賑やかな人生.md",
    theme: "家族愛",
    tags: ["90代", "女性", "家族", "笑顔", "旅行"],
    hearingSheet: {
      deceasedName: "高橋 澄子",
      narrationName: "澄子",
      age: "90",
      gender: "女性",
      familyRelation: "子",
      deceasedDate: "2026-07-20",
      ceremonyType: "葬儀",
      familyMemories: "いつも笑顔が身近にあった。歌ったり、踊ったりする姿を、家族は愛らしく感じていた。",
      memorableEvents: "親子三代で松江、高松、熊本へ旅行した。いずれも誕生日月の九月だった。",
      hobbies: "編み物を楽しみ、庭の草花を育てていた。",
      personality: "朗らかで、人と接することが好きだった。思い立つとすぐに行動へ移した。",
      favoritePhrases: "「人を悪く言わないでいよう」とよく言っていた。",
      valuedThings: "家族を大切にしていた。",
      familyFeelings: "その朗らかさを忘れずにいたい。",
    },
  },
  "calm-male": {
    textbook: "003_80代男性_穏やかな笑顔で日々を重ねた人生.md",
    theme: "穏やかな日常",
    tags: ["80代", "男性", "家族", "ゴルフ"],
    hearingSheet: {
      deceasedName: "田中 正雄",
      narrationName: "正雄",
      age: "82",
      gender: "男性",
      familyRelation: "子",
      deceasedDate: "2026-07-20",
      ceremonyType: "葬儀",
      familyMemories: "ゴルフへ出かける朝に支度を整える姿と、帰宅後に居間で静かに過ごす姿が家族の記憶にある。",
      memorableEvents: "孫が来る日には玄関まで迎えに出て、帰る時には外まで見送っていた。",
      hobbies: "休日には仲間とゴルフを楽しんだ。",
      personality: "穏やかで口数は多くない。家族にはよく微笑んでいた。",
      valuedThings: "家族と同じ食卓を囲む時間を大切にした。",
      familyFeelings: "言葉は少なくても、そばにいるだけで安心できたことへ感謝している。",
    },
  },
  "social-female": {
    textbook: "002_80代女性_人とのご縁を楽しんだ人生.md",
    theme: "人とのご縁",
    tags: ["80代", "女性", "仕事", "地域", "旅行"],
    hearingSheet: {
      deceasedName: "山本 和子",
      narrationName: "和子",
      age: "84",
      gender: "女性",
      familyRelation: "子",
      deceasedDate: "2026-07-20",
      ceremonyType: "葬儀",
      familyMemories: "旅から帰ると、訪れた土地の出来事を家族に楽しそうに話していた。",
      memorableEvents: "商店では訪れる人とよく言葉を交わし、地域の集まりやボランティアにも欠かさず出かけていた。",
      hobbies: "旅行とカラオケが好きで、犬や猫を見かけると自然に足を止めた。",
      personality: "人と接することが好きで、いつも活動的だった。",
      valuedThings: "仕事を通して結ばれた人とのご縁を大切にした。",
      familyFeelings: "何事にもいきいきと向き合う姿を、これからも忘れずにいたい。",
    },
  },
};

const selected = cases[caseName];
if (!selected) {
  throw new Error(`Unknown case: ${caseName}`);
}

const textbookPath = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "examples",
  selected.textbook,
);
const textbook = fs.readFileSync(textbookPath, "utf8");
const promptPayload = {
  hearingSheet: selected.hearingSheet,
  writingRules: {
    season: "夏",
    theme: selected.theme,
    forbiddenWords: ["旅立ち"],
  },
  selectedLibraryStyleReferences: [{
    title: selected.textbook.replace(/\.md$/u, ""),
    theme: selected.theme,
    tags: selected.tags,
    openingNarration: textbook,
    closingNarration: textbook,
    writingNotes: "人物評を並べず、家族が覚えている日常の場面から人柄を伝える。",
  }],
};

const main = async () => {
  const startedAt = Date.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    signal: AbortSignal.timeout(180_000),
    body: JSON.stringify({
      prompt: `Create narration from this JSON:\n${JSON.stringify(promptPayload)}`,
      model: "gpt-5.5",
      temperature: 0.2,
      maxTokens: 4200,
    }),
  });
  const raw = await response.text();
  let body = raw;
  try {
    body = JSON.parse(raw);
  } catch (_) {
    // Keep non-JSON server output visible for diagnostics.
  }

  process.stdout.write(`${JSON.stringify({
    caseName,
    endpoint,
    status: response.status,
    elapsedSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
    body,
  }, null, 2)}\n`);
};

main().catch(error => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
