#!/usr/bin/env node
/*
 * 本機第一次設定，跑一次就好：
 *   node scripts/setup-local.mjs
 *
 * 做三件事：
 *   1. 把 workflow 放回 .github/workflows/update.yml
 *      （從雲端複製過來時 .github 是隱藏資料夾，常常掉在外面）
 *   2. 建一份空的 .env 讓你填氣象署授權碼
 *   3. 檢查 .gitignore 有沒有把 .env 擋掉
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const say = (...a) => console.log(...a);

/* 1. workflow */
const wfDir = join(ROOT, '.github', 'workflows');
const wfPath = join(wfDir, 'update.yml');

if (existsSync(wfPath)) {
  say('✓ .github/workflows/update.yml 已經在位子上');
} else {
  // 找根目錄那個檔名很長的暫代檔
  const stray = readdirSync(ROOT).find(
    (f) => f.endsWith('.yml') && f.includes('.github'),
  );
  if (stray) {
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(wfPath, readFileSync(join(ROOT, stray), 'utf8'), 'utf8');
    rmSync(join(ROOT, stray));
    say('✓ 已把 workflow 移到 .github/workflows/update.yml');
  } else {
    say('✗ 找不到 workflow 檔。到 zip 裡把 .github 整個資料夾複製過來，');
    say('  或直接在 GitHub 網頁上用 Create new file 建 .github/workflows/update.yml');
  }
}

/* 2. .env */
const envPath = join(ROOT, '.env');
if (existsSync(envPath)) {
  say('✓ .env 已存在，沒有動它');
} else {
  writeFileSync(
    envPath,
    '# 中央氣象署開放資料授權碼，到 https://opendata.cwa.gov.tw/ 免費申請\n'
    + '# 這個檔案在 .gitignore 裡，不會被 commit 上去\n'
    + 'CWA_KEY=\n',
    'utf8',
  );
  say('✓ 已建立 .env，把授權碼填進去');
}

/* 3. .gitignore 把關 */
const giPath = join(ROOT, '.gitignore');
const gi = existsSync(giPath) ? readFileSync(giPath, 'utf8') : '';
if (/^\.env\s*$/m.test(gi)) {
  say('✓ .gitignore 有擋住 .env');
} else {
  writeFileSync(giPath, (gi.endsWith('\n') || !gi ? gi : gi + '\n') + '.env\n', 'utf8');
  say('✓ 已把 .env 加進 .gitignore');
}

say('');
say('接下來：');
say('  1. 把授權碼填進 .env');
say('  2. node scripts/update.mjs      抓一次資料');
say('  3. npx serve .                  開本機伺服器看頁面');
