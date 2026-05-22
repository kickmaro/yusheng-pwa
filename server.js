const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

loadDotEnv();

const root = __dirname;
const port = Number(process.env.PORT || 4174);
const provider = (process.env.LLM_PROVIDER || "openai").toLowerCase();
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

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "POST" && requestUrl.pathname === "/api/chat") {
    await handleChat(request, response);
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

    const body = await readJsonBody(request);
    const messages = normalizeMessages(body.messages);
    if (messages.length === 0) {
      sendJson(response, 400, { error: "messages is required" });
      return;
    }

    const text = await callModel(providerConfig, messages);

    sendJson(response, 200, { text });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "Unexpected server error" });
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

async function callModel(config, messages) {
  if (config.type === "responses") return callResponsesApi(config, messages);
  if (config.type === "gemini") return callGeminiApi(config, messages);
  return callChatCompletionsApi(config, messages);
}

async function callResponsesApi(config, messages) {
  const apiResponse = await fetch(config.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      instructions: yushengInstructions,
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

async function callChatCompletionsApi(config, messages) {
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
        { role: "system", content: yushengInstructions },
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

async function callGeminiApi(config, messages) {
  const apiResponse = await fetch(config.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": config.apiKey
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: yushengInstructions }]
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
