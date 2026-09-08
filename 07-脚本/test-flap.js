// 回归：删除后云端查询短暂缺失 → 记录不得复活（用户报告的真实成因）
// v11 症状：墓碑被"查不到就解除"清掉 → 记录再次出现时复活
// v13 期望：墓碑不解除，记录始终隐藏
const http = require('http');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const PORT = 9511;

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
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { __ERR: JSON.stringify(r.result.exceptionDetails).slice(0, 250) };
    return r.result ? r.result.result : undefined;
  };
  const P = `(function(){var w=null;function walk(x){try{if(x.document&&x.document.getElementById&&x.document.getElementById("viewRoot"))w=x;}catch(e){}for(var i=0;i<x.frames.length;i++){try{walk(x.frames[i]);}catch(e){}}}walk(window);return w;})()`;
  const W = `(${P})`;
  const nav = async (u, w) => { await send('Page.navigate', { url: u }); await sleep(w || 4000); };
  const gotoSched = async () => { await ev(`${W}.document.querySelector('[data-act="go"][data-view="schedule"]').click();`); await sleep(600); };
  const bodyHas = async (s) => (await ev(`${W}?(""+${W}.document.body.innerText).indexOf(${JSON.stringify(s)})>=0:false`)).value;
  const tombs = async () => (await ev(`(function(){var d=JSON.parse(localStorage.getItem('lwb_workbench_v2')||'{}');return (d.tombs&&d.tombs.schedule)||{};})()`)).value;

  const R = {};
  await nav(`http://127.0.0.1:${PORT}/test-flap.html`);
  await ev('localStorage.clear(); location.reload(); true');
  await sleep(4500);
  await nav(`http://127.0.0.1:${PORT}/test-flap.html`, 4000);
  await gotoSched();
  R.d1_visible = await bodyHas('幽灵测试任务');
  log('D1 记录可见:', R.d1_visible, '(期望 true)');

  R.d2_click = (await ev(`(function(){var b=${W}.document.querySelector('[data-act="del"][data-kind="schedule"]');if(!b)return 'NO_BTN';b.click();return 'CLICKED';})()`)).value;
  await sleep(3500);
  R.d2_tombs = await tombs();
  log('D2 删除:', R.d2_click, '| 墓碑:', JSON.stringify(R.d2_tombs));

  // 连续点 3 次「刷新云端数据」，跨越"云端查不到→又带回来"的窗口
  for (let i = 1; i <= 3; i++) {
    await ev(`(function(){var b=${W}.document.querySelector('[data-act="refresh-cloud"]');if(b)b.click();})()`);
    await sleep(3000);
    await gotoSched();
    const vis = await bodyHas('幽灵测试任务');
    const t = await tombs();
    log(`D3.${i} 刷新云端数据后 可见=${vis} 墓碑=${JSON.stringify(t)} (期望可见=false)`);
    R['d3_' + i] = vis;
  }
  R.d3_queryCalls = (await ev('window.__FLAP_CALLS?window.__FLAP_CALLS():-1')).value;
  log('D3 云端查询次数:', R.d3_queryCalls, '(需 >4 才跨越缺失窗口)');

  // 整页刷新最后确认
  await ev('location.reload(); true');
  await sleep(4000);
  await gotoSched();
  R.d4_afterReload = await bodyHas('幽灵测试任务');
  log('D4 整页刷新后 可见:', R.d4_afterReload, '(期望 false)');

  const pass = R.d1_visible === true && R.d2_click === 'CLICKED' &&
    R.d3_1 === false && R.d3_2 === false && R.d3_3 === false && R.d4_afterReload === false;
  log(pass ? '=== FLAP: PASS（删除后不再复活） ===' : '=== FLAP: FAIL（仍会复活） === ' + JSON.stringify(R).slice(0, 400));
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
