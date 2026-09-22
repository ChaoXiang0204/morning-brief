# 晨報系統（純程式碼版）

早上打開一頁就知道今天該知道的事：天氣、自選股、一節經文。
整頁的配色會跟著天氣走——晴天偏暖橘、雨天偏灰藍、夜裡轉深。

這一版**完全不依賴 Claude**。資料由 GitHub Actions 定時抓、寫進 `data.json`、
commit 回 repo；Vercel 偵測到 commit 就自動重新部署。頁面打開時去讀 `data.json`。

---

## 檔案

```
index.html                     整個頁面。單一檔案，CSS 與 JS 都內嵌，沒有外部相依
data.json                      資料。由 scripts/update.mjs 重寫，不要手改
scripts/update.mjs             抓資料的腳本。Node 18 以上，只用內建 fetch，零套件
.github/workflows/update.yml   排程。cron 一天八次
LICENSE                        MIT
```

沒有 `package.json`、沒有 `node_modules`、沒有建置步驟。這是刻意的：
靜態主機直接把 `index.html` 丟出去就會動。

---

## 資料流

```
GitHub Actions（cron）
      ↓  node scripts/update.mjs
氣象署 / 證交所 / Yahoo Finance
      ↓  寫 data.json
git commit + push
      ↓  Vercel 偵測到 commit
重新部署
      ↓  使用者打開頁面
index.html  →  fetch('./data.json')  →  畫面更新
```

關鍵是**資料與畫面分開**。`index.html` 裡本來就有一份靜態快照，
所以就算 `data.json` 還沒生成、或抓資料整個掛掉，頁面也不會空白，
只是數字舊一點。腳本同理：任何一個來源失敗就沿用 `data.json` 裡原本那一段，
絕對不會把好資料覆蓋成空的。

---

## 更新時機

cron 寫在 `.github/workflows/update.yml`，**一律是 UTC**，台灣時間要減八小時。

| 台灣時間 | cron（UTC） | 這一輪做什麼 |
|---|---|---|
| 07:00 每天 | `0 23 * * *` | 天氣、節慶、美股昨夜收盤 |
| 09:05 平日 | `5 1 * * 1-5` | 開盤後五分鐘的台股盤中價 |
| 10:00 平日 | `0 2 * * 1-5` | 盤中價 |
| 11:00 平日 | `0 3 * * 1-5` | 盤中價 |
| 12:00 平日 | `0 4 * * 1-5` | 盤中價 |
| 13:00 平日 | `0 5 * * 1-5` | 盤中價 |
| 13:35 平日 | `35 5 * * 1-5` | 收盤價（官方還沒出就先用即時最終價） |
| 16:00 平日 | `0 8 * * 1-5` | 用證交所官方數字覆蓋 |

每一輪都會重抓天氣。台股只在交易時段抓，非交易時段沿用上一次的數字，
所以週末打開看到的是週五收盤——這是對的，不是壞掉。

> GitHub 的 cron 在整點附近很塞，實際觸發常常晚個 5–15 分鐘，尖峰時甚至會直接跳過一輪。
> 這是 GitHub 公開說明的限制，不是設定寫錯。想要準時只能自己架機器跑。

---

## 經文怎麼選的

`index.html` 內建 51 節四福音經文（和合本，公有領域），**完全在瀏覽器裡決定**，
不經過任何排程，所以就算 Actions 全掛了經文照樣每天換。

作法是：以 51 天為一輪，用「第幾輪」當種子，
把 0–50 這副牌用 Fisher–Yates 洗過一次，再照今天在這一輪的位置抽一張。

```
day   = 從 1970-01-01 算到今天的天數
cycle = floor(day / 51)        ← 第幾輪
pos   = day - cycle * 51       ← 這一輪的第幾天
order = 用 cycle 當種子洗出來的順序
今天的經文 = V[order[pos]]
```

這樣同時滿足三件事：同一天不管刷新幾次都一樣（不會一直跳）、
每天跳到不同書卷（不是照順序讀下去）、一輪 51 天之內不重複。
跨輪的接縫也處理了——如果新一輪的第一張剛好等於上一輪的最後一張，就把它挪到後面。

隨機數用的是 mulberry32，因為 `Math.random()` 每次刷新都不一樣，做不到「一天固定一節」。

---

## 天氣

中央氣象署開放資料 `F-C0032-001`（全台 22 縣市 36 小時天氣預報），一次呼叫拿到全部縣市。
腳本只取第一個時段（最近的六小時）。

縣市下拉選單選過一次就會記在瀏覽器裡，之後打開都用那個地點。
高雄市另外做了 38 個行政區的座標，可以選到區。

臺北市、臺中市、臺南市、臺東縣用的是「臺」不是「台」——氣象署回傳就是這樣寫，
`data.json` 的鍵必須跟 `index.html` 裡的縣市清單完全一致，否則對不起來。

---

## 股價

**台股盤中**用證交所自己的即時報價 `mis.twse.com.tw/stock/api/getStockInfo.jsp`。
`z` 欄是最新成交價，沒有成交時是 `-`，這時退回最佳買價 `b`。
`y` 欄是昨收，漲跌自己算。有做合理性檢查：跟昨收差超過 10.5% 就當抓錯（台股單日漲跌幅上限 10%），
放棄那一檔、沿用舊的。

**台股收盤**用證交所每日成交資訊 `STOCK_DAY`。日期是民國格式，
回傳的是整個月的每日資料，所以取最後一列。只有最後一列真的是今天才採用。
官方數字收盤後常常要等到下午才公布，所以 13:35 那輪抓不到是正常的，
會先用即時最終價標「待官方確認」，交給 16:00 那輪覆蓋。

新舊兩個網址路徑（`/rwd/zh/afterTrading/` 與 `/exchangeReport/`）都會試。

**美股**用 Yahoo Finance 的圖表端點 `query1.finance.yahoo.com/v8/finance/chart/`，
不需要金鑰。`query1` 偶爾會擋，會自動換 `query2` 再試一次。

> 這三個來源都是沒有正式文件的公開端點，隨時可能改或擋。
> 真的壞掉時頁面不會空白，只會停在最後一次成功的數字——`data.json` 的 `when` 欄會告訴你那是什麼時候的。

---

## 節慶

四個教會節期是用算的，不是查表：

- 復活節：Anonymous Gregorian 演算法
- 受難日：復活節減 2 天
- 五旬節：復活節加 49 天
- 感恩節：11 月第四個週四

（2026 年可以驗算：復活節 4/5、受難日 4/3、五旬節 5/24、感恩節 11/26。）

國定假日與固定日期的節日寫在 `FIXED` 陣列裡。
**農曆節日（春節、端午、中秋、元宵、七夕、中元、重陽）沒有公式，是查表**，
表只填到 2028 年，在 `scripts/update.mjs` 的 `LUNAR` 常數。用完要自己往下加。

同一天同時是教會節期與民俗節日時，教會節期優先（例如 12/25 顯示聖誕節而不是行憲紀念日）。
只有「今天就是」才顯示橫條，不做倒數。

---

## 自己架一份

### 1. 拿氣象署的授權碼

到 <https://opendata.cwa.gov.tw/> 註冊，在「取得授權碼」那頁申請。
免費，格式長得像 `CWA-XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX`。

### 2. 建 GitHub repo

把這個資料夾的全部檔案（含 `.github` 資料夾）傳上去。
Repo 設 Public，Vercel 免費版才能接。

> `.github` 是隱藏資料夾，Windows 檔案總管預設看不到。
> 上傳前先在檔案總管的「檢視」把「隱藏的項目」打勾，不然 workflow 不會跟著上去、排程也就不會跑。
>
> 如果你手上這份的根目錄有一個叫
> 「這個檔案要放到 .github-workflows 裡 (update.yml).yml」的檔案，
> 表示 `.github` 沒有一起複製過來。最省事的作法是不要在電腦上建資料夾，
> 直接在 GitHub 網頁上按 **Add file → Create new file**，
> 在檔名欄位整串打 `.github/workflows/update.yml`（斜線打下去會自動變成資料夾），
> 再把那個檔案的內容整個貼進去 Commit。

### 3. 把授權碼存成 Secret

**絕對不要把授權碼寫進任何檔案再 push。** Public repo 的歷史刪不掉，
一旦推上去就等於公開，只能回氣象署重新申請一組。

在 repo 頁面：Settings → Secrets and variables → Actions → New repository secret

- Name：`CWA_KEY`
- Secret：貼上你的授權碼

### 4. 讓 Actions 可以 push

Settings → Actions → General → 最下面的 Workflow permissions →
選 **Read and write permissions** → Save。

沒設這個的話腳本會跑成功但 push 會被拒絕，`data.json` 永遠不會更新。

### 5. 先手動跑一次

Actions 分頁 → 左邊選「更新晨報資料」→ 右邊 **Run workflow**。

跑完點進去看 log。正常的話會看到類似：

```
[9/16 12:07] 天氣：22 個縣市 · 白天 06 時–18 時
[9/16 12:07] 台股盤中：台積電 2330 2,390.00、元大台灣50 0050 107.25、聯發科 2454 4,625.00
[9/16 12:07] 美股：NVDA 212.17、GOOGL 344.98
[9/16 12:07] 已寫入 data.json
```

有哪一行寫「沿用舊的」就是那個來源這次沒抓到，log 後面會講原因。
全部都沿用舊的、又看到 `HTTP 403`，通常是端點擋了 GitHub Actions 的機房 IP。

### 6. 接 Vercel

到 <https://vercel.com/>，用 GitHub 帳號登入 → Add New → Project →
選這個 repo → Framework Preset 選 **Other** → Deploy。

不用填 Build Command、不用填 Output Directory、不用填環境變數——
Vercel 只是把靜態檔案丟出去，抓資料是 GitHub Actions 在做。

匯入時確認選到的是**這個** repo，別選成同帳號下的別份。

---

## 在 Claude Code 裡開發

開 Claude Code → 左下角那個資料夾按鈕（顯示「No folder」的地方）→
選 `Documents\morning-brief-code`。

第一次先跑設定，它會把 workflow 歸位、建 `.env`、檢查 `.gitignore`：

```
node scripts/setup-local.mjs
```

把氣象署授權碼填進根目錄的 `.env`：

```
CWA_KEY=CWA-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

`.env` 在 `.gitignore` 裡，不會被 commit 上去。然後：

```
node scripts/update.mjs     抓一次資料，重寫 data.json
npx serve .                 開本機伺服器，然後開 http://localhost:3000
```

直接雙擊 `index.html` 會因為 `file://` 讀不到 `data.json`，一定要開伺服器。

專案根目錄有一份 `CLAUDE.md`，寫了這個專案的設計原則與不能破的規則
（金鑰不可 commit、公開版只放天氣股價經文、經文演算法不要亂動等等）。
Claude Code 開這個資料夾時會自己讀它，所以你直接說「幫我加一檔股票」就行，
不用每次重講背景。

---

## 已知做不到的事

- **行程與待回信件沒有接**。要接 Google 日曆與 Gmail 需要 OAuth，
  而且那是私人資料，不該放進公開的靜態網站。頁面上那一格留了說明文字。
- **定位是手動選的**，不是自動抓。`navigator.geolocation` 在部署後的網站上可以用，
  但需要使用者按下允許，而且氣象署那支 API 只到縣市層級，精確座標意義不大。
- **cron 不準時**，見上面的說明。
- **農曆節日只到 2028 年**。
- **經文是寫死的 51 節**，想換要直接改 `index.html` 裡的 `V` 陣列。

---

## 授權

MIT，見 `LICENSE`。經文取自和合本（公有領域）。
天氣資料來自中央氣象署開放資料，股價來自證交所與 Yahoo Finance，
僅供參考，不是投資建議。
