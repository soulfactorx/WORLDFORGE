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
/** 상단 도구 열기: 모바일이면 ☰ 메뉴를 먼저 연다 */
async function tool(page, label) {
  const inline = page.locator(`.topbar-tools [aria-label="${label}"]`);
  if (await inline.isVisible()) { await inline.click(); return; }
  await page.click('.topbar-menu-btn');
  await page.click(`.topbar-menu.open [aria-label="${label}"]`);
}
async function play(page) {
  await home(page);
  const sel = page.locator('label:has-text("세계관") select');
  await sel.selectOption(await sel.locator('option', { hasText: '장미 정원' }).getAttribute('value'));
  await page.click('button:has-text("주인공 만들고 시작")');
  await page.click('.gender-pick button >> nth=0');
  await page.click('button:has-text("이 캐릭터로 시작")');
  await page.waitForSelector('.entry.narration');
}
async function editor(page) {
  await home(page);
  await page.click('.home-tabs button:has-text("세계관")');
  await page.locator('.saves li', { hasText: '장미 정원' }).locator('button:has-text("⋯")').click();
  await page.click('.menu-pop button:has-text("복제해서 편집")');
}
const TAB_GROUP = { 기본: '세계', '⚖ 세계 규칙': '세계', 장소: '세계', 지식: '세계', '관계·세력': '세계', '보드·지도·시뮬레이터': '시험', '상태 시험대': '시험', '자동 플레이·전체 점검': '시험', 인물: '인물', 주인공: '인물', 직업: '인물', '임무·플래그·결말': '이야기', '이야기 흐름': '이야기', 장면: '이야기', 조우: '이야기', '아이템·상점': '이야기', 이미지: '자료', 'JSON 전체': '자료' };
async function editorTab(page, tab) {
  await editor(page);
  await page.click(`.editor-groups button:has-text("${TAB_GROUP[tab]}")`);
  await page.click(`.editor-tabs button:text-is("${tab}")`);
}
const EDITOR_TABS = ['기본', '⚖ 세계 규칙', '주인공', '직업', '보드·지도·시뮬레이터', '장소', '인물', '관계·세력', '지식', '아이템·상점', '조우', '임무·플래그·결말', '이야기 흐름', '상태 시험대', '자동 플레이·전체 점검', '이미지', 'JSON 전체'];

const SCREENS = [
  ['홈: 플레이', home],
  ['상단 메뉴 열기', async (p) => { await home(p); await p.click('.topbar-menu-btn'); }],
  ['홈: 세계관', async (p) => { await home(p); await p.click('.home-tabs button:has-text("세계관")'); }],
  ['홈: 세이브', async (p) => { await home(p); await p.click('.home-tabs button:has-text("세이브")'); }],
  ['주인공 만들기', async (p) => { await home(p); await p.click('button:has-text("주인공 만들고 시작")'); }],
  ['플레이 화면', play],
  ['플레이: 캐릭터', async (p) => { await play(p); await p.click('button:has-text("캐릭터")'); }],
  ['플레이: 수첩', async (p) => { await play(p); await p.click('button:has-text("수첩")'); }],
  ...EDITOR_TABS.map((t) => [`편집: ${t}`, (p) => editorTab(p, t)]),
  ['편집: 장면 (펼침)', async (p) => {
    await editorTab(p, '장면');
    await p.selectOption('.scene-preset select', 'date');
    await p.click('.scene-preset button:has-text("＋ 추가")');
    await p.evaluate(() => document.querySelectorAll('details').forEach((d) => d.setAttribute('open', '')));
  }],
  ['편집: 조우 (펼침)', async (p) => {
    await editorTab(p, '조우');
    await p.click('button:has-text("＋ 조우 추가")');
    await p.locator('.enc-retry select').selectOption('turns');
    await p.click('button:has-text("＋ 적 추가")');
    await p.locator('fieldset:has(> legend:has-text("졌을 때")) button:has-text("＋ 효과 추가")').click();
    await p.locator('fieldset:has(> legend:has-text("졌을 때")) .cond select').first().selectOption('startScene');
  }],
  ['편집: 장면 진입 (사용자 정의)', async (p) => {
    await editorTab(p, '장면');
    await p.selectOption('.scene-preset select', 'date');
    await p.click('.scene-preset button:has-text("＋ 추가")');
    await p.locator('fieldset:has(> legend:has-text("진입 방식")) select').first().selectOption('custom');
    await p.locator('fieldset:has(> legend:has-text("진입 방식")) select').nth(1).selectOption('offer');
  }],
  ['편집: 세계 규칙 (펼침)', async (p) => {
    await editorTab(p, '⚖ 세계 규칙');
    await p.click('button:has-text("＋ 세계 규칙 추가")');
    await p.click('button:has-text("＋ 반응 추가")');
    await p.locator('.rule-reaction select').nth(1).selectOption('trust');
    await p.click('button:has-text("＋ 효과 추가")');
    await p.click('button:has-text("＋ 조건 넣기")');
  }],
  ['시험대: 항목 펼침', async (p) => {
    await editorTab(p, '임무·플래그·결말');
    await p.click('button:has-text("🧪 이 항목 시험")');
    await p.waitForSelector('.lab-row-body');
    await p.click('.lab-box button:has-text("▶ 엔진 한 단계")');
    await p.evaluate(() => document.querySelectorAll('.lab details').forEach((d) => d.setAttribute('open', '')));
  }],
  ['자동 플레이 결과', async (p) => {
    await editorTab(p, '자동 플레이·전체 점검');
    await p.locator('label:has-text("실행 횟수") select').selectOption('10');
    await p.locator('label:has-text("한 번에 걸음") select').selectOption('100');
    await p.click('button:has-text("▶ 자동 플레이")');
    await p.waitForSelector('.lab-stats', { timeout: 60000 });
    await p.evaluate(() => document.querySelectorAll('.lab details').forEach((d) => d.setAttribute('open', '')));
  }],
  ['편집: 그림 고르기', async (p) => {
    await editorTab(p, '장면');
    await p.click('.scene-preset button:has-text("＋ 추가")');
    await p.locator('.img-pick button:has-text("바꾸기"), .img-pick button:has-text("고르기")').first().click();
    await p.locator('.img-pick-cell').first().click();
  }],
  ['장면 시험', async (p) => { await editorTab(p, '장면'); await p.click('button:has-text("추가하고 바로 테스트")'); await p.waitForSelector('.scene-tester'); await p.click('button:has-text("자동 200회")'); }],
  ['카드로 세계 만들기 (요약 줄이기 설명 펼침)', async (p) => {
    await home(p); await p.click('.home-tabs button:has-text("세계관")');
    const card = { spec: 'chara_card_v2', spec_version: '2.0', data: { name: '점검용 카드', description: '점검용 인물이다.', personality: '차분하다', scenario: '', first_mes: '안녕.', mes_example: '', character_book: { entries: [{ keys: ['마을'], content: '마을은 조용하다.', enabled: true, name: '마을' }] } } };
    await p.click('button:has-text("＋ 만들기")');
    await p.locator('input[type=file][multiple]').setInputFiles({ name: 'card.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(card)) });
    await p.waitForSelector('.card-summary');
    await p.selectOption('.card-summary select', 'focus');
    await p.click('.card-summary details > summary');
  }],
  ['장면 시험: 결과 비율 맞추기', async (p) => {
    await editorTab(p, '장면'); await p.click('button:has-text("추가하고 바로 테스트")'); await p.waitForSelector('.scene-tester');
    await p.click('.scene-balance > summary');
    await p.click('.scene-balance button:has-text("맞추기")');
    await p.waitForSelector('.balance-result', { timeout: 60000 });
  }],
  ['장면 시험: 안 나오는 끝 안내', async (p) => {
    await editorTab(p, '장면');
    await p.selectOption('.scene-preset select', 'date');
    await p.click('.scene-preset button:has-text("＋ 추가") >> nth=0');
    // 보이는 장면의 첫 끝 기준을 수치 범위 밖으로 — 절대 안 나오는 끝을 만든다
    const end = p.locator('fieldset:has(> legend:has-text("끝 (위에서부터")) details').first();
    await end.locator('summary').first().click();
    await end.locator('input[type=number]').first().fill('99');
    await p.click('button:has-text("▶ 바로 테스트")');
    await p.waitForSelector('.scene-tester');
    await p.click('button:has-text("자동 200회")');
    await p.waitForSelector('.scene-diagnosis');
  }],
  ['AI 설정 (제공자 2개 · 역할 안내 펼침)', async (p) => {
    await home(p);
    await p.evaluate(() => localStorage.setItem('worldforge.llm', JSON.stringify({ provider: 'anthropic', apiKey: 'k', model: 'claude-sonnet-5-5', defaultProvider: 'a',
      providers: [{ id: 'a', name: 'Claude', provider: 'anthropic', apiKey: 'k', model: 'claude-sonnet-5-5' }, { id: 'b', name: '', provider: 'openai-compatible', apiKey: 'k', model: 'deepseek/deepseek-v4.1-flash-1017:nitro', baseUrl: 'https://openrouter.ai/api/v1' }],
      roles: { bulk: { provider: 'b' }, narrator: { model: 'claude-opus-5-5' } } })));
    await p.reload(); await p.waitForTimeout(300);
    await p.click('.topbar-settings');
    await p.waitForSelector('.role-card');
    await p.evaluate(() => document.querySelectorAll('.role-hint').forEach((d, i) => { if (i === 0 || i === 5) d.setAttribute('open', ''); }));
  }],
  ['AI 사용량', async (p) => { await home(p); await tool(p, 'AI 사용량'); }],
  ['AI 사용량: 타임라인', async (p) => {
    await home(p); await tool(p, 'AI 사용량'); await p.waitForTimeout(600);
    // 기록 저장소가 열린 뒤에 작업 한 번 분량의 기록을 넣는다
    await p.evaluate(async () => {
      const now = Date.now();
      const row = (label, start, ms, extra = {}) => ({ at: now - 400000 + start + ms, role: 'worldgen', model: 'm', ms, input: 9000, output: Math.round(ms / 20), calls: 1, ok: true, label, area: 'card', worldName: '점검용 카드', run: 'r1', runName: '카드로 세계 만들기 — 점검용 카드', maxTokens: 12000, effort: 'medium', ...extra });
      const rows = [row('인물 찾기 1/2 묶음', 0, 30000), row('인물 찾기 2/2 묶음', 0, 28000), row('세계 구조 (장소·연표·시작 방식)', 30000, 95000, { maxTokens: 32000 }), row('번역 1/2 묶음', 30000, 40000), row('번역 2/2 묶음', 30000, 38000, { waitMs: 9000 }), row('이야기 뼈대 + 장면', 125000, 110000, { calls: 2 }), row('임무·조우·결말', 235000, 80000), row('세계 규칙', 315000, 50000)];
      const dbs = await indexedDB.databases();
      for (const { name } of dbs) await new Promise((res) => { const rq = indexedDB.open(name); rq.onsuccess = () => { const d = rq.result; if (![...d.objectStoreNames].includes('usage')) { d.close(); return res(); } const tx = d.transaction('usage', 'readwrite'); rows.forEach((r) => tx.objectStore('usage').add(r)); tx.oncomplete = () => { d.close(); res(); }; tx.onerror = () => { d.close(); res(); }; }; rq.onerror = () => res(); });
    });
    await p.reload(); await p.waitForTimeout(400); await tool(p, 'AI 사용량');
    await p.waitForSelector('.usage-groups');
    await p.click('.usage-groups button:has-text("작업별")');
    await p.click('.run-timeline > summary');
  }],
  ['저장소 관리', async (p) => { await home(p); await tool(p, '저장소 관리'); await p.waitForSelector('.storage-worlds, .storage h3'); await p.evaluate(() => document.querySelectorAll('details').forEach((d) => d.setAttribute('open', ''))); }],
  ['AI 점검·마무리', async (p) => { await editorTab(p, '기본'); await p.click('[aria-label="AI 점검·마무리"]'); await p.waitForSelector('.audit-panel'); await p.evaluate(() => document.querySelectorAll('.audit-panel details').forEach((d) => d.setAttribute('open', ''))); }],
  ['만계서고', async (p) => { await editorTab(p, '주인공'); await p.click('[aria-label="만계서고에서 불러오기"]'); await p.waitForSelector('.lib-cell'); }],
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
