// レポートを「合言葉で鍵をかけて」全員に配る部分。
// 公開の保管場所（GitHub）には、鍵のかかった読めないデータだけを置く。鍵を開けるのは各端末の中だけ。
//   report-owner.enc.json … 全部入り（売上・来店数・客単価も）→ オーナー用の合言葉で開く
//   report-staff.enc.json … 売上などを除いたもの（ランキング・キーワード用）→ スタッフ用の合言葉で開く

export const REPO = "noma-atsuto/salon-helper"; // 保存先（持ち主/保管場所の名前）
export const FILES = { owner: "docs/data/report-owner.enc.json", staff: "docs/data/report-staff.enc.json" };
const ITER = 310000; // 合言葉から鍵を作るときの繰り返し回数（多いほど総当たりに強い）

const enc = new TextEncoder();
const dec = new TextDecoder();
const toB64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function keyFrom(pass, salt, iter) {
  const base = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function lock(obj, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFrom(pass, salt, ITER);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(obj)));
  return { v: 1, iter: ITER, salt: toB64(salt), iv: toB64(iv), ct: toB64(ct), at: new Date().toISOString() };
}

// 合言葉が違うときは null を返す
export async function unlock(box, pass) {
  try {
    const key = await keyFrom(pass, fromB64(box.salt), box.iter);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(box.iv) }, key, fromB64(box.ct));
    return JSON.parse(dec.decode(pt));
  } catch {
    return null;
  }
}

// スタッフ向け：売上・来店数・客単価（月ごとの集計）を取り除く
export function staffView(report) {
  const { monthly, ...rest } = report;
  void monthly;
  return { ...rest, staffOnly: true };
}

// 公開ページに置かれた鍵つきファイルを読む（なければ null）
export async function fetchBox(kind) {
  try {
    const res = await fetch(FILES[kind].replace(/^docs\//, ""), { cache: "no-cache" });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// GitHub にファイルを保存する（オーナーのPCから）。token は保管場所への書き込み許可証。
async function gh(path, opts, token) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    ...opts,
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" },
  });
  if (res.status === 401) throw new Error("GitHub の許可証が正しくないか、期限切れです。");
  if (res.status === 403 || (res.status === 404 && opts.method === "PUT")) throw new Error("この許可証には保存の権限がありません（Contents の Read and write が必要）。");
  return res;
}

export async function putBox(kind, box, token) {
  const path = FILES[kind];
  const cur = await gh(path, { method: "GET" }, token);
  const sha = cur.ok ? (await cur.json()).sha : undefined;
  const body = {
    message: `レポートを更新（${kind === "owner" ? "オーナー用" : "スタッフ用"}・鍵つき）`,
    content: toB64(enc.encode(JSON.stringify(box))),
    ...(sha ? { sha } : {}),
  };
  const res = await gh(path, { method: "PUT", body: JSON.stringify(body) }, token);
  if (!res.ok) throw new Error(`GitHub への保存に失敗しました（${res.status}）`);
}

// 推測されにくい合言葉を作る（例：kumo-sora-7421-hana-mori-yuki）
// 64語から5つ＋4けたの数字 = 約10兆通り。公開の場所に置くので、短い合言葉は使わない。
const WORDS = ("sora hana kumo umi yama kaze hoshi tsuki mori kawa yuki niji sakura momiji ame hikari " +
  "neko inu tori kame kuma risu usagi saru shika tanuki kitsune hato kani tako ika ebi " +
  "ringo momo kaki nashi budo mikan ichigo suika kuri mame cha kome pan mochi dango sushi " +
  "hashi mado kagi kasa tsue fune kuruma eki machi niwa ike oka shima tani hara nami").split(" ");
export function randomPass() {
  const r = crypto.getRandomValues(new Uint32Array(6));
  const w = (k) => WORDS[r[k] % WORDS.length];
  return `${w(0)}-${w(1)}-${1000 + (r[2] % 9000)}-${w(3)}-${w(4)}-${w(5)}`;
}
