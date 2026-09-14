# 排程指令：收盤後五分鐘股價

- **Cron（UTC）**：`35 5 * * *` → 台灣時間每天 13:35（台股 13:30 收盤）
- **推播**：關閉
- **需要的連接器**：無（只用 WebFetch 與 Artifact）

收盤後五分鐘證交所官方數字通常還沒公布，所以這份指令先試官方、抓不到就退回 Google Finance 並標「待官方確認」，交給 16:00 那輪覆蓋。

使用前把 `<YOUR_ARTIFACT_URL>` 換成你自己的。

---

只更新台股收盤價，其他區塊一律不要動。全部繁體中文。時區 Asia/Taipei。無人看顧，不要提問。

目標頁面：`<YOUR_ARTIFACT_URL>`

【第一步】用 Bash 執行 `TZ=Asia/Taipei date "+%Y-%m-%d %H:%M %A"` 與 `TZ=Asia/Taipei date "+%Y%m%d"`。容器預設是 UTC，會差八小時；所有時間寫入都用台灣時間。**若今天是週六或週日就什麼都不要做，直接回覆「非交易日，略過」。**

【第二步】用 Artifact 工具 action:"read"、url 上面那個網址，取得目前 HTML。**除了自選股表格裡台股那三列的數字與資料時間、表格下方的 `class="note"`、以及 `id="updated"` 這幾處之外，整份檔案一個字都不要改**——CSS 六組色板、節慶橫條與 FEST_ART 圖樣、各面板 SVG、時鐘 script、天氣 script（COUNTIES、KH 高雄 38 區座標表、skyOf、adviceFor、render、buildPicker 等）、最後兩段 script（Google 日曆即時重抓、今日經文 VERSES 抽籤）、經文區塊與 `<span id="voverride">`，全部原樣保留。天氣與行程不歸這個排程管。

【第三步：抓收盤價】台股 13:30 收盤，此刻是收盤後五分鐘。**先試證交所官方，沒有再退回 Google Finance。**

**A. 證交所官方每日成交資訊**（把 `<YYYYMMDD>` 換成第一步取得的今天日期），一檔一個網址：

- `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=<YYYYMMDD>&stockNo=2330`
- `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=<YYYYMMDD>&stockNo=0050`
- `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=<YYYYMMDD>&stockNo=2454`

prompt 寫：`Report the LAST row of the data array verbatim: date, open, high, low, close, change.`
回傳 date 是民國格式（例如 115/09/14）。欄位順序：日期, 成交股數, 成交金額, 開盤價, 最高價, 最低價, 收盤價, 漲跌價差, 成交筆數。漲跌幅自己算：漲跌價差 ÷（收盤價 − 漲跌價差）。
**只有最後一列的日期就是今天**，才採用它，資料時間欄寫「<月>/<日> 收盤 · 官方」。收盤後五分鐘官方通常還沒公布，抓不到是正常的，直接走 B。

**B. 官方還沒有今天資料的那幾檔，改用 Google Finance 的最終價：**

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

**合理性檢查**，不過就放棄那一檔、保留頁面上原本的數字與標籤：時間戳必須是今天且不早於 13:25；價格與 previous close 的差距在 10% 以內，且 previous close 要跟頁面上原本那檔的價格接近。
採用時資料時間欄寫「<月>/<日> 收盤 · 待官方確認」。16:00 那輪排程會用官方數字覆蓋。

【第四步：改哪些地方】

1. 台股三列（台積電 2330、元大台灣50 0050、聯發科 2454）換成收盤數字。上漲整列 `class="up"`、下跌 `class="dn"`（台股慣例紅漲綠跌）。
2. **NVDA 與 GOOGL 兩列完全不要動**。表格順序維持台股在上、美股在下。
3. 表格下方 `class="note"`：前兩三句用白話寫今天台股收盤的走勢（哪檔漲哪檔跌、幅度、整天強弱）。**不要寫任何會過期的句子**。結尾固定保留這幾句：盤中價取自 Google Finance，收盤後改用證交所官方每日成交資訊。漲跌顏色照台股慣例：紅漲綠跌。價格為公開行情資訊，非投資建議。
4. `id="updated"` 改成「資料更新於 <月>/<日> <時>:<分> · 台股收盤」。

【第五步：發佈】用 Artifact 工具發佈，帶 url 參數指向上面那個網址。不要傳 favicon、**不要傳 capabilities**（省略會沿用已儲存的 Google Calendar 連接器授權，傳空的會把頁面即時讀取行程的功能關掉）、不要改標題。若發佈被拒（有人在你之後改過），先讀回最新版、只把你的股價更動合併進去再發佈一次。

回覆只要一句話：今天台股三檔收盤的結果，以及用的是官方數字還是待確認的數字。
