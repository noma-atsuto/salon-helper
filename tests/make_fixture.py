"""ネットに接続せずにブログ取得を試すための、模擬ページを作る。"""
import os
import re
import sys

SALON = "H000719005"
BASE = f"https://beauty.hotpepper.jp/sln{SALON}/blog/"
STAFF = [("T000000001", "山田 太郎", 3), ("T000000002", "佐藤 次郎", 2)]


def fname(url):
    return re.sub(r"[^A-Za-z0-9]+", "_", url.split("://", 1)[-1]).strip("_") + ".html"


def item(bid, title, date):
    return (f'<li class="blogListCassette cFix"><div class="fl blogCategory dynamicBlogCategoryBL02" >おすすめスタイル</div>'
            f'<dl class="cFix"><dt class="fl">投稿日：</dt><dd class="fl">{date}</dd></dl>'
            f'<div class="blogListTtl"><a href="{BASE}bid{bid}.html">{title}</a></div></li>')


def main(out):
    os.makedirs(out, exist_ok=True)
    side = "".join(f'<a href="{BASE}{sid}/">{name} （{n}）</a>' for sid, name, n in STAFF)
    pages = {BASE: f"<html>{side}</html>"}
    k = 100
    for sid, name, n in STAFF:
        items = ""
        for j in range(n):
            k += 1
            bid = f"A{k}"
            title = f"【池袋】{name}のおすすめ{j + 1}"
            items += item(bid, title, f"2026/10/{j + 1}")
            pages[f"{BASE}bid{bid}.html"] = (
                f'<dl class="blogDtlInner"><dt>{title}</dt><dd><div class="taC"><img src="x.jpg"></div>'
                f"こんにちは！<br />{name}です！<br /><br />今回はセンターパート&amp;パーマ。</dd></dl>"
                f'<div class="blogSidePosterCnt"><p class="fgPink fs10 mT10">スタイリスト</p>'
                f'<p class="fs10 mT5 fgGray">よろしくお願いします</p><div class="mT15"></div>')
        pages[f"{BASE}{sid}/"] = f"<ul>{items}</ul>"
    for url, body in pages.items():
        with open(os.path.join(out, fname(url)), "w", encoding="utf-8") as f:
            f.write(body)


if __name__ == "__main__":
    main(sys.argv[1])
