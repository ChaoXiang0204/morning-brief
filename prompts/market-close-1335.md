# 排程指令：收盤後五分鐘股價

- **Cron（UTC）**：`35 5 * * *` → 台灣時間每天 13:35（台股 13:30 收盤）
- **推播**：關閉
- **需要的連接器**：無（只用 WebFetch 與 Artifact）

收盤後五分鐘證交所官方數字通常還沒公布，所以先試官方、抓不到就退回 Google Finance 並標「待官方確認」，交給 16:00 那輪覆蓋。

使用前把 `<YOUR_ARTIFACT_URL>` 換成你自己的。

---

只更新台股收盤價。全部繁體中文。時區 Asia/Taipei。無人看顧，不要提問。

**這個排程不碰 HTML，也不發佈 artifact。**頁面會自己去讀資料庫，你只要把新數字寫進那份文件就好。

目標 artifact：`<YOUR_ARTIFACT_URL>`

【第一步】用 Bash 執行 `TZ=Asia/Taipei date "+%Y-%m-%d %H:%M %A"` 與 `TZ=Asia/Taipei date "+%Y%m%d"`。容器預設是 UTC，會差八小時。**若今天是週六或週日就什麼都不要做，直接回覆「非交易日，略過」。**

【第二步：抓收盤價】台股 13:30 收盤，此刻是收盤後五分鐘。**先試證交所官方，沒有再退回 Google Finance。**

**A. 證交所官方每日成交資訊**（把 `<YYYYMMDD>` 換成今天日期），一檔一個網址：

- `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=<YYYYMMDD>&stockNo=2330`
- `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=<YYYYMMDD>&stockNo=0050`
- `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=<YYYYMMDD>&stockNo=2454`

prompt 寫：`Report the LAST row of the data array verbatim: date, open, high, low, close, change.`
回傳 date 是民國格式（例如 115/09/14）。欄位順序：日期, 成交股數, 成交金額, 開盤價, 最高價, 最低價, 收盤價, 漲跌價差, 成交筆數。漲跌幅自己算：漲跌價差 ÷（收盤價 − 漲跌價差）。
**只有最後一列的日期就是今天**才採用，`when` 欄寫「<月>/<日> 收盤 · 官方」。收盤後五分鐘官方通常還沒公布，抓不到是正常的，直接走 B。

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

  若回 HTTP 429（rate limited），等 60 秒再抓下一檔，不要放棄。
  **合理性檢查**，不過就放棄那一檔、沿用資料庫裡原本那一列：時間戳必須是今天且不早於 13:25；價格與 previous close 的差距在 10% 以內，且 previous close 要跟資料庫裡原本那一列的價格接近。
  採用時 `when` 欄寫「<月>/<日> 收盤 · 待官方確認」。16:00 那輪排程會用官方數字覆蓋。

【第三步：讀目前的資料】用 Artifact 工具 action:"read_db"、db_op:"get"、url 上面那個、collection `brief`、doc_id `latest`。記下它的 `version` 與 `stocks` 陣列現在的內容。

【第四步：寫回去】用 Artifact 工具 action:"write_db"、db_op:"update"、collection `brief`、doc_id `latest`、if_version 帶上剛剛讀到的 version，data 只放這三個欄位：

- `stocks`：完整的五列陣列（update 對陣列是整個取代，所以五列都要寫）。台股三列換成收盤數字，**NVDA 與 GOOGL 兩列原封不動照抄**。每一列的格式是
  `{"name":"台積電 2330","price":"2,380.00","chg":"−30.00","pct":"−1.24%","when":"9/14 收盤 · 待官方確認","dir":"dn"}`
  價格用千分位逗號；漲跌與幅度的負號用「−」（U+2212）不是減號；`dir` 上漲填 `up`、下跌填 `dn`、平盤填空字串。
- `stockNote`：兩三句白話寫今天台股收盤的走勢（哪檔漲哪檔跌、幅度、整天強弱）。**不要寫任何會過期的句子**。結尾固定接這三句：盤中價取自 Google Finance，收盤後改用證交所官方每日成交資訊。漲跌顏色照台股慣例：紅漲綠跌。價格為公開行情資訊，非投資建議。
- `updated`：`"<月>/<日> <時>:<分> · 台股收盤"`

**不要動 counties、span、fest、mail、agenda、verse 這幾個欄位**，也不要用 db_op:"set"（那會把整份文件換掉）。

回覆只要一句話：今天台股三檔收盤的結果，以及用的是官方數字還是待確認的數字。
