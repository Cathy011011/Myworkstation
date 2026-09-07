// 墓碑机制回归测试 v2：删除→刷新→不复活；云端确认后墓碑解除；LLM 自动降级
// 前置: headless Chrome(9334) + 本机 HTTP(9511, serve 07-脚本)
const http = require('http');
const fs = require('fs');
const PORT = process.argv[2] || 9511;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

(async () => {
  const tabs = await new Promise((res, rej) => {
    http.get('http://127.0.0.1:9334/json/list', (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej);
  });
  const tab = tabs.find((t) => t.type === 'page');
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => ws.onopen = r);
  let mid = 0; const pend = {};
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
  const send = (m, p = {}) => new Promise((r) => { const id = ++mid; pend[id] = r; ws.send(JSON.stringify({ id, method: m, params: p })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { __ERR: JSON.stringify(r.result.exceptionDetails).slice(0, 300) };
    return r.result ? r.result.result : undefined;
  };

  const PROBE = `(function(){var w=null;function walk(x){try{if(x.document&&x.document.getElementById&&x.document.getElementById("viewRoot"))w=x;}catch(e){}for(var i=0;i<x.frames.length;i++){try{walk(x.frames[i]);}catch(e){}}}walk(window);return w;})()`;
  const W = `(${PROBE})`;
  const nav = async (url, waitMs) => {
    await send('Page.navigate', { url });
    await sleep(waitMs || 1500);
    for (let i = 0; i < 20; i++) {
      const r = await ev(`${W}&&${W}.document&&${W}.document.body&&${W}.document.body.innerText.length>100`);
      if (r && r.value === true) break;
      await sleep(700);
    }
  };
  const gotoSchedule = async () => { await ev(`${W}.document.querySelector('[data-act="go"][data-view="schedule"]').click();`); await sleep(600); };
  const bodyHas = async (s) => (await ev(`${W}?(""+${W}.document.body.innerText).indexOf(${JSON.stringify(s)})>=0:false`)).value;
  const lsState = async () => (await ev(`(function(){try{var d=JSON.parse(localStorage.getItem('lwb_workbench_v2'));return {tombs:(d&&d.tombs)||{},schedTitles:(d&&d.data&&d.data.schedule?d.data.schedule:[]).map(function(x){return x.title;})};}catch(e){return {err:e.message};}})()`)).value;
  const pullDone = async () => (await ev(`${W}&&${W}.__LWB?${W}.__LWB.pullDone():null`)).value;
  const badge = async () => (await ev(`${W}?${W}.document.getElementById('syncBadge').innerText.replace(/\\n/g,' '):''`)).value;

  const R = {};
  // ============ 场景一：云端有活记录 + 写入全部 401 ============
  log('--- live 场景：删除后刷新不复活 ---');
  await nav(`http://127.0.0.1:${PORT}/test-tomb.html`);
  await ev('localStorage.clear(); location.reload(); true');
  for (let i = 0; i < 15; i++) { if ((await pullDone()) === true) break; await sleep(800); }   // 首载 pull 完成
  R.firstPullDone = await pullDone();
  await nav(`http://127.0.0.1:${PORT}/test-tomb.html`, 3500);                                   // 二载：采纳云端
  await gotoSchedule();
  R.a1_ghostVisible = await bodyHas('幽灵测试任务');
  log('A1 幽灵记录在日程页可见:', R.a1_ghostVisible, '(期望 true) | pullDone:', R.firstPullDone);

  R.a2_click = (await ev(`(function(){var b=${W}.document.querySelector('[data-act="del"][data-id="ghost1"]');if(!b)return 'NO_BTN';b.click();return 'CLICKED';})()`)).value;
  await sleep(3000);
  R.a2_gone = !(await bodyHas('幽灵测试任务'));
  R.a2_ls = await lsState();
  R.a2_badge = await badge();
  log('A2 点击删除:', R.a2_click, '| 消失:', R.a2_gone, '| 墓碑:', JSON.stringify(R.a2_ls.tombs && R.a2_ls.tombs.schedule), '| 徽章:', R.a2_badge);

  await ev('location.reload(); true');
  await sleep(3500);
  await gotoSchedule();
  R.a3_noRevival = !(await bodyHas('幽灵测试任务'));
  R.a3_ls = await lsState();
  log('A3 刷新后不复活:', R.a3_noRevival, '(核心断言) | 存储日程:', JSON.stringify(R.a3_ls.schedTitles), '| 墓碑:', JSON.stringify(R.a3_ls.tombs && R.a3_ls.tombs.schedule));

  // ============ 场景二：云端已软删 → 墓碑自动解除 ============
  log('--- softdel 场景：云端确认 → 墓碑解除 ---');
  await nav(`http://127.0.0.1:${PORT}/test-tomb-softdel.html`, 3500);
  for (let i = 0; i < 10; i++) {
    const t = await lsState();
    if (t.tombs && Object.keys(t.tombs.schedule || {}).length === 0) break;
    await sleep(800);
  }
  R.a4_ls = await lsState();
  R.a4_ghostVisible = await bodyHas('幽灵测试任务');
  log('A4 墓碑状态:', JSON.stringify(R.a4_ls.tombs && R.a4_ls.tombs.schedule), '(期望空) | 幽灵可见:', R.a4_ghostVisible, '(期望 false)');

  // ============ 场景三：LLM 主模型失效 → 自动降级 ============
  log('--- LLM 场景：主模型不存在 → 自动降级成功 ---');
  R.llm = (await ev(`${W}.__LWB.callLLM({baseURL:'https://www.oopii.cc/v1/chat/completions',model:'fake-model-xyz',key:'sk-6gzJacqZHbNqB3Y4Rqa2TXBhI0vQP2bYGU2y1vLHik3JpFta'},[{role:'user',content:'回复两个字：可用'}],10).then(function(t){return {ok:true,t:String(t).slice(0,20)};},function(e){return {ok:false,err:e.message};})`)).value;
  log('A5 LLM 降级:', JSON.stringify(R.llm), '(期望 ok:true)');

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  try { fs.mkdirSync('04-测试/screenshots', { recursive: true }); } catch (e) {}
  fs.writeFileSync('04-测试/screenshots/tomb-test-final.png', Buffer.from(shot.result.data, 'base64'));

  const tombsA4 = Object.keys((R.a4_ls.tombs && R.a4_ls.tombs.schedule) || {}).length;
  const pass = R.a1_ghostVisible === true && R.a2_click === 'CLICKED' && R.a2_gone === true &&
    R.a3_noRevival === true && tombsA4 === 0 && R.a4_ghostVisible === false &&
    R.llm && R.llm.ok === true;
  log(pass ? '=== RESULT: ALL PASS ===' : '=== RESULT: FAIL === ' + JSON.stringify(R).slice(0, 500));
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
