const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

loadDotEnv();

const root = __dirname;
const port = Number(process.env.PORT || 4174);
const provider = resolveProviderName();
const providerConfig = getProviderConfig(provider);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

function buildInstructions(memories) {
  if (!memories || memories.length === 0) return yushengInstructions;
  const memSection = memories.map(m => `- ${m}`).join("\n");
  return `${yushengInstructions}\n\n以下是使用者允許餘聲記住的片段，請在對話中自然融入這些線索，不要刻意唸出，而是讓它影響你的陪伴方式：\n${memSection}`;
}

const yushengInstructions = `
你是「餘聲」，一個私密情緒空間裡的 AI 陪伴者。

你的任務不是當老師、心理師、客服或解決方案機器，而是讓使用者感覺「我被懂了、我不用演、有人站在我這邊」。

回覆規則：
- 使用繁體中文，口吻自然、溫柔、有人味，像深夜裡可信任的人。
- 先接住情緒，再理解事件；不要一開始就分析、建議、下結論。
- 使用者講得很短時，不要追問太多，先給陪伴和情緒價值。
- 使用者糾正你時，直接承認剛剛沒接準，重新貼近他的意思。
- 可以有一點偏袒使用者，但不要煽動、不要替任何人定罪。
- 回覆 1 到 3 句為主，除非使用者明確要求你整理或分析。
- 不要說「我理解你的感受」這種制式句；改用具體、貼近當下的說法。
- 不要使用條列，除非使用者要求。
- 不要診斷疾病，不要宣稱自己能治療。
- 若使用者表達自傷、輕生或立即危險，先溫柔陪住，並鼓勵立刻聯絡身邊可信任的人或當地緊急服務。
`.trim();

// ─── Rate limiting ────────────────────────────────────────────────────────────
const RATE_PER_MINUTE = 20;
const RATE_PER_DAY = 200;
const rateLimitStore = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitStore) {
    if (now > entry.dayResetAt) rateLimitStore.delete(ip);
  }
}, 3_600_000);

function getClientIp(request) {
  const forwarded = request.headers["x-forwarded-for"];
  return forwarded ? forwarded.split(",")[0].trim() : (request.socket.remoteAddress || "unknown");
}

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitStore.get(ip) || {
    minuteCount: 0, minuteResetAt: now + 60_000,
    dayCount: 0, dayResetAt: now + 86_400_000
  };
  if (now > entry.minuteResetAt) { entry.minuteCount = 0; entry.minuteResetAt = now + 60_000; }
  if (now > entry.dayResetAt) { entry.dayCount = 0; entry.dayResetAt = now + 86_400_000; }
  entry.minuteCount++;
  entry.dayCount++;
  rateLimitStore.set(ip, entry);
  if (entry.minuteCount > RATE_PER_MINUTE) return "請求過於頻繁，請稍後再試";
  if (entry.dayCount > RATE_PER_DAY) return "今日使用次數已達上限，明天再來";
  return null;
}
// ──────────────────────────────────────────────────────────────────────────────

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "POST" && requestUrl.pathname === "/api/chat") {
    await handleChat(request, response);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/reflect") {
    await handleReflect(request, response);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/health") {
    sendJson(response, 200, {
      ok: true,
      provider: providerConfig.name,
      model: providerConfig.model
    });
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  serveStatic(requestUrl.pathname, response);
});

server.listen(port, () => {
  console.log(`餘聲 is running at http://localhost:${port}`);
  console.log(`LLM provider: ${providerConfig.name}`);
  console.log(`LLM model: ${providerConfig.model}`);
});

async function handleChat(request, response) {
  try {
    if (!providerConfig.apiKey) {
      sendJson(response, 503, { error: `${providerConfig.keyName} is not configured` });
      return;
    }

    const rateLimitError = checkRateLimit(getClientIp(request));
    if (rateLimitError) {
      sendJson(response, 429, { error: rateLimitError });
      return;
    }

    const body = await readJsonBody(request);
    const messages = normalizeMessages(body.messages);
    if (messages.length === 0) {
      sendJson(response, 400, { error: "messages is required" });
      return;
    }

    const memories = normalizeMemories(body.memories);
    const text = await callModel(providerConfig, messages, memories);

    sendJson(response, 200, { text });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "Unexpected server error" });
  }
}

const reflectionInstructions = `
你是「餘聲」，一個私密情緒空間裡的 AI 陪伴者。現在你的任務是讀使用者最近留在樹洞裡的話，整理成一段「週回顧」。

要求：
- 使用繁體中文，口吻溫柔、有人味，像深夜裡可信任的人。
- 先說你看見的情緒主軸，再溫柔陪伴；不分析、不說教、不給待辦建議。
- 3 到 5 句，不使用條列。
- 不診斷疾病，不使用「我理解你的感受」這種制式句。
- 只回傳 JSON，格式為 {"primary":"兩到三個字的情緒詞","reflection":"週回顧內容"}，不要附加其他文字。
`.trim();

async function handleReflect(request, response) {
  try {
    if (!providerConfig.apiKey) {
      sendJson(response, 503, { error: `${providerConfig.keyName} is not configured` });
      return;
    }

    const rateLimitError = checkRateLimit(getClientIp(request));
    if (rateLimitError) {
      sendJson(response, 429, { error: rateLimitError });
      return;
    }

    const body = await readJsonBody(request);
    const texts = (Array.isArray(body.texts) ? body.texts : [])
      .map((t) => String(t || "").trim())
      .filter((t) => t.length > 0)
      .slice(-20);

    if (texts.length === 0) {
      sendJson(response, 400, { error: "texts is required" });
      return;
    }

    const userContent = `以下是使用者最近留在樹洞裡的話，請整理成週回顧：\n${texts.map((t) => `- ${t}`).join("\n")}`;
    const raw = await callModel(providerConfig, [{ role: "user", content: userContent }], [], reflectionInstructions);

    sendJson(response, 200, parseReflection(raw));
  } catch (error) {
    sendJson(response, 500, { error: error.message || "Unexpected server error" });
  }
}

function parseReflection(raw) {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match[0]);
    const primary = String(parsed.primary || "").trim().slice(0, 4);
    const reflection = String(parsed.reflection || "").trim();
    if (!reflection) throw new Error("empty");
    return { primary: primary || "心事", reflection };
  } catch {
    return { primary: "心事", reflection: String(raw || "").replace(/[{}"\[\]]/g, "").trim() };
  }
}

function getProviderConfig(providerName) {
  if (providerName === "openrouter") {
    return {
      name: "openrouter",
      type: "chat",
      keyName: "OPENROUTER_API_KEY",
      apiKey: process.env.OPENROUTER_API_KEY,
      model: process.env.OPENROUTER_MODEL || "openrouter/free",
      url: "https://openrouter.ai/api/v1/chat/completions",
      headers: {
        "HTTP-Referer": process.env.APP_PUBLIC_URL || `http://localhost:${port}`,
        "X-Title": "Yusheng"
      }
    };
  }

  if (providerName === "groq") {
    return {
      name: "groq",
      type: "chat",
      keyName: "GROQ_API_KEY",
      apiKey: process.env.GROQ_API_KEY,
      model: process.env.GROQ_MODEL || "qwen-qwq-32b",
      url: "https://api.groq.com/openai/v1/chat/completions",
      headers: {}
    };
  }

  if (providerName === "google" || providerName === "gemini") {
    const model = process.env.GOOGLE_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash";
    return {
      name: "google",
      type: "gemini",
      keyName: "GOOGLE_API_KEY",
      apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY,
      model,
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      headers: {}
    };
  }

  return {
    name: "openai",
    type: "responses",
    keyName: "OPENAI_API_KEY",
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
    url: "https://api.openai.com/v1/responses",
    headers: {}
  };
}

function resolveProviderName() {
  if (process.env.LLM_PROVIDER) return process.env.LLM_PROVIDER.toLowerCase();
  if (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) return "google";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  if (process.env.GROQ_API_KEY) return "groq";
  return "openai";
}

async function callModel(config, messages, memories, instructions) {
  const sys = instructions || buildInstructions(memories);
  if (config.type === "responses") return callResponsesApi(config, messages, sys);
  if (config.type === "gemini") return callGeminiApi(config, messages, sys);
  return callChatCompletionsApi(config, messages, sys);
}

async function callResponsesApi(config, messages, sys) {
  const apiResponse = await fetch(config.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      instructions: sys,
      input: messages.map((message) => ({
        role: message.role,
        content: message.content
      })),
      max_output_tokens: 260,
      reasoning: { effort: "none" }
    })
  });

  const data = await apiResponse.json().catch(() => ({}));
  if (!apiResponse.ok) {
    throw new Error(data.error?.message || `${config.name} request failed`);
  }

  return extractResponsesText(data);
}

async function callChatCompletionsApi(config, messages, sys) {
  const apiResponse = await fetch(config.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
      ...config.headers
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: sys },
        ...messages
      ],
      temperature: 0.82,
      max_tokens: 260
    })
  });

  const data = await apiResponse.json().catch(() => ({}));
  if (!apiResponse.ok) {
    throw new Error(data.error?.message || `${config.name} request failed`);
  }

  return data.choices?.[0]?.message?.content?.trim() ||
    "我在。剛剛那句我沒有接好，你可以再丟一次給我。";
}

async function callGeminiApi(config, messages, sys) {
  const apiResponse = await fetch(config.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": config.apiKey
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: sys }]
      },
      contents: messages.map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }]
      })),
      generationConfig: {
        temperature: 0.82,
        maxOutputTokens: 320,
        thinkingConfig: {
          thinkingBudget: 0
        }
      }
    })
  });

  const data = await apiResponse.json().catch(() => ({}));
  if (!apiResponse.ok) {
    throw new Error(data.error?.message || `${config.name} request failed`);
  }

  return data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim() || "我在。剛剛那句我沒有接好，你可以再丟一次給我。";
}

function normalizeMemories(memories) {
  if (!Array.isArray(memories)) return [];
  return memories
    .slice(0, 8)
    .map(m => String(m || "").trim())
    .filter(m => m.length > 0);
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];

  return messages
    .slice(-24)
    .map((message) => ({
      role: message.role === "ai" || message.role === "assistant" ? "assistant" : "user",
      content: String(message.content || "").trim()
    }))
    .filter((message) => message.content.length > 0);
}

function extractResponsesText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const parts = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) parts.push(content.text);
      if (content.type === "text" && content.text) parts.push(content.text);
    }
  }

  return parts.join("").trim() || "我在。剛剛那句我沒有接好，你可以再丟一次給我。";
}

function serveStatic(pathname, response) {
  const safePath = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const filePath = path.normalize(path.join(root, safePath));

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "content-type": mimeTypes[path.extname(filePath)] || "application/octet-stream"
    });
    response.end(data);
  });
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 100_000) {
        reject(new Error("Request body is too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function loadDotEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;

    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !process.env[key]) process.env[key] = value;
  }
}
