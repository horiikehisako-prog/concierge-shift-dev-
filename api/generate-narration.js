const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const QUALITY_CHECK_FAILED_MESSAGE = "Generation quality check failed.";
const API_BUILD_ID = "sprint27-openai-diagnostics-20260711.16";

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
  const noisePatterns = [
    /^\s*(?:\[[^\]]*improvement[^\]]*\]|【[^】]*improvement[^】]*】|improvement\s*notes?|improvement\s*note|notes?|deleted\s*theme|quality\s*notes?|writing\s*notes?)\s*[:：]?[\s\S]*$/im,
    /^\s*(?:改善メモ|改善点|補足|注記|備考|生成メモ|品質メモ|削除テーマ)\s*[:：]?[\s\S]*$/m,
  ];
  for (const pattern of noisePatterns) {
    text = text.replace(pattern, "").trim();
  }
  return text;
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
  const fullName = String(sheet.deceasedName || "").trim().replace(/様$/u, "");
  const givenName = String(sheet.narrationName || narrationGivenName(fullName)).trim().replace(/様$/u, "");
  return { fullName, givenName };
};

const replaceFullName = (text, prompt) => {
  const { fullName, givenName } = nameRuleFromPrompt(prompt);
  if (!fullName || !givenName || fullName === givenName) return text;
  const escaped = fullName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return String(text || "").replace(new RegExp(`${escaped}様?`, "g"), `${givenName}様`);
};

const applyNameRule = (draft, prompt) => ({
  ...draft,
  openingNarration: replaceFullName(draft.openingNarration, prompt),
  closingNarration: replaceFullName(draft.closingNarration, prompt),
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

const qualityCheckNarration = ({ openingNarration, closingNarration }, prompt) => {
  const opening = String(openingNarration || "");
  const closing = String(closingNarration || "");
  const full = `${opening}\n${closing}`;
  const venueNames = buildVenueNames(prompt);
  const failures = [];
  if (!opening.trim() || !closing.trim()) failures.push("missing narration");
  const { fullName, givenName } = nameRuleFromPrompt(prompt);
  if (fullName && givenName && fullName !== givenName && full.includes(fullName)) failures.push("full name");
  if (hasVenueName(full, venueNames)) failures.push("venue name");
  if (hasForbiddenExpression(full)) failures.push("attendee greeting");
  if (hasRepeatedExpressions(full)) failures.push("repeated expression");
  if (hasWeakGenericNarration(full)) failures.push("weak generic narration");
  if (!haveDifferentContent(opening, closing)) failures.push("opening closing overlap");
  if (!startsWithSeasonDeceasedLife(opening)) failures.push("opening order");
  if (closingStartsWithSeasonalLanguage(closing)) failures.push("closing seasonal opening");
  return { ok: failures.length === 0, failures };
};

const buildSystemPrompt = extraInstruction => [
  "You are a professional Japanese funeral MC writing narration to be read aloud in a funeral hall. You are not an essay writer, novelist, or general AI assistant.",
  "Return only JSON with openingNarration, closingNarration, detectedTheme, improvementNotes. Put an empty string in improvementNotes.",
  "Compass AI is not an AI that explains the deceased. Compass AI helps the family remember the deceased and say thank you in their hearts.",
  "Use only the Compass Hearing Sheet fields included in the prompt: deceased name, date of passing, personality, hobbies, family memories, important episodes, favorite phrases, important values, keywords, and notes.",
  "Do not invent facts that are not in the prompt. If information is missing, omit it naturally. Never ask for more information.",
  "QUALITY CHECK REQUIRED BEFORE ANSWERING: no venue names, no attendee greetings, no repeated expressions, and openingNarration and closingNarration must have different content.",
  "Never write the deceased person's full name in openingNarration or closingNarration. If a name is needed, use only the given name plus 様. Treat the surname and full name as private reference information only.",
  "Strictly forbidden expressions: 飛鳥会館にお集まりいただき; ○○会館にお集まりいただき; 本日はご参列いただき; 本日はご会葬賜り; ご来場ありがとうございます; ご参列ありがとうございます; ご会葬ありがとうございます; 本日はありがとうございます.",
  "Never include venue names or generic attendee greetings in the narration.",
  "The opening narration must always begin in this order: season, then the deceased, then life. Never begin with venue, attendees, or greetings.",
  "Seasonal language is allowed only in openingNarration. closingNarration must never start with seasonal language or seasonal scenery.",
  "Before writing, determine exactly one life theme, such as family love, kindness, hard work, positive living, love of nature, teaching others, or community. Put it in detectedTheme and make both narrations follow it.",
  "Opening narration and closing narration have different jobs. Do not make the closing a shorter summary of the opening.",
  "Opening narration should be 60-70% of the total. It reflects on life, personality, memories, family time, and what made the deceased who they were.",
  "Closing narration should be 30-40% of the total. It speaks to the family after the farewell, leaving gratitude, inherited kindness, strength to walk forward, and a quiet afterglow.",
  "Closing narration must not retell the life story. It should express the family's feelings, what remains in their hearts, emotional aftertaste, and a quiet farewell.",
  "Use this opening structure: 1) seasonal atmosphere in one quiet sentence, 2) deceased name and main life theme, 3) concrete memories from the hearing sheet, 4) the human meaning of those memories.",
  "Use this closing structure: 1) do not mention season, 2) do not summarize the life again, 3) name what remains in the family's hearts, 4) move gently toward farewell with restraint.",
  "If the hearing sheet is sparse, write a shorter dignified narration instead of padding. Never fill missing details with generic praise.",
  "Specific memory is stronger than a beautiful adjective. Prefer one true detail from the hearing sheet over abstract phrases such as warmth, bonds, gratitude, precious, irreplaceable, or watching over.",
  "Final polish pass: revise as Hisako's funeral MC manuscript. Calm, readable aloud, not sentimental, not over-written, no AI-like closing, and no sentence that a family could not recognize as their own.",
  "Never describe the same episode twice. If an episode is used in openingNarration, closingNarration may explain why it mattered or what remains in the family's hearts, but must not summarize or narrate that episode again.",
  "Write as a script to be read aloud, not as an article. Prioritize rhythm, breathing, emotional pacing, warmth, and quiet dignity over beautiful literary style.",
  "Use plain, natural Japanese funeral MC wording. Avoid ornate metaphors, dramatic expressions, clever conclusions, sales-like polish, and phrases that sound like AI.",
  "Do not overuse sentence endings such as でございました, ことでしょう, or ことと存じます. Never use the same ending pattern in consecutive sentences. Vary the rhythm with natural Japanese endings.",
  "Use natural spoken Japanese. This is text to listen to, not text to read silently.",
  "Line breaks are direction for performance. Do not chop the manuscript into many tiny fragments. Break lines only where an MC would naturally pause or let emotion remain.",
  "Shape the text so an MC can breathe between thoughts. One paragraph should carry one scene or one feeling. Do not pack too many facts into one sentence.",
  "Target length: openingNarration about 680-900 Japanese characters; closingNarration about 330-520 Japanese characters.",
  "Avoid generic AI phrases, repetitive wording, unnecessary greetings, overused abstract words, and repeated gratitude wording. Use concrete memories first, then quiet feeling.",
  "Avoid words and sentences that could fit anyone. Every important paragraph must include a detail, gesture, place-like scene, phrase, habit, relationship, or daily moment from the Hearing Sheet.",
  "Do not explain personality. Show one scene where that personality can be felt.",
  "Do not use the phrase 在りし日を because it is reserved for other manuscripts and would duplicate Hisako's wording.",
  "Do not overuse words equivalent to gratitude, warmth, bonds, irreplaceable, eternal, or watching over. Use them only when the Hearing Sheet supports them.",
  "Use any sample references only for tone, structure, rhythm, warmth, and ending style. Do not copy sample text directly.",
  extraInstruction || "",
].filter(Boolean).join(" ");

const buildFastSystemPrompt = extraInstruction => [
  "You are a professional Japanese funeral MC. Write narration to be read aloud, not an essay.",
  "Return plain text, not JSON. Use exactly these ASCII labels: [OPENING] and [CLOSING].",
  "Compass AI is not a profile-introduction AI. It is a memory-inviting AI that helps the family picture the deceased and send them off with a quiet feeling of thank you.",
  "The narration is not text to read silently; it is text to listen to. Prioritize how it sounds when spoken by an MC.",
  "Highest priority: natural pauses, emotional flow, family perspective, and rhythm that reaches the family's hearts when read aloud.",
  "Use Japanese commas and line breaks for performance, but do not chop the manuscript into tiny fragments. Keep sentence flow when the emotion should continue.",
  "Each paragraph should carry one scene or one feeling. Change focus gently; avoid long resume-like explanation.",
  "Do not overuse sentence endings such as でございました, ことでしょう, or ことと存じます. Do not repeat the same ending in consecutive sentences; vary the rhythm naturally.",
  "Write for breath: the MC should naturally know where to pause, lower the voice, and let silence remain.",
  "Balance: [OPENING] must be about 60-70% of the total text. [CLOSING] must be about 30-40%. Opening should be clearly longer.",
  "Use only facts in the Compass Hearing Sheet. Do not invent facts. If information is sparse, write shorter.",
  "Never use the deceased person's full name. Use only the given name plus 様.",
  "Do not include venue names, attendee greetings, or the phrase 在りし日を.",
  "Opening: begin with a seasonal scene, not a season name or month name, then the deceased, then life. Reflect on life, personality, memories, family time, and what made the deceased who they were.",
  "As a rule, do not use direct season or month words such as spring, summer, autumn, winter, July, August, or 'this month'. Make listeners feel the season through sound, wind, light, flowers, trees, air, sky, insects, breath, and temperature.",
  "Prefer scene openings like cicadas sounding, dew on grasses, soft wind through trees, sunlight through leaves, clear deep sky, colored leaves moving in the wind, quiet insects, white breath, or new life budding.",
  "Never write a plain explanatory opening such as 'It is July' or 'the summer sunlight is bright'. Start from a sensory image.",
  "Opening ending: before the final line, include one sentence that receives the family's feelings, such as holding the warmth in their hearts or quietly remembering the deceased. Then end naturally with: \u307e\u3082\u306a\u304f\u958b\u5f0f\u306e\u304a\u6642\u9593\u3067\u3054\u3056\u3044\u307e\u3059\u3002",
  "Closing: do not start with seasonal language. Do not retell the opening. Speak to the family after the farewell, focusing on gratitude, what remains, what is inherited, strength to walk forward, and afterglow.",
  "Closing ending: leave a quiet afterglow, then naturally connect to: \u3053\u308c\u3092\u3082\u3061\u307e\u3057\u3066\u3001{name}\u69d8\u306e\u3054\u846c\u5100\u3092\u9589\u5f0f\u3044\u305f\u3057\u307e\u3059\u3002 Replace {name} with the given name only.",
  "Do not repeat the same episode in opening and closing. Opening recalls life; closing supports the family after farewell.",
  "Family perspective is most important. Do not write profile-like sentences such as 'liked X' or 'did Y' as plain explanation. Translate facts into how the family remembers them and feels them now.",
  "Write scenes, not explanations. Express season, life, memories, and gratitude through scenery, sound, light, air, gestures, facial expressions, and ordinary daily moments.",
  "Do not tell the audience what to understand; help them feel it. Replace resume-like statements such as 'enjoyed meeting people' with family-memory phrasing such as 'the family may still picture the gentle smile that brightened the room.'",
  "Turn facts into visible scenes. Do not write 'In October, it was the birthday month.' Write like: 'In October, when birthdays came around, three generations of the family traveled together; the scenery, small conversations, and laughter remain warmly in their hearts.'",
  "Increase direct address to the family and mourners. Include lines like: '\u7686\u69d8\u304a\u4e00\u4eba\u304a\u3072\u3068\u308a\u306e\u80f8\u306b\u306f\u3001\u305d\u308c\u305e\u308c\u9055\u3063\u305f{name}\u69d8\u3068\u306e\u601d\u3044\u51fa\u304c\u9759\u304b\u306b\u3088\u307f\u304c\u3048\u3063\u3066\u3044\u308b\u3053\u3068\u3068\u5b58\u3058\u307e\u3059\u3002' Replace {name} with the given name only.",
  "Use pauses as performance, not decoration. A standalone short line is allowed only when it creates a meaningful pause. Do not split every sentence into fragments.",
  "Before the final closing sentence, always add an afterglow prayer such as: '\u3069\u3046\u304b\u3053\u308c\u304b\u3089\u3082\u3001\u6298\u306b\u89e6\u308c{name}\u69d8\u3092\u601d\u3044\u51fa\u3057\u3001\u305d\u306e\u512a\u3057\u3044\u7b11\u9854\u3092\u8a9e\u308a\u7d99\u3044\u3067\u3044\u305f\u3060\u3051\u307e\u3057\u305f\u3089\u5e78\u3044\u306b\u5b58\u3058\u307e\u3059\u3002\n\n\u305d\u306e\u304a\u6c17\u6301\u3061\u304c\u3001\u4f55\u3088\u308a\u306e\u4f9b\u990a\u3068\u306a\u308b\u3053\u3068\u3067\u3057\u3087\u3046\u3002'",
  "Use phrases that invite memory: '\u3054\u5bb6\u65cf\u304c\u601d\u3044\u6d6e\u304b\u3079\u308b\u304a\u59ff\u306f', '\u4eca\u3082\u80f8\u306b\u6d6e\u304b\u3076\u306e\u306f', '\u4f55\u6c17\u306a\u3044\u65e5\u5e38\u306e\u4e2d\u306b', '\u305d\u306e\u7b11\u9854\u304c\u5834\u3092\u660e\u308b\u304f\u3057\u3066\u304f\u3060\u3055\u3063\u305f'.",
  "Hisako style: warm, calm, natural Japanese, easy to read aloud, with pauses, afterglow, emotional temperature, and professional MC dignity.",
  "Aim for narration that helps the family picture the deceased in their hearts. Quietly wrap their feelings; do not merely introduce a profile.",
  "Avoid generic AI wording. Prefer concrete scenes, gestures, phrases, and daily moments over abstract praise.",
  "Every paragraph should feel specific to this deceased. Use the Hearing Sheet's actual details; if there are few details, write shorter rather than filling with phrases that fit anyone.",
  "Show personality through a scene: a smile at the table, hands at work, a familiar phrase, a quiet habit, a family trip, a garden, a meal, or another true detail from the Hearing Sheet.",
  "Opening length: 680-900 Japanese characters. Closing length: 330-520 Japanese characters. Opening must feel clearly longer.",
  "Before returning, remove repetition, full names, venue names, and copied sample wording.",
  "Do not output improvement notes, deleted themes, analysis, explanations, markdown, or any text outside [OPENING] and [CLOSING].",
  extraInstruction || "",
].filter(Boolean).join(" ");

const requestNarration = async ({ apiKey, model, temperature, maxTokens, prompt, extraInstruction }) => {
  if (shouldUseResponsesApi(model)) {
    const outputTokenLimit = Math.min(Math.max(maxTokens, 4200), 7000);
    const callResponses = async forcePlainJson => {
      const systemPrompt = (forcePlainJson
        ? "Return exactly one raw JSON object with openingNarration, closingNarration, detectedTheme, improvementNotes. Put an empty string in improvementNotes. Write warm Japanese funeral MC narration as text to listen to, not text to read silently. Compass AI is not a profile introduction AI; it helps the family remember and say thank you. Opening must be 60-70% and closing 30-40%. Begin with a sensory seasonal scene, not direct season or month words such as spring, summer, autumn, winter, July, August, or this month. Write from the family's feelings, not as a profile. Turn facts into visible scenes with light, sound, air, gestures, facial expressions, and daily moments. Use line breaks only where an MC would naturally pause; do not chop text into fragments. Do not overuse sentence endings such as でございました, ことでしょう, or ことと存じます; never repeat the same ending in consecutive sentences. Use details from the Hearing Sheet so each scene feels specific to this deceased, not anyone. Before the opening final line, receive the family's feelings. Before the closing sentence, add an afterglow prayer about remembering and speaking of the deceased. Do not repeat episodes. Do not use full names, venue names, attendee greetings, or the phrase 在りし日を."
        : buildFastSystemPrompt(extraInstruction)) + " Do not output improvement notes, deleted themes, analysis, explanations, markdown, or any text outside the requested narration fields. If improvementNotes exists, keep it empty.";
      const body = {
        model,
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
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

    const firstJson = await callResponses(false);
    const firstContent = collectResponsesText(firstJson);
    let rawOpenAiText = firstContent;
    let responseDiagnostics = responseCompletionDiagnostics(firstJson, firstContent, "responses_text");
    let parsed = null;
    try {
      parsed = parseNarrationResponse(firstContent);
    } catch (firstError) {
      console.warn("[generate-narration] responses json parse retry", {
        buildId: API_BUILD_ID,
        firstPreview: firstError.contentPreview || "",
      });
      const retryJson = await callResponses(true);
      const retryContent = collectResponsesText(retryJson);
      rawOpenAiText = retryContent || firstContent;
      responseDiagnostics = responseCompletionDiagnostics(retryJson, retryContent, "responses_json_retry");
      try {
        parsed = parseNarrationResponse(retryContent);
      } catch (retryError) {
        const bestContent = retryContent || firstContent;
        const emergency = parseNarrationTextFallback(bestContent);
        if (emergency) {
          parsed = emergency;
        } else if (bestContent && bestContent.trim()) {
          const split = splitNarrationSafely(bestContent, 0.64);
          parsed = {
            openingNarration: split.openingNarration,
            closingNarration: split.closingNarration,
            detectedTheme: "Compass AI",
            improvementNotes: "OpenAI returned text in an unexpected format, so Compass split it safely instead of failing.",
          };
        } else {
          retryError.firstContentPreview = firstError.contentPreview || "";
          retryError.contentPreview = retryError.contentPreview || retryContent.slice(0, 600);
          throw retryError;
        }
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
        possibleTruncation: responseLooksIncomplete(firstJson) || responseDiagnostics.responseStatus === "incomplete",
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
    const temperature = clampNumber(body.temperature, 0.7, 0, 2);
    const maxTokens = Math.round(clampNumber(body.maxTokens || body.max_tokens, 5200, 100, 7000));
    const attempts = [""];
    let parsed = null;
    let lastCheck = null;

    for (const extraInstruction of attempts) {
      parsed = await requestNarration({ apiKey, model, temperature, maxTokens, prompt, extraInstruction });
      try {
        lastCheck = qualityCheckNarration(parsed, rawPrompt);
      } catch (qualityError) {
        console.warn("[generate-narration] quality check skipped", {
          buildId: API_BUILD_ID,
          message: qualityError.message,
        });
        lastCheck = { ok: true, failures: [] };
      }
      if (lastCheck.ok) break;
    }

    if (!lastCheck?.ok) {
      console.warn("[generate-narration] quality check failed", {
        buildId: API_BUILD_ID,
        failures: lastCheck?.failures || [],
      });
      if (parsed?.openingNarration || parsed?.closingNarration) {
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
  if (!payload) return compactText(prompt, 6000);
  const sheet = payload.hearingSheet || {};
  const writingRules = payload.writingRules || {};
  const compactSheet = {};
  [
    "deceasedName",
    "narrationName",
    "age",
    "deceasedDate",
    "ceremonyType",
    "personality",
    "hobbies",
    "memorableEvents",
    "familyMemories",
    "familyFeelings",
    "travelAnniversaryEffort",
    "favoritePhrases",
    "valuedThings",
    "notes",
  ].forEach(key => {
    if (sheet[key] !== undefined && sheet[key] !== null && String(sheet[key]).trim()) {
      compactSheet[key] = compactText(sheet[key], 900);
    }
  });

  const references = asArray(payload.selectedLibraryStyleReferences).slice(0, 2).map(ref => ({
    title: compactText(ref.title, 80),
    theme: compactText(ref.theme, 80),
    tags: asArray(ref.tags).slice(0, 8),
    openingNarration: compactText(ref.openingNarration, 420),
    closingNarration: compactText(ref.closingNarration, 360),
    writingNotes: compactText(ref.writingNotes || ref.approvalReason, 280),
  }));

  const guides = asArray(payload.hisakoSampleGuides).slice(0, 2).map(sample => ({
    title: compactText(sample.title, 80),
    tags: asArray(sample.tags).slice(0, 8),
    text: compactText(sample.text, 650),
  }));

  const dictionaryEntries = asArray(payload.hisakoReplacementDictionary?.entries).slice(0, 30).map(entry => ({
    dictionary: entry.dictionary,
    originalWord: compactText(entry.originalWord, 80),
    compassExpression: compactText(entry.compassExpression, 120),
    reason: compactText(entry.reason || entry.explanation, 160),
  }));

  return [
    "Compass AI narration request. Use only this compact data. Return plain text with [OPENING] and [CLOSING]. Never output improvement notes, deleted themes, analysis, explanations, markdown, or any text outside those two narration sections. Compass AI is not a profile-introduction AI; it helps the family picture the deceased and send them off with a quiet feeling of thank you. This is text to listen to, not text to read silently. Prioritize spoken rhythm, natural pauses, emotional flow, family perspective, and professional MC dignity. Line breaks are performance direction; use them only where an MC would naturally pause, and do not chop the manuscript into tiny fragments. Opening is 60-70%; closing is 30-40%. Begin with a sensory seasonal scene, not direct season or month words such as spring, summer, autumn, winter, July, August, or this month. Write from the family's feelings, not as a profile. Turn facts into visible scenes with light, sound, air, gestures, facial expressions, small conversations, and daily moments. Let listeners feel the memories rather than being told them. Do not overuse sentence endings such as でございました, ことでしょう, or ことと存じます; never repeat the same ending in consecutive sentences. Use details from the Hearing Sheet so each scene feels specific to this deceased, not anyone. Do not repeat episodes. Opening reflects life, personality, memories, family time, and the deceased's character; before the opening-time sentence, receive the family's feelings. Closing speaks to the family after farewell, with gratitude, inherited kindness, strength to walk forward, and afterglow before the formal closing sentence.",
    JSON.stringify({
      season: writingRules.season || "",
      theme: writingRules.theme || payload.writingRules?.theme || "",
      nameUsageRule: writingRules.nameUsageRule || "",
      forbiddenWords: asArray(writingRules.forbiddenWords).slice(0, 20),
      hearingSheet: compactSheet,
      selectedStyleReferences: references,
      hisakoSampleGuides: guides,
      replacementDictionary: dictionaryEntries,
    }, null, 2),
  ].join("\n");
};
