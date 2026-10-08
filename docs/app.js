// サロン助手：レポートのランキング・キーワード・スタイル文・ブログ文
import { pageItems, parseReport, reportSummary } from "./report.js";
import { scoreKeywords, keywordSources } from "./keywords.js";
import { makeStyle, makeBlog, testKey, imageBlock, checkNg } from "./ai.js";

const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/";
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n, d = 0) => (n == null ? "—" : Number(n).toLocaleString("ja-JP", { maximumFractionDigits: d, minimumFractionDigits: d }));
const len = (s) => [...String(s ?? "")].length;

// ---- この端末の中だけに保存する（他の人・他の端末には見えない） ----
const store = {
  get(k, d) { try { const v = localStorage.getItem("sh." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("sh." + k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem("sh." + k); } catch { /* 保存できない環境 */ } },
};

const state = {
  view: "rank",
  blogs: null,
  reports: store.get("reports", {}),
  issue: null,
  selKw: store.get("kw", []),
  rankTab: store.get("rankTab", "staff"),
  kwFilter: "all",
  staffId: store.get("staff", null),
  styleOut: store.get("styleOut", null),
  blogOut: store.get("blogOut", {}),
  blogLen: store.get("blogLen", "normal"),
  busy: false,
  photo: { style: null, blog: null },
};

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2200);
}

async function copy(text, label = "コピーしました") {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  toast(label);
}

const report = () => (state.issue ? state.reports[state.issue] : null);
const staffList = () => state.blogs?.staff ?? [];
const currentStaff = () => staffList().find((s) => s.id === state.staffId) || staffList()[0] || null;
const salonName = () => report()?.salon || state.blogs?.salon?.name || "サロン";

function setKw(list) {
  state.selKw = [...new Set(list.map((s) => s.trim()).filter(Boolean))].slice(0, 12);
  store.set("kw", state.selKw);
}

// ============ ランキング ============
function pct(a, b) {
  if (a == null || b == null || !b) return null;
  return ((a - b) / b) * 100;
}
function deltaHtml(p, unit = "%") {
  if (p == null || !Number.isFinite(p)) return "";
  const cls = p > 0.05 ? "up" : p < -0.05 ? "down" : "";
  const sign = p > 0 ? "+" : "";
  return `<span class="delta ${cls}">${sign}${fmt(p, unit === "%" ? 1 : 0)}${unit}</span>`;
}

function rankList(items, { unit = "", deltaOf } = {}) {
  if (!items.length) return `<p class="muted">このレポートには項目がありません。</p>`;
  const max = Math.max(1, ...items.map((i) => i.value));
  return `<ol class="rank">${items.map((it, k) => `
    <li>
      <span class="pos ${k < 3 ? "p" + (k + 1) : ""}">${k + 1}</span>
      <div class="name">${esc(it.name)}${it.sub ? `<div class="muted small">${esc(it.sub)}</div>` : ""}
        <div class="bar" style="width:${Math.max(3, (it.value / max) * 100)}%"></div></div>
      <span class="val">${fmt(it.value)}${unit}${deltaOf ? deltaHtml(deltaOf(it), "件") : ""}</span>
    </li>`).join("")}</ol>`;
}

function latestOf(table) {
  const n = table?.months?.length ?? 0;
  return {
    month: n ? table.months[n - 1] : "",
    rows: (table?.rows ?? []).map((r) => ({ name: r.name, value: r.v[n - 1] ?? 0, prev: n > 1 ? r.v[n - 2] : null })),
  };
}

function summaryText(r) {
  const m = r.monthly || {};
  const n = m.labels?.length ?? 0;
  const i = n - 1;
  const lines = [`【${r.salon} ${r.issue ? r.issue.slice(0, 2) + "年" + r.issue.slice(2) + "月号" : ""} レポートまとめ】`];
  if (n) {
    const p = (arr) => { const v = pct(arr?.[i], arr?.[i - 1]); return v == null ? "" : `（前月比 ${v > 0 ? "+" : ""}${fmt(v, 1)}%）`; };
    lines.push(`${m.labels[i]} の来店 ${fmt(m.visitors?.[i])}人${p(m.visitors)}`);
    lines.push(`売上 ${fmt(m.sales?.[i], 1)}万円${p(m.sales)}`);
    lines.push(`客単価 ${fmt(m.unit?.[i])}円`);
  }
  const st = latestOf(r.stylists);
  if (st.rows.length) {
    lines.push("", `■スタッフ別ネット予約（${st.month}）`);
    [...st.rows].sort((a, b) => b.value - a.value).forEach((s, k) => lines.push(`${k + 1}位 ${s.name} ${s.value}件`));
  }
  if (r.styleViews?.length) {
    lines.push("", "■よく見られたスタイル TOP3");
    r.styleViews.slice(0, 3).forEach((s, k) => lines.push(`${k + 1}位 ${s.name}（${fmt(s.count)}回）`));
  }
  const cp = latestOf(r.coupons);
  if (cp.rows.length) {
    lines.push("", `■予約の多いクーポン TOP3（${cp.month}）`);
    [...cp.rows].sort((a, b) => b.value - a.value).slice(0, 3).forEach((c, k) => lines.push(`${k + 1}位 ${c.name}（${c.value}件）`));
  }
  return lines.join("\n");
}

function renderRank() {
  const el = $("#view-rank");
  const issues = Object.keys(state.reports).sort().reverse();
  const r = report();
  const picker = `
    <div class="row">
      ${issues.length > 1 ? `<select id="issueSel" class="grow">${issues.map((k) =>
        `<option value="${k}" ${k === state.issue ? "selected" : ""}>${esc(k.slice(0, 2))}年${esc(k.slice(2))}月号（${esc(state.reports[k].updated || "")}）</option>`).join("")}</select>` : ""}
      <button class="btn ${r ? "sm" : "primary block"}" data-act="pickPdf">${r ? "別のレポートを読み込む" : "サロンレポート（PDF）を読み込む"}</button>
    </div>`;
  if (!r) {
    el.innerHTML = `
      <h2>サロンレポートのランキング</h2>
      <div class="card note">
        <ol class="steps">
          <li>サロンボードで「サロンレポート」を開き、PDF をダウンロード（iPhone では「ファイル」に保存）</li>
          <li>下のボタンを押して、そのPDFを選ぶ</li>
        </ol>
        <p class="small muted">読み込んだレポート（売上・スタッフ名など）は<b>この端末の中だけ</b>で計算・保存し、インターネットには送りません。</p>
      </div>
      ${picker}`;
    return;
  }
  const m = r.monthly || {};
  const n = m.labels?.length ?? 0, i = n - 1;
  const kpi = (label, v, arr, unit, d = 0) => `
    <div class="kpi"><div class="label">${label}</div>
      <div class="value">${fmt(v, d)}<small>${unit}</small></div>
      ${deltaHtml(pct(arr?.[i], arr?.[i - 1]))}<span class="muted small"> 前月比</span>
      ${n > 12 ? `<div>${deltaHtml(pct(arr?.[i], arr?.[i - 12]))}<span class="muted small"> 前年比</span></div>` : ""}
    </div>`;

  const tabs = [
    ["staff", "スタッフ予約"], ["staffView", "スタッフ閲覧"], ["bookmark", "ブックマーク"],
    ["style", "スタイル閲覧"], ["coupon", "クーポン"], ["menu", "メニュー"], ["month", "月別"],
  ];
  let body = "";
  const t = state.rankTab;
  if (t === "staff") {
    const st = latestOf(r.stylists);
    body = `<h3>ネット予約数（${esc(st.month)}）</h3>` +
      rankList([...st.rows].sort((a, b) => b.value - a.value), { unit: "件", deltaOf: (x) => (x.prev == null ? null : x.value - x.prev) }) +
      `<p class="small muted">右の小さな数字は前月との差です。</p>`;
  } else if (t === "staffView") {
    body = `<h3>スタイリストページの閲覧数</h3>` + rankList((r.stylistViews || []).map((s) => ({ name: s.name, value: s.count })), { unit: "回" });
  } else if (t === "bookmark") {
    body = `<h3>スタッフのブックマーク数（累積）</h3>` + rankList((r.bookmarkStylists || []).map((s) => ({ name: s.name, value: s.count })), { unit: "件" }) +
      `<h3 style="margin-top:14px">今月ブックマークされたスタイル</h3>` +
      rankList((r.newBookmarkStyles || []).slice(0, 15).map((s) => ({ name: s.name, sub: s.stylist, value: s.count })), { unit: "件" });
  } else if (t === "style") {
    body = `<h3>スタイルの閲覧数 TOP30</h3>` + rankList((r.styleViews || []).slice(0, 30).map((s) => ({ name: s.name, value: s.count })), { unit: "回" });
  } else if (t === "coupon") {
    const cp = latestOf(r.coupons);
    body = `<h3>クーポン別ネット予約数（${esc(cp.month)}）</h3>` +
      rankList([...cp.rows].sort((a, b) => b.value - a.value).filter((c) => c.value > 0).slice(0, 20), { unit: "件", deltaOf: (x) => (x.prev == null ? null : x.value - x.prev) });
  } else if (t === "menu") {
    const mn = latestOf(r.menus);
    body = `<h3>メニュー別ネット予約数（${esc(mn.month)}）</h3>` +
      rankList([...mn.rows].sort((a, b) => b.value - a.value).filter((c) => c.value > 0), { unit: "件", deltaOf: (x) => (x.prev == null ? null : x.value - x.prev) });
  } else if (t === "month") {
    body = `<h3>月ごとの推移</h3><table class="months"><thead><tr><th>月</th><th>来店</th><th>売上(万円)</th><th>客単価</th></tr></thead><tbody>${
      (m.labels || []).map((lab, k) => `<tr><td>${esc(lab)}</td><td>${fmt(m.visitors?.[k])}</td><td>${fmt(m.sales?.[k], 1)}</td><td>${fmt(m.unit?.[k])}</td></tr>`).reverse().join("")
    }</tbody></table>`;
  }
  el.innerHTML = `
    ${picker}
    <h2>${esc(m.labels?.[i] ?? "")} のようす</h2>
    <div class="kpis">
      ${kpi("来店数", m.visitors?.[i], m.visitors, "人")}
      ${kpi("売上", m.sales?.[i], m.sales, "万円", 1)}
      ${kpi("客単価", m.unit?.[i], m.unit, "円")}
    </div>
    <div class="row end" style="margin-top:8px"><button class="btn sm" data-act="copySummary">まとめ文をコピー（LINE用）</button></div>
    <h2>ランキング</h2>
    <div class="seg">${tabs.map(([k, l]) => `<button data-rank="${k}" class="${k === t ? "on" : ""}">${l}</button>`).join("")}</div>
    <div class="card">${body}</div>
    <p class="small muted">データ最終更新日 ${esc(r.updated || "—")}（レポートに書かれている日付）</p>`;
}

async function importPdf(file) {
  toast("レポートを読み取っています…");
  try {
    const pdfjs = await import(PDFJS + "pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.mjs";
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      cMapUrl: PDFJS + "cmaps/", cMapPacked: true,
      standardFontDataUrl: PDFJS + "standard_fonts/",
    }).promise;
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) pages.push(await pageItems(await doc.getPage(p)));
    const rep = parseReport(pages);
    const sum = reportSummary(rep);
    if (!sum.months && !sum.stylists && !sum.styles) {
      toast("サロンレポートとして読み取れませんでした。ファイルを確認してください。");
      return;
    }
    const key = rep.issue || new Date().toISOString().slice(2, 7).replace("-", "");
    state.reports[key] = rep;
    state.issue = key;
    if (!store.set("reports", state.reports)) toast("保存できませんでした（プライベートモードの可能性）。表示はできます。");
    else toast(`読み込みました（スタッフ${sum.stylists}人・スタイル${sum.styles}件・クーポン${sum.coupons}件）`);
    renderAll();
  } catch (e) {
    console.error(e);
    toast("読み取りに失敗しました: " + e.message);
  }
}

// ============ キーワード ============
function keywords() {
  return scoreKeywords(keywordSources(report(), state.blogs), 80);
}

function selBar(where) {
  return `
    <div class="selbar">
      <div class="row" style="margin-bottom:6px"><b class="grow small">使うキーワード（${state.selKw.length}）</b>
        ${where === "kw" ? "" : `<button class="btn sm" data-go="kw">選びなおす</button>`}</div>
      <div class="chips">${state.selKw.length ? state.selKw.map((w) =>
        `<button class="chip on" data-unsel="${esc(w)}">${esc(w)}<span class="x">×</span></button>`).join("") :
        `<span class="muted small">まだ選ばれていません。${where === "kw" ? "下の言葉をタップして選んでください。" : "「選びなおす」から選べます（なしでも作れます）。"}</span>`}</div>
      <div class="row" style="margin-top:8px">
        <input type="text" id="kwAdd-${where}" class="grow" placeholder="言葉を追加（例：黒髪）" enterkeyhint="done">
        <button class="btn sm" data-act="kwAdd" data-where="${where}">追加</button>
      </div>
      ${where === "kw" ? `<div class="row" style="margin-top:8px">
        <button class="btn sm" data-act="copyKw">「、」区切りでコピー</button>
        <button class="btn sm" data-act="copyTags">#付きでコピー</button>
        <button class="btn sm primary" data-go="style">スタイルを作る</button>
        <button class="btn sm primary" data-go="blog">ブログを作る</button>
      </div>` : ""}
    </div>`;
}

function renderKw() {
  const el = $("#view-kw");
  const all = keywords();
  const filters = [["all", "すべて"], ["スタイル閲覧", "スタイル閲覧"], ["ブックマーク", "ブックマーク"], ["クーポン予約", "クーポン予約"], ["ブログ題名", "ブログ題名"]];
  const list = state.kwFilter === "all" ? all : all.filter((k) => k.from.includes(state.kwFilter));
  const r = report();
  el.innerHTML = `
    ${selBar("kw")}
    <h2>よく見られている言葉</h2>
    <p class="small muted">${r ? `レポート（${esc(r.issue)}月号）の閲覧数・ブックマーク・予約数` : "レポート未読み込みのため、ブログの題名だけ"}から点数をつけています。数字が大きいほど、よく見られている言葉です。</p>
    <div class="seg">${filters.map(([k, l]) => `<button data-kwf="${esc(k)}" class="${k === state.kwFilter ? "on" : ""}">${l}</button>`).join("")}</div>
    <div class="chips">${list.length ? list.map((k) =>
      `<button class="chip ${state.selKw.includes(k.word) ? "on" : ""}" data-kw="${esc(k.word)}">${esc(k.word)}<span class="sc">${k.score}</span></button>`).join("") :
      `<p class="muted">まだ言葉がありません。ランキングタブでレポートを読み込んでください。</p>`}</div>`;
}

// ============ スタイル ============
function outField(label, text, max, key) {
  const n = len(text);
  return `
    <div class="out">
      <div class="out-head"><b>${label}</b>${max ? `<span class="cnt ${n > max ? "over" : ""}">${n}/${max}字</span>` : ""}
        <button class="btn sm" data-copy="${key}">コピー</button></div>
      <div class="out-text">${esc(text)}</div>
    </div>`;
}

function staffOptions(sel) {
  return `<option value="">（選ばない）</option>` + staffList().map((s) =>
    `<option value="${esc(s.id)}" ${s.id === sel ? "selected" : ""}>${esc(s.name)}</option>`).join("");
}

function photoField(kind) {
  const ph = state.photo[kind];
  return `<label class="field"><span>写真（任意。あると髪型に合った文になります）</span>
    <input type="file" accept="image/*" data-photo="${kind}">
    ${ph ? `<img class="photo-prev" src="${ph.url}" alt="">` : ""}</label>`;
}

function renderStyle() {
  const el = $("#view-style");
  const o = state.styleOut;
  const ng = o ? checkNg([o.styleName, o.comment, o.menu].join("\n")) : [];
  el.innerHTML = `
    <h2>スタイル掲載の文を作る</h2>
    <p class="small muted">サロンボードの「スタイル掲載」に入れる文章の案を作ります。できた文はコピーして貼り付けてください。</p>
    ${selBar("style")}
    <div class="card">
      <label class="field"><span>スタイリスト</span><select id="styleStaff">${staffOptions(state.staffId)}</select></label>
      <label class="field"><span>どんな髪型？（メモ）</span>
        <textarea id="styleMemo" placeholder="例：黒髪のセンターパート。ツイスパで動きを出した。学生さん向け">${esc(store.get("styleMemo", ""))}</textarea></label>
      ${photoField("style")}
      <button class="btn primary block" data-act="makeStyle" ${state.busy ? "disabled" : ""}>
        ${state.busy === "style" ? `<span class="spinner"></span>作っています…（20〜40秒）` : "AI で文章を作る"}</button>
    </div>
    ${o ? `
      <h2>できあがり</h2>
      ${ng.length ? `<div class="ng">⚠️ 注意が必要かもしれない言い方があります：${ng.map((h) => `「${esc(h.word)}」（${esc(h.why)}）`).join("、")}</div>` : ""}
      ${outField("スタイル名", o.styleName, 30, "styleName")}
      ${outField("スタイリストコメント", o.comment, 120, "comment")}
      ${outField("メニュー内容", o.menu, 50, "menu")}
      <div class="out">
        <div class="out-head"><b>ハッシュタグ</b><span class="cnt">タップで1つずつコピー</span>
          <button class="btn sm" data-copy="hashtags">全部コピー</button></div>
        <div class="chips">${(o.hashtags || []).map((h) => `<button class="chip" data-tag="${esc(h)}">${esc(h)}</button>`).join("")}</div>
      </div>
      <div class="out"><div class="out-head"><b>選ぶ項目の目安</b></div>
        <div class="out-text">長さ：${esc(o.length || "—")}\nチェック：${esc((o.checks || []).join("、") || "なし")}</div></div>
      ${o.notes ? `<div class="card warn small">確認してほしい点：${esc(o.notes)}</div>` : ""}
      <p class="small muted">※送付・公開前に内容をご確認ください。事実と異なる表現や誤字がないかチェックをお願いします。<br>
      ※ハッシュタグの文字数・個数の上限はサロンボードの画面で確認してください（要確認）。</p>` : ""}`;
}

// ============ ブログ ============
function renderBlog() {
  const el = $("#view-blog");
  const list = staffList();
  if (!list.length) {
    el.innerHTML = `<h2>ブログを作る</h2><div class="card note">スタッフのブログデータがまだありません。自動更新（1日1回）を待つか、設定タブの説明を見てください。</div>`;
    return;
  }
  const s = currentStaff();
  const o = state.blogOut[s.id];
  const ng = o ? checkNg(o.title + "\n" + o.body) : [];
  const lens = [["short", "短め"], ["normal", "ふつう"], ["long", "長め"]];
  el.innerHTML = `
    <div class="staff-tabs">${list.map((x) => `<button data-staff="${esc(x.id)}" class="${x.id === s.id ? "on" : ""}">${esc(x.name)}</button>`).join("")}</div>
    <div class="card">
      <h3>${esc(s.name)}${s.role ? `<span class="muted small">　${esc(s.role)}</span>` : ""}</h3>
      ${s.catch ? `<p class="small muted" style="margin:0 0 6px">${esc(s.catch)}</p>` : ""}
      <p class="small muted" style="margin:0">これまでの記事 ${fmt(s.total)}件。このうち新しい ${Math.min(5, s.posts.length)}件をお手本にします。</p>
      <details class="post"><summary class="small">保存してある記事を見る ▾</summary>
        ${s.posts.map((p) => `<details class="post"><summary>${esc(p.date)}　${esc(p.title)}</summary><div class="body">${esc(p.body)}</div></details>`).join("")}
      </details>
    </div>
    ${selBar("blog")}
    <div class="card">
      <label class="field"><span>今回書きたいこと（メモ）</span>
        <textarea id="blogMemo" placeholder="例：秋におすすめのルーズショート。セットが簡単なことを伝えたい">${esc(store.get("blogMemo", ""))}</textarea></label>
      <div class="field"><span class="small" style="font-weight:600">長さ</span>
        <div class="seg" style="margin:4px 0 12px;padding:0">${lens.map(([k, l]) => `<button data-blen="${k}" class="${k === state.blogLen ? "on" : ""}">${l}</button>`).join("")}</div></div>
      ${photoField("blog")}
      <button class="btn primary block" data-act="makeBlog" ${state.busy ? "disabled" : ""}>
        ${state.busy === "blog" ? `<span class="spinner"></span>作っています…（30〜60秒）` : `${esc(s.name)}さんの書き方で作る`}</button>
    </div>
    ${o ? `
      <h2>できあがり</h2>
      ${ng.length ? `<div class="ng">⚠️ 注意が必要かもしれない言い方があります：${ng.map((h) => `「${esc(h.word)}」（${esc(h.why)}）`).join("、")}</div>` : ""}
      ${outField("題名", o.title, 30, "blogTitle")}
      ${outField("本文", o.body, 0, "blogBody")}
      <div class="row end" style="margin-bottom:10px"><button class="btn sm" data-copy="blogAll">題名と本文をまとめてコピー</button></div>
      ${o.notes ? `<div class="card warn small">確認してほしい点：${esc(o.notes)}</div>` : ""}
      <p class="small muted">※送付・公開前に内容をご確認ください。事実と異なる表現や誤字がないかチェックをお願いします。</p>` : ""}`;
}

// ============ 設定 ============
function renderSet() {
  const el = $("#view-set");
  const key = store.get("apiKey", "");
  const base = location.origin + location.pathname;
  const links = [["キーワードを開く", "?tab=kw"], ["スタイル作成を開く", "?tab=style"], ["ブログ作成を開く", "?tab=blog"]]
    .concat(staffList().map((s) => [`${s.name}さんのブログ作成`, `?tab=blog&staff=${s.id}`]));
  el.innerHTML = `
    <h2>AI（Claude）の API キー</h2>
    <div class="card">
      <p class="small" style="margin-top:0">文章づくりに使う「合言葉」です。<b>この iPhone の中だけ</b>に保存され、Anthropic 社（Claude の会社）以外には送りません。</p>
      <label class="field"><span>API キー ${key ? `<span class="muted">（保存済み：…${esc(key.slice(-4))}）</span>` : ""}</span>
        <input type="password" id="apiKey" placeholder="sk-ant- から始まる文字" autocomplete="off"></label>
      <div class="row">
        <button class="btn primary" data-act="saveKey">保存</button>
        <button class="btn" data-act="testKey" ${key ? "" : "disabled"}>つながるか確認</button>
        ${key ? `<button class="btn" data-act="delKey">消す</button>` : ""}
      </div>
      <p class="small muted">取得のしかた：パソコンかiPhoneで console.anthropic.com にログイン →「API Keys」で作成 → ここに貼り付け。料金は使った分だけで、1回あたり十数円ほどの見込みです（目安・要確認）。</p>
    </div>

    <h2>iPhone のショートカットに登録する</h2>
    <div class="card">
      <ol class="steps small">
        <li>「ショートカット」アプリ →「＋」→「アクションを追加」で「URLを開く」を選ぶ</li>
        <li>下の「コピー」で取ったアドレスを貼る</li>
        <li>名前をつけて「ホーム画面に追加」すると、1タップで開けます</li>
      </ol>
      ${links.map(([l, q]) => `<div class="row" style="margin-top:8px"><span class="grow small">${esc(l)}</span>
        <button class="btn sm" data-copylink="${esc(base + q)}">コピー</button></div>`).join("")}
      <p class="small muted">※ショートカットは Safari で開きます。API キーやレポートは Safari 側に保存してください（ホーム画面に置いたアプリとは保存場所が別です）。</p>
    </div>

    <h2>データ</h2>
    <div class="card">
      <p class="small" style="margin-top:0">ブログのお手本：${state.blogs ? `${esc(state.blogs.updated)} 更新（毎日自動）` : "まだありません"}</p>
      <p class="small">この端末に保存中のレポート：${Object.keys(state.reports).length ? Object.keys(state.reports).sort().map((k) => `${esc(k)}月号`).join("、") : "なし"}</p>
      ${Object.keys(state.reports).length ? `<button class="btn sm" data-act="delReports">保存したレポートを消す</button>` : ""}
    </div>
    <p class="small muted">このアプリはホットペッパービューティーに公開されているブログと、読み込んだレポートを使って文章の案を作ります。予約や売上の増加を約束するものではありません。</p>`;
}

// ============ 画面の切り替え ============
const renders = { rank: renderRank, kw: renderKw, style: renderStyle, blog: renderBlog, set: renderSet };
function renderAll() {
  renders[state.view]();
  const r = report();
  $("#sub").textContent = r ? `${r.salon}・${r.issue}月号` : (state.blogs?.salon?.name ?? "");
}
function go(view) {
  state.view = view;
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + view));
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  renders[view]();
  window.scrollTo(0, 0);
  const u = new URL(location.href);
  u.searchParams.set("tab", view);
  history.replaceState(null, "", u);
}

async function run(kind) {
  const apiKey = store.get("apiKey", "");
  if (!apiKey) { toast("先に設定タブで API キーを入れてください"); go("set"); return; }
  state.busy = kind;
  renders[state.view]();
  try {
    const image = state.photo[kind]?.block || null;
    if (kind === "style") {
      const memo = $("#styleMemo").value;
      const staff = staffList().find((s) => s.id === $("#styleStaff").value) || null;
      state.styleOut = await makeStyle({ apiKey, salon: salonName(), staff, keywords: state.selKw, memo, image });
      store.set("styleOut", state.styleOut);
    } else {
      const s = currentStaff();
      const memo = $("#blogMemo").value;
      state.blogOut[s.id] = await makeBlog({ apiKey, salon: salonName(), staff: s, keywords: state.selKw, memo, length: state.blogLen, image });
      store.set("blogOut", state.blogOut);
    }
    toast("できました");
  } catch (e) {
    console.error(e);
    toast(e.message || "うまく作れませんでした");
  } finally {
    state.busy = false;
    renders[state.view]();
  }
}

document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("button");
  if (!b) return;
  const d = b.dataset;
  if (d.view) return go(d.view);
  if (d.go) return go(d.go);
  if (d.rank) { state.rankTab = d.rank; store.set("rankTab", d.rank); return renderRank(); }
  if (d.kwf) { state.kwFilter = d.kwf; return renderKw(); }
  if (d.kw) {
    setKw(state.selKw.includes(d.kw) ? state.selKw.filter((w) => w !== d.kw) : [...state.selKw, d.kw]);
    return renderKw();
  }
  if (d.unsel) { setKw(state.selKw.filter((w) => w !== d.unsel)); return renders[state.view](); }
  if (d.staff) { state.staffId = d.staff; store.set("staff", d.staff); return renderBlog(); }
  if (d.blen) { state.blogLen = d.blen; store.set("blogLen", d.blen); return renderBlog(); }
  if (d.tag) return copy(d.tag, `「${d.tag}」をコピーしました`);
  if (d.copylink) return copy(d.copylink, "アドレスをコピーしました");
  if (d.copy) {
    const o = state.styleOut || {};
    const bo = state.blogOut[currentStaff()?.id] || {};
    const map = {
      styleName: o.styleName, comment: o.comment, menu: o.menu, hashtags: (o.hashtags || []).join(" "),
      blogTitle: bo.title, blogBody: bo.body, blogAll: `${bo.title}\n\n${bo.body}`,
    };
    return copy(map[d.copy] ?? "");
  }
  switch (d.act) {
    case "pickPdf": $("#pdfInput").click(); break;
    case "copySummary": copy(summaryText(report()), "まとめ文をコピーしました"); break;
    case "copyKw": copy(state.selKw.join("、")); break;
    case "copyTags": copy(state.selKw.map((w) => "#" + w).join(" ")); break;
    case "kwAdd": {
      const inp = $("#kwAdd-" + d.where);
      if (inp.value.trim()) { setKw([...state.selKw, ...inp.value.split(/[、,\s]+/)]); renders[state.view](); }
      break;
    }
    case "makeStyle": run("style"); break;
    case "makeBlog": run("blog"); break;
    case "saveKey": {
      const v = $("#apiKey").value.trim();
      if (!v) { toast("API キーを貼り付けてください"); break; }
      store.set("apiKey", v) ? toast("保存しました") : toast("保存できませんでした（プライベートモードの可能性）");
      renderSet();
      break;
    }
    case "testKey": {
      b.disabled = true;
      b.textContent = "確認中…";
      try { await testKey(store.get("apiKey", "")); toast("つながりました ✅"); } catch (e) { toast(e.message); }
      renderSet();
      break;
    }
    case "delKey": store.del("apiKey"); toast("消しました"); renderSet(); break;
    case "delReports":
      if (confirm("この端末に保存したレポートを消しますか？")) {
        state.reports = {}; state.issue = null; store.del("reports"); renderAll();
      }
      break;
  }
});

document.addEventListener("change", async (ev) => {
  const t = ev.target;
  if (t.id === "pdfInput" && t.files[0]) { await importPdf(t.files[0]); t.value = ""; }
  if (t.id === "issueSel") { state.issue = t.value; renderAll(); }
  if (t.id === "styleStaff") { state.staffId = t.value || state.staffId; if (t.value) store.set("staff", t.value); }
  if (t.dataset.photo && t.files[0]) {
    const f = t.files[0];
    try {
      state.photo[t.dataset.photo] = { url: URL.createObjectURL(f), block: await imageBlock(f) };
    } catch { toast("この写真は読み込めませんでした"); }
    renders[state.view]();
  }
});
document.addEventListener("input", (ev) => {
  if (ev.target.id === "styleMemo") store.set("styleMemo", ev.target.value);
  if (ev.target.id === "blogMemo") store.set("blogMemo", ev.target.value);
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && ev.target.id?.startsWith("kwAdd-")) {
    ev.preventDefault();
    document.querySelector(`[data-act="kwAdd"][data-where="${ev.target.id.slice(6)}"]`)?.click();
  }
});

// ============ はじめ ============
async function init() {
  const q = new URLSearchParams(location.search);
  const issues = Object.keys(state.reports).sort();
  state.issue = issues[issues.length - 1] || null;
  if (q.get("kw")) setKw(q.get("kw").split(/[、,]/));
  try {
    const res = await fetch("data/blogs.json", { cache: "no-cache" });
    if (res.ok) state.blogs = await res.json();
  } catch { /* オフライン */ }
  const staffQ = q.get("staff");
  if (staffQ) {
    const s = staffList().find((x) => x.id === staffQ || x.name.replace(/\s/g, "") === staffQ.replace(/\s/g, ""));
    if (s) { state.staffId = s.id; store.set("staff", s.id); }
  }
  const tab = q.get("tab");
  go(renders[tab] ? tab : (state.issue ? "rank" : "kw"));
  renderAll();
}
init();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
