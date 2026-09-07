/* 六模块「刷新云端数据」回归测试 v2（拉取路径 · 多端同步场景）
 *
 * 背景：分享页 addRecord/updateRecord 需要登录态（headless 匿名环境 401），
 *      故页面→云端的推送路径无法在无头浏览器验证；
 *      本脚本改为：服务端 API 模拟"另一台设备"对六张表做 增/改/软删，
 *      浏览器端点击「刷新云端数据」，验证拉取后 UI 与云端一致（不丢/不重/不复活/不误删）。
 *
 * 每模块检查点：
 *  A1 服务端新增 → 刷新 → DOM 出现标记，未删除记录数=基线+1，标记仅 1 条
 *  A2 服务端改名 → 刷新 → DOM 显示新标记，旧标记消失，条数不变
 *  A3 服务端软删 → 刷新 → 标记消失，未删除记录数=基线（不复活、不误删）
 *
 * 运行：node 07-脚本/regression-v2.js <CDP端口> <op_ token>
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const PORT = process.argv[2] || '9334';
const TOKEN = process.argv[3] || '';
const APP_URL = 'https://workbuddy.link/p/8ZxrlsT0cik2jMIZ8SOM2o';
const LIB = 'D:/Program Files/WorkBuddy/resources/app.asar.unpacked/resources/plugins/workbuddy-builtin/skills/library/database';
const PY = 'C:/Users/HP/.workbuddy/binaries/python/versions/3.13.12/python.exe';
const DB_IDS = {
  schedule:'68N86PsnmbQqLsN9T3KnTP', todo:'SW82b5oYxenJt2yxoFDdYK',
  translate:'xHK4R1lsTvn7yooUhMYPGa', qa:'QDCvUTxoBMSsECyAvolP4s',
  plan:'STVY3ZPJk79CpGThiDRDLS', info:'xPAXPE6kaWt7Ke4HEOnDyY'
};
const MARK = { schedule:'标题', todo:'标题', translate:'原文', qa:'问题', plan:'规划标题', info:'标题' };
const SHOT_DIR = path.join(__dirname, '..', '04-测试', 'screenshots');
const TAGBASE = '回归测试' + (Date.now()%100000);

function pad(n){return n<10?'0'+n:''+n;}
const TODAY = (function(){var d=new Date();return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());})();
function weekKey(str){
  var p=str.split('-'); var t=new Date(+p[0],+p[1]-1,+p[2]);
  var yr=t.getFullYear(); var day=(t.getDay()+6)%7;
  t.setDate(t.getDate()-day+3);
  var first=new Date(t.getFullYear(),0,4);
  var fday=(first.getDay()+6)%7; first.setDate(first.getDate()-fday+3);
  return yr+'-W'+pad(1+Math.round((t-first)/604800000));
}
const CUR_WEEK = weekKey(TODAY);

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function log(){ console.log(new Date().toISOString().slice(11,19), ...arguments); }

(async () => {

/* ---------- 服务端 API ---------- */
const pyEnv = Object.assign({}, process.env, { no_proxy:'*', http_proxy:'', https_proxy:'', HTTP_PROXY:'', HTTPS_PROXY:'' });
function pyCall(script, bodyObj){
  const input = TOKEN + '\n' + (bodyObj ? JSON.stringify(bodyObj) : '');
  const out = cp.execFileSync(PY, [LIB+'/'+script, '--token-stdin', '--stdin'],
    { input, encoding:'utf8', timeout: 60000, env: pyEnv });
  const line = (out||'').split('\n').map(s=>s.trim()).filter(Boolean).pop() || '';
  try { return JSON.parse(line); } catch(e){ return { error: '非JSON: '+line.slice(0,150) }; }
}
function svAdd(dbId, props){ return pyCall('batch_add_database_records.py', { database_id:dbId, records:[props] }); }
function svUpdate(dbId, recId, props){ return pyCall('batch_update_database_records.py', { database_id:dbId, records:[{ record_id:recId, properties:props }] }); }
function svQuery(dbId){
  const r = pyCall('query_database_record.py', { database_id:dbId });
  if(r.error) return { err:r.error };
  const res = r.results || [];
  return { records: res.map(x=>{ const p={}; Object.keys(x||{}).forEach(k=>{ if(k!=='record_id') p[k]=x[k]; }); return { id:x.record_id, p }; }) };
}

/* ---------- 浏览器 CDP ---------- */
const tabs = await new Promise((res, rej) => { http.get('http://127.0.0.1:'+PORT+'/json/list', r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej); });
const tab = tabs.find(t=>t.type==='page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r=>ws.onopen=r);
let mid=0; const pend={}; const consoleErrs=[];
ws.onmessage = m => {
  const d = JSON.parse(m.data);
  if(d.id && pend[d.id]){ pend[d.id](d); delete pend[d.id]; return; }
  if(d.method==='Log.entryAdded' && ['error','warning'].includes(d.params.entry.level))
    consoleErrs.push(d.params.entry.text.slice(0,180));
};
const send=(m,p={})=>new Promise(r=>{const id=++mid;pend[id]=r;ws.send(JSON.stringify({id,method:m,params:p}));});
const PROBE = "(function(){var w=null; function walk(x){ try{ if(x.document&&x.document.getElementById&&x.document.getElementById('viewRoot')) w=x; }catch(e){} for(var i=0;i<x.frames.length;i++){ try{walk(x.frames[i]);}catch(e){} } } walk(window); return w; })()";
async function ev(expr){
  const r = await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:false});
  if(r.result&&r.result.exceptionDetails) return 'EXC:'+String((r.result.exceptionDetails.exception&&r.result.exceptionDetails.exception.description)||r.result.exceptionDetails.text).slice(0,250);
  return r.result&&r.result.result?r.result.result.value:undefined;
}
async function evP(expr,timeoutMs){
  const wrapped = "(function(){return Promise.race(["+expr+", new Promise(function(res){setTimeout(function(){res('__EVAL_TIMEOUT__');},"+(timeoutMs||20000)+");})]);})()";
  const r = await send('Runtime.evaluate',{expression:wrapped,returnByValue:true,awaitPromise:true});
  if(r.result&&r.result.exceptionDetails) return 'EXC:'+String((r.result.exceptionDetails.exception&&r.result.exceptionDetails.exception.description)||r.result.exceptionDetails.text).slice(0,250);
  return r.result&&r.result.result?r.result.result.value:undefined;
}
async function winReady(){
  for(let i=0;i<40;i++){
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
async function badge(){
  return ev(`(function(){var w=(${PROBE}); if(!w) return 'NO_WIN'; var e=w.document.getElementById('syncBadge'); return e?e.textContent.trim():'NO_BADGE';})()`);
}
async function bodyHas(tag){
  return ev(`(function(){var w=(${PROBE}); if(!w) return 'NO_WIN'; return w.document.body.innerText.indexOf('${tag}')>=0;})()`);
}
async function shot(name){
  const r = await send('Page.captureScreenshot',{format:'png'});
  if(r.result&&r.result.data){
    try{ fs.mkdirSync(SHOT_DIR,{recursive:true}); }catch(e){}
    fs.writeFileSync(path.join(SHOT_DIR,name), Buffer.from(r.result.data,'base64'));
  }
}
/* 云端查询（走页面 SDK，匿名可读） */
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
async function waitBadgeSettled(maxMs){
  const t0=Date.now(); let last='';
  while(Date.now()-t0<maxMs){
    last = await badge();
    if(/已同步|异常|离线/.test(last)) break;
    await sleep(1500);
  }
  await sleep(2000);
  return last;
}
async function refreshAndSettle(){
  await act('refresh-cloud');
  const b = await waitBadgeSettled(40000);
  return b;
}
const nonDel = recs => recs.filter(r=>!isDeleted(r.p));
const withTag = (recs,tag,mod) => recs.filter(r=>getMark(r.p,MARK[mod]).includes(tag));

/* ---------- 各模块服务端测试记录 ---------- */
function addProps(mod, tag){
  switch(mod){
    case 'schedule': return { '标题':{'text':tag}, '日期键':{'text':TODAY}, '开始时间':{'text':'08:00'}, '结束时间':{'text':'08:30'}, '状态':{'select':'待开始'} };
    case 'todo':     return { '标题':{'text':tag}, '截止日期键':{'text':TODAY}, '计划周':{'text':CUR_WEEK}, '状态':{'select':'待办'} };
    case 'translate':return { '原文':{'text':tag}, '译文':{'text':'(服务端写入)'}, '源语言':{'select':'中文'}, '目标语言':{'select':'英文'}, '状态':{'select':'已完成'} };
    case 'qa':       return { '问题':{'text':tag}, '回答':{'text':'(服务端写入)'}, '状态':{'select':'已完成'} };
    case 'plan':     return { '规划标题':{'text':tag}, '周期类型':{'select':'本周'}, '周期键':{'text':CUR_WEEK}, '开始日期键':{'text':TODAY}, '结束日期键':{'text':TODAY}, '状态':{'select':'未开始'} };
    case 'info':     return { '标题':{'text':tag}, '原文摘录':{'text':'服务端写入的回归测试摘录'} };
    default: return {};
  }
}

/* ---------- 单模块回归 ---------- */
async function testModule(mod){
  const tag = TAGBASE+'-'+mod;
  const tag2 = tag+'-改名';
  const R = { mod, tag, checks:{}, errs:[] };
  log('===', mod, '===');

  // 基线（页面视角）
  await act('go', {'data-view':mod});
  await sleep(600);
  let q = await cloudQuery(mod);
  if(q.err){ R.errs.push('基线查询失败:'+q.err); return R; }
  const baseline = nonDel(q.records).length;
  R.baseline = baseline;
  log('基线未删除记录数:', baseline, '| 服务端查询:', svQuery(DB_IDS[mod]).records.length, '条(含已删)');

  /* A1 服务端新增 → 刷新 → 验证 */
  const addRes = svAdd(DB_IDS[mod], addProps(mod, tag));
  if(addRes.error){ R.errs.push('服务端新增失败:'+addRes.error); return R; }
  // 轮询页面 SDK 查询可见（最多 25s）
  let visible=false;
  for(let i=0;i<10;i++){ q = await cloudQuery(mod); if(!q.err && withTag(nonDel(q.records),tag,mod).length===1){ visible=true; break; } await sleep(2500); }
  R.checks.a1 = {};
  if(!visible){ R.errs.push('服务端新增后页面查询 25s 未见记录'); return R; }
  const b1 = await refreshAndSettle();
  R.checks.a1.badge = b1;
  q = await cloudQuery(mod);
  if(q.err){ R.errs.push('A1 刷新后查询失败:'+q.err); return R; }
  R.checks.a1.dom = (await bodyHas(tag))===true;
  R.checks.a1.tagCount = withTag(nonDel(q.records),tag,mod).length;
  R.checks.a1.totalOk = nonDel(q.records).length===baseline+1;
  await shot(`regress2-${mod}-a1-add.png`);
  if(!R.checks.a1.dom) R.errs.push('A1: 刷新后页面未显示新记录');
  if(R.checks.a1.tagCount!==1) R.errs.push('A1: 标记记录出现 '+R.checks.a1.tagCount+' 次');
  if(!R.checks.a1.totalOk) R.errs.push('A1: 未删除记录数 ' + nonDel(q.records).length + ' ≠ 基线+1('+(baseline+1)+')');
  if(/异常/.test(b1)) R.errs.push('A1: 徽章异常 '+b1);
  log('A1 新增→刷新:', JSON.stringify(R.checks.a1));

  /* A2 服务端改名 → 刷新 → 验证 */
  let qq = svQuery(DB_IDS[mod]);
  const rec = (qq.records||[]).find(r=>getMark(r.p,MARK[mod])===tag);
  if(!rec){ R.errs.push('A2: 服务端查询找不到测试记录'); return R; }
  const updProps = {}; updProps[MARK[mod]] = {'text':tag2};
  const uRes = svUpdate(DB_IDS[mod], rec.id, updProps);
  if(uRes.error){ R.errs.push('A2: 服务端更新失败:'+uRes.error); return R; }
  await refreshAndSettle();
  q = await cloudQuery(mod);
  R.checks.a2 = {
    domNew: (await bodyHas(tag2))===true,
    domOldCnt: await ev('(function(){var w=(' + PROBE + '); if(!w) return -1; var t=w.document.body.innerText; var c1=(t.match(new RegExp("' + tag + '","g"))||[]).length; var c2=(t.match(new RegExp("' + tag2 + '","g"))||[]).length; return c1-c2;})()'),
    totalOk: q.err?null:nonDel(q.records).length===baseline+1
  };
  await shot(`regress2-${mod}-a2-update.png`);
  if(!R.checks.a2.domNew) R.errs.push('A2: 刷新后未显示改名后的记录');
  if(!(R.checks.a2.domOldCnt===0)) R.errs.push('A2: 旧标题仍残留 '+R.checks.a2.domOldCnt+' 处');
  if(R.checks.a2.totalOk===false) R.errs.push('A2: 记录数异常');
  log('A2 改名→刷新:', JSON.stringify(R.checks.a2));

  /* A3 服务端软删 → 刷新 → 验证 */
  const dRes = svUpdate(DB_IDS[mod], rec.id, { '已删除':{'checkbox':true} });
  if(dRes.error){ R.errs.push('A3: 服务端软删失败:'+dRes.error); return R; }
  await refreshAndSettle();
  q = await cloudQuery(mod);
  if(q.err){ R.errs.push('A3: 刷新后查询失败:'+q.err); return R; }
  R.checks.a3 = {
    dom: (await bodyHas(tag2))===false,
    totalOk: nonDel(q.records).length===baseline,
    notResurrect: withTag(nonDel(q.records),tag,mod).length===0
  };
  await shot(`regress2-${mod}-a3-delete.png`);
  if(!R.checks.a3.dom) R.errs.push('A3: 软删除后记录仍显示在页面（幽灵复活）');
  if(!R.checks.a3.totalOk) R.errs.push('A3: 未删除记录数 ' + nonDel(q.records).length + ' ≠ 基线 '+baseline+'（误删其他数据或残留）');
  if(!R.checks.a3.notResurrect) R.errs.push('A3: 标记记录复活');
  log('A3 软删→刷新:', JSON.stringify(R.checks.a3));
  return R;
}

/* ---------- 主流程 ---------- */
const results = [];
try {
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  await send('Page.navigate',{url:APP_URL});
  log('页面加载中…');
  if(!(await winReady())){ console.log('FATAL: 未找到应用窗口'); process.exit(1); }
  log('应用窗口已定位');
  for(let i=0;i<40;i++){ const b=await badge(); if(/已同步|异常|离线/.test(b)){ log('首次同步徽章:',b); break; } await sleep(2000); }
  await sleep(2000);

  for(const mod of ['schedule','todo','translate','qa','plan','info']){
    try { results.push(await testModule(mod)); }
    catch(e){ results.push({ mod, errs:['执行异常:'+String(e.message||e).slice(0,150)] }); }
    await sleep(800);
  }

  console.log('\n===== 汇总 =====');
  let pass=0, fail=0;
  for(const R of results){
    const ok = (R.errs||[]).length===0;
    ok?pass++:fail++;
    log((ok?'PASS':'FAIL'), R.mod, (R.errs&&R.errs.length)?('→ '+R.errs.join(' | ')):'→ 全部检查点通过');
  }
  console.log('console 告警条数:', consoleErrs.length);
  consoleErrs.slice(0,8).forEach(e=>console.log('  [console]',e));
  fs.writeFileSync(path.join(__dirname,'regression-v2-result.json'), JSON.stringify({TAGBASE,results,consoleErrs},null,2));
  console.log('DONE pass='+pass+' fail='+fail);
} catch(e){
  console.error('FATAL', e.message);
  fs.writeFileSync(path.join(__dirname,'regression-v2-result.json'), JSON.stringify({TAGBASE,results,consoleErrs,fatal:String(e.message||e)},null,2));
  process.exit(1);
} finally {
  try{ ws.close(); }catch(e){}
  process.exit(0);
}
})();
