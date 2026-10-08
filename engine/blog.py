"""ホットペッパービューティーで公開されているお店のブログを、スタッフごとに集める。

  python -m engine.blog

結果は docs/data/blogs.json に保存され、アプリの「ブログ」タブが読む。
すでに保存してある記事は取り直さない（配信元への負担を減らすため）。
標準ライブラリのみ使用。
"""
import html
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

from engine import config

JST = timezone(timedelta(hours=9))
UA = "Mozilla/5.0 (compatible; salon-helper; once-a-day)"
_last_fetch = 0.0


def fetch(url):
    """ページを取得する。前回の取得から WAIT_SECONDS 秒あける。"""
    global _last_fetch
    if config.FIXTURE_DIR:
        name = re.sub(r"[^A-Za-z0-9]+", "_", url.split("://", 1)[-1]).strip("_") + ".html"
        with open(os.path.join(config.FIXTURE_DIR, name), encoding="utf-8") as f:
            return f.read()
    wait = config.WAIT_SECONDS - (time.time() - _last_fetch)
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "ja"})
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.read().decode("utf-8", errors="replace")
    finally:
        _last_fetch = time.time()


def text_of(fragment):
    """HTMLの一部を、改行を残したふつうの文章にする。"""
    s = re.sub(r"<br\s*/?>", "\n", fragment, flags=re.I)
    s = re.sub(r"<div class=\"taC\">.*?</div>", "", s, flags=re.S)  # 記事内の写真
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s).replace("\xa0", " ")
    s = re.sub(r"[ \t]+\n", "\n", s)
    return re.sub(r"\n{3,}", "\n\n", s).strip()


def parse_staff_list(page):
    """ブログ一覧の右側にある「スタッフ名（記事数）」の一覧を読む。"""
    staff = []
    pat = r'<a[^>]+href="https://beauty\.hotpepper\.jp/sln%s/blog/(T\d+)/"[^>]*>(.*?)</a>' % config.SALON_ID
    for m in re.finditer(pat, page, re.S):
        label = text_of(m.group(2))
        cnt = re.search(r"[（(](\d+)[）)]\s*$", label)
        name = re.sub(r"\s*[（(]\d+[）)]\s*$", "", label).strip()
        name = re.sub(r"\s+", " ", name)
        if not any(s["id"] == m.group(1) for s in staff):
            staff.append({"id": m.group(1), "name": name, "total": int(cnt.group(1)) if cnt else None})
    return staff


def parse_post_list(page):
    """ブログ一覧ページから、記事の番号・題名・投稿日・分類を読む。"""
    posts = []
    for block in re.findall(r'<li class="blogListCassette.*?</li>', page, re.S):
        bid = re.search(r"/blog/bid(A\d+)\.html", block)
        title = re.search(r'<div class="blogListTtl"><a[^>]*>(.*?)</a>', block, re.S)
        date = re.search(r"投稿日：</dt><dd[^>]*>([\d/]+)</dd>", block)
        cat = re.search(r'class="fl blogCategory[^"]*"\s*>(.*?)</div>', block, re.S)
        if not (bid and title):
            continue
        posts.append({
            "id": bid.group(1),
            "title": text_of(title.group(1)),
            "date": date.group(1) if date else "",
            "category": text_of(cat.group(1)) if cat else "",
        })
    return posts


def parse_post(page):
    """記事ページから本文と、投稿者の肩書き・ひとことを読む。"""
    out = {}
    m = re.search(r'<dl class="blogDtlInner"><dt>(.*?)</dt><dd>(.*?)</dd></dl>', page, re.S)
    if m:
        out["title"] = text_of(m.group(1))
        out["body"] = text_of(m.group(2))
    side = re.search(r'<div class="blogSidePosterCnt">(.*?)<div class="mT15">', page, re.S)
    if side:
        role = re.search(r'<p class="fgPink[^"]*">(.*?)</p>', side.group(1), re.S)
        catch = re.search(r'<p class="fs10 mT5 fgGray">(.*?)</p>', side.group(1), re.S)
        if role:
            out["role"] = text_of(role.group(1))
        if catch:
            out["catch"] = text_of(catch.group(1))
    return out


def load_existing():
    try:
        with open(config.OUT_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def run():
    old = load_existing()
    old_posts = {p["id"]: p for s in old.get("staff", []) for p in s.get("posts", [])}
    old_staff = {s["id"]: s for s in old.get("staff", [])}

    top = fetch(config.BASE_URL)
    staff_list = parse_staff_list(top)
    if not staff_list:
        print("スタッフ一覧が読めませんでした（ページの作りが変わった可能性）", file=sys.stderr)
        return 1

    result = []
    new_count = 0
    for st in staff_list:
        prev = old_staff.get(st["id"], {})
        entry = {"id": st["id"], "name": st["name"], "total": st["total"],
                 "role": prev.get("role", ""), "catch": prev.get("catch", ""), "posts": []}
        # 記事数が前回と同じなら、一覧も取り直さない
        if prev and prev.get("total") == st["total"] and prev.get("posts"):
            entry["posts"] = prev["posts"]
            result.append(entry)
            continue
        try:
            listing = parse_post_list(fetch(f"{config.BASE_URL}{st['id']}/"))
        except Exception as e:  # 1人分失敗しても他の人は続ける
            print(f"{st['name']}: 一覧の取得に失敗 {e}", file=sys.stderr)
            entry["posts"] = prev.get("posts", [])
            result.append(entry)
            continue
        for item in listing[:config.POSTS_PER_STAFF]:
            if item["id"] in old_posts and old_posts[item["id"]].get("body"):
                entry["posts"].append(old_posts[item["id"]])
                continue
            try:
                detail = parse_post(fetch(f"{config.BASE_URL}bid{item['id']}.html"))
            except Exception as e:
                print(f"{item['id']}: 記事の取得に失敗 {e}", file=sys.stderr)
                continue
            if not detail.get("body"):
                continue
            entry["role"] = detail.get("role") or entry["role"]
            entry["catch"] = detail.get("catch") or entry["catch"]
            entry["posts"].append({**item, "title": detail.get("title") or item["title"], "body": detail["body"]})
            new_count += 1
        result.append(entry)

    # 中身が前回と同じなら更新日時も変えない（毎日むだな保存をしないため）
    same = old.get("staff") == result
    data = {
        "updated": old.get("updated") if same and old.get("updated") else datetime.now(JST).strftime("%Y-%m-%d %H:%M"),
        "salon": {"id": config.SALON_ID, "name": config.SALON_NAME, "url": config.BASE_URL},
        "staff": result,
    }
    os.makedirs(os.path.dirname(config.OUT_PATH), exist_ok=True)
    with open(config.OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print(f"スタッフ {len(result)} 人 / 新しく取得した記事 {new_count} 件")
    return 0


if __name__ == "__main__":
    sys.exit(run())
