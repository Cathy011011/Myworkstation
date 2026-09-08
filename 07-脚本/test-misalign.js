// 错位 id 场景测试（v13 核心修复）
// 云端记录 id=cloudGhost1，本地该条目 id=localFake（旧版 add 无 id bug 的遗留形态）
// 断言：删除 localFake → 点刷新云端数据 → 云端 cloudGhost1 不被复活；补删打到 cloudGhost1；云端确认后墓碑解除
const http = require('http');
const fs = require('fs');
const PORT = 9511;
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
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { __ERR: JSON.stringify(r.result.exceptionDetails).slice(0, 250) };
    return r.result ? r.result.result : undefined;
  };
  const P = `(function(){var w=null;function walk(x){try{if(x.document&&x.document.getElementById&&x.document.getElementById("viewRoot"))w=x;}catch(e){}for(var i=0;i<x.frames.length;i++){try{walk(x.frames[i]);}catch(e){}}}walk(window);return w;})()`;
  const W = `(${P})`;
  const nav = async (url, w) => { await send('Page.navigate', { url }); await sleep(w || 4000); };
  const gotoSched = async () => { await ev(`${W}.document.querySelector('[data-act="go"][data-view="schedule"]').click();`); await sleep(700); };
  const bodyHas = async (s) => (await ev(`${W}?(""+${W}.document.body.innerText).indexOf(${JSON.stringify(s)})>=0:false`)).value;
  const tombs = async () => (await ev(`(function(){var d=JSON.parse(localStorage.getItem('lwb_workbench_v2')||'{}');return (d.tombs&&d.tombs.schedule)||{};})()`)).value;

  const R = {};
  log('--- 错位 id：本地 fakeX / 云端 cloudGhost1 同内容 ---');
  await nav(`http://127.0.0.1:${PORT}/test-misalign.html`);
  await ev('localStorage.clear(); location.reload(); true');
  await sleep(4500);
  await nav(`http://127.0.0.1:${PORT}/test-misalign.html`, 4000);   // 采纳云端 cloudGhost1
  await gotoSched();
  R.c1_visible = await bodyHas('幽灵测试任务');
  log('C1 云端记录可见:', R.c1_visible, '(期望 true)');

  // 把本地该条目的 id 改成假 id（模拟错位），快照同步改名，使其"看起来已同步"
  R.c2_fake = (await ev(`(function(){
    var w=${W};
    var it=null; (w.__LWB.data().schedule||[]).forEach(function(x){ if(x.title==='幽灵测试任务') it=x; });
    if(!it) return 'NO_ITEM';
    var fp=w.__LWB.data().schedule.indexOf(it);
    var snap=w.__LWB.snapshot().schedule;
    var old=it.id;
    it.id='fakeLocalId';
    if(snap[old]!==undefined){ snap['fakeLocalId']=snap[old]; delete snap[old]; }
    try{ var d=JSON.parse(localStorage.getItem('lwb_workbench_v2'));
         d.data.schedule=w.__LWB.data().schedule; d.snapshot=w.__LWB.snapshot();
         localStorage.setItem('lwb_workbench_v2',JSON.stringify(d)); }catch(e){}
    return 'FAKED';
  })()`)).value;
  await nav(`http://127.0.0.1:${PORT}/test-misalign.html`, 4000);
  await gotoSched();
  log('C2 改造成错位 id:', R.c2_fake);

  // 删除本地 fakeLocalId
  R.c3_click = (await ev(`(function(){var b=${W}.document.querySelector('[data-act="del"][data-id="fakeLocalId"]');if(!b)return 'NO_BTN';b.click();return 'CLICKED';})()`)).value;
  await sleep(3000);
  R.c3_gone = !(await bodyHas('幽灵测试任务'));
  log('C3 删除:', R.c3_click, '| 消失:', R.c3_gone);

  // 点「刷新云端数据」——用户报告的复活点
  await ev(`(function(){var b=${W}.document.querySelector('[data-act="refresh-cloud"]');if(b)b.click();})()`);
  await sleep(4000);
  await gotoSched();
  R.c4_afterRefresh = await bodyHas('幽灵测试任务');
  R.c4_tombs = await tombs();
  log('C4 刷新云端数据后 可见:', R.c4_afterRefresh, '(期望 false ★) | 墓碑:', JSON.stringify(R.c4_tombs));

  // 整页刷新再验
  await ev('location.reload(); true');
  await sleep(4000);
  await gotoSched();
  R.c5_afterReload = await bodyHas('幽灵测试任务');
  R.c5_tombs = await tombs();
  log('C5 整页刷新后 可见:', R.c5_afterReload, '(期望 false) | 墓碑云id:', JSON.stringify(R.c5_tombs));

  // 云端确认删除 → 墓碑解除
  await nav(`http://127.0.0.1:${PORT}/test-misalign-deleted.html`, 4500);
  R.c6_tombs = await tombs();
  log('C6 云端确认已删后 墓碑:', JSON.stringify(R.c6_tombs), '(期望空)');

  const pass = R.c1_visible === true && R.c3_click === 'CLICKED' && R.c3_gone === true &&
    R.c4_afterRefresh === false && R.c5_afterReload === false &&
    Object.keys(R.c6_tombs || {}).length === 0;
  log(pass ? '=== MISALIGN: PASS ===' : '=== MISALIGN: FAIL === ' + JSON.stringify(R).slice(0, 400));
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
