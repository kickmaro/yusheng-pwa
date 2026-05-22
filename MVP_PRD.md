# 「餘聲」MVP PRD

> 有些話，說不出口。  
> 但它們從未真正消失。

## 1. 產品定位

「餘聲」是一個 AI 私密情緒空間 App，讓使用者把說不出口的話安全留下，並透過 AI 長期陪伴、理解與整理內心狀態。

核心不是「日記工具」，而是：

**只有使用者與 AI 知道的第二內心世界。**

## 2. MVP 目標

第一版目標是驗證三件事：

1. 使用者是否願意在 App 裡說出真實秘密與情緒。
2. AI 是否能讓使用者感覺「被理解」而不是只被回覆。
3. 使用者是否願意為「長期記憶與私密安全感」付費。

## 3. 目標使用者

### 主要族群

- 壓力大的上班族
- 深夜容易焦慮、失眠、反芻的人
- 不習慣向朋友或伴侶表達脆弱情緒的人
- 需要一個不被評價、不被打擾的私密空間的人

### 第一版最適合切入的人群

**25-40 歲、習慣獨處、願意使用 AI 工具、但不想把情緒公開給真人的人。**

## 4. MVP 核心功能

### 4.1 AI 樹洞對話

使用者可以輸入文字，向 AI 傾訴壓力、秘密、回憶或人際關係事件。

AI 回應原則：

- 先承接情緒，再整理事件。
- 不急著給建議。
- 不診斷使用者。
- 不使用醫療化語氣。
- 在適當時候幫使用者命名情緒。
- 可溫和追問，幫助使用者說得更完整。

第一版僅支援文字。語音與照片放到後續版本。

### 4.2 長期記憶

每次對話結束後，系統自動產生一份「記憶摘要」。

記憶摘要分為四類：

- 人生事件：例如離職、分手、家庭衝突、重要回憶。
- 重要人物：例如伴侶、家人、主管、朋友。
- 情緒模式：例如深夜焦慮、害怕被否定、工作壓力。
- 使用者偏好：例如希望 AI 少給建議、多陪伴。

使用者必須能看見、編輯、刪除被保存的記憶。

### 4.3 私密保護

第一版必須建立基本安全感：

- Face ID / Touch ID / 裝置密碼解鎖
- App 進入背景時自動模糊或遮蔽畫面
- 本機資料加密
- 首次啟動時明確說明資料使用方式
- 使用者可一鍵刪除所有本機資料

偽裝模式、隱藏入口、Secure Enclave 深度整合可放到第二階段。

### 4.4 情緒回顧

系統根據對話與使用者手動選擇產生情緒回顧。

第一版顯示：

- 今日主要情緒
- 本週情緒趨勢
- 常出現的壓力來源
- AI 生成的一段週回顧

語氣應像「回顧」與「陪伴」，不能像醫療報告。

### 4.5 時間膠囊

使用者可以寫一段話給未來的自己，設定指定日期開啟。

第一版支援：

- 建立時間膠囊
- 設定開啟日期
- 到期後顯示通知
- 開啟後可轉存為普通記錄

## 5. 第一版不做的事

以下功能不進 MVP：

- 語音輸入
- 圖片情緒辨識
- 本地 LLM
- 偽裝模式
- 隱藏入口
- 複雜人格測驗
- 醫療診斷
- 真人諮商媒合
- 社群功能

## 6. 核心使用流程

### 6.1 首次啟動

1. 顯示品牌頁與一句話定位。
2. 說明「餘聲不是醫療服務」。
3. 說明資料與記憶如何保存。
4. 建立 App 鎖定方式。
5. 進入主畫面。

### 6.2 傾訴流程

1. 使用者打開 App。
2. 通過 Face ID。
3. 進入「樹洞」對話畫面。
4. 使用者輸入一段話。
5. AI 回應並追問。
6. 對話結束後生成記憶摘要。
7. 使用者選擇保存、編輯或不保存。

### 6.3 回顧流程

1. 使用者進入「回聲」頁。
2. 查看本週情緒趨勢。
3. 查看 AI 生成回顧。
4. 可點進相關記憶或對話。

## 7. iOS SwiftUI 資訊架構

### 7.1 Tab 架構

第一版建議使用 4 個主要分頁：

- 樹洞
- 回聲
- 膠囊
- 記憶

設定入口放在右上角，不獨立成 Tab。

### 7.2 畫面清單

#### Onboarding

- `OnboardingView`
- `PrivacyIntroView`
- `AppLockSetupView`

#### 樹洞

- `HollowChatView`
- `MessageBubbleView`
- `MemorySuggestionSheet`
- `ConversationHistoryView`

#### 回聲

- `EchoDashboardView`
- `MoodTrendChartView`
- `WeeklyReflectionView`
- `StressSourceListView`

#### 膠囊

- `CapsuleListView`
- `CapsuleEditorView`
- `CapsuleDetailView`

#### 記憶

- `MemoryHomeView`
- `MemoryCategoryView`
- `MemoryDetailView`
- `MemoryEditView`

#### 設定

- `SettingsView`
- `PrivacySettingsView`
- `DataExportView`
- `DeleteAllDataView`
- `SubscriptionView`

## 8. 視覺與互動方向

### 8.1 整體風格

- 深色沉浸式
- 安靜、克制、低刺激
- 不使用可愛化或心理測驗式視覺
- 文字留白足夠，避免資訊壓迫

### 8.2 色彩方向

- 背景：近黑、深灰
- 主色：低飽和藍綠或冷白
- 警示色：低飽和紅，不刺眼
- 情緒圖表：避免過度鮮豔

### 8.3 互動細節

- App 進背景時立即遮蔽。
- 回到前景時重新驗證。
- 對話輸入區保持極簡。
- AI 回覆速度可加入細微打字狀態，但不要過度擬人化。

## 9. AI 設計

### 9.1 AI 角色

AI 是一個私密陪伴者，不是醫師、心理師或人生教練。

AI 應該：

- 承接
- 反映
- 整理
- 陪伴
- 溫和追問

AI 不應該：

- 診斷憂鬱症、焦慮症或任何疾病
- 承諾治療效果
- 命令使用者做重大決定
- 使用恐嚇式語氣
- 對自傷風險視而不見

### 9.2 Prompt 策略

系統 Prompt 應包含：

- 產品角色
- 回應語氣
- 禁止醫療診斷
- 自傷風險處理
- 長期記憶使用規則
- 回覆長度限制

### 9.3 記憶生成

每段對話可生成兩種輸出：

1. 對使用者可見的溫和摘要。
2. 給系統使用的結構化記憶資料。

結構化記憶範例：

```json
{
  "type": "emotion_pattern",
  "title": "深夜容易因工作反芻",
  "summary": "使用者常在深夜回想工作中的失誤與他人評價，並因此難以入睡。",
  "sensitivity": "high",
  "confidence": 0.82,
  "sourceConversationId": "conversation_123"
}
```

## 10. 安全與隱私

### 10.1 第一版安全策略

- 本機資料使用加密資料庫保存。
- 使用 iOS Keychain 保存加密金鑰。
- 使用 LocalAuthentication 啟用 Face ID / Touch ID。
- App 進入背景時遮蔽畫面。
- 使用者可以刪除單筆記憶、單段對話、全部資料。

### 10.2 OpenAI API 注意事項

如果使用 OpenAI API，產品內必須清楚說明：

- 哪些內容會送到 AI 服務處理。
- 是否會保存在本機。
- 是否會保存在伺服器。
- 使用者如何刪除資料。

### 10.3 高風險內容

若偵測到自傷、自殺、暴力或急迫危險內容，AI 應：

- 溫和承接
- 鼓勵使用者立刻聯絡可信任的人
- 提供當地緊急資源提示
- 不承諾單獨處理危機

## 11. 資料模型草案

### UserSettings

- `id`
- `hasCompletedOnboarding`
- `appLockEnabled`
- `createdAt`
- `updatedAt`

### Conversation

- `id`
- `title`
- `createdAt`
- `updatedAt`
- `moodTag`
- `summary`

### Message

- `id`
- `conversationId`
- `role`
- `content`
- `createdAt`

### MemoryItem

- `id`
- `type`
- `title`
- `summary`
- `sensitivity`
- `confidence`
- `sourceConversationId`
- `createdAt`
- `updatedAt`

### TimeCapsule

- `id`
- `title`
- `content`
- `openAt`
- `isOpened`
- `createdAt`
- `openedAt`

### MoodEntry

- `id`
- `date`
- `primaryMood`
- `intensity`
- `sourceConversationId`
- `createdAt`

## 12. 商業模式

### 免費版

- 基本 AI 樹洞對話
- 每月有限對話額度
- 基本本機保存
- 手動情緒標籤

### Premium

- 長期記憶
- 深度情緒回顧
- 時間膠囊
- 無限制秘密空間
- 進階隱私設定
- 後續本地 AI 模式

### 訂閱頁重點文案

Premium 不應主打「更多功能」，而是主打：

**讓餘聲更長期地理解你。**

## 13. 成功指標

### 啟動期

- Onboarding 完成率
- 第一次輸入完成率
- 首次對話後保存記憶比例

### 留存期

- D1 / D7 / D30 留存
- 每週平均對話次數
- 深夜使用比例
- 使用者主動回看記憶比例

### 付費期

- Premium 試用轉換率
- 長期記憶使用者的付費率
- 情緒回顧頁使用頻率

## 14. 開發里程碑

### Milestone 1：本機原型

- SwiftUI 基本架構
- 樹洞文字對話 UI
- 本機儲存對話
- Face ID 鎖定
- 背景遮蔽

### Milestone 2：AI 串接

- OpenAI API 對話
- 系統 Prompt
- 記憶摘要生成
- 記憶確認與保存

### Milestone 3：回顧與膠囊

- 情緒標籤
- 週回顧
- 時間膠囊
- 基本視覺化

### Milestone 4：付費與隱私強化

- Premium Gate
- 訂閱頁
- 資料刪除
- 資料匯出
- 安全與危機內容處理

## 15. 首版開發建議

技術選型：

- SwiftUI
- SwiftData 或 SQLite/SQLCipher
- LocalAuthentication
- Keychain
- OpenAI API

建議先用 SwiftData 快速驗證產品體驗；若確定要強化私密性，再導入 SQLCipher。

## 16. 產品文案方向

### 空狀態

今天有什麼話，是你還沒能說出口的？

### 記憶保存提示

餘聲注意到這段話可能對你很重要。要把它留在記憶裡嗎？

### 週回顧標題

這週的你，似乎一直在撐著。

### 刪除資料提示

刪除後，餘聲將不再記得這些內容。這個動作無法復原。

## 17. 需要進一步決定的問題

1. 第一版是否要完全本機保存，還是需要帳號同步？
2. 免費版 AI 對話額度如何限制？
3. 長期記憶是否預設開啟，或每次都讓使用者確認？
4. 是否要支援資料匯出？
5. 是否要先只做 iPhone，暫不支援 iPad？

