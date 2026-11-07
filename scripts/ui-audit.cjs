/**
 * UI 사전 점검 (v0.75): 주요 화면을 모바일(390px)·PC(1280px)로 열어 흔한 불편을 찾는다.
 *   npm run build:single && npm run ui:audit [-- --shots 폴더]
 * 점검: 가로 넘침 · 화면 밖으로 나간 요소 · 너무 작은 터치 대상(모바일 <32px) · 16px 미만 입력칸(iOS 확대) · 페이지 오류
 * 새 화면을 만들거나 바꿀 때는 아래 SCREENS에 그 화면으로 가는 단계를 추가한다.
 */
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('@playwright/test')); }

const FILE = 'file://' + path.resolve(__dirname, '../dist-single/index.html');
const shotDir = (() => { const i = process.argv.indexOf('--shots'); return i > 0 ? process.argv[i + 1] : ''; })();
const only = (() => { const i = process.argv.indexOf('--only'); return i > 0 ? process.argv[i + 1] : ''; })();
const VIEWPORTS = [{ name: 'mobile', width: 390, height: 844, mobile: true }, { name: 'pc', width: 1280, height: 900, mobile: false }];

async function home(page) {
  await page.goto(FILE);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('worldforge.llm', JSON.stringify({ provider: 'openai-compatible', baseUrl: 'http://x', model: 'm', apiKey: 'k' })); localStorage.setItem('worldforge.home.tab', 'play'); });
  await page.reload(); await page.waitForTimeout(400);
}
async function editor(page) {
  await home(page);
  await page.click('.home-tabs button:has-text("세계관")');
  await page.locator('.saves li', { hasText: '장미 정원' }).locator('button:has-text("⋯")').click();
  await page.click('.menu-pop button:has-text("복제해서 편집")');
}
async function editorTab(page, tab) { await editor(page); await page.click(`.tabs button:has-text("${tab}")`); }
const EDITOR_TABS = ['기본', '주인공', '직업', '보드·지도·시뮬레이터', '장소', '인물', '관계·세력', '지식', '아이템·상점', '조우', '임무·플래그·결말', '이야기 흐름', '이미지', 'JSON 전체'];

const SCREENS = [
  ['홈: 플레이', home],
  ['홈: 세계관', async (p) => { await home(p); await p.click('.home-tabs button:has-text("세계관")'); }],
  ['홈: 세이브', async (p) => { await home(p); await p.click('.home-tabs button:has-text("세이브")'); }],
  ['주인공 만들기', async (p) => { await home(p); await p.click('button:has-text("주인공 만들고 시작")'); }],
  ['플레이 화면', async (p) => { await home(p); await p.click('button:has-text("주인공 만들고 시작")'); await p.click('.gender-pick button >> nth=0'); await p.click('button:has-text("이 캐릭터로 시작")'); await p.waitForSelector('.entry.narration'); }],
  ['플레이: 캐릭터', async (p) => { await home(p); await p.click('button:has-text("주인공 만들고 시작")'); await p.click('.gender-pick button >> nth=0'); await p.click('button:has-text("이 캐릭터로 시작")'); await p.waitForSelector('.entry.narration'); await p.click('button:has-text("캐릭터")'); }],
  ...EDITOR_TABS.map((t) => [`편집: ${t}`, (p) => editorTab(p, t)]),
  ['편집: 장면 (펼침)', async (p) => {
    await editorTab(p, '장면');
    await p.selectOption('.scene-preset select', 'date');
    await p.click('.scene-preset button:has-text("＋ 추가")');
    await p.evaluate(() => document.querySelectorAll('details').forEach((d) => d.setAttribute('open', '')));
  }],
  ['편집: 그림 고르기', async (p) => {
    await editorTab(p, '장면');
    await p.click('.scene-preset button:has-text("＋ 추가")');
    await p.locator('.img-pick button:has-text("바꾸기"), .img-pick button:has-text("고르기")').first().click();
    await p.locator('.img-pick-cell').first().click();
  }],
  ['장면 시험', async (p) => { await editorTab(p, '장면'); await p.click('button:has-text("추가하고 바로 테스트")'); await p.waitForSelector('.scene-tester'); await p.click('button:has-text("자동 200회")'); }],
  ['만계서고', async (p) => { await editorTab(p, '주인공'); await p.click('button:has-text("만계서고에서 불러오기")'); await p.waitForSelector('.lib-cell'); }],
];

async function audit(page, vp) {
  return page.evaluate((mobile) => {
    const vw = window.innerWidth;
    const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const inScroller = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return true; } return false; };
    const inModalLightbox = (el) => !!el.closest('.lightbox');
    const name = (el) => { const c = (el.className && typeof el.className === 'string') ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''; const t = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 18).replace(/\s+/g, ' '); return `${el.tagName.toLowerCase()}${c}${t ? ` "${t}"` : ''}`; };
    const all = [...document.querySelectorAll('body *')].filter(visible).filter((e) => !inModalLightbox(e));
    const out = { overflowX: document.documentElement.scrollWidth - vw, offscreen: [], tiny: [], smallFont: [] };
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if ((r.right > vw + 1 || r.left < -1) && !inScroller(el) && el.children.length === 0) out.offscreen.push(name(el));
      if (mobile && el.matches('button, a[href], select, input:not([type=hidden]), summary, [role=button]')) {
        const isCheck = el.matches('input[type=checkbox], input[type=radio]');
        const minSide = isCheck ? Math.max(r.width, r.height) : Math.min(r.width, r.height);
        if (minSide < (isCheck ? 18 : 32) && !el.closest('.img-pick-grid, .gallery, .lib-grid')) out.tiny.push(`${name(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
      if (mobile && el.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]), select, textarea') && parseFloat(getComputedStyle(el).fontSize) < 16) out.smallFont.push(name(el));
    }
    return out;
  }, vp.mobile);
}

(async () => {
  const browser = await chromium.launch();
  let problems = 0;
  for (const vp of VIEWPORTS) {
    for (const [title, go] of SCREENS) {
      if (only && !title.includes(only)) continue;
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile });
      const page = await ctx.newPage();
      const errs = []; page.on('pageerror', (e) => errs.push(e.message));
      try {
        await go(page); await page.waitForTimeout(250);
        const r = await audit(page, vp);
        const bad = [];
        if (r.overflowX > 1) bad.push(`가로 넘침 ${r.overflowX}px`);
        if (r.offscreen.length) bad.push(`화면 밖 ${r.offscreen.length}: ${[...new Set(r.offscreen)].slice(0, 4).join(', ')}`);
        if (r.tiny.length) bad.push(`작은 터치 대상 ${r.tiny.length}: ${[...new Set(r.tiny)].slice(0, 4).join(', ')}`);
        if (r.smallFont.length) bad.push(`16px 미만 입력칸 ${r.smallFont.length}: ${[...new Set(r.smallFont)].slice(0, 3).join(', ')}`);
        if (errs.length) bad.push(`페이지 오류: ${errs[0]}`);
        problems += bad.length;
        console.log(`${bad.length ? '✗' : '✓'} [${vp.name}] ${title}${bad.length ? '\n    - ' + bad.join('\n    - ') : ''}`);
        if (shotDir) await page.screenshot({ path: path.join(shotDir, `${vp.name}-${title.replace(/[^\w가-힣]+/g, '_')}.png`), fullPage: true });
      } catch (e) { problems++; console.log(`✗ [${vp.name}] ${title} — 화면을 열지 못함: ${e.message.split('\n')[0]}`); }
      await ctx.close();
    }
  }
  await browser.close();
  console.log(problems ? `\n문제 ${problems}건` : '\n문제 없음');
  process.exitCode = problems ? 1 : 0;
})();
