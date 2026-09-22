# 晨報系統

一頁式的每日晨報：天氣、自選股、一節經文。整頁配色跟著天氣走。
這是一份學校作業，最後要上 GitHub 再接 Vercel 部署。

## 這個專案的樣子

```
index.html                     整個頁面。單一檔案，CSS 與 JS 全部內嵌，沒有外部相依
data.json                      資料層。由腳本重寫，不要手改
scripts/update.mjs             抓資料的腳本。純 Node，零套件
.github/workflows/update.yml   GitHub Actions 排程，一天八次
```

沒有 `package.json`、沒有建置步驟、沒有 `node_modules`。**這是刻意的**，
不要為了方便就加框架或套件進來——靜態主機直接丟 `index.html` 就要會動。

## 核心設計：資料與畫面分離

`index.html` 裡本來就有一份**靜態快照**（天氣、股價、經文都有預設值）。
腳本抓完資料寫進 `data.json`，頁面載入時 `fetch('./data.json')` 蓋上去。

所以改任何東西時要守住這條線：**抓不到資料時頁面不能變空白**，
只能停在舊數字。`scripts/update.mjs` 裡每個來源都包在 try 裡、失敗就沿用
`data.json` 原本那一段；空的欄位會在寫檔前整個 delete 掉，讓 HTML 的快照接手。
改動這一段時請保持這個行為。

## 常見任務

```bash
node scripts/update.mjs     # 抓一次資料，重寫 data.json
npx serve .                 # 開本機伺服器看頁面（直接雙擊 index.html 會讀不到 data.json）
```

授權碼放在專案根目錄的 `.env`（已在 `.gitignore`，不會被 commit）：

```
CWA_KEY=CWA-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

## 不能破的規則

- **氣象署授權碼絕對不可以出現在任何被 commit 的檔案裡。**
  repo 是 Public，GitHub 的歷史刪不掉，推上去就等於公開，只能回氣象署重辦一組。
  要改動涉及金鑰的程式碼時，先確認 `.env` 還在 `.gitignore` 裡。
- **公開版只放天氣、股價、經文。** 行事曆與信箱是私人資料，不進這個 repo、
  也不進 Vercel。頁面上那一格目前是說明文字，不要改成會抓真實資料的樣子。
- **不要動經文的抽籤演算法**，除非是要修 bug。它用 mulberry32 + Fisher–Yates，
  以 51 天為一輪、用「第幾輪」當種子洗牌，這樣才能同時做到「同一天刷新不變」
  「每天跳到不同書卷」「一輪內不重複」。換成 `Math.random()` 會全毀。
- **縣市名用氣象署的寫法**：臺北市、臺中市、臺南市、臺東縣用「臺」不是「台」。
  `data.json` 的鍵必須跟 `index.html` 裡的縣市清單一字不差。
- **cron 一律是 UTC**，台灣時間要減八小時。workflow 裡每行都有註解寫台灣時間，
  改的時候兩邊一起改。

## 已知狀況

- 三個資料來源（證交所即時報價、證交所每日成交資訊、Yahoo Finance 圖表端點）
  都是沒有正式文件的公開端點，**隨時可能改或擋**。壞掉時頁面不會空白，
  會停在最後一次成功的數字，`data.json` 的 `when` 欄會顯示那是什麼時候的。
- **農曆節日是查表的**，`scripts/update.mjs` 的 `LUNAR` 常數只填到 2028 年。
  教會節期（受難日、復活節、五旬節、感恩節）是用演算法算的，不用維護。
- GitHub 的 cron 常常晚 5–15 分鐘觸發，尖峰時會跳過一輪。這是平台限制。
- 定位除了手動下拉選，也可以按「使用目前位置」讓瀏覽器 Geolocation API 抓經緯度、
  自動選最近的縣市（高雄市會細到區）。Geolocation API 需要安全來源（HTTPS，或
  網址列剛好是 `localhost`），用區網 IP（如 `192.168.x.x`）測試會直接失敗，
  這是瀏覽器機制、不是 bug；部署到 Vercel 後就是 HTTPS，沒有這個限制。
- **高雄市 38 區有各自的天氣**，用的是氣象署 F-D0047-065（鄉鎮未來 3 天預報），
  跟其他 21 縣市共用的 F-C0032-001（縣市預報）是不同支 API。`scripts/update.mjs`
  的 `khDistricts()` 抓的是跟縣市預報同一個 12 小時時段（4 格 3 小時資料聚合），
  天氣現象取最嚴重的一格、降雨機率取最大值、溫度取區間內最低最高。

## 想改東西的話

- 換經文：改 `index.html` 裡的 `V` 陣列，每項是 `[經文, 白話解釋, 出處]`。
  改完數量後 51 這個數字不用手動改，程式讀的是 `V.length`。
- 換自選股：改 `scripts/update.mjs` 的 `TW` 與 `US` 兩個陣列。
  台股要填證交所的代號，美股填 Yahoo 的 ticker。
- 換更新時段：改 `.github/workflows/update.yml` 的 cron，記得是 UTC。
- 調配色：`index.html` 最上面的 CSS 變數，天氣對應在 `skyOf()` 裡。
