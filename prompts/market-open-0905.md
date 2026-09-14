# 排程指令：開盤後五分鐘股價

- **Cron（UTC）**：`5 1 * * *` → 台灣時間每天 09:05（台股 09:00 開盤）
- **推播**：關閉
- **需要的連接器**：無（只用 WebFetch 與 Artifact）

這份指令只寫資料庫裡 `stocks`、`stockNote`、`updated` 三個欄位，不碰 HTML、不發佈 artifact。

使用前把 `<YOUR_ARTIFACT_URL>` 換成你自己的。

---

只更新台股盤中價。全部繁體中文。時區 Asia/Taipei。無人看顧，不要提問。

**這個排程不碰 HTML，也不發佈 artifact。**頁面會自己去讀資料庫，你只要把新數字寫進那份文件就好。

目標 artifact：`<YOUR_ARTIFACT_URL>`

【第一步】用 Bash 執行 `TZ=Asia/Taipei date "+%Y-%m-%d %H:%M %A"`。容器預設是 UTC，會差八小時。**若今天是週六或週日，或台灣時間不在 09:00–13:35 之間，就什麼都不要做，直接回覆「非交易時段，略過」。**

【第二步：抓盤中價】用 Google Finance，一檔一個網址：

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

**每一檔都要做這兩項合理性檢查**，任何一項不過就放棄那一檔、沿用資料庫裡原本那一列：

- (a) 時間戳必須是今天、而且在 09:00–13:35 之間（例如「9月14日, 上午09:04:12 [GMT+8]」）。出現別的日期就是抓錯了。
- (b) 價格與 previous close 的差距在 10% 以內（台股單日漲跌幅上限），且 previous close 要跟資料庫裡原本那一列的價格接近。

【第三步：讀目前的資料】用 Artifact 工具 action:"read_db"、db_op:"get"、url 上面那個、collection `brief`、doc_id `latest`。記下它的 `version` 與 `stocks` 陣列現在的內容（五列：台積電 2330、元大台灣50 0050、聯發科 2454、NVDA、GOOGL）。

【第四步：寫回去】用 Artifact 工具 action:"write_db"、db_op:"update"、collection `brief`、doc_id `latest`、if_version 帶上剛剛讀到的 version，data 只放這三個欄位：

- `stocks`：完整的五列陣列（update 對陣列是整個取代，所以五列都要寫）。台股三列換成新數字，**NVDA 與 GOOGL 兩列原封不動照抄**。每一列的格式是
  `{"name":"台積電 2330","price":"2,380.00","chg":"−30.00","pct":"−1.24%","when":"9/14 09:05 盤中","dir":"dn"}`
  價格用千分位逗號；漲跌與幅度的負號用「−」（U+2212）不是減號；`dir` 上漲填 `up`、下跌填 `dn`、平盤填空字串。
- `stockNote`：兩三句白話寫開盤後的盤面（哪檔漲哪檔跌、幅度），明講這是幾點幾分的盤中價。**不要寫任何會過期的句子**（例如「尚未開盤」）。結尾固定接這三句：盤中價取自 Google Finance，收盤後改用證交所官方每日成交資訊。漲跌顏色照台股慣例：紅漲綠跌。價格為公開行情資訊，非投資建議。
- `updated`：`"<月>/<日> <時>:<分> · 台股盤中"`

**不要動 counties、span、fest、mail、agenda、verse 這幾個欄位**，也不要用 db_op:"set"（那會把整份文件換掉）。

回覆只要一句話：三檔開盤後的走勢。
