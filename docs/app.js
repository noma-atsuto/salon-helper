// サロン助手：レポートのランキング・キーワード・スタイル文・ブログ文
import { pageItems, parseReport, reportSummary } from "./report.js";
import { scoreKeywords, keywordSources, parseRakko } from "./keywords.js";
import { lock, unlock, staffView, fetchBox, putBox, randomPass } from "./share.js";
import { makeStyle, makeBlog, testKey, imageBlock, checkNg, stylePrompt, blogPrompt, parseStyle, parseBlog, AI_APPS } from "./ai.js";

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
  aiApp: store.get("aiApp", "chatgpt"),
  rakko: store.get("rakko", null),
  role: null,        // 合言葉で開けた種類：owner（全部）／staff（売上なし）
  sharedAt: null,    // 配られたレポートの更新日時
  withPhoto: { style: false, blog: false },
  withImage: store.get("withImage", false),
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
      ${state.role === "staff" ? "" : `<button class="btn ${r ? "sm" : "primary block"}" data-act="pickPdf">${r ? "別のレポートを読み込む" : "サロンレポート（PDF）を読み込む"}</button>`}
      ${r && store.get("ghToken", "") && state.role !== "staff" ? `<button class="btn sm primary" data-act="publish">全員に配る</button>` : ""}
    </div>
    ${state.sharedAt ? `<p class="small muted" style="margin:6px 0 0">配られたレポート（${new Date(state.sharedAt).toLocaleString("ja-JP")} 更新）を表示しています。</p>` : ""}
    ${r?._local && store.get("ghToken", "") ? `<p class="small" style="margin:6px 0 0;color:var(--accent)">このレポートはまだ全員に配っていません。</p>` : ""}`;
  if (!r) {
    el.innerHTML = `
      <h2>サロンレポートのランキング</h2>
      <div class="card note">
        <ol class="steps">
          <li>サロンボードで「サロンレポート」を開き、PDF をダウンロード（iPhone では「ファイル」に保存）</li>
          <li>下のボタンを押して、そのPDFを選ぶ</li>
        </ol>
        <p class="small muted">読み込んだレポート（売上・スタッフ名など）は<b>この端末の中だけ</b>で計算・保存します。「全員に配る」を使うときだけ、合言葉で鍵をかけてから保存します。</p>
        <p class="small muted">スタッフの方は、設定タブで「お店の合言葉」を入れると、配られたレポートが見られます。</p>
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
    ["style", "スタイル閲覧"], ["coupon", "クーポン"], ["menu", "メニュー"], ...(n ? [["month", "月別"]] : []),
  ];
  let body = "";
  const t = state.rankTab === "month" && !n ? "staff" : state.rankTab;
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
    ${n ? `<h2>${esc(m.labels?.[i] ?? "")} のようす</h2>
    <div class="kpis">
      ${kpi("来店数", m.visitors?.[i], m.visitors, "人")}
      ${kpi("売上", m.sales?.[i], m.sales, "万円", 1)}
      ${kpi("客単価", m.unit?.[i], m.unit, "円")}
    </div>` : ""}
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
    rep._local = true;
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

// ============ 全員に配る（鍵つき） ============
const MAX_ISSUES = 12;
function keepLatest(map) {
  return Object.fromEntries(Object.keys(map).sort().slice(-MAX_ISSUES).map((k) => [k, map[k]]));
}

// 合言葉で、配られたレポートを開く（オーナー用 → スタッフ用 の順に試す）
async function loadShared() {
  const pass = store.get("pass", "");
  if (!pass) return;
  let anyBox = false;
  for (const kind of ["owner", "staff"]) {
    const box = await fetchBox(kind);
    if (!box) continue;
    anyBox = true;
    const data = await unlock(box, pass);
    if (!data) continue;
    state.role = kind;
    state.sharedAt = box.at;
    // スタッフ用は売上なし。自分の端末に全部入りがあっても、配られた分を優先して表示する
    state.reports = kind === "owner" ? { ...data.reports, ...onlyLocal() } : data.reports;
    store.set("reports", state.reports);
    const issues = Object.keys(state.reports).sort();
    state.issue = issues[issues.length - 1] || null;
    return;
  }
  state.role = "ng";
  // 合言葉が変わった（辞めた人など）ときは、前に配られた分もこの端末から消す
  if (anyBox) forgetShared();
}
function forgetShared() {
  state.reports = onlyLocal();
  store.set("reports", state.reports);
  state.sharedAt = null;
  const issues = Object.keys(state.reports).sort();
  state.issue = issues[issues.length - 1] || null;
}
// オーナーの端末で、まだ配っていない（この端末だけで読み込んだ）レポート
function onlyLocal() {
  const local = store.get("reports", {});
  return Object.fromEntries(Object.entries(local).filter(([, r]) => !r.staffOnly && r._local));
}

async function publishReports() {
  const token = store.get("ghToken", "");
  const ownerPass = store.get("ownerPass", "");
  const staffPass = store.get("staffPass", "");
  if (!token || !ownerPass || !staffPass) { toast("設定タブの「レポートを全員に配る」を先に設定してください"); go("set"); return; }
  toast("鍵をかけて保存しています…");
  try {
    // すでに配ってある分と合わせる（別の端末で配った月が消えないように）
    let merged = {};
    const cur = await fetchBox("owner");
    if (cur) {
      const old = await unlock(cur, ownerPass);
      if (old) merged = old.reports;
    }
    for (const [k, r] of Object.entries(state.reports)) if (!r.staffOnly) merged[k] = { ...r, _local: undefined };
    merged = keepLatest(merged);
    const staffMap = Object.fromEntries(Object.entries(merged).map(([k, r]) => [k, staffView(r)]));
    await putBox("owner", await lock({ reports: merged }, ownerPass), token);
    await putBox("staff", await lock({ reports: staffMap }, staffPass), token);
    for (const r of Object.values(state.reports)) delete r._local;
    store.set("reports", state.reports);
    toast(`配りました（${Object.keys(merged).length}か月分）。1〜2分で全員に反映されます`);
  } catch (e) {
    console.error(e);
    toast(e.message || "配れませんでした");
  }
}

// ============ キーワード ============
function keywords() {
  return scoreKeywords(keywordSources(report(), state.blogs, state.rakko), 80);
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
  const filters = [["all", "すべて"], ["ラッコ", "検索（ラッコ）"], ["スタイル閲覧", "スタイル閲覧"], ["ブックマーク", "ブックマーク"], ["クーポン予約", "クーポン予約"], ["ブログ題名", "ブログ題名"]];
  // レポートやブログでも人気で、検索もされている言葉
  const both = state.rakko ? all.filter((k) => k.from.includes("ラッコ") && k.from.length > 1) : [];
  const chip = (k) => `<button class="chip ${state.selKw.includes(k.word) ? "on" : ""}" data-kw="${esc(k.word)}">${esc(k.word)}<span class="sc">${k.score}</span>${k.from.includes("ラッコ") ? `<span class="tag">検索</span>` : ""}</button>`;
  const list = state.kwFilter === "all" ? all : all.filter((k) => k.from.includes(state.kwFilter));
  const r = report();
  el.innerHTML = `
    ${selBar("kw")}
    ${rakkoCard(all)}
    ${both.length ? `<h2>検索でも人気の言葉</h2>
      <p class="small muted">レポート・ブログで人気があり、ラッコキーワードでも検索されている言葉です。まず使いたい候補です。</p>
      <div class="chips">${both.map(chip).join("")}</div>` : ""}
    <h2>よく見られている言葉</h2>
    <p class="small muted">${r ? `レポート（${esc(r.issue)}月号）の閲覧数・ブックマーク・予約数` : "レポート未読み込みのため、ブログの題名だけ"}から点数をつけています。数字が大きいほど、よく見られている言葉です。</p>
    <div class="seg">${filters.map(([k, l]) => `<button data-kwf="${esc(k)}" class="${k === state.kwFilter ? "on" : ""}">${l}</button>`).join("")}</div>
    <div class="chips">${list.length ? list.map(chip).join("") :
      `<p class="muted">まだ言葉がありません。ランキングタブでレポートを読み込んでください。</p>`}</div>`;
}

// ラッコキーワード：調べる → 一覧をコピー → 貼り付けて取り込む
const RAKKO_URL = "https://rakkokeyword.com/result/suggest?q=";
function rakkoCard(all) {
  const area = "池袋";
  const seeds = [`${area} メンズ`, ...all.filter((k) => !k.from.includes("ラッコ")).slice(0, 5).map((k) => `${area} ${k.word}`)];
  const rk = state.rakko;
  const phrases = rk ? [...rk.items].sort((a, b) => (b.vol || 0) - (a.vol || 0)).slice(0, 20) : [];
  return `
    <div class="card">
      <h3>ラッコキーワードで、検索されている言葉を調べる</h3>
      <p class="small muted" style="margin-top:0">① 下の言葉をタップ → ラッコキーワードが開きます　② 出てきた一覧をコピー　③ 戻って「貼り付けて取り込む」</p>
      <div class="chips">${seeds.map((q) => `<button class="chip" data-rakko="${esc(q)}">${esc(q)} ↗</button>`).join("")}</div>
      <div class="row" style="margin-top:8px">
        <input type="text" id="rakkoQ" class="grow" placeholder="自分で入れる（例：池袋 黒髪）" enterkeyhint="go">
        <button class="btn sm" data-act="rakkoGo">調べる</button>
      </div>
      <textarea id="rakkoPaste" style="margin-top:10px" placeholder="ラッコキーワードでコピーした一覧を、ここに貼り付け"></textarea>
      <div class="row" style="margin-top:8px">
        <button class="btn sm" data-act="rakkoClip">コピーした一覧を貼り付け</button>
        <button class="btn sm primary" data-act="rakkoIn">取り込む</button>
        ${rk ? `<button class="btn sm" data-act="rakkoDel">取り込んだ分を消す</button>` : ""}
      </div>
      ${rk ? `<p class="small muted">取り込み済み：${rk.items.length}件（${esc(rk.updated)}）。点数に「検索」として加わっています。</p>
        <details class="post"><summary class="small">検索されている言葉の組み合わせ（ブログの題名のヒント）▾</summary>
          <div class="chips" style="margin-top:6px">${phrases.map((p) =>
            `<button class="chip ${state.selKw.includes(p.kw) ? "on" : ""}" data-kw="${esc(p.kw)}">${esc(p.kw)}${p.vol ? `<span class="sc">${fmt(p.vol)}</span>` : ""}</button>`).join("")}</div>
        </details>` : ""}
    </div>`;
}

function importRakko(text) {
  const items = parseRakko(text);
  if (!items.length) { toast("言葉が見つかりませんでした。ラッコキーワードの一覧をそのまま貼り付けてください"); return; }
  // 前に取り込んだ分と合わせる（同じ言葉は新しい方を使う）
  const map = new Map((state.rakko?.items || []).map((i) => [i.kw, i]));
  for (const i of items) map.set(i.kw, i);
  state.rakko = { updated: new Date().toLocaleDateString("ja-JP"), items: [...map.values()].slice(-500) };
  store.set("rakko", state.rakko);
  toast(`${items.length}件の言葉を取り込みました`);
  renderKw();
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

// 「お願い文をコピー → AIアプリに貼る → 答えを貼り戻す」の操作欄
function aiPanel(kind) {
  const app = AI_APPS.find((a) => a.id === state.aiApp) || AI_APPS[0];
  const hasKey = !!store.get("apiKey", "");
  const ph = state.photo[kind];
  return `
    <div class="card">
      <h3>① お願い文をコピーして、AIアプリに貼り付け</h3>
      <div class="seg" style="margin:6px 0 10px;padding:0">${AI_APPS.map((a) =>
        `<button data-aiapp="${a.id}" class="${a.id === app.id ? "on" : ""}">${a.name}</button>`).join("")}</div>
      <label class="check"><input type="checkbox" data-withphoto="${kind}" ${state.withPhoto[kind] ? "checked" : ""}> 写真も一緒に送る（AIアプリ側で写真を添付してください）</label>
      ${kind === "blog" ? `<label class="check"><input type="checkbox" id="withImage" ${state.withImage ? "checked" : ""}> 記事に添えるイラスト画像もお願いする（画像を作れるAIのみ）</label>` : ""}
      <button class="btn primary block" data-act="prompt" data-kind="${kind}" style="margin-top:8px">お願い文をコピーして ${esc(app.name)} を開く</button>
      <div class="row end" style="margin-top:6px"><button class="btn sm" data-act="promptOnly" data-kind="${kind}">お願い文をコピーするだけ</button></div>
      <p class="small muted">お客様の名前・電話番号などは書かないでください（無料版のAIは入力が学習に使われる場合があります）。</p>
      <h3 style="margin-top:14px">② AIの答えを、ここに貼り付け</h3>
      <textarea id="paste-${kind}" placeholder="AIの答えを全部コピーして貼り付け"></textarea>
      <div class="row" style="margin-top:8px">
        <button class="btn sm" data-act="pasteClip" data-kind="${kind}">コピーした答えを貼り付け</button>
        <button class="btn sm primary" data-act="pasteIn" data-kind="${kind}">読み取る</button>
      </div>
      ${hasKey ? `
        <h3 style="margin-top:14px">（有料）Claude で1タップ作成</h3>
        <label class="field"><span class="small">写真（任意）</span>
          <input type="file" accept="image/*" data-photo="${kind}">
          ${ph ? `<img class="photo-prev" src="${ph.url}" alt="">` : ""}</label>
        <button class="btn block" data-act="${kind === "style" ? "makeStyle" : "makeBlog"}" ${state.busy ? "disabled" : ""}>
          ${state.busy === kind ? `<span class="spinner"></span>作っています…（30秒ほど）` : "Claude で直接作る（API・有料）"}</button>` : ""}
    </div>`;
}

function promptFor(kind) {
  if (kind === "style") {
    const staff = staffList().find((s) => s.id === $("#styleStaff")?.value) || null;
    return stylePrompt({ salon: salonName(), staff, keywords: state.selKw, memo: $("#styleMemo")?.value || "", withPhoto: state.withPhoto.style });
  }
  return blogPrompt({ salon: salonName(), staff: currentStaff(), keywords: state.selKw, memo: $("#blogMemo")?.value || "",
    length: state.blogLen, withPhoto: state.withPhoto.blog, withImage: state.withImage });
}

function takeAnswer(kind, text) {
  if (kind === "style") {
    const o = parseStyle(text);
    if (!o) return toast("読み取れませんでした。【スタイル名】などの見出しごと貼り付けてください");
    state.styleOut = o;
    store.set("styleOut", o);
  } else {
    const o = parseBlog(text);
    if (!o) return toast("読み取れませんでした。AIの答えを全部貼り付けてください");
    state.blogOut[currentStaff().id] = o;
    store.set("blogOut", state.blogOut);
  }
  renders[state.view]();
  toast("読み取りました");
  document.querySelector(`#view-${kind} h2.done`)?.scrollIntoView({ behavior: "smooth" });
}

function renderStyle() {
  const el = $("#view-style");
  const o = state.styleOut;
  const ng = o ? checkNg([o.styleName, o.comment, o.menu].join("\n")) : [];
  el.innerHTML = `
    <h2>スタイル掲載の文を作る</h2>
    <p class="small muted">サロンボードの「スタイル掲載」に入れる文章の案を、ChatGPT などの AI に作ってもらうためのお願い文を用意します。</p>
    ${selBar("style")}
    <div class="card">
      <label class="field"><span>スタイリスト</span><select id="styleStaff">${staffOptions(state.staffId)}</select></label>
      <label class="field"><span>どんな髪型？（メモ）</span>
        <textarea id="styleMemo" placeholder="例：黒髪のセンターパート。ツイスパで動きを出した。学生さん向け">${esc(store.get("styleMemo", ""))}</textarea></label>
    </div>
    ${aiPanel("style")}
    ${o ? `
      <h2 class="done">できあがり</h2>
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
      <p class="small muted" style="margin:0">これまでの記事 ${fmt(s.total)}件。このうち新しい ${Math.min(4, s.posts.length)}件をお手本としてお願い文に入れます。</p>
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
    </div>
    ${aiPanel("blog")}
    ${o ? `
      <h2 class="done">できあがり</h2>
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
  const pass = store.get("pass", "");
  const roleText = { owner: "オーナー用（売上も見られます）", staff: "スタッフ用（売上は見られません）", ng: "合言葉が違うか、まだレポートが配られていません" }[state.role] || "";
  el.innerHTML = `
    <h2>お店の合言葉</h2>
    <div class="card">
      <p class="small" style="margin-top:0">オーナーが配ったレポート（ランキング）を見るための合言葉です。店長・オーナーから聞いてください。</p>
      <div class="row"><input type="password" id="passIn" class="grow" placeholder="${pass ? "入力済み" : "合言葉"}" autocomplete="off">
        <button class="btn" data-act="savePass">保存</button></div>
      ${roleText ? `<p class="small" style="margin-bottom:0">いまの状態：${esc(roleText)}</p>` : ""}
      ${pass ? `<div class="row end" style="margin-top:6px"><button class="btn sm" data-act="delPass">合言葉を消す</button></div>` : ""}
    </div>

    <details class="card"><summary><b>オーナー用：レポートを全員に配る設定</b>（PCで1回だけ）</summary>
      <div style="margin-top:10px">
        <p class="small" style="margin-top:0">PCでレポートを読み込んで「全員に配る」を押すと、合言葉で鍵をかけてから保存し、全員のアプリに反映されます。</p>
        <label class="field"><span>GitHub の許可証（アクセストークン）${store.get("ghToken", "") ? '<span class="muted">（保存済み）</span>' : ""}</span>
          <input type="password" id="ghToken" placeholder="github_pat_ から始まる文字" autocomplete="off"></label>
        <ol class="steps small">
          <li>github.com にログイン → 右上のアイコン →「Settings」→ 左下「Developer settings」</li>
          <li>「Personal access tokens」→「Fine-grained tokens」→「Generate new token」</li>
          <li>Expiration（期限）：1年 ／ Repository access：「Only select repositories」で <code>salon-helper</code> だけ選ぶ</li>
          <li>Permissions → Repository permissions →「Contents」を「Read and write」→ 作成して、表示された文字を上に貼る</li>
        </ol>
        <label class="field"><span>オーナー用の合言葉（売上も見られる）${store.get("ownerPass", "") ? '<span class="muted">（保存済み）</span>' : ""}</span>
          <div class="row"><input type="text" id="ownerPass" class="grow" placeholder="12文字以上" autocomplete="off">
            <button class="btn sm" data-gen="ownerPass">自動で作る</button></div></label>
        <label class="field"><span>スタッフ用の合言葉（売上は見られない）${store.get("staffPass", "") ? '<span class="muted">（保存済み）</span>' : ""}</span>
          <div class="row"><input type="text" id="staffPass" class="grow" placeholder="12文字以上" autocomplete="off">
            <button class="btn sm" data-gen="staffPass">自動で作る</button></div></label>
        <button class="btn primary" data-act="saveShare">保存</button>
        <p class="small muted">合言葉は、公開の場所に置くデータの鍵になります。短い言葉や誕生日などは使わず、「自動で作る」をおすすめします。<br>
        合言葉を変えたら、もう一度「全員に配る」を押し、スタッフに新しい合言葉を伝えてください（辞めた人が出たときなど）。</p>
      </div>
    </details>

    <h2>文章づくりに使うAI</h2>
    <div class="card note small">
      ふだんは、スタイル・ブログタブの「お願い文をコピー」から、ChatGPT・Gemini・Copilot・Claude の<b>無料版</b>に貼り付けて使えます（費用はかかりません。1日に使える回数には上限があります）。
    </div>
    <h2>（任意・有料）Claude で1タップ作成</h2>
    <div class="card">
      <p class="small" style="margin-top:0">コピー・貼り付けを省きたい人だけ設定します。API キーは「合言葉」のようなもので、<b>この iPhone の中だけ</b>に保存され、Anthropic 社（Claude の会社）以外には送りません。料金はキーの持ち主に請求されます。</p>
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
  if (d.rakko) { window.open(RAKKO_URL + encodeURIComponent(d.rakko), "_blank"); return; }
  if (d.gen) { $("#" + d.gen).value = randomPass(); return; }
  if (d.aiapp) { state.aiApp = d.aiapp; store.set("aiApp", d.aiapp); return renders[state.view](); }
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
    case "prompt": {
      // iPhone では「コピー」と「アプリを開く」をタップと同時に行わないと止められるため、待たずに続けて実行する
      const text = promptFor(d.kind);
      const app = AI_APPS.find((a) => a.id === state.aiApp) || AI_APPS[0];
      navigator.clipboard?.writeText(text).catch(() => {});
      window.open(app.url, "_blank");
      toast("お願い文をコピーしました。AIアプリで貼り付けて送ってください");
      break;
    }
    case "rakkoGo": {
      const q = $("#rakkoQ").value.trim();
      if (q) window.open(RAKKO_URL + encodeURIComponent(q), "_blank");
      break;
    }
    case "rakkoClip": {
      try {
        const t = await navigator.clipboard.readText();
        $("#rakkoPaste").value = t;
        if (t.trim()) importRakko(t);
      } catch { toast("貼り付けできませんでした。上の欄を長押しして「ペースト」してください"); }
      break;
    }
    case "rakkoIn": importRakko($("#rakkoPaste").value); break;
    case "rakkoDel":
      if (confirm("取り込んだラッコキーワードの一覧を消しますか？")) { state.rakko = null; store.del("rakko"); renderKw(); }
      break;
    case "publish": b.disabled = true; await publishReports(); renderAll(); break;
    case "savePass": {
      const v = $("#passIn").value.trim();
      if (!v) { toast("合言葉を入れてください"); break; }
      store.set("pass", v);
      toast("確認しています…");
      await loadShared();
      toast(state.role === "owner" ? "オーナー用で開きました" : state.role === "staff" ? "開きました" : "合言葉が違うか、まだレポートが配られていません");
      renderAll();
      break;
    }
    case "delPass":
      store.del("pass"); state.role = null; forgetShared();
      toast("合言葉を消しました"); renderSet();
      break;
    case "saveShare": {
      const t = $("#ghToken").value.trim(), op = $("#ownerPass").value.trim(), sp = $("#staffPass").value.trim();
      if ((op && len(op) < 12) || (sp && len(sp) < 12)) { toast("合言葉は12文字以上にしてください"); break; }
      if (op && sp && op === sp) { toast("オーナー用とスタッフ用は、別の合言葉にしてください"); break; }
      if (t) store.set("ghToken", t);
      if (op) { store.set("ownerPass", op); store.set("pass", op); }
      if (sp) store.set("staffPass", sp);
      toast("保存しました。合言葉はメモしておいてください");
      renderSet();
      break;
    }
    case "promptOnly": copy(promptFor(d.kind), "お願い文をコピーしました"); break;
    case "pasteClip": {
      try {
        const t = await navigator.clipboard.readText();
        $("#paste-" + d.kind).value = t;
        if (t.trim()) takeAnswer(d.kind, t);
      } catch { toast("貼り付けできませんでした。下の欄を長押しして「ペースト」してください"); }
      break;
    }
    case "pasteIn": {
      const t = $("#paste-" + d.kind).value;
      if (!t.trim()) { toast("AIの答えを貼り付けてください"); break; }
      takeAnswer(d.kind, t);
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
      if (confirm("この端末に保存したレポートを消しますか？（配ったレポートは消えません）")) {
        state.reports = {}; state.issue = null; store.del("reports"); renderAll();
      }
      break;
  }
});

document.addEventListener("change", async (ev) => {
  const t = ev.target;
  if (t.id === "pdfInput" && t.files[0]) { await importPdf(t.files[0]); t.value = ""; }
  if (t.id === "issueSel") { state.issue = t.value; renderAll(); }
  if (t.dataset.withphoto) { state.withPhoto[t.dataset.withphoto] = t.checked; }
  if (t.id === "withImage") { state.withImage = t.checked; store.set("withImage", t.checked); }
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
  await loadShared();
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
