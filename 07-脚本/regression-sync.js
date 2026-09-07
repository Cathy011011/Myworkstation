/* 六模块「刷新云端数据」回归测试
 * 流程/模块：新增测试条目 → 等推送 → 点刷新云端数据 → 云端+DOM 验证（不丢不重）
 *          → 删除 → 等软删除推送 → 再刷新 → 验证不复活、不误删其他数据
 * 运行：node 07-脚本/regression-sync.js <CDP端口>   （Chrome 需已带调试端口启动）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.argv[2] || '9333';
const APP_URL = 'https://workbuddy.link/p/8ZxrlsT0cik2jMIZ8SOM2o';
const DB_IDS = {
  schedule:'68N86PsnmbQqLsN9T3KnTP', todo:'SW82b5oYxenJt2yxoFDdYK',
  translate:'xHK4R1lsTvn7yooUhMYPGa', qa:'QDCvUTxoBMSsECyAvolP4s',
  plan:'STVY3ZPJk79CpGThiDRDLS', info:'xPAXPE6kaWt7Ke4HEOnDyY'
};
const MARK = { schedule:'标题', todo:'标题', translate:'原文', qa:'问题', plan:'规划标题', info:'标题' };
const TODAY = (function(){var d=new Date();return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);})();
const TAGBASE = '回归测试' + (Date.now()%100000);
const SHOT_DIR = path.join(__dirname, '..', '04-测试', 'screenshots');

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function log(){ console.log(new Date().toISOString().slice(11,19), ...arguments); }

(async () => {

/* ---------- CDP 基础 ---------- */
async function getPageWs(){
  for(let i=0;i<20;i++){
    try{
      const tabs = await new Promise((res,rej)=>{
        http.get('http://127.0.0.1:'+PORT+'/json/list', r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);
      });
      const tab = tabs.find(t=>t.type==='page');
      if(tab) return tab.webSocketDebuggerUrl;
    }catch(e){}
    await sleep(1000);
  }
  throw new Error('CDP 端口连不上');
}
let mid=0; const pend={}; const consoleErrs=[];
const ws = new WebSocket(await getPageWs());
await new Promise(r=>ws.onopen=r);
ws.onmessage = m => {
  const d = JSON.parse(m.data);
  if(d.id && pend[d.id]){ pend[d.id](d); delete pend[d.id]; return; }
  if(d.method==='Log.entryAdded' && ['error','warning'].includes(d.params.entry.level))
    consoleErrs.push(d.params.entry.text.slice(0,200));
  if(d.method==='Runtime.exceptionThrown')
    consoleErrs.push('EXC: '+String(d.params.exceptionDetails.text||'').slice(0,200));
};
const send=(m,p={})=>new Promise(r=>{const id=++mid;pend[id]=r;ws.send(JSON.stringify({id,method:m,params:p}));});

const PROBE = "(function(){var w=null; function walk(x){ try{ if(x.document&&x.document.getElementById&&x.document.getElementById('viewRoot')) w=x; }catch(e){} for(var i=0;i<x.frames.length;i++){ try{walk(x.frames[i]);}catch(e){} } } walk(window); return w; })()";

async function ev(expr){ /* 普通求值 */
  const r = await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:false});
  if(r.result&&r.result.exceptionDetails) return 'EXC:'+String((r.result.exceptionDetails.exception&&r.result.exceptionDetails.exception.description)||r.result.exceptionDetails.text).slice(0,250);
  return r.result&&r.result.result?r.result.result.value:undefined;
}
async function evP(expr,timeoutMs){ /* 带页内超时的 Promise 求值 */
  const wrapped = "(function(){return Promise.race(["+expr+", new Promise(function(res){setTimeout(function(){res('__EVAL_TIMEOUT__');},"+(timeoutMs||20000)+");})]);})()";
  const r = await send('Runtime.evaluate',{expression:wrapped,returnByValue:true,awaitPromise:true});
  if(r.result&&r.result.exceptionDetails) return 'EXC:'+String((r.result.exceptionDetails.exception&&r.result.exceptionDetails.exception.description)||r.result.exceptionDetails.text).slice(0,250);
  return r.result&&r.result.result?r.result.result.value:undefined;
}

/* ---------- 页面操作（在 app iframe 文档上） ---------- */
async function winReady(){
  for(let i=0;i<40;i++){
    /* 注意：不能直接 returnByValue 返回 Window（CDP 报 reference chain too long），改返回布尔 */
    const w = await ev('('+PROBE+') ? 1 : 0');
    if(w===1) return true;
    await sleep(2000);
  }
  return false;
}
async function act(name, attrs){
  const a = Object.entries(attrs||{}).map(([k,v])=>`b.setAttribute('${k}','${v}')`).join('');
  return ev(`(function(){var w=(${PROBE}); if(!w) return 'NO_WIN'; var b=w.document.createElement('button'); b.setAttribute('data-act','${name}'); ${a}; w.document.body.appendChild(b); b.click(); b.remove(); return 'OK';})()`);
}
async function setVal(id,v){
  return ev(`(function(){var w=(${PROBE}); if(!w) return 'NO_WIN'; var e=w.document.getElementById('${id}'); if(!e) return 'NO_EL'; e.value='${v}'; return 'OK';})()`);
}
async function badge(){
  return ev(`(function(){var w=(${PROBE}); if(!w) return 'NO_WIN'; var e=w.document.getElementById('syncBadge'); return e?e.textContent.trim():'NO_BADGE';})()`);
}
async function bodyHas(tag){
  return ev(`(function(){var w=(${PROBE}); if(!w) return 'NO_WIN'; return w.document.body.innerText.indexOf('${tag}')>=0;})()`);
}
async function alertOff(){
  await ev(`(function(){var w=(${PROBE}); if(!w) return; w.alert=function(){}; w.confirm=function(){return true;};})()`);
}
async function shot(name){
  const r = await send('Page.captureScreenshot',{format:'png'});
  if(r.result&&r.result.data){
    try{ fs.mkdirSync(SHOT_DIR,{recursive:true}); }catch(e){}
    fs.writeFileSync(path.join(SHOT_DIR,name), Buffer.from(r.result.data,'base64'));
  }
}

/* ---------- 云端查询 ---------- */
function cloudQueryExpr(dbId){
  return `(function(){var w=(${PROBE}); if(!w) return Promise.resolve('NO_WIN'); var db=w.__SMART_PAGE__&&w.__SMART_PAGE__.database; if(!db) return Promise.resolve('NO_DB');
    return db.query({databaseId:'${dbId}'}).then(function(r){return JSON.stringify((r&&(r.records||r.results))||[]).slice(0,300000);},function(e){return 'QERR:'+String(e&&e.message||e).slice(0,150);});})()`;
}
function getMark(props, field){
  let v = props[field];
  if(v==null) return '';
  if(typeof v==='string') return v;
  if(typeof v==='object'){
    if(typeof v.text==='string') return v.text;
    if(Array.isArray(v)){ var o=v[0]||{}; return o.text||o.name||o.plain_text||''; }
    return v.name||v.text||'';
  }
  return String(v);
}
function isDeleted(props){
  let v = props['已删除'];
  if(v===true) return true;
  if(v&&typeof v==='object') return v.checkbox===true;
  return false;
}
function parseQuery(raw){
  if(typeof raw!=='string'||raw.startsWith('QERR')||raw.startsWith('NO_')||raw==='__EVAL_TIMEOUT__') return {err:String(raw).slice(0,120)};
  try{
    const arr = JSON.parse(raw);
    return { records: arr.map(r=>{
      if(r&&r.properties&&(r.id||r.record_id)) return {id:r.id||r.record_id, p:r.properties};
      const p={}; Object.keys(r||{}).forEach(k=>{ if(k!=='record_id') p[k]=r[k]; });
      return {id:(r&&(r.record_id!==undefined&&r.record_id))||(r&&r.id)||'', p};
    })};
  }catch(e){ return {err:'PARSE:'+e.message}; }
}
async function cloudQuery(mod){
  const raw = await evP(cloudQueryExpr(DB_IDS[mod]), 20000);
  return parseQuery(raw);
}
async function waitCloud(mod, tag, pred, timeoutMs, label){
  const t0 = Date.now();
  while(Date.now()-t0 < timeoutMs){
    const q = await cloudQuery(mod);
    if(q.records && pred(q.records)) return {ok:true, records:q.records, ms:Date.now()-t0};
    await sleep(2500);
  }
  const q = await cloudQuery(mod);
  return {ok:false, records:q.records||[], ms:Date.now()-t0, label};
}
async function waitBadgeSettled(maxMs){ /* 等同步徽章回到稳定态 */
  const t0=Date.now(); let last='';
  while(Date.now()-t0<maxMs){
    last = await badge();
    if(/已同步|异常|离线/.test(last)) break;
    await sleep(1500);
  }
  await sleep(2000);
  return last;
}
const nonDel = recs => recs.filter(r=>!isDeleted(r.p));
const withTag = (recs,tag,mod) => recs.filter(r=>getMark(r.p,MARK[mod]).includes(tag));

/* ---------- 主流程 ---------- */
const results = [];
async function testModule(mod, addFn){
  const tag = TAGBASE+'-'+mod;
  const R = { mod, tag, steps:{}, errs:[] };
  log('=== 模块', mod, '标记', tag, '===');

  // 基线
  const base = await cloudQuery(mod);
  if(base.err){ R.errs.push('基线查询失败:'+base.err); results.push(R); return R; }
  const baseline = nonDel(base.records).length;
  R.baseline = baseline;
  log('基线未删除记录数:', baseline);

  // 1) 新增
  await act('go', {'data-view':mod});
  await sleep(600);
  const addRes = await addFn(tag);
  R.steps.add = addRes;
  if(!addRes.ok){
    R.errs.push('新增失败:'+addRes.note);
    await shot(`regress-${mod}-addfail.png`);
    results.push(R); return R;
  }
  // 2) 等推送到云端
  const push = await waitCloud(mod, tag,
    recs => withTag(nonDel(recs),tag,mod).length===1, 30000, 'push-add');
  R.steps.pushAdd = { ok:push.ok, ms:push.ms };
  if(!push.ok){ R.errs.push('新增后 30s 内未推送到云端'); results.push(R); return R; }
  log('新增已推送 ✓ ('+push.ms+'ms)');

  // 3) 刷新云端数据 → 验证
  await act('refresh-cloud');
  const b1 = await waitBadgeSettled(35000);
  R.steps.badgeAfterAdd = b1;
  await sleep(1500);
  let q = await cloudQuery(mod);
  if(q.err){ R.errs.push('刷新后查询失败:'+q.err); results.push(R); return R; }
  const nd = nonDel(q.records);
  const tagged = withTag(nd,tag,mod);
  R.steps.afterAddRefresh = {
    badgeOk: !/异常/.test(b1),
    tagCount: tagged.length,
    totalOk: nd.length===baseline+1,
    domOk: (await bodyHas(tag))===true
  };
  await shot(`regress-${mod}-after-add.png`);
  if(tagged.length!==1) R.errs.push('刷新后测试条目出现 '+tagged.length+' 次（应为 1，重或丢）');
  if(nd.length!==baseline+1) R.errs.push('刷新后未删除记录数 '+nd.length+' ≠ 基线+1 ('+(baseline+1)+')，可能丢数据或重复');
  if(/异常/.test(b1)) R.errs.push('刷新后同步徽章异常: '+b1);
  log('新增+刷新验证:', JSON.stringify(R.steps.afterAddRefresh));

  // 4) 删除（找包含标记的卡片上的删除按钮）
  const delClick = await ev(`(function(){
    var w=(${PROBE}); if(!w) return 'NO_WIN';
    var btns=[].slice.call(w.document.querySelectorAll('[data-act="del"]'));
    for(var i=0;i<btns.length;i++){
      var n=btns[i], depth=0;
      while(n && depth<8){ if(n.textContent && n.textContent.indexOf('${tag}')>=0){ btns[i].click(); return 'CLICKED'; } n=n.parentElement; depth++; }
    }
    return 'NOT_FOUND';
  })()`);
  R.steps.delClick = delClick;
  if(delClick!=='CLICKED'){ R.errs.push('页面上找不到测试条目的删除按钮: '+delClick); await shot(`regress-${mod}-delfail.png`); results.push(R); return R; }
  await sleep(400);

  // 5) 等软删除标记推送
  const soft = await waitCloud(mod, tag,
    recs => withTag(recs,tag,mod).length===1 && isDeleted(withTag(recs,tag,mod)[0].p), 30000, 'push-del');
  R.steps.pushDel = { ok:soft.ok, ms:soft.ms };
  if(!soft.ok) R.errs.push('删除后 30s 内云端未见「已删除」标记（软删除推送失败或幂等清理）');
  else log('软删除已推送 ✓ ('+soft.ms+'ms)');

  // 6) 再刷新 → 验证不复活、不误删
  await act('refresh-cloud');
  const b2 = await waitBadgeSettled(35000);
  R.steps.badgeAfterDel = b2;
  await sleep(1500);
  q = await cloudQuery(mod);
  if(!q.err){
    const nd2 = nonDel(q.records);
    const tagAlive = withTag(nd2,tag,mod).length;
    const allRecs = withTag(q.records,tag,mod).length;
    R.steps.afterDelRefresh = {
      badgeOk: !/异常/.test(b2),
      resurrect: tagAlive>0,
      softMarkExists: allRecs>=1,
      totalOk: nd2.length===baseline,
      domOk: (await bodyHas(tag))===false
    };
    if(tagAlive>0) R.errs.push('幽灵复活：刷新后测试条目仍以未删除状态存在 '+tagAlive+' 条');
    if(nd2.length!==baseline) R.errs.push('删除+刷新后未删除记录数 '+nd2.length+' ≠ 基线 '+baseline+'（误删了其他数据或重复）');
    if(/异常/.test(b2)) R.errs.push('删除刷新后徽章异常: '+b2);
  } else { R.errs.push('删除刷新后查询失败:'+q.err); }
  await shot(`regress-${mod}-after-del.png`);
  log('删除+刷新验证:', JSON.stringify(R.steps.afterDelRefresh||{}));
  results.push(R);
  return R;
}

/* ---------- 各模块新增方式 ---------- */
const adders = {
  schedule: async tag => {
    let r = await setVal('scTitle', tag); if(r!=='OK') return {ok:false,note:'scTitle:'+r};
    await setVal('scDate', TODAY); await setVal('scStart','08:00'); await setVal('scEnd','08:30'); await setVal('scType','其他'); await setVal('scPlace','测试');
    await act('add-schedule'); return {ok:true};
  },
  todo: async tag => {
    let r = await setVal('tdTitle', tag); if(r!=='OK') return {ok:false,note:'tdTitle:'+r};
    await setVal('tdPriority','一般'); await setVal('tdDue',TODAY); await setVal('tdDomain','工作');
    await act('add-todo'); return {ok:true};
  },
  translate: async tag => {
    let r = await setVal('trSrc','Hello regression world '+tag); if(r!=='OK') return {ok:false,note:'trSrc:'+r};
    await act('do-translate');
    const t0=Date.now();
    while(Date.now()-t0<60000){ if((await bodyHas(tag))===true) return {ok:true,ms:Date.now()-t0}; await sleep(3000); }
    return {ok:false,note:'LLM 60s 未返回或条目未入列表'};
  },
  qa: async tag => {
    let r = await setVal('qaQ','回归测试：'+tag+' 请回答"1"'); if(r!=='OK') return {ok:false,note:'qaQ:'+r};
    await act('do-ask');
    const t0=Date.now();
    while(Date.now()-t0<60000){ if((await bodyHas(tag))===true) return {ok:true,ms:Date.now()-t0}; await sleep(3000); }
    return {ok:false,note:'LLM 60s 未返回或条目未入列表'};
  },
  plan: async tag => {
    let r = await setVal('plTitle', tag); if(r!=='OK') return {ok:false,note:'plTitle:'+r};
    await setVal('plCycle','本周'); await setVal('plKr','回归验证'); await setVal('plDomain','工作');
    await act('add-plan'); return {ok:true};
  },
  info: async tag => {
    let r = await setVal('inTitle', tag); if(r!=='OK') return {ok:false,note:'inTitle:'+r};
    await setVal('inQuote','回归测试摘录'); await setVal('inNote','回归测试笔记');
    await act('add-info'); return {ok:true};
  }
};

/* ---------- 启动 ---------- */
try {
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  await send('Page.navigate',{url:APP_URL});
  log('页面加载中…');
  if(!(await winReady())){ console.log('FATAL: 30s 内未找到应用窗口'); process.exit(1); }
  await alertOff();
  log('应用窗口已定位，等待首次云端拉取…');
  for(let i=0;i<40;i++){ const b=await badge(); if(/已同步|异常|离线/.test(b)){ log('首次同步徽章:',b); break; } await sleep(2000); }
  await sleep(3000);

  // 注入 LLM 配置（翻译/问答真实调用）
  let llmCfg=null;
  try{
    const models = JSON.parse(fs.readFileSync('C:/Users/HP/.workbuddy/models.json','utf8'));
    const m = models.find(x=>x.id==='gpt-5.6-sol')||models[0];
    if(m&&m.url&&m.apiKey){
      llmCfg={provider:'custom',baseURL:m.url,model:m.id,key:m.apiKey};
      await ev(`(function(){var w=(${PROBE}); w.localStorage.setItem('lwb_llm', JSON.stringify(${JSON.stringify(llmCfg)})); return 'OK';})()`);
      log('已注入 LLM 配置:', m.id);
    }
  }catch(e){ log('LLM 配置读取失败（翻译/问答将按失败路径记录）:', e.message); }

  for(const mod of ['schedule','todo','translate','qa','plan','info']){
    await testModule(mod, adders[mod]);
    await sleep(1000);
  }

  // 全视图切换冒烟
  const nav={};
  for(const v of ['overview','schedule','todo','translate','qa','plan','info']){
    await act('go',{'data-view':v}); await sleep(500);
    nav[v]=(await bodyHas('undefined')===false) && !(await ev('(function(){return document.body.innerText.indexOf("Error")>=0||document.body.innerText.indexOf("Exception")>=0;})()'));
  }
  log('全视图冒烟:', JSON.stringify(nav));

  // 汇总
  console.log('\n===== 汇总 =====');
  let pass=0, fail=0;
  for(const R of results){
    const ok = R.errs.length===0;
    ok?pass++:fail++;
    log((ok?'PASS':'FAIL'), R.mod, R.errs.length?('→ '+R.errs.join(' | ')):'→ 全部检查点通过');
  }
  console.log('console 错误/告警条数:', consoleErrs.length);
  consoleErrs.slice(0,10).forEach(e=>console.log('  [console]',e));
  fs.writeFileSync(path.join(__dirname,'regression-result.json'), JSON.stringify({TAGBASE,results,nav,consoleErrs},null,2));
  console.log('DONE pass='+pass+' fail='+fail);
} catch(e){
  console.error('FATAL', e.message);
  fs.writeFileSync(path.join(__dirname,'regression-result.json'), JSON.stringify({TAGBASE,results,consoleErrs,fatal:e.message},null,2));
  process.exit(1);
} finally {
  try{ ws.close(); }catch(e){}
  process.exit(0);
}
})();
