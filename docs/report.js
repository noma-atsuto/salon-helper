// サロンレポート（HOT PEPPER Beauty Salon Report の PDF）から数字を読み取る。
// PDF の文字は「位置（x, y）と文字列」の集まりなので、同じ高さの文字を1行にまとめ、
// 見出しの横位置を手がかりに表の列へ振り分ける。
// 読み取りはすべて端末の中で行い、どこにも送らない。

// pdf.js のページから {s, x, w, cy} の一覧を作る（cy = 文字の上下の中心）
export async function pageItems(page) {
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  return tc.items
    .filter((i) => i.str && i.str.trim())
    .map((i) => ({
      s: i.str.trim(),
      x: i.transform[4],
      w: i.width,
      cy: vp.height - i.transform[5] - i.transform[3] / 2,
    }));
}

// 高さがほぼ同じ文字を1行にまとめる
function toRows(items) {
  const sorted = [...items].sort((a, b) => a.cy - b.cy);
  const rows = [];
  for (const it of sorted) {
    const r = rows[rows.length - 1];
    if (r && Math.abs(r.cy - it.cy) < 2.2) r.items.push(it);
    else rows.push({ cy: it.cy, items: [it] });
  }
  for (const r of rows) r.items.sort((a, b) => a.x - b.x);
  return rows;
}

const num = (s) => {
  if (s == null) return null;
  const v = parseFloat(String(s).replace(/[,，%]/g, ""));
  return Number.isFinite(v) ? v : null;
};
const has = (rows, text) => rows.some((r) => r.items.some((i) => i.s.includes(text)));
const findRow = (rows, pred, from = 0) => {
  for (let k = from; k < rows.length; k++) if (pred(rows[k])) return k;
  return -1;
};

// 表を読む。cols = [{key, x}]（見出しの左端）。各文字は「左端が見出し以上」の一番右の列に入る。
function readTable(rows, startIdx, x0, x1, cols, stop) {
  const out = [];
  for (let k = startIdx; k < rows.length; k++) {
    const its = rows[k].items.filter((i) => i.x >= x0 && i.x < x1);
    if (stop && stop(rows[k], its)) break;
    if (!its.length) continue;
    const rec = {};
    for (const it of its) {
      let col = null;
      for (const c of cols) if (c.x <= it.x + 3) col = c;
      if (!col) continue;
      rec[col.key] = rec[col.key] ? rec[col.key] + " " + it.s : it.s;
    }
    out.push(rec);
  }
  return out;
}

// 見出し行の中で、列を右端の位置で合わせる（数字が右寄せの表向け）
function nearestByRight(cols, it) {
  const r = it.x + it.w;
  let best = null, bd = Infinity;
  for (const c of cols) {
    const d = Math.abs(c.r - r);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

function readHeader(rows) {
  const info = {};
  for (const r of rows) {
    r.items.forEach((it, k) => {
      const next = r.items[k + 1];
      if (it.s === "貴店名" && next) info.salon = next.s;
      if (/^\d{4}月号$/.test(it.s)) info.issue = it.s.replace("月号", "");
      if (/^\d{4}\/\d{2}\/\d{2}$/.test(it.s)) info.updated = it.s;
      if (it.s === "ご掲載ＣＤ" && next) info.code = next.s;
    });
  }
  return info;
}

// ①ページ：月ごとの来店数・売上・客単価、閲覧数
function readMonthly(rows) {
  const out = {};
  const mIdx = findRow(rows, (r) => r.items[0] && r.items[0].s === "月" && r.items.some((i) => /^\d{2}月$/.test(i.s)));
  if (mIdx < 0) return out;
  const yIdx = findRow(rows, (r) => r.items.some((i) => i.s === "年"));
  const years = yIdx >= 0 ? rows[yIdx].items.filter((i) => /^\d{4}年$/.test(i.s) && i.x < 545) : [];
  const months = rows[mIdx].items.filter((i) => /^\d{2}月$/.test(i.s) && i.x < 545);
  const cols = months.map((m) => {
    let y = null;
    for (const yy of years) if (yy.x <= m.x + 5) y = yy.s.replace("年", "");
    return { label: `${y ?? ""}/${m.s.replace("月", "")}`, r: m.x + m.w };
  });
  out.labels = cols.map((c) => c.label);
  let totalSeen = 0;
  for (let k = mIdx + 1; k < rows.length; k++) {
    const label = rows[k].items.filter((i) => i.x >= 50 && i.x < 140).map((i) => i.s).join("");
    if (!label) continue;
    let key = null;
    if (label === "合計") key = totalSeen++ === 0 ? "visitors" : "sales";
    else if (label === "合計単価") key = "unit";
    else if (label === "NET予約数") key = "netVisitors";
    if (!key) continue;
    const vals = new Array(cols.length).fill(null);
    for (const it of rows[k].items.filter((i) => i.x >= 140 && i.x < 545)) {
      const c = nearestByRight(cols, it);
      vals[cols.indexOf(c)] = num(it.s);
    }
    out[key] = vals;
    if (key === "sales") break;
  }
  // 右側：サイト閲覧数（号ごと）
  const pIdx = findRow(rows, (r) => r.items.some((i) => i.s === "発行月"));
  if (pIdx >= 0) {
    const issues = rows[pIdx].items.filter((i) => /^\d{2}月号$/.test(i.s));
    const pcols = issues.map((m) => ({ label: m.s, r: m.x + m.w }));
    out.pvLabels = pcols.map((c) => c.label);
    const want = { "総PV数": "pvTotal", "ｽﾀｲﾙ詳細": "pvStyle", "予約完了": "pvReserve", "サロン情報": "pvSalon" };
    for (let k = pIdx + 1; k < rows.length; k++) {
      const lab = rows[k].items.find((i) => i.x >= 545 && i.x < 600);
      if (!lab) continue;
      const hit = Object.keys(want).find((w) => lab.s.startsWith(w));
      if (!hit || out[want[hit]]) continue;
      const vals = new Array(pcols.length).fill(null);
      for (const it of rows[k].items.filter((i) => i.x >= 660)) {
        const c = nearestByRight(pcols, it);
        vals[pcols.indexOf(c)] = num(it.s);
      }
      out[want[hit]] = vals;
    }
  }
  return out;
}

// ⑦ページ：ブックマーク・閲覧ランキング
function readStyleRanking(rows) {
  const out = {};
  const hIdx = findRow(rows, (r) => r.items.filter((i) => i.s === "スタイル名").length >= 3);
  if (hIdx < 0) return out;
  const head = rows[hIdx].items;
  const starts = head.filter((i) => i.s === "スタイル名").map((i) => i.x);
  const group = (g) => {
    const x0 = starts[g] - 3, x1 = g + 1 < starts.length ? starts[g + 1] - 3 : 9999;
    return { x0, x1, cols: head.filter((i) => i.x >= x0 && i.x < x1) };
  };
  const keyOf = { "スタイル名": "name", "掲載No": "no", "スタイリスト名": "stylist", "登録数": "count", "閲覧数": "count" };
  const read = (g) => {
    const { x0, x1, cols } = group(g);
    return readTable(rows, hIdx + 1, x0, x1, cols.map((c) => ({ key: keyOf[c.s] || c.s, x: c.x })))
      .filter((r) => r.name && r.count != null)
      .map((r) => ({ name: r.name, no: r.no || "", stylist: r.stylist || "", count: num(r.count) }));
  };
  out.bookmarkStyles = read(0);
  out.newBookmarkStyles = read(1);
  out.styleViews = starts.length >= 4 ? [...read(2), ...read(3)] : read(2);
  out.styleViews.sort((a, b) => b.count - a.count);

  // 左端：スタッフのブックマーク数と閲覧数
  const leftX1 = starts[0] - 3;
  const viewIdx = findRow(rows, (r) => r.items.some((i) => i.s.includes("スタイリスト閲覧ランキング")));
  const pick = (from, to) => {
    const list = [];
    for (let k = from; k < to; k++) {
      const its = rows[k].items.filter((i) => i.x < leftX1);
      const name = its.filter((i) => i.x < 80).map((i) => i.s).join(" ");
      const val = its.find((i) => i.x >= 80 && /^[\d,]+$/.test(i.s));
      if (name && val && !/ｽﾀｲﾘｽﾄ|閲覧|登録/.test(name)) list.push({ name, count: num(val.s) });
    }
    return list;
  };
  out.bookmarkStylists = pick(hIdx, viewIdx < 0 ? rows.length : viewIdx);
  out.stylistViews = viewIdx < 0 ? [] : pick(viewIdx + 1, rows.length);
  return out;
}

// ⑧ページ：スタッフ別・メニュー別・クーポン別のネット予約数
function readReservations(rows) {
  const out = {};
  const hIdx = findRow(rows, (r) => r.items.some((i) => i.s === "スタイリスト名") && r.items.some((i) => /月号$/.test(i.s)));
  if (hIdx < 0) return out;
  const head = rows[hIdx].items;
  const xOf = (s, n = 0) => head.filter((i) => i.s === s)[n]?.x;
  const monthsIn = (x0, x1) => head.filter((i) => /^\d{2}月号$/.test(i.s) && i.x >= x0 && i.x < x1);
  const stop = (r) => r.items.some((i) => i.s.startsWith("※"));
  const toRowsOut = (x0, x1, cols, nameCol) => readTable(rows, hIdx + 1, x0, x1, cols, stop)
    .filter((r) => r[nameCol])
    .map((r) => ({ name: r[nameCol], v: cols.filter((c) => /^m\d+$/.test(c.key)).map((c) => num(r[c.key]) ?? 0) }));

  // スタッフ
  const menuX = xOf("メニュー名");
  const sMonths = monthsIn(0, menuX);
  const sCols = [{ key: "name", x: xOf("スタイリスト名") }, ...sMonths.map((m, k) => ({ key: "m" + k, x: m.x })),
    { key: "nomi", x: xOf("指名予約可") ?? 9999 }, { key: "waku", x: xOf("複数枠") ?? 9999 }];
  out.stylists = { months: sMonths.map((m) => m.s), rows: toRowsOut(0, menuX - 3, sCols, "name") };

  // メニュー
  const msg1 = xOf("メッセージ", 0), msg2 = xOf("メッセージ", 1);
  const mMonths = monthsIn(menuX, msg1);
  const mCols = [{ key: "name", x: menuX }, ...mMonths.map((m, k) => ({ key: "m" + k, x: m.x }))];
  out.menus = { months: mMonths.map((m) => m.s), rows: toRowsOut(menuX - 3, msg1 - 3, mCols, "name") };

  // クーポン（2列に分かれていることがある）
  const cTable = (x0, x1) => {
    const ms = monthsIn(x0, x1);
    const nameX = head.find((i) => i.s === "クーポン名" && i.x >= x0 && i.x < x1)?.x ?? x0 + 30;
    const cols = [{ key: "msg", x: x0 }, { key: "name", x: nameX }, ...ms.map((m, k) => ({ key: "m" + k, x: m.x }))];
    return { months: ms.map((m) => m.s), rows: toRowsOut(x0 - 3, x1 - 3, cols, "name") };
  };
  const c1 = cTable(msg1, msg2 ?? 9999);
  const c2 = msg2 ? cTable(msg2, 9999) : { rows: [] };
  out.coupons = { months: c1.months, rows: [...c1.rows, ...c2.rows] };
  return out;
}

// pages: [[{s,x,w,cy}, ...], ...]（1ページごと）
export function parseReport(pages) {
  const rep = { version: 1 };
  for (const items of pages) {
    const rows = toRows(items);
    if (!rep.salon) Object.assign(rep, readHeader(rows));
    if (has(rows, "■ご集客状況")) rep.monthly = readMonthly(rows);
    if (has(rows, "■スタイリスト・スタイルランキング")) Object.assign(rep, readStyleRanking(rows));
    if (has(rows, "■スタイリスト・メニュー・クーポンランキング")) Object.assign(rep, readReservations(rows));
  }
  return rep;
}

// 読み取れた項目の数（うまく読めたかの確認用）
export function reportSummary(rep) {
  return {
    months: rep.monthly?.labels?.length ?? 0,
    stylists: rep.stylists?.rows?.length ?? 0,
    styles: rep.styleViews?.length ?? 0,
    coupons: rep.coupons?.rows?.length ?? 0,
    menus: rep.menus?.rows?.length ?? 0,
  };
}
