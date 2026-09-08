// 六模块逐页综合测试（每模块 3 项）：输入保护 / 新增防丢（延迟拉取竞态）/ 删除防复活
// 覆盖 6×3=18 断言。前置：headless Chrome(9334) + 本机 HTTP(9511)
const http = require('http');
const fs = require('fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const PORT = 9511;

const MODS = [
  { view: 'schedule',  input: 'scTitle', addAct: 'add-schedule',  kind: 'schedule',  pre: '预置-日程'  },
  { view: 'todo',      input: 'tdTitle', addAct: 'add-todo',      kind: 'todo',      pre: '预置-待办'  },
  { view: 'translate', input: 'trSrc',   addAct: 'do-translate',  kind: 'translate', pre: '预置-翻译', textarea: true },
  { view: 'qa',        input: 'qaQ',     addAct: 'do-ask',        kind: 'qa',        pre: '预置-问答', textarea: true },
  { view: 'plan',      input: 'plTitle', addAct: 'add-plan',      kind: 'plan',      pre: '预置-规划'  },
  { view: 'info',      input: 'inTitle', addAct: 'add-info',      kind: 'info',      pre: '预置-信息'  },
];

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
    if (r.result && r.result.exceptionDetails) return { __ERR: JSON.stringify(r.result.exceptionDetails).slice(0, 200) };
    const res = r.result ? r.result.result : undefined;
    return (res && typeof res === 'object' && res.value !== undefined) ? res.value : res;
  };
  const P = `(function(){var w=null;function walk(x){try{if(x.document&&x.document.getElementById&&x.document.getElementById("viewRoot"))w=x;}catch(e){}for(var i=0;i<x.frames.length;i++){try{walk(x.frames[i]);}catch(e){}}}walk(window);return w;})()`;
  const W = `(${P})`;
  const nav = async (u) => { await send('Page.navigate', { url: u }); await sleep(2500); for (let i = 0; i < 40; i++) { const r = await ev(`${W}?${W}.__LWB?true:false:false`); if (i%6===0) log(`nav poll ${i}: ${JSON.stringify(r)}`); if (r === true) { await sleep(9000); return true; } await sleep(1500); } return false; };
  const goto = async (view) => { await ev(`${W}.document.querySelector('[data-act="go"][data-view="${view}"]').click();`); await sleep(500); };
  const bodyHas = async (s) => (await ev(`${W}?(""+${W}.document.body.innerText).indexOf(${JSON.stringify(s)})>=0:false`)) === true;
  const refresh = async () => { await ev(`(function(){var b=${W}.document.querySelector('[data-act="refresh-cloud"]');if(b)b.click();})()`); await sleep(2500); };

  const results = {}; let pass = true;

  await nav(`http://127.0.0.1:${PORT}/test-all.html`);
  await ev('try{localStorage.clear();}catch(e){} location.reload(); true');
  let okNav=false; for(let att=0;att<3&&!okNav;att++){ okNav = await nav(`http://127.0.0.1:${PORT}/test-all.html`); log('尝试'+att+':'+okNav); }
  log('页面就绪:', okNav);
  // 写入 AI 配置（翻译/问答新增需要），再重载一次
  await ev(`(function(){try{localStorage.setItem('lwb_llm',JSON.stringify({baseURL:'https://mock.local/v1/chat/completions',model:'mock-model',key:'mk'}));}catch(e){}})()`);
  await ev('location.reload(); true');
  for (let i = 0; i < 40; i++) { const r = await ev(`${W}?${W}.__LWB?true:false`); if (r === true) break; await sleep(1500); }
  await sleep(8000);
  if (!okNav) process.exit(1);

  for (let i = 0; i < MODS.length; i++) {
    const M = MODS[i]; const tag = M.view;
    await goto(M.view);

    // ---- T1 输入保护：填表 → 切走再切回（触发两次全量渲染）→ 内容仍在 ----
    const val = '输入保护-' + tag;
    await ev(`${W}.document.getElementById(${JSON.stringify(M.input)}).value=${JSON.stringify(val)};`);
    await ev(`${W}.document.querySelector('[data-act="go"][data-view="${M.view}"]').click();`); await sleep(400);
    const kept = (await ev(`${W}.document.getElementById(${JSON.stringify(M.input)})?${W}.document.getElementById(${JSON.stringify(M.input)}).value:''`));
    const t1 = kept === val;
    results['T1_' + tag] = t1; if (!t1) pass = false;
    log(`[${i + 1}/6 ${tag}] T1 输入保护:`, t1 ? 'PASS' : 'FAIL ' + JSON.stringify(kept));

    // ---- T2 新增防丢：点新增 → 立即连续刷新（前两次查询云端还没有该记录）→ 任务必须还在 ----
    await ev(`(function(){var i=${W}.document.getElementById(${JSON.stringify(M.input)});if(i)i.value=${JSON.stringify('新增防丢-' + tag)};})()`);
    const addBtn = await ev(`(function(){var b=${W}.document.querySelector('[data-act="${M.addAct}"]');if(!b)return 'NO_BTN';b.click();return 'CLICKED';})()`);
    await sleep(2500);   // 等推送成功（此刻云端延迟未返回）
    await refresh(); await refresh();   // 两次延迟查询
    const t2a = await bodyHas('新增防丢-' + tag);
    await sleep(4000);   // 等延迟窗口过去
    await refresh();
    const t2b = await bodyHas('新增防丢-' + tag);
    const t2 = (addBtn === 'CLICKED') && t2a && t2b;
    results['T2_' + tag] = t2; if (!t2) pass = false;
    log(`[${i + 1}/6 ${tag}] T2 新增防丢:`, t2 ? 'PASS' : 'FAIL', `(点击=${addBtn} 立即=${t2a} 延迟后=${t2b})`);

    // ---- T3 删除防复活：删除刚新增的任务 → 连续刷新（云端假成功仍返回）→ 不得复活 ----
    // 找到该任务所在行的删除按钮
    const delClick = await ev(`(function(){
      var w=${W}; var it=null;
      (${W}.__LWB.data()[${JSON.stringify(M.kind)}]||[]).forEach(function(x){
        if((x.title||x.src||x.q)===${JSON.stringify('新增防丢-' + tag)}) it=x;
      });
      if(!it) return 'NO_ITEM';
      var b=w.document.querySelector('[data-act="del"][data-kind="${M.kind}"][data-id="'+it.id+'"]');
      if(!b) return 'NO_BTN';
      b.click(); return 'CLICKED';
    })()`);
    await sleep(2500);
    const t3a = !(await bodyHas('新增防丢-' + tag));
    await refresh(); await refresh(); await refresh();
    const t3b = !(await bodyHas('新增防丢-' + tag));
    const t3 = (delClick === 'CLICKED') && t3a && t3b;
    results['T3_' + tag] = t3; if (!t3) pass = false;
    log(`[${i + 1}/6 ${tag}] T3 删除防复活:`, t3 ? 'PASS' : 'FAIL', `(点击=${delClick} 删除即隐=${t3a} 连刷后=${t3b})`);
  }

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  try { fs.mkdirSync('04-测试/screenshots', { recursive: true }); } catch (e) {}
  fs.writeFileSync('04-测试/screenshots/allmodules-v15.png', Buffer.from(shot.result.data, 'base64'));

  const passed = Object.keys(results).filter(k => results[k]).length;
  log(`=== 六模块综合测试: ${passed}/18 PASS ${pass ? '（全部通过）' : '（存在失败）'} ===`);
  if (!pass) console.log('失败项:', Object.keys(results).filter(k => !results[k]).join(', '));
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
