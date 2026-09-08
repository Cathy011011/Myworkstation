// 线上真实端到端删除测试：
// 服务端造记录 → 线上页面拉取显示 → 点删除 → 服务端核对标记 → 点刷新云端数据 → 核对不复活 → 刷新页面 → 核对不复活
const http = require('http');
const { execSync } = require('child_process');
const fs = require('fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const LIVE = 'https://workbuddy.link/p/8ZxrlsT0cik2jMIZ8SOM2o';
const SCHED_DB = '68N86PsnmbQqLsN9T3KnTP';
const PY = 'C:/Users/HP/.workbuddy/binaries/python/versions/3.13.12/python.exe';
const LIB = 'D:/Program Files/WorkBuddy/resources/app.asar.unpacked/resources/plugins/workbuddy-builtin/skills/library';

function serverApi(script, argsJson) {
  // 通过 python 子进程调服务端 API（token 从 GITHUB 无关的环境走 no_proxy）
  const env = Object.assign({}, process.env, { no_proxy: '*', http_proxy: '', https_proxy: '' });
  return execSync(`"${PY}" "${LIB}/database/${script}" --token-stdin ${argsJson}`, {
    input: process.env.OP_TOKEN || '', env, encoding: 'utf8', timeout: 60000,
  });
}
function serverQuery(dbId) {
  const out = serverApi('query_database_record.py', `--database-id ${dbId}`);
  const d = JSON.parse(out);
  return ((d.data || d).results || (d.data || d).records || []);
}

(async () => {
  const TAG = '线上删除测试' + String(Date.now()).slice(-5);
  // ---- 1. 服务端造记录 ----
  const addOut = serverApi('batch_add_database_records.py',
    `--database-id ${SCHED_DB} --records "[{\\"标题\\":{\\"text\\":\\"${TAG}\\"},\\"日期键\\":{\\"text\\":\\"2026-09-08\\"}}]"`);
  const addId = JSON.parse(addOut).results[0].record_id || JSON.parse(addOut).results[0].id;
  log('S1 服务端造记录:', TAG, 'id=', addId);

  // ---- 2. 打开线上页面 ----
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
    if (r.result && r.result.exceptionDetails) return { __ERR: JSON.stringify(r.result.exceptionDetails).slice(0, 250) };
    return r.result ? r.result.result : undefined;
  };
  const PROBE = `(function(){var w=null;function walk(x){try{if(x.document&&x.document.getElementById&&x.document.getElementById("viewRoot"))w=x;}catch(e){}for(var i=0;i<x.frames.length;i++){try{walk(x.frames[i]);}catch(e){}}}walk(window);return w;})()`;
  const W = `(${PROBE})`;

  await send('Page.navigate', { url: LIVE });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    const r = await ev(`${W}?true:false`);
    if (r && r.value === true) { ready = true; break; }
    await sleep(1500);
  }
  log('S2 线上页面就绪:', ready);
  if (!ready) process.exit(1);

  // 版本特征（v11 特有字符串）
  const ver = (await ev(`(function(){var h=${W}.document.documentElement.outerHTML;
    verTag: (function(){var v=.document.getElementById('verTag');return v?v.innerText:'无';})(), v11确认墓碑:h.indexOf('等拉取裁决确认云端真已删')>=0, v11墓碑重试:h.indexOf('墓碑重试')>=0, v11自动补推:h.indexOf('不再永远等手动')>=0};})()`)).value;
  log('S2 线上版本:', JSON.stringify(ver));

  // 清本机存储（模拟全新用户）→ reload → 等拉取
  await ev('localStorage.clear(); location.reload(); true');
  await sleep(15000);
  await ev(`(function(){var w=${W};if(w&&w.document.querySelector('[data-act="go"][data-view="schedule"]'))w.document.querySelector('[data-act="go"][data-view="schedule"]').click();})()`);
  await sleep(1500);
  const bodyHas = async (s) => (await ev(`${W}?(""+${W}.document.body.innerText).indexOf(${JSON.stringify(s)})>=0:false`)).value;
  const visible = await bodyHas(TAG);
  log('S3 测试记录在日程页可见:', visible, '(期望 true)');

  // ---- 3. 点删除 ----
  const click = (await ev(`(function(){
    var w=${W}; var btns=[].slice.call(w.document.querySelectorAll('[data-act="del"][data-kind="schedule"]'));
    for(var i=0;i<btns.length;i++){
      var row=btns[i].closest('.list-item'); if(row&&row.innerText.indexOf(${JSON.stringify(TAG)})>=0){btns[i].click();return 'CLICKED';}
    } return 'NO_BTN';
  })()`)).value;
  await sleep(4000);
  log('S4 点击删除:', click);

  // ---- 4. 服务端核对：未登录页面删除→401→云端不该有已删除标记 ----
  const recs1 = serverQuery(SCHED_DB);
  const mine1 = recs1.find((r) => {
    const p = r.properties || r; const t = p['标题'];
    return ((typeof t === 'object' && t ? t.text : t) === TAG);
  });
  const flag1 = mine1 ? JSON.stringify((mine1.properties || mine1)['已删除']) : 'RECORD_GONE';
  log('S5 服务端核对（删除后）: 云端记录=', flag1, '(登录过期场景期望已删除不存在/false)');

  // ---- 5. 点「刷新云端数据」→ 记录必须保持隐藏 ----
  await ev(`(function(){var w=${W};var b=w.document.querySelector('[data-act="refresh-cloud"]');if(b)b.click();})()`);
  await sleep(6000);
  for(var k=0;k<3;k++){ await ev(`(function(){var w=${W};var b=w.document.querySelector('[data-act="refresh-cloud"]');if(b)b.click();})()`); await sleep(4000); }
  const afterRefresh = await bodyHas(TAG);
  log('S6 刷新云端数据后 可见:', afterRefresh, '(期望 false ★ 用户报告的复活点)');

  // ---- 6. 整页刷新 → 依然隐藏 ----
  await ev('location.reload(); true');
  await sleep(15000);
  await ev(`(function(){var w=${W};if(w&&w.document.querySelector('[data-act="go"][data-view="schedule"]'))w.document.querySelector('[data-act="go"][data-view="schedule"]').click();})()`);
  await sleep(1500);
  const afterReload = await bodyHas(TAG);
  log('S7 整页刷新后 可见:', afterReload, '(期望 false)');
  const badge = (await ev(`${W}?${W}.document.getElementById('syncBadge').innerText.replace(/\\n/g,' '):''`)).value;
  log('S7 徽章:', badge);

  // ---- 7. 服务端清理 ----
  try { serverApi('batch_delete_database_records.py', `--database-id ${SCHED_DB} --record-ids "[\\"${addId}\\"]"`); log('S8 服务端清理完成'); } catch (e) { log('S8 清理失败(可忽略):', e.message.slice(0, 80)); }

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('04-测试/screenshots/live-e2e-final.png', Buffer.from(shot.result.data, 'base64'));

  const pass = ready && visible === true && click === 'CLICKED' && afterRefresh === false && afterReload === false;
  log(pass ? '=== LIVE E2E: PASS ===' : '=== LIVE E2E: FAIL ===');
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
