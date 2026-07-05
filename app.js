const storageKey = "yusheng-pwa-state";
const pinKey = "yusheng-pwa-pin";
const removedSeedUserMessage = "我今天又把很多話吞回去了。其實沒有發生什麼大事，但就是覺得很累。";
const removedSeedAiMessage = "聽起來你不是因為單一事件崩掉，而是很多小重量一直壓著。你願意先把最卡住的一句話留在這裡嗎？";
const removedSeedMemoryTitle = "習慣把話吞回去";
const removedSeedMemorySummary = "使用者在壓力累積時，常選擇先不表達，事後感到疲憊與孤單。";

const seedState = {
  messages: [],
  memories: [],
  capsules: [
    {
      id: crypto.randomUUID(),
      title: "給一個月後的自己",
      content: "希望你已經比較能好好睡覺，也比較不需要硬撐。",
      openAt: nextMonthDate(),
      createdAt: new Date().toISOString()
    }
  ]
};

let state = loadState();
removeOldSeedData();
let pendingAttachments = [];
let isAiTyping = false;
let lastHiddenAt = 0;
const LOCK_GRACE_MS = 2 * 60 * 1000;

// ─── Theme ────────────────────────────────────────────────────────────────────
const themeKey = "yusheng-theme";
let themeSetting = localStorage.getItem(themeKey) || "auto";
const darkMedia = window.matchMedia("(prefers-color-scheme: dark)");

function applyTheme() {
  const dark = themeSetting === "dark" || (themeSetting === "auto" && darkMedia.matches);
  document.documentElement.classList.toggle("dark", dark);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? "#201d15" : "#efe8d7";
}

darkMedia.addEventListener("change", () => {
  if (themeSetting === "auto") applyTheme();
});

function cycleTheme() {
  themeSetting = themeSetting === "auto" ? "dark" : themeSetting === "dark" ? "light" : "auto";
  localStorage.setItem(themeKey, themeSetting);
  applyTheme();
  updateThemeButtonLabel();
}

function updateThemeButtonLabel() {
  const labels = { auto: "主題：自動", dark: "主題：深色", light: "主題：淺色" };
  elements.themeToggleButton.textContent = labels[themeSetting] || labels.auto;
}
// ──────────────────────────────────────────────────────────────────────────────
let mediaRecorder = null;

// ─── Attachment Store (IndexedDB) ─────────────────────────────────────────────
const ATTACHMENT_DB_NAME = "yusheng-attachments-v1";
const ATTACHMENT_STORE_NAME = "blobs";
let _attachmentDb = null;
const attachmentCache = new Map();

function getAttachmentDb() {
  if (_attachmentDb) return Promise.resolve(_attachmentDb);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(ATTACHMENT_DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(ATTACHMENT_STORE_NAME, { keyPath: "id" });
    };
    req.onsuccess = (e) => { _attachmentDb = e.target.result; resolve(_attachmentDb); };
    req.onerror = () => reject(req.error);
  });
}

async function saveAttachmentToDb(id, dataUrl) {
  attachmentCache.set(id, dataUrl);
  try {
    const db = await getAttachmentDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(ATTACHMENT_STORE_NAME, "readwrite");
      tx.objectStore(ATTACHMENT_STORE_NAME).put({ id, dataUrl });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("IndexedDB write failed:", err);
  }
}

async function deleteAttachmentFromDb(id) {
  attachmentCache.delete(id);
  try {
    const db = await getAttachmentDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(ATTACHMENT_STORE_NAME, "readwrite");
      tx.objectStore(ATTACHMENT_STORE_NAME).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("IndexedDB delete failed:", err);
  }
}

async function loadAllAttachments() {
  try {
    const db = await getAttachmentDb();
    const items = await new Promise((resolve, reject) => {
      const req = db.transaction(ATTACHMENT_STORE_NAME).objectStore(ATTACHMENT_STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    for (const item of items) attachmentCache.set(item.id, item.dataUrl);
  } catch (err) {
    console.warn("IndexedDB load failed:", err);
  }
}

async function migrateEmbeddedAttachments() {
  let changed = false;
  for (const message of state.messages) {
    for (const attachment of (message.attachments || [])) {
      if (attachment.dataUrl) {
        await saveAttachmentToDb(attachment.id, attachment.dataUrl);
        delete attachment.dataUrl;
        changed = true;
      }
    }
  }
  if (changed) saveState();
}

function getAttachmentUrl(id) {
  return attachmentCache.get(id) ?? null;
}
// ──────────────────────────────────────────────────────────────────────────────

// ─── PIN hashing ──────────────────────────────────────────────────────────────
async function hashPin(pin) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pin));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function isPinHashed(value) {
  return typeof value === "string" && value.length === 64 && /^[0-9a-f]+$/.test(value);
}

async function migratePin() {
  const stored = localStorage.getItem(pinKey);
  if (!stored || isPinHashed(stored)) return;
  localStorage.setItem(pinKey, await hashPin(stored));
}
// ──────────────────────────────────────────────────────────────────────────────
let recordedChunks = [];
let recordingStartedAt = 0;
let recordingStream = null;

const elements = {
  lockScreen: document.querySelector("#lockScreen"),
  mainApp: document.querySelector("#mainApp"),
  pinForm: document.querySelector("#pinForm"),
  pinInput: document.querySelector("#pinInput"),
  resetPinButton: document.querySelector("#resetPinButton"),
  lockButton: document.querySelector("#lockButton"),
  todayLine: document.querySelector("#todayLine"),
  chatList: document.querySelector("#chatList"),
  messageForm: document.querySelector("#messageForm"),
  messageInput: document.querySelector("#messageInput"),
  attachmentTray: document.querySelector("#attachmentTray"),
  attachPhotoButton: document.querySelector("#attachPhotoButton"),
  photoInput: document.querySelector("#photoInput"),
  recordButton: document.querySelector("#recordButton"),
  primaryMood: document.querySelector("#primaryMood"),
  moodBars: document.querySelector("#moodBars"),
  weeklyReflection: document.querySelector("#weeklyReflection"),
  echoMediaList: document.querySelector("#echoMediaList"),
  newCapsuleButton: document.querySelector("#newCapsuleButton"),
  capsuleForm: document.querySelector("#capsuleForm"),
  capsuleTitle: document.querySelector("#capsuleTitle"),
  capsuleContent: document.querySelector("#capsuleContent"),
  capsuleDate: document.querySelector("#capsuleDate"),
  capsuleList: document.querySelector("#capsuleList"),
  createMemoryButton: document.querySelector("#createMemoryButton"),
  memoryList: document.querySelector("#memoryList"),
  helpButton: document.querySelector("#helpButton"),
  helpPanel: document.querySelector("#helpPanel"),
  helpPanelClose: document.querySelector("#helpPanelClose"),
  generateReflectionButton: document.querySelector("#generateReflectionButton"),
  shareReflectionButton: document.querySelector("#shareReflectionButton"),
  moodTrend: document.querySelector("#moodTrend"),
  themeToggleButton: document.querySelector("#themeToggleButton"),
  exportDataButton: document.querySelector("#exportDataButton"),
  importDataButton: document.querySelector("#importDataButton"),
  importFileInput: document.querySelector("#importFileInput")
};

init();

async function init() {
  elements.todayLine.textContent = new Intl.DateTimeFormat("zh-Hant-TW", {
    month: "long",
    day: "numeric",
    weekday: "long"
  }).format(new Date());

  elements.capsuleDate.min = new Date().toISOString().slice(0, 10);
  applyTheme();
  updateThemeButtonLabel();

  await Promise.all([loadAllAttachments(), migratePin()]);
  await migrateEmbeddedAttachments();

  bindEvents();
  render();

  if (!localStorage.getItem(pinKey)) {
    elements.pinInput.placeholder = "設定 4-6 位數字";
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
}

function bindEvents() {
  elements.pinForm.addEventListener("submit", handlePin);
  elements.resetPinButton.addEventListener("click", resetLocalData);
  elements.lockButton.addEventListener("click", showLock);
  elements.messageForm.addEventListener("submit", handleMessageSubmit);
  elements.messageInput.addEventListener("input", resizeComposer);
  elements.attachPhotoButton.addEventListener("click", () => elements.photoInput.click());
  elements.photoInput.addEventListener("change", handlePhotoSelected);
  elements.recordButton.addEventListener("click", toggleRecording);
  elements.newCapsuleButton.addEventListener("click", () => elements.capsuleForm.classList.toggle("is-hidden"));
  elements.capsuleForm.addEventListener("submit", handleCapsuleSubmit);
  elements.createMemoryButton.addEventListener("click", createMemoryFromLatest);

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });

  elements.helpButton.addEventListener("click", () => elements.helpPanel.classList.add("active"));
  elements.helpPanelClose.addEventListener("click", () => elements.helpPanel.classList.remove("active"));
  elements.helpPanel.addEventListener("click", (e) => {
    if (e.target === elements.helpPanel) elements.helpPanel.classList.remove("active");
  });

  elements.generateReflectionButton.addEventListener("click", handleGenerateReflection);
  elements.shareReflectionButton.addEventListener("click", shareReflectionCard);
  elements.themeToggleButton.addEventListener("click", cycleTheme);
  elements.exportDataButton.addEventListener("click", exportData);
  elements.importDataButton.addEventListener("click", () => elements.importFileInput.click());
  elements.importFileInput.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) importData(file);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      lastHiddenAt = Date.now();
      return;
    }
    const wasUnlocked = !elements.mainApp.classList.contains("is-hidden");
    if (wasUnlocked && lastHiddenAt && Date.now() - lastHiddenAt > LOCK_GRACE_MS) {
      showLock();
    }
  });
}

async function handlePin(event) {
  event.preventDefault();
  const value = elements.pinInput.value.trim();
  if (!/^\d{4,6}$/.test(value)) {
    elements.pinInput.value = "";
    elements.pinInput.placeholder = "請輸入 4-6 位數字";
    return;
  }

  const savedPin = localStorage.getItem(pinKey);
  const inputHash = await hashPin(value);

  if (!savedPin) {
    localStorage.setItem(pinKey, inputHash);
    showApp();
    return;
  }

  if (savedPin === inputHash) {
    showApp();
  } else {
    elements.pinInput.value = "";
    elements.pinInput.placeholder = "密碼不正確";
  }
}

function showApp() {
  elements.pinInput.value = "";
  elements.lockScreen.classList.add("is-hidden");
  elements.mainApp.classList.remove("is-hidden");
}

function showLock() {
  elements.helpPanel.classList.remove("active");
  elements.mainApp.classList.add("is-hidden");
  elements.lockScreen.classList.remove("is-hidden");
}

async function resetLocalData() {
  if (!confirm("這會刪除餘聲保存在此裝置上的所有原型資料，確定嗎？")) return;
  localStorage.removeItem(storageKey);
  localStorage.removeItem(pinKey);
  try {
    const db = await getAttachmentDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(ATTACHMENT_STORE_NAME, "readwrite");
      tx.objectStore(ATTACHMENT_STORE_NAME).clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    attachmentCache.clear();
  } catch (err) {
    console.warn("IndexedDB clear failed:", err);
  }
  state = structuredClone(seedState);
  saveState();
  render();
  elements.pinInput.placeholder = "設定 4-6 位數字";
}

async function handleMessageSubmit(event) {
  event.preventDefault();
  const content = elements.messageInput.value.trim();
  if (mediaRecorder?.state === "recording") {
    alert("請先停止錄音，再把這段話留在樹洞裡。");
    return;
  }
  if (!content && pendingAttachments.length === 0) return;

  elements.messageInput.value = "";
  const attachments = pendingAttachments;
  pendingAttachments = [];
  renderAttachmentTray();
  setComposerBusy(true);

  const aiContent = buildAiContent(content, attachments);
  const aiAttachments = buildAiAttachments(attachments);
  state.messages.push({
    id: crypto.randomUUID(),
    role: "user",
    content,
    attachments,
    createdAt: new Date().toISOString()
  });

  saveState();
  render();
  isAiTyping = true;
  renderMessages();
  elements.chatList.scrollTop = elements.chatList.scrollHeight;

  const response = await createAiResponse(aiContent, state.messages, aiAttachments);
  isAiTyping = false;
  state.messages.push({
    id: crypto.randomUUID(),
    role: "ai",
    content: response,
    createdAt: new Date().toISOString()
  });

  setComposerBusy(false);
  saveState();
  render();
  elements.chatList.scrollTop = elements.chatList.scrollHeight;
}

async function createAiResponse(content, messages, attachments = []) {
  const warmupTimer = setTimeout(() => {
    elements.messageInput.placeholder = "伺服器正在喚醒，請稍候…";
  }, 5000);

  try {
    const recentMessages = messages.slice(-24);
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: recentMessages.map((message, index) => ({
          role: message.role,
          content: index === recentMessages.length - 1 && message.role === "user" ? content : message.content
        })),
        memories: state.memories.slice(0, 6).map(m => `[${m.type}] ${m.title}：${m.summary}`),
        attachments
      })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "AI server unavailable");
    }
    const data = await response.json();
    if (!data.text) throw new Error("AI response is empty");
    return data.text.trim();
  } catch (err) {
    if (err.message && err.message.includes("上限")) {
      return `今天的使用次數到了，明天再繼續吧。你說的話我都有接到。`;
    }
    return createLocalResponse(content, messages);
  } finally {
    clearTimeout(warmupTimer);
    setComposerBusy(false);
  }
}

function createLocalResponse(content, messages) {
  const text = content.trim();
  const latestAiReplies = messages
    .filter((message) => message.role === "ai")
    .slice(-4)
    .map((message) => message.content);

  if (isCorrection(text)) {
    return pickFreshReply(
      [
        "對不起，我剛剛沒有接準。你想說的不是那樣——你可以再多說一點，我重新聽。",
        "嗯，是我會錯意了。你剛剛真正想讓我懂的，是哪個部分？",
        "你說得對，我剛剛講偏了。我在，這次我慢慢聽。"
      ],
      latestAiReplies
    );
  }

  if (isShortEmotionalReply(text)) {
    return pickFreshReply(
      [
        "嗯，我在。你不用把話整理好，先把這口氣喘完。",
        "真的很不好受吧。先不要急著講清楚，你現在這樣說就已經夠了。",
        "我懂，現在要你說清楚太累了。你丟一句，我接一句。"
      ],
      latestAiReplies
    );
  }

  return pickFreshReply(
    [
      "我在。你不用先把事情說清楚，也不用把自己講得很合理，先放在這裡就好。",
      "嗯，我有收到。這句話不用馬上變成答案，它先被好好聽見就夠了。",
      "慢慢來。你現在說得亂也沒關係，我不會因為你亂就離開。",
      "這句話聽起來在心裡放了一陣子了。願意拿出來，已經很不容易。"
    ],
    latestAiReplies
  );
}

function setComposerBusy(isBusy) {
  elements.messageInput.disabled = isBusy;
  elements.messageForm.querySelector(".send-button").disabled = isBusy;
  elements.attachPhotoButton.disabled = isBusy;
  elements.recordButton.disabled = isBusy;
  elements.messageInput.placeholder = isBusy ? "餘聲正在聽..." : "把話留在這裡...";
  if (!isBusy) resizeComposer();
}

async function handlePhotoSelected(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;

  try {
    const attachment = await createImageAttachment(file);
    pendingAttachments.push(attachment);
    renderAttachmentTray();
  } catch {
    alert("這張照片暫時無法加入，請換一張試試。");
  }
}

async function toggleRecording() {
  if (mediaRecorder?.state === "recording") {
    await stopRecording();
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    alert("這個瀏覽器暫時不支援錄音。");
    return;
  }

  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    recordingStartedAt = Date.now();
    mediaRecorder = new MediaRecorder(recordingStream, getAudioRecorderOptions());
    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) recordedChunks.push(event.data);
    });
    mediaRecorder.addEventListener("stop", handleRecordingStopped);
    mediaRecorder.start();
    elements.recordButton.classList.add("is-recording");
    elements.recordButton.setAttribute("aria-label", "停止錄音");
  } catch {
    alert("無法開啟麥克風。請確認瀏覽器已允許錄音權限。");
  }
}

function stopRecording() {
  return new Promise((resolve) => {
    if (!mediaRecorder || mediaRecorder.state !== "recording") {
      resolve();
      return;
    }

    mediaRecorder.addEventListener("stop", resolve, { once: true });
    mediaRecorder.stop();
  });
}

async function handleRecordingStopped() {
  const mimeType = mediaRecorder.mimeType || "audio/webm";
  const blob = new Blob(recordedChunks, { type: mimeType });
  const duration = Math.max(1, Math.round((Date.now() - recordingStartedAt) / 1000));
  const id = crypto.randomUUID();
  await saveAttachmentToDb(id, await blobToDataUrl(blob));

  pendingAttachments.push({ id, type: "audio", mimeType, name: `錄音 ${formatDuration(duration)}`, duration });

  recordingStream?.getTracks().forEach((track) => track.stop());
  recordingStream = null;
  mediaRecorder = null;
  recordedChunks = [];
  recordingStartedAt = 0;
  elements.recordButton.classList.remove("is-recording");
  elements.recordButton.setAttribute("aria-label", "錄音");
  renderAttachmentTray();
}

function getAudioRecorderOptions() {
  const candidates = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"];
  const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  return mimeType ? { mimeType } : {};
}

function renderAttachmentTray() {
  elements.attachmentTray.innerHTML = pendingAttachments
    .map((attachment) => renderAttachmentPreview(attachment, true))
    .join("");
  elements.attachmentTray.classList.toggle("is-empty", pendingAttachments.length === 0);

  elements.attachmentTray.querySelectorAll("[data-remove-attachment]").forEach((button) => {
    button.addEventListener("click", () => {
      pendingAttachments = pendingAttachments.filter((attachment) => attachment.id !== button.dataset.removeAttachment);
      renderAttachmentTray();
    });
  });
}

function renderAttachmentPreview(attachment, removable = false) {
  const removeButton = removable
    ? `<button class="remove-attachment" type="button" data-remove-attachment="${attachment.id}" aria-label="移除附件">×</button>`
    : "";
  const url = getAttachmentUrl(attachment.id) || "";

  if (attachment.type === "image") {
    return `
      <figure class="attachment-preview photo-attachment">
        <img src="${url}" alt="${escapeHtml(attachment.name || "照片")}" />
        ${removeButton}
      </figure>
    `;
  }

  return `
    <div class="attachment-preview audio-attachment">
      <audio controls src="${url}"></audio>
      <span>${escapeHtml(attachment.name || "錄音")}</span>
      ${removeButton}
    </div>
  `;
}

async function createImageAttachment(file) {
  const dataUrl = await resizeImageFile(file);
  const id = crypto.randomUUID();
  await saveAttachmentToDb(id, dataUrl);
  return { id, type: "image", mimeType: "image/jpeg", name: file.name || "照片" };
}

function resizeImageFile(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const maxSize = 1280;
      const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(image.src);
      resolve(canvas.toDataURL("image/jpeg", 0.78));
    };
    image.onerror = reject;
    image.src = URL.createObjectURL(file);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function buildAiContent(content, attachments) {
  const notes = attachments.map((attachment) => {
    if (attachment.type === "image") return "（使用者在這則樹洞裡附上了一張照片，請看看照片的內容，溫柔地回應他分享的東西。）";
    return `（使用者附上了一段 ${formatDuration(attachment.duration || 0)} 的錄音，請聽聽他說了什麼，把錄音裡的話當作他對你說的話來回應。）`;
  });

  return [content || "我留下了一個沒有文字的片段。", ...notes].join("\n");
}

function buildAiAttachments(attachments) {
  return attachments
    .map((attachment) => {
      const dataUrl = getAttachmentUrl(attachment.id);
      if (!dataUrl || !dataUrl.includes(",")) return null;
      const mimeType = (attachment.mimeType || dataUrl.slice(5, dataUrl.indexOf(";"))).split(";")[0];
      return { mimeType, data: dataUrl.split(",")[1] };
    })
    .filter(Boolean)
    .slice(0, 4);
}

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return `${minutes}:${rest}`;
}

function pickFreshReply(replies, recentReplies) {
  const unused = replies.filter((reply) => !recentReplies.includes(reply));
  const pool = unused.length > 0 ? unused : replies;
  return pool[Math.floor(Math.random() * pool.length)];
}

function isShortEmotionalReply(text) {
  if (text.length > 12) return false;
  return ["很差", "很煩", "很累", "好累", "好煩", "很痛", "很空", "真的", "不懂", "受不了"].some((keyword) =>
    text.includes(keyword)
  );
}

function isCorrection(text) {
  return (
    text.includes("沒有想要") ||
    text.includes("不是") ||
    text.includes("你沒懂") ||
    text.includes("聽不懂") ||
    text.includes("不是這樣")
  );
}

function handleCapsuleSubmit(event) {
  event.preventDefault();
  const title = elements.capsuleTitle.value.trim();
  const content = elements.capsuleContent.value.trim();
  const openAt = elements.capsuleDate.value;
  if (!title || !content || !openAt) return;

  state.capsules.unshift({
    id: crypto.randomUUID(),
    title,
    content,
    openAt,
    createdAt: new Date().toISOString()
  });

  elements.capsuleForm.reset();
  elements.capsuleForm.classList.add("is-hidden");
  saveState();
  renderCapsules();
}

function createMemoryFromLatest() {
  const latestUser = [...state.messages].reverse().find((message) => message.role === "user");
  if (!latestUser) return;

  const memory = createLongTermMemory(latestUser.content);
  state.memories.unshift({
    id: crypto.randomUUID(),
    ...memory,
    createdAt: new Date().toISOString()
  });
  saveState();
  renderMemories();
  switchTab("memories");
}

async function handleGenerateReflection() {
  const texts = state.messages
    .filter((m) => m.role === "user" && m.content?.trim())
    .slice(-20)
    .map((m) => m.content.trim());

  if (texts.length === 0) {
    alert("先在樹洞留下一些話，餘聲才能整理。");
    return;
  }

  elements.generateReflectionButton.disabled = true;
  elements.generateReflectionButton.textContent = "餘聲正在整理…";

  try {
    const response = await fetch("/api/reflect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ texts })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.reflection) throw new Error(data.error || "failed");

    state.echoAi = {
      primary: data.primary || "心事",
      reflection: data.reflection,
      createdAt: new Date().toISOString()
    };
    saveState();
    renderEcho();
  } catch (err) {
    alert(err.message?.includes("上限") || err.message?.includes("頻繁")
      ? err.message
      : "現在整理不了，稍後再試一次。");
  } finally {
    elements.generateReflectionButton.disabled = false;
    elements.generateReflectionButton.textContent = "讓餘聲整理這週";
  }
}

function localDayKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function renderMoodTrend() {
  const byDay = new Map();
  for (const message of state.messages) {
    if (message.role !== "user" || !message.content?.trim()) continue;
    const key = localDayKey(message.createdAt);
    byDay.set(key, (byDay.get(key) || "") + " " + message.content);
  }

  const heavyWords = ["累", "疲", "撐", "煩", "焦慮", "怕", "不安", "緊張", "擔心", "慌", "失眠", "睡不著", "丟臉", "尷尬", "狼狽", "委屈", "難過", "哭", "痛", "空", "麻木", "厭世", "生氣", "不爽"];
  const lightWords = ["還好", "平靜", "舒服", "放鬆", "開心", "好一點", "沒事", "謝謝", "喜歡", "期待"];

  const width = 320;
  const height = 100;
  const pad = 10;
  const points = [];
  for (let i = 29; i >= 0; i--) {
    const day = new Date();
    day.setDate(day.getDate() - i);
    const text = byDay.get(localDayKey(day));
    let score = null;
    if (text) {
      const heavy = heavyWords.reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0);
      const light = lightWords.reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0);
      score = Math.max(8, Math.min(96, 30 + heavy * 14 - light * 12));
    }
    points.push({ x: pad + (29 - i) * (width - 2 * pad) / 29, score });
  }

  const active = points.filter((p) => p.score !== null);
  if (active.length < 2) {
    elements.moodTrend.innerHTML = `<p class="trend-empty">多留幾天樹洞，這裡會慢慢畫出你的情緒曲線。</p>`;
    return;
  }

  const toY = (score) => pad + ((100 - score) / 100) * (height - 2 * pad);
  const linePath = active.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${toY(p.score).toFixed(1)}`).join(" ");
  const dots = active.map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${toY(p.score).toFixed(1)}" r="2.6" fill="var(--accent-2)" />`).join("");

  elements.moodTrend.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="30 天情緒起伏折線圖">
      <path d="${linePath}" fill="none" stroke="var(--accent-2)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.85" />
      ${dots}
    </svg>
    <div class="trend-axis"><span>30 天前</span><span>越高代表心事越重</span><span>今天</span></div>
  `;
}

async function shareReflectionCard() {
  const echo = state.echoAi;
  if (!echo?.reflection) {
    alert("先按「讓餘聲整理這週」，才有卡片可以存。");
    return;
  }

  const W = 1080;
  const H = 1350;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const serif = '"Songti TC", "Noto Serif TC", serif';

  const gradient = ctx.createLinearGradient(0, 0, 0, H);
  gradient.addColorStop(0, "#f8f2e4");
  gradient.addColorStop(1, "#e7ddc4");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "rgba(154, 163, 125, 0.16)";
  ctx.beginPath();
  ctx.arc(W - 110, 170, 230, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(111, 132, 106, 0.10)";
  ctx.beginPath();
  ctx.arc(130, H - 150, 270, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#6f745d";
  ctx.font = `34px ${serif}`;
  ctx.fillText(new Intl.DateTimeFormat("zh-Hant-TW", { year: "numeric", month: "long", day: "numeric" }).format(new Date(echo.createdAt)), 96, 150);

  ctx.fillStyle = "#56623f";
  ctx.font = `600 116px ${serif}`;
  ctx.fillText(echo.primary, 96, 315);

  ctx.strokeStyle = "rgba(112, 120, 78, 0.5)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(96, 375);
  ctx.lineTo(236, 375);
  ctx.stroke();

  ctx.fillStyle = "#444638";
  ctx.font = `44px ${serif}`;
  const lines = wrapCjkText(ctx, echo.reflection, W - 192);
  lines.slice(0, 12).forEach((line, index) => ctx.fillText(line, 96, 480 + index * 74));

  ctx.fillStyle = "#8a8d74";
  ctx.font = `36px ${serif}`;
  ctx.fillText("—— 餘聲", 96, H - 108);

  canvas.toBlob(async (blob) => {
    if (!blob) return;
    const file = new File([blob], `yusheng-${localDayKey(new Date())}.png`, { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch {}
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}

function wrapCjkText(ctx, text, maxWidth) {
  const lines = [];
  let line = "";
  for (const char of text) {
    if (char === "\n") {
      lines.push(line);
      line = "";
      continue;
    }
    if (ctx.measureText(line + char).width > maxWidth) {
      lines.push(line);
      line = char;
    } else {
      line += char;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function exportData() {
  const attachments = {};
  for (const [id, dataUrl] of attachmentCache) attachments[id] = dataUrl;

  const payload = {
    app: "yusheng",
    version: 1,
    exportedAt: new Date().toISOString(),
    state,
    attachments
  };

  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `yusheng-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function importData(file) {
  let payload;
  try {
    payload = JSON.parse(await file.text());
  } catch {
    alert("這個檔案無法讀取，請確認是餘聲的備份檔。");
    return;
  }

  if (payload?.app !== "yusheng" || !payload.state) {
    alert("這不是餘聲的備份檔。");
    return;
  }

  if (!confirm("匯入會覆蓋目前裝置上的所有資料，確定嗎？")) return;

  state = payload.state;
  saveState();
  for (const [id, dataUrl] of Object.entries(payload.attachments || {})) {
    await saveAttachmentToDb(id, dataUrl);
  }
  render();
  elements.helpPanel.classList.remove("active");
  alert("匯入完成，你的資料都回來了。");
}

function switchTab(name) {
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.toggle("active", screen.dataset.screen === name);
  });
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === name);
  });

  if (name === "capsules") {
    let changed = false;
    const now = new Date();
    for (const capsule of state.capsules) {
      if (!capsule.seenAt && new Date(capsule.openAt) <= now) {
        capsule.seenAt = now.toISOString();
        changed = true;
      }
    }
    if (changed) saveState();
    updateCapsuleBadge();
  }
}

function updateCapsuleBadge() {
  const now = new Date();
  const hasUnseen = state.capsules.some((c) => !c.seenAt && new Date(c.openAt) <= now);
  document.querySelector('.tab[data-tab="capsules"]').classList.toggle("has-badge", hasUnseen);
}

function render() {
  renderMessages();
  renderEcho();
  renderCapsules();
  renderMemories();
  updateCapsuleBadge();
}

function renderMessages() {
  let html = state.messages
    .map((message) => {
      const label = message.role === "user" ? "user" : "ai";
      const attachments = (message.attachments || []).map((attachment) => renderAttachmentPreview(attachment)).join("");
      return `
        <article class="message ${label}">
          ${message.content ? `<div>${escapeHtml(message.content)}</div>` : ""}
          ${attachments ? `<div class="message-attachments">${attachments}</div>` : ""}
          <time>${formatTime(message.createdAt)}</time>
        </article>
      `;
    })
    .join("");

  if (isAiTyping) {
    html += `<article class="message ai"><div class="typing-dots"><span></span><span></span><span></span></div></article>`;
  }

  elements.chatList.innerHTML = html;
}

function renderEcho() {
  const userMessages = state.messages.filter((message) => message.role === "user");
  renderEchoMedia(userMessages);
  renderMoodTrend();

  if (userMessages.length === 0) {
    elements.primaryMood.textContent = "尚未產生";
    elements.weeklyReflection.textContent = "留下第一段樹洞對話後，餘聲會從那些話裡整理回聲。現在這裡先保持空白，不替你預設任何情緒。";
    elements.moodBars.innerHTML = `
      <div class="echo-empty">
        <p>還沒有可分析的樹洞內容。</p>
      </div>
    `;
    return;
  }

  const mood = detectEchoMood(userMessages);
  if (state.echoAi?.reflection) {
    elements.primaryMood.textContent = state.echoAi.primary;
    elements.weeklyReflection.textContent = `${state.echoAi.reflection}（${formatDate(state.echoAi.createdAt)} 由餘聲整理）`;
  } else {
    elements.primaryMood.textContent = mood.primary;
    elements.weeklyReflection.textContent = mood.reflection;
  }
  elements.moodBars.innerHTML = mood.bars
    .map((bar) => `
      <div class="bar-row">
        <span>${bar.label}</span>
        <div class="bar-track"><div class="bar-fill" style="width: ${bar.value}%"></div></div>
        <span>${bar.value}</span>
      </div>
    `)
    .join("");
}

function renderEchoMedia(userMessages) {
  const mediaItems = userMessages.flatMap((message) =>
    (message.attachments || []).map((attachment) => ({
      ...attachment,
      messageText: message.content,
      createdAt: message.createdAt
    }))
  );

  if (mediaItems.length === 0) {
    elements.echoMediaList.innerHTML = `
      <article class="echo-media-empty">
        <p>還沒有照片或錄音。之後你在樹洞留下的片段，會在這裡慢慢收好。</p>
      </article>
    `;
    return;
  }

  elements.echoMediaList.innerHTML = mediaItems
    .slice()
    .reverse()
    .map((item) => renderEchoMediaItem(item))
    .join("");
}

function renderEchoMediaItem(item) {
  const note = item.messageText ? `<p>${escapeHtml(shortenText(item.messageText, 42))}</p>` : "";
  const label = item.type === "image" ? "照片" : `錄音 ${formatDuration(item.duration || 0)}`;
  const url = getAttachmentUrl(item.id) || "";
  const media = item.type === "image"
    ? `<a href="${url}" target="_blank" rel="noreferrer"><img src="${url}" alt="${escapeHtml(item.name || "照片")}" /></a>`
    : `<audio controls src="${url}"></audio>`;

  return `
    <article class="echo-media-item ${item.type}">
      ${media}
      <div>
        <span>${label} · ${formatDate(item.createdAt)}</span>
        ${note}
      </div>
    </article>
  `;
}

function renderCapsules() {
  elements.capsuleList.innerHTML = state.capsules
    .map((capsule) => {
      const canOpen = new Date(capsule.openAt) <= new Date();
      return `
        <article class="item-card">
          <button class="delete-item-btn" type="button" data-delete-capsule="${capsule.id}" aria-label="刪除膠囊">×</button>
          <h3>${escapeHtml(capsule.title)}</h3>
          <p>${canOpen ? escapeHtml(capsule.content) : "還沒到開啟時間。餘聲會先替你保管。"}</p>
          <div class="item-meta">
            <span>${canOpen ? "已可開啟" : "封存中"}</span>
            <span>${formatDate(capsule.openAt)}</span>
          </div>
        </article>
      `;
    })
    .join("");

  elements.capsuleList.querySelectorAll("[data-delete-capsule]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!confirm("刪除這個膠囊？")) return;
      state.capsules = state.capsules.filter(c => c.id !== btn.dataset.deleteCapsule);
      saveState();
      renderCapsules();
    });
  });
}

function renderMemories() {
  if (state.memories.length === 0) {
    elements.memoryList.innerHTML = `
      <article class="item-card empty-card">
        <h3>還沒有保存任何記憶</h3>
        <p>記憶不會自動產生。只有當你按下允許，餘聲才會把某個片段留下來，作為長期理解你的線索。</p>
      </article>
    `;
    return;
  }

  elements.memoryList.innerHTML = state.memories
    .map((memory) => `
      <article class="item-card">
        <button class="delete-item-btn" type="button" data-delete-memory="${memory.id}" aria-label="刪除記憶">×</button>
        <h3>${escapeHtml(memory.title)}</h3>
        <p>${escapeHtml(memory.summary)}</p>
        <div class="item-meta">
          <span>${escapeHtml(memory.type)}</span>
          <span>${formatDate(memory.createdAt)}</span>
        </div>
      </article>
    `)
    .join("");

  elements.memoryList.querySelectorAll("[data-delete-memory]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!confirm("移除這個記憶片段？")) return;
      state.memories = state.memories.filter(m => m.id !== btn.dataset.deleteMemory);
      saveState();
      renderMemories();
    });
  });
}

function createLongTermMemory(text) {
  const normalized = text.trim();
  const quote = normalized.length > 36 ? `${normalized.slice(0, 36)}...` : normalized;

  if (["不想", "不要", "別", "不用", "討厭"].some((keyword) => normalized.includes(keyword))) {
    return {
      type: "偏好",
      title: "不希望被急著修正",
      summary: `使用者比較需要先被接住，而不是立刻被要求改變或振作。來源片段：「${quote}」`
    };
  }

  if (["教練", "主管", "同事", "朋友", "家人", "他", "她"].some((keyword) => normalized.includes(keyword))) {
    return {
      type: "重要人物",
      title: "有一個牽動情緒的人",
      summary: `這個人或關係可能會牽動使用者的情緒，需要在後續對話裡被溫柔看待。來源片段：「${quote}」`
    };
  }

  if (["丟臉", "尷尬", "狼狽", "怕", "焦慮", "不安"].some((keyword) => normalized.includes(keyword))) {
    return {
      type: "觸發點",
      title: "容易反覆回放難堪時刻",
      summary: `當使用者覺得自己失控、狼狽或被看見脆弱時，情緒可能會卡很久。來源片段：「${quote}」`
    };
  }

  if (["累", "撐", "吞", "忍", "說不出口"].some((keyword) => normalized.includes(keyword))) {
    return {
      type: "自我模式",
      title: "壓力來時會先自己扛著",
      summary: `使用者在壓力或低潮時，可能會先把話收起來，不一定馬上求助。來源片段：「${quote}」`
    };
  }

  return {
    type: "重要片段",
    title: "使用者允許保存的一段話",
    summary: `這段話被使用者允許留下，之後可以作為理解他的線索。來源片段：「${quote}」`
  };
}

function detectEchoMood(userMessages) {
  const recentMessages = userMessages.slice(-12);
  const recentText = recentMessages.map((message) => message.content || "").join(" ");
  const attachmentCount = recentMessages.reduce((count, message) => count + (message.attachments?.length || 0), 0);
  const scores = [
    {
      label: "疲憊",
      value: scoreKeywords(recentText, ["累", "疲", "撐", "厭世", "空", "麻木", "不想動", "好煩"]) + attachmentCount
    },
    {
      label: "焦慮",
      value: scoreKeywords(recentText, ["焦慮", "怕", "不安", "緊張", "擔心", "慌", "睡不著", "失眠"])
    },
    {
      label: "難堪",
      value: scoreKeywords(recentText, ["丟臉", "尷尬", "狼狽", "變態", "羞", "躲", "翻滾", "教練"])
    },
    {
      label: "人際",
      value: scoreKeywords(recentText, ["主管", "同事", "朋友", "家人", "教練", "他", "她", "關係", "喜歡", "在意"])
    },
    {
      label: "平靜",
      value: scoreKeywords(recentText, ["還好", "平靜", "舒服", "放鬆", "好一點", "沒事", "謝謝"])
    }
  ].map((item) => ({
    ...item,
    value: Math.min(95, Math.max(item.label === "平靜" ? 18 : 22, 18 + item.value * 14))
  }));

  const dominant = scores
    .slice()
    .sort((a, b) => b.value - a.value)[0];
  const secondary = scores
    .filter((item) => item.label !== dominant.label)
    .sort((a, b) => b.value - a.value)[0];
  const quote = getEchoQuote(recentMessages);

  return {
    primary: dominant.label,
    reflection: createEchoReflection(dominant.label, secondary.label, recentMessages.length, attachmentCount, quote),
    bars: scores
      .sort((a, b) => b.value - a.value)
      .slice(0, 3)
  };
}

function scoreKeywords(text, keywords) {
  return keywords.reduce((score, keyword) => score + (text.includes(keyword) ? 1 : 0), 0);
}

function getEchoQuote(messages) {
  const latestText = [...messages].reverse().find((message) => message.content?.trim())?.content.trim() || "";
  return latestText ? shortenText(latestText, 28) : "";
}

function createEchoReflection(primary, secondary, count, attachmentCount, quote) {
  const quoteText = quote ? `像「${quote}」這樣的句子，` : "";
  const mediaText = attachmentCount > 0 ? "你也用了照片或聲音把一些不容易說完的東西留下來。" : "";
  const countText = count > 1 ? `最近 ${count} 段樹洞裡，` : "這段樹洞裡，";

  const reflections = {
    疲憊: `${countText}${quoteText}反覆出現的是一種「已經撐很久」的感覺。餘聲看見的不是你太脆弱，而是你可能一直在把自己放到最後。${mediaText}`,
    焦慮: `${countText}${quoteText}比較明顯的是不安和預想很多結果的壓力。它不一定很大聲，但像背景音一樣一直耗著你。${mediaText}`,
    難堪: `${countText}${quoteText}最卡住的像是被看見狼狽、失控或不夠好的那一刻。這種難堪會反覆回放，不代表你小題大作。${mediaText}`,
    人際: `${countText}${quoteText}情緒常被某個人、某段關係或某個眼神牽動。餘聲會先把這些線索收好，不急著替你下結論。${mediaText}`,
    平靜: `${countText}${quoteText}有一些比較能喘氣的片刻。這不是叫你立刻變好，而是提醒你：你也有慢慢回到自己身上的時候。${mediaText}`
  };

  if (primary !== secondary && secondary) {
    return `${reflections[primary]} 旁邊也混著一點${secondary}，所以它不是單一情緒，而是一團需要慢慢拆開的東西。`;
  }

  return reflections[primary];
}

function resizeComposer() {
  elements.messageInput.style.height = "auto";
  elements.messageInput.style.height = `${Math.min(elements.messageInput.scrollHeight, 112)}px`;
}

function loadState() {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return structuredClone(seedState);
  try {
    return JSON.parse(raw);
  } catch {
    return structuredClone(seedState);
  }
}

function removeOldSeedData() {
  const beforeMessageCount = state.messages.length;
  const beforeMemoryCount = state.memories.length;

  state.messages = state.messages.filter((message) => {
    return message.content !== removedSeedUserMessage && message.content !== removedSeedAiMessage;
  });

  state.memories = state.memories.filter((memory) => {
    return memory.title !== removedSeedMemoryTitle && memory.summary !== removedSeedMemorySummary;
  });

  if (state.messages.length !== beforeMessageCount || state.memories.length !== beforeMemoryCount) saveState();
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function nextMonthDate() {
  const date = new Date();
  date.setMonth(date.getMonth() + 1);
  return date.toISOString().slice(0, 10);
}

function formatTime(value) {
  return new Intl.DateTimeFormat("zh-Hant-TW", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatDate(value) {
  return new Intl.DateTimeFormat("zh-Hant-TW", {
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

function shortenText(value, length) {
  return value.length > length ? `${value.slice(0, length)}...` : value;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
