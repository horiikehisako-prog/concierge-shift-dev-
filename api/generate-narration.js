const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const QUALITY_CHECK_FAILED_MESSAGE = "Generation quality check failed.";
const { buildNarrationMessages } = require('./narration-prompt');
const API_BUILD_ID = 'sprint27-unified-prompt-20260919';
const narrationStyleFailures = (opening, closing) => {
  const text = `${opening || ""}\n${closing || ""}`;
  const failures = [];
  if (/伺って(?:います|おります)|伺いました|だったそうです|とのことです|お話しくださいました/u.test(text)) failures.push("narration style: third-person report");
  if (/(?:ご)?本人/u.test(text)) failures.push("narration style: impersonal reference");
  return failures;
};
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

const splitNarrationSafely = (text, ratio = 0.65) => {
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
    const midpoint = Math.ceil(paragraphs.length * 0.65);
    return {
      openingNarration: paragraphs.slice(0, midpoint).join("\n\n"),
      closingNarration: paragraphs.slice(midpoint).join("\n\n"),
      detectedTheme: "Compass AI",
      improvementNotes: "OpenAI returned unlabeled text, so Compass split it into opening and closing narration.",
    };
  }
  const lines = text.split(/\n+/).map(v => v.trim()).filter(Boolean);
  if (lines.length >= 4 && text.length >= 120) {
    const midpoint = Math.ceil(lines.length * 0.65);
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
  let text = String(value || "").replace(/&(?:amp;)?#(?:x0*20|0*32);|&(?:amp;)?nbsp;/gi, " ").trim();
  if (!text) return "";
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
  const { fullName, givenName } = nameRuleFromPrompt(prompt);
  const name = fullName || givenName ? `故 ${fullName || givenName}` : "故人";
  const closingFinalPatterns = [
    /(?:①\s*葬儀のみ\s*)?これをもちまして、?[^。]{0,40}様のご葬儀を閉式いたします。?/gu,
    /(?:②\s*葬儀[＋+・]初七日\s*)?これをもちまして、?[^。]{0,40}様のご葬儀並びに初七日法要を執り納めさせていただきます。?/gu,
  ];
  for (const pattern of closingFinalPatterns) text = text.replace(pattern, "").trim();
  const funeralOnly = `① 葬儀のみ\nこれをもちまして、\n${name}様のご葬儀を閉式いたします。`;
  const withSeventhDay = `② 葬儀＋初七日\nこれをもちまして、\n${name}様のご葬儀並びに初七日法要を執り納めさせていただきます。`;
  return `${text}\n\n${funeralOnly}\n\n${withSeventhDay}`.trim();
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
  const match = String(prompt || "").match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (_) {
    return null;
  }
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
  const fullName = String(sheet.deceasedName || "").trim().replace(/^故\s*/u, "").replace(/様$/u, "").trim();
  const givenName = String(sheet.narrationName || narrationGivenName(fullName)).trim().replace(/様$/u, "");
  return { fullName, givenName };
};

const replaceFullName = (text, prompt) => {
  const { fullName, givenName } = nameRuleFromPrompt(prompt);
  if (!fullName || !givenName) return text;
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const names = [...new Set([fullName, fullName.replace(/[\s　]+/gu, ""), givenName])]
    .sort((a,b)=>b.length-a.length).map(escape).join("|");
  return String(text || "").replace(new RegExp(`(?:故\\s*)?(?:${names})様?`, "gu"), `${givenName}様`);
};

const openingNameRule = (text, prompt) => {
  const body = replaceFullName(text, prompt);
  const { fullName, givenName } = nameRuleFromPrompt(prompt);
  if (!fullName || !givenName) return body;
  return String(body || "").replace(`${givenName}様`, `故 ${fullName}様`);
};

const applyNameRule = (draft, prompt) => ({
  ...draft,
  openingNarration: openingNameRule(stripNonNarrationSections(draft.openingNarration), prompt),
  closingNarration: ensureClosingFinalLine(
    stripFixedClosingOpening(replaceFullName(stripNonNarrationSections(draft.closingNarration), prompt)),
    prompt
  ),
});

const DEFAULT_NARRATION_MODEL = "gpt-5.1";
const shouldUseResponsesApi = model => String(model || "").trim().startsWith("gpt-5");

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

const qualityCheckNarration = ({ openingNarration, closingNarration }, prompt) => {
  const opening = String(openingNarration || "");
  const closing = String(closingNarration || "");
  const full = `${opening}\n${closing}`;
  const venueNames = buildVenueNames(prompt);
  const failures = narrationStyleFailures(opening, closing);
  if (!opening.trim() || !closing.trim()) failures.push("missing narration");
  const { fullName, givenName } = nameRuleFromPrompt(prompt);
  const bodyWithoutRequiredClosings = full.replace(`故 ${fullName}様`, "")
    .replace(/①\s*葬儀のみ[\s\S]*?ご葬儀を閉式いたします。?/u, "")
    .replace(/②\s*葬儀[＋+・]初七日[\s\S]*?初七日法要を執り納めさせていただきます。?/u, "");
  if (fullName && givenName && fullName !== givenName && bodyWithoutRequiredClosings.includes(fullName)) failures.push("full name");
  if (hasVenueName(full, venueNames)) failures.push("venue name");
  if (hasForbiddenExpression(opening)) failures.push("attendee greeting");
  if (hasRepeatedExpressions(full)) failures.push("repeated expression");
  if (hasWeakGenericNarration(full)) failures.push("weak generic narration");
  if (!haveDifferentContent(opening, closing)) failures.push("opening closing overlap");
  if (!startsWithSeasonDeceasedLife(opening)) failures.push("opening order");
  if (closingStartsWithSeasonalLanguage(closing)) failures.push("closing seasonal opening");
  if (hasForbiddenExpression(closing.slice(0, 120))) failures.push("closing fixed greeting");
  return { ok: failures.length === 0, failures };
};

const requestNarration = async ({ apiKey, model, temperature, maxTokens, prompt, extraInstruction }) => {
  if (shouldUseResponsesApi(model)) {
    const outputTokenLimit = Math.min(Math.max(maxTokens, 4200), 7000);
    const callResponses = async forcePlainJson => {
      const body = {
        model,
        input: buildNarrationMessages(prompt),
        max_output_tokens: outputTokenLimit,
      };
      if (forcePlainJson) body.text = { format: { type: "json_object" } };

      const openAiResponse = await fetch(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

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
      messages: buildNarrationMessages(prompt),
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
  const model = DEFAULT_NARRATION_MODEL;
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

    const model = String(body.model || DEFAULT_NARRATION_MODEL).trim() || DEFAULT_NARRATION_MODEL;
    const temperature = clampNumber(body.temperature, 0.7, 0, 2);
    const maxTokens = Math.round(clampNumber(body.maxTokens || body.max_tokens, 5200, 100, 7000));
    let parsed = null;
    let lastCheck = null;
    parsed = await requestNarration({ apiKey, model, temperature, maxTokens, prompt, extraInstruction: "" });
    try {
      lastCheck = qualityCheckNarration(parsed, rawPrompt);
    } catch (qualityError) {
      console.warn("[generate-narration] quality check skipped", {
        buildId: API_BUILD_ID,
        message: qualityError.message,
      });
      lastCheck = { ok: true, failures: [] };
    }

    if (!lastCheck?.ok) {
      console.warn("[generate-narration] quality check failed", {
        buildId: API_BUILD_ID,
        failures: lastCheck?.failures || [],
      });
      if ((parsed?.openingNarration || parsed?.closingNarration) && !lastCheck.failures.some(f => f.startsWith("narration style:"))) {
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

const compactNarrationPrompt = prompt => {
  const payload = extractPromptPayload(prompt);
  if (!payload || !payload.hearingSheet) throw new Error('INVALID_HEARING_SHEET');
  const references = asArray(payload.selectedLibraryStyleReferences).slice(0, 2).map(ref => ({
    openingNarration: String(ref.openingNarration || ''),
    closingNarration: String(ref.closingNarration || ''),
  }));
  return JSON.stringify({
    hearingSheet: payload.hearingSheet,
    season: payload.season || payload.writingRules?.season || '',
    styleReferences: references,
  });
};
