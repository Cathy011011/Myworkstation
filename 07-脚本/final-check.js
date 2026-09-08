// 最终数据核对：各模块条数 + 日程/待办标题 + 截图
const http = require('http');
const fs = require('fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = process.argv[2] || 'https://workbuddy.link/p/OxKRm0lpVdKq8P3qT30q74';
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
  const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true }); const res = r.result ? r.result.result : undefined; return (res && res.value !== undefined) ? res.value : res; };
  const P = `(function(){var w=null;function walk(x){try{if(x.document&&x.document.getElementById&&x.document.getElementById("viewRoot"))w=x;}catch(e){}for(var i=0;i<x.frames.length;i++){try{walk(x.frames[i]);}catch(e){}}}walk(window);return w;})()`;
  const W = `(${P})`;

  await send('Page.navigate', { url: URL });
  await sleep(2000);
  await ev('location.reload(); true');
  await sleep(15000);
  let mode = '';
  for (let i = 0; i < 30; i++) {
    mode = await ev(`${W}&&${W}.__LWB?${W}.__LWB.sync().mode:'no'`);
    if (mode === 'online') break;
    await sleep(2000);
  }
  console.log('同步状态:', mode);
  console.log('版本角标:', await ev(`${W}&&${W}.document.getElementById('verTag')?${W}.document.getElementById('verTag').innerText:'无'`));
  console.log('各模块条数:', await ev(`${W}&&${W}.__LWB?(function(){var d=${W}.__LWB.data();var o={};Object.keys(d).forEach(function(k){o[k]=d[k].length;});return JSON.stringify(o);})():'no'`));
  console.log('日程:', await ev(`${W}&&${W}.__LWB?${W}.__LWB.data().schedule.map(function(x){return x.title;}).join(','):'no'`));
  console.log('待办:', await ev(`${W}&&${W}.__LWB?${W}.__LWB.data().todo.map(function(x){return x.title;}).join(','):'no'`));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('04-测试/screenshots/final-v16.png', Buffer.from(shot.result.data, 'base64'));
  console.log('截图: 04-测试/screenshots/final-v16.png');
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
