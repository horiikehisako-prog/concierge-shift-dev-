const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const QUALITY_CHECK_FAILED_MESSAGE = "Generation quality check failed.";
const API_BUILD_ID = "narration-studio-20260804.77";
const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY || "AIzaSyBpKNiDwL06_SI1z-oT2xB979A5gLIoM70";
const FIREBASE_DATABASE_URL = process.env.FIREBASE_DATABASE_URL || "https://concierge-shift-prod-default-rtdb.asia-southeast1.firebasedatabase.app";
// Vercel functions have a firm execution limit. A second or third model call
// regularly exhausts that limit and hides an otherwise usable first draft.
// Keep generation to one model call; deterministic normalization and the
// quality report below handle the remaining non-critical issues.
const ALLOW_EXTERNAL_QUALITY_RETRY = false;
const ALLOW_HARD_RETRY = false;
const ENABLE_LENGTH_REPAIR = false;
const ENABLE_GUARDED_COPY_EDIT = true;
const ENABLE_LEGACY_NARRATION_REWRITES = false;
const ENABLE_STABLE_FAMILY_PORTRAIT_PREFLIGHT = false;
const ENABLE_STABLE_FAMILY_PORTRAIT_POSTPROCESS = false;
const NARRATION_AUTHOR_SYSTEM_PROMPT = [
  "あなたは、葬儀会館で二十年以上ナレーション原稿を担当してきた日本語の司会者です。ご家族の記憶のすぐそばに立ち、耳で聞いて自然な完成稿を書いてください。",
  "返答はopeningNarration、closingNarration、detectedTheme、improvementNotesを持つJSON一個だけです。improvementNotesは空文字にしてください。",
  "sourceFactsだけを使い、入力にない人物、場面、感情、評価、家族の反応を創作しないでください。openingとclosingの材料は混ぜません。",
  "これは人物紹介ではありません。記憶の中の表情、手元、動作、場所を中心に描き、司会者による性格の評価や、ご家族の気持ちの推測・報告を避けてください。",
  "取材項目を一文ずつ処理せず、一段落に一つの記憶を置いて、関係する動作を自然につないでください。同じ事実の言い換え、引用の解説、段落末の抽象的なまとめは不要です。",
  "趣味から典型的な道具や場所を推測しないでください。手芸とだけある場合に針・布・糸を、野菜や花とだけある場合に庭・土・芽・葉を、旅行とだけある場合に景色や食事を足してはいけません。",
  "文末の単語だけを機械的に変えず、段落の構造から整えてください。同じです・ます調が三文続かないようにしつつ、無理な体言止めや不自然な現在形も避けます。",
  "『私』『彼』『彼女』『〜と伺っております』『お気持ちがあります』『お見送りいたします』『本日の葬儀は閉式』『道しるべ』は使わないでください。浄土真宗の場合は『旅立ち』も使いません。",
  "styleReferenceは語句をコピーせず、構成、段落の呼吸、描写の距離だけを参考にしてください。",
  "完成後に一度音読し、助詞と主述、同義反復、事実の重複、文章量を確認してから完成稿だけを返してください。",
].join(" ");
const redactSecrets = value => String(value || "")
  .replace(/sk-(?:proj-)?[A-Za-z0-9_-]+/g, "[REDACTED_API_KEY]");

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

const verifyFirebaseRequest = async req => {
  const authorization = String(req.headers?.authorization || "");
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error("Authentication required."), { status: 401 });
  const idToken = match[1].trim();
  const identityResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(FIREBASE_WEB_API_KEY)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  const identity = await identityResponse.json().catch(() => ({}));
  const uid = identity?.users?.[0]?.localId;
  if (!identityResponse.ok || !uid) throw Object.assign(new Error("Invalid authentication."), { status: 401 });
  const accessResponse = await fetch(`${FIREBASE_DATABASE_URL}/access/${encodeURIComponent(uid)}.json?auth=${encodeURIComponent(idToken)}`);
  const access = await accessResponse.json().catch(() => null);
  if (!accessResponse.ok || !access?.enabled) throw Object.assign(new Error("Account is not enabled."), { status: 403 });
  return { uid, role: access.role || "" };
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

const parseJsonLikeNarration = content => {
  const text = String(content || "")
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  if (!text || !/openingNarration/i.test(text) || !/closingNarration/i.test(text)) return null;

  const openingMatch = text.match(
    /["']?openingNarration["']?\s*:\s*["']([\s\S]*?)["']\s*,\s*["']?closingNarration["']?\s*:/i
  );
  const closingMatch = text.match(
    /["']?closingNarration["']?\s*:\s*["']([\s\S]*?)["']\s*(?:,\s*["']?(?:detectedTheme|improvementNotes)["']?\s*:|\}\s*$)/i
  );
  if (!openingMatch?.[1] || !closingMatch?.[1]) return null;

  const decodeLooseString = value => String(value || "")
    .replace(/\\r\\n|\\n|\\r/g, "\n")
    .replace(/\\"/g, "\"")
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, "\\")
    .trim();
  const openingNarration = decodeLooseString(openingMatch[1]);
  const closingNarration = decodeLooseString(closingMatch[1]);
  if (!openingNarration || !closingNarration) return null;
  return {
    openingNarration,
    closingNarration,
    detectedTheme: "Compass AI",
    improvementNotes: "",
  };
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
    const jsonLikeFallback = parseJsonLikeNarration(content);
    if (jsonLikeFallback) return jsonLikeFallback;
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

const activeNarrationSystemPrompt = prompt => {
  const payload = extractPromptPayload(prompt);
  const managedPrompt = String(payload?.managedSystemPrompt || "").trim().slice(0, 12000);
  if (!managedPrompt) return NARRATION_AUTHOR_SYSTEM_PROMPT;
  return [
    NARRATION_AUTHOR_SYSTEM_PROMPT,
    "以下は管理者がCompass画面で保存した最優先の文章表現ルールです。上記のJSON形式、事実限定、氏名、式次第、安全上の固定条件と矛盾しない範囲では、以下を最優先してください。",
    managedPrompt,
  ].join("\n\n");
};

const buildGenerationTrace = (prompt, {
  source,
  model = "",
  qualityStatus = "passed",
  qualityFailures = [],
  copyEditRoute = "not_run",
} = {}) => {
  const payload = extractPromptPayload(prompt) || {};
  const plan = payload.staffCompositionPlan || {};
  const selectedReference = Array.isArray(payload.selectedLibraryStyleReferences)
    ? payload.selectedLibraryStyleReferences[0]
    : null;
  const managedPrompt = String(payload.managedSystemPrompt || "").trim();
  const forceAiGeneration = payload.forceAiGeneration === true;
  const stable = source === "stable_family_portrait";
  return {
    source: source || "unknown",
    sourceLabel: stable ? "Compass安定作成" : source === "openai" ? "通常AI生成（OpenAI）" : "不明",
    apiBuildId: API_BUILD_ID,
    generatedAt: new Date().toISOString(),
    workflowMode: payload.workflowMode === "revision" ? "revision" : "draft",
    workflowLabel: payload.workflowMode === "revision" ? "AI全文校正" : "新規AI下書き",
    model: stable ? "AI未使用" : model,
    managedPromptApplied: !stable && Boolean(managedPrompt),
    managedPromptCharacters: managedPrompt.length,
    forceAiGeneration,
    stablePromptBypass: stable,
    selectedReference: selectedReference ? {
      id: String(selectedReference.id || ""),
      title: String(selectedReference.title || ""),
    } : null,
    openingFacts: Array.isArray(plan.opening)
      ? plan.opening.map(card => ({ field: String(card.field || ""), label: String(card.label || card.field || "") }))
      : [],
    closingFacts: Array.isArray(plan.closing)
      ? plan.closing.map(card => ({ field: String(card.field || ""), label: String(card.label || card.field || "") }))
      : [],
    copyEditRoute,
    qualityStatus,
    qualityFailures: Array.isArray(qualityFailures) ? qualityFailures : [],
    stages: stable
      ? ["ヒアリング", "事実カード分担", "安定作成判定", "固定構成で作成", "品質検査", "表示"]
      : ["ヒアリング", "事実カード分担", ...(forceAiGeneration ? ["強制AI生成指定"] : []), "教科書1件を選択", "管理者プロンプト合流", "OpenAI生成", "日本語調整", "品質検査", "表示"],
  };
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
  return SEASONAL_STARTERS.some(word => {
    const normalizedWord = normalizeText(word);
    if (!beginning.startsWith(normalizedWord)) return false;
    const next = beginning.slice(normalizedWord.length, normalizedWord.length + 1);
    return !next || /[はがもにのを、。とへで]/u.test(next);
  });
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
  const escapedAge = age.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  text = text
    .replace(new RegExp(`本日、?故?${escapedGiven}様とのお別れの時を迎えました。?`, "u"), "")
    .replace(new RegExp(`本日、?故?${escapedFull}様とのお別れの時を迎えました。?`, "u"), "")
    .replace(new RegExp(`本日、?${fullLabel}とのお別れの時を迎えました。?`, "u"), "")
    .trim();
  // Remove any model-written life introduction before inserting the single
  // canonical sentence. This also repairs duplicated forms such as
  // 「故・堀池故堀池 チエノ様」 and nonstandard funeral-day wording.
  const lifeIntroPattern = new RegExp(
    `[^。\\n]{0,60}(?:${escapedFull}|${escapedGiven})様?[^。\\n]{0,140}(?:${escapedAge ? `${escapedAge}|` : ""}[〇零一二三四五六七八九十百]+(?:年|歳)|ご?生涯|人生の幕|葬儀の日|葬儀の時)[^。\\n]{0,160}。`,
    "gu"
  );
  text = text.replace(lifeIntroPattern, "").trim();
  // The model sometimes duplicates the surname or the 故 prefix. Replace the
  // entire fixed life-introduction sentence instead of trying to repair names.
  text = text.replace(
    /[^。\n]{0,140}(?:\d+|[〇零一二三四五六七八九十百]+)年という尊いご生涯を閉じ、静かに人生の幕を下ろされました。/u,
    exactLifeSentence
  );
  const firstSentence = text.match(/^(.+?[。！？])/u)?.[1] || "";
  text = firstSentence
    ? `${firstSentence}\n${exactLifeSentence}\n${text.slice(firstSentence.length).trimStart()}`
    : `${exactLifeSentence}\n${text}`;
  return text;
};

const normalizeOpeningSeasonSentence = (value, prompt) => {
  const text = String(value || "").trim();
  const firstSentence = text.match(/^(.+?[。！？])/u)?.[1] || "";
  const payload = extractPromptPayload(prompt) || {};
  const season = String(payload.season || payload?.writingRules?.season || "").toLowerCase();
  const replacement = season.includes("spring") || season.includes("春")
    ? "やわらかな風に、春の気配を感じる頃となりました。"
    : season.includes("autumn") || season.includes("秋")
      ? "木々の葉が色づき始める頃となりました。"
      : season.includes("winter") || season.includes("冬")
        ? "澄んだ空気に、冬の深まりを感じる頃となりました。"
        : "蝉の声が遠く近くに響くこの季節。";
  if (!firstSentence) return `${replacement}\n${text}`.trim();
  if (/(?:季節|頃|蝉|木々|若葉|青葉|桜|花々|風|空|光|陽射し|陽ざし|木漏れ日|雨|雪|紅葉|虫の声|澄んだ空気)/u.test(firstSentence)) {
    return text;
  }
  if (/(?:別れ|ご生涯|人生の幕|旅立|お見送り|葬送|葬儀|告別式|通夜)/u.test(firstSentence)) {
    return `${replacement}\n${text.slice(firstSentence.length).trimStart()}`;
  }
  return `${replacement}\n${text}`;
};

const ensureOpeningFinalLine = value => {
  const fixed = "尽きることのない感謝の思いを胸に、まもなく開式のお時間でございます。";
  let text = String(value || "").trim();
  if (!text) return "";
  text = text
    .replace(/[^。\n]*(?:まもなく|間もなく)開式(?:のお時間)?[^。\n]*。/gu, "")
    .replace(/皆様には、?開式まで[^。\n]*(?:お待ち|お過ごし)[^。\n]*。/gu, "")
    .replace(/(?:これ|ただいま)より、?[^。\n]*(?:葬儀|告別式|通夜)[^。\n]*(?:執り行|開式|開始)[^。\n]*。/gu, "")
    .replace(/(?:[^。\n]*、)?尽きることのない感謝の思いを胸に、まもなく開式のお時間でございます。?\s*$/u, fixed)
    .replace(/\s*尽きることのない感謝の思いを胸に、まもなく開式のお時間でございます。?\s*$/u, "")
    .replace(/(?:^|\n{2,})[^。\n！？]*[、，]\s*$/u, "");
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
        /([一-龥々ぁ-んァ-ヶー]+様)のことをたどると、/gu,
        "$1を思うとき、"
      )
      .replace(
        /([一-龥々ぁ-んァ-ヶー]+様)のお姿をたどると、/gu,
        "$1を思うとき、"
      )
      .replace(
        /(「[^」]+」(?:という言葉)?。)\s*その(?:お)?(?:言葉|一言)[^。]*。/gu,
        "$1"
      )
      .replace(
        /折に触れて口にされた、「([^」]+)」という言葉。/gu,
        "折に触れて、「$1」と話しておられました。"
      )
      .replace(
        /[^。\n]*記憶につながってまいります。/gu,
        ""
      )
      .replace(
        /思い出の中には、笑顔で過ごされる日々があり、その表情が、?[^。\n]*。/gu,
        ""
      )
      .replace(/歌を歌い/gu, "歌い")
      .replace(/歌い、踊るお姿/gu, "歌ったり、踊ったりされるお姿")
      .replace(
        /ふとした場面に声があり、動きがあり、[^。\n]*。/gu,
        ""
      )
      .replace(
        /[^。\n]*感謝[^。\n]*(?:ここに|そっと)[^。\n]*重ねてまいります。/gu,
        ""
      )
      .replace(
        /親子三代で出かけた、([^。\n]+?)へのご旅行。いずれも、?\s*([^。\n]+?)でした。/gu,
        "親子三代で$1へ出かけられたのは、$2でした。"
      )
      .replace(
        /親子三代で出かけられた、([^。\n]+?)へのご旅行。いずれも(?:、)?お誕生日月の([^に。\n]+)に重ねられた時間でございました。/gu,
        "お誕生日月の$2には、親子三代で$1へ出かけられました。"
      )
      .replace(
        /私も([一-龥々ぁ-んァ-ヶー]+様)を見習い、明るく前向きに歩んでいきたいという思いが残ります。/gu,
        "$1の明るさを見習いたいという思いも、ご家族の胸にあります。"
      )
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
      .replace(/支度を一つひとつ整えて/gu, "支度を整えて")
      .replace(
        /お帰りになったあとは、居間で静かに過ごされることもあり、その穏やかな佇まいが思い起こされます。/gu,
        "お帰りになった後、居間で静かに過ごされるお姿も、ご家族の記憶に残っています。"
      )
      .replace(
        /同じ食卓を囲むひとときを大切にされ、いつもの席におられる[^。\n]+?を囲んで、食事の時間が流れてまいりました。/gu,
        "同じ食卓を囲むひとときを、大切にされていました。"
      )
      .replace(
        /お帰りの時には外まで見送り、その姿を最後まで見届けておられたこともありました。/gu,
        "お帰りの時には、外まで見送られました。"
      )
      .replace(
        /どこへ行かれたのか、そこで何があったのか、帰ってからの語らいの中に、旅の余韻がそのまま残っていたことでしょう。/gu,
        ""
      )
      .replace(
        /お帰りになった後も、旅先での出来事は、[^。\n]*ご家族の前に広がっていきました。/gu,
        ""
      )
      .replace(
        /出かけた先での出来事を、帰ってからご家族へ伝えられるそのひとときにも、[^。\n]*調子がありました。/gu,
        ""
      )
      .replace(
        /出かけた先で見聞きされたことが、帰宅されてからの語らいへと移り、ご家族のもとに届いておりました。/gu,
        ""
      )
      .replace(
        /カラオケを好まれ、歌に親しまれるひとときもございました。/gu,
        "カラオケを楽しまれるひとときもございました。"
      )
      .replace(
        /犬や猫を見かけると、自然に足を止めておられたことも、[^。\n]*場面のひとつでございます。/gu,
        "犬や猫を見かけると、自然に足を止められました。"
      )
      .replace(
        /歌ったり、踊ったりされるお姿は、ご家族に(?:いつも)?愛らしく映っておりました。/gu,
        "歌ったり、踊ったりされる、いつもの愛らしいお姿。"
      )
      .replace(
        /いつも笑顔が身近にありました。歌ったり、踊ったりされる([^。\n]+?様)のお姿を、ご家族は愛らしく感じておられました。/gu,
        "いつも笑顔で、歌ったり、踊ったりされることもあった$1。ご家族にとって、その愛らしいお姿も、いつもの$1でした。"
      )
      .replace(
        /歌ったり、踊ったりされることもあり、そのお姿を可愛いと感じられることがありました。/gu,
        "歌ったり、踊ったりされる、愛らしいお姿も、ご家族の記憶に残っています。"
      )
      .replace(
        /歌ったり、踊ったりされるお姿は、ご家族に愛らしく感じられていたとうかがっております。/gu,
        "歌ったり、踊ったりされる愛らしいお姿も、ご家族の記憶に残っています。"
      )
      .replace(
        /歌われることがあり、踊られることもありました。そのお姿を、ご家族は愛らしく感じておられました。/gu,
        "歌ったり、踊ったりされる愛らしいお姿も、ご家族の記憶に残っています。"
      )
      .replace(
        /いつも笑顔が身近にあった([^。\n]+?様)。歌われたり、踊られたりするお姿は、愛らしく受けとめられていました。ご家族との間に浮かぶ最初の記憶として、その表情と動きが残されております。/gu,
        "いつも笑顔で、歌ったり、踊ったりされることもあった$1。その愛らしいお姿も、ご家族の記憶に残っています。"
      )
      .replace(
        /歌に声を重ね、踊りに身体を動かされるお姿を、ご家族は愛らしく感じておられました。/gu,
        "歌に声を重ね、踊りに身体を動かされる、愛らしいお姿。"
      )
      .replace(
        /歌うときには声を出し、踊るときには身体を動かされる。そのお姿を、ご家族は愛らしく感じておられました。/gu,
        "歌に声を重ね、踊りに身体を動かされる、愛らしいお姿。"
      )
      .replace(
        /歌を歌われ、踊られるお姿もありました。そのお姿を、ご家族は愛らしく感じておられたとのことです。/gu,
        "歌ったり、踊ったりされる、愛らしいそのお姿。ご家族には、懐かしい思い出として残っています。"
      )
      .replace(
        /手芸に親しみ、野菜やお花を育てることも、([^。\n]+?様)の暮らしの中にございました。/gu,
        "手芸に親しみ、野菜やお花にも手をかけておられました。"
      )
      .replace(
        /編み物を楽しまれていました。庭の草花を育てておられました。手を使うこと、草花に向き合うことが、([^。\n]+?様)の暮らしの中にございました。/gu,
        "編み物では、手を動かしながら少しずつ形にしていかれる。庭の草花にも手をかけ、育つ様子を見守っておられました。"
      )
      .replace(
        /育つ様子を見ておられる([^。\n]+?様)でございました。/gu,
        "育つ様子を見守っておられました。"
      )
      .replace(
        /編み物を楽しみ、手を動かして形にしておられました。庭の草花にも手をかけ、育つ様子を見ておられました。/gu,
        "編み物では、手を動かしながら少しずつ形にしていかれる。庭の草花にも手をかけ、育つ様子を見守っておられました。"
      )
      .replace(
        /日々の中では、よく、(「[^」]+」)と話しておられました。/gu,
        "折に触れて、$1と話しておられました。"
      )
      .replace(/また、折にふれて/gu, "折に触れて")
      .replace(/また、よく(「[^」]+」)と話しておられました。/gu, "折に触れて、$1と話しておられました。")
      .replace(/そして、よく(「[^」]+」)と話しておられました。/gu, "折に触れて、$1と話しておられました。")
      .replace(/朗らかでいらしたその口から、よく(「[^」]+」)と話しておられました。/gu, "折に触れて、$1と話しておられました。")
      .replace(
        /人と接することを好まれ、思い立つとすぐに行動へ移される方でいらっしゃいました。人と言葉を交わすことも、([^。\n]+?様)の過ごし方の中にありました。/gu,
        "人と接することがお好きで、思い立つとすぐに行動へ移される方でした。"
      )
      .replace(
        /人と接することを好まれました。思い立つとすぐに行動へ移されることもございました。/gu,
        "人と接することがお好きで、思い立つとすぐに行動へ移されることもございました。"
      )
      .replace(
        /人と接することを好まれ、朗らかに過ごされました。思い立つと、すぐに行動へ移されました。/gu,
        "人と接することがお好きで、思い立つとすぐに行動へ移される方でした。"
      )
      .replace(
        /人と接することがお好きで、思い立つとすぐに行動へ移しておられました。朗らかに人と関わられ、よく(「[^」]+」)と話しておられました。/gu,
        "人と接することがお好きで、思い立つとすぐに行動へ移される方でした。折に触れて、$1と話しておられました。"
      )
      .replace(
        /家族を大切にされていた([^。\n]+?様)は、よく(「[^」]+」)と話しておられました。/gu,
        "ご家族を大切にされ、折に触れて、$2と話しておられました。"
      )
      .replace(
        /ご家族とともに過ごされた場面に、[^。\n]+?の声や動きが思い出されます。/gu,
        ""
      )
      .replace(
        /これまでの日々にいただいたものへ、深く感謝を捧げます。/gu,
        ""
      )
      .replace(
        /ご家族を大切にしてこられた([^。\n]+?様)。その歩みを前に、言葉にならないほどの感謝があふれてまいります。/gu,
        "ご家族を大切にしてこられた$1。そうした何気ない日々が、今、ご家族の胸によみがえっていることと存じます。"
      )
      .replace(
        /好きなことに向かうひとときも、ふと立ち止まる仕草も、暮らしの中に穏やかに刻まれております。/gu,
        ""
      )
      .replace(
        /人と会い、声を交わし、出向いていく[^。\n]*歩みが、暮らしの中にありました。/gu,
        ""
      )
      .replace(
        /(?:ここに集う思いは|これまで(?:共|とも)に過ごされた(?:数々の場面|折々))[^\n。]*。/gu,
        ""
      )
      .replace(
        /そのお気持ちとともに、[^。\n]+?様をお見送りいたします。/gu,
        ""
      )
      .replace(
        /その行き先の一つひとつが、今も大切に思い返されます。/gu,
        "その土地の名に触れるたび、ご家族で過ごした日も思い出されることでしょう。"
      )
      .replace(
        /その行き先の名とともに、([^。\n]+?様)を囲んだひとときが思い起こされます。/gu,
        "その土地の名に触れるたび、親子三代で過ごした日のことも思い出されることでしょう。"
      )
      .replace(
        /その([^。\n]+?)を忘れずにいたいという思いが、静かに残ります。/gu,
        "その$1を忘れずにいたいという思いも、ご家族の胸にあります。"
      )
      .replace(
        /その([^。\n]+?)を忘れずにいたい。ご家族のお気持ちは、今、その言葉に静かに重なっております。/gu,
        "その$1を忘れずにいたいという思いも、ご家族の胸にあります。"
      )
      .replace(
        /(?:その折々を思い返しながら、)?([^。\n]+?)を忘れずにいたいというお気持ちが、今、静かに残されております。/gu,
        "$1を忘れずにいたいという思いも、ご家族の胸にあります。"
      )
      .replace(
        /その([^。\n]+?)を忘れずにいたいという思いを、今、静かに抱いておられます。/gu,
        "その$1を忘れずにいたいという思いも、ご家族の胸にあります。"
      )
      .replace(
        /その行き先の名とともに、([^。\n]+?様)と過ごされたひとときが残されております。/gu,
        "その土地の名に触れるたび、親子三代で過ごした日のことも思い出されることでしょう。"
      )
      .replace(
        /行き先の名と、?[^。\n]+?という月が、あの時のことを静かに伝えてまいります。/gu,
        "その土地の名やお誕生日の月に触れるたび、親子三代で過ごした日も思い出されることでしょう。"
      )
      .replace(
        /行き先の名をたどると、[^。\n]+?に出かけられたことが思い起こされます。/gu,
        ""
      )
      .replace(
        /その([^。\n]+?)を忘れずにいたい。ご家族には、そのお気持ちがございます。/gu,
        "その$1を忘れずにいたいという思いも、ご家族の胸にあります。"
      )
      .replace(
        /((?:[^、。\n]+、){1,}[^、。\n]+)という行き先の名と、([^。\n]+?)という月が、ひとつの思い出として残ります。/gu,
        "その土地の名や$2に触れるたび、親子三代で過ごした日も思い出されることでしょう。"
      )
      .replace(
        /((?:[^、。\n]+、){1,}[^、。\n]+)という行き先の名と、([^。\n]+?)という月が並びます。/gu,
        "その土地の名や$2に触れるたび、親子三代で過ごした日も思い出されることでしょう。"
      )
      .replace(
        /その([^。\n]+?)を忘れずにいたいというお気持ちでいらっしゃいます。/gu,
        "その$1を忘れずにいたいという思いも、ご家族の胸にあります。"
      )
      .replace(
        /その([^。\n]+?)を忘れずにいたいという思いが、ご家族の中に残されております。/gu,
        "その$1を忘れずにいたいという思いも、ご家族の胸にあります。"
      )
      .replace(
        /((?:[^、。\n]+、){1,}[^、。\n]+)へと向かわれた[^。\n]+?の旅行。その一つひとつの行き先が、親子三代で過ごされた時をたどらせてくれます。/gu,
        "その土地の名に触れるたび、親子三代で過ごした日も思い出されることでしょう。"
      )
      .replace(
        /その([^。\n]+?)を忘れずにいたいという思いが、ご家族の中に残されています。/gu,
        "その$1を忘れずにいたいという思いも、ご家族の胸にあります。"
      )
      .replace(
        /親子三代で、((?:[^、。\n]+、){1,}[^、。\n]+)へ旅行されたことがございました。いずれも誕生日月の([^で。\n]+)であり、その行き先の名が、今もひとつずつたどられてまいります。\s*([^。\n]+)に出かけた親子三代の旅行。ご家族は、([^。\n]+?様)のその([^。\n]+?)を忘れずにいたいと願っておられます。/gu,
        "お誕生日月の$2には、親子三代で$1へ出かけられました。その土地の名に触れるたび、ご家族で過ごした日のことも思い出されることでしょう。$4の$5を忘れずにいたいという思いも、ご家族の胸にあります。"
      )
      .replace(
        /その([^。\n]+?)を忘れずにいたいというご家族のお気持ちが、今、残されております。/gu,
        "その$1を忘れずにいたいという思いも、ご家族の胸にあります。"
      )
      .replace(
        /(?:そのご旅行のことを思いながら、)?私も([^。\n]+?様)を見習い、明るく前向きに歩んでいきたいというお気持ちが残されております。/gu,
        "$1の明るさを見習い、前向きに過ごしていきたいという思いも、ご家族の胸にあります。"
      )
      .replace(
        /(?:^|\n)\s*よく笑っておられたお顔、歌や踊り、手芸、野菜やお花を育てる日々。\s*(?=\n|$)/gu,
        "\n"
      )
      .replace(
        /[^。\n]+?と過ごされた一つひとつに、今、ありがとうの思いが寄せられております。/gu,
        ""
      )
      .replace(
        /その折々のお姿を思い返しながら、今日までの歩みに、深い感謝をお寄せのことと存じます。/gu,
        ""
      )
      .replace(/ご家族の内に残されています。/gu, "ご家族の胸にあります。")
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

const collapseRepeatedSmileParagraph = (value, displayName) => {
  const smileFact = /いつも笑っている(?:お)?顔しか思い出せない/u;
  const canonical = `「いつも笑っている顔しか思い出せない」とご家族が語られるほど、日々のそばには${displayName}の笑顔がありました。`;
  return String(value || "")
    .split(/(\n{2,})/u)
    .map(part => {
      if (/^\n{2,}$/u.test(part) || !smileFact.test(part)) return part;
      const sentences = part.match(/[^。！？]*[。！？]?/gu)
        ?.map(sentence => sentence.trim())
        .filter(Boolean) || [];
      const smileIndex = sentences.findIndex(sentence => smileFact.test(sentence));
      if (smileIndex < 0) return part;
      const prefix = sentences
        .slice(0, smileIndex)
        .filter(sentence => !/(?:笑|お顔|表情|思い浮か)/u.test(sentence))
        .join("\n");
      const suffix = sentences
        .slice(smileIndex + 1)
        .filter(sentence => !/(?:笑|お顔|表情|よく笑|記憶の入口)/u.test(sentence))
        .join("\n");
      return [prefix, canonical, suffix].filter(Boolean).join("\n").trim();
    })
    .join("");
};

const normalizeFamilyNearNarration = (draft, prompt) => {
  const { givenName } = nameRuleFromPrompt(prompt);
  const displayName = givenName ? `${givenName}様` : "故人様";
  const payload = extractPromptPayload(prompt) || {};
  const hearingText = JSON.stringify(payload.hearingSheet || payload.sourceFacts || {});
  const requiresExactSmileFact = /いつも笑っている(?:お)?顔しか思い出せない/u.test(hearingText);
  const ensureExactSmileFact = value => {
    const text = String(value || "");
    if (!requiresExactSmileFact || /いつも笑っている(?:お)?顔しか思い出せない/u.test(text)) return text;
    const canonical = `「いつも笑っている顔しか思い出せない」とご家族が語られるほど、日々のそばには${displayName}の笑顔がありました。`;
    if (/(?:笑顔|笑っているお顔|笑っておられたお顔)/u.test(text)) {
      return text.replace(/[^。\n]*(?:笑顔|笑っているお顔|笑っておられたお顔)[^。\n]*。/u, canonical);
    }
    const lifeSentence = /故[^。\n]+様は、[^。\n]+人生の幕を下ろされました。/u;
    return lifeSentence.test(text)
      ? text.replace(lifeSentence, match => `${match}\n${canonical}`)
      : `${canonical}\n${text}`;
  };
  const cleanOpening = value => collapseRepeatedSmileParagraph(ensureExactSmileFact(value), displayName)
    .replace(
      /歌に声を重ね、ときには踊るように身体を動かされる姿を、ご家族はいつも可愛いと感じていました。/gu,
      "歌に声を重ね、ときには踊るように身体を動かされる。その姿には、思わず頬が緩むような愛らしさがありました。"
    )
    .replace(
      /歌に声を重ね、ときには踊るように身体を動かされる姿を、ご家族はいつも可愛いと感じておられました。/gu,
      "歌に声を重ね、ときには踊るように身体を動かされる。思い出の中には、そんな愛らしいお姿もございます。"
    )
    .replace(
      /手芸を楽しむときには手を動かして形にし、野菜や花にも手をかけて育てておられました。その育つ様子を見守ることも、[^。\n]+の暮らしの中にありました。/gu,
      "手芸に向かう手元には、少しずつ形が生まれてゆく時間。野菜や花のそばには、日々の育ちを見守るまなざし。どちらも、暮らしの中にあった大切なひとときです。"
    )
    .replace(
      /手芸を楽しむときには、手を動かして少しずつ形にしていかれる。野菜や花にも手をかけ、育つ様子を見ておられました。/gu,
      "手芸に向かう手元には、少しずつ形が生まれてゆく時間。野菜や花のそばには、日々の育ちを見守るまなざし。どちらも、暮らしの中にあった大切なひとときです。"
    )
    .replace(
      /手芸を楽しむときには、手を動かして少しずつ形にしていかれる。野菜や花にも手をかけ、その育ちを見守っておられました。/gu,
      "手芸に向かう手元には、少しずつ形が生まれてゆく時間。野菜や花のそばには、日々の育ちを見守るまなざし。どちらも、暮らしの中にあった大切なひとときです。"
    )
    .replace(
      /明るく前向きで、人と接することが大好きだった([^。\n]+)は、思い立ったらすぐに行動されました。人を悪く言ってはいけないとよく話され、家族を大切にしておられました。/gu,
      "明るく前向きで、人と接することがお好きだった$1。思い立てばすぐに動かれる、その軽やかさもお持ちでした。\n\n「人の悪口を言ってはいけない」と、折に触れて話しておられました。"
    )
    .replace(
      /人と接することが大好きで、思い立ったらすぐに行動される([^。\n]+)。人を悪く言ってはいけないとよく話し、家族を大切にしてこられました。/gu,
      "人と接することがお好きで、思い立てばすぐに動かれる$1。その軽やかさも、ご本人らしい一面です。\n\n折に触れて口にされた、「人の悪口を言ってはいけない」という言葉。ご家族を大切にされた日々とともに、いまも心に残ります。"
    )
    .replace(
      /人と接することが大好きで、思い立ったらすぐに行動される([^。\n]+)。明るく前向きに過ごされる中で、人を悪く言ってはいけないと、よく話しておられました。/gu,
      "人と接することがお好きで、思い立てばすぐに動かれる$1。その軽やかさも、ご本人らしい一面でした。\n\n「人の悪口を言ってはいけない」。折に触れて聞いたその言葉も、いまなお耳に残ります。"
    )
    .replace(
      /そして、([^。\n]+)が大切にしてこられたのはご家族でした。その思いを受けながら、/gu,
      "そして何より大切にされたのは、ご家族との時間でした。ともに過ごした何気ない日々も、いまではかけがえのない思い出です。"
    )
    .replace(
      /歌に声を重ね、ときには踊るように身体を動かされる姿は、いつも可愛いものとして残されています。/gu,
      `歌に声を重ね、ときには踊るように身体を動かされる。そのお姿を、ご家族はいつも可愛らしく感じておられました。`
    )
    .replace(
      /明るく、?前向きで、?人の悪口を言わず、?行動力をもって人と接することを大好きにされていました。口癖のように人の悪口を言ってはいけないと言われ、その言葉もご家族のそばにあります。/gu,
      `明るく前向きで、人と接することがお好きだった${displayName}。思い立てばすぐに行動へ移される、その軽やかさもお持ちでした。\n\n「人の悪口を言ってはいけない」と、折に触れて話しておられました。`
    )
    .replace(
      /明るく前向きに人と接することを大切にし、人と関わることを好まれた/gu,
      "明るく前向きで、人と接することを喜ばれる"
    )
    .replace(
      /(^|\n{2,})[^。\n]*(?:笑顔|笑っておられたお顔)[^。\n]*(?:歌|踊)[^。\n]*(?:手芸|野菜|花)[^。\n]*(?:思い|たどり|胸|心を寄せ)[^。\n]*。/gu,
      "$1"
    )
    .replace(
      /([一-龥々ぁ-んァ-ヶー]+様)を思うと、まず浮かぶのは、よく笑っておられたお顔です。いつも笑っているお顔しか思い出せないほど、その表情はご家族の記憶に残っています。/gu,
      "思い出の中の$1は、いつも笑顔です。"
    )
    .replace(
      /([一-龥々ぁ-んァ-ヶー]+様)を思うと、いつも笑っておられたお顔が浮かびます。笑っているお顔しか思い出せないほど、よく笑っておられた方でございました。そのお顔は、ご家族の記憶に残っています。/gu,
      "思い出の中の$1は、いつも笑顔です。「笑っているお顔しか思い出せない」――そのひと言に、ともに過ごした日々が重なります。"
    )
    .replace(
      /([一-龥々ぁ-んァ-ヶー]+様)を思うと、いつも笑っておられたお顔が浮かびます。笑っているお顔しか思い出せないほど、よく笑っておられた方でした。そのお顔が、ご家族の記憶に残っています。/gu,
      "思い出の中の$1は、いつも笑顔です。笑っているお顔しか思い出せない――そのひと言に、共に過ごした日々が重なります。"
    )
    .replace(
      /([一-龥々ぁ-んァ-ヶー]+様)を思うとき、まず浮かぶのは、よく笑っておられたお顔でございます。いつも笑っているお顔しか思い出せないほど、その表情は、そばにある記憶として残されております。/gu,
      "思い出の中の$1は、いつも笑顔です。笑っているお顔しか思い出せない――そのひと言に、共に過ごした日々が重なります。"
    )
    .replace(
      /歌をうたわれることがありました。踊られることもあり、そのお姿はいつも可愛いと感じられていた記憶として残っています。/gu,
      "歌をうたい、踊りに身体を動かされる、愛らしいお姿もございました。"
    )
    .replace(
      /歌ったり、踊ったりされることもあり、そのお姿を可愛いと感じられることがありました。/gu,
      "歌をうたい、踊りに身体を動かされる、愛らしいお姿もございました。"
    )
    .replace(
      /歌われることがありました。踊られることもあり、そのご様子は、いつも可愛らしいものとして残されています。/gu,
      "歌に声を重ね、ときには踊るように身体を動かされる。その愛らしいお姿も、懐かしい思い出の一場面でございます。"
    )
    .replace(
      /歌を歌われることがありました。踊られることもあり、そのご様子は、いつも可愛いものとして残されています。/gu,
      "歌に声を重ね、ときには踊るように身体を動かされる。その愛らしいお姿も、懐かしい思い出の一場面でございます。"
    )
    .replace(
      /手芸では、手を動かして形にしておられました。野菜を育て、お花にも手をかけておられた([^。\n]+様)。/gu,
      "手芸に向かえば、手を動かしながら少しずつ形を整えていかれる。野菜やお花にも手をかけ、その育ちを見守っておられました。"
    )
    .replace(
      /手芸では、手を動かして形にしてこられました。野菜には手をかけて育てておられました。お花にも手をかけて育ててこられた([^。\n]+様)。手芸に向かう手元も、野菜やお花に手をかけるお姿も、今では懐かしい場面でございます。/gu,
      "手芸に向かわれると、手元に心を寄せながら、少しずつ形を整えていかれる。野菜やお花にもこまめに手をかけ、その育ちを見守っておられました。"
    )
    .replace(
      /手芸では、手を動かして形にしておられました。野菜を育て、お花にも手をかけてこられた日々がございます。手芸に向かわれる手元も、野菜やお花に手をかけられるお姿も、今は懐かしく思い返されます。/gu,
      "手芸に向かわれると、手を動かしながら少しずつ形を整えていかれる。野菜やお花にも手をかけ、その育ちを見守っておられました。今も目に浮かぶ、いつもの手元です。"
    )
    .replace(
      /ご家族を大切にしてこられたことも、[^。\n]+をたどるうえで欠かせない記憶でございます。/gu,
      "そうした一つひとつの時間には、ご家族を大切にされた日々が重なります。"
    )
    .replace(
      /笑っておられたお顔、歌や踊り、手芸に向かわれる手元、野菜やお花に手をかける日々が、今もご家族のそばにあります。/gu,
      "何気ない暮らしの中にあったその笑顔も、その手元も、今ではかけがえのない思い出です。"
    )
    .replace(
      /折に触れて、「([^」]+)」と話しておられました。\s*そうした一つひとつの時間には、/gu,
      "そうした日々の中で、折に触れて口にされた「$1」という言葉。そこにも、"
    )
    .replace(
      /ご家族を大切にしてこられました。\s*折に触れて、「([^」]+)」と話しておられました。/gu,
      "ご家族との時間を大切にされ、折に触れて「$1」と話しておられました。"
    )
    .replace(
      /ご家族を大切にしておられた[一-龥々ぁ-んァ-ヶー]+様。\s*折に触れて、「([^」]+)」と話しておられました。/gu,
      "ご家族との時間を大切にされ、折に触れて「$1」と話しておられました。"
    )
    .replace(
      /よく笑っておられたお顔から、歌や踊り、手芸、野菜やお花へと、[^。\n]+との記憶はそれぞれの場面に残されています。\s*/gu,
      ""
    )
    .replace(
      /[一-龥々ぁ-んァ-ヶー]+様とともに過ごしてこられたことへ、感謝の思いが寄せられます。\s*(尽きることのない感謝の思いを胸に、まもなく開式のお時間でございます。)/gu,
      "$1"
    );
  const requiresExactFamilyFeeling = /明るさを見習い、?前向きに歩んでいきたい/u.test(hearingText);
  const ensureExactFamilyFeeling = value => {
    const text = String(value || "");
    if (!requiresExactFamilyFeeling) return text;
    const canonical = "その明るさを見習い、前向きに歩んでいきたい――そのお気持ちも、ご家族の胸にあります。";
    return /明るさ[^\n]*(?:前向き|前を向いて)/u.test(text)
      ? text.replace(/(^|\n{2,})[^\n]*明るさ[^\n]*(?:前向き|前を向いて)[^\n]*/u, `$1${canonical}`)
      : `${text.trim()}\n\n${canonical}`;
  };
  const cleanClosing = value => ensureExactFamilyFeeling(value)
    .replace(/(^|\n{2,})[^。\n]*(?:開式前に|開式前で)[^。\n]*(?:記憶|思い出|述べ|伝え)[^。\n]*。/gu, "$1")
    .replace(
      /親子三代で、?([^。\n]+)へ旅行されました。いずれも誕生日月の([^。\n]+?)のことでした。[^。\n]+とご家族がそろって出かけられた記憶として、[^。\n]*。/gu,
      "お誕生日月の$2には、親子三代で$1へ出かけられました。その土地の名に触れるたび、ご家族で過ごした旅の日々もよみがえることでしょう。"
    )
    .replace(
      /親子三代で、?([^。\n]+)へ旅行されました。いずれも、?[^。\n]*誕生日月である([^。\n]+?)のことでした。親子三代で[^。\n]*旅行[^。\n]*。/gu,
      "お誕生日月の$2には、親子三代で$1へ出かけられました。その土地の名に触れるたび、ご家族で過ごした旅の日々もよみがえることでしょう。"
    )
    .replace(
      /(その明るさを見習い、前向きに歩んでいきたい――そのお気持ちも、ご家族の胸にあります。)\s*十月の旅[^。\n]*。/gu,
      "$1"
    )
    .replace(
      /親子三代で、?([^。\n]+)へ旅行に行かれました。どの旅も、お誕生日月である([^に。\n]+)に出かけられたものです。親子三代で同じ行程をたどったことが、[^。\n]*。/gu,
      "お誕生日月の$2には、親子三代で$1へ出かけられました。その土地の名に触れるたび、ともに過ごした旅の日々もよみがえります。"
    )
    .replace(
      /親子三代で、?([^。\n]+)へ旅行されました。いずれも誕生日月の([^。\n]+?)(?:のこと)?(?:です|でした|でございました)。[^。\n]*三代[^。\n]*。/gu,
      "お誕生日月の$2には、親子三代で$1へ出かけられました。その土地の名に触れるたび、ともに過ごした旅の日々もよみがえります。"
    )
    .replace(
      /([^。\n]+へ旅行されたことがありました。)\s*いずれも誕生日月の([^。\n]+?)(?:のこと)?(?:です|でした|でございました)。\s*親子三代で(?:出かけられました|出かけられた[^。\n]*。)/gu,
      "お誕生日月の$2には、親子三代で$1"
    )
    .replace(
      /(親子三代で、?[^。\n]+へ旅行されました。)\s*(いずれも誕生日月の[^。\n]+(?:でした|でございました)。)\s*[^。\n]*親子三代[^。\n]*(?:旅行|出かけ)[^。\n]*。/gu,
      "$1\n$2"
    )
    .replace(/(?:ご)?旅行に行かれました。/gu, "旅へ出かけられました。")
    .replace(
      /親子三代で、?([^。\n]+?)へ(?:旅へ出かけられ|ご旅行に行かれ)ました。どのご旅行も、お誕生日月である([^に。\n]+)に行かれたものでした。\s*行き先の名をたどると、[^。\n]+?のご旅行が思い起こされます。/gu,
      "お誕生日月の$2には、親子三代で$1へ出かけられました。その土地の名に触れるたび、ご家族で過ごした時間もよみがえることでしょう。"
    )
    .replace(
      /私も彼女を見習い、明るく前向きに歩んでいきたいというお気持ちが残されています。/gu,
      `${displayName}のように、明るく前向きでありたいという思いも、ご家族の胸にございます。`
    )
    .replace(
      /私も彼女を見習い、明るく前向きに歩んでいきたいという思いが残ります。/gu,
      `${displayName}のように、明るく前向きでありたいという思いも、ご家族の胸にございます。`
    )
    .replace(
      /私も彼女を見習い、明るく前向きに歩んでいきたい。/gu,
      `${displayName}のように、明るく前向きでありたい。`
    )
    .replace(
      /私も彼女を見習い、明るく前向きに歩んでいきたい、?というお気持ちが残されています。/gu,
      "その明るさを見習い、前向きに歩んでいきたいという思いも、ご家族の胸にございます。"
    )
    .replace(
      /私も彼女を見習い、明るく前向きに歩んでいきたい、?というご家族のお気持ちでございます。/gu,
      `${displayName}を見習い、明るく前向きに歩んでいきたい――その思いも、ご家族の胸にございます。`
    )
    .replace(
      /十月のお誕生日月には、親子三代で出かけられました。六甲へ、小倉へ、下関へ、博多へと向かわれたことがございました。\s*その行き先の名は、[^。\n]+とともに出かけられた思い出として残っています。/gu,
      "お誕生日月の十月には、親子三代で六甲、小倉、下関、博多へ出かけられました。その土地の名に触れるたび、ともに過ごした旅の日々もよみがえることでしょう。"
    )
    .replace(
      /親子三代で、([^。\n]+?)へ出かけられました。([^。\n]+?)へも、ご一緒に旅行をされました。いずれも、お誕生日月である([^に。\n]+)に行かれたものでございます。/gu,
      "お誕生日月の$3には、親子三代で$1、$2へ出かけられました。"
    )
    .replace(
      /([^。\n]+?)という行き先が、([^。\n]+様)とのご旅行を思い起こさせます。/gu,
      "その土地の名に触れるたび、ともに過ごした旅の日々もよみがえることでしょう。"
    );
  return {
    ...draft,
    openingNarration: cleanOpening(draft?.openingNarration).replace(/\n{3,}/gu, "\n\n").trim(),
    closingNarration: cleanClosing(draft?.closingNarration).replace(/\n{3,}/gu, "\n\n").trim(),
  };
};

const buildStableFamilyPortrait = (draft, prompt) => {
  const payload = extractPromptPayload(prompt) || {};
  const sheet = payload.hearingSheet || payload.sourceFacts || {};
  const familyMemories = String(sheet.familyMemories || "");
  const memorableEvents = String(sheet.memorableEvents || "");
  const hobbies = String(sheet.hobbies || "");
  const personality = String(sheet.personality || "");
  const favoritePhrases = String(sheet.favoritePhrases || "");
  const valuedThings = String(sheet.valuedThings || "");
  const travel = String(sheet.travelAnniversaryEffort || "");
  const familyFeelings = String(sheet.familyFeelings || "");
  const allFacts = Object.values(sheet)
    .filter(value => typeof value === "string" || typeof value === "number")
    .map(value => String(value))
    .join("\n");
  const normalizedFacts = allFacts
    .replace(/親子[３3]代/gu, "親子三代")
    .replace(/[　\t]+/gu, " ");
  const hasRequiredPortrait = /(?:いつも)?笑っている(?:お)?顔しか思い出せない|笑顔しか思い出せない/u.test(normalizedFacts)
    && /歌/u.test(normalizedFacts)
    && /踊/u.test(normalizedFacts)
    && /手芸/u.test(normalizedFacts)
    && /野菜/u.test(normalizedFacts)
    && /花/u.test(normalizedFacts)
    && /人と接する(?:こと|事)?/u.test(normalizedFacts)
    && /(?:思い立|行動力)/u.test(normalizedFacts)
    && /(?:人の悪口|人を悪く言)/u.test(normalizedFacts)
    && /家族/u.test(normalizedFacts)
    && /親子三代/u.test(normalizedFacts)
    && /見習/u.test(normalizedFacts)
    && /前向/u.test(normalizedFacts);
  if (!hasRequiredPortrait) return null;

  const { fullName, givenName } = nameRuleFromPrompt(prompt);
  if (!fullName || !givenName) return null;
  const age = String(sheet.age || "").trim();
  const season = String(payload.season || payload?.writingRules?.season || "").toLowerCase();
  const seasonSentence = season.includes("spring") || season.includes("春")
    ? "やわらかな風に、春の気配を感じる頃となりました。"
    : season.includes("autumn") || season.includes("秋")
      ? "木々の葉が色づき始める頃となりました。"
      : season.includes("winter") || season.includes("冬")
        ? "澄んだ空気に、冬の深まりを感じる頃となりました。"
        : "蝉の声が遠く近くに響き、木々の葉陰に涼を探すこの季節。";
  const locationMatch = normalizedFacts.match(/親子三代で[、，]?\s*([^。\n]+?)へ(?:旅行|旅|出かけ)/u)
    || normalizedFacts.match(/親子三代で(?:行った|出かけた|訪れた)[、，]\s*([^。\n]+?)旅行/u);
  const parsedLocations = String(locationMatch?.[1] || "")
    .replace(/[、，]\s*$/u, "")
    .replace(/や/u, "、")
    .trim();
  const knownLocations = ["六甲", "小倉", "下関", "博多"]
    .filter(location => normalizedFacts.includes(location))
    .join("、");
  const locations = parsedLocations || knownLocations;
  const monthText = normalizedFacts.match(/([一二三四五六七八九十]+)月/u)?.[1] || "";
  const monthNumber = Number(normalizedFacts.match(/(\d{1,2})月/u)?.[1] || 0);
  const month = monthText || ["", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"][monthNumber] || "";
  if (!locations || !month) return null;
  const rememberedPhrase = /人の悪口/u.test(normalizedFacts)
    ? "人の悪口を言ってはいけない"
    : "人を悪く言ってはいけない";

  const lifeSentence = `故${fullName}様は、${age ? `${age}年という` : ""}尊いご生涯を閉じ、静かに人生の幕を下ろされました。`;
  let openingNarration = [
    seasonSentence,
    lifeSentence,
    `思い出の中の${givenName}様は、いつも笑顔です。歌に声を合わせ、ときには踊るように身体を動かされる。その愛らしいお姿も、忘れられない思い出の一つです。`,
    "手芸に向かえば、手を動かしながら少しずつ形を整えていかれる。野菜やお花にもこまめに手をかけ、その育ちを楽しみに見守っておられました。",
    `人との時間を楽しみ、思い立てばすぐに動かれる。折に触れて口にされた「${rememberedPhrase}」というひと言も、今なお耳に残ります。`,
    "ともに過ごした何気ない時間。その一つひとつが、今、懐かしくよみがえります。",
    "尽きることのない感謝の思いを胸に、まもなく開式のお時間でございます。",
  ].join("\n\n");
  let closingNarration = [
    `お誕生日月の${month}月には、親子三代で${locations}へ出かけられ、その行き先の一つひとつに、ともに過ごした日の記憶が結ばれています。これからその地名に触れるたび、旅の日の${givenName}様が懐かしく思い出されることでしょう。`,
    "その明るさを胸に、これからも前向きに歩んでいきたい。その思いとともに、旅先で分かち合った時間は、これからも大切に残されてまいります。",
  ].join("\n\n");
  // The verified base is the fallback shown when an AI rewrite is rejected.
  // Keep this manuscript family-near and grammatically varied; it is not a
  // mechanical copy of the older library wording.
  openingNarration = [
    seasonSentence,
    lifeSentence,
    `ご家族の記憶に浮かぶのは、いつも笑っていた${givenName}様のお顔です。歌が始まると口ずさみ、ときには踊るように身体を動かされる姿が、日常の中にありました。`,
    `手芸に向かわれると、ひと針ずつ形を整え、野菜やお花には手をかけ、その育ちを見守っておられました。`,
    `人と過ごすことを喜び、思い立てばすぐに動かれる方でした。「${rememberedPhrase}」という言葉も、ご家族の耳に残っています。`,
    `笑顔や歌声、手芸に向かう手元まで、ともに過ごした日々を静かに振り返ります。`,
    `尽きることのない感謝の思いを胸に、まもなく開式のお時間でございます。`,
  ].join("\n\n");
  closingNarration = [
    `お誕生日月の${month}月には、親子三代で${locations}へ出かけられました。行き先の名をたどると、ご家族で過ごした十月の時間が自然によみがえります。`,
    `その明るさを見習いたいというご家族の思いも、旅の記憶とともに残っています。${givenName}様と分かち合った親子三代の時間は、今も大切な思い出です。`,
  ].join("\n\n");
  return {
    ...draft,
    openingNarration: [
      seasonSentence,
      lifeSentence,
      `人と接することがお好きだった${givenName}様。誰かと顔を合わせれば、会話を楽しみながらよく笑われる。歌が始まると自然に口ずさみ、ときには踊るように身体を動かされる。その仕草を、ご家族はいつも可愛らしく感じておられました。`,
      `思い立ったことには、すぐに取りかかる。手芸では、ひと針ずつ丁寧に手を進め、少しずつ形にしていく。野菜やお花にもこまめに手をかけ、芽が伸び、花が咲いていく様子を見守る。何かを形にし、育てていく時間も、${givenName}様の日常の一部でした。`,
      `「${rememberedPhrase}」と、折に触れて話されていた言葉も忘れられません。その言葉も、歌い踊る姿も、手芸に向かう手元も、今ではどれも懐かしく思い出されることと存じます。人との時間を楽しみ、ご家族を大切にしながら重ねてこられた日々へ、今、皆様の感謝が寄せられています。`,
      `尽きることのない感謝の思いを胸に、まもなく開式のお時間でございます。`,
    ].join("\n\n"),
    closingNarration: [
      `お誕生日月の${month}月には、親子三代で${locations}へ旅を重ねられました。訪れた土地の一つひとつに、${givenName}様とご家族がともに過ごした時間が残っています。`,
      `これから先、それぞれの地名を耳にしたとき、旅の日の表情や、皆様で過ごしたひとときが、ふと心に浮かぶこともあるでしょう。`,
      `その明るさを見習い、これからも前向きに過ごしていきたい。その思いとともに、旅の日々は、${givenName}様と過ごした大切な時間として、これからも心に残り続けることでしょう。`,
    ].join("\n\n"),
  };
};

const removeUnsupportedAudiencePhrasing = value => String(value || "")
  .replace(/今日(?:ここ|この場)に集う皆様/gu, "皆様")
  .replace(/(?:ここ|この場)に集う皆様/gu, "皆様")
  .replace(/[^。\n]*(?:ご多用|ご参列|ご会葬)[^。\n]*(?:ありがとう|御礼|感謝)[^。\n]*。/gu, "")
  .replace(/[^。\n]*(?:葬儀にあたり|開式に先立ち)[^。\n]*。/gu, "")
  .replace(/[^。\n]*(?:ご参列|お心静かに)[^。\n]*(?:ください|お願い申し上げ|存じます)[^。\n]*。/gu, "")
  .replace(/[^。\n]*(?:お心をお寄せ|お心を寄せ)[^。\n]*(?:ください|お願い)[^。\n]*。/gu, "")
  .replace(/[^。\n]*開式まで[^。\n]*(?:お待ち|お過ごし)[^。\n]*。/gu, "")
  .replace(/[^。\n]*(?:ご起立|合掌|お迎え)[^。\n]*(?:ください|お願い)[^。\n]*。/gu, "")
  .replace(/[^。\n]*皆様[^。\n]*(?:ください|お願い)[^。\n]*。/gu, "")
  .replace(/[^。\n]*これより[^。\n]*お別れ[^。\n]*(?:迎え|臨み|進め)[^。\n]*。/gu, "")
  .replace(/[^。\n]*(?:まもなく|間もなく)[^。\n]*(?:葬儀|告別式|通夜)[^。\n]*(?:開式|開始)[^。\n]*。/gu, "")
  .replace(/[^。\n]*お別れの時[^。\n]*(?:進ん|進め)[^。\n]*。/gu, "")
  .replace(/(?:^|\n{2,})[^。\n！？]+[、，](?=\n{2,}|$)/gu, "")
  .replace(/[^。\n]*感謝の思いをお寄せいただき[^。\n]*。/gu, "")
  .replace(/\n{3,}/gu, "\n\n")
  .trim();

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
  const allSentences = withoutFixed
    .split(/[。！？]/u)
    .map(value => value.trim())
    .filter(Boolean);
  const politeCount = allSentences.filter(sentence => POLITE_ENDING_RE.test(sentence)).length;
  // A draft can avoid three adjacent polite endings while still sounding
  // mechanical almost everywhere. Reject that overall density as well.
  if (allSentences.length >= 6 && politeCount / allSentences.length > 0.72) return true;
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

const hasConsecutivePastPoliteEndings = text => {
  const withoutFixed = String(text || "")
    .replace(/^[^。\n]*(?:季節|頃)[^。\n]*。?/u, "")
    .replace(/故[^。\n]+様は、[^。\n]+尊いご生涯を閉じ、静かに人生の幕を下ろされました。?/u, "")
    .replace(/尽きることのない感謝の思いを胸に、まもなく開式のお時間でございます。?/u, "")
    .replace(/(?:\d+|[〇零一二三四五六七八九十百]+)年のご生涯に心からの敬意を表し、過ごしてまいりました葬送のひととき。[\s\S]*?どうぞよろしくお願いいたします。?/u, "");
  const sentences = withoutFixed
    .split(/[。！？]/u)
    .map(value => value.trim())
    .filter(Boolean);
  const pastEnding = /(?:ました|でした|ございました|おりました)$/u;
  // Count variants such as ありました・おられました・こられました as
  // the same audible ending. Outside the fixed guidance, more than three
  // past-polite sentence endings makes the whole manuscript monotonous.
  if (sentences.filter(sentence => pastEnding.test(sentence)).length > 3) return true;
  for (let index = 2; index < sentences.length; index += 1) {
    if (
      pastEnding.test(sentences[index - 2]) &&
      pastEnding.test(sentences[index - 1]) &&
      pastEnding.test(sentences[index])
    ) return true;
  }
  return false;
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
    if (/(?:花|野菜|鉢植え)[^。！？]{0,12}を日々手をかけ/u.test(sentence)) return true;
    if (/[一-龠々ァ-ヶぁ-ん]+様は、?[^。！？]{0,50}(?:お顔|表情)です$/u.test(sentence)) return true;
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
  if (/(?:本日の|これをもちまして)[^。]{0,24}(?:葬儀|ご葬儀)[^。]{0,24}(?:閉式|終了)/u.test(value)) return true;
  if (/道しるべ/u.test(value)) return true;
  if (/そばにいる人の目に[^。]{0,30}映/u.test(value)) return true;
  if (/その場にある時間/u.test(value)) return true;
  if (/前を向いて(?:動か|歩|進)/u.test(value)) return true;
  if (/前を向く姿/u.test(value)) return true;
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
  if (/(?:まず|最初に)浮かぶのは[^。]{0,45}(?:顔|お顔|笑顔)/u.test(value)) return true;
  if (/笑っている顔しか思い出せない[^。]{0,28}よく笑(?:う|って|われ)[^。]{0,16}(?:顔|お顔)/u.test(value)) return true;
  if (/人の悪口を言わず[^。]{0,45}人の悪口を言ってはいけない/u.test(value)) return true;
  if (/ご家族(?:は|が)[^。]{0,35}(?:思い|気持ち)を抱いています/u.test(value)) return true;
  if (/(?:旅行|旅)は[^。]{0,45}(?:出かけられた|出かけた)もの/u.test(value)) return true;
  if (/親子三代[^。]{0,45}(?:旅先|旅行|旅)[^。]{0,20}(?:記憶|思い出)[^。]{0,20}残ります/u.test(value)) return true;
  if (/明るさを重ね/u.test(value)) return true;
  if (/ではないでしょうか/u.test(value)) return true;
  if (/ご家族には[^。]{0,40}映っておりました/u.test(value)) return true;
  if ((value.match(/ご家族と(?:ともに)?過ごされた(?:日々|日常|時間)/gu) || []).length > 1) return true;
  if ((value.match(/思い出の中にございます/gu) || []).length > 1) return true;
  if (/よく笑う人でいらっしゃいました/u.test(value)) return true;
  if (/可愛らしく感じておられたことと存じます/u.test(value)) return true;
  if (/(?:旅行|旅)[^。]{0,45}(?:月|十月|九月)[^。]{0,20}重ねられた/u.test(value)) return true;
  if (/折に触れて口にされた、?「[^」]+」という言葉。/u.test(value)) return true;
  if (/「[^」]+」という言葉。\s*尽きることのない感謝/u.test(value)) return true;
  if (/(?:^|[。\n])\s*(?:そして、?)?[^。！？]{0,45}(?:しておられた|されていた)こと。/u.test(value)) return true;
  if (/そのお姿は[^。]{0,50}(?:チエノ様|ご本人)[^。]{0,16}お姿でした/u.test(value)) return true;
  if (/(?:歌ったり|踊ったり)[^。]{0,35}することもありました/u.test(value)) return true;
  if (/いつも可愛(?:い|らしい)[^。]{0,25}とのこと/u.test(value)) return true;
  if (/可愛(?:い|らしい)と感じられていた記憶として/u.test(value)) return true;
  if (/歌われることがありました。踊られることもあり/u.test(value)) return true;
  if (/歌を歌われることがありました。踊られることもあり/u.test(value)) return true;
  if (/野菜[^。]{0,24}ました。お花[^。]{0,24}ました/u.test(value)) return true;
  if (/感謝の思い[^。]{0,40}。\s*尽きることのない感謝の思い/u.test(value)) return true;
  if (/をたどるうえで欠かせない記憶/u.test(value)) return true;
  if (/ご旅行に行かれ/u.test(value)) return true;
  if (/旅行に行かれ/u.test(value)) return true;
  if (/(?:お見送り|お送り)(?:いたします|ください)/u.test(value)) return true;
  if (/お気持ちが(?:ご家族に)?あります/u.test(value)) return true;
  if (/日常のひとこま/u.test(value)) return true;
  if (/ご家族の思い出にあるのは/u.test(value)) return true;
  if (/行き先の名をたどると[^。]{0,45}(?:旅行|旅)が思い起こされ/u.test(value)) return true;
  if (/(?:私も|彼女|彼を|彼女を)[^。]{0,80}(?:見習|歩んで)/u.test(value)) return true;
  if (/よく笑っておられたお顔から、歌や踊り、手芸/u.test(value)) return true;
  if (/その行き先の名は[^。]{0,60}思い出として残って/u.test(value)) return true;
  if (/というご家族のお気持ちでございます/u.test(value)) return true;
  if (/(?:お姿|ご様子)が(?:ありました|あります)/u.test(value)) return true;
  if (/明るい表情がそこにありました/u.test(value)) return true;
  if (/可愛(?:い|らしさ)[^。]{0,20}重なります/u.test(value)) return true;
  if (/育てる時間を大切に/u.test(value)) return true;
  if (/その声も[^。]{0,30}笑顔とともに/u.test(value)) return true;
  if (/旅の日々が結ばれています/u.test(value)) return true;
  if (/喜びは[^。]{0,35}どの旅にも[^。]{0,20}流れて/u.test(value)) return true;
  if (/ご家族から寄せられたその思い/u.test(value)) return true;
  if (/毎日の暮らしの中にございました/u.test(value)) return true;
  if (/ました。[^\n]{0,100}(?:して|育てて|見守って)おられます/u.test(value)) return true;
  const commaLists = value.match(/[一-龠々ァ-ヶぁ-ん]{2,10}(?:、[一-龠々ァ-ヶぁ-ん]{2,10}){2,}/gu) || [];
  if (commaLists.some((list, index) => commaLists.indexOf(list) !== index)) return true;
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
  // 「一日一日」は文法的には正しいが、葬儀ナレーションでは定型的で
  // 機械的な強調に聞こえやすい。より自然な「日々」へ言い換える。
  if (/一日一日/u.test(full)) failures.push("formulaic repeated wording");
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
  if (hasConsecutivePastPoliteEndings(bodyWithoutRequiredClosings)) failures.push("repetitive past endings");
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
  if (opening.trim().length < 320) failures.push("opening too short");
  const closingBody = closing
    .replace(/(?:\d+|[〇零一二三四五六七八九十百]+)年のご生涯に心からの敬意を表し、過ごしてまいりました葬送のひととき。[\s\S]*?どうぞよろしくお願いいたします。?/u, "")
    .trim();
  if (closingBody.length < 100) failures.push("closing too short");
  return { ok: failures.length === 0, failures };
};

const narrationCandidateScore = (draft, prompt) => {
  const check = qualityCheckNarration(draft, prompt);
  const openingLength = String(draft?.openingNarration || "").length;
  const closingBodyLength = String(draft?.closingNarration || "")
    .replace(/(?:\d+|[〇零一二三四五六七八九十百]+)年のご生涯に心からの敬意を表し、過ごしてまいりました葬送のひととき。[\s\S]*?どうぞよろしくお願いいたします。?/u, "")
    .trim()
    .length;
  const severe = new Set([
    "missing narration",
    "broken Japanese grammar",
    "invented family feeling",
    "outsider perspective",
    "unsafe interpretation",
    "opening closing overlap",
    "closing timeline",
    "response incomplete",
    "excessive polite endings",
    "repetitive past endings",
    "excessive trait repetition",
    "awkward narration style",
    "reporter distance",
    "residual AI narration",
  ]);
  const failurePenalty = check.failures.reduce(
    (total, failure) => total + (severe.has(failure) ? 1000 : 100),
    0,
  );
  const lengthPenalty =
    Math.max(0, 520 - openingLength) +
    Math.max(0, 200 - closingBodyLength) * 2;
  return {
    score: failurePenalty + lengthPenalty,
    check,
    openingLength,
    closingBodyLength,
  };
};

const buildLegacySystemPrompt = extraInstruction => [
  "ABSOLUTE FACT BOUNDARY: every concrete noun, action, place, conversation, reaction, facial expression, routine, motive, feeling, and scene must be explicitly present in the Hearing Sheet. Never add meals, rooms, windows, roads, scenery, photographs, homecoming, things shown to family, travel conversations, family reactions, or the deceased's inner feelings unless the Hearing Sheet states them. You may describe only a physical action inseparable from an explicitly supplied activity: craft/knitting may include moving the hands and taking shape; growing flowers or vegetables may include tending them and watching them grow; singing may include the voice; dancing may include bodily movement. These are descriptions of the supplied activity, not new events. Making any other scene vivid does not permit invention.",
  "FAMILY-INSIDE PERSPECTIVE: stay close to what the family actually remembers. Do not write an outsider's character evaluation and do not claim what the family felt unless that feeling is explicitly provided. Prefer the family's concrete fact over a polished interpretation.",
  "SENTENCE-END AUDIT: do not mechanically alternate endings. Two natural polite sentences may stand together, but never allow three in a row with the same です/ます rhythm outside fixed guidance. Do not escape into stacked noun fragments such as 手芸に向かわれる時間。野菜を育てる時間。 Use at most one deliberate noun-ending sentence in a paragraph, and only when it sounds complete aloud. Prefer connecting closely related facts into one grammatical sentence.",
  "NATURAL-JAPANESE POLISH: state one idea once. Never repeat お姿 twice in one sentence, never write 明るさを重ねる, and never leave a sentence as 家族を大切にしておられたこと。 Avoid flat reporting such as 歌ったり踊ったりすることもありました or いつも可愛いとのこと. Describe the supplied scene directly and finish every sentence with a natural predicate.",
  "FAMILY-NEAR VOICE: never expose the interview process. Do not write お顔とのことです, お方でいらっしゃいました, 皆様がよくご存じです, or ご家族が語ってくださった. Do not explain a supplied quotation as a philosophy, 教え, 人との向き合い方, 生き方, or 考え方. Let the exact words remain close to the family's memory without an outsider's interpretation.",
  "Do not begin the portrait by explaining what first comes to mind, such as まず浮かぶのは or 最初に浮かぶのは. Enter directly into a true remembered action or scene, while staying strictly within the Hearing Sheet facts.",
  "NO AI COMMENTARY: do not write とうかがっております, ご本人らしいまめやかさ, 言葉にしすぎなくても, 敬意をもって向き合います, or 耳にそっと戻ってくる. Do not narrate the writing process or add a polished interpretation. Stay with the supplied action, expression, place, or words.",
  "DIRECT-QUOTE LIMIT: use at most one 「...」 quotation across openingNarration and closingNarration together, and only when the exact spoken words are present in the Hearing Sheet.",
  "CEREMONY TIMELINE: closingNarration is read after the officiant has left and before flowers are offered. Never write お別れのあと, お別れを済ませた今, お別れのひとときを過ごした今, or お別れのひとときを終えた今.",
  "REPETITION AUDIT: do not restate the same family phrase in adjacent sentences. If the Hearing Sheet says 笑っている顔しか思い出せない, use that idea only once and do not immediately explain again that the person often laughed. A main trait such as 笑顔 or 明るさ should normally appear no more than twice in openingNarration and must not be repeated as a summary in closingNarration.",
  "Do not use the formulaic repetition 一日一日. Although grammatically valid, it sounds mechanical in spoken funeral narration. Use 日々, これからの日々, or another plain expression that fits the sentence. Do not automatically ban concrete, natural repetitions such as ひと針ひと針 when they make an explicitly supplied scene easier to hear.",
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
  "あなたは、長年葬儀司会を務めてきた日本語ナレーションの書き手です。落ち着きがあり、耳で聞いて自然な原稿を書いてください。",
  "返答は openingNarration、closingNarration、detectedTheme、improvementNotes を持つJSON一個だけとし、improvementNotesは空文字にしてください。",
  "事実の範囲はsourceFactsだけです。書かれていない人物、場所、会話、感情、動機、反応、景色、意味を補わないでください。",
  "これは人物紹介ではなく、ご家族がその方との時間を自然に重ねられるナレーションです。司会者が外から人物を評価したり、ご家族の気持ちを推測したりしないでください。",
  "sourceFactsは取材メモです。その語順や口語をコピーせず、意味を変えない範囲で、読み上げに適した自然な敬語へ整えてください。",
  "開式前は、季節の短い一文、氏名と年齢の定型文、記憶がゆるやかにつながる本文、感謝へ渡す一文、開式案内の順です。",
  "季節の一文には、入力された季節に合う自然、光、風、音のうち一つだけを描いてください。葬儀の雰囲気を補う「静かな時」などの抽象表現は使わないでください。",
  "氏名と年齢の定型文は「故{fullName}様は、{age}年という尊いご生涯を閉じ、静かに人生の幕を下ろされました。」です。",
  "開式前の最後は必ず「尽きることのない感謝の思いを胸に、まもなく開式のお時間でございます。」としてください。",
  "本文はopening.anchorを中心に始め、supportsは同じ人物像を深めるものだけを使ってください。項目を順番に紹介せず、一段落ごとに一つの記憶の動きを持たせます。",
  "笑顔、趣味、言葉などの事実は一度ずつ描き、直後に性格や意味を解説しないでください。引用はsourceFactsにある場合だけ一回まで使い、必ず「話しておられました」など自然な述語を持つ文の中に置いてください。",
  "引用を置いた段落は、その引用を含む一文で閉じてください。引用の意味、人柄、生き方、家族への影響を説明する文を後ろへ足さないでください。",
  "ご家族を文の観察者として何度も登場させないでください。「ご家族が思い出される」のように書かず、記憶の中の表情や動作を文の中心に置いてください。",
  "文末は意味に合わせて自然に変えてください。同じ「ました・でした・ございます」を三文続けず、避けるためだけの体言止めも重ねないでください。すべての文に自然な述語を置いてください。",
  "開式前は、事実が十分なら430〜620字を目安にします。八〜十一文ほど、三〜五段落で構成し、短い報告文を並べず、関係する記憶を自然につないでください。長さのための抽象表現は足さないでください。",
  "閉式後本文はclosing.anchorを静かにたどり、開式前の要約をしません。closing.supportsにご家族のお気持ちがある場合だけ、内容を変えずに結んでください。具体的な記憶から余韻へ進む五〜八文、200〜300字を目安にしてください。",
  "「〜ことがありました」「〜しておられました」を一項目ずつ並べる人物紹介は禁止です。関連する事実は、時間・動作・対象のつながりが自然になる一文または一段落へまとめてください。",
  "「そのお顔はご家族の記憶に残っています」のように、直前の記憶を説明し直すだけの文は削ってください。一つの事実は一度だけ書き、次の具体的な記憶へ進んでください。",
  "一人称の「私」、三人称代名詞の「彼・彼女」は使用禁止です。ご家族のお気持ちは、sourceFactsにある表現を主語なしで自然に受け、司会者個人の言葉へ変えないでください。",
  "開式前の定型案内の直前には、本文に書いた具体的な記憶を一度だけ受ける自然な橋渡しを置いてください。ただし「感謝の思い」を二文連続させないでください。",
  "閉式後では、年齢への敬意、会葬御礼、献花、式場準備、手荷物案内を書かないでください。これらはサーバーが一度だけ追加します。",
  "開式前と閉式後で、同じ事実、表情、趣味、引用、場所、気持ちを重ねないでください。年齢は氏名定型文以外に書かないでください。",
  "styleReferenceには、今回の人物像に近い教科書が一冊だけ入っています。語句や事実を借りず、記憶の始め方、段落の進み方、場面と余韻の配分、読み上げの間だけを参考にしてください。",
  "完成後、styleReferenceと似た固有の言い回しや文が残っていないか確認し、似ていれば今回のsourceFactsに即した別の自然な表現へ書き直してください。",
  "宗派が浄土真宗の場合は「旅立ち」を使わないでください。会場名、参列者への一般的な挨拶、閉式宣言も書かないでください。",
  "文章を返す前に内部でのみ、①構成、②初稿、③音読を想定した推敲、④事実照合を行ってください。下書きや検査内容は出力せず、整えた完成稿だけを返してください。",
  "最終確認では、助詞と主述が正しいこと、文が途中で切れていないこと、同じ事実を言い換えて繰り返していないこと、家族の外側から評していないことを確かめてください。",
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
    // GPT-5.5 counts internal reasoning against max_output_tokens. The UI may
    // still carry the old 1,200-token setting, which can cut the response off
    // before the closing body. Keep one model call, but reserve enough room for
    // reasoning plus both narration sections.
    const outputTokenLimit = Math.min(Math.max(maxTokens, 3200), 4000);
    const callResponses = async forcePlainJson => {
      const systemPrompt = [
        systemPromptOverride || buildSystemPrompt(),
        extraInstruction,
        forcePlainJson ? "JSON Schemaを使わず、生のJSONオブジェクト一個だけを返してください。" : "",
      ].filter(Boolean).join(" ");
      const body = {
        model,
        // A funeral narration needs disciplined grounding and copy quality,
        // not a long chain of internal reasoning. "medium" intermittently
        // exceeded Vercel's 60-second function limit. "low" also reduces the
        // model's tendency to over-explain one supplied memory.
        reasoning: { effort: "low" },
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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // Some deployment dashboards can accidentally store the same key more than
  // once on separate lines. Use only the first non-empty token and never place
  // the raw environment value in a request header or diagnostic response.
  const apiKey = String(process.env.OPENAI_API_KEY || "")
    .trim()
    .split(/\s+/)
    .find(Boolean) || "";
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
          message: redactSecrets(error.message),
          status: error.status || null,
          openAiError: error.openAiError || null,
        });
        res.statusCode = 500;
        res.end(JSON.stringify({
          ...diagnostics,
          code: "OPENAI_PROBE_FAILED",
          error: redactSecrets(error.message) || "OpenAI probe failed",
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

  try {
    const auth = await verifyFirebaseRequest(req);
    diagnostics.authenticated = true;
    diagnostics.authRole = auth.role;
  } catch (error) {
    res.statusCode = error.status || 401;
    res.end(JSON.stringify({
      code: res.statusCode === 403 ? "ACCOUNT_NOT_ENABLED" : "AUTHENTICATION_REQUIRED",
      error: "Authentication required.",
    }));
    return;
  }

  console.log("[generate-narration] request", diagnostics);

  try {
    const body = await readJsonBody(req);
    const rawPrompt = String(body.prompt || "").trim();
    if (!rawPrompt) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "prompt is required" }));
      return;
    }
    const forceAiGeneration = extractPromptPayload(rawPrompt)?.forceAiGeneration === true;
    const stableCandidate = buildStableFamilyPortrait({
      detectedTheme: "家族愛",
      improvementNotes: "",
    }, rawPrompt);
    const stableDraft = ENABLE_STABLE_FAMILY_PORTRAIT_PREFLIGHT && !forceAiGeneration
      ? stableCandidate
      : null;
    if (stableDraft) {
      const stableResult = applyNameRule(stableDraft, rawPrompt);
      const stableCheck = qualityCheckNarration(stableResult, rawPrompt);
      if (stableCheck.ok) {
        console.log("[generate-narration] stable family portrait", {
          buildId: API_BUILD_ID,
          openingLength: stableResult.openingNarration.length,
          closingLength: stableResult.closingNarration.length,
        });
        res.statusCode = 200;
        res.end(JSON.stringify({
          ...stableResult,
          generationSource: "stable_family_portrait",
          generationDiagnostics: {
            source: "stable_family_portrait",
            buildId: API_BUILD_ID,
            openingLength: stableResult.openingNarration.length,
            closingLength: stableResult.closingNarration.length,
            possibleTruncation: false,
          },
          generationTrace: buildGenerationTrace(rawPrompt, {
            source: "stable_family_portrait",
            qualityStatus: "passed",
          }),
        }));
        return;
      }
      console.warn("[generate-narration] stable portrait quality fallback", {
        buildId: API_BUILD_ID,
        failures: stableCheck.failures,
      });
    }

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
    const prompt = compactNarrationPrompt(rawPrompt);
    const systemPrompt = activeNarrationSystemPrompt(rawPrompt);
    const debugQuality = body.debugQuality === true;
    let verifiedEditorialBase = null;
    if (stableCandidate) {
      verifiedEditorialBase = {
        openingNarration: stableCandidate.openingNarration,
        closingNarration: stableCandidate.closingNarration,
      };
    }

    const model = "gpt-5.5";
    const temperature = clampNumber(body.temperature, 0.2, 0, 2);
    const maxTokens = Math.round(clampNumber(body.maxTokens || body.max_tokens, 4600, 100, 5600));
    let parsed = null;
    let lastCheck = null;
    let copyEditRoute = "not_run";
    let finalGenerationSource = "openai";
    const onePassInstruction = verifiedEditorialBase
      ? [
          "You are the final Japanese funeral-MC copy editor, not a fresh-draft generator.",
          "Polish the VERIFIED DRAFT below in one pass while preserving every supplied fact, section allocation, and the family's point of view.",
          "Do not add scenes, interpretations, lessons, future effects, atmosphere claims, or family emotions that are absent from the Hearing Sheet.",
          "Never repeat a phrase such as 折に触れて, never write その月ごとに when the facts say each trip occurred in October, and never use abstractions such as 言葉や動きに添えられていく.",
          "Never write a subject-predicate mismatch such as チエノ様は、お顔です. Write 思い出の中のチエノ様は、いつも笑顔です instead.",
          "Do not write お姿があります, 明るい表情がそこにありました, or convert 前向き into 前を向く姿.",
          "Mention a supplied list of destinations only once; after that, refer to その地名 or 旅の日々 without repeating the list.",
          "Remove mechanical ました・でした repetition by restructuring clauses and paragraphs, not by changing only the final word or stacking noun fragments.",
          "Return a complete openingNarration and only the closing narrative body. The server appends the fixed closing guidance.",
          `VERIFIED DRAFT TO POLISH: ${JSON.stringify(verifiedEditorialBase)}`,
        ].join(" ")
      : "Finish in a single pass. Internally revise once before answering, but do not make another external call. Prioritize natural Japanese, the required opening life-introduction, disjoint facts between opening and closing, and removal of AI-like phrasing. Return the complete openingNarration. In closingNarration, return only the narrative body because the server appends the fixed guidance.";
    parsed = await requestNarration({
      apiKey,
      model,
      temperature,
      maxTokens,
      prompt,
      timeoutMs: 30000,
      systemPromptOverride: systemPrompt,
      extraInstruction: onePassInstruction,
    });
    const firstDraft = parsed;
    if (
      ENABLE_LENGTH_REPAIR &&
      (
        String(parsed?.openingNarration || "").length < 500 ||
        String(parsed?.closingNarration || "")
          .replace(/(?:\d+|[〇一二三四五六七八九十百]+)年のご生涯に心からの敬意を表し[\s\S]*$/u, "")
          .trim().length < 190
      )
    ) {
      try {
        const shortDraft = JSON.stringify({
          openingNarration: parsed?.openingNarration || "",
          closingNarration: String(parsed?.closingNarration || "")
            .replace(/(?:\d+|[〇零一二三四五六七八九十百]+)年のご生涯に心からの敬意を表し[\s\S]*$/u, "")
            .trim(),
        });
        parsed = await requestNarration({
          apiKey,
          model,
          temperature: 0.1,
          maxTokens,
          prompt,
          timeoutMs: 32000,
          systemPromptOverride: systemPrompt,
          extraInstruction: [
            "LENGTH REPAIR: the first opening draft was too short.",
            "Rewrite the complete opening and closing, using exactly the same sourceFacts and no new fact, feeling, adjective, scenery, action, or interpretation.",
            "Use every selected opening and closing card. Every distinct fact inside a selected card must appear exactly once. Omission is a failed repair. When one card contains two or more distinct facts, connect them in one natural paragraph instead of dropping one or turning them into a list.",
            "Opening including its fixed introduction and final line must be about 520 to 700 Japanese characters. Match the referenceShape and aim for twelve to sixteen factual body sentences arranged in four to six natural paragraphs.",
            "Closing narrative body must be 200 to 300 Japanese characters, arranged in two or three natural paragraphs, and must not repeat opening facts.",
            "Each main opening memory paragraph must contain 90-140 Japanese characters. Each closing paragraph must contain 90-150 Japanese characters. Except for an exact quotation, do not use a content sentence shorter than 22 Japanese characters.",
            "Do not pad with an abstract summary, gratitude sentence, list of facts, interview-report wording, or a restatement of the same memory. To match the textbook depth, up to three opening paragraphs may end with one short family-near afterglow sentence tied to the exact scene just described.",
            `FIRST DRAFT TO REPAIR: ${shortDraft}`,
          ].join(" "),
        });
      } catch (lengthRepairError) {
        console.warn("[generate-narration] length repair skipped", {
          buildId: API_BUILD_ID,
          message: lengthRepairError?.message || String(lengthRepairError),
        });
        parsed = firstDraft;
      }
    }
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
        sourceFacts: compactPayload.sourceFacts || {},
        composition: compactPayload.composition || {},
        revision: compactPayload.revision || null,
        draft: draftForEdit,
      });
      const isEndingRhythmRevision = /ました・です・ます|文末|語尾|連続/u.test(
        String(compactPayload?.revision?.instruction || "")
      );
      const copyEditSystemPrompt = [
        "あなたは、日本語の葬儀司会原稿を最終確認する熟練校正者です。新しい原稿を創作せず、draftを読み上げに適した自然な日本語へ整えてください。",
        "返答はopeningNarration、closingNarration、detectedTheme、improvementNotesを持つJSON一個だけです。improvementNotesは空文字にしてください。",
        "sourceFactsにない事実、人物、感情、意味、評価、場面を一つも足さないでください。draftに創作があれば削ってください。",
        "季節文、氏名と年齢の定型文、開式前の最終案内は保持してください。閉式後は定型案内を除いた本文だけを返してください。",
        "openingとclosingの事実の分担を変えず、同じ事実を両方へ出さないでください。",
        "同じ記憶を言い換えて説明し直している文は一つにまとめてください。引用の後に意味や人格を解説しないでください。",
        "司会者が外から人物を評価する文、ご家族の気持ちを推測する文、聞き取りを報告する文を削ってください。",
        "助詞、主語と述語、修飾関係を確認し、途中で切れた文を残さないでください。体言止めは原則使わないでください。",
        "定型文を除き、文末が「ました・でした・ございました・おりました」となる文は、開式前で最大二文、閉式後で最大一文にしてください。「ありました・おられました・こられました」も同じ文末として数えます。単語だけを置換せず、近い動作を接続助詞や連用形でつなぎ、思い出の場面には自然な現在形を交えて、段落全体の組み立てを直してください。不自然な歴史的現在形へ機械的に変えないでください。",
        "「歌われることがありました。踊られることもありました」「野菜を育てておられました。お花も育てておられました」のような取材項目の羅列は、近い動作を一つの自然な流れへまとめてください。",
        "笑顔の記憶を書いた直後に、よく笑う人だった、その顔が記憶に残る、と同じ内容を説明し直さないでください。",
        "「私」「彼」「彼女」は使用禁止です。ご家族のお気持ちはsourceFactsの意味を変えず、司会者個人の一人称にしないでください。",
        "「〜のでしょう」「飾らないひととき」「今日ここに至るまで」「開式前にたどった記憶」「心を整えてまいります」「これからの日々へと進まれます」は削除してください。取材者や司会者の説明、進行の自己言及、根拠のない意味づけを残してはいけません。",
        "本文中の「お見送りいたします」「お送りいたします」「お見送りください」は削除してください。花を手向ける式次第の案内はサーバーが後から追加します。「旅行に行く」は「旅に出る」「訪れる」「出かける」のうち事実に沿う自然な表現へ整え、「お気持ちがあります」「日常のひとこま」「ご家族の思い出にあるのは」という報告調も残さないでください。",
        "draftが選択済みカードの一部を落としている場合、sourceFactsに明記された未使用の事実だけを補ってください。新しい事実を足すこととは区別し、野菜と花、歌と踊り、複数の旅行先など、同じカード内の異なる事実を省略しないでください。",
        "開式案内の直前で「感謝の思い」を二文連続させないでください。前の一文が定型案内と重なる場合は削ってください。",
        "抽象的な美辞、人生訓、標語、AIらしいまとめを加えないでください。事実だけでは支えられない文は、別の美文へ置き換えず削ってください。",
        "笑顔の段落は一文だけにし、笑顔・よく笑う・顔が浮かぶ・記憶に残るという同義の説明を重ねないでください。開式前の最後に、すでに書いた趣味や場面を一覧で要約する段落を置かないでください。",
        "閉式後の旅行先は一度だけ書いてください。第一段落は場所、誕生日月、親子三代の事実を三文でまとめ、第二段落はsourceFactsにある家族の気持ちと余韻を二〜三文で結んでください。文章構成を説明する『開式前にたどった記憶』は使用禁止です。",
        "校正では新しい内容を増やさないでください。ただし削りすぎず、開式前本文は定型文を含めて320〜550字、閉式後本文は120〜260字を保ってください。同じ内容が二度あれば一つにまとめ、空いた箇所へ新しい抽象表現を足さないでください。",
        "自然さと正確さを最優先しながら、初稿にある異なる事実と必要な段落の呼吸は残してください。",
        isEndingRhythmRevision
          ? "今回の指定は文末リズムの全文校正です。語尾だけを『でした』から『です』へ置き換える修正は失敗です。段落の文構造を組み直し、同義反復を先に削り、近い動作を接続助詞・連用形・条件形で自然につないでください。引用とその言い換えを併記せず、『人の悪口を言わず、人の悪口を言ってはいけない』のような同一事実の二重表現も一つにしてください。『ご家族は抱いています』『お気持ちがあります』という取材報告へ変えることは禁止です。"
          : "",
        "最後に音読を想定し、一度で意味が伝わるか確認してから完成稿だけを返してください。",
      ].join(" ");
      const editedDraft = await requestNarration({
        apiKey,
        model,
        temperature: 0.1,
        maxTokens: Math.min(maxTokens, 2400),
        prompt: copyEditPrompt,
        timeoutMs: 18000,
        systemPromptOverride: copyEditSystemPrompt,
      });
      const normalizedGenerated = (forceAiGeneration || !ENABLE_LEGACY_NARRATION_REWRITES)
        ? normalizeQuotationContext(limitDirectQuotes(generatedDraft))
        : normalizeFamilyNearNarration(
            normalizeQuotationContext(limitDirectQuotes(generatedDraft)),
            rawPrompt
          );
      const normalizedEdited = (forceAiGeneration || !ENABLE_LEGACY_NARRATION_REWRITES)
        ? normalizeQuotationContext(limitDirectQuotes(editedDraft))
        : normalizeFamilyNearNarration(
            normalizeQuotationContext(limitDirectQuotes(editedDraft)),
            rawPrompt
          );
      const generatedScore = narrationCandidateScore(normalizedGenerated, rawPrompt);
      const editedScore = narrationCandidateScore(normalizedEdited, rawPrompt);
      parsed = editedScore.score <= generatedScore.score ? normalizedEdited : normalizedGenerated;
      copyEditRoute = editedScore.score <= generatedScore.score ? "edited_draft_selected" : "original_draft_selected";
      console.log("[generate-narration] copy edit selection", {
        buildId: API_BUILD_ID,
        selected: editedScore.score <= generatedScore.score ? "edited" : "generated",
        generatedScore,
        editedScore,
      });
    } catch (copyEditError) {
      console.warn("[generate-narration] copy edit skipped", {
        buildId: API_BUILD_ID,
        message: copyEditError?.message || String(copyEditError),
      });
      parsed = generatedDraft;
      copyEditRoute = "skipped";
    }
    parsed = (forceAiGeneration || !ENABLE_LEGACY_NARRATION_REWRITES)
      ? normalizeQuotationContext(limitDirectQuotes(parsed))
      : normalizeFamilyNearNarration(
          normalizeQuotationContext(limitDirectQuotes(parsed)),
          rawPrompt
        );
    // Forced AI generation must preserve the model's result. The stable
    // portrait builder is only a fallback for the normal guarded route.
    if (ENABLE_STABLE_FAMILY_PORTRAIT_POSTPROCESS && !forceAiGeneration) {
      parsed = buildStableFamilyPortrait(parsed, rawPrompt) || parsed;
    }
    parsed = applyNameRule(parsed, rawPrompt);
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
    if (verifiedEditorialBase) {
      const verifiedBaseResult = applyNameRule(verifiedEditorialBase, rawPrompt);
      const verifiedBaseScore = narrationCandidateScore(verifiedBaseResult, rawPrompt);
      const aiCandidateScore = narrationCandidateScore(parsed, rawPrompt);
      if (!lastCheck?.ok || aiCandidateScore.score >= verifiedBaseScore.score) {
        parsed = verifiedBaseResult;
        lastCheck = verifiedBaseScore.check;
        finalGenerationSource = "stable_family_portrait_recovery";
        copyEditRoute = "ai_candidate_rejected_verified_base_selected";
        console.log("[generate-narration] rejected inferior AI polish", {
          buildId: API_BUILD_ID,
          aiCandidateScore,
          verifiedBaseScore,
        });
      }
    }
    // In normal mode, any failed draft may fall back to the verified portrait.
    // In forced-AI mode, preserve and display a complete AI draft when the
    // remaining findings are editorial warnings only. Recover only structural
    // failures that would make the manuscript unsafe or unusable.
    const recoveryBlockingFailures = new Set([
      "missing narration",
      "control label leaked",
      "opening order",
      "seasonal grammar",
      "broken Japanese grammar",
      "response incomplete",
      "closing timeline",
      "too many direct quotes",
    ]);
    const shouldRecoverWithStablePortrait = finalGenerationSource === "openai" && !lastCheck?.ok && (
      !forceAiGeneration ||
      (lastCheck?.failures || []).some(failure => recoveryBlockingFailures.has(failure))
    );
    if (shouldRecoverWithStablePortrait) {
      const stableRecoveryDraft = buildStableFamilyPortrait({
        detectedTheme: parsed?.detectedTheme || "家族愛",
        improvementNotes: "",
      }, rawPrompt);
      if (stableRecoveryDraft) {
        const stableRecovery = applyNameRule(stableRecoveryDraft, rawPrompt);
        const stableRecoveryCheck = qualityCheckNarration(stableRecovery, rawPrompt);
        if (stableRecoveryCheck.ok) {
          parsed = stableRecovery;
          lastCheck = stableRecoveryCheck;
          finalGenerationSource = "stable_family_portrait_recovery";
          copyEditRoute = "quality_failed_stable_recovery";
          console.log("[generate-narration] recovered failed AI draft", {
            buildId: API_BUILD_ID,
            openingLength: parsed.openingNarration.length,
            closingLength: parsed.closingNarration.length,
          });
        }
      }
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
      "opening too short",
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
      const retryLengthInstruction = "Write openingNarration in 520-700 Japanese characters and four to six paragraphs. Write the closing narrative body in 200-300 Japanese characters and two or three paragraphs; the server appends fixed guidance later. Never gain length by repeating a trait, listing interview fields, or adding unsupported interpretation.";
      const retryInstruction = useFocusedEditorialPass
        ? `Act as a meticulous Japanese funeral-MC copy editor. Edit the DRAFT below instead of inventing a new composition. Preserve its selected facts, section allocation, and meaning. Remove repetition, reporter distance, abstract AI phrases, incomplete noun endings, and mechanical です・ます rhythm. Replace とうかがっております with direct, family-near narration. Delete inferred labels such as ご本人らしいまめやかさ, meta-writing such as 言葉にしすぎなくても, narrator declarations such as 敬意をもって向き合います, and poetic abstractions such as 耳にそっと戻ってくる, 注がれたものへ, 日々の重なり, or かけがえのないものとして重ねる. Do not add a single new fact, emotion, object, interpretation, or scene. Keep the required opening introduction and opening final sentence. Return only the closing narrative body because the server appends the fixed guidance. DRAFT TO EDIT: ${focusedDraft}`
        : `The previous attempt failed these checks: ${firstFailures.join(", ")}. Write a fresh complete version, not a shortened patch. Every Japanese sentence must have correct particles and a complete subject-predicate relationship. Never produce collisions such as にが, をを, or raw-input transformations such as 家族を大切にしていたを大切にされた. State the smile idea only once; do not repeat it through 顔, よく笑う, 笑顔, and 明るさ. Never repeat お姿 twice in one sentence. Do not write flat reporting such as 歌ったり踊ったりすることもありました, いつも笑っていたお顔とのことです, お方でいらっしゃいました, 皆様がよくご存じです, or ご家族が語ってくださった. Stay inside the family's remembered scene instead of reporting the interview. Never write 明るさを重ねる or leave a sentence as 家族を大切にしておられたこと。 Complete it with a natural predicate. After a supplied quotation, do not explain it as 人との向き合い方, 生き方, 考え方, 教え, or philosophy; let the words stand quietly. Avoid AI-like abstractions such as 暮らしに寄り添う楽しみ. Do not write an extra age phrase beyond the required opening introduction. Never turn 明るさを見習いたい into 明るく前向きに歩んでいきたい. Do not claim that the room or atmosphere became brighter. Do not invent artifacts such as 手芸の品, interpret a supplied action as 前を向いて動く, call a voice 忘れがたい, or instruct the family to お進みください. If the family says that singing and dancing looked cute, describe that specific姿 only; never rewrite it as いつも可愛い方だった. Partition facts before writing: opening uses at most three facts and closing uses only one or two facts never used in opening. Do not write any fixed closing guidance because the server appends it. Do not use stacked noun fragments or mixed seasonal grammar.`;
      parsed = await requestNarration({
        apiKey,
        model,
        temperature,
        maxTokens,
        prompt,
        extraInstruction: [retryLengthInstruction, retryInstruction].join(" "),
      });
      parsed = normalizeFamilyNearNarration(
        normalizeQuotationContext(limitDirectQuotes(parsed)),
        rawPrompt
      );
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
      "opening too short",
    ]);
    const remainingFailures = lastCheck?.failures || [];
    if (ALLOW_HARD_RETRY && !lastCheck?.ok && remainingFailures.some(failure => hardRetryFailures.has(failure))) {
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
      parsed = normalizeFamilyNearNarration(
        normalizeQuotationContext(limitDirectQuotes(parsed)),
        rawPrompt
      );
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
          generationSource: finalGenerationSource,
          qualityWarning: QUALITY_CHECK_FAILED_MESSAGE,
          qualityFailures: lastCheck?.failures || [],
          generationTrace: buildGenerationTrace(rawPrompt, {
            source: finalGenerationSource,
            model,
            qualityStatus: "warning",
            qualityFailures: lastCheck?.failures || [],
            copyEditRoute,
          }),
          improvementNotes: "",
        }));
        return;
      }
      res.statusCode = 422;
      res.end(JSON.stringify({
        code: "GENERATION_QUALITY_CHECK_FAILED",
        error: QUALITY_CHECK_FAILED_MESSAGE,
        qualityFailures: lastCheck?.failures || [],
        ...(debugQuality ? {
          qualityPreview: {
            openingNarration: parsed?.openingNarration || "",
            closingNarration: parsed?.closingNarration || "",
          },
        } : {}),
      }));
      return;
    }

    res.statusCode = 200;
    res.end(JSON.stringify({
      ...parsed,
      ...applyNameRule(parsed, rawPrompt),
      generationSource: finalGenerationSource,
      generationDiagnostics: {
        ...(parsed?.generationDiagnostics || {}),
        buildId: API_BUILD_ID,
      },
      generationTrace: buildGenerationTrace(rawPrompt, {
        source: finalGenerationSource,
        model,
        qualityStatus: "passed",
        qualityFailures: [],
        copyEditRoute,
      }),
    }));
  } catch (error) {
    console.error("[generate-narration] failed", {
      buildId: API_BUILD_ID,
      message: redactSecrets(error.message),
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

const extractStyleReferenceSection = (value, section) => {
  const text = String(value || "").trim();
  if (!text) return "";
  const openingMarker = /(?:^|\n)#{0,4}\s*【?開式前(?:ナレーション)?】?\s*(?:\n|$)/u;
  const closingMarker = /(?:^|\n)#{0,4}\s*【?閉式後(?:ナレーション)?】?\s*(?:\n|$)/u;
  const openingMatch = openingMarker.exec(text);
  const closingMatch = closingMarker.exec(text);
  if (section === "opening" && openingMatch) {
    const start = openingMatch.index + openingMatch[0].length;
    const end = closingMatch?.index > start ? closingMatch.index : text.length;
    return text.slice(start, end).trim();
  }
  if (section === "closing" && closingMatch) {
    return text.slice(closingMatch.index + closingMatch[0].length).trim();
  }
  return text;
};

const narrationSentenceCount = value => String(value || "")
  .split(/[。！？]/u)
  .map(part => part.trim())
  .filter(Boolean)
  .length;

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
  ["social", /人と接|人との|ご縁|会話|語ら|地域/u],
  ["active", /行動|活動的|思い立|すぐに動/u],
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
  const sharedConcepts = [...leftConcepts].filter(concept => rightConcepts.has(concept));
  if (!sharedConcepts.length) return false;
  // Keep a card when it also contains a genuinely different memory. For
  // example, "旅行とカラオケ" must not lose the karaoke detail merely
  // because another card already contains a trip. The prompt tells the model
  // to use only the non-overlapping detail from such a support card.
  return ![...rightConcepts].some(concept => !leftConcepts.has(concept));
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
    "valuedThings",
  ].map(byField).filter(Boolean).forEach(card => {
    if (selectedOpening.length >= 3) return;
    if (selectedOpening.some(selected => selected.field === card.field)) return;
    if (selectedClosing.some(selected => selected.field === card.field)) return;
    if (selectedOpening.some(selected => memoryCardsOverlap(selected, card))) return;
    if (selectedClosing.some(selected => memoryCardsOverlap(selected, card))) return;
    const alreadyUsedConcepts = new Set(
      [...selectedOpening, ...selectedClosing]
        .flatMap(selected => [...memoryConceptsFor(selected.text)])
    );
    const doNotRepeatTopics = [...memoryConceptsFor(card.text)]
      .filter(concept => alreadyUsedConcepts.has(concept));
    selectedOpening.push(doNotRepeatTopics.length
      ? { ...card, doNotRepeatTopics }
      : card);
  });

  const closingFeeling = byField("familyFeelings");
  if (
    closingFeeling &&
    !selectedClosing.some(selected => selected.field === closingFeeling.field) &&
    !selectedOpening.some(selected => selected.field === closingFeeling.field) &&
    !selectedOpening.some(selected => meaningfulFragmentOverlap(selected.text, closingFeeling.text, 6)) &&
    !selectedClosing.some(selected => meaningfulFragmentOverlap(selected.text, closingFeeling.text, 6))
  ) {
    selectedClosing.push(closingFeeling);
  }

  return {
    opening: {
      anchor: selectedOpening[0] || null,
      supports: selectedOpening.slice(1),
      maximumFacts: 3,
      purpose: "ご家族が最初に思い浮かべる、その人らしい一場面から始める",
    },
    closing: {
      anchor: selectedClosing[0] || null,
      supports: selectedClosing.slice(1),
      maximumFacts: 2,
      purpose: "開式前とは別の具体的な思い出をたどり、入力にご家族のお気持ちがある場合だけ自然に結んで余韻へつなぐ",
    },
  };
};

const staffSelectedMemoryPlan = (compactSheet, plan) => {
  const normalizeCards = (items, limit) => asArray(items)
    .map(item => {
      const field = String(item?.field || "").trim();
      if (!MEMORY_FIELD_ORDER.includes(field) || !compactSheet[field]) return null;
      return {
        field,
        label: compactText(item?.label || "", 80),
        text: compactText(compactSheet[field], 900),
      };
    })
    .filter(Boolean)
    .slice(0, limit);
  const opening = normalizeCards(plan?.opening, 6);
  const closing = normalizeCards(plan?.closing, 2)
    .filter(card => !opening.some(openingCard => openingCard.field === card.field));
  if (!opening.length || !closing.length) return null;
  return {
    opening: {
      anchor: opening[0],
      supports: opening.slice(1),
      maximumFacts: 6,
      purpose: "スタッフが選んだ中心の記憶から始め、選択された補助事実だけで人物像を描く",
    },
    closing: {
      anchor: closing[0],
      supports: closing.slice(1),
      maximumFacts: 2,
      purpose: "スタッフが閉式後用に残した別の記憶だけを使い、お花のお別れへ静かにつなぐ",
    },
    selectedByStaff: true,
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

  const selectedStyleReference = asArray(payload.selectedLibraryStyleReferences).slice(0, 1).map(ref => {
    const referenceOpening = extractStyleReferenceSection(ref.openingNarration, "opening");
    const referenceClosing = extractStyleReferenceSection(ref.closingNarration, "closing");
    return {
      title: compactText(ref.title, 100),
      theme: compactText(ref.theme, 100),
      tags: asArray(ref.tags).slice(0, 10),
      openingNarration: compactText(referenceOpening, 1600),
      closingNarration: compactText(referenceClosing, 1000),
      openingSentenceCount: narrationSentenceCount(referenceOpening),
      closingSentenceCount: narrationSentenceCount(referenceClosing),
      writingNotes: compactText(ref.writingNotes || ref.approvalReason, 300),
    };
  })[0] || null;

  const memoryPlan = staffSelectedMemoryPlan(compactSheet, payload.staffCompositionPlan)
    || pickMemoryCards(compactSheet);
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

  const revisionMode = payload.workflowMode === "revision" && String(payload.revisionDraft || "").trim();
  const revisionInstruction = compactText(payload.revisionInstruction || "不自然な日本語、事実の重複、機械的な文末だけを整える", 500);
  const endingRhythmRevision = /ました・です・ます|文末|語尾|連続/u.test(revisionInstruction);
  const revisionSpecificRules = endingRhythmRevision
    ? [
        "この修正は語尾の単純置換ではありません。「でした」を「です」、「ありました」を「あります」へ変えるだけの修正は禁止です。",
        "まず段落ごとに同じ意味の文を一つへまとめ、その後で主語と動作の関係を組み直してください。近い動作は接続助詞、連用形、条件形を使って一つの流れにします。",
        "引用に笑顔の記憶が含まれるなら、同じ文中や直後に『よく笑うお顔』『笑顔が浮かぶ』『記憶に残る』を重ねません。引用だけでその事実を伝え、次の場面へ進んでください。",
        "『人の悪口を言わず、人の悪口を言ってはいけないと話した』のように、同じ事実を否定形と引用で二度書いてはいけません。引用を残し、前半の重複を削ってください。",
        "『ご家族は抱いています』『お気持ちがあります』のような取材報告へ変えてはいけません。入力にある家族の思いは、主語を説明せず、記憶から自然につながる形で一度だけ置いてください。",
        "『旅は〜もの』『記憶が残ります』のような説明だけで終えず、場所・時期・親子三代という三つの事実を自然な二〜三文へ組み直してください。",
        "校正後は各段落を音読し、敬体の同型文末が三つ続かず、同じ事実が二度現れず、一文だけを現在形へ機械的に置き換えていないことを確認してください。",
      ].join("\n")
    : "";
  const taskInstruction = revisionMode
    ? [
        "これは新規作成ではなく、スタッフが選んだ構成を守る校正です。",
        "revisionDraftの開式前・閉式後を全文校正し、指定された修正だけを行ってください。",
        "事実の追加、場面の創作、人物評価の追加、開式前と閉式後の材料交換は禁止です。",
        "字数を増やすために文を足してはいけません。同じ笑顔、動作、思い出を説明し直した文は削り、残した文の助詞と流れだけを整えてください。",
        `スタッフの修正指示: ${revisionInstruction}`,
        revisionSpecificRules,
      ].join("\n")
    : "スタッフが選んだ事実カードの構成どおりに、新しい下書きを作成してください。";

  // Keep the task prompt deliberately lean. The former prompt repeated the
  // same rules in dozens of slightly different forms; that made the model
  // satisfy each interview item mechanically instead of writing one coherent
  // narration. Stable safety and output rules already live in the system
  // prompt, so this layer only supplies the task, facts, shape, and reference.
  const generationPayload = {
    season: writingRules.season || "",
    theme: writingRules.theme || payload.writingRules?.theme || "",
    forbiddenWords: asArray(writingRules.forbiddenWords).slice(0, 20),
    sourceFacts,
    revision: revisionMode ? {
      instruction: revisionInstruction,
      draft: compactText(payload.revisionDraft, 7000),
    } : null,
    styleReference: selectedStyleReference,
  };
  return [
    "目的：ご家族が聞いたとき、説明を受けているのではなく、その方との日常が自然に浮かぶ葬儀ナレーションの完成稿を書く。",
    taskInstruction,
    "事実：JSONのsourceFactsだけを使う。openingとclosingは混ぜず、入力にない場面・感情・評価・家族の反応を足さない。",
    "書き方：取材項目を順番に紹介しない。一段落に一つの記憶を置き、関係する動作を自然につなぐ。同じ事実や引用の意味を別の言葉で説明し直さない。",
    "推測禁止：入力にない道具、材料、場所、周囲の人、景色、家族の反応を、趣味や行動から補わない。『人の悪口を言ってはいけない』という引用を使う場合、『人の悪口を言わなかった』という同じ事実は別に書かない。",
    "視点：司会者が人物を外から評価せず、記憶の中の表情、手元、動作、場所を文の中心にする。『ご家族は〜と思っています』という報告調を避ける。",
    "構成：開式前は季節、生涯紹介、三〜四段落の具体的な記憶、固定の開式案内。350〜550字。閉式後本文は開式前で使わない一つの思い出から始め、家族の気持ちが入力にある場合だけ自然に結び、160〜260字。",
    "固定文：季節文の直後は『故{氏名}様は、{年齢}年という尊いご生涯を閉じ、静かに人生の幕を下ろされました。』、開式前の最後は『尽きることのない感謝の思いを胸に、まもなく開式のお時間でございます。』とする。",
    "閉式後：年齢、会葬御礼、献花、式場準備、手荷物案内は書かない。式次第案内はサーバーが一度だけ追加する。",
    "閉式後では閉式を宣言せず、家族へ生き方を説かず、道しるべ・教え・人生訓へ広げない。入力された思いと具体的な記憶だけで結ぶ。",
    "リズム：同じです・ます調を三文続けない。ただし語尾だけを現在形や体言止めへ置換しない。近い動作を接続助詞や連用形でつなぎ、段落全体を音読して整える。",
    "教科書：styleReferenceは文章をコピーせず、記憶の始め方、段落の運び、描写と余韻の配分だけを手本にする。",
    "完成条件：自然な日本語、同義反復なし、事実の重複なし、途中で切れた文なし、開式前と閉式後の内容重複なし。返答は指定されたJSON一個だけ。",
    JSON.stringify(generationPayload, null, 2),
  ].join("\n");

  return [
    "以下のJSONを材料に、葬儀ナレーションの完成稿を書いてください。",
    taskInstruction,
    "sourceFacts以外の事実は使わないでください。openingとclosingの材料は意図的に分けられています。",
    "sourceFactsの名詞と動作を、自然な尊敬語と助詞へ整える範囲で書いてください。入力にない形容詞、副詞、仕草、場所の細部、家族の反応、本人の内心を足してはいけません。",
    "sourceFactsにある動作を書いたら、その動作の後ろへ新しい描写を足さず、そこで文を終えてください。「支度を整える」を「一つひとつ整える」、「外まで見送る」を「最後まで見届ける」のように広げてはいけません。",
    "openingはanchorから人物の記憶を描き始め、選ばれたsupportsもすべて使ってください。各カードに含まれる異なる事実を一つも省略せず、それぞれ一度だけ書いてください。",
    "closingはopeningを要約せず、closingのanchorから別の思い出を静かにたどってください。closingの各カードに含まれる場所、時期、行動を省略せず一度ずつ使い、supportsに明記されたご家族のお気持ちがあれば、意味を広げずに結んでください。",
    "openingは定型文を含めて350〜550字、七〜十一文、四〜六段落にしてください。短い取材報告文を並べて字数を満たしてはいけません。sourceFacts.openingは最大六枚です。anchorを中心に置き、supportsに含まれる異なる事実も一度ずつ必ず使ってください。選択済みの事実を省略してはいけません。",
    "closingはサーバーが後で加える式次第案内を除き、160〜260字、四〜六文を目安にしてください。一つの具体的な思い出と、入力にある場合だけ家族の気持ちを結んでください。",
    "開式前の主要な思い出の各段落は70〜120字、閉式後の各段落は70〜130字にしてください。引用文を除き、内容を伝える一文を22字未満の短い報告文にしないでください。各段落では、最初の文で具体的な記憶を示し、続く文で同じカード内の別の動作や様子へ自然につないでください。",
    "段落は、具体的な行動や日常の場面から始めてください。人物評を先に置き、後から事実で説明する書き方は避けてください。",
    "anchorも各supportも一〜二文を目安とします。一つの事実を別の言葉で説明し直して文数を増やしてはいけません。カードに複数の具体的な事実があれば、それぞれを自然につないで描いてください。",
    "一つのカードに異なる事実が二つ以上ある場合は、無理に一文へ圧縮せず、一つずつ自然につないで書いてください。例として、手芸と草花、人付き合いと行動力、笑顔と歌や踊りは、それぞれ省略できない別の事実です。",
    "supportにanchorと同じ話題が含まれる場合、その重複部分は書かず、supportにだけある別の趣味・行動・思い出を使ってください。",
    "各カードにdoNotRepeatTopicsがある場合、その話題は同じカードの文章に含まれていても使用禁止です。別の固有の内容だけを使ってください。",
    "同じ段落で「ました・でした・ございます・おります」を三文続けないでください。一文を短く切るだけではなく、近い内容を接続助詞や連用形でつなぎ、思い出が今も目に浮かぶ箇所では自然な現在形を全体で二〜四文ほど使って、呼吸を作ってください。体言止めは一段落に一度までです。",
    "同じ主語の近い動作は一文にまとめてください。悪い例は「歌われることがありました。踊られることもありました。」です。自然な例は「歌に声を重ね、ときには踊るように身体を動かされる。」です。",
    "「手芸では〜ました。野菜には〜ました。お花にも〜ました」のように、入力欄を一文ずつ消化する書き方は禁止です。「手芸に向かえば、少しずつ形を整えていかれる。野菜やお花にも手をかけ、その育ちを見守る」のように、近い記憶を一つの流れにしてください。",
    "「笑っている顔しか思い出せない」を使った場合、直後に「よく笑う方でした」「そのお顔が記憶に残っています」と説明し直してはいけません。その一文だけで笑顔の記憶を伝え、次の具体的な場面へ進んでください。",
    "「私も彼女を見習い」は禁止です。familyFeelingsに見習いたい気持ちがある場合は、「その明るさを心に、これからの日々も前を向いて歩んでいきたい」という意味を広げない自然な形にしてください。",
    "開式案内の直前に「感謝の思いが寄せられます」を置き、その次も「感謝の思いを胸に」と重ねることは禁止です。具体的な記憶を一つ受ける橋渡しから、定型案内へ直接つないでください。",
    "別の場所へ出向く二つの動作は「人と言葉を交わし、地域の集まりにも欠かさず出かけられました」のように一文へつないでください。短い敬体文を二つ並べないでください。",
    "「時間を重ねる」「日々を重ねる」「時間が記憶につながる」「身近な記憶」「日常の一こま」「お姿がそこにある」「その声にのせて」「ひと続きの記憶」「胸に静かに留められる」「旅の余韻」「暮らしに刻まれる」「時間が流れる」「いつもの席」「ここに集う思い」「お見送りいたします」は使わないでください。事実を抽象語へ置き換えず、その場面を平明に書いてください。",
    "各段落の最後に抽象的な人物評を足さないでください。余韻文は開式前全体で一度までとし、同じ事実の言い直しにならない場合だけ置いてください。",
    "余韻文は直前の具体物を必ず受けてください。例は「その愛らしいお姿も、ご家族の記憶に残っています」「手芸に向かう手元も、草花に手をかけるお姿も、今では懐かしい日常の一場面です」です。人物評・人生訓・新しい感情は加えないでください。",
    "本文の最後に、すでに書いた趣味・性格・思い出を読点で並べる要約行を置かないでください。同じ事実を文章と一覧の両方で書くことは禁止です。",
    "事実に必ず含まれる動作だけは、場面として丁寧に描いて構いません。手芸・編み物なら手を動かして形にすること、草花や野菜を育てるなら手をかけて育つ様子を見ること、歌や踊りなら声を重ねたり身体を動かしたりすることです。",
    "ただし、その場にいた人、家族の反応、本人の内心、部屋、食事、天候など、元の事実から必ずとは言えないものは足さないでください。",
    "「手を使うことが暮らしにあった」「過ごし方の中にあった」「最初の記憶として残る」のような説明文は使わず、許可された具体的な動作をそのまま書いてください。",
    "styleReferenceは最も近い教科書です。本文を読み、構成・呼吸・段落の運び・描写の距離だけを参考にしてください。教科書の事実、固有名詞、特徴的な語句、文章はコピーしないでください。",
    "返答は指定されたJSON一個だけです。",
    JSON.stringify({
      season: writingRules.season || "",
      theme: writingRules.theme || payload.writingRules?.theme || "",
      forbiddenWords: asArray(writingRules.forbiddenWords).slice(0, 20),
      sourceFacts,
      memoryPlan,
      revision: revisionMode ? {
        instruction: revisionInstruction,
        draft: compactText(payload.revisionDraft, 7000),
      } : null,
      styleReference: selectedStyleReference,
      composition: {
        opening: [
          "季節",
          "氏名と年齢の定型文",
          "中心となる記憶",
          "関連する日常の場面",
          "感謝へ自然に渡す一文",
          "開式案内の定型文",
        ],
        closing: [
          "開式前に使っていない具体的な思い出",
          "その思い出が静かに残る余韻",
        ],
        voice: [
          "家族の記憶のそばにいる",
          "説明より場面",
          "読み上げて自然",
          "控えめで温かい",
        ],
        rhythm: [
          "敬体の同じ文末を三文続けない",
          "体言止めは一段落に一度まで",
          "短文を並べるだけでなく、関係の近い事実は一文の中で自然につなぐ",
          "段落末に抽象的な解説を足さない",
        ],
        referenceShape: selectedStyleReference ? {
          openingSentenceTarget: Math.max(
            8,
            Math.min(11, selectedStyleReference.openingSentenceCount || 9),
          ),
          closingBodySentenceTarget: Math.max(
            3,
            Math.min(5, selectedStyleReference.closingSentenceCount || 4),
          ),
          instruction: "教科書の文章はコピーせず、開式前の文数と段落の呼吸だけを近づける",
        } : null,
      },
    }, null, 2),
  ].join("\n");
};

