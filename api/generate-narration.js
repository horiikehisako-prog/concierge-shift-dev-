const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const QUALITY_CHECK_FAILED_MESSAGE = "Generation quality check failed.";

const STRICT_FORBIDDEN_EXPRESSIONS = [
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

const qualityCheckNarration = ({ openingNarration, closingNarration }, prompt) => {
  const opening = String(openingNarration || "");
  const closing = String(closingNarration || "");
  const full = `${opening}\n${closing}`;
  const venueNames = buildVenueNames(prompt);
  const failures = [];
  if (!opening.trim() || !closing.trim()) failures.push("missing narration");
  if (hasVenueName(full, venueNames)) failures.push("venue name");
  if (hasForbiddenExpression(full)) failures.push("attendee greeting");
  if (hasRepeatedExpressions(full)) failures.push("repeated expression");
  if (!haveDifferentContent(opening, closing)) failures.push("opening closing overlap");
  if (!startsWithSeasonDeceasedLife(opening)) failures.push("opening order");
  if (closingStartsWithSeasonalLanguage(closing)) failures.push("closing seasonal opening");
  return { ok: failures.length === 0, failures };
};

const buildSystemPrompt = extraInstruction => [
  "You are a professional Japanese funeral MC writing narration to be read aloud in a funeral hall. You are not an essay writer, novelist, or general AI assistant.",
  "Return only JSON with openingNarration, closingNarration, detectedTheme, improvementNotes.",
  "Use only the Compass Hearing Sheet fields included in the prompt: deceased name, date of passing, personality, hobbies, family memories, important episodes, favorite phrases, important values, keywords, and notes.",
  "Do not invent facts that are not in the prompt. If information is missing, omit it naturally. Never ask for more information.",
  "QUALITY CHECK REQUIRED BEFORE ANSWERING: no venue names, no attendee greetings, no repeated expressions, and openingNarration and closingNarration must have different content.",
  "Strictly forbidden expressions: 飛鳥会館にお集まりいただき; ○○会館にお集まりいただき; 本日はご参列いただき; 本日はご会葬賜り; ご来場ありがとうございます; ご参列ありがとうございます; ご会葬ありがとうございます; 本日はありがとうございます.",
  "Never include venue names or generic attendee greetings in the narration.",
  "The opening narration must always begin in this order: season, then the deceased, then life. Never begin with venue, attendees, or greetings.",
  "Seasonal language is allowed only in openingNarration. closingNarration must never start with seasonal language or seasonal scenery.",
  "Before writing, determine exactly one life theme, such as family love, kindness, hard work, positive living, love of nature, teaching others, or community. Put it in detectedTheme and make both narrations follow it.",
  "Opening narration and closing narration have different jobs. Do not make the closing a shorter summary of the opening.",
  "Opening narration introduces the deceased and gently helps attendees remember the person's life. Focus on personality, occupation or life work if provided, hobbies, family memories, concrete episodes, favorite phrases, values, human warmth, and life story.",
  "Closing narration must not retell the life story. It should express the family's feelings, what remains in their hearts, emotional aftertaste, and a quiet farewell.",
  "Never describe the same episode twice. If an episode is used in openingNarration, closingNarration may explain why it mattered or what remains in the family's hearts, but must not summarize or narrate that episode again.",
  "Write as a script to be read aloud, not as an article. Prioritize rhythm, breathing, emotional pacing, warmth, and quiet dignity over beautiful literary style.",
  "Use plain, natural Japanese funeral MC wording. Avoid ornate metaphors, dramatic expressions, clever conclusions, sales-like polish, and phrases that sound like AI.",
  "Use short sentences, natural pauses, comfortable breathing rhythm, and quiet line rhythm. Keep most sentences around 30-45 Japanese characters.",
  "Shape the text so an MC can breathe between thoughts. One paragraph should carry one feeling or memory. Do not pack too many facts into one sentence.",
  "Target length: openingNarration about 600-900 Japanese characters; closingNarration about 500-700 Japanese characters.",
  "Avoid generic AI phrases, repetitive wording, unnecessary greetings, overused abstract words, and repeated gratitude wording. Use concrete memories first, then quiet feeling.",
  "Do not overuse words equivalent to gratitude, warmth, bonds, irreplaceable, eternal, or watching over. Use them only when the Hearing Sheet supports them.",
  "Use any sample references only for tone, structure, rhythm, warmth, and ending style. Do not copy sample text directly.",
  extraInstruction || "",
].filter(Boolean).join(" ");

const requestNarration = async ({ apiKey, model, temperature, maxTokens, prompt, extraInstruction }) => {
  const openAiResponse = await fetch(OPENAI_URL, {
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
    throw error;
  }

  const content = openAiJson?.choices?.[0]?.message?.content || "";
  const parsed = extractJson(content);
  return {
    openingNarration: parsed.openingNarration || parsed.opening || "",
    closingNarration: parsed.closingNarration || parsed.closing || "",
    detectedTheme: parsed.detectedTheme || parsed.theme || "",
    improvementNotes: parsed.improvementNotes || parsed.notes || "",
  };
};

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.statusCode = 503;
    res.end(JSON.stringify({
      code: "OPENAI_API_KEY_MISSING",
      error: "AI connection is not configured.",
    }));
    return;
  }

  try {
    const body = await readJsonBody(req);
    const prompt = String(body.prompt || "").trim();
    if (!prompt) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "prompt is required" }));
      return;
    }

    const model = String(body.model || "gpt-4.1-mini").trim();
    const temperature = clampNumber(body.temperature, 0.7, 0, 2);
    const maxTokens = Math.round(clampNumber(body.maxTokens || body.max_tokens, 1800, 100, 4000));
    const attempts = [
      "",
      "The previous draft failed Compass quality checks. Regenerate completely. Do not reuse the failed wording. Start openingNarration with season, then the deceased, then life. Do not use venue names or attendee greetings. Do not start closingNarration with seasonal language.",
      `${QUALITY_CHECK_FAILED_MESSAGE} Regenerate again from scratch. Return only a narration that passes every quality check: no venue names, no attendee greetings, no repeated expressions, opening and closing with different content, opening order season -> deceased -> life, and closingNarration not starting with seasonal language.`,
    ];
    let parsed = null;
    let lastCheck = null;

    for (const extraInstruction of attempts) {
      parsed = await requestNarration({ apiKey, model, temperature, maxTokens, prompt, extraInstruction });
      lastCheck = qualityCheckNarration(parsed, prompt);
      if (lastCheck.ok) break;
    }

    if (!lastCheck?.ok) {
      res.statusCode = 422;
      res.end(JSON.stringify({
        code: "GENERATION_QUALITY_CHECK_FAILED",
        error: QUALITY_CHECK_FAILED_MESSAGE,
        qualityFailures: lastCheck?.failures || [],
      }));
      return;
    }

    res.statusCode = 200;
    res.end(JSON.stringify(parsed));
  } catch (error) {
    if (error.message === "OPENAI_REQUEST_FAILED") {
      res.statusCode = 502;
      res.end(JSON.stringify({
        error: "OpenAI request failed",
        status: error.status,
      }));
      return;
    }
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "AI narration generation failed" }));
  }
};
