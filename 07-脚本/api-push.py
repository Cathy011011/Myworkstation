# -*- coding: utf-8 -*-
"""通过 GitHub Git Data API 将本地 HEAD 提交推送到远程分支。

适用场景：github.com:443 的 git 协议端口被网络阻断（git push/fetch 连接失败），
但 api.github.com 可访问。本脚本产生与 git push 完全等效的结果。

用法：
    python api-push.py <owner/repo> [branch] [message]

Token 来源（按序取第一个非空值）：
    1. 命令行环境变量 GITHUB_TOKEN
    2. 本机 ~/.git-credentials 中 host=github.com 的密码

特性：
    - 自动读取本地 HEAD 提交的全部文件（git ls-tree -r -c core.quotepath=false，
      中文路径保持原样，绝不转义）
    - 默认基于远程当前树做增量 tree；若检测到远程存在被转义污染的路径
      （包含反斜杠或以引号开头），自动改为全量替换树，清除污染条目
    - 快进更新目标分支，避免覆盖他人提交
"""
import base64
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

os.environ["no_proxy"] = "*"
for k in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY"):
    os.environ.pop(k, None)

REPO = sys.argv[1] if len(sys.argv) > 1 else "Cathy011011/Myworkstation"
BRANCH = sys.argv[2] if len(sys.argv) > 2 else "main"
MSG = sys.argv[3] if len(sys.argv) > 3 else None


def load_token():
    tok = os.environ.get("GITHUB_TOKEN", "").strip()
    if tok:
        return tok
    cred = os.path.expanduser("~/.git-credentials")
    if os.path.exists(cred):
        for line in open(cred, encoding="utf-8"):
            if "github.com" in line:
                # https://user:token@github.com
                try:
                    return line.split("@")[0].split(":", 2)[2].strip()
                except IndexError:
                    pass
    raise SystemExit("未找到 GitHub Token：请设置 GITHUB_TOKEN 或写入 ~/.git-credentials")


TOKEN = load_token()
NAME = subprocess.check_output(["git", "config", "user.name"]).decode().strip()
EMAIL = subprocess.check_output(["git", "config", "user.email"]).decode().strip()


def api(method, path, payload=None):
    url = "https://api.github.com" + path
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + TOKEN)
    req.add_header("Accept", "application/vnd.github+json")
    if data:
        req.add_header("Content-Type", "application/json")
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                body = r.read()
                return json.loads(body) if body else {}
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")
            if "rate limit" in body.lower():
                time.sleep(10)
                continue
            raise RuntimeError(f"{method} {path} -> {e.code}: {body[:300]}")
        except Exception as e:
            if attempt == 3:
                raise
            print(f"  retry {attempt + 1} ({e})", flush=True)
            time.sleep(5)


def is_mangled(path):
    return "\\" in path or path.startswith('"')


def main():
    global MSG
    # 1. 本地 HEAD 文件清单（quotepath=false 保证中文路径原样）
    out = subprocess.check_output(
        ["git", "-c", "core.quotepath=false", "ls-tree", "-r", "HEAD"]
    ).decode("utf-8")
    entries = []
    for line in out.splitlines():
        meta, path = line.split("\t", 1)
        mode, _otype, sha = meta.split()
        blob = subprocess.check_output(["git", "cat-file", "blob", sha])
        entries.append({"path": path, "mode": mode, "blob": blob})
        if is_mangled(path):
            raise SystemExit(f"本地路径异常，中止：{path!r}")
    if MSG is None:
        MSG = subprocess.check_output(
            ["git", "log", "-1", "--format=%s"]
        ).decode("utf-8").strip()
    print(f"local entries: {len(entries)} (HEAD message: {MSG!r})")

    # 2. 远程当前分支与树
    ref = api("GET", f"/repos/{REPO}/git/ref/heads/{BRANCH}")
    base_commit = ref["object"]["sha"]
    base_tree = api("GET", f"/repos/{REPO}/git/commits/{base_commit}")["tree"]["sha"]
    print(f"remote {BRANCH} = {base_commit}")

    # 3. 检测远程是否已有污染路径
    remote_tree = api(
        "GET", f"/repos/{REPO}/git/trees/{base_tree}?recursive=1"
    )
    mangled = [t["path"] for t in remote_tree.get("tree", []) if is_mangled(t["path"])]
    full_replace = bool(mangled)
    if mangled:
        print(f"检测到 {len(mangled)} 个转义污染路径，将全量替换树以清除：")
        for p in mangled[:8]:
            print("  DEL", p)
        if len(mangled) > 8:
            print(f"  ... 共 {len(mangled)} 个")

    # 4. 逐个创建 blob
    items = []
    for i, e in enumerate(entries):
        r = api(
            "POST",
            f"/repos/{REPO}/git/blobs",
            {"content": base64.b64encode(e["blob"]).decode(), "encoding": "base64"},
        )
        items.append({"path": e["path"], "mode": e["mode"], "type": "blob", "sha": r["sha"]})
        print(f"blob {i + 1}/{len(entries)}: {e['path']}", flush=True)

    # 5. 构建树：污染时全量替换（不带 base_tree），否则增量
    payload = {"tree": items}
    if not full_replace:
        payload["base_tree"] = base_tree
    tree = api("POST", f"/repos/{REPO}/git/trees", payload)
    print(f"tree created: {tree['sha']}")

    # 6. 提交并快进更新分支
    now = time.strftime("%Y-%m-%dT%H:%M:%S+08:00")
    commit = api(
        "POST",
        f"/repos/{REPO}/git/commits",
        {
            "message": MSG,
            "tree": tree["sha"],
            "parents": [base_commit],
            "author": {"name": NAME, "email": EMAIL, "date": now},
            "committer": {"name": NAME, "email": EMAIL, "date": now},
        },
    )
    api("PATCH", f"/repos/{REPO}/git/refs/heads/{BRANCH}",
        {"sha": commit["sha"], "force": False})
    print(f"commit {commit['sha']} -> {BRANCH} updated OK")

    # 7. 核验
    check = api("GET", f"/repos/{REPO}/git/trees/{tree['sha']}?recursive=1")
    n = len([t for t in check.get("tree", []) if t["type"] == "blob"])
    bad = [t["path"] for t in check.get("tree", []) if is_mangled(t["path"])]
    print(f"verified: remote now has {n} files, mangled={len(bad)}")
    if bad:
        raise SystemExit(f"仍有污染路径：{bad[:5]}")


main()
