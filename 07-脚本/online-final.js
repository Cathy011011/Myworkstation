/* 探针 final：观察 seed 推送全程 + 手动验证 addRecord 写通道 */
(async () => {
  const http = require('http');
  const PORT = process.argv[2];
  const tabs = await new Promise((res, rej) => {
    http.get('http://127.0.0.1:' + PORT + '/json/list', r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }).on('error', rej);
  });
  const tab = tabs.find(t => t.type === 'page');
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let mid = 0; const pend = {};
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
  const send = (m, p = {}) => new Promise(r => { const id = ++mid; pend[id] = r; ws.send(JSON.stringify({ id, method: m, params: p })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result && r.result.exceptionDetails) return 'EXC:' + String((r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description) || r.result.exceptionDetails.text).slice(0,250); return r.result && r.result.result ? r.result.result.value : undefined; };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  await send('Page.navigate', { url: 'https://workbuddy.link/p/8ZxrlsT0cik2jMIZ8SOM2o' });
  for (let i = 0; i < 30; i++) { await sleep(3000); const st = await ev('(function(){return {bodyLen:document.body?document.body.innerHTML.length:0, frames:window.frames.length};})()'); if (st.frames > 0 && st.bodyLen > 1000) break; }
  await sleep(5000);

  const probe = "(function(){var w=null; function walk(x){ try{ if(x.document&&x.document.getElementById&&x.document.getElementById('viewRoot')) w=x; }catch(e){} for(var i=0;i<x.frames.length;i++){ try{walk(x.frames[i]);}catch(e){} } } walk(window); return w; })()";
  const badgeIn = "(function(){var __w=(" + probe + "); if(!__w) return 'NO_WIN'; var el=__w.document.getElementById('syncBadge'); return el?el.textContent.trim():'NO_BADGE';})()";

  // 观察徽章 60 秒
  const track = [];
  for (let i = 0; i < 20; i++) {
    await sleep(3000);
    const b = await ev(badgeIn);
    if (track[track.length-1] !== b) { track.push(b); console.error('t+' + ((i+1)*3) + 's: ' + b); }
    if (/已同步/.test(b) && i > 3) break;
  }
  console.log('BADGE_TRACK:', JSON.stringify(track));

  // 手动 addRecord 写通道验证
  const addTest = "(function(){var __w=(" + probe + "); if(!__w) return 'NO_WIN'; var db=__w.__SMART_PAGE__&&__w.__SMART_PAGE__.database; if(!db) return 'NO_DB'; return Promise.race([ db.addRecord({databaseId:'68N86PsnmbQqLsN9T3KnTP', properties:{'标题':{'text':'手动写通道验证'},'日期键':{'text':'2026-09-07'}}}).then(function(r){return 'ADD_OK:'+JSON.stringify(r).slice(0,150);},function(e){return 'ADD_ERR:'+String(e&&e.message||e).slice(0,120);}), new Promise(function(res){setTimeout(function(){res('ADD_TIMEOUT');},30000);}) ]); })()";
  console.log('ADD_TEST:', await ev(addTest));
  await sleep(2000);
  console.log('BADGE_FINAL:', await ev(badgeIn));
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
