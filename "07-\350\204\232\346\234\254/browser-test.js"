/*
 * 真实浏览器自动化测试（Chrome DevTools Protocol，无需安装任何依赖）
 * 用法：node browser-test.js
 * 前置：本地 http 服务已启（8899）、Chrome 以 --remote-debugging-port=9222 启动
 * 说明：密钥从 ~/.workbuddy/models.json 读取，仅用于测试，不写入任何产物
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CDP = 'http://127.0.0.1:9222';
const SHOT_DIR = path.join(__dirname, '..', '04-测试', 'screenshots');

function getJSON(url) {
  return new Promise((res, rej) => {
    http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 读取已配置的中转站（与 WorkBuddy 共用同一把 key）
function loadLLM() {
  const p = path.join(os.homedir(), '.workbuddy', 'models.json');
  const arr = JSON.parse(fs.readFileSync(p, 'utf-8'));
  const m = arr.find(x => x.id === 'glm-5.3-flash') || arr[0];
  return { baseURL: m.url, model: m.id, key: m.apiKey };
}

(async () => {
  const llm = loadLLM();
  const results = [];
  const t0 = Date.now();
  const rec = (id, name, ok, detail, ms) => {
    results.push({ id, name, ok, detail, ms });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${name}  ${detail ? JSON.stringify(detail) : ''}`);
  };

  const list = await getJSON(CDP + '/json/list');
  const page = list.find(t => t.type === 'page' && t.url.includes('demo.html')) || list.find(t => t.type === 'page');
  if (!page) throw new Error('找不到页面 target，Chrome 是否已打开 demo.html？');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let mid = 0; const pending = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const i = ++mid;
      const timer = setTimeout(() => reject(new Error(method + ' 超时')), 90000);
      pending.set(i, m => { clearTimeout(timer); m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result); });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  }
  async function ev(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '') + ' || ' + expr.slice(0, 150));
    return r.result.value;
  }
  const JS = {
    sleep: 'const sleep=ms=>new Promise(r=>setTimeout(r,ms));',
    go: v => `document.querySelector('#sideNav [data-view="${v}"]').click(); await sleep(90);`,
  };

  // ---------- T1 首屏 ----------
  let s = Date.now();
  let r = await ev(`(()=>{ ${JS.sleep}
    return {title:document.getElementById('tbTitle').textContent,
            nav:document.querySelectorAll('#sideNav .nav-i').length,
            hero:!!document.querySelector('.hero-card'),
            panels:document.querySelectorAll('.panel').length,
            body:document.body.innerHTML.length};})()`);
  rec('T1', '首屏渲染', r.title === '今日总览' && r.nav === 7 && r.hero && r.body > 5000, r, Date.now() - s);

  // ---------- T2 七屏切换 ----------
  s = Date.now();
  r = await ev(`(async()=>{ ${JS.sleep}
    const views=['overview','schedule','todo','translate','qa','plan','info'];
    const out=[];
    for(const v of views){
      document.querySelector('#sideNav [data-view="'+v+'"]').click(); await sleep(90);
      out.push({v, name:document.getElementById('tbTitle').textContent,
                len:document.getElementById('viewRoot').innerHTML.length});
    } return out;})()`);
  rec('T2', '七视图切换', r.length === 7 && r.every(x => x.len > 800)
    && new Set(r.map(x => x.name)).size === 7, r.map(x => x.name + ':' + x.len), Date.now() - s);

  // ---------- T3 日程新增 ----------
  s = Date.now();
  r = await ev(`(async()=>{ ${JS.sleep} ${JS.go('schedule')}
    const before=document.querySelectorAll('.list-item').length;
    document.getElementById('scTitle').value='自动化新增日程';
    document.getElementById('scPlace').value='测试地点';
    document.querySelector('[data-act="add-schedule"]').click(); await sleep(150);
    return {before, after:document.querySelectorAll('.list-item').length,
            hit:document.body.innerHTML.includes('自动化新增日程')};})()`);
  rec('T3', '日程新增', r.after === r.before + 1 && r.hit, r, Date.now() - s);

  // ---------- T4 待办勾选 ----------
  s = Date.now();
  r = await ev(`(async()=>{ ${JS.sleep} ${JS.go('todo')}
    const box=document.querySelector('.list-item .check-box');
    const was=box.classList.contains('on'); box.click(); await sleep(120);
    const now=document.querySelector('.list-item .check-box').classList.contains('on');
    return {was, now, toggled:was!==now};})()`);
  rec('T4', '待办勾选切换', r.toggled === true, r, Date.now() - s);

  // ---------- T5 待办筛选 ----------
  s = Date.now();
  r = await ev(`(async()=>{ ${JS.sleep}
    const chips=[...document.querySelectorAll('[data-act="filter-todo"]')];
    const all=document.querySelectorAll('.list-item').length;
    chips.find(c=>c.textContent==='未完成').click(); await sleep(120);
    const undone=document.querySelectorAll('.list-item').length;
    chips.find(c=>c.textContent==='全部').click(); await sleep(120);
    return {all, undone, chips:chips.length};})()`);
  rec('T5', '待办筛选', r.undone <= r.all && r.chips === 6, r, Date.now() - s);

  // ---------- T6 翻译 · 真实 LLM ----------
  s = Date.now();
  const cfg = JSON.stringify(llm);
  r = await ev(`(async()=>{ ${JS.sleep} ${JS.go('translate')}
    localStorage.setItem('lwb_llm', ${JSON.stringify(cfg)});
    const before=document.querySelectorAll('.list-item').length;
    document.getElementById('trSrc').value='请把第三节的课程大纲发我一份';
    document.getElementById('trSL').value='中文';
    document.getElementById('trTL').value='英文';
    const t0=Date.now();
    document.querySelector('[data-act="do-translate"]').click();
    let done=false;
    for(let i=0;i<100;i++){
      await sleep(400);
      if(document.querySelectorAll('.list-item').length>before){ done=true; break; }
      const o=document.getElementById('trOut');
      if(o && (o.textContent||'').includes('调用失败')) break;
    }
    const ms=Date.now()-t0;
    // 重绘后重新取节点，避免旧引用失效
    const item=document.querySelector('.list-item');
    const outEl=document.getElementById('trOut');
    return {ms, done, outText:(outEl?outEl.textContent:'').slice(0,200),
            itemText:(item?item.textContent:'').slice(0,200),
            before, after:document.querySelectorAll('.list-item').length,
            failing:(outEl?outEl.textContent:'').includes('调用失败')};})()`);
  rec('T6', '翻译 · LLM 真实应答',
    r.done && !r.failing && r.itemText.length > 20 && !r.itemText.includes('等待 AI 返回'), r, r.ms);

  // ---------- T7 问答 · 真实 LLM ----------
  s = Date.now();
  r = await ev(`(async()=>{ ${JS.sleep} ${JS.go('qa')}
    const before=document.querySelectorAll('.info-card').length;
    document.getElementById('qaQ').value='怎么和家长沟通孩子作业拖延？给三个具体做法';
    const t0=Date.now();
    document.querySelector('[data-act="do-ask"]').click();
    let done=false;
    for(let i=0;i<100;i++){
      await sleep(400);
      if(document.querySelectorAll('.info-card').length>before){ done=true; break; }
      const o=document.getElementById('qaOut');
      if(o && (o.textContent||'').includes('调用失败')) break;
    }
    const ms=Date.now()-t0;
    const card=document.querySelector('.info-card');
    const outEl=document.getElementById('qaOut');
    return {ms, done, outText:(outEl?outEl.textContent:'').slice(0,300),
            cardText:(card?card.textContent:'').slice(0,300),
            before, after:document.querySelectorAll('.info-card').length,
            failing:(outEl?outEl.textContent:'').includes('调用失败')};})()`);
  rec('T7', '问答 · LLM 真实应答',
    r.done && !r.failing && r.cardText.length > 60 && !r.cardText.includes('等待 AI 返回'), r, r.ms);

  if (!r.done) {
    const d = await ev(`(async()=>{ ${JS.sleep} ${JS.go('info')} ${JS.go('qa')}
      return {title:document.getElementById('tbTitle').textContent,
              cards:document.querySelectorAll('.info-card').length,
              empties:document.querySelectorAll('.empty-state').length,
              chips:[...document.querySelectorAll('[data-act="filter-qa"]')].map(c=>c.textContent),
              html:document.getElementById('viewRoot').innerHTML.slice(0,240)};})()`);
    console.log('T7b 诊断:', JSON.stringify(d));
  }

  // ---------- T8 规划推进 ----------
  s = Date.now();
  r = await ev(`(async()=>{ ${JS.sleep} ${JS.go('plan')}
    const fill=document.querySelector('.plan-card .progress-fill');
    const w0=fill?fill.style.width:'0%';
    document.querySelector('[data-act="bump-plan"]').click(); await sleep(150);
    const w1=document.querySelector('.plan-card .progress-fill').style.width;
    return {w0, w1, changed:w0!==w1};})()`);
  rec('T8', '规划进度推进', r.changed === true, r, Date.now() - s);

  // ---------- T9 信息整理新增 ----------
  s = Date.now();
  r = await ev(`(async()=>{ ${JS.sleep} ${JS.go('info')}
    const before=document.querySelectorAll('.info-card').length;
    document.getElementById('inTitle').value='自动化摘录';
    document.getElementById('inQuote').value='测试原文摘录内容';
    document.getElementById('inNote').value='测试笔记';
    document.querySelector('[data-act="add-info"]').click(); await sleep(150);
    return {before, after:document.querySelectorAll('.info-card').length,
            hit:document.body.innerHTML.includes('自动化摘录')};})()`);
  rec('T9', '信息整理新增', r.after === r.before + 1 && r.hit, r, Date.now() - s);

  // ---------- T10 刷新持久化 ----------
  s = Date.now();
  await send('Page.reload', { ignoreCache: false });
  await sleep(2500);
  r = await ev(`(()=>({title:document.getElementById('tbTitle').textContent,
      stored:!!localStorage.getItem('lwb_demo_v1'),
      sched:document.body.innerHTML.includes('自动化新增日程')}))()`);
  // 重新导航到日程确认
  await ev(`document.querySelector('#sideNav [data-view="schedule"]').click();`);
  await sleep(200);
  r = await ev(`(()=>({stored:!!localStorage.getItem('lwb_demo_v1'),
      persisted:document.body.innerHTML.includes('自动化新增日程'),
      llmCfg:!!localStorage.getItem('lwb_llm')}))()`);
  rec('T10', '刷新后数据持久化', r.stored && r.persisted && r.llmCfg, r, Date.now() - s);

  // ---------- T11 桌面截图 ----------
  if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });
  const shot = async (name) => {
    const r2 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOT_DIR, name), Buffer.from(r2.data, 'base64'));
    return name;
  };
  await ev(`document.querySelector('#sideNav [data-view="overview"]').click();`);
  await sleep(300);
  await shot('desktop-overview.png');
  await ev(`document.querySelector('#sideNav [data-view="translate"]').click();`);
  await sleep(300);
  await shot('desktop-translate.png');

  // ---------- T12 移动端 375 ----------
  s = Date.now();
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await sleep(400);
  await ev(`document.querySelector('#sideNav [data-view="overview"]') && document.querySelector('.mn-i[data-view="overview"]').click();`);
  await sleep(300);
  r = await ev(`(()=>({mobileNav:getComputedStyle(document.getElementById('mobileNav')).display,
      sidebar:getComputedStyle(document.querySelector('.sidebar')).display,
      scrollW:document.documentElement.scrollWidth, clientW:document.documentElement.clientWidth,
      overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth}))()`);
  rec('T12', '移动端 375 布局', r.mobileNav === 'flex' && r.sidebar === 'none' && r.overflow <= 1, r, Date.now() - s);
  await shot('mobile-overview.png');
  await send('Emulation.clearDeviceMetricsOverride');

  ws.close();
  const pass = results.filter(x => x.ok).length;
  console.log('\n===== 汇总 =====');
  console.log(`通过 ${pass}/${results.length}，总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  fs.writeFileSync(path.join(__dirname, '..', '04-测试', 'last-run.json'),
    JSON.stringify({ at: new Date().toISOString(), pass, total: results.length, results }, null, 2), 'utf-8');
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error('测试脚本异常：', e.message); process.exit(2); });
