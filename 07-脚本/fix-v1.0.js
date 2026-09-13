// 修复 demo.html 的 nav 模板字符串与 verTag 版本号
const fs = require('fs');
const p = '02-原型/demo.html';
let s = fs.readFileSync(p, 'utf8');
const before = s;

const NAV_A = `return '<button class="nav-i'+(state.view===v.id?' active':'')+'" data-act="go" data-view="'+v.id+'">'`;
// 改写：反引号 + 模板插值
const NAV_A_NEW = `return \`<button class="nav-i\${(state.view===v.id?' active':'')}" data-act="go" data-view="\${v.id}">\``;
s = s.replace(NAV_A, NAV_A_NEW);

const NAV_B = `return '<button class="mn-i'+(state.view===v.id?' active':'')+'" data-act="go" data-view="'+v.id+'">'`;
const NAV_B_NEW = `return \`<button class="mn-i\${(state.view===v.id?' active':'')}" data-act="go" data-view="\${v.id}">\``;
s = s.replace(NAV_B, NAV_B_NEW);

// verTag: 1.0
s = s.replace('>v16</span>', '>v1.0</span>');

if (s !== before) {
  fs.writeFileSync(p, s);
  console.log('Patched. 残留 v16 出现次数:', (s.match(/>v16/g) || []).length);
} else {
  console.log('NO CHANGE');
}
