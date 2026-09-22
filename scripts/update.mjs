#!/usr/bin/env node
/*
 * 晨報系統 · 資料更新腳本
 *
 * 跑一次會重寫同層目錄的 data.json，頁面打開時去讀它。
 * 需要 Node 18 以上（用內建的 fetch）。
 *
 * 用法：
 *   CWA_KEY=你的氣象署授權碼 node scripts/update.mjs
 *
 * 設計原則：任何一個來源掛掉，就沿用 data.json 裡原本那一段，
 * 絕對不要把畫面寫成空的。所以每個 fetch 都包在 try 裡。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data.json');

/* 本機開發時可以把授權碼放在專案根目錄的 .env（已經在 .gitignore 裡）：
     CWA_KEY=CWA-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   GitHub Actions 上則是讀 Secret，環境變數優先。 */
function dotenv() {
  try {
    const txt = readFileSync(join(ROOT, '.env'), 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  } catch { /* 沒有 .env 是正常的 */ }
}
dotenv();

const CWA_KEY = process.env.CWA_KEY || '';

/* ──────────────────────────────────────────────────────────────
   時間：一律用台灣時間思考。GitHub Actions 的機器是 UTC。
   ────────────────────────────────────────────────────────────── */

function taipeiNow() {
  const s = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' });
  // sv-SE 給的是 "YYYY-MM-DD HH:MM:SS"，可以直接切
  const [d, t] = s.split(' ');
  const [Y, M, D] = d.split('-').map(Number);
  const [h, m] = t.split(':').map(Number);
  return {
    Y, M, D, h, m,
    ymd: `${Y}${String(M).padStart(2, '0')}${String(D).padStart(2, '0')}`,
    date: `${M}/${D}`,
    hm: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
    dow: new Date(Date.UTC(Y, M - 1, D)).getUTCDay(),   // 0 = 週日
    minutes: h * 60 + m,
  };
}

const NOW = taipeiNow();
const isWeekday = NOW.dow >= 1 && NOW.dow <= 5;
const inSession = isWeekday && NOW.minutes >= 9 * 60 && NOW.minutes <= 13 * 60 + 35;
const afterClose = isWeekday && NOW.minutes > 13 * 60 + 35;

function log(...a) { console.log(`[${NOW.date} ${NOW.hm}]`, ...a); }

async function get(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; morning-brief/1.0)',
        'Accept': 'application/json, text/plain, */*',
        ...(opts.headers || {}),
      },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return opts.text ? await r.text() : await r.json();
  } finally {
    clearTimeout(timer);
  }
}

/* ──────────────────────────────────────────────────────────────
   舊資料：抓不到的欄位就沿用
   ────────────────────────────────────────────────────────────── */

let prev = {};
try {
  prev = JSON.parse(readFileSync(OUT, 'utf8'));
} catch {
  log('沒有舊的 data.json，這是第一次生成');
}

/* ──────────────────────────────────────────────────────────────
   一、天氣：中央氣象署 F-C0032-001（全台 22 縣市 36 小時預報）
   ────────────────────────────────────────────────────────────── */

function spanWords(startISO, endISO) {
  const sh = Number(String(startISO).slice(11, 13));
  const eh = Number(String(endISO).slice(11, 13));
  const pad = (n) => String(n).padStart(2, '0');
  if (sh === 6) return `白天 06 時–18 時`;
  if (sh === 18) return `今晚 18 時–明晨 06 時`;
  if (sh === 0) return `凌晨 00 時–06 時`;
  if (sh === 12) return `午後 12 時–18 時`;
  return `${pad(sh)} 時–${pad(eh)} 時`;
}

async function weather() {
  if (!CWA_KEY) {
    log('沒有 CWA_KEY，天氣沿用舊資料');
    return null;
  }
  const url = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-C0032-001'
    + `?Authorization=${CWA_KEY}`
    + '&elementName=Wx,PoP,MinT,MaxT&format=JSON';
  const j = await get(url);
  const locs = j?.records?.location || [];
  if (!locs.length) throw new Error('氣象署回傳沒有 location');

  const counties = {};
  let span = null;

  for (const loc of locs) {
    const pick = {};
    for (const el of loc.weatherElement || []) {
      const t = (el.time || [])[0];
      if (!t) continue;
      if (!span) span = spanWords(t.startTime, t.endTime);
      pick[el.elementName] = t.parameter?.parameterName;
    }
    counties[loc.locationName] = {
      wx: pick.Wx || '',
      pop: Number(pick.PoP ?? 0),
      lo: Number(pick.MinT ?? 0),
      hi: Number(pick.MaxT ?? 0),
    };
  }
  log(`天氣：${Object.keys(counties).length} 個縣市 · ${span}`);
  return { counties, span };
}

/* ──────────────────────────────────────────────────────────────
   一之二、高雄市 38 區：中央氣象署 F-D0047-065（鄉鎮未來 3 天預報）
   縣市預報只到「高雄市」一整筆，這支才有分區。抓 3 小時一格的資料，
   取跟縣市預報同一個 12 小時時段（4 格），天氣現象取最嚴重的一格、
   降雨機率取最大值、溫度取這段時間內的最低最高。
   ────────────────────────────────────────────────────────────── */

function wxRank(w) {
  if (/豪雨|大雨|雷/.test(w)) return 4;
  if (/雨/.test(w)) return 3;
  if (/陰/.test(w)) return 2;
  if (/雲/.test(w)) return 1;
  return 0;
}

async function khDistricts() {
  if (!CWA_KEY) {
    log('沒有 CWA_KEY，高雄分區天氣沿用舊資料');
    return null;
  }
  const url = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-D0047-065'
    + `?Authorization=${CWA_KEY}`
    + '&elementName=Weather,ProbabilityOfPrecipitation,Temperature&format=JSON';
  const j = await get(url);
  const locs = j?.records?.Locations?.[0]?.Location || [];
  if (!locs.length) throw new Error('高雄分區氣象署回傳沒有 Location');

  const districts = {};
  for (const loc of locs) {
    const wxEl = (loc.WeatherElement || []).find((e) => e.ElementName === '天氣現象');
    const popEl = (loc.WeatherElement || []).find((e) => e.ElementName === '3小時降雨機率');
    const tempEl = (loc.WeatherElement || []).find((e) => e.ElementName === '溫度');
    const blocks = (wxEl?.Time || []).slice(0, 4);
    if (!blocks.length || !popEl || !tempEl) continue;

    const winStart = blocks[0].StartTime;
    const winEnd = blocks[blocks.length - 1].EndTime;

    let wx = blocks[0].ElementValue?.[0]?.Weather || '';
    for (const b of blocks) {
      const w = b.ElementValue?.[0]?.Weather || '';
      if (wxRank(w) > wxRank(wx)) wx = w;
    }

    let pop = 0;
    for (const b of (popEl.Time || []).slice(0, 4)) {
      pop = Math.max(pop, Number(b.ElementValue?.[0]?.ProbabilityOfPrecipitation) || 0);
    }

    let lo = Infinity, hi = -Infinity;
    for (const t of tempEl.Time || []) {
      if (t.DataTime < winStart || t.DataTime > winEnd) continue;
      const v = Number(t.ElementValue?.[0]?.Temperature);
      if (!Number.isFinite(v)) continue;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;

    districts[loc.LocationName] = { wx, pop, lo, hi };
  }
  log(`高雄分區天氣：${Object.keys(districts).length} 個區`);
  return districts;
}

/* ──────────────────────────────────────────────────────────────
   二、台股
   盤中（09:00–13:35）：證交所 MIS 即時報價
   收盤後：證交所每日成交資訊（官方數字）
   ────────────────────────────────────────────────────────────── */

const TW = [
  { no: '2330', name: '台積電 2330' },
  { no: '0050', name: '元大台灣50 0050' },
  { no: '2454', name: '聯發科 2454' },
];

const comma = (n) =>
  Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const minus = (s) => String(s).replace(/-/g, '−');   // U+2212，排版用的減號

function row(name, price, prevClose, when) {
  const diff = price - prevClose;
  const pct = prevClose ? (diff / prevClose) * 100 : 0;
  const sign = diff > 0 ? '+' : (diff < 0 ? '-' : '');
  return {
    name,
    price: comma(price),
    chg: minus(`${sign}${Math.abs(diff).toFixed(2)}`),
    pct: minus(`${sign}${Math.abs(pct).toFixed(2)}%`),
    when,
    dir: diff > 0 ? 'up' : (diff < 0 ? 'dn' : ''),
  };
}

async function twIntraday() {
  const chs = TW.map((s) => `tse_${s.no}.tw`).join('|');
  const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${chs}&json=1&delay=0&_=${Date.now()}`;
  const j = await get(url, { headers: { Referer: 'https://mis.twse.com.tw/stock/index.jsp' } });
  const arr = j?.msgArray || [];
  const out = [];
  for (const s of TW) {
    const q = arr.find((x) => x.c === s.no);
    if (!q) throw new Error(`${s.no} 沒有回傳`);
    // z 是最新成交價；沒有成交時是 '-'，退回最佳買價
    let price = Number(q.z);
    if (!Number.isFinite(price) || price <= 0) price = Number(String(q.b || '').split('_')[0]);
    const prevClose = Number(q.y);
    if (!Number.isFinite(price) || !Number.isFinite(prevClose) || prevClose <= 0) {
      throw new Error(`${s.no} 價格不合理`);
    }
    // 合理性檢查：台股單日漲跌幅上限 10%
    if (Math.abs(price - prevClose) / prevClose > 0.105) throw new Error(`${s.no} 漲跌幅超過 10%`);
    out.push(row(s.name, price, prevClose, `${NOW.date} ${NOW.hm} 盤中`));
  }
  log('台股盤中：' + out.map((r) => `${r.name} ${r.price}`).join('、'));
  return out;
}

// 證交所每日成交資訊有新舊兩條路徑，兩條都試
async function stockDay(no, ymd) {
  const paths = [
    `https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=${ymd}&stockNo=${no}&response=json`,
    `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${ymd}&stockNo=${no}`,
  ];
  let last;
  for (const p of paths) {
    try { return await get(p); } catch (e) { last = e; }
  }
  throw last;
}

async function twClose() {
  const out = [];
  for (const s of TW) {
    const j = await stockDay(s.no, NOW.ymd);
    const rows = j?.data || [];
    const last = rows[rows.length - 1];
    if (!last) throw new Error(`${s.no} 今天還沒有官方資料`);
    // 欄位：日期, 成交股數, 成交金額, 開盤價, 最高價, 最低價, 收盤價, 漲跌價差, 成交筆數
    const rocDate = String(last[0]);                       // 民國，例如 115/09/16
    const [ry, rm, rd] = rocDate.split('/').map(Number);
    if (ry + 1911 !== NOW.Y || rm !== NOW.M || rd !== NOW.D) {
      throw new Error(`${s.no} 最後一列是 ${rocDate}，不是今天`);
    }
    const close = Number(String(last[6]).replace(/,/g, ''));
    const diff = Number(String(last[7]).replace(/[,X+]/g, ''));
    const prevClose = close - diff;
    out.push(row(s.name, close, prevClose, `${NOW.date} 收盤 · 官方`));
    await new Promise((r) => setTimeout(r, 1200));         // 對證交所客氣一點
  }
  log('台股收盤（官方）：' + out.map((r) => `${r.name} ${r.price}`).join('、'));
  return out;
}

// 最後的保險：抓這個月最後一個有資料的交易日收盤（月初第一天會退回上個月）
async function twLatest() {
  const out = [];
  for (const s of TW) {
    let j = await stockDay(s.no, NOW.ymd);
    if (!(j?.data || []).length) {
      const pm = new Date(Date.UTC(NOW.Y, NOW.M - 2, 1));
      const ymd = `${pm.getUTCFullYear()}${String(pm.getUTCMonth() + 1).padStart(2, '0')}01`;
      j = await stockDay(s.no, ymd);
    }
    const rows = j?.data || [];
    const last = rows[rows.length - 1];
    if (!last) throw new Error(`${s.no} 完全沒有資料`);
    const [ry, rm, rd] = String(last[0]).split('/').map(Number);
    const close = Number(String(last[6]).replace(/,/g, ''));
    const diff = Number(String(last[7]).replace(/[,X+]/g, ''));
    out.push(row(s.name, close, close - diff, `${rm}/${rd} 收盤 · 官方`));
    await new Promise((r) => setTimeout(r, 1200));
  }
  log('台股最近收盤：' + out.map((r) => `${r.name} ${r.price}`).join('、'));
  return out;
}

/* ──────────────────────────────────────────────────────────────
   三、美股：Yahoo Finance 的圖表端點（不需要金鑰）
   ────────────────────────────────────────────────────────────── */

const US = ['NVDA', 'GOOGL'];

async function usQuotes() {
  const out = [];
  for (const sym of US) {
    // query1 偶爾會擋，換 query2 再試一次
    let j, err;
    for (const host of ['query1', 'query2']) {
      try {
        j = await get(`https://${host}.finance.yahoo.com/v8/finance/chart/${sym}?range=5d&interval=1d`);
        break;
      } catch (e) { err = e; }
    }
    if (!j) throw err;
    const meta = j?.chart?.result?.[0]?.meta;
    const price = Number(meta?.regularMarketPrice);
    const prevClose = Number(meta?.chartPreviousClose ?? meta?.previousClose);
    if (!Number.isFinite(price) || !Number.isFinite(prevClose) || prevClose <= 0) {
      throw new Error(`${sym} 價格不合理`);
    }
    const t = Number(meta?.regularMarketTime) * 1000;
    const stamp = Number.isFinite(t)
      ? new Date(t).toLocaleDateString('en-US', {
          timeZone: 'America/New_York', month: 'numeric', day: 'numeric',
        })
      : '';
    const state = meta?.marketState === 'REGULAR' ? '盤中' : '收盤';
    out.push(row(sym, price, prevClose, `${stamp} ${state}`));
  }
  log('美股：' + out.map((r) => `${r.name} ${r.price}`).join('、'));
  return out;
}

/* ──────────────────────────────────────────────────────────────
   四、節慶與教會節期
   ────────────────────────────────────────────────────────────── */

// 復活節（Anonymous Gregorian 演算法）
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}
function shift([M, D], y, days) {
  const d = new Date(Date.UTC(y, M - 1, D + days));
  return [d.getUTCMonth() + 1, d.getUTCDate()];
}
function nthWeekday(y, month, weekday, nth) {   // 例如 11 月第四個週四
  const first = new Date(Date.UTC(y, month - 1, 1)).getUTCDay();
  const day = 1 + ((weekday - first + 7) % 7) + (nth - 1) * 7;
  return [month, day];
}

/* 農曆節日沒有公式，這裡用查表。表格用完要自己往下加。
   每列是 [月, 日, 名稱, 圖案] */
const LUNAR = {
  2026: [[2,16,'除夕','lantern'],[2,17,'春節','lantern'],[2,18,'初二','lantern'],
         [2,19,'初三','lantern'],[3,3,'元宵節','lantern'],[6,19,'端午節','dragonboat'],
         [8,19,'七夕','heart'],[8,27,'中元節','lantern'],[9,25,'中秋節','moon'],
         [10,18,'重陽節','flower'],[12,21,'冬至','tangyuan']],
  2027: [[2,5,'除夕','lantern'],[2,6,'春節','lantern'],[2,7,'初二','lantern'],
         [2,8,'初三','lantern'],[2,20,'元宵節','lantern'],[6,9,'端午節','dragonboat'],
         [8,8,'七夕','heart'],[8,16,'中元節','lantern'],[9,15,'中秋節','moon'],
         [10,8,'重陽節','flower'],[12,22,'冬至','tangyuan']],
  2028: [[1,25,'除夕','lantern'],[1,26,'春節','lantern'],[1,27,'初二','lantern'],
         [1,28,'初三','lantern'],[2,9,'元宵節','lantern'],[5,28,'端午節','dragonboat'],
         [7,27,'七夕','heart'],[8,4,'中元節','lantern'],[10,3,'中秋節','moon'],
         [10,26,'重陽節','flower'],[12,21,'冬至','tangyuan']],
};

function festToday() {
  const { Y, M, D } = NOW;
  const is = ([m, d]) => m === M && d === D;

  // 教會節期優先
  const E = easter(Y);
  if (is(shift(E, Y, -2))) return { name: '受難日', when: '今天 · 教會節期', art: 'cross' };
  if (is(E))               return { name: '復活節', when: '今天 · 教會節期', art: 'lily' };
  if (is(shift(E, Y, 49))) return { name: '五旬節', when: '今天 · 教會節期', art: 'flame' };
  if (is(nthWeekday(Y, 11, 4, 4))) return { name: '感恩節', when: '今天 · 教會節期', art: 'wheat' };
  if (M === 12 && D === 25) return { name: '聖誕節', when: '今天 · 教會節期', art: 'tree' };

  // 國定假日與固定日期的節日
  const FIXED = [
    [1, 1, '元旦', 'firework', '國定假日'],
    [2, 14, '情人節', 'heart', '節慶'],
    [2, 28, '和平紀念日', 'dove', '國定假日'],
    [3, 14, '白色情人節', 'heart', '節慶'],
    [4, 4, '兒童節', 'balloon', '國定假日'],
    [4, 5, '清明節', 'willow', '國定假日'],
    [5, 1, '勞動節', 'tool', '國定假日'],
    [8, 8, '父親節', 'carnation', '節慶'],
    [9, 28, '教師節', 'book', '節慶'],
    [10, 10, '國慶日', 'flag', '國定假日'],
    [10, 25, '光復節', 'flag', '國定假日'],
    [10, 31, '萬聖節', 'pumpkin', '節慶'],
    [12, 25, '行憲紀念日', 'flag', '國定假日'],
    [12, 31, '跨年', 'firework', '節慶'],
  ];
  for (const [m, d, name, art, kind] of FIXED) {
    if (m === M && d === D) return { name, when: `今天 · ${kind}`, art };
  }

  // 母親節：五月第二個週日
  if (is(nthWeekday(Y, 5, 0, 2))) return { name: '母親節', when: '今天 · 節慶', art: 'carnation' };

  // 農曆查表
  for (const [m, d, name, art] of (LUNAR[Y] || [])) {
    if (m === M && d === D) {
      const kind = ['除夕', '春節', '初二', '初三', '端午節', '中秋節'].includes(name)
        ? '國定假日' : '節慶';
      return { name, when: `今天 · ${kind}`, art };
    }
  }
  return null;
}

/* ──────────────────────────────────────────────────────────────
   組裝
   ────────────────────────────────────────────────────────────── */

const TAIL = '盤中價與收盤前的數字取自證交所即時資訊，收盤後改用證交所官方每日成交資訊。'
  + '漲跌顏色照台股慣例：紅漲綠跌。價格為公開行情資訊，非投資建議。';

function noteFor(tw, us, mode) {
  const say = (r) => `${r.name.split(' ')[0]} ${r.price}（${r.pct}）`;
  const head = mode === 'close'
    ? `台股今天收盤：${tw.map(say).join('、')}。`
    : mode === 'intraday'
      ? `${NOW.hm} 的盤中價：${tw.map(say).join('、')}。`
      : `台股最近一次的數字：${tw.map(say).join('、')}。`;
  const tail = us.length ? `美股上一個交易日：${us.map(say).join('、')}。` : '';
  return `${head}${tail}${TAIL}`;
}

async function main() {
  const out = {
    updated: `${NOW.date} ${NOW.hm}`,
    span: prev.span ?? null,
    counties: prev.counties ?? {},
    khDistricts: prev.khDistricts ?? {},
    fest: null,
    stocks: prev.stocks ?? [],
    stockNote: prev.stockNote ?? TAIL,
    verse: null,
  };

  // 天氣
  try {
    const w = await weather();
    if (w) { out.counties = w.counties; out.span = w.span; }
  } catch (e) { log('天氣失敗，沿用舊的：', e.message); }

  // 高雄分區天氣
  try {
    const d = await khDistricts();
    if (d) out.khDistricts = d;
  } catch (e) { log('高雄分區天氣失敗，沿用舊的：', e.message); }

  // 節慶
  try { out.fest = festToday(); } catch (e) { log('節慶判斷失敗：', e.message); }

  // 股票
  const prevTW = (prev.stocks || []).slice(0, 3);
  const prevUS = (prev.stocks || []).slice(3, 5);
  let tw = prevTW, us = prevUS, mode = 'keep';

  if (inSession) {
    try { tw = await twIntraday(); mode = 'intraday'; }
    catch (e) { log('盤中報價失敗，沿用舊的：', e.message); }
  } else if (afterClose) {
    try { tw = await twClose(); mode = 'close'; }
    catch (e) {
      log('官方收盤還沒出來，改抓即時最終價：', e.message);
      try {
        tw = (await twIntraday()).map((r) => ({ ...r, when: `${NOW.date} 收盤 · 待官方確認` }));
        mode = 'close';
      } catch (e2) { log('也失敗，沿用舊的：', e2.message); }
    }
  } else {
    log('非交易時段，台股沿用舊的');
  }

  // 前面全都沒成功、又沒有舊資料可沿用時，至少把最近一個交易日的收盤抓回來
  if (!tw.length) {
    try { tw = await twLatest(); mode = 'close'; }
    catch (e) { log('連最近收盤都抓不到：', e.message); }
  }

  try { us = await usQuotes(); }
  catch (e) { log('美股失敗，沿用舊的：', e.message); }

  out.stocks = [...tw, ...us];
  if (out.stocks.length) out.stockNote = noteFor(tw, us, mode);
  if (mode === 'keep' && tw.length) {
    out.updated = `${NOW.date} ${NOW.hm} · 股價 ${tw[0].when}`;
  } else if (mode === 'intraday') {
    out.updated = `${NOW.date} ${NOW.hm} · 台股盤中`;
  } else if (mode === 'close') {
    out.updated = `${NOW.date} ${NOW.hm} · 台股收盤`;
  }

  // 沒有內容的欄位就整個拿掉，讓頁面用 HTML 裡的靜態快照，而不是被空白蓋掉
  if (!out.span || !Object.keys(out.counties || {}).length) {
    delete out.counties;
    delete out.span;
  }
  if (!Object.keys(out.khDistricts || {}).length) delete out.khDistricts;
  if (!out.stocks.length) { delete out.stocks; delete out.stockNote; }
  // mail 與 agenda 這個版本不產生，留給 HTML 裡的說明文字

  writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
  log('已寫入 data.json');
}

main().catch((e) => {
  console.error('整個更新失敗：', e);
  process.exit(1);
});
