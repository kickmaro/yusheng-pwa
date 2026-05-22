# 餘聲 PWA 原型

這是一版零依賴的手機優先 PWA 原型，用來快速驗證「AI 私密情緒樹洞」的核心體驗。

## 開啟方式

### 接 LLM 模型

先在專案資料夾建立 `.env`：

```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=你的 OpenAI API key
OPENAI_MODEL=gpt-5.4-mini
```

想先用免費中文模型測試，可以改成 Google Gemini：

```bash
LLM_PROVIDER=google
GOOGLE_API_KEY=你的 Google AI Studio API key
GOOGLE_MODEL=gemini-2.5-flash
```

也可以改成 OpenRouter：

```bash
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=你的 OpenRouter API key
OPENROUTER_MODEL=openrouter/free
```

或 Groq：

```bash
LLM_PROVIDER=groq
GROQ_API_KEY=你的 Groq API key
GROQ_MODEL=qwen-qwq-32b
```

然後執行：

```bash
node server.js
```

打開：

```text
http://localhost:4174
```

這個模式會由本機 Node server 代理 LLM API，API key 不會放進前端。正式給朋友測時建議先用 `openai`；內部測中文語感與成本時可切 `google`、`openrouter` 或 `groq`。

### 純前端備援

如果只是看 UI，也可以在專案資料夾執行：

```bash
python3 -m http.server 4174
```

然後打開：

```text
http://localhost:4174
```

第一次進入時輸入 4-6 位數字即可設定本機密碼。

## 部署

這個原型需要 Node server，不能只部署成純靜態網站，因為 LLM API key 必須留在後端。

### Render

1. 建立 Web Service，連到這個 repo。
2. Runtime 選 Node。
3. Start Command 填：

```bash
npm start
```

4. Environment Variables 設定：

```bash
LLM_PROVIDER=google
GOOGLE_API_KEY=你的 Google AI Studio API key
GOOGLE_MODEL=gemini-2.5-flash
```

5. Health Check Path 可填：

```text
/health
```

### Railway

1. 建立新 Project，連到這個 repo。
2. Start Command 使用：

```bash
npm start
```

3. Variables 設定同上。

## 已完成範圍

- PWA manifest 與 service worker
- 本機密碼鎖
- App 切到背景時自動回到鎖定畫面
- 樹洞對話頁
- 樹洞照片與錄音附件
- LLM API 後端代理，可切 OpenAI / Google Gemini / OpenRouter / Groq
- LLM 失敗時的本機模擬回覆備援
- 回聲情緒回顧
- 時間膠囊新增與列表
- 記憶列表與「從最近對話生成」流程
- localStorage 本機保存

## 尚未接入

- 真正端到端加密
- 帳號同步
- 訂閱付款
- 語音與圖片
