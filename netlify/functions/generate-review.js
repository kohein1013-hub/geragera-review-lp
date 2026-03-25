/**
 * Netlify Function: generate-review
 *
 * - Client calls: POST /.netlify/functions/generate-review
 * - Server calls Gemini using GEMINI_API_KEY env var (do NOT expose key in HTML)
 */

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) out[k] = obj?.[k];
  return out;
}

function toTextArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(Boolean).map(String);
  return [String(v)];
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { allow: "POST" },
      body: "Method Not Allowed",
    };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return json(500, { error: "Missing GEMINI_API_KEY env var." });

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON." });
  }

  const {
    storeName = "",
    storeArea = "",
    storeCategory = "",
    satisfaction = "",
    selectedPoints = [],
    mustIncludeKeywords = [],
    tone = "ですます調",
  } = payload || {};

  const points = toTextArray(selectedPoints);
  const must = toTextArray(mustIncludeKeywords);

  // Safety/Policy: We are assisting with review copy drafting. Keep it truthful, avoid incentives/false claims.
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

  // Gemini API (Generative Language API)
  // Using v1beta to be compatible with common deployments.
  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: systemStyle + "\n\n" + userPrompt }] }],
      generationConfig: {
        temperature: 0.7,
        topP: 0.9,
        maxOutputTokens: 300,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return json(502, {
      error: "Gemini API request failed.",
      status: res.status,
      details: text.slice(0, 2000),
      debug: pick(payload, ["storeName", "storeArea", "storeCategory"]),
    });
  }

  const data = await res.json();
  const out =
    data?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join("") ||
    "";

  const cleaned = String(out)
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!cleaned) return json(502, { error: "Empty response from Gemini." });

  return json(200, { text: cleaned });
};

