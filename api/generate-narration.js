const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const QUALITY_CHECK_FAILED_MESSAGE = "Generation quality check failed.";
const API_BUILD_ID = "sprint27-family-inside-20260729.62";
// Vercel functions have a firm execution limit. A second or third model call
// regularly exhausts that limit and hides an otherwise usable first draft.
// Keep generation to one model call; deterministic normalization and the
// quality report below handle the remaining non-critical issues.
const ALLOW_EXTERNAL_QUALITY_RETRY = false;
const ENABLE_GUARDED_COPY_EDIT = false;

const STRICT_FORBIDDEN_EXPRESSIONS = [
  "在りし日を",
  "飛鳥会館にお集まりいただき",
  "本日はご参列いただき",
  "本日はご会葬賜り",
  "ご来場ありがとうございます",
  "ご参列ありがとうございます",
  "ご会葬ありがとうございます",
  "本日はありがとうございます",
];

const VENUE_NAME_CANDIDATES = [
  "飛鳥会館",
  "あしべの杜",
  "あしべ",
  "ふかしな",
  "小さな多治米",
  "小さな蔵王",
  "春日",
  "花園",
  "多治米",
];

const SEASONAL_STARTERS = [
  "春", "桜", "若葉", "新緑", "陽春",
  "夏", "青葉", "蝉", "暑さ", "盛夏",
  "秋", "紅葉", "実り", "秋風", "澄んだ空",
  "冬", "寒さ", "木枯らし", "雪", "師走",
  "季節", "時候", "風", "空", "光",
];

const clampNumber = (value, fallback, min, max) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const readJsonBody = async req => {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
};

const extractJson = text => {
  const trimmed = String(text || "").trim();
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("INVALID_MODEL_JSON");
  }
};

const parseModelJson = content => {
  try {
    return extractJson(content);
  } catch (cause) {
    const error = new Error("MODEL_JSON_PARSE_FAILED");
    error.contentPreview = String(content || "").slice(0, 600);
    error.cause = cause;
    throw error;
  }
};

const splitNarrationSafely = (text, ratio = 0.64) => {
  const value = String(text || "").trim();
  if (!value) return { openingNarration: "", closingNarration: "" };
  const target = Math.ceil(value.length * ratio);
  const boundaries = [];
  const boundaryRegex = /(?:\n{2,}|[。！？]\s*)/g;
  let match;
  while ((match = boundaryRegex.exec(value))) {
    boundaries.push(match.index + match[0].length);
  }
  const usable = boundaries.filter(pos => pos > value.length * 0.35 && pos < value.length * 0.82);
  const splitAt = usable.length
    ? usable.reduce((best, pos) => Math.abs(pos - target) < Math.abs(best - target) ? pos : best, usable[0])
    : target;
  return {
    openingNarration: value.slice(0, splitAt).trim(),
    closingNarration: value.slice(splitAt).trim(),
  };
};

const parseNarrationTextFallback = content => {
  const text = String(content || "")
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  if (!text) return null;

  const openingLabel = String.raw`(?:\[OPENING\]|\u3010?\s*(?:\u958b\u5f0f\u524d|\u958b\u5f0f\u524d\u30ca\u30ec\u30fc\u30b7\u30e7\u30f3)\s*\u3011?)`;
  const closingLabel = String.raw`(?:\[CLOSING\]|\u3010?\s*(?:\u9589\u5f0f\u5f8c|\u9589\u5f0f\u5f8c\u30ca\u30ec\u30fc\u30b7\u30e7\u30f3)\s*\u3011?)`;
  const labelSeparator = String.raw`[\s:\uFF1A]*`;
  const openingMatch = text.match(new RegExp(`${openingLabel}${labelSeparator}([\\s\\S]*?)(?=${closingLabel}${labelSeparator}|$)`, "i"));
  const closingMatch = text.match(new RegExp(`${closingLabel}${labelSeparator}([\\s\\S]*)$`, "i"));
  const openingNarration = String(openingMatch?.[1] || "").trim();
  const closingNarration = String(closingMatch?.[1] || "").trim();
  if (openingNarration && closingNarration) {
    return {
      openingNarration,
      closingNarration,
      detectedTheme: "Compass AI",
      improvementNotes: "OpenAI returned text instead of JSON, so Compass imported it as narration text.",
    };
  }
  const paragraphs = text.split(/\n{2,}/).map(v => v.trim()).filter(Boolean);
  if (paragraphs.length >= 4 && text.length >= 200) {
    const midpoint = Math.ceil(paragraphs.length * 0.64);
    return {
      openingNarration: paragraphs.slice(0, midpoint).join("\n\n"),
      closingNarration: paragraphs.slice(midpoint).join("\n\n"),
      detectedTheme: "Compass AI",
      improvementNotes: "OpenAI returned unlabeled text, so Compass split it into opening and closing narration.",
    };
  }
  const lines = text.split(/\n+/).map(v => v.trim()).filter(Boolean);
  if (lines.length >= 4 && text.length >= 120) {
    const midpoint = Math.ceil(lines.length * 0.62);
    return {
      openingNarration: lines.slice(0, midpoint).join("\n\n"),
      closingNarration: lines.slice(midpoint).join("\n\n"),
      detectedTheme: "Compass AI",
      improvementNotes: "OpenAI returned unlabeled lines, so Compass split them into opening and closing narration.",
    };
  }
  return null;
};

const stripNonNarrationSections = value => {
  let text = String(value || "").trim();
  if (!text) return "";
  text = text
    .replace(/^\s*(?:\[OPENING\]|\[CLOSING\]|【開式前(?:ナレーション)?】|【閉式後(?:ナレーション)?】)\s*[:：]?\s*/giu, "")
    .trim();
  const noisePatterns = [
    /^\s*(?:\[[^\]]*improvement[^\]]*\]|【[^】]*improvement[^】]*】|improvement\s*notes?|improvement\s*note|notes?|deleted\s*theme|quality\s*notes?|writing\s*notes?)\s*[:：]?[\s\S]*$/im,
    /^\s*(?:改善メモ|改善点|補足|注記|備考|生成メモ|品質メモ|削除テーマ)\s*[:：]?[\s\S]*$/m,
  ];
  for (const pattern of noisePatterns) {
    text = text.replace(pattern, "").trim();
  }
  return text;
};

const stripFixedClosingOpening = value => {
  let text = String(value || "").trim();
  if (!text) return "";
  const fixedOpeningPatterns = [
    /^本日はご多用の中、?ご会葬いただき誠にありがとうございました。[。\s]*/u,
    /^本日は(?:ご参列|ご会葬|ご来場|お集まり|お越し)[^。]{0,60}(?:ありがとう|賜り|いただき)[^。]*。[。\s]*/u,
    /^(?:ご参列|ご会葬|ご来場|お集まり|お越し)[^。]{0,60}(?:ありがとう|賜り|いただき)[^。]*。[。\s]*/u,
  ];
  for (const pattern of fixedOpeningPatterns) {
    text = text.replace(pattern, "").trim();
  }
  return text;
};

const ensureClosingFinalLine = (value, prompt) => {
  let text = String(value || "").trim();
  if (!text) return "";
  const { givenName } = nameRuleFromPrompt(prompt);
  const payload = extractPromptPayload(prompt);
  const age = String(payload?.hearingSheet?.age || "").trim();
  const lifeYears = age || "〇〇";
  const closingFinalPatterns = [
    /(?:①\s*葬儀のみ\s*)?これをもちまして、?[^。]{0,40}様のご葬儀を閉式いたします。?/gu,
    /(?:②\s*葬儀[＋+・]初七日\s*)?これをもちまして、?[^。]{0,40}様のご葬儀並びに初七日法要を執り納めさせていただきます。?/gu,
    /(?:\d+|[〇零一二三四五六七八九十百]+)年のご生涯に心からの敬意を表し、過ごしてまいりました葬送のひととき。[\s\S]*?どうぞよろしくお願いいたします。?/gu,
  ];
  for (const pattern of closingFinalPatterns) text = text.replace(pattern, "").trim();
  const generatedGuidanceMarkers = [
    /[^。\n]{0,80}葬送のひととき[^。]*お花を手向けてのお別れ/u,
    /本日は(?:誠に)?ご会葬いただき/u,
    /これよりは、?お花を手向けて/u,
    /式場内は、?お別れの準備へ/u,
    /皆様には、?お手荷物をお持ちいただき/u,
  ];
  const guidanceIndexes = generatedGuidanceMarkers
    .map(pattern => text.search(pattern))
    .filter(index => index >= 0);
  if (guidanceIndexes.length) text = text.slice(0, Math.min(...guidanceIndexes)).trim();
  // Never expose a model fragment such as "歌ったり、踊ったりするお姿は".
  text = text.replace(/(?:^|\n{2,})[^。！？\n]{1,100}$/u, "").trim();
  if (age) {
    const honorGiven = givenName ? `${givenName}様` : "その方";
    const escapedAge = age.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text
      .replace(new RegExp(`${escapedAge}年の歩みの中で`, "g"), `${honorGiven}の歩みの中で`)
      .replace(new RegExp(`${escapedAge}年の歩み`, "g"), `${honorGiven}の歩み`)
      .replace(new RegExp(`${escapedAge}年のご生涯`, "g"), "そのご生涯")
      .replace(new RegExp(`${escapedAge}年というご生涯`, "g"), "そのご生涯");
  }
  const flowerFarewell = `${lifeYears}年のご生涯に心からの敬意を表し、過ごしてまいりました葬送のひととき。

本日はご会葬いただき、誠にありがとうございました。

これよりは、お花を手向けてのお別れのお時間でございます。

式場内は、お別れの準備へと移らせていただきます。

皆様には、お手荷物をお持ちいただき、後方でお待ちくださいますようお願いいたします。

どうぞよろしくお願いいたします。`;
  return `${text}\n\n${flowerFarewell}`.trim();
};

const parseNarrationResponse = content => {
  try {
    return parseModelJson(content);
  } catch (jsonError) {
    const textFallback = parseNarrationTextFallback(content);
    if (textFallback) return textFallback;
    throw jsonError;
  }
};

const normalizeText = value => String(value || "")
  .replace(/\s+/g, "")
  .replace(/[、。,.，．「」『』（）()]/g, "");

const extractPromptPayload = prompt => {
  const text = String(prompt || "");
  const starts = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "{") starts.push(i);
  }
  for (const start of starts.reverse()) {
    try {
      const parsed = JSON.parse(text.slice(start).trim());
      if (parsed && typeof parsed === "object") return parsed;
    } catch (_) {
      // Keep looking for the real JSON payload. Prompt instructions also include {fullName}-style placeholders.
    }
  }
  return null;
};

const buildVenueNames = prompt => {
  const payload = extractPromptPayload(prompt);
  const sheet = payload?.hearingSheet || {};
  return [...new Set([
    ...VENUE_NAME_CANDIDATES,
    sheet.venue,
    sheet.company,
    sheet.workplace,
  ].filter(v => String(v || "").trim()).map(v => String(v).trim()))];
};

const hasForbiddenExpression = text => {
  const normalized = normalizeText(text);
  if (STRICT_FORBIDDEN_EXPRESSIONS.some(phrase => normalized.includes(normalizeText(phrase)))) return true;
  if (/[一-龥々〆ヵヶぁ-んァ-ンーA-Za-z0-9]{1,30}会館にお集まりいただき/.test(normalized)) return true;
  if (/本日は(?:ご参列|ご会葬|ご来場|お集まり|お越し)[^。]*?(?:ありがとう|賜り|いただき)/.test(normalized)) return true;
  if (/(?:ご参列|ご会葬|ご来場|お集まり|お越し)[^。]*?(?:ありがとう|賜り|いただき)/.test(normalized)) return true;
  return false;
};

const hasVenueName = (text, venueNames) => {
  const normalized = normalizeText(text);
  return venueNames.some(name => name.length >= 2 && normalized.includes(normalizeText(name)));
};

const hasRepeatedExpressions = text => {
  const sentences = String(text || "")
    .split(/[。！？\n]+/)
    .map(s => normalizeText(s))
    .filter(s => s.length >= 12);
  const seen = new Set();
  for (const sentence of sentences) {
    if (seen.has(sentence)) return true;
    seen.add(sentence);
  }
  const compact = normalizeText(text);
  const counts = new Map();
  for (let i = 0; i <= compact.length - 14; i += 7) {
    const phrase = compact.slice(i, i + 14);
    counts.set(phrase, (counts.get(phrase) || 0) + 1);
    if (counts.get(phrase) >= 3) return true;
  }
  return false;
};

const haveDifferentContent = (opening, closing) => {
  const a = normalizeText(opening);
  const b = normalizeText(closing);
  if (!a || !b) return false;
  if (a === b) return false;
  const openingSentences = String(opening || "")
    .split(/[。！？\n]+/)
    .map(s => normalizeText(s))
    .filter(s => s.length >= 12);
  const closingSentences = new Set(String(closing || "")
    .split(/[。！？\n]+/)
    .map(s => normalizeText(s))
    .filter(s => s.length >= 12));
  if (!openingSentences.length || !closingSentences.size) return true;
  const overlap = openingSentences.filter(s => closingSentences.has(s)).length;
  return overlap / Math.min(openingSentences.length, closingSentences.size) < 0.4;
};

const repeatedContentNgrams = (opening, closing, prompt) => {
  const payload = extractPromptPayload(prompt);
  const sheet = payload?.hearingSheet || {};
  const source = [
    sheet.personality,
    sheet.hobbies,
    sheet.memorableEvents,
    sheet.familyMemories,
    sheet.travelAnniversaryEffort,
    sheet.favoritePhrases,
    sheet.valuedThings,
  ].filter(Boolean).join("。");
  const stop = new Set([
    "こと", "もの", "その", "この", "家族", "皆様", "時間", "日々", "お姿", "思い", "記憶",
    "大切", "本人", "され", "られ", "ました", "でした", "ござい", "こられ", "歩まれ",
  ]);
  const candidates = new Set();
  String(source || "").split(/[、。・,/\s「」『』（）()]+/u).forEach(part => {
    const compact = normalizeText(part);
    for (const size of [3, 2]) {
      for (let index = 0; index <= compact.length - size; index += 1) {
        const token = compact.slice(index, index + size);
        if (!stop.has(token) && !/[0-9０-９]/u.test(token)) candidates.add(token);
      }
    }
  });
  const a = normalizeText(opening);
  const b = normalizeText(closing);
  return [...candidates].filter(token => a.includes(token) && b.includes(token));
};

const startsWithSeasonDeceasedLife = opening => {
  const beginning = normalizeText(opening).slice(0, 80);
  if (hasForbiddenExpression(beginning)) return false;
  if (/[一-龥々〆ヵヶぁ-んァ-ンーA-Za-z0-9]{1,30}会館|ご参列|ご会葬|ご来場|お集まり|本日は/.test(beginning)) return false;
  return true;
};

const closingStartsWithSeasonalLanguage = closing => {
  const beginning = normalizeText(closing).slice(0, 40);
  return SEASONAL_STARTERS.some(word => beginning.startsWith(normalizeText(word)));
};

const safeOpenAiError = json => {
  const message = json?.error?.message || json?.message || "";
  const type = json?.error?.type || json?.type || "";
  const code = json?.error?.code || json?.code || "";
  return { message: String(message).slice(0, 500), type, code };
};

const narrationGivenName = name => {
  const raw = String(name || "").trim().replace(/様$/u, "");
  if (!raw) return "";
  const parts = raw.split(/[\s　]+/u).filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 1];
  const chars = Array.from(raw);
  if (chars.length >= 5) return chars.slice(-3).join("");
  if (chars.length >= 3) return chars.slice(-2).join("");
  return raw;
};

const nameRuleFromPrompt = prompt => {
  const sheet = extractPromptPayload(prompt)?.hearingSheet || {};
  const fullName = String(sheet.fullName || sheet.deceasedName || "").trim().replace(/様$/u, "");
  const givenName = String(sheet.narrationName || narrationGivenName(fullName)).trim().replace(/様$/u, "");
  return { fullName, givenName };
};

const replaceFullName = (text, prompt) => {
  const { fullName, givenName } = nameRuleFromPrompt(prompt);
  if (!givenName) return text;
  let output = String(text || "").replace(/(?:故人様|個人様)/g, `${givenName}様`);
  if (!fullName || fullName === givenName) return output;
  const escaped = fullName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return output.replace(new RegExp(`${escaped}様?`, "g"), `${givenName}様`);
};

const ensureOpeningFullNameIntro = (value, prompt) => {
  let text = String(value || "").trim();
  if (!text) return "";
  const { fullName, givenName } = nameRuleFromPrompt(prompt);
  if (!fullName || !givenName || fullName === givenName) return text;
  const fullLabel = `故${fullName}様`;
  const payload = extractPromptPayload(prompt);
  const age = String(payload?.hearingSheet?.age || "").trim();
  const exactLifeSentence = `${fullLabel}は、${age ? `${age}年という` : ""}尊いご生涯を閉じ、静かに人生の幕を下ろされました。`;
  const escapedGiven = givenName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedFull = fullName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  text = text
    .replace(new RegExp(`本日、?故?${escapedGiven}様とのお別れの時を迎えました。?`, "u"), "")
    .replace(new RegExp(`本日、?故?${escapedFull}様とのお別れの時を迎えました。?`, "u"), "")
    .replace(new RegExp(`本日、?${fullLabel}とのお別れの時を迎えました。?`, "u"), "")
    .trim();
  text = text
    .replace(new RegExp(`故${escapedFull}様は、?`, "u"), `${fullLabel}は、`)
    .replace(new RegExp(`故?${escapedGiven}様は、?`, "u"), `${fullLabel}は、`);
  // The model sometimes duplicates the surname or the 故 prefix. Replace the
  // entire fixed life-introduction sentence instead of trying to repair names.
  text = text.replace(
    /[^。\n]{0,140}(?:\d+|[〇零一二三四五六七八九十百]+)年という尊いご生涯を閉じ、静かに人生の幕を下ろされました。/u,
    exactLifeSentence
  );
  if (!text.slice(0, 220).includes(fullName)) {
    const firstSentence = text.match(/^(.+?[。！？])/u)?.[1] || "";
    text = firstSentence
      ? `${firstSentence}${exactLifeSentence}${text.slice(firstSentence.length).trimStart()}`
      : `${exactLifeSentence}${text}`;
  }
  return text;
};

const normalizeOpeningSeasonSentence = (value, prompt) => {
  const text = String(value || "").trim();
  const firstSentence = text.match(/^(.+?[。！？])/u)?.[1] || "";
  if (!firstSentence || !/(?:別れ|ご生涯|人生の幕|旅立|お見送り|葬送)/u.test(firstSentence)) return text;
  const payload = extractPromptPayload(prompt) || {};
  const season = String(payload.season || payload?.writingRules?.season || "").toLowerCase();
  const replacement = season.includes("spring") || season.includes("春")
    ? "やわらかな風に、春の気配を感じる頃となりました。"
    : season.includes("autumn") || season.includes("秋")
      ? "木々の葉が色づき始める頃となりました。"
      : season.includes("winter") || season.includes("冬")
        ? "澄んだ空気に、冬の深まりを感じる頃となりました。"
        : "蝉の声が遠く近くに響く、この季節。";
  return `${replacement}${text.slice(firstSentence.length).trimStart()}`;
};

const ensureOpeningFinalLine = value => {
  const fixed = "尽きることのない感謝の思いを胸に、まもなく開式のお時間でございます。";
  let text = String(value || "").trim();
  if (!text) return "";
  text = text
    .replace(/(?:[^。\n]*、)?尽きることのない感謝の思いを胸に、まもなく開式のお時間でございます。?\s*$/u, fixed)
    .replace(/\s*尽きることのない感謝の思いを胸に、まもなく開式のお時間でございます。?\s*$/u, "");
  return `${text.trim()}\n\n${fixed}`;
};

const normalizeOpeningAgeMentions = (value, prompt) => {
  const text = String(value || "");
  const age = String(extractPromptPayload(prompt)?.hearingSheet?.age || "").trim();
  if (!age) return text;
  const firstIndex = text.indexOf(`${age}年`);
  if (firstIndex < 0) return text;
  const splitIndex = firstIndex + `${age}年`.length;
  const head = text.slice(0, splitIndex);
  const tail = text.slice(splitIndex)
    .replace(new RegExp(`${age.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}年の歩み`, "gu"), "その歩み")
    .replace(new RegExp(`${age.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}年のご生涯`, "gu"), "そのご生涯")
    .replace(new RegExp(`${age.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}年という`, "gu"), "長い")
    .replace(new RegExp(`${age.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}年`, "gu"), "長い年月");
  return `${head}${tail}`;
};

const normalizeSpokenNumerals = value => String(value || "")
  .replace(/10月/gu, "十月")
  .replace(/親子3代/gu, "親子三代")
  .replace(/故\s*故\s*/gu, "故");

const limitDirectQuotes = draft => {
  let quoteCount = 0;
  const clean = value => String(value || "").replace(/「([^」]*)」/gu, (_match, inner) => {
    quoteCount += 1;
    return quoteCount === 1 ? `「${inner}」` : inner;
  });
  return {
    ...draft,
    openingNarration: clean(draft?.openingNarration),
    closingNarration: clean(draft?.closingNarration),
  };
};

const normalizeQuotationContext = draft => {
  const clean = value => {
    let text = String(value || "").replace(/「([^」]+)。」/gu, "「$1」");
    if (text.includes("「人の悪口を言ってはいけない」")) {
      text = text
        .replace(/人の悪口を言わず[、，]\s*/gu, "")
        .replace(/[^。\n]*人の悪口を言わないことを大切にされていました。[ \t]*/gu, "")
        .replace(
          /「人の悪口を言ってはいけない」[。]?\s*その(?:お)?言葉[^。]*。/gu,
          "「人の悪口を言ってはいけない」。"
        )
        .replace(
          /「人の悪口を言ってはいけない」[。]?\s*(?:前を向いて|人との関わり|その教え|その生き方|その考え)[^。]*。/gu,
          "「人の悪口を言ってはいけない」。"
        )
        .replace(
          /(?:^|\n)\s*「人の悪口を言ってはいけない」[。]?\s*(?=\n|$)/gu,
          "\n折に触れて口にされた、「人の悪口を言ってはいけない」という言葉。"
        )
        .replace(
          /(?:^|(?<=。)|\n)[^。\n]*「人の悪口を言ってはいけない」[^。\n]*。?/gu,
          "\n折に触れて口にされた、「人の悪口を言ってはいけない」という言葉。"
        );
    }
    return text
      .replace(
        /夏の陽ざしが、深まる季節でございます。/gu,
        "夏の陽ざしがまぶしさを増す頃でございます。"
      )
      .replace(/そのようなお時間もお持ちでした。?/gu, "")
      .replace(/帰宅後には、ご自宅で/gu, "帰宅後には、")
      .replace(
        /お姿が、ご家族の記憶に残っておられます。/gu,
        "お姿が、ご家族の記憶に残っています。"
      )
      .replace(
        /ゴルフへ出かける朝には、支度を整え、その一日へ向かわれる([^。\n]+?)の姿がありました。/gu,
        "ゴルフへ出かける朝、支度を整えられる$1のお姿。"
      )
      .replace(
        /ゴルフへ出かける朝には支度を整え、帰宅後にはゆっくりと過ごされる。そのお姿が、ご家族の記憶に残っています。/gu,
        "ゴルフへ出かける朝、支度を整えられるお姿。帰宅後、ゆっくりと過ごされるお姿も、ご家族の記憶に残っています。"
      )
      .replace(
        /帰宅されたあとは、ゆっくりと過ごされる時間がありました。その前後の静かな流れが、ご家族の記憶に残っております。/gu,
        "帰宅された後、ゆっくりと過ごされるお姿も、ご家族の記憶に残っています。"
      )
      .replace(
        /帰宅された後には、ゆっくりと過ごされる。その姿が、/gu,
        "帰宅された後、ゆっくりと過ごされるお姿が、"
      )
      .replace(/家を出ていかれる/gu, "出かけられる")
      .replace(
        /休日にはゴルフを楽しみ、広い空の下で、仲間とゴルフをする時間を楽しみにされていました。/gu,
        "休日には、広い空の下で仲間と楽しむゴルフの時間を、心待ちにされていました。"
      )
      .replace(
        /休日にはゴルフを楽しんでおられました。広い空の下で仲間とゴルフをする時間を、心待ちにされていました。/gu,
        "休日には、広い空の下で仲間と楽しむゴルフの時間を、心待ちにされていました。"
      )
      .replace(
        /穏やかで、多くを語らないお人柄でございました。/gu,
        "穏やかで、多くを語らないお人柄。"
      )
      .replace(
        /同じ時をともにするひとときは、[^。\n]+?にとって大切な楽しみの一つでございました。/gu,
        ""
      )
      .replace(/クラブを手に、そのひとときへ向かわれました。?/gu, "")
      .replace(
        /ご家族の記憶にまず浮かぶのは、(?:いつも)?笑っておられたお顔で、よく笑う方として思い出されます。/gu,
        "ご家族の記憶にまず浮かぶのは、よく笑っておられたお顔です。"
      )
      .replace(
        /親子三代で[、，]?\s*((?:お)?誕生日月の[^に。\n]+)に([^。\n]+?)へ旅行されました。/gu,
        "$1、親子三代で出かけられた$2への旅。"
      )
      .replace(
        /親子三代で[、，]\s*[^。\n]*?誕生日月(?:である|の)([^に、。\n]+)に[、，]\s*([^。\n]+?)へ旅行されました。/gu,
        "誕生日月の$1、親子三代で出かけられた$2への旅。"
      )
      .replace(
        /親子三代で[、，]\s*誕生日月の([^に、。\n]+)に([^。\n]+?)へ旅行なさいました。/gu,
        "誕生日月の$1、親子三代で出かけられた$2への旅。"
      )
      .replace(
        /それぞれの地名や十月という時期が思い起こされます。/gu,
        "その地名や十月に触れるたび、共に過ごした時間が思い起こされることでしょう。"
      )
      .replace(
        /家族を大切にされていた([^。\n]+?)と過ごしたその地名や十月という月は、これからも折々に思い起こされることでしょう。/gu,
        "その地名や十月に触れるたび、$1と共に過ごした時間が思い起こされることでしょう。"
      )
      .replace(
        /十月という月や訪れた地名に、/gu,
        "十月や訪れた地名に触れるたび、"
      )
      .replace(
        /親子三代で出かけられた、([^。\n]+への旅)/gu,
        "親子三代で出かけられた$1"
      )
      .replace(
        /それぞれの地名や十月という響きとともに、/gu,
        "それぞれの地名や十月に触れるたび、"
      )
      .replace(
        /その明るさを見習い、前向きに歩んでいきたいという思いを胸に、ご家族は今日の日を迎えておられます。/gu,
        "その明るさを見習い、前向きに歩んでいきたいという思いも、ご家族の胸にあります。"
      )
      .replace(
        /ご家族と([^。\n]+?)へ車で出かけることもありました。/gu,
        "ご家族と車で出かけられた、$1でのひととき。"
      )
      .replace(
        /そうした時間の中にも、([^。\n]+?)が家族と過ごす何気ない日常を大切にされていたことが思い起こされます。/gu,
        "家族と過ごす何気ない日常を大切にされた$1。"
      )
      .replace(
        /ご家族の胸には今、([^。\n]+?)が浮かんでいます。/gu,
        "ご家族の胸に浮かぶのは、$1ではないでしょうか。"
      )
      .replace(
        /今、ご家族の胸に浮かぶのは、([^。\n]+?)です。/gu,
        "ご家族の胸に浮かぶのは、$1ではないでしょうか。"
      )
      .replace(
        /今、ご家族が思い出されるのは、([^。\n]+?)です。/gu,
        "ご家族の胸に浮かぶのは、$1ではないでしょうか。"
      )
      .replace(
        /いま思い出されるのは、([^。\n]*?笑顔)です。/gu,
        "ご家族の胸に浮かぶのは、$1ではないでしょうか。"
      )
      .replace(
        /今、ご家族の胸には、その([^。\n]*?笑顔)が思い出されています。/gu,
        "ご家族の胸に浮かぶのは、あの$1ではないでしょうか。"
      )
      .replace(
        /ご家族の胸には、([^。\n]*?笑顔)が思い出されます。/gu,
        "ご家族の胸に浮かぶのは、$1ではないでしょうか。"
      )
      .replace(
        /(?:これからも、)?ご家族の胸には、([^。\n]*?笑顔)が思い出されることでしょう。/gu,
        "これから先も、その$1は、ご家族の胸に浮かぶことでしょう。"
      )
      .replace(
        /いまご家族は、([^。\n]+?)を思い出しておられます。/gu,
        "ご家族の胸に浮かぶのは、$1ではないでしょうか。"
      )
      .replace(
        /穏やかな笑顔を思い出すご家族のお気持ちとともに、その時間が思い起こされます。/gu,
        "その時間を思うとき、ご家族の胸に浮かぶのは、穏やかな笑顔ではないでしょうか。"
      )
      .replace(
        /[^。\n]+?へ向かわれた時間も、その表情とともに思い起こされます。/gu,
        ""
      )
      .replace(
        /近くの山へ向かった時間も、その日常の中にあった一場面でございました。/gu,
        ""
      )
      .replace(
        /ご家族と近くの山へ車で出かけることがあり、そうした時間と、家族と過ごす何気ない日常を、([^。\n]+?)は大切にしておられました。/gu,
        "ご家族と車で出かけられた、近くの山でのひとときには、何気ない日常を大切にされた$1のお姿がありました。"
      )
      .replace(
        /近くの山へ向かった日も、日常の中で重ねた時間も、静かに胸に浮かびます。/gu,
        ""
      )
      .replace(
        /近くの山へ向かった時間と、共に過ごした日々が、静かに胸に残ります。/gu,
        ""
      )
      .replace(
        /ご家族と([^。\n]+?)へ[、，]?\s*車で出かけることがありました。ともに向かう時間も、家族と過ごす何気ない日常を大切にされた([^。\n]+?)の大切なひとときでございました。いま、ご家族の胸に思い出されるのは、([^。\n]+?)です。/gu,
        "ご家族と車で出かけられた、$1でのひととき。そこには、何気ない日常を大切にされた$2のお姿がありました。ご家族の胸に浮かぶのは、$3ではないでしょうか。"
      )
      .replace(
        /家族と過ごす何気ない日常を大切にされた([^。\n]+?)の大切なひととき/gu,
        "家族と過ごす何気ない日常を大切にされた$1のひととき"
      )
      .replace(/[ \t]+\n/gu, "\n")
      .replace(/\n{3,}/gu, "\n\n")
      .trim();
  };
  let openingNarration = clean(draft?.openingNarration);
  const closingNarration = clean(draft?.closingNarration);
  if (/笑顔/u.test(closingNarration)) {
    openingNarration = openingNarration
      .replace(/ご家族にはよく微笑んでおられ、その表情が心に残ります。?/gu, "")
      .replace(/言葉は少なくとも、ご家族にはよく微笑んでおられました。?/gu, "")
      .replace(/言葉を多く重ねることはなく、ご家族にはよく微笑んでおられました。?/gu, "")
      .replace(/ご家族にはよく微笑まれ、その表情をご家族は思い出されています。?/gu, "")
      .replace(/家族にはよく微笑んでおられ、その穏やかな表情も思い出されます。?/gu, "")
      .replace(
        /穏やかで、多くを語らない([^。\n]*?)は、ご家族によく微笑んでおられました。?/gu,
        "穏やかで、多くを語らない$1。"
      )
      .replace(
        /穏やかで多くを語らず、ご家族にはよく微笑んでおられました。?/gu,
        "穏やかで、多くを語らない方でした。"
      )
      .split(/(?<=。)/u)
      .filter(sentence => !(/ご家族には/u.test(sentence) && /微笑/u.test(sentence)))
      .join("");
  }
  return {
    ...draft,
    openingNarration: openingNarration.replace(/\n{3,}/gu, "\n\n").trim(),
    closingNarration: closingNarration.replace(/\n{3,}/gu, "\n\n").trim(),
  };
};

const removeUnsupportedAudiencePhrasing = value => String(value || "")
  .replace(/今日(?:ここ|この場)に集う皆様/gu, "皆様")
  .replace(/(?:ここ|この場)に集う皆様/gu, "皆様");

const applyNameRule = (draft, prompt) => ({
  ...draft,
  openingNarration: normalizeSpokenNumerals(
    normalizeOpeningAgeMentions(
      ensureOpeningFinalLine(
        ensureOpeningFullNameIntro(
          normalizeOpeningSeasonSentence(
            removeUnsupportedAudiencePhrasing(replaceFullName(draft.openingNarration, prompt)),
            prompt
          ),
          prompt
        )
      ),
      prompt
    )
  ),
  closingNarration: normalizeSpokenNumerals(
    ensureClosingFinalLine(
      stripFixedClosingOpening(
        removeUnsupportedAudiencePhrasing(replaceFullName(draft.closingNarration, prompt))
      ),
      prompt
    ),
  ),
});

const shouldUseResponsesApi = model => String(model || "").trim().startsWith("gpt-5.5");

const collectResponsesText = json => {
  if (typeof json?.output_text === "string" && json.output_text.trim()) return json.output_text;
  const chunks = [];
  const addChunk = value => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (trimmed) chunks.push(trimmed);
  };
  for (const item of json?.output || []) {
    addChunk(item?.text);
    addChunk(item?.output_text);
    for (const part of item?.content || []) {
      addChunk(part?.text);
      addChunk(part?.text?.value);
      addChunk(part?.output_text);
      addChunk(part?.content);
      addChunk(part?.message);
    }
  }
  if (chunks.length) return [...new Set(chunks)].join("\n");

  const recursiveChunks = [];
  const visit = value => {
    if (!value) return;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed && /openingNarration|closingNarration|開式前|閉式後|\{/.test(trimmed)) {
        recursiveChunks.push(trimmed);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object") return;
    Object.entries(value).forEach(([key, child]) => {
      if (["usage", "metadata", "response_metadata"].includes(key)) return;
      visit(child);
    });
  };
  visit(json);
  return [...new Set(recursiveChunks)].join("\n");
};

const responseCompletionDiagnostics = (json, text, source) => ({
  source,
  responseStatus: json?.status || "",
  incompleteReason: json?.incomplete_details?.reason || json?.incomplete_details?.message || "",
  outputTextLength: String(text || "").length,
  outputTokens: json?.usage?.output_tokens || json?.usage?.output_tokens_details?.total_tokens || null,
  totalTokens: json?.usage?.total_tokens || null,
});

const responseLooksIncomplete = json =>
  json?.status === "incomplete" ||
  !!json?.incomplete_details ||
  String(json?.finish_reason || "").toLowerCase() === "length";

const hasWeakGenericNarration = text => {
  const compact = normalizeText(text);
  const weakWords = [
    "温かいお人柄",
    "たくさんの思い出",
    "感謝の気持ち",
    "かけがえのない",
    "大切な思い出",
    "優しい笑顔",
    "見守って",
  ].map(normalizeText);
  let hits = 0;
  weakWords.forEach(word => {
    if (compact.includes(word)) hits += 1;
  });
  return hits >= 4;
};

const BAD_CLOSING_TIMELINE_RE = /お別れのあと|お別れの後|お別れを済ませた今|お別れのひとときを過ごした今|お別れのひとときを終えた今/u;
const POLITE_ENDING_RE = /(?:でございます|でございました|ございます|ございました|ことと存じます|存じます|でしょう|おります|おりました|です|でした|ます|ました)$/u;

const countDirectQuotes = text => (String(text || "").match(/「[^」]*」/gu) || []).length;

const hasExcessiveConsecutivePoliteEndings = text => {
  const withoutFixed = String(text || "")
    .replace(/^[^。\n]*(?:季節|頃)[^。\n]*。?/u, "")
    .replace(/故[^。\n]+様は、[^。\n]+尊いご生涯を閉じ、静かに人生の幕を下ろされました。?/u, "")
    .replace(/尽きることのない感謝の思いを胸に、まもなく開式のお時間でございます。?/u, "")
    .replace(/(?:\d+|[〇零一二三四五六七八九十百]+)年のご生涯に心からの敬意を表し、過ごしてまいりました葬送のひととき。[\s\S]*?どうぞよろしくお願いいたします。?/u, "");
  return withoutFixed.split(/\n{2,}/u).some(paragraph => {
    const sentences = paragraph.split(/[。！？]/u).map(value => value.trim()).filter(Boolean);
    for (let index = 2; index < sentences.length; index += 1) {
      if (
        POLITE_ENDING_RE.test(sentences[index - 2]) &&
        POLITE_ENDING_RE.test(sentences[index - 1]) &&
        POLITE_ENDING_RE.test(sentences[index])
      ) return true;
    }
    return false;
  });
};

const hasStackedNounFragments = text => {
  const sentences = String(text || "")
    .split(/[。！？]/u)
    .map(value => value.trim())
    .filter(Boolean);
  const nounEnding = /(?:時間|日々|お姿|笑顔|思い出|記憶|ひととき|歩み|毎日|言葉)$/u;
  for (let index = 1; index < sentences.length; index += 1) {
    if (
      sentences[index - 1].length <= 28 &&
      sentences[index].length <= 28 &&
      nounEnding.test(sentences[index - 1]) &&
      nounEnding.test(sentences[index])
    ) return true;
  }
  return false;
};

const hasBrokenJapaneseGrammar = text => {
  const value = String(text || "");
  const sentences = value
    .split(/[。！？\n]/u)
    .map(part => part.trim())
    .filter(Boolean);

  return sentences.some(sentence => {
    // Examples: 「明るく前向きにが残る」「家族を大切にしていたを大切にされた」
    if (/(?:にが|をを|をが|がを|がが|はを|はが|にを|をに|がに|はに)(?=[ぁ-んァ-ヶ一-龠々])/u.test(sentence)) return true;
    if (/して(?:いた|いる|おられた|こられた)を(?:大切|楽しみ|喜び)/u.test(sentence)) return true;

    // Catch the known incomplete form without rejecting natural wording such as
    // 「歌ったり、踊ったりされるお姿が思い出されます」.
    if (/たり[^。！？]{0,35}たりして[、\s]*(?:かわいらしい|可愛い)お姿$/u.test(sentence)) return true;

    // Catch common duplicated transformations produced from raw hearing-sheet wording.
    if (/(?:大切にしていた|楽しんでいた|育てていた)を(?:大切にされた|楽しまれた|育てられた)/u.test(sentence)) return true;
    return false;
  });
};

const hasExcessiveSmileRepetition = opening => {
  const matches = String(opening || "").match(/笑(?:顔|う|い|って|われ|み|声)/gu) || [];
  return matches.length >= 3;
};

const hasAgeRepetition = (text, prompt) => {
  const age = String(extractPromptPayload(prompt)?.hearingSheet?.age || "").trim();
  if (!age) return false;
  const escapedAge = age.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (String(text || "").match(new RegExp(`${escapedAge}年`, "gu")) || []).length > 2;
};

const hasInventedMotivationalRewrite = (text, prompt) => {
  const motivational = /明るく前向きに(?:歩んで|進んで|生きて|過ごして)いきたい/u;
  const outputHasPhrase = motivational.test(String(text || ""));
  if (!outputHasPhrase) return false;
  // This wording is not an invention when the family supplied it themselves.
  return !motivational.test(String(prompt || ""));
};

const hasOutsiderAtmosphereClaim = text =>
  /(?:その場|場の|周りの)[^。]{0,12}空気(?:まで|を)?[^。]{0,24}明る/u.test(String(text || ""));

const hasUnsafeInterpretiveLanguage = (text, prompt) => {
  const value = String(text || "");
  if (/その場にある時間/u.test(value)) return true;
  if (/前を向いて(?:動か|歩|進)/u.test(value)) return true;
  if (/(?:知る方々|周りの方々?)にとって/u.test(value)) return true;
  if (/忘れがたい声/u.test(value)) return true;
  if (/どうぞ[^。]{0,60}(?:お進み|歩んで|携えながら)/u.test(value)) return true;
  if (/(?:時間|日々)[、，]\s*そして[^。]{0,40}(?:時間|日々)/u.test(value)) return true;
  if (/いつも可愛い方だった/u.test(value)) return true;
  if (/手芸の品/u.test(value) && !/手芸の品/u.test(String(prompt || ""))) return true;
  if (/(?:笑い声|笑み)の向こうに/u.test(value)) return true;
  if (/その時その時を大切に/u.test(value)) return true;
  if (/ご自分で動き出される(?:力|強さ)/u.test(value)) return true;
  if (/特別に(?:言葉を尽くさ|飾ら)/u.test(value)) return true;
  if (/同じ時間を過ごすことそのものが/u.test(value)) return true;
  if (/土に(?:ふれ|触れ)/u.test(value) && !/土/u.test(String(prompt || ""))) return true;
  if (/落ち着いた日々/u.test(value) && !/落ち着/u.test(String(prompt || ""))) return true;
  if (/(?:お過ごしください|思い浮かべていただけ|お心をお寄せ|お気持ちをお花に託|お別れとなりますように)/u.test(value)) return true;
  return false;
};

const hasAwkwardNarrationStyle = text => {
  const value = String(text || "");
  if (/明るさを重ね/u.test(value)) return true;
  if (/ではないでしょうか/u.test(value)) return true;
  if (/ご家族には[^。]{0,40}映っておりました/u.test(value)) return true;
  if ((value.match(/ご家族と(?:ともに)?過ごされた(?:日々|日常|時間)/gu) || []).length > 1) return true;
  if (/よく笑う人でいらっしゃいました/u.test(value)) return true;
  if (/可愛らしく感じておられたことと存じます/u.test(value)) return true;
  if (/(?:旅行|旅)[^。]{0,45}(?:月|十月|九月)[^。]{0,20}重ねられた/u.test(value)) return true;
  if (/折に触れて口にされた、?「[^」]+」という言葉。/u.test(value)) return true;
  if (/「[^」]+」という言葉。\s*尽きることのない感謝/u.test(value)) return true;
  if (/(?:^|[。\n])\s*(?:そして、?)?[^。！？]{0,45}(?:しておられた|されていた)こと。/u.test(value)) return true;
  if (/そのお姿は[^。]{0,50}(?:チエノ様|ご本人)[^。]{0,16}お姿でした/u.test(value)) return true;
  if (/(?:歌ったり|踊ったり)[^。]{0,35}することもありました/u.test(value)) return true;
  if (/いつも可愛(?:い|らしい)[^。]{0,25}とのこと/u.test(value)) return true;
  return false;
};

const hasReporterDistance = text => {
  const value = String(text || "");
  if (/(?:お顔|お姿|笑顔)(?:である|だった)?とのこと(?:です|でございます)?/u.test(value)) return true;
  if (/(?:といいます|と聞いております|と聞かれます)/u.test(value)) return true;
  if (/お方でいらっしゃいました/u.test(value)) return true;
  if (/皆様が(?:よく)?ご存じでいらっしゃいます/u.test(value)) return true;
  if (/ご家族が(?:そう)?語ってくださった/u.test(value)) return true;
  if (/暮らしに寄り添う楽しみ/u.test(value)) return true;
  if (/「[^」]+」[^。]{0,80}(?:人との向き合い方|生き方|考え方|教え|まなざし)[^。]{0,40}(?:伝え|表し|にじ)/u.test(value)) return true;
  return false;
};

const hasResidualAiNarration = text => {
  const value = String(text || "");
  if (/(?:とうかがっております|と伺っております)/u.test(value)) return true;
  if (/いつも笑っているお顔でした/u.test(value)) return true;
  if (/ご本人らしい(?:まめやかさ|丁寧さ|温かさ|優しさ)/u.test(value)) return true;
  if (/言葉にしすぎなくても/u.test(value)) return true;
  if (/(?:深い)?敬意をもって向き合/u.test(value)) return true;
  if (/(?:耳|胸|心)に(?:そっと)?戻ってくる/u.test(value)) return true;
  if (/その場にあった[^。]{0,30}(?:しぐさ|表情|時間)/u.test(value)) return true;
  if (/育つものに触れながら/u.test(value)) return true;
  if (/注がれたものへ/u.test(value)) return true;
  if (/日々の重なり/u.test(value)) return true;
  if (/家族の中にある何気ない時間/u.test(value)) return true;
  if (/かけがえのないものとして重ね/u.test(value)) return true;
  return false;
};

const qualityCheckNarration = ({ openingNarration, closingNarration }, prompt) => {
  const opening = String(openingNarration || "");
  const closing = String(closingNarration || "");
  const full = `${opening}\n${closing}`;
  const venueNames = buildVenueNames(prompt);
  const failures = [];
  if (!opening.trim() || !closing.trim()) failures.push("missing narration");
  if (/\[(?:OPENING|CLOSING)\]|【(?:開式前|閉式後)(?:ナレーション)?】/iu.test(full)) failures.push("control label leaked");
  const { fullName, givenName } = nameRuleFromPrompt(prompt);
  const bodyWithoutRequiredClosings = full
    .replace(/①\s*葬儀のみ[\s\S]*?ご葬儀を閉式いたします。?/u, "")
    .replace(/②\s*葬儀[＋+・]初七日[\s\S]*?初七日法要を執り納めさせていただきます。?/u, "")
    .replace(/(?:\d+|[〇零一二三四五六七八九十百]+)年のご生涯に心からの敬意を表し、過ごしてまいりました葬送のひととき。[\s\S]*?どうぞよろしくお願いいたします。?/u, "");
  const bodyAfterAllowedIntro = fullName && givenName && fullName !== givenName
    ? bodyWithoutRequiredClosings.replace(new RegExp(`^([\\s\\S]{0,220})${fullName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u"), "$1")
    : bodyWithoutRequiredClosings;
  if (fullName && givenName && fullName !== givenName && bodyAfterAllowedIntro.includes(fullName)) failures.push("full name");
  if (hasVenueName(full, venueNames)) failures.push("venue name");
  if (hasForbiddenExpression(opening)) failures.push("attendee greeting");
  if (hasRepeatedExpressions(full)) failures.push("repeated expression");
  if (hasWeakGenericNarration(full)) failures.push("weak generic narration");
  if (!haveDifferentContent(opening, closing)) failures.push("opening closing overlap");
  // A single Japanese fact can naturally share several 2-3 character fragments.
  // Require broader overlap so one repeated word does not reject the whole draft.
  if (repeatedContentNgrams(opening, closing, prompt).length >= 24) failures.push("reused hearing facts");
  if (!startsWithSeasonDeceasedLife(opening)) failures.push("opening order");
  if (closingStartsWithSeasonalLanguage(closing)) failures.push("closing seasonal opening");
  if (/[、,]\s*この季節となりました/u.test(opening)) failures.push("seasonal grammar");
  const closingNarrativePrefix = closing.split(
    /(?:\d+|[〇零一二三四五六七八九十百]+)年のご生涯に心からの敬意を表し/u
  )[0];
  if (hasForbiddenExpression(closingNarrativePrefix)) failures.push("closing fixed greeting");
  if (BAD_CLOSING_TIMELINE_RE.test(closing)) failures.push("closing timeline");
  if (countDirectQuotes(full) > 1) failures.push("too many direct quotes");
  if (hasExcessiveConsecutivePoliteEndings(bodyWithoutRequiredClosings)) failures.push("excessive polite endings");
  if (hasStackedNounFragments(bodyWithoutRequiredClosings)) failures.push("stacked noun fragments");
  if (hasBrokenJapaneseGrammar(bodyWithoutRequiredClosings)) failures.push("broken Japanese grammar");
  if (hasExcessiveSmileRepetition(opening)) failures.push("excessive trait repetition");
  if (hasAgeRepetition(full, prompt)) failures.push("age repetition");
  if (hasInventedMotivationalRewrite(full, prompt)) failures.push("invented family feeling");
  if (hasOutsiderAtmosphereClaim(full)) failures.push("outsider perspective");
  if (hasUnsafeInterpretiveLanguage(full, prompt)) failures.push("unsafe interpretation");
  if (hasAwkwardNarrationStyle(bodyWithoutRequiredClosings)) failures.push("awkward narration style");
  if (hasReporterDistance(bodyWithoutRequiredClosings)) failures.push("reporter distance");
  if (hasResidualAiNarration(bodyWithoutRequiredClosings)) failures.push("residual AI narration");
  const closingBody = closing
    .replace(/(?:\d+|[〇零一二三四五六七八九十百]+)年のご生涯に心からの敬意を表し、過ごしてまいりました葬送のひととき。[\s\S]*?どうぞよろしくお願いいたします。?/u, "")
    .trim();
  if (closingBody.length < 40) failures.push("closing too short");
  return { ok: failures.length === 0, failures };
};

const buildLegacySystemPrompt = extraInstruction => [
  "ABSOLUTE FACT BOUNDARY: every concrete noun, action, place, conversation, reaction, facial expression, routine, motive, feeling, and scene must be explicitly present in the Hearing Sheet. Never add meals, rooms, windows, roads, scenery, photographs, homecoming, things shown to family, checking how plants grew, travel conversations, family reactions, or the deceased's inner feelings unless the Hearing Sheet states them. Making a scene vivid does not permit invention.",
  "FAMILY-INSIDE PERSPECTIVE: stay close to what the family actually remembers. Do not write an outsider's character evaluation and do not claim what the family felt unless that feeling is explicitly provided. Prefer the family's concrete fact over a polished interpretation.",
  "SENTENCE-END AUDIT: do not mechanically alternate endings. Two natural polite sentences may stand together, but never allow three in a row with the same です/ます rhythm outside fixed guidance. Do not escape into stacked noun fragments such as 手芸に向かわれる時間。野菜を育てる時間。 Use at most one deliberate noun-ending sentence in a paragraph, and only when it sounds complete aloud. Prefer connecting closely related facts into one grammatical sentence.",
  "NATURAL-JAPANESE POLISH: state one idea once. Never repeat お姿 twice in one sentence, never write 明るさを重ねる, and never leave a sentence as 家族を大切にしておられたこと。 Avoid flat reporting such as 歌ったり踊ったりすることもありました or いつも可愛いとのこと. Describe the supplied scene directly and finish every sentence with a natural predicate.",
  "FAMILY-NEAR VOICE: never expose the interview process. Do not write お顔とのことです, お方でいらっしゃいました, 皆様がよくご存じです, or ご家族が語ってくださった. Do not explain a supplied quotation as a philosophy, 教え, 人との向き合い方, 生き方, or 考え方. Let the exact words remain close to the family's memory without an outsider's interpretation.",
  "NO AI COMMENTARY: do not write とうかがっております, ご本人らしいまめやかさ, 言葉にしすぎなくても, 敬意をもって向き合います, or 耳にそっと戻ってくる. Do not narrate the writing process or add a polished interpretation. Stay with the supplied action, expression, place, or words.",
  "DIRECT-QUOTE LIMIT: use at most one 「...」 quotation across openingNarration and closingNarration together, and only when the exact spoken words are present in the Hearing Sheet.",
  "CEREMONY TIMELINE: closingNarration is read after the officiant has left and before flowers are offered. Never write お別れのあと, お別れを済ませた今, お別れのひとときを過ごした今, or お別れのひとときを終えた今.",
  "REPETITION AUDIT: do not restate the same family phrase in adjacent sentences. If the Hearing Sheet says 笑っている顔しか思い出せない, use that idea only once and do not immediately explain again that the person often laughed. A main trait such as 笑顔 or 明るさ should normally appear no more than twice in openingNarration and must not be repeated as a summary in closingNarration.",
  "Do not turn a supplied phrase into an abstract interpretation. After quoting 人の悪口を言ってはいけない, do not invent a gaze, philosophy, or claim about preserving relationships. Let the supplied words stand with only a restrained factual connection.",
  "Never use audience-observer wording such as 今日ここに集う皆様, この場に集う皆様, or the room became brighter. Use 皆様 only when needed.",
  "If the family says 明るさを見習いたい, keep close to that wording. Do not transform it into a motivational slogan such as 前向きに歩んでいきたい.",
  "You are the dedicated funeral MC for Asuka Hall with more than 20 years of funeral MC experience. You are not an essay writer, novelist, or general AI assistant.",
  "Return only JSON with openingNarration, closingNarration, detectedTheme, improvementNotes. Put an empty string in improvementNotes.",
  "This is Asuka Hall narration generation AI in Hisako style. Compass AI is not an AI that explains the deceased. Compass AI helps the family feel, 'this is truly who they were.'",
  "Most important quality standard: aim for quiet afterglow, visible scenes, a structure where the deceased's character is naturally felt, writing that does not explain too much, and a tone that never over-directs emotion. Do not write to make people cry; write so the family can feel as if the deceased is present in the room.",
  "Style guide: this narration is spoken aloud by an MC. It is not text for silent reading. Prioritize beauty when heard by ear: short sentences, natural punctuation, and places where the MC can breathe.",
  "MC perspective: this is not a novel, essay, or introduction of the deceased. Always keep the air of 'the MC is speaking quietly in this ceremony hall right now.' The aim is not to move the listener by force, but for the deceased's presence to naturally come to mind while listening.",
  "Highest priority: write grammatically correct, natural Japanese from the beginning. Correct subject-predicate agreement, complete every sentence, and make every sentence meaningful on its own.",
  "Do not use unclear pronouns such as 彼, 彼女, or 私. Do not speak for the family's private feelings unless the input explicitly says so. Do not invent emotions, life philosophy, or values not present in the input.",
  "Prefer natural, readable Japanese over difficult, poetic, or ornate expressions. Output only the completed openingNarration and closingNarration; never output drafts, evaluation, correction process, step labels, or notes.",
  "Never generate broken Japanese, casual fragments, or unclear first-person lines from the family's point of view. Every sentence must have a natural subject and predicate and must be suitable for an MC to read aloud.",
  "Prefer one carefully drawn scene, one gesture, one smile, or one memory over many packed facts. Places such as a field, garden, kitchen, trip, workplace, dining table, or family room are useful only when they come from the Hearing Sheet.",
  "The narration must not aim to make attendees cry. The highest priority is that the family feels, 'this is exactly who they were.'",
  "Use only the Compass Hearing Sheet fields included in the prompt: deceased name, date of passing, personality, hobbies, family memories, important episodes, favorite phrases, important values, keywords, and notes.",
  "Gender and the family relationship to the deceased are only auxiliary information for natural Japanese expression. Use them only when they do not conflict with the Hearing Sheet, such as お母様らしい優しさ, お父様として家族を支えられた, or お祖母様としてお孫様を見守られた. Never decide personality from gender or relationship alone, and never invent facts from them.",
  "Do not invent facts that are not in the prompt. If information is missing, omit it naturally. Never ask for more information.",
  "Do not infer the deceased's inner life, life philosophy, forgiveness, purity of heart, or outlook beyond what the family actually said. Expressions such as 自分の心を濁さずに生きる, 人生を前向きに受け止めた, or 人を許すことを大切にした are allowed only when clearly supported by the Hearing Sheet.",
  "When describing values, stay close to observable actions, family quotes, habits, and scenes. If a thought or philosophy is not directly supported, soften it or omit it.",
  "Select information before writing. Do not force every input detail into the narration. Prioritize the episode that best reveals the deceased's character, and describe it carefully. If needed, omit less important details. Character clarity matters more than information volume.",
  "QUALITY CHECK REQUIRED BEFORE ANSWERING: no venue names, no generic attendee greetings in openingNarration or closingNarration, no repeated expressions, and openingNarration and closingNarration must have different content.",
  "Name rule: after the opening seasonal sentence, use one fixed life-introduction sentence with 故 plus the full name: '故{fullName}様は、{age}年という尊いご生涯を閉じ、静かに人生の幕を下ろされました。'. Do not also write '本日、故{fullName}様とのお別れの時を迎えました。'. Use 故 plus the full name only in that opening life-introduction sentence. Everywhere else, use only the given name plus 様 when a name is needed. Never write 故人様 or 個人様 in the narration body.",
  "Do not repeat the deceased's given name more than necessary. After using the name once in a section, use natural Japanese references such as そのお姿, ご本人, その笑顔, or omit the subject where Japanese sounds natural. Do not use 故人様 or 個人様. Keep required fixed final lines unchanged.",
  "Strictly forbidden expressions: 飛鳥会館にお集まりいただき; ○○会館にお集まりいただき; 本日はご参列いただき; 本日はご会葬賜り; ご来場ありがとうございます; ご参列ありがとうございます; ご会葬ありがとうございます; 本日はありがとうございます.",
  "Never include venue names or generic attendee greetings in openingNarration or closingNarration. The closing must not start with attendee thanks; it must begin from the afterglow of farewell, the deceased's character, the family's feelings, or a warm memory that remains.",
  "The opening narration must always begin in this order: season, then the deceased, then life. Never begin with venue, attendees, or greetings.",
  "Do not keep the deceased waiting behind a long seasonal preface. The seasonal sentence is only atmosphere. Immediately after it, write the single required life-introduction sentence with the full name. Do not add a separate farewell bridge sentence.",
  "The first seasonal sentence should preferably end with この季節, 季節となりました, 頃となりました, or 頃でございます. Examples: '青葉を渡る風がやわらかく感じられるこの季節。' '夏の陽射しがまぶしく降り注ぐ頃となりました。'",
  "Seasonal grammar: choose either '蝉の声が遠く近くに響くこの季節。' or '蝉の声が遠く近くに響く季節となりました。'. Never write the mixed and unnatural form '響く、この季節となりました。'. Do not place a comma immediately before この季節.",
  "Seasonal language is allowed only in openingNarration. closingNarration must never start with seasonal language or seasonal scenery.",
  "Before writing, internally determine exactly one life theme for this deceased, such as family love, hard work, smile, challenge, compassion, sincerity, love of nature, teaching others, or community. This theme is the axis of the whole narration.",
  "Do not treat all input facts equally. Give the most space to facts and episodes that support the selected theme. Keep facts unrelated to the theme short, or omit them when the narration would become a list.",
  "Put the selected theme in detectedTheme when JSON is requested, but never display the theme label, analysis, or selection process to the user. The user should see only the completed narration.",
  "Opening narration and closing narration have different jobs. Do not make the closing a shorter summary of the opening.",
  "The narration is not a resume. Do not arrange life in strict chronological order. Express personality, daily life, family time, hobbies, and treasured values as one gentle story.",
  "Opening narration should be 60-70% of the total. Select no more than three Hearing Sheet facts that best show this person. Do not try to include personality, family, hobbies, work, travel, and favorite words all at once.",
  "Closing narration should be 30-40% of the total. It begins with a different Hearing Sheet fact from openingNarration and connects quietly to the flower-farewell guidance.",
  "Closing narration must not retell the life story or announce that farewell has already finished. Use only family feelings explicitly supplied in the Hearing Sheet. Do not invent what remains in their hearts. Do not begin with fixed attendee thanks such as '本日はご多用の中、ご会葬いただき誠にありがとうございました。'.",
  "Use this opening structure exactly: 1) one refined seasonal sentence ending like この季節 or 頃となりました, 2) '故{fullName}様は、{age}年という尊いご生涯を閉じ、静かに人生の幕を下ろされました。', 3) no more than three selected facts or memories, 4) close exactly with '尽きることのない感謝の思いを胸に、まもなく開式のお時間でございます。'.",
  "Use this closing structure: 1) begin with one or two concrete Hearing Sheet facts not used anywhere in openingNarration, 2) connect them to an explicitly supplied family feeling without retelling personality, 3) leave one restrained afterglow sentence. Do not write the flower-farewell guidance, attendee thanks, age-respect sentence, or any formal closing declaration; the server appends the fixed guidance exactly once after generation.",
  "Because the fixed flower-farewell guidance begins with '{age}年のご生涯', do not write another age phrase such as '{age}年の歩み' or '{age}年のご生涯' immediately before it. If you need that idea, use the given name plus 様, その歩み, or そのご生涯 instead.",
  "If the hearing sheet is sparse, write a shorter dignified narration instead of padding. Never fill missing details with generic praise.",
  "Specific memory is stronger than a beautiful adjective. Prefer one true detail from the hearing sheet over abstract phrases such as warmth, bonds, gratitude, precious, irreplaceable, or watching over.",
  "When there is too much information, reduce rather than list. Choose the few details that make the family feel 'this is them' and let each selected scene breathe.",
  "Do not merely turn information into polished sentences. Turn it into remembered moments. A human MC writes memories, not summaries.",
  "Never convey personality only with explanatory sentences such as '〇〇な人でした.' Show character through actions, facial expressions, daily habits, and how the deceased related to the people around them.",
  "The goal is not simply a good sentence. The family should feel, 'this sounds like them.' Keep facts, avoid exaggeration, and avoid invented details.",
  "Do not rely on common fixed funeral phrases. Avoid repeated use of phrases like 'そのお気持ちが何よりの供養となることでしょう。', '安らかなるご冥福をお祈り申し上げます。', or '在りし日のお姿を偲び'. Use them only when truly necessary, and prefer a closing that follows this person's own life and memories.",
  "Final polish pass: revise as Hisako's funeral MC manuscript. Calm, readable aloud, not sentimental, not over-written, no AI-like closing, and no sentence that a family could not recognize as their own.",
  "Never describe the same episode twice. If an episode is used in openingNarration, closingNarration may explain why it mattered or what remains in the family's hearts, but must not summarize or narrate that episode again.",
  "Write as a script to be read aloud, not as an article. Prioritize rhythm, breathing, emotional pacing, warmth, and quiet dignity over beautiful literary style.",
  "You are not writing literature. You are the professional funeral MC standing in front of the family. Judge every sentence by how it will sound aloud in the room.",
  "The narration must be easy for the MC to read and comfortable for attendees to hear. If a sentence feels clever on the page but unnatural in the ceremony hall, rewrite it plainly.",
  "For listenability, one sentence should carry one image or one feeling. Do not pack multiple images, facts, or emotions into one sentence.",
  "Do not repeat the same sentence ending three times in a row. Vary endings such as されました, ございました, でした, ことでしょう, and ことと存じます.",
  "Do not repeat the same words many times, especially 大切, 笑顔, 優しい, 温かい, 思い出, 感謝. Use a different concrete scene or phrasing instead.",
  "Do not rely on convenient beautiful words such as 静かに, 穏やかに, やわらかく, 胸に, ぬくもり, 面影, 支え, or 心に残る as repeated defaults. Choose words that fit this specific person's character, life, habits, and family memories.",
  "Keep a consistent professional MC tone, but let every narration feel like a different life. The vocabulary, atmosphere, and selected scenes should change according to the deceased, not follow a fixed Compass AI pattern.",
  "When describing a memory, slow down and isolate the small moment: a vegetable growing a little, one flower blooming, someone humming a song, a laugh at the table, or a family conversation. Let that one moment carry the feeling.",
  "Use plain, natural Japanese funeral MC wording. Avoid ornate metaphors, dramatic expressions, clever conclusions, sales-like polish, and phrases that sound like AI.",
  "Avoid forceful, preachy, or strongly religious wording. Keep the tone warm, refined, calm, and natural for a funeral MC.",
  "Do not overuse sentence endings such as でございました, ことでしょう, or ことと存じます. Never use the same ending pattern in consecutive sentences. Vary the rhythm with natural Japanese endings.",
  "Treat ことと存じます, ことでしょう, and でございました as limited formal endings. Do not use any one of them more than twice in the whole manuscript unless there is no natural alternative. Prefer varied endings such as 心に残っております, 胸に息づいております, 覚えておられることでしょう, 支えとなります, and 静かに残ります.",
  "Avoid closing or transition phrases that sound templated, such as この音の中, 笑顔の温度, 明るい方へ, 前を向いて歩む, or 気持ちを明るい方へ向ける. Prefer plain MC wording that a family can hear naturally.",
  "Do not repeat the same memory-inviting introduction. Rotate naturally among expressions such as 今も皆様の胸によみがえるのは, ふと思い返されるのは, 皆様の心に浮かぶのは, ご家族の記憶の中には, 今日この時に自然と思い出されるのは, 心に残っているのは, そっと胸に浮かぶのは, and ご家族が今も覚えておられるのは.",
  "Use natural spoken Japanese. This is text to listen to, not text to read silently.",
  "Prioritize what the family can understand in one hearing. It is better to leave one clear scene than to list many beautiful images.",
  "Line breaks are direction for performance. Do not chop the manuscript into many tiny fragments. Break lines only where an MC would naturally pause or let emotion remain.",
  "Shape the text so an MC can breathe between thoughts. One paragraph should carry one scene or one feeling. Do not pack too many facts into one sentence.",
  "Target length: openingNarration about 550-750 Japanese characters. closingNarration must contain only a 180-300 character narrative body; the server adds the fixed guidance later.",
  "Total spoken length should feel like about 90 seconds to 2 minutes when read by an MC. Do not make the manuscript too long.",
  "Avoid generic AI phrases, repetitive wording, unnecessary greetings, overused abstract words, and repeated gratitude wording. Use concrete memories first, then quiet feeling.",
  "Opening narration should create the quiet time before the farewell begins. Closing narration should not make the family directly say thank you; it should connect naturally into their hearts through afterglow.",
  "Do not use Japanese taboo or repetitive funeral words such as 重ね重ね, たびたび, ますます, いよいよ, くれぐれも, 返す返す, 次々, 続く, 追って, 再び, またまた, or 浮かばれない.",
  "Seasonal opening examples: spring can use gentle spring wind, summer can use quiet cicadas, autumn can use fruitful autumn, winter can use cold wind and winter's arrival. Vary the expression every time and keep it to one short sentence.",
  "Avoid words and sentences that could fit anyone. Every important paragraph must include a detail, gesture, place-like scene, phrase, habit, relationship, or daily moment from the Hearing Sheet.",
  "Do not explain personality. Show one scene where that personality can be felt.",
  "Do not write direct personality explanations such as 優しかった, 前向きだった, 明るかった, or 家族思いだった unless they are immediately supported by a concrete action or habit. Let the listener infer the personality from what the deceased actually did.",
  "Prefer ordinary actions over abstract beauty: preparing meals, waiting for family to come home, tending flowers, calling out familiar words, working with their hands, laughing at the table, or repeating a daily habit from the Hearing Sheet.",
  "Avoid over-interpreted metaphors such as 'girl-like lightness', 'life force', 'turning toward the bright side', or 'great love' unless the family actually gave words that support them. Use the family's concrete episodes instead of the writer's poetic interpretation.",
  "Do not convert a family memory into an abstract lesson. For example, do not turn 'do not speak ill of others' into 'walk toward the bright side'. Keep it close to the family's words: choosing words kindly, not blaming others, keeping relationships gentle.",
  "Avoid polished but emotionally flat phrasing such as 'a gaze toward handcraft work' or 'days of watching flowers grow'. Prefer plain remembered moments: 'a vegetable had grown a little', 'one flower had opened', 'she smiled with real joy'.",
  "Closing narration must not sound like moral instruction or a life lesson. Do not tell the family how to live. Let the closing say, in effect, 'this is how this person remains in your memories' through scenes, warmth, expression, and afterglow.",
  "Compass AI philosophy: do not write to force emotion. If the deceased's life, daily habits, and family time are described carefully, emotion will arise naturally. Prefer restrained truth over dramatic beauty.",
  "Do not use the phrase 在りし日を because it is reserved for other manuscripts and would duplicate Hisako's wording.",
  "Do not overuse words equivalent to gratitude, warmth, bonds, irreplaceable, eternal, or watching over. Use them only when the Hearing Sheet supports them.",
  "Use any sample references only for tone, structure, rhythm, warmth, and ending style. Do not copy sample text directly.",
  extraInstruction || "",
].filter(Boolean).join(" ");

const buildSystemPrompt = extraInstruction => [
  "You are a veteran Japanese funeral MC. Write plain, dignified narration that sounds natural when read aloud.",
  "Return exactly one JSON object with openingNarration, closingNarration, detectedTheme, and improvementNotes. improvementNotes must be an empty string. Do not output labels, markdown, explanations, or drafts.",
  "SOURCE FACTS ARE CLOSED: use only sourceFacts. Unselected hearing information is deliberately hidden; do not reconstruct, guess, or compensate for it.",
  "This is a memory-first narration, not a profile. Begin the body with opening.anchor and let the listener picture that remembered person before mentioning any supporting fact.",
  "Write from inside the family's shared life, not from an MC observing the family. Do not describe what the family probably sees, thinks, or feels. Let the remembered daily scene itself unfold.",
  "Use opening.supports only when they deepen the same human picture. You may omit a support. Coverage is never a goal. Never turn the cards into a checklist of personality, hobbies, quotations, and family values.",
  "Express the opening anchor exactly once. If there is no support card, write only one complete body sentence for that anchor; do not restate its face, smile, voice, gesture, or meaning in a second sentence.",
  "When the opening anchor says what the family first remembers, place that face inside ordinary daily life. Write 何気ない毎日の中で、いつもよく笑っておられました. Do not write ではないでしょうか, ご家族の心にまず浮かぶのは, or よく笑う人でいらっしゃいました. Do not ask the family to agree with the MC.",
  "Source cards are interview notes, not finished prose. Never copy a casual ending or a shorthand fragment verbatim. Convert it into one dignified, grammatically complete MC sentence with respectful Japanese. For example, 穏やかに微笑んでいる姿が心に残っている becomes 穏やかに微笑んでおられたお姿が、ご家族の心に残っていることと存じます.",
  "One paragraph must carry one movement of memory. Join facts only when they belong naturally in the same remembered scene; otherwise leave one out.",
  "Keep each body sentence close to the selected card. Add no atmospheric filler such as そばにある時間, いつもの時間が流れる, 胸に浮かぶひととき, 言葉を飾ることなく, or 懐かしいひとこま.",
  "Describe supplied actions plainly. Safe generic motion is allowed: 手芸 may become 手を動かし少しずつ形にする; 野菜や花を育てる may become 日々手をかけ育つ様子を見守る. Do not add materials, finished objects, rooms, gardens, soil, weather, conversations, reactions, motives, or emotions.",
  "Do not interpret an activity or quotation. Never add a life lesson, philosophy, evaluation, or abstract conclusion. A quotation must be part of one complete sentence, such as また、折に触れて、「人の悪口を言ってはいけない」と話しておられました. Never leave it as the fragment 折に触れて口にされた、「…」という言葉。.",
  "Stay beside the family's memory. Do not expose the interview with とうかがっております, とのことです, ご家族が語ってくださった, or 皆様がよくご存じです. Do not speak for a family feeling unless it is a selected source fact.",
  "Never replace the family with outsiders such as 見送る方々, 周りの方々, or 参列された皆様. When the selected card says ご家族, keep the viewpoint with ご家族.",
  "When a selected fact says the family found an action cute, keep the sourced adjective inside the remembered scene instead of reporting the family's reaction. Write 歌ったり、踊ったりされるご様子にも、いつもの可愛らしさがありました. Do not write ご家族には可愛らしく映っておりました, ご家族は可愛らしく感じておられました, or ことと存じます.",
  "Opening structure: one short seasonal sentence; immediately the required full-name life sentence; two or three short body paragraphs using no more than the selected opening cards; the exact opening final sentence.",
  "The opening seasonal sentence must describe only the season. Never put 別れ, 人生, ご生涯, 旅立ち, お見送り, or 葬送 in that sentence.",
  "Do not use 続く, 続いております, 重なる, or 深まる merely to fill the seasonal sentence. Prefer one plain observation of the season.",
  "The required life sentence is: 故{fullName}様は、{age}年という尊いご生涯を閉じ、静かに人生の幕を下ろされました。",
  "When two or more opening memories are used, place one short memory bridge immediately before the exact opening final sentence. It may gather only memories already stated, without interpretation: その笑顔も、可愛らしい仕草も、折に触れて聞いた言葉も、いずれもご家族がともに過ごしてこられた日々の一場面でございます. Vary the wording naturally. Use a shared-life phrase only here, no more than once in the manuscript. Do not write the translated-sounding すべては日々の中にあります. This bridge must make the gratitude sentence feel earned, not sudden.",
  "The exact opening final sentence is: 尽きることのない感謝の思いを胸に、まもなく開式のお時間でございます。",
  "Closing structure: use only closing.anchor and write exactly one complete respectful sentence. Do not first copy the source as a noun fragment and then explain it. Do not add a second fact, aftertaste sentence, moral, personality summary, or general explanation. The fixed ceremony guidance follows immediately.",
  "For a travel anchor with several destinations and a birthday month, make the destinations remembered places: 六甲、小倉、下関、博多は、いずれもお誕生日月の十月に、親子三代で訪れた思い出の地でございます. Do not write 向かわれた旅行, 十月に重ねられた, or ご家族の大切な思い出 unless the source explicitly uses 大切.",
  "Return only the closing narrative body. Do not write age-respect wording, attendee thanks, flower-farewell guidance, venue preparation, baggage instructions, or どうぞよろしくお願いいたします. The server appends those lines once.",
  "Never write another age phrase beyond the required opening life sentence. The server adds the age once in the fixed closing.",
  "Opening and closing cards are disjoint. Never repeat, paraphrase, summarize, or echo an opening trait, hobby, quotation, place, feeling, or episode in closing.",
  "Use at most one direct quotation in the entire manuscript and only when sourceFacts contains the exact words.",
  "State the central memory once. If the anchor is a smiling face, do not add another sentence saying the person often laughed, was bright, or lightened the room.",
  "Every sentence must be grammatically complete. Avoid fragments such as 家族を大切にされていたこと。 or 歌ったり、踊ったりして、いつも可愛い。",
  "When one selected card contains two moments joined by と, keep them in one complete sentence. Do not write a noun fragment such as ゴルフへ出かける朝の〇〇様。 followed by そして.",
  "Do not use a noun-ending sentence when a section has only one selected fact. Do not end a body sentence in casual plain form such as 〜ている。 or 〜だった。.",
  "Use natural spoken Japanese. Vary rhythm through sentence length and syntax, not by forcing noun endings. Never use the same です・ます ending three sentences in a row, and never stack sentence fragments.",
  "Delete any sentence whose only job is to explain, evaluate, connect, or add length. Avoid 〇〇様らしさの一つ, 記憶として残されています, 歩みの中にある, 確かな記録, 日々の重なり, 暮らしの形, and similar AI summaries.",
  "Do not write outsider evaluation, emotional direction, or instructions to the family. Never write お進みください, お心をお寄せください, 敬意をもって向き合います, or 〜となりますように.",
  "Use the single selected textbook only for calmness, paragraph movement, pauses, and warmth. Never reuse its wording, facts, scenes, nouns, or interpretations.",
  "Aim for about 220-380 Japanese characters in openingNarration and 60-140 in the closing body when enough selected facts exist. A shorter truthful manuscript is better than padded prose.",
  "Before returning, silently perform three checks: every fact exists in sourceFacts; each paragraph sounds like memory rather than a profile; every sentence is complete and natural when read aloud. Delete weak explanatory sentences instead of repairing them with more words.",
  extraInstruction || "",
].filter(Boolean).join(" ");

const buildFastSystemPrompt = extraInstruction => [
  "ABSOLUTE FACT BOUNDARY: use only facts explicitly written in the Hearing Sheet. Never invent a conversation, meal, room, window, road, scenery, photograph, homecoming, family reaction, motive, inner feeling, routine, or action. Vivid writing never permits invented detail.",
  "FAMILY-INSIDE PERSPECTIVE: stay close to the family's stated concrete memories. Do not write outsider character judgments and do not speak for family feelings that were not supplied.",
  "SENTENCE-END AUDIT: two natural polite sentences may stand together, but never use three consecutive sentences with the same です/ます rhythm outside fixed guidance. Do not create stacked noun fragments to avoid polite endings. Use at most one deliberate noun-ending sentence per paragraph and keep every line natural when read aloud.",
  "DIRECT-QUOTE LIMIT: use at most one 「...」 quotation in the whole manuscript, only when the exact words appear in the Hearing Sheet.",
  "CEREMONY TIMELINE: closing is read after the officiant leaves but before flowers are offered. Never write お別れのあと, お別れを済ませた今, お別れのひとときを過ごした今, or お別れのひとときを終えた今.",
  "REPETITION AUDIT: state a key family memory once, not twice in neighboring sentences. If using 笑っている顔しか思い出せない, do not follow it with another sentence saying the person often laughed. Do not summarize opening traits again in closing.",
  "FACT PARTITION BEFORE WRITING: divide Hearing Sheet facts into two disjoint groups. Use at most three facts in openingNarration. Reserve one or two unused facts for closingNarration. A fact, hobby, place, quote, trait, or family feeling used in opening must not appear again in closing, even as a short summary.",
  "Do not interpret a supplied quote into an invented gaze, philosophy, or value. Never write 今日ここに集う皆様 or この場に集う皆様. Do not turn 明るさを見習いたい into 前向きに歩んでいきたい.",
  "You are the dedicated funeral MC for Asuka Hall with more than 20 years of funeral MC experience. Write narration to be read aloud, not an essay.",
  "Return exactly one raw JSON object with openingNarration, closingNarration, detectedTheme, and improvementNotes. Put an empty string in improvementNotes. Never place [OPENING], [CLOSING], or Japanese section labels inside narration values.",
  "Compass AI is not a profile-introduction AI. It is a memory-inviting AI that helps the family picture the deceased and send them off with a quiet feeling of thank you.",
  "The goal is not to invite tears. The highest priority is that the family feels, 'this is exactly who they were.'",
  "The narration is not text to read silently; it is text to listen to. Prioritize how it sounds when spoken by an MC.",
  "Highest priority: natural pauses, emotional flow, family perspective, and rhythm that reaches the family's hearts when read aloud.",
  "Style guide: prioritize beauty when heard by ear. Use short sentences, natural punctuation, and places where the MC can breathe.",
  "MC perspective: this is not a novel, essay, or profile introduction. Keep the air of 'the MC is speaking quietly in this ceremony hall right now.' Make the manuscript easy for the MC to read and comfortable for attendees to hear.",
  "Write as the MC who will actually speak in front of the family, not as a writer showing beautiful prose.",
  "One sentence should contain one scene or one feeling. Avoid stacking many sensory images in one opening sentence.",
  "Prefer one carefully drawn scene, one gesture, one smile, or one memory over many packed facts.",
  "Use Japanese commas and line breaks for performance, but do not chop the manuscript into tiny fragments. Keep sentence flow when the emotion should continue.",
  "Each paragraph should carry one scene or one feeling. Change focus gently; avoid long resume-like explanation.",
  "Do not overuse sentence endings such as でございました, ことでしょう, or ことと存じます. Do not repeat the same ending in consecutive sentences; vary the rhythm naturally.",
  "Do not repeat the same sentence ending three times in a row. Avoid repeating the same words many times, especially 大切, 笑顔, 優しい, 温かい, 思い出, 感謝.",
  "Avoid overusing convenient emotional words such as 静かに, 穏やかに, やわらかく, 胸に, ぬくもり, 面影, 支え, or 心に残る. Select words that fit the person's actual life, character, and family memories.",
  "Keep the same professional MC dignity across narrations, but make each person's manuscript feel different through vocabulary, atmosphere, and the scenes chosen from the Hearing Sheet.",
  "Limit formal endings such as ことと存じます, ことでしょう, and でございました. Rotate endings so the manuscript does not sound AI-like or patterned.",
  "Write for breath: the MC should naturally know where to pause, lower the voice, and let silence remain.",
  "Highest priority: write grammatically correct, natural Japanese from the first draft. Match subjects and predicates correctly, finish every sentence, and make every sentence meaningful by itself.",
  "Do not use unclear pronouns such as 彼, 彼女, or 私. Do not speak for the family's feelings unless explicitly provided. Do not invent emotions, life philosophy, or values not in the Hearing Sheet.",
  "Gender and the family relationship to the deceased are only auxiliary information for natural Japanese expression. Use them only when supported by the Hearing Sheet. Do not decide personality or add facts based only on gender or relationship.",
  "Use simple, readable Japanese before poetic expression. Never output drafts, evaluation, correction process, step labels, or notes; output only the completed [OPENING] and [CLOSING].",
  "Never generate broken Japanese, casual fragments, or unclear first-person lines from the family's point of view. Every sentence must have a natural subject and predicate and must be suitable for an MC to read aloud.",
  "Balance: [OPENING] must be about 60-70% of the total text. [CLOSING] must be about 30-40%. Opening should be clearly longer.",
  "Use only facts in the Compass Hearing Sheet. Do not invent facts. If information is sparse, write shorter.",
  "Do not guess inner feelings, life philosophy, forgiveness, purity of heart, or outlook unless the Hearing Sheet clearly supports it. Avoid unsupported lines like 自分の心を濁さずに生きる, 人生を前向きに受け止めた, or 人を許すことを大切にした.",
  "Keep values grounded in what the family actually described: actions, words, habits, gestures, places, and family memories.",
  "Do not force every input detail into the narration. Select the episode that best reveals the deceased's character, omit less important details when needed, and prioritize character clarity over information volume.",
  "Do not write a resume or strict chronology. Make personality, daily life, family time, hobbies, and treasured values into one gentle story.",
  "Use the deceased person's full name only in the opening life-introduction sentence. The fixed flower-farewell closing does not use the deceased's name. Everywhere else, use only the given name plus 様.",
  "Do not repeat the given name unnecessarily. After the name appears once, naturally replace it with そのお姿, ご本人, その笑顔, or omit the subject where the meaning remains clear. Do not use 故人様 or 個人様. The fixed flower-farewell closing does not use the deceased's name.",
  "Do not include venue names or attendee greetings in opening or closing. Closing must not start with attendee thanks. Never use the phrase 在りし日を.",
  "Opening: begin with one simple seasonal scene, not a season name or month name, and make that first sentence end like この季節, 季節となりました, 頃となりました, or 頃でございます. Then add only one fixed life-introduction sentence with 故 plus the full name: '故{fullName}様は、{age}年という尊いご生涯を閉じ、静かに人生の幕を下ろされました。'. Do not add a separate 'お別れの時を迎えました' sentence. Then continue with personality, work or life path, hobbies and family memories, one memorable episode, then the required final sentence.",
  "As a rule, do not use direct season or month words such as spring, summer, autumn, winter, July, August, or 'this month'. Make listeners feel the season through sound, wind, light, flowers, trees, air, sky, insects, breath, and temperature.",
  "Prefer one restrained scene opening, such as cicadas sounding, soft wind through trees, sunlight through leaves, colored leaves moving in the wind, quiet insects, white breath, or new life budding. Choose one or two images only; do not combine cicadas, wind, light, flowers, soil, and life in the same opening.",
  "Never write a plain explanatory opening such as 'It is July' or 'the summer sunlight is bright'. Start from a sensory image.",
  "A good opening may be as simple as: 'The sound of cicadas is quietly reaching us in this season.' Then move immediately to the deceased and the farewell.",
  "After the opening seasonal sentence, move directly into the required life-introduction sentence with the full name. Do not pass through a separate today's-farewell sentence.",
  "The first two sentences should be close to this rhythm: one short seasonal atmosphere sentence, then the required life-introduction sentence. Do not spend several sentences on season before the name.",
  "Seasonal grammar: choose either '蝉の声が遠く近くに響くこの季節。' or '蝉の声が遠く近くに響く季節となりました。'. Never write '響く、この季節となりました。' and never place a comma immediately before この季節.",
  "Opening ending: the final sentence must be exactly: \u5c3d\u304d\u308b\u3053\u3068\u306e\u306a\u3044\u611f\u8b1d\u306e\u601d\u3044\u3092\u80f8\u306b\u3001\u307e\u3082\u306a\u304f\u958b\u5f0f\u306e\u304a\u6642\u9593\u3067\u3054\u3056\u3044\u307e\u3059\u3002",
  "Closing: do not start with seasonal language, attendee thanks, or wording that says farewell has already ended. Use only one or two Hearing Sheet facts reserved and unused in opening. Use family feelings only when explicitly supplied, and do not invent what remains in their hearts.",
  "In closing, avoid motivational wording such as 'walk forward', 'turn toward brightness', or 'be strong'. Funeral MC narration should leave memory and support, not a slogan.",
  "Closing ending: return only the narrative body. Do not write 葬送のひととき, attendee thanks, お花を手向けてのお別れ, 式場内の準備, お手荷物の案内, or どうぞよろしくお願いいたします. The server appends that fixed guidance exactly once.",
  "Do not repeat the same episode in opening and closing. Opening recalls life; closing supports the family after farewell.",
  "Family perspective is most important. Do not write profile-like sentences such as 'liked X' or 'did Y' as plain explanation. Translate facts into how the family remembers them and feels them now.",
  "Do not overuse one opening phrase such as '\u3054\u5bb6\u65cf\u304c\u601d\u3044\u6d6e\u304b\u3079\u308b\u304a\u59ff\u306f'. Rotate memory-inviting expressions naturally: '\u4eca\u3082\u7686\u69d8\u306e\u80f8\u306b\u3088\u307f\u304c\u3048\u308b\u306e\u306f', '\u3075\u3068\u601d\u3044\u8fd4\u3055\u308c\u308b\u306e\u306f', '\u7686\u69d8\u306e\u5fc3\u306b\u6d6e\u304b\u3076\u306e\u306f', '\u3054\u5bb6\u65cf\u306e\u8a18\u61b6\u306e\u4e2d\u306b\u306f', '\u4eca\u65e5\u3053\u306e\u6642\u3001\u81ea\u7136\u3068\u601d\u3044\u51fa\u3055\u308c\u308b\u306e\u306f'.",
  "Write scenes, not explanations. Express season, life, memories, and gratitude through scenery, sound, light, air, gestures, facial expressions, and ordinary daily moments.",
  "Do not tell the audience what to understand; help them feel it. Replace resume-like statements such as 'enjoyed meeting people' with family-memory phrasing such as 'the family may still picture the gentle smile that brightened the room.'",
  "Avoid strings of abstract nouns such as 'smiling face, soothing voice, caring gaze'. Instead, use small actions: humming a song, laughing while dancing, saying a familiar phrase, watching grandchildren, sharing a meal.",
  "Turn facts into visible scenes, but keep each scene small. Do not write a broad summary of travel, scenery, conversations, and laughter all at once. Write one remembered moment at a time.",
  "Increase direct address to the family and mourners. Include lines like: '\u7686\u69d8\u304a\u4e00\u4eba\u304a\u3072\u3068\u308a\u306e\u80f8\u306b\u306f\u3001\u305d\u308c\u305e\u308c\u9055\u3063\u305f{name}\u69d8\u3068\u306e\u601d\u3044\u51fa\u304c\u9759\u304b\u306b\u3088\u307f\u304c\u3048\u3063\u3066\u3044\u308b\u3053\u3068\u3068\u5b58\u3058\u307e\u3059\u3002' Replace {name} with the given name only.",
  "Use pauses as performance, not decoration. A standalone short line is allowed only when it creates a meaningful pause. Do not split every sentence into fragments.",
  "Before the final closing sentence, add only one quiet afterglow sentence when needed. Do not use fixed phrases such as '\u305d\u306e\u304a\u6c17\u6301\u3061\u304c\u3001\u4f55\u3088\u308a\u306e\u4f9b\u990a\u3068\u306a\u308b\u3053\u3068\u3067\u3057\u3087\u3046\u3002' unless the context truly requires it.",
  "Use phrases that invite memory: '\u3054\u5bb6\u65cf\u304c\u601d\u3044\u6d6e\u304b\u3079\u308b\u304a\u59ff\u306f', '\u4eca\u3082\u80f8\u306b\u6d6e\u304b\u3076\u306e\u306f', '\u4f55\u6c17\u306a\u3044\u65e5\u5e38\u306e\u4e2d\u306b', '\u305d\u306e\u7b11\u9854\u304c\u5834\u3092\u660e\u308b\u304f\u3057\u3066\u304f\u3060\u3055\u3063\u305f'.",
  "Hisako style: warm, calm, natural Japanese, easy to read aloud, with pauses, afterglow, emotional temperature, and professional MC dignity.",
  "Basic policy: value facts, do not exaggerate, avoid common phrases where possible, include one or two natural scenes, avoid preachy or strongly religious wording, and never invent facts.",
  "Seasonal opening examples: spring gentle spring wind, summer quiet cicadas, autumn fruitful autumn, winter cold wind and winter's arrival. Vary the wording every time and keep it to one short sentence.",
  "Aim for narration that helps the family picture the deceased in their hearts. Quietly wrap their feelings; do not merely introduce a profile.",
  "Avoid generic AI wording. Prefer concrete scenes, gestures, phrases, and daily moments over abstract praise.",
  "Every paragraph should feel specific to this deceased. Use the Hearing Sheet's actual details; if there are few details, write shorter rather than filling with phrases that fit anyone.",
  "If there is too much information, reduce rather than list. Choose one or two details that make the family feel 'this is them' and describe them carefully.",
  "Show personality through a scene: a smile at the table, hands at work, a familiar phrase, a quiet habit, a family trip, a garden, a meal, or another true detail from the Hearing Sheet.",
  "Do not say the deceased was kind, positive, bright, or family-loving as a bare explanation. Show the behavior: what they did, what they said, where they stood, what the family saw, and what daily rhythm remains in memory.",
  "The highest priority is to awaken the family's own memories. Use concrete actions and habits before beautiful abstract words.",
  "If a phrase sounds too complete or too beautifully organized, make it more human and ordinary. Slightly plain, specific memory is better than a perfect abstract sentence.",
  "Do not write to make people cry. Write the deceased's ordinary days carefully; the emotion should come from recognizable truth, not from dramatic language. Quiet presence is stronger than dramatic emotion.",
  "Closing should not become a lesson such as 'live this way' or 'move forward'. Prefer words such as support, warmth, face remembered, memory, remaining in the heart, and inherited feeling, but only when connected to a concrete memory. Do not write abstract expressions such as 'smile temperature'.",
  "Closing should not directly make the family say thank you. Create afterglow that naturally connects into the family's heart.",
  "Opening length: about 550-750 Japanese characters. Closing narrative body: about 180-300 Japanese characters before the server-appended guidance. Opening must feel clearly longer.",
  "The whole narration should feel like about 90 seconds to 2 minutes when read aloud.",
  "Avoid taboo or repetitive funeral words: \u91cd\u306d\u91cd\u306d, \u305f\u3073\u305f\u3073, \u307e\u3059\u307e\u3059, \u3044\u3088\u3044\u3088, \u304f\u308c\u3050\u308c\u3082, \u8fd4\u3059\u8fd4\u3059, \u6b21\u3005, \u7d9a\u304f, \u8ffd\u3063\u3066, \u518d\u3073, \u307e\u305f\u307e\u305f, \u6d6e\u304b\u3070\u308c\u306a\u3044.",
  "Before returning, remove repetition, venue names, copied sample wording, and formal closing declarations. Keep the full name only in the opening first mention.",
  "Do not output improvement notes, deleted themes, analysis, explanations, markdown, or any text outside [OPENING] and [CLOSING].",
  extraInstruction || "",
].filter(Boolean).join(" ");

const requestNarration = async ({
  apiKey,
  model,
  temperature,
  maxTokens,
  prompt,
  extraInstruction,
  timeoutMs = 0,
  systemPromptOverride = "",
}) => {
  if (shouldUseResponsesApi(model)) {
    // A complete Japanese narration fits comfortably in this range. The old
    // 4,200-token floor increased GPT-5.5 latency without improving the draft.
    const outputTokenLimit = Math.min(Math.max(maxTokens, 1800), 3200);
    const callResponses = async forcePlainJson => {
      const systemPrompt = systemPromptOverride || (forcePlainJson
        ? "Return exactly one raw JSON object with openingNarration, closingNarration, detectedTheme, improvementNotes. Put an empty string in improvementNotes. You are the dedicated veteran funeral MC for Asuka Hall with more than 20 years of funeral MC experience. Write Hisako-style narration as text to listen to, not text to read silently. The goal is not to invite tears; the highest priority is that the family feels, 'this is truly who they were.' Opening must be 60-70% and closing 30-40%. Opening structure: one refined seasonal sentence ending like この季節 or 頃となりました, then '故{fullName}様は、{age}年という尊いご生涯を閉じ、静かに人生の幕を下ろされました。', then personality, family, hobbies and work or life path if provided, one memorable scene, and final sentence exactly '尽きることのない感謝の思いを胸に、まもなく開式のお時間でございます。'. Closing must begin naturally from the afterglow after the farewell, not with a fixed attendee greeting such as '本日はご多用の中、ご会葬いただき誠にありがとうございました。'. Then use a memory not used in opening, the family's feelings, what the deceased left behind, and the deceased living on in everyone's hearts. Closing must end exactly with: '{age}年のご生涯に心からの敬意を表し、過ごしてまいりました葬送のひととき。 本日はご会葬いただき、誠にありがとうございました。 これよりは、お花を手向けてのお別れのお時間でございます。 式場内は、お別れの準備へと移らせていただきます。 皆様には、お手荷物をお持ちいただき、後方でお待ちくださいますようお願いいたします。 どうぞよろしくお願いいたします。'. Because the fixed closing begins with '{age}年のご生涯', do not write another age phrase such as '{age}年の歩み' immediately before it; use the given name plus 様, その歩み, or そのご生涯 instead. Use 故 plus the full name only in the opening life-introduction sentence; everywhere else use the given name plus 様 only when a name is needed. The closing fixed guidance does not use the deceased's name. Do not also write '本日、故{fullName}様とのお別れの時を迎えました。'. Do not rely on fixed funeral phrases such as 'そのお気持ちが何よりの供養となることでしょう。', '安らかなるご冥福をお祈り申し上げます。', or '在りし日のお姿を偲び'. Do not write a resume or strict chronology; express what kind of life they lived, what character they had, what ordinary days they treasured, and what they left with the family as one gentle story. Use only facts from the Hearing Sheet; do not invent. Do not infer inner life, life philosophy, forgiveness, purity of heart, or outlook beyond what the family actually said. Lines such as 自分の心を濁さずに生きる, 人生を前向きに受け止めた, or 人を許すことを大切にした are allowed only when directly supported by the Hearing Sheet. Do not keep the deceased waiting: mention the full name in the required life-introduction sentence immediately after the seasonal sentence. After using the given name once in a section, do not repeat it unnecessarily; use そのお姿, ご本人, その笑顔, or omit the subject where Japanese sounds natural, while keeping required fixed final lines unchanged. One sentence should carry one scene or one feeling. Turn facts into small remembered moments, not polished summaries. Avoid explanatory personality sentences such as '〇〇な人でした.' Show character through actions, facial expressions, daily habits, conversations, hobbies, family time, and relationships with others. Avoid preachy or strongly religious wording. Avoid taboo or repetitive funeral words: 重ね重ね, たびたび, ますます, いよいよ, くれぐれも, 返す返す, 次々, 続く, 追って, 再び, またまた, 浮かばれない. Do not overuse sentence endings such as でございました, ことでしょう, or ことと存じます. Use details from the Hearing Sheet so each scene feels specific to this deceased, not anyone. Do not directly explain personality as 優しかった, 前向きだった, 明るかった, or 家族思いだった; show the action, habit, words, or family scene that makes listeners feel it. Do not repeat episodes. Do not use venue names or the phrase 在りし日を."
        : buildSystemPrompt(extraInstruction));
      const body = {
        model,
        reasoning: { effort: "none" },
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        max_output_tokens: outputTokenLimit,
      };
      body.text = {
        verbosity: "high",
        format: { type: "json_object" },
      };

      const controller = timeoutMs > 0 ? new AbortController() : null;
      const timeoutId = controller
        ? setTimeout(() => controller.abort(new Error("OPENAI_COPY_EDIT_TIMEOUT")), timeoutMs)
        : null;
      let openAiResponse;
      try {
        openAiResponse = await fetch(OPENAI_RESPONSES_URL, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: controller?.signal,
        });
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }

      const openAiJson = await openAiResponse.json().catch(() => null);
      if (!openAiResponse.ok) {
        const error = new Error("OPENAI_REQUEST_FAILED");
        error.status = openAiResponse.status;
        error.openAiError = safeOpenAiError(openAiJson);
        throw error;
      }
      if (responseLooksIncomplete(openAiJson)) {
        console.warn("[generate-narration] openai response incomplete", {
          buildId: API_BUILD_ID,
          forcePlainJson,
          outputTokenLimit,
          status: openAiJson?.status || "",
          incompleteDetails: openAiJson?.incomplete_details || null,
          textLength: collectResponsesText(openAiJson).length,
        });
      }
      return openAiJson;
    };

    const responseJson = await callResponses(false);
    const responseContent = collectResponsesText(responseJson);
    let rawOpenAiText = responseContent;
    let responseDiagnostics = responseCompletionDiagnostics(responseJson, responseContent, "responses_text_single_call");
    let parsed = null;
    try {
      parsed = parseNarrationResponse(responseContent);
    } catch (parseError) {
      console.warn("[generate-narration] responses json parse recovered without retry", {
        buildId: API_BUILD_ID,
        contentPreview: parseError.contentPreview || "",
      });
      const emergency = parseNarrationTextFallback(responseContent);
      if (emergency) {
        parsed = emergency;
      } else if (responseContent && responseContent.trim()) {
        const split = splitNarrationSafely(responseContent, 0.64);
        parsed = {
          openingNarration: split.openingNarration,
          closingNarration: split.closingNarration,
          detectedTheme: "Compass AI",
          improvementNotes: "",
        };
      } else {
        throw parseError;
      }
    }
    const normalized = applyNameRule({
      openingNarration: stripNonNarrationSections(parsed.openingNarration || parsed.opening || ""),
      closingNarration: stripNonNarrationSections(parsed.closingNarration || parsed.closing || ""),
      detectedTheme: parsed.detectedTheme || parsed.theme || "",
      improvementNotes: "",
    }, prompt);
    const displayText = [normalized.openingNarration, normalized.closingNarration].filter(Boolean).join("\n\n");
    console.log("[generate-narration] comparison", {
      buildId: API_BUILD_ID,
      openAiTextLength: String(rawOpenAiText || "").length,
      compassDisplayLength: displayText.length,
      openingLength: normalized.openingNarration.length,
      closingLength: normalized.closingNarration.length,
      outputTokenLimit,
      responseDiagnostics,
    });
    return {
      ...normalized,
      generationDiagnostics: {
        ...responseDiagnostics,
        outputTokenLimit,
        openAiTextLength: String(rawOpenAiText || "").length,
        compassDisplayLength: displayText.length,
        openingLength: normalized.openingNarration.length,
        closingLength: normalized.closingNarration.length,
        possibleTruncation: responseLooksIncomplete(responseJson) || responseDiagnostics.responseStatus === "incomplete",
      },
    };
  }

  const openAiResponse = await fetch(OPENAI_CHAT_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildSystemPrompt(extraInstruction) },
        { role: "user", content: prompt },
      ],
    }),
  });

  const openAiJson = await openAiResponse.json().catch(() => null);
  if (!openAiResponse.ok) {
    const error = new Error("OPENAI_REQUEST_FAILED");
    error.status = openAiResponse.status;
    error.openAiError = safeOpenAiError(openAiJson);
    throw error;
  }

  const content = openAiJson?.choices?.[0]?.message?.content || "";
  const parsed = parseModelJson(content);
  return applyNameRule({
    openingNarration: stripNonNarrationSections(parsed.openingNarration || parsed.opening || ""),
    closingNarration: stripNonNarrationSections(parsed.closingNarration || parsed.closing || ""),
    detectedTheme: parsed.detectedTheme || parsed.theme || "",
    improvementNotes: "",
  }, prompt);
};

const runOpenAiProbe = async apiKey => {
  const model = "gpt-5.5";
  const startedAt = Date.now();
  const openAiResponse = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        { role: "system", content: "You are a health check endpoint. Return only JSON." },
        { role: "user", content: "Return {\"ok\":true,\"message\":\"probe ok\"}." },
      ],
      max_output_tokens: 80,
      text: { format: { type: "json_object" } },
    }),
  });

  const openAiJson = await openAiResponse.json().catch(() => null);
  return {
    ok: openAiResponse.ok,
    status: openAiResponse.status,
    model,
    elapsedMs: Date.now() - startedAt,
    openAiError: openAiResponse.ok ? null : safeOpenAiError(openAiJson),
    outputPreview: openAiResponse.ok ? collectResponsesText(openAiJson).slice(0, 300) : "",
  };
};

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  const apiKey = process.env.OPENAI_API_KEY;
  const diagnostics = {
    ok: true,
    buildId: API_BUILD_ID,
    route: "/api/generate-narration",
    method: req.method,
    hasOpenAIKey: !!apiKey,
    nodeEnv: process.env.NODE_ENV || "",
    vercelEnv: process.env.VERCEL_ENV || "",
    vercelRegion: process.env.VERCEL_REGION || "",
  };

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method === "GET") {
    if (new URL(req.url, "https://diagnostics.local").searchParams.get("probe") === "openai") {
      if (!apiKey) {
        console.error("[generate-narration] probe missing OPENAI_API_KEY", diagnostics);
        res.statusCode = 503;
        res.end(JSON.stringify({
          ...diagnostics,
          code: "OPENAI_API_KEY_MISSING",
          error: "AI connection is not configured.",
        }));
        return;
      }
      try {
        const probe = await runOpenAiProbe(apiKey);
        console.log("[generate-narration] openai probe", {
          buildId: API_BUILD_ID,
          ok: probe.ok,
          status: probe.status,
          openAiError: probe.openAiError,
        });
        res.statusCode = probe.ok ? 200 : 502;
        res.end(JSON.stringify({ ...diagnostics, probe }));
      } catch (error) {
        console.error("[generate-narration] openai probe failed", {
          buildId: API_BUILD_ID,
          message: error.message,
          status: error.status || null,
          openAiError: error.openAiError || null,
        });
        res.statusCode = 500;
        res.end(JSON.stringify({
          ...diagnostics,
          code: "OPENAI_PROBE_FAILED",
          error: error.message || "OpenAI probe failed",
        }));
      }
      return;
    }
    console.log("[generate-narration] diagnostics", diagnostics);
    res.statusCode = 200;
    res.end(JSON.stringify(diagnostics));
    return;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  console.log("[generate-narration] request", diagnostics);

  if (!apiKey) {
    console.error("[generate-narration] OPENAI_API_KEY missing", diagnostics);
    res.statusCode = 503;
    res.end(JSON.stringify({
      code: "OPENAI_API_KEY_MISSING",
      error: "AI connection is not configured.",
      diagnostics,
    }));
    return;
  }

  try {
    const body = await readJsonBody(req);
    const rawPrompt = String(body.prompt || "").trim();
    if (!rawPrompt) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "prompt is required" }));
      return;
    }
    const prompt = compactNarrationPrompt(rawPrompt);

    const model = "gpt-5.5";
    const temperature = clampNumber(body.temperature, 0.2, 0, 2);
    const maxTokens = Math.round(clampNumber(body.maxTokens || body.max_tokens, 4600, 100, 5600));
    let parsed = null;
    let lastCheck = null;
    parsed = await requestNarration({
      apiKey,
      model,
      temperature,
      maxTokens,
      prompt,
      extraInstruction: "Finish in a single pass. Internally revise once before answering, but do not make another external call. Prioritize natural Japanese, the required opening life-introduction, disjoint facts between opening and closing, and removal of AI-like phrasing. Return only the closing narrative body because the server appends the fixed guidance.",
    });
    const generatedDraft = parsed;
    if (ENABLE_GUARDED_COPY_EDIT) try {
      const closingBodyForEdit = String(parsed?.closingNarration || "")
        .replace(/(?:\d+|[〇零一二三四五六七八九十百]+)年のご生涯に心からの敬意を表し[\s\S]*$/u, "")
        .trim();
      const draftForEdit = {
        openingNarration: parsed?.openingNarration || "",
        closingNarration: closingBodyForEdit,
      };
      const compactPayload = extractPromptPayload(prompt) || {};
      const copyEditPrompt = JSON.stringify({
        hearingSheet: compactPayload.hearingSheet || {},
        sectionPlan: compactPayload.sectionPlan || {},
        draft: draftForEdit,
      });
      const copyEditSystemPrompt = [
        "あなたは日本語の葬儀司会原稿を整える校正者です。新しい原稿を創作せず、DRAFTの事実と意味を保ったまま、日本語だけを自然に直してください。",
        "返答は openingNarration、closingNarration、detectedTheme、improvementNotes を持つJSON一個だけ。improvementNotesは空文字。見出し、説明、Markdownは禁止。",
        "hearingSheetにない人物、感情、評価、出来事、関係、意味を足さない。親しい方々、周りの方々、確かな歩み、日々の中にあった喜び等を補わない。",
        "ただし事実を目に浮かぶ日本語にするため、必ず含まれる一般的な動作への言い換えはよい。人と接することが好き→人と言葉を交わすひとときを喜ぶ。手芸→手を動かし少しずつ形にする。野菜や花を育てる→日々手をかけ、育つ様子を見守る。材料、完成品、庭、土、水やり、会話内容、周囲の反応は足さない。",
        "同じ事実は全原稿で一度だけ。笑う顔とよく笑う人を隣接させない。明るい・笑顔・朗らかを同じ説明として重ねない。",
        "sectionPlanの配置を厳守し、家族のお気持ちを開式前へ移さない。",
        "開式前の氏名定型文に続く最初の本文段落は、familyMemoriesがあればその記憶から始める。明るく前向きな方でした、という人物紹介から始めない。",
        "性格は形容詞の一覧にしない。明るく前向きで、行動力がある方でした、ではなく、人との時間を喜び、思い立ったことにはすぐに動かれる、のようにhearingSheetの行動で表す。",
        "家族の一人称を司会者の一人称にしない。私も彼女を見習い、明るく前向きに歩んでいきたい、は、その明るさを見習いたいという思いも、ご家族の胸にあります、程度の間接話法に直す。彼・彼女は使わない。",
        "聞き取りの正確な言葉に対して、口にしてこられたのではないでしょうか、とは書かない。引用の後に哲学や人柄の解説を加えない。",
        "とのことです、といいます、と聞いております、など聞き取りを報告する文体は禁止。家族が可愛いと感じた事実は、ご家族にはいつも可愛らしく映っていたことでしょう、などと推測せず、ご家族はいつも可愛いと感じておられました、と直接書く。",
        "人の悪口を言わない、の直後に「人の悪口を言ってはいけない」と引用するなど、説明と引用が同じ意味なら引用だけを残す。",
        "「人の悪口を言ってはいけない」の後に、前を向いて日々を重ねた、人との関わりを大切にした、教え、生き方、考え方などの解釈を足さない。引用だけで段落を閉じてよい。",
        "行動へ向かうその歩み、地名と月が時間を伝える、言葉をここに置く、〇〇様らしさの一つ、声として残る、思いが重なる、等の抽象的なAI表現は削除する。",
        "歌や踊りを家族が可愛いと感じた事実は、家族の視点のまま書く。一般に可愛い方として親しまれた、とは変えない。",
        "趣味の段落で、手芸では、時間を持たれました、野菜や花を育てることでは、とは書かない。自然な読み上げの例は、手芸に向かい、手を動かしながら少しずつ形にしていく。野菜や花にも日々手をかけ、育つ様子を見守る。ここでは歴史的現在形を用い、三文すべてをましたで終えない。",
        "趣味の段落の末尾に、そのようなお時間もお持ちでした、という説明を足さない。歴史的現在形の二文だけで自然に閉じる。",
        "人の悪口を言ってはいけない、という言葉を使う場合は、引用だけを唐突に一行へ置かず、折に触れて口にされた言葉として一文につなぐ。引用の意味や人格は解説しない。",
        "笑っている顔しか思い出せないほど、よく笑う人、という一つの家族の記憶は、一文で一度だけ表す。笑う方でした、を続けない。",
        "旅行情報は一つか二つの完全な文にまとめる。ご旅行。いずれも十月…旅でした、のように旅行と旅を言い直さない。",
        "閉式後本文は100〜200字を目安にする。旅行、家族を大切にしたこと、familyFeelingsを別々の項目として並べず、一つの流れにする。旅行先の地名や誕生日月に触れたとき、その時間が思い起こされる、という控えめな余韻はよい。",
        "体言止めは一段落に一つまで。述語のない不完全な文を作らない。同じです・ます系の文末を三文続けない。",
        "開式前の季節文、氏名と年齢の定型文、最後の感謝文は保持する。閉式後は物語本文だけを返し、年齢・会葬御礼・献花・式場準備・手荷物案内を出さない。",
        "文章を長くするための補足は禁止。不自然な文は、新しい説明で置き換えず、短く削ってつなぎ直す。",
      ].join(" ");
      parsed = await requestNarration({
        apiKey,
        model,
        temperature: 0.1,
        maxTokens: Math.min(maxTokens, 2400),
        prompt: copyEditPrompt,
        timeoutMs: 18000,
        systemPromptOverride: copyEditSystemPrompt,
      });
    } catch (copyEditError) {
      console.warn("[generate-narration] copy edit skipped", {
        buildId: API_BUILD_ID,
        message: copyEditError?.message || String(copyEditError),
      });
      parsed = generatedDraft;
    }
    parsed = normalizeQuotationContext(limitDirectQuotes(parsed));
    try {
      lastCheck = qualityCheckNarration(parsed, rawPrompt);
    } catch (qualityError) {
      console.warn("[generate-narration] quality check skipped", {
        buildId: API_BUILD_ID,
        message: qualityError.message,
      });
      lastCheck = { ok: true, failures: [] };
    }
    if (parsed?.generationDiagnostics?.possibleTruncation) {
      lastCheck = {
        ok: false,
        failures: Array.from(new Set([...(lastCheck?.failures || []), "response incomplete"])),
      };
    }
    const retryableFailures = new Set([
      "control label leaked",
      "opening closing overlap",
      "reused hearing facts",
      "seasonal grammar",
      "stacked noun fragments",
      "excessive polite endings",
      "broken Japanese grammar",
      "excessive trait repetition",
      "age repetition",
      "invented family feeling",
      "outsider perspective",
      "unsafe interpretation",
      "awkward narration style",
      "reporter distance",
      "residual AI narration",
      "closing timeline",
      "closing too short",
      "response incomplete",
    ]);
    const firstFailures = lastCheck?.failures || [];
    if (ALLOW_EXTERNAL_QUALITY_RETRY && !lastCheck?.ok && firstFailures.some(failure => retryableFailures.has(failure))) {
      console.warn("[generate-narration] retrying one quality revision", {
        buildId: API_BUILD_ID,
        failures: firstFailures,
      });
      const focusedEditorialFailures = new Set([
        "repeated expression",
        "reused hearing facts",
        "excessive polite endings",
        "excessive trait repetition",
        "age repetition",
        "awkward narration style",
        "reporter distance",
        "residual AI narration",
      ]);
      const useFocusedEditorialPass = firstFailures.every(failure => focusedEditorialFailures.has(failure));
      const draftClosingBody = String(parsed?.closingNarration || "")
        .replace(/(?:\d+|[〇零一二三四五六七八九十百]+)年のご生涯に心からの敬意を表し、過ごしてまいりました葬送のひととき。[\s\S]*$/u, "")
        .trim();
      const focusedDraft = JSON.stringify({
        openingNarration: parsed?.openingNarration || "",
        closingNarration: draftClosingBody,
      });
      const retryInstruction = useFocusedEditorialPass
        ? `Act as a meticulous Japanese funeral-MC copy editor. Edit the DRAFT below instead of inventing a new composition. Preserve its selected facts, section allocation, and meaning. Remove repetition, reporter distance, abstract AI phrases, incomplete noun endings, and mechanical です・ます rhythm. Replace とうかがっております with direct, family-near narration. Delete inferred labels such as ご本人らしいまめやかさ, meta-writing such as 言葉にしすぎなくても, narrator declarations such as 敬意をもって向き合います, and poetic abstractions such as 耳にそっと戻ってくる, 注がれたものへ, 日々の重なり, or かけがえのないものとして重ねる. Do not add a single new fact, emotion, object, interpretation, or scene. Keep the required opening introduction and opening final sentence. Return only the closing narrative body because the server appends the fixed guidance. DRAFT TO EDIT: ${focusedDraft}`
        : `The previous attempt failed these checks: ${firstFailures.join(", ")}. Write a fresh complete version, not a shortened patch. Every Japanese sentence must have correct particles and a complete subject-predicate relationship. Never produce collisions such as にが, をを, or raw-input transformations such as 家族を大切にしていたを大切にされた. State the smile idea only once; do not repeat it through 顔, よく笑う, 笑顔, and 明るさ. Never repeat お姿 twice in one sentence. Do not write flat reporting such as 歌ったり踊ったりすることもありました, いつも笑っていたお顔とのことです, お方でいらっしゃいました, 皆様がよくご存じです, or ご家族が語ってくださった. Stay inside the family's remembered scene instead of reporting the interview. Never write 明るさを重ねる or leave a sentence as 家族を大切にしておられたこと。 Complete it with a natural predicate. After a supplied quotation, do not explain it as 人との向き合い方, 生き方, 考え方, 教え, or philosophy; let the words stand quietly. Avoid AI-like abstractions such as 暮らしに寄り添う楽しみ. Do not write an extra age phrase beyond the required opening introduction. Never turn 明るさを見習いたい into 明るく前向きに歩んでいきたい. Do not claim that the room or atmosphere became brighter. Do not invent artifacts such as 手芸の品, interpret a supplied action as 前を向いて動く, call a voice 忘れがたい, or instruct the family to お進みください. If the family says that singing and dancing looked cute, describe that specific姿 only; never rewrite it as いつも可愛い方だった. Partition facts before writing: opening uses at most three facts and closing uses only one or two facts never used in opening. Do not write any fixed closing guidance because the server appends it. Do not use stacked noun fragments or mixed seasonal grammar.`;
      parsed = await requestNarration({
        apiKey,
        model,
        temperature,
        maxTokens,
        prompt,
        extraInstruction: retryInstruction,
      });
      parsed = normalizeQuotationContext(limitDirectQuotes(parsed));
      try {
        lastCheck = qualityCheckNarration(parsed, rawPrompt);
      } catch (qualityError) {
        lastCheck = { ok: false, failures: ["quality check error"] };
      }
      if (parsed?.generationDiagnostics?.possibleTruncation) {
        lastCheck = {
          ok: false,
          failures: Array.from(new Set([...(lastCheck?.failures || []), "response incomplete"])),
        };
      }
    }

    const hardRetryFailures = new Set([
      "missing narration",
      "control label leaked",
      "opening order",
      "seasonal grammar",
      "stacked noun fragments",
      "broken Japanese grammar",
      "invented family feeling",
      "outsider perspective",
      "unsafe interpretation",
      "opening closing overlap",
      "closing timeline",
      "too many direct quotes",
      "closing too short",
      "response incomplete",
    ]);
    const remainingFailures = lastCheck?.failures || [];
    if (ALLOW_EXTERNAL_QUALITY_RETRY && !lastCheck?.ok && remainingFailures.some(failure => hardRetryFailures.has(failure))) {
      console.warn("[generate-narration] retrying minimal grounded version", {
        buildId: API_BUILD_ID,
        failures: remainingFailures,
      });
      parsed = await requestNarration({
        apiKey,
        model,
        temperature: 0.1,
        maxTokens,
        prompt,
        extraInstruction: `SAFE MINIMAL VERSION. The previous draft still failed: ${remainingFailures.join(", ")}. Write a shorter complete manuscript using direct factual restatement only. Opening: seasonal sentence, required full-name life sentence, then no more than four short factual sentences drawn from at most two Hearing Sheet fields, then the exact opening final sentence. Closing: two to four short factual sentences drawn from one unused Hearing Sheet field. Do not add a transition that interprets personality, family emotion, atmosphere, meaning, legacy, lesson, voice, gaze, hands, scenery, or inner life. Do not direct the family to do, feel, remember, proceed, pray, offer, or imagine anything. Do not add fixed closing guidance because the server appends it. Prefer plain sentences such as 手芸を楽しまれました over vivid or poetic prose.`,
      });
      parsed = normalizeQuotationContext(limitDirectQuotes(parsed));
      try {
        lastCheck = qualityCheckNarration(parsed, rawPrompt);
      } catch (qualityError) {
        lastCheck = { ok: false, failures: ["quality check error"] };
      }
      if (parsed?.generationDiagnostics?.possibleTruncation) {
        lastCheck = {
          ok: false,
          failures: Array.from(new Set([...(lastCheck?.failures || []), "response incomplete"])),
        };
      }
    }

    if (!lastCheck?.ok) {
      console.warn("[generate-narration] quality check failed", {
        buildId: API_BUILD_ID,
        failures: lastCheck?.failures || [],
      });
      const criticalFailures = new Set([
        "missing narration",
        "control label leaked",
        "opening order",
        "seasonal grammar",
        "stacked noun fragments",
        "broken Japanese grammar",
        "invented family feeling",
        "outsider perspective",
        "unsafe interpretation",
        "opening closing overlap",
        "closing timeline",
        "too many direct quotes",
        "response incomplete",
      ]);
      const hasCriticalFailure = (lastCheck?.failures || []).some(failure => criticalFailures.has(failure));
      if (!hasCriticalFailure && (parsed?.openingNarration || parsed?.closingNarration)) {
        res.statusCode = 200;
        res.end(JSON.stringify({
          ...parsed,
          ...applyNameRule(parsed, rawPrompt),
          generationSource: "openai",
          qualityWarning: QUALITY_CHECK_FAILED_MESSAGE,
          qualityFailures: lastCheck?.failures || [],
          improvementNotes: "",
        }));
        return;
      }
      res.statusCode = 422;
      res.end(JSON.stringify({
        code: "GENERATION_QUALITY_CHECK_FAILED",
        error: QUALITY_CHECK_FAILED_MESSAGE,
        qualityFailures: lastCheck?.failures || [],
      }));
      return;
    }

    res.statusCode = 200;
    res.end(JSON.stringify({
      ...parsed,
      ...applyNameRule(parsed, rawPrompt),
    }));
  } catch (error) {
    console.error("[generate-narration] failed", {
      buildId: API_BUILD_ID,
      message: error.message,
      status: error.status || null,
      openAiError: error.openAiError || null,
    });
    if (error.message === "OPENAI_REQUEST_FAILED") {
      res.statusCode = 502;
      res.end(JSON.stringify({
        code: "OPENAI_REQUEST_FAILED",
        error: "OpenAI request failed",
        status: error.status,
        openAiError: error.openAiError || null,
        diagnostics: { ...diagnostics, hasOpenAIKey: true },
      }));
      return;
    }
    if (error.message === "MODEL_JSON_PARSE_FAILED") {
      res.statusCode = 502;
      res.end(JSON.stringify({
        code: "MODEL_JSON_PARSE_FAILED",
        error: "OpenAI response could not be parsed as narration JSON",
        contentPreview: error.contentPreview || "",
        firstContentPreview: error.firstContentPreview || "",
        diagnostics: { ...diagnostics, hasOpenAIKey: true },
      }));
      return;
    }
    res.statusCode = 500;
    res.end(JSON.stringify({
      code: "AI_NARRATION_GENERATION_FAILED",
      error: "AI narration generation failed",
      diagnostics: { ...diagnostics, hasOpenAIKey: true },
    }));
  }
};

const compactText = (value, max = 700) => {
  const text = String(value || "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
};

const asArray = value => Array.isArray(value) ? value : [];

const MEMORY_FIELD_ORDER = [
  "familyMemories",
  "memorableEvents",
  "favoritePhrases",
  "hobbies",
  "personality",
  "travelAnniversaryEffort",
  "valuedThings",
  "familyFeelings",
  "notes",
];

const MEMORY_CONCEPTS = [
  ["smile", /笑|微笑|朗らか|明る|にこやか/u],
  ["calm", /穏やか|静かな人|物静か/u],
  ["travel", /旅|旅行|出かけ|六甲|小倉|下関|博多/u],
  ["golf", /ゴルフ|クラブ|コース|ラウンド/u],
  ["growing", /花|野菜|畑|育て|園芸/u],
  ["craft", /手芸|編み|縫|針|工作/u],
  ["music", /歌|カラオケ|踊/u],
  ["work", /仕事|商店|会社|働|勤め/u],
  ["kindness", /優し|思いや|気遣|悪口/u],
];

const meaningfulFragmentOverlap = (left, right, size = 4) => {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return false;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length >= 6 && longer.includes(shorter)) return true;
  for (let index = 0; index <= shorter.length - size; index += 1) {
    const fragment = shorter.slice(index, index + size);
    if (longer.includes(fragment)) return true;
  }
  return false;
};

const memoryConceptsFor = text => new Set(
  MEMORY_CONCEPTS
    .filter(([, pattern]) => pattern.test(String(text || "")))
    .map(([concept]) => concept)
);

const memoryCardsOverlap = (left, right) => {
  if (!left || !right) return false;
  if (meaningfulFragmentOverlap(left.text, right.text)) return true;
  const leftConcepts = memoryConceptsFor(left.text);
  const rightConcepts = memoryConceptsFor(right.text);
  return [...leftConcepts].some(concept => rightConcepts.has(concept));
};

const pickMemoryCards = compactSheet => {
  const cards = MEMORY_FIELD_ORDER
    .filter(field => compactSheet[field])
    .map(field => ({ field, text: compactSheet[field] }));
  const byField = field => cards.find(card => card.field === field);
  const selectedOpening = [];
  const selectedClosing = [];

  const openingAnchor = [
    "familyMemories",
    "memorableEvents",
    "hobbies",
    "personality",
    "favoritePhrases",
    "valuedThings",
    "travelAnniversaryEffort",
    "notes",
  ].map(byField).find(Boolean) || null;
  if (openingAnchor) selectedOpening.push(openingAnchor);

  const closingAnchor = [
    "travelAnniversaryEffort",
    "memorableEvents",
    "hobbies",
    "valuedThings",
    "familyFeelings",
    "favoritePhrases",
    "personality",
    "notes",
  ].map(byField).find(card =>
    card &&
    card.field !== openingAnchor?.field &&
    !memoryCardsOverlap(openingAnchor, card)
  ) || null;
  if (closingAnchor) selectedClosing.push(closingAnchor);

  [
    "memorableEvents",
    "favoritePhrases",
    "hobbies",
    "personality",
  ].map(byField).filter(Boolean).forEach(card => {
    if (selectedOpening.length >= 3) return;
    if (selectedOpening.some(selected => selected.field === card.field)) return;
    if (selectedClosing.some(selected => selected.field === card.field)) return;
    if (selectedOpening.some(selected => memoryCardsOverlap(selected, card))) return;
    if (selectedClosing.some(selected => memoryCardsOverlap(selected, card))) return;
    selectedOpening.push(card);
  });

  return {
    opening: {
      anchor: selectedOpening[0] || null,
      supports: selectedOpening.slice(1),
      maximumFacts: 3,
      purpose: "ご家族が最初に思い浮かべる、その人らしい一場面から始める",
    },
    closing: {
      anchor: selectedClosing[0] || null,
      supports: [],
      maximumFacts: 1,
      purpose: "開式前とは別の具体的な思い出を一つだけたどり、説明を加えず余韻へつなぐ",
    },
  };
};

const compactNarrationPrompt = prompt => {
  const payload = extractPromptPayload(prompt);
  if (!payload) return compactText(prompt, 6000);
  const sheet = payload.hearingSheet || {};
  const writingRules = payload.writingRules || {};
  const compactSheet = {};
  [
    "deceasedName",
    "narrationName",
    "age",
    "gender",
    "familyRelation",
    "deceasedDate",
    "ceremonyType",
    ...MEMORY_FIELD_ORDER,
  ].forEach(key => {
    if (sheet[key] !== undefined && sheet[key] !== null && String(sheet[key]).trim()) {
      compactSheet[key] = compactText(sheet[key], 900);
    }
  });

  const selectedStyleReference = asArray(payload.selectedLibraryStyleReferences).slice(0, 1).map(ref => ({
    title: compactText(ref.title, 100),
    theme: compactText(ref.theme, 100),
    tags: asArray(ref.tags).slice(0, 10),
    openingNarration: compactText(ref.openingNarration, 650),
    closingNarration: compactText(ref.closingNarration, 500),
    writingNotes: compactText(ref.writingNotes || ref.approvalReason, 420),
  }))[0] || null;

  const memoryPlan = pickMemoryCards(compactSheet);
  const identity = {};
  [
    "deceasedName",
    "narrationName",
    "age",
    "gender",
    "familyRelation",
    "deceasedDate",
    "ceremonyType",
  ].forEach(key => {
    if (compactSheet[key]) identity[key] = compactSheet[key];
  });
  const sourceFacts = {
    identity,
    opening: [
      memoryPlan.opening.anchor,
      ...memoryPlan.opening.supports,
    ].filter(Boolean),
    closing: [
      memoryPlan.closing.anchor,
      ...memoryPlan.closing.supports,
    ].filter(Boolean),
  };

  return [
    "Write a memory-first funeral narration from the JSON below.",
    "Use only sourceFacts. Unselected facts are intentionally absent and must not be guessed.",
    "Begin the opening body with memoryPlan.opening.anchor. Supports are optional; omit any support that makes the paragraph sound like a profile or list.",
    "Begin closing with memoryPlan.closing.anchor when present. Do not summarize the opening. If closing has no selected fact, write only a very short neutral aftertaste without inventing content.",
    "Do not explain why a fact shows personality. Let the supplied memory stand on its own.",
    "Return one raw JSON object with openingNarration, closingNarration, detectedTheme, and an empty improvementNotes. No labels, markdown, notes, or text outside JSON.",
    JSON.stringify({
      season: writingRules.season || "",
      theme: writingRules.theme || payload.writingRules?.theme || "",
      nameUsageRule: writingRules.nameUsageRule || "",
      forbiddenWords: asArray(writingRules.forbiddenWords).slice(0, 20),
      sourceFacts,
      memoryPlan,
      selectedStyleReference,
    }, null, 2),
  ].join("\n");
};

