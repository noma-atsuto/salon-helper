#!/bin/bash
# 模擬データでブログ取得を一通り動かして検査する（ネットには接続しない）
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=tests/out
rm -rf "$OUT" && mkdir -p "$OUT/site"
python3 tests/make_fixture.py "$OUT/fixture"
cp -R docs/. "$OUT/site/"
rm -f "$OUT/site/data/blogs.json"

run() {
  SALON_FIXTURE_DIR="$OUT/fixture" SALON_WAIT=0 python3 - "$OUT/site/data/blogs.json" <<'PY'
import sys
from engine import config, blog
config.OUT_PATH = sys.argv[1]
sys.exit(blog.run())
PY
}
run
python3 - "$OUT/site/data/blogs.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
staff = {s["name"]: s for s in d["staff"]}
assert set(staff) == {"山田 太郎", "佐藤 次郎"}, staff.keys()
assert len(staff["山田 太郎"]["posts"]) == 3
p = staff["山田 太郎"]["posts"][0]
assert "センターパート&パーマ" in p["body"] and "<" not in p["body"], p["body"]
assert staff["山田 太郎"]["role"] == "スタイリスト"
print("OK: ブログ取得", sum(len(s["posts"]) for s in d["staff"]), "件")
PY
# 2回目は記事数が変わっていないので、取り直さずにそのまま残ること
run | grep -q "新しく取得した記事 0 件" && echo "OK: 2回目は取り直さない"

echo "画面の確認: cd $OUT/site && python3 -m http.server 8765"
