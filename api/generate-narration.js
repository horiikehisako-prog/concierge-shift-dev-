const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

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
          {
            role: "system",
            content: [
              "You are a professional Japanese funeral MC writing narration to be read aloud in a funeral hall. You are not an essay writer, novelist, or general AI assistant.",
              "Return only JSON with openingNarration, closingNarration, detectedTheme, improvementNotes.",
              "Use only the Compass Hearing Sheet fields included in the prompt: deceased name, date of passing, personality, hobbies, family memories, important episodes, favorite phrases, important values, keywords, and notes.",
              "Do not invent facts that are not in the prompt. If information is missing, omit it naturally. Never ask for more information.",
              "Never include venue names or generic attendee greetings in the narration.",
              "Do not write phrases equivalent to: 飛鳥会館にお集まりいただき, 会場にお集まりいただき, 本日はご参列ありがとうございます, ご来場ありがとうございます, お越しいただきありがとうございます.",
              "Before writing, determine exactly one life theme, such as family love, kindness, hard work, positive living, love of nature, teaching others, or community. Put it in detectedTheme and make both narrations follow it.",
              "Opening narration and closing narration have different jobs. Do not make the closing a shorter summary of the opening.",
              "Opening narration introduces the deceased and gently helps attendees remember the person's life. Focus on personality, occupation or life work if provided, hobbies, family memories, concrete episodes, favorite phrases, values, human warmth, and life story.",
              "Closing narration must not retell the life story. It should express the family's feelings, the afterglow left in their hearts, the memories that remain, the meaning carried forward, and a quiet goodbye.",
              "Never describe the same episode twice. If an episode is used in openingNarration, closingNarration may explain why it mattered or what remains in the family's hearts, but must not summarize or narrate that episode again.",
              "Write as a script to be read aloud, not as an article. Prioritize rhythm, breathing, emotional pacing, warmth, and quiet dignity over beautiful literary style.",
              "Use plain, natural Japanese funeral MC wording. Avoid ornate metaphors, dramatic expressions, clever conclusions, sales-like polish, and phrases that sound like AI.",
              "Use short sentences, natural pauses, comfortable breathing rhythm, and quiet line rhythm. Keep most sentences around 30-45 Japanese characters.",
              "Shape the text so an MC can breathe between thoughts. One paragraph should carry one feeling or memory. Do not pack too many facts into one sentence.",
              "Target length: openingNarration about 600-900 Japanese characters; closingNarration about 500-700 Japanese characters.",
              "Avoid generic AI phrases, repetitive wording, unnecessary greetings, overused abstract words, and repeated gratitude wording. Use concrete memories first, then quiet feeling.",
              "Do not overuse words equivalent to gratitude, warmth, bonds, irreplaceable, eternal, or watching over. Use them only when the Hearing Sheet supports them.",
              "Use any sample references only for tone, structure, rhythm, warmth, and ending style. Do not copy sample text directly.",
            ].join(" "),
          },
          { role: "user", content: prompt },
        ],
      }),
    });

    const openAiJson = await openAiResponse.json().catch(() => null);
    if (!openAiResponse.ok) {
      res.statusCode = 502;
      res.end(JSON.stringify({
        error: "OpenAI request failed",
        status: openAiResponse.status,
      }));
      return;
    }

    const content = openAiJson?.choices?.[0]?.message?.content || "";
    const parsed = extractJson(content);
    res.statusCode = 200;
    res.end(JSON.stringify({
      openingNarration: parsed.openingNarration || parsed.opening || "",
      closingNarration: parsed.closingNarration || parsed.closing || "",
      detectedTheme: parsed.detectedTheme || parsed.theme || "",
      improvementNotes: parsed.improvementNotes || parsed.notes || "",
    }));
  } catch (error) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "AI narration generation failed" }));
  }
};
