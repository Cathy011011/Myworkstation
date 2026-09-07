# -*- coding: utf-8 -*-
"""生成墓碑机制测试页：demo.html + 注入 mock 云端 SDK（query 返回幽灵记录，写入全部 401）"""
import re, sys

SRC = r"D:/算法话画工作室/海之花严格致远教育科技有限公司/第三节课 WB工作台 V2/02-原型/demo.html"
DST = r"D:/算法话画工作室/海之花严格致远教育科技有限公司/第三节课 WB工作台 V2/07-脚本/test-tomb.html"

MODE = sys.argv[1] if len(sys.argv) > 1 else "live"   # live=云端有活记录 | softdel=云端已软删
DST = r"D:/算法话画工作室/海之花严格致远教育科技有限公司/第三节课 WB工作台 V2/07-脚本/" + (
    "test-tomb.html" if MODE == "live" else "test-tomb-softdel.html")

GHOST_REC = '{"id":"ghost1","properties":{"标题":{"text":"幽灵测试任务"},"日期键":{"text":"2026-09-07"}}}'
if MODE == "softdel":
    GHOST_REC = '{"id":"ghost1","properties":{"标题":{"text":"幽灵测试任务"},"日期键":{"text":"2026-09-07"},"已删除":true}}'

MOCK = """<script>
/* ==== TEST MOCK: 模拟云端 schedule 表有一条 ghost1 记录；所有写入 401（模拟登录过期） ==== */
window.__SMART_PAGE__={database:{
  query:function(req){
    if(req.databaseId==='68N86PsnmbQqLsN9T3KnTP'){
      return Promise.resolve({records:[%GHOST%]});
    }
    return Promise.resolve({records:[]});
  },
  addRecord:function(){ return Promise.reject(new Error('HTTP 401 not login')); },
  updateRecord:function(){ return Promise.reject(new Error('HTTP 401 not login')); },
  deleteRecord:function(){ return Promise.reject(new Error('HTTP 401 not login')); }
}};
</script>"""

MOCK = MOCK.replace("%GHOST%", GHOST_REC)

html = open(SRC, encoding="utf-8").read()
idx = html.rindex("<script>")
html = html[:idx] + MOCK + "\n" + html[idx:]
open(DST, "w", encoding="utf-8").write(html)
print("WROTE", DST, "mode=", MODE)
