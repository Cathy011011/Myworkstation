#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""逐张创建六张线上数据表，失败字段自动降级重试。输出每张表的 databaseId。"""
import json
import subprocess
import sys

LIB = "D:/Program Files/WorkBuddy/resources/app.asar.unpacked/resources/plugins/workbuddy-builtin/skills/library"
SCHEMA_FILE = "07-脚本/tables-schema.json"
OUT_FILE = "07-脚本/tables-created.json"

# date/url 等复杂 config 的降级链：失败时按顺序尝试
FALLBACKS = {
    "date": [{}, {"date": {"format": "yyyy-mm-dd"}}],
    "url": [{"url": ""}, {"text": ""}],
    "multi_select": [{"multi_select": []}],
    "select": [{"select": ""}],
}


def run_create(token: str, schema: dict):
    """调用 create_database.py，返回 (result_dict, stderr)。"""
    payload = json.dumps(schema, ensure_ascii=False)
    p = subprocess.run(
        [sys.executable, f"{LIB}/database/create_database.py", "--token-stdin", "--schema", payload],
        input=token, capture_output=True, text=True, encoding="utf-8", timeout=60,
    )
    out = (p.stdout or "").strip()
    try:
        return json.loads(out), p.stderr
    except json.JSONDecodeError:
        return {"error": f"非JSON输出: {out[:200]}", "stderr": p.stderr[:300]}, p.stderr


def simplify_schema(schema: dict, drop_field: str, alt_config) -> dict:
    """对失败字段应用替代 config，或直接剔除。"""
    props = []
    for prop in schema["properties"]:
        if prop["name"] == drop_field:
            if alt_config is not None:
                props.append({"name": prop["name"], "config": alt_config})
            # None → 直接剔除
        else:
            props.append(prop)
    return {"title": schema["title"], "properties": props}


def main():
    token = sys.stdin.read().strip()
    tables = json.load(open(SCHEMA_FILE, encoding="utf-8"))["tables"]
    created, failed = [], []

    for schema in tables:
        title = schema["title"]
        print(f"[建表] {title} ...", flush=True)
        res, err = run_create(token, schema)

        # 主请求失败 → 逐字段降级重试
        if "error" in res:
            err_msg = res.get("error", "")
            print(f"  首次失败: {err_msg[:120]}", flush=True)
            # 找出可能的问题字段：date/url/复杂 config
            suspect_types = ("date", "url", "image", "attachment", "person", "currency")
            for prop in schema["properties"]:
                cfg_keys = list(prop["config"].keys())
                if not any(t in suspect_types for t in cfg_keys):
                    continue
                field = prop["name"]
                for alt in FALLBACKS.get(cfg_keys[0], []) + [None]:
                    trial = simplify_schema(schema, field, alt)
                    if trial == schema:
                        continue
                    res2, _ = run_create(token, trial)
                    if "error" not in res2:
                        print(f"  降级字段 [{field}] → 成功", flush=True)
                        schema = trial
                        res = res2
                        break
                    else:
                        print(f"    [{field}] alt={alt} 仍失败: {res2.get('error','')[:80]}", flush=True)
                if "error" not in res:
                    break

        if "error" in res:
            print(f"  ✗ {title} 最终失败: {res.get('error','')[:200]}", flush=True)
            failed.append({"title": title, "error": res.get("error", "")})
        else:
            db_id = res.get("database_id", "")
            cnt = res.get("property_count", 0)
            print(f"  ✓ {title} → {db_id} ({cnt} 字段)", flush=True)
            created.append({"title": title, "database_id": db_id, "property_count": cnt})

    result = {"created": created, "failed": failed}
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"\n=== 完成 {len(created)}/{len(tables)} ===")
    for c in created:
        print(f"  {c['title']}: {c['database_id']}")
    if failed:
        print("失败:", failed)


if __name__ == "__main__":
    main()
