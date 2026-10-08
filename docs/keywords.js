// レポートとブログから「よく見られている言葉」を取り出して点数をつける。
// 日本語は単語の区切りがないので、
//   ① よく使われる髪型・メニューの言葉（下の一覧）が含まれているか
//   ② 「/」「×」「【】」などで区切った言葉
// の2通りで拾う。

const TERMS = [
  // 髪型
  "センターパート", "シースルーセンターパート", "リバースセンターパート", "マッシュ", "韓国マッシュ", "ラウンドマッシュ",
  "ショートマッシュ", "マッシュウルフ", "ウルフ", "ニュアンスウルフ", "ショート", "ルーズショート", "ベリーショート",
  "ツーブロック", "アップバング", "ダウンバング", "コンマバング", "コンマヘア", "スパイキーショート", "ソフトモヒカン",
  "フェードカット", "スキンフェード", "刈り上げ", "短髪", "ミディアム", "七三", "オールバック", "シースルーバング",
  // パーマ
  "パーマ", "ニュアンスパーマ", "シャドウパーマ", "ツイストスパイラル", "ツイスパ", "スパイラルパーマ", "波巻き",
  "波巻きパーマ", "フェザーパーマ", "ルーズパーマ", "マッシュパーマ", "ツイストパーマ", "ピンパーマ", "スウィング",
  "サーフカール", "クラウドカール", "縦落ち", "ゆる波", "ウェーブ", "メンズパーマ", "ハイライト",
  // カラー・質感
  "ダークアッシュ", "シルバーアッシュ", "アッシュ", "アッシュブラウン", "黒髪", "ハイトーン", "ブリーチ", "メッシュ",
  "ホワイトメッシュ", "外国人風", "透明感", "ツヤ", "束感", "毛流れ", "抜け感", "ナチュラル", "無造作", "爽やか",
  "清潔感", "大人っぽい", "韓国風", "韓流", "ビジネス", "学生", "セットが簡単", "時短", "再現性",
  // メニュー
  "縮毛矯正", "ストレート", "髪質改善", "トリートメント", "ヘッドスパ", "眉カット", "眉毛", "カラー", "白髪ぼかし",
  "学割",
];

// 地名やお店の名前など、キーワードとして意味の薄い言葉
const STOP = new Set([
  "池袋", "池袋駅", "men's", "MEN'S", "MEN’S", "MENS", "men", "MEN", "メンズ", "メンズサロン", "メンズ美容室",
  "美容室", "サロン", "池袋美容室", "池袋メンズ", "東口", "AI TOKYO", "アイトーキョー", "指定", "当", "新規", "再来",
  "全員", "カット", "全メニュー", "MEN'", "クーポン",
]);

const SPLIT = /[\/／×✕・,，、\s\[\]［］()（）【】「」『』〈〉<>+＋→↑!！?？◎★☆♪|｜:：#＃]+/;

function tokens(text) {
  return String(text)
    .split(SPLIT)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && t.length <= 16)
    .filter((t) => !STOP.has(t))
    .filter((t) => !/[¥￥\\\d%]/.test(t)) // 値段・数字を含むものは除く
    .filter((t) => !/限定$|クーポン|方$/.test(t)) // 「平日限定」などの売り文句は除く
    .filter((t) => !/^[A-Za-z'’.]+$/.test(t) || t.length >= 4);
}

// 1つの文から拾える言葉（長い言葉に含まれる短い言葉は重ねて数えない）
// 検索で一緒に使われる「探し方」の言葉（ラッコキーワードの結果から拾う）
const INTENT = ["おすすめ", "安い", "上手い", "人気", "得意", "専門", "当日", "今日", "学割", "学生", "個室", "似合わせ",
  "ランキング", "高評価", "夜", "予約", "20代", "30代", "40代", "50代", "白髪染め", "ヘッドスパ", "眉カット", "眉毛",
  "ヘアセット", "ウルフカット", "ツイストパーマ", "ダウンパーマ", "縮毛", "散髪", "床屋", "理容室", "バーバー"];

// vocab = "dict" のときは一覧の言葉だけ、"intent" のときは一覧＋探し方の言葉だけを拾う（ほかのお店の名前などを拾わないため）
function wordsIn(text, vocab) {
  const found = new Set(vocab ? [] : tokens(text));
  const list = vocab === "intent" ? [...TERMS, ...INTENT] : TERMS;
  const flat = text.replace(/\s+/g, "");
  const hits = list.filter((t) => text.includes(t) || flat.includes(t));
  for (const t of hits) {
    if (!hits.some((u) => u !== t && u.includes(t))) found.add(t);
  }
  return [...found];
}

// sources: [{label, items: [{text, value}], weight?}]
// それぞれの出どころの中で「一番多いもの = 100点」にそろえ、出どころの重み（weight）をかけて足し合わせる
export function scoreKeywords(sources, limit = 60) {
  const map = new Map();
  for (const src of sources) {
    const max = Math.max(1, ...src.items.map((i) => i.value || 0));
    for (const it of src.items) {
      const pts = ((it.value || 0) / max) * 100 * (src.weight ?? 1);
      if (pts <= 0) continue;
      for (const w of wordsIn(it.text, src.vocab)) {
        const e = map.get(w) || { word: w, score: 0, from: new Set() };
        e.score += pts;
        e.from.add(src.label);
        map.set(w, e);
      }
    }
  }
  return [...map.values()]
    .map((e) => ({ word: e.word, score: Math.round(e.score), from: [...e.from] }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// レポートとブログデータから、点数づけの材料を作る
export function keywordSources(report, blogs, rakko) {
  const out = [];
  if (report) {
    if (report.styleViews?.length) {
      out.push({ label: "スタイル閲覧", items: report.styleViews.map((s) => ({ text: s.name, value: s.count })) });
    }
    if (report.bookmarkStyles?.length) {
      out.push({ label: "ブックマーク", items: report.bookmarkStyles.map((s) => ({ text: s.name, value: s.count })) });
    }
  }
  if (blogs?.staff?.length) {
    const titles = blogs.staff.flatMap((s) => s.posts.map((p) => ({ text: p.title, value: 1 })));
    // 題名は1本ずつ同じ重さなので、1本10点にとどめる（数が多いと他を押し流すため）
    out.push({ label: "ブログ題名", weight: 0.1, items: titles });
  }
  if (rakko?.items?.length) {
    // 検索回数（ボリューム）が分かればその数、分からなければ1件=1として数える
    const vols = rakko.items.map((r) => r.vol).filter((v) => v > 0);
    const fill = vols.length ? Math.min(...vols) : 1;
    // 検索回数が分からない一覧は、1つ20点にとどめる
    out.push({ label: "ラッコ", vocab: "intent", weight: vols.length ? 1 : 0.2, items: rakko.items.map((r) => ({ text: r.kw, value: r.vol || fill })) });
  }
  return out;
}

// 髪・美容室に関係する言葉かどうか（ラッコキーワードの結果には、服・アクセサリー・飲食店なども混ざるため）
const HAIR = [...TERMS, "美容室", "美容院", "ヘア", "髪", "カット", "パーマ", "カラー", "スパ", "眉", "縮毛", "トリートメント",
  "理容", "床屋", "バーバー", "barber", "サロン", "ブリーチ", "白髪", "刈り上げ", "坊主", "スタイリスト", "ホットペッパー"];
const NOT_HAIR = /コンカフェ|エステ|脱毛|求人|バイト|体入|ファッション|アクセサリー|服|ネイル|まつ|クリニック|通販|パンツ|バッグ|リュック|マッサージ|丁目|サイト/;
export const isHairWord = (kw) => HAIR.some((h) => kw.toLowerCase().includes(h.toLowerCase())) && !NOT_HAIR.test(kw);

// ラッコキーワードの画面の見出し・ボタンなど（言葉の一覧ではない文字）
const UI_WORDS = /^(キーワード|区分|指定なし|SEO難易度|月間検索数|CPC|CPC（\$）|競合性|出現時期|深掘調査|単語数|再検索|一括取得|キーワード増量|データ出力|使い方|（使い方）|料金プラン|もっと見る|広告|ログイン|無料で始める|\?|\d+HIT)$/;

// ラッコキーワードからコピーした一覧を読む。
// 1行に1つの言葉。表（CSV・タブ区切り）なら、数字の列を「検索回数」とみなす。
// 画面をまるごとコピーした場合も、髪に関係する言葉だけを残す。
export function parseRakko(text) {
  const items = [];
  const seen = new Set();
  let dropped = 0;
  for (const raw of String(text).split(/\r?\n/)) {
    // タブ区切りならタブだけで分ける（「1,300」のような数字のカンマで分けないため）
    const cells = (raw.includes("\t") ? raw.split("\t") : raw.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/))
      .map((c) => c.replace(/^"|"$/g, "").trim())
      .filter((c) => c && !/^[＋+αΑ\s]+$/.test(c)); // 「＋＋」などの区分の印は捨てる
    if (!cells.length) continue;
    const kw = cells.find((c) => !/^[\d,.\-–%$（）()]+$/.test(c) && !/^(No\.?|#)?\d+[.)．]?$/.test(c));
    if (!kw || kw.length > 40 || UI_WORDS.test(kw) || /検索ボリューム|月間検索|SEO難易度|\.(jp|com|net)\b|円）|https?:/.test(kw)) continue;
    const clean = kw.replace(/^\d+[.)．]\s*/, "").replace(/[\s　]+/g, " ").trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    // 髪に関係ない言葉と、英字の名前（ほかのお店の名前であることが多い）は除く
    if (!isHairWord(clean) || /[A-Za-z]{3,}/.test(clean.replace(/men'?s/gi, ""))) { dropped++; continue; }
    const volCell = cells.find((c) => c !== kw && /^[\d,]+$/.test(c));
    items.push({ kw: clean, vol: volCell ? parseInt(volCell.replace(/,/g, ""), 10) : null });
  }
  return { items, dropped };
}
