"""設定値（お店を増やすときはここを直す）"""
import os

# ホットペッパービューティーのお店の番号（ページのURL「slnH000719005」の H から後ろ）
SALON_ID = "H000719005"
SALON_NAME = "AI TOKYO men's 池袋"

BASE_URL = f"https://beauty.hotpepper.jp/sln{SALON_ID}/blog/"

# スタッフ1人あたり、文章のお手本として保存しておく記事の数
POSTS_PER_STAFF = 10

# 配信元に負担をかけないよう、1回ごとに空ける秒数
WAIT_SECONDS = float(os.environ.get("SALON_WAIT", "3"))

# 動作確認用：ネットの代わりにこのフォルダのファイルを読む（tests/run_sim.sh が使う）
FIXTURE_DIR = os.environ.get("SALON_FIXTURE_DIR")

OUT_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "docs", "data", "blogs.json")
