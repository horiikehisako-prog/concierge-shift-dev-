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
    const maxTokens = Math.round(clampNumber(body.maxTokens || body.max_tokens, 1200, 100, 4000));

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
              "You create respectful Japanese funeral MC narration drafts.",
              "Return only JSON with openingNarration, closingNarration, detectedTheme, improvementNotes.",
              "Do not invent facts that are not in the prompt.",
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
