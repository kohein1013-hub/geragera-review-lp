/**
 * Vercel Serverless Function: /api/generate-review
 *
 * Receives JSON from the client and generates a Google review draft using Gemini.
 * Environment variables:
 * - GEMINI_API_KEY (required)
 * - GEMINI_MODEL (optional, default: gemini-2.0-flash)
 */

function pick(obj, keys) {
  const out = {};
  for (const k of keys) out[k] = obj && obj[k];
  return out;
}

function toTextArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(Boolean).map(String);
  return [String(v)];
}

module.exports = async function generateReview(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).send("Method Not Allowed");
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Missing GEMINI_API_KEY env var." });
  }

  const payload = req.body || {};
  const {
    storeName = "",
    storeArea = "",
    storeCategory = "",
    satisfaction = "",
    selectedPoints = [],
    mustIncludeKeywords = [],
    tone = "ですます調",
  } = payload;

  const points = toTextArray(selectedPoints);
  const must = toTextArray(mustIncludeKeywords);

  const systemStyle = [
    "あなたは日本語の口コミ文章の編集者です。",
    "出力は1つの口コミ文のみ。箇条書きや見出しは禁止。",
    "文体は丁寧語（です・ます調）。不自然なAIっぽさを避け、短めの口語で。",
    "誇張や断定的な嘘は禁止。ユーザーが入力した内容の範囲で自然に表現する。",
    "店舗名・地名・業態などのキーワードを不自然にならない範囲で含める。",
    "文字数は120〜220字程度。",
  ].join("\n");

  const userPrompt = [
    `店舗名: ${storeName}`,
    `エリア: ${storeArea}`,
    `業態: ${storeCategory}`,
    `満足度: ${satisfaction}`,
    `良かった点(選択): ${points.length ? points.join(" / ") : "未選択"}`,
    `入れてほしいキーワード(可能なら自然に): ${must.length ? must.join(" / ") : "指定なし"}`,
    `文体: ${tone}`,
    "",
    "上の情報を踏まえて、Google口コミに投稿できる自然な文章を1つ作成してください。",
  ].join("\n");

  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const upstream = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: systemStyle + "\n\n" + userPrompt }] }],
      generationConfig: { temperature: 0.7, topP: 0.9, maxOutputTokens: 300 },
    }),
  });

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    return res.status(502).json({
      error: "Gemini API request failed.",
      status: upstream.status,
      details: text.slice(0, 2000),
      debug: pick(payload, ["storeName", "storeArea", "storeCategory"]),
    });
  }

  const data = await upstream.json();
  const out =
    (data &&
      data.candidates &&
      data.candidates[0] &&
      data.candidates[0].content &&
      data.candidates[0].content.parts &&
      data.candidates[0].content.parts.map((p) => p.text).filter(Boolean).join("")) ||
    "";

  const cleaned = String(out)
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!cleaned) return res.status(502).json({ error: "Empty response from Gemini." });

  return res.status(200).json({ text: cleaned });
};

