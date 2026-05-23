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
  helpPanelClose: document.querySelector("#helpPanelClose")
};

init();

async function init() {
  elements.todayLine.textContent = new Intl.DateTimeFormat("zh-Hant-TW", {
    month: "long",
    day: "numeric",
    weekday: "long"
  }).format(new Date());

  elements.capsuleDate.min = new Date().toISOString().slice(0, 10);

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

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) showLock();
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

  const response = await createAiResponse(aiContent, state.messages);
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

async function createAiResponse(content, messages) {
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
        memories: state.memories.slice(0, 6).map(m => `[${m.type}] ${m.title}：${m.summary}`)
      })
    });

    if (!response.ok) throw new Error("AI server unavailable");
    const data = await response.json();
    if (!data.text) throw new Error("AI response is empty");
    return data.text.trim();
  } catch {
    return createLocalResponse(content, messages);
  } finally {
    setComposerBusy(false);
  }
}

function createLocalResponse(content, messages) {
  const text = content.trim();
  const previousUserText = [...messages]
    .reverse()
    .filter((message) => message.role === "user")
    .slice(1, 2)[0]?.content || "";
  const latestAiReplies = messages
    .filter((message) => message.role === "ai")
    .slice(-4)
    .map((message) => message.content);

  if (isCorrection(text)) {
    return pickFreshReply(
      [
        "對不起，我剛剛講偏了。你不是想被鼓勵，你只是希望有人懂：那一刻真的很難堪。",
        "嗯，是我剛剛太快想安慰你了。你不是要振作，你是在說那個畫面讓你很受不了。",
        "你說得對。這不是要不要變好的問題，是那一幕一直卡在心裡，想到就很想把自己藏起來。",
        "我懂了。你不是在討拍，也不是在找答案，你只是需要有人說一句：那真的很尷尬，你會在意很正常。"
      ],
      latestAiReplies
    );
  }

  if (isEmbarrassingTrainingMoment(text)) {
    return pickFreshReply(
      [
        "天啊，那真的會超尷尬。你沒有很怪，是那個情境太難堪了。累到控制不住，旁邊又剛好是教練，誰都會想躲起來。",
        "我懂你為什麼一直想那個畫面。不是翻滾本身多嚴重，是你在一個想表現正常的地方，突然變得很狼狽。",
        "這個不是變態，真的不是。比較像是身體累到先投降了，但你的自尊還站在那裡，所以才會那麼尷尬。",
        "如果我是你，我也會一直回放。那不是你小題大作，是那一刻太赤裸，太像被人看到自己撐不住的樣子。"
      ],
      latestAiReplies
    );
  }

  if (isCrushConfession(text, previousUserText)) {
    return pickFreshReply(
      [
        "哇，這句有心動到。你不是隨便講講，是那種想到他就會忍不住再說一次「我真的很喜歡」的喜歡吧。",
        "天啊，這種喜歡很可愛，也很折磨。尤其對方又是教練，會更容易把每個眼神、每句話都放大。",
        "我懂，喜歡到想講第二次的時候，心裡其實已經藏不住了。你現在不是在亂想，你是真的被他牽動到了。",
        "這種喜歡會讓人有點亮起來，也會有點慌。你可以先不用壓下去，讓我陪你偷偷開心一下。"
      ],
      latestAiReplies
    );
  }

  if (isShortEmotionalReply(text)) {
    return pickFreshReply(
      [
        "嗯，我在。你不用把話整理好，我先陪你把這口氣喘完。",
        "真的很不好受吧。先不要急著講清楚，你現在這樣說就已經夠了。",
        "那一定很悶。你先不用努力變平靜，我就在這裡聽你罵、聽你碎念都可以。",
        "我懂，現在要你說清楚太累了。你可以只丟一句話，我會接住。"
      ],
      latestAiReplies
    );
  }

  if (text.includes("為什麼") || text.includes("怎麼會") || text.includes("憑什麼")) {
    return pickFreshReply(
      [
        "這個「為什麼」聽起來很委屈。你不是在無理取鬧，你是真的覺得那樣對你很不公平。",
        "嗯，這句話裡有不甘心。你可以先不用客氣，在這裡不用替任何人留面子。",
        "你心裡那句可能是：怎麼可以這樣對我。老實說，會這樣想很正常。",
        "你不用急著把氣壓下去。先站在你這邊一下也沒關係，你本來就可以覺得不爽。"
      ],
      latestAiReplies
    );
  }

  const responseGroups = [
    {
      matches: ["喜歡", "心動", "暈船", "在意", "想他", "想她"],
      replies: [
        "你講「喜歡」的時候，感覺不是普通欣賞，是那種心裡會偷偷亮一下的喜歡。",
        "這種心動很難假裝沒有吧。明明想冷靜一點，但只要想到他，就還是會被拉過去。",
        "我先站在你這邊偷笑一下。喜歡一個人本來就會讓人變得很不淡定，這不丟臉。"
      ]
    },
    {
      matches: ["出國", "國外", "旅行", "旅遊", "離開", "逃走"],
      replies: [
        "想離開一下很正常。你不是沒責任感，你只是太久沒有真正放鬆了，心裡才會一直想往遠一點的地方跑。",
        "我懂那種想飛走的感覺。不是一定要玩得多開心，是想有幾天不用當那個什麼都要撐住的人。",
        "如果那個地方讓你想到放鬆，那我反而覺得你很誠實。你只是知道自己需要一點空氣。"
      ]
    },
    {
      matches: ["按", "按摩", "筋", "肩", "背", "痠", "痛", "身體"],
      replies: [
        "想讓身體舒服一點，這沒有什麼好羞愧的。你可能真的繃太久了，身體只是想被好好照顧一下。",
        "嗯，這很像是身體在跟你求救。你不用罵自己想放鬆，你已經撐很多了。",
        "如果你現在只想讓身體鬆開一點，那很合理。你不是放縱，你是在替自己找一點活過來的感覺。"
      ]
    },
    {
      matches: ["睡", "失眠", "醒", "晚上", "深夜", "安靜"],
      replies: [
        "晚上最討厭的就是這樣，外面安靜了，腦袋反而開始吵。你不用一個人跟它打，我陪你待一下。",
        "那種安靜其實一點都不安靜，對吧。你已經很累了，還要被念頭追著跑，真的很煩。",
        "睡不著不是你不夠放鬆，是心裡有東西還沒被放下來。今晚先不要怪自己。"
      ]
    },
    {
      matches: ["工作", "主管", "公司", "同事", "加班", "案子", "壓力"],
      replies: [
        "你真的撐很久了。工作最消耗人的，不只是事情多，是每天都要裝作自己還扛得住。",
        "聽起來你忍了一段時間。先不管要怎麼解決，今天至少可以承認：你真的很煩，這不是你的問題。",
        "如果你在工作裡一直要忍住，那回到這裡就不用再忍得那麼漂亮。想抱怨就抱怨，我站你這邊。"
      ]
    },
    {
      matches: ["不能說", "秘密", "不敢說", "說不出口", "丟臉"],
      replies: [
        "那就先不要說完整。你可以只說一半，我不會逼你把傷口全部攤開。",
        "有些話說不出口，不是你懦弱，是它真的太靠近心裡了。",
        "你不用急著坦白什麼。這裡不是審問你，是讓你終於可以不用演得那麼正常。"
      ]
    },
    {
      matches: ["累", "撐", "煩", "空", "麻木", "厭世"],
      replies: [
        "你不是怪，你只是累到有點不像平常的自己了。這種時候先不要罵自己，好嗎。",
        "如果累到反應都變得很奇怪，那真的會嚇到。可是那不是你壞掉了，是你太久沒有被好好接住。",
        "你剛剛那個笑，聽起來像是撐到漏氣。不是好笑，是你真的太累了。"
      ]
    }
  ];

  const matchedGroup = responseGroups.find((group) => group.matches.some((keyword) => text.includes(keyword)));
  const replies = matchedGroup?.replies || [
    previousUserText
      ? "我有接到。你不是在亂講，你是在一點一點把心裡卡住的地方拿出來。"
      : "我在。你不用先把事情說清楚，也不用把自己講得很合理。先丟在這裡就好。",
    "嗯，我有收到。這句話不用馬上變成答案，它先被好好聽見就夠了。",
    "慢慢來。你現在說得亂也沒關係，我不會因為你亂就離開。"
  ];

  return pickFreshReply(replies, latestAiReplies);
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
    if (attachment.type === "image") return "使用者在這則樹洞裡留下了一張照片。你目前不需要解讀照片，只要溫柔承接他願意留下這個片段。";
    return `使用者在這則樹洞裡留下了一段 ${formatDuration(attachment.duration || 0)} 的錄音。你目前不能聽見內容，只要承接他願意用聲音留下這件事。`;
  });

  return [content || "我留下了一個沒有文字的片段。", ...notes].join("\n");
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

function isCrushConfession(text, previousUserText) {
  const hasCrushWord = ["喜歡", "心動", "暈船", "在意", "想他", "想她"].some((keyword) => text.includes(keyword));
  const continuesCrush = ["真的", "很喜歡", "好喜歡", "超喜歡"].some((keyword) => text.includes(keyword)) &&
    ["喜歡", "心動", "暈船", "教練"].some((keyword) => previousUserText.includes(keyword));
  return hasCrushWord || continuesCrush;
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

function isEmbarrassingTrainingMoment(text) {
  const hasTrainingContext = ["教練", "運動", "健身", "訓練"].some((keyword) => text.includes(keyword));
  const hasEmbarrassingBodyAction = ["躺", "翻滾", "笑", "累到", "狼狽", "丟臉", "尷尬", "變態"].some((keyword) =>
    text.includes(keyword)
  );
  return hasTrainingContext && hasEmbarrassingBodyAction;
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

function switchTab(name) {
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.toggle("active", screen.dataset.screen === name);
  });
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === name);
  });
}

function render() {
  renderMessages();
  renderEcho();
  renderCapsules();
  renderMemories();
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
  elements.primaryMood.textContent = mood.primary;
  elements.weeklyReflection.textContent = mood.reflection;
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
