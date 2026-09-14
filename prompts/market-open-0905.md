# 排程指令：開盤後五分鐘股價

- **Cron（UTC）**：`5 1 * * *` → 台灣時間每天 09:05（台股 09:00 開盤）
- **推播**：關閉
- **需要的連接器**：無（只用 WebFetch 與 Artifact）

這份指令只動自選股表格裡台股那三列，其他一律不碰。

使用前把 `<YOUR_ARTIFACT_URL>` 換成你自己的。

---

只更新台股盤中價，其他區塊一律不要動。全部繁體中文。時區 Asia/Taipei。無人看顧，不要提問。

目標頁面：`<YOUR_ARTIFACT_URL>`

【第一步】用 Bash 執行 `TZ=Asia/Taipei date "+%Y-%m-%d %H:%M %A"`。容器預設是 UTC，會差八小時；所有時間寫入都用台灣時間。**若今天是週六或週日，或台灣時間不在 09:00–13:35 之間，就什麼都不要做，直接回覆「非交易時段，略過」。**

【第二步】用 Artifact 工具 action:"read"、url 上面那個網址，取得目前 HTML。**除了自選股表格裡台股那三列的數字與資料時間、表格下方的 `class="note"`、以及 `id="updated"` 這幾處之外，整份檔案一個字都不要改**——CSS 六組色板、節慶橫條與 FEST_ART 圖樣、各面板 SVG、時鐘 script、天氣 script（COUNTIES、KH 高雄 38 區座標表、skyOf、adviceFor、render、buildPicker 等）、最後兩段 script（Google 日曆即時重抓、今日經文 VERSES 抽籤）、經文區塊與 `<span id="voverride">`，全部原樣保留。天氣與行程不歸這個排程管。

【第三步：抓台股盤中價】用 Google Finance，一檔一個網址：

- `https://www.google.com/finance/quote/2330:TPE?hl=zh-TW`
- `https://www.google.com/finance/quote/0050:TPE?hl=zh-TW`
- `https://www.google.com/finance/quote/2454:TPE?hl=zh-TW`

WebFetch 的 prompt 一定要寫成這樣，否則抽取模型會抓到頁面下方「相關股票」的別檔數字：

```
This page is the quote page for THIS ticker. Report ONLY the main headline
quote at the top of the page — not any related or comparison stock listed
further down. Give: the large price number, the change, the percent change,
the previous close, and the timestamp line directly under the price.
Quote the timestamp verbatim.
```

**每一檔都要做這兩項合理性檢查**，任何一項不過就放棄那一檔、保留頁面上原本的數字與標籤：

- (a) 時間戳必須是今天、而且在 09:00–13:35 之間（例如「9月14日, 上午09:04:12 [GMT+8]」）。出現別的日期就是抓錯了。
- (b) 價格與 previous close 的差距要合理（台股單日漲跌幅上限 10%），而且 previous close 要跟頁面表格上原本那檔的價格接近。

【第四步：改哪些地方】

1. 台股三列（台積電 2330、元大台灣50 0050、聯發科 2454）的價格、漲跌、幅度換成新抓到的數字。上漲整列 `class="up"`、下跌 `class="dn"`（台股慣例紅漲綠跌）。資料時間欄寫「<月>/<日> <時>:<分> 盤中」。
2. **NVDA 與 GOOGL 兩列完全不要動**（美股此刻休市）。表格順序維持台股在上、美股在下。
3. 表格下方 `class="note"`：前兩三句用白話寫開盤後的盤面（哪檔漲哪檔跌、幅度），明講這是幾點幾分的盤中價。**不要寫任何會過期的句子**（例如「尚未開盤」）。結尾固定保留這幾句：盤中價取自 Google Finance，收盤後改用證交所官方每日成交資訊。漲跌顏色照台股慣例：紅漲綠跌。價格為公開行情資訊，非投資建議。
4. `id="updated"` 改成「資料更新於 <月>/<日> <時>:<分> · 台股盤中」。

【第五步：發佈】用 Artifact 工具發佈，帶 url 參數指向上面那個網址。不要傳 favicon、**不要傳 capabilities**（省略會沿用已儲存的 Google Calendar 連接器授權，傳空的會把頁面即時讀取行程的功能關掉）、不要改標題。若發佈被拒（有人在你之後改過），先讀回最新版、只把你的股價更動合併進去再發佈一次。

回覆只要一句話：三檔開盤後的走勢。
