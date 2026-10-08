// 文章づくりのお願い文（プロンプト）を作る部分。
// 基本は「お願い文をコピー → ChatGPT・Gemini などの無料版に貼り付け → できた文を貼り戻す」。
// API キー（有料・任意）を保存した端末だけ、Claude で1タップ作成もできる。
// API キーはこの iPhone の中にだけ保存し、Anthropic 社以外には送らない。
const SDK_URL = "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.132.1/+esm";
const MODEL = "claude-opus-5";

// 貼り付け先のAI（iPhone にアプリが入っていれば、アプリで開く）
export const AI_APPS = [
  { id: "chatgpt", name: "ChatGPT", url: "https://chatgpt.com/" },
  { id: "gemini", name: "Gemini", url: "https://gemini.google.com/app" },
  { id: "copilot", name: "Copilot", url: "https://copilot.microsoft.com/" },
  { id: "claude", name: "Claude", url: "https://claude.ai/new" },
];

// 薬機法（化粧品などの効き目の書き方を決めた法律）や広告のルールで注意が必要な言い方
export const NG_WORDS = [
  { re: /治[るすり]|治療|完治/, why: "「治る」は医療の効き目の表現" },
  { re: /修復|補修|再生/, why: "髪が「修復・再生する」は効き目の言い過ぎ" },
  { re: /発毛|育毛|抜け毛(が|を)?(止|防|減)|薄毛(が|を)?(改善|解消)/, why: "発毛・育毛の効き目は書けない" },
  { re: /アンチエイジング|若返/, why: "若返りの効き目の表現" },
  { re: /必ず|絶対|100%|１００％|永久|一生/, why: "言い切り・保証の表現" },
  { re: /No\.?1|ナンバーワン|日本一|業界初|最高級|最安/, why: "根拠のいる一番表現" },
  { re: /副作用|安全(です|な)|ダメージ(ゼロ|0|なし)|傷まない/, why: "安全性の言い切り" },
];

export function checkNg(text) {
  const hits = [];
  for (const ng of NG_WORDS) {
    const m = String(text).match(ng.re);
    if (m) hits.push({ word: m[0], why: ng.why });
  }
  return hits;
}

const RULES = `守ること:
- 薬機法・美容師法・景品表示法に気をつける。「治る」「修復」「再生」「発毛」「必ず」「絶対」「No.1」「ダメージゼロ」など、効き目や結果を言い切る言葉は使わない。
- 値段・クーポン内容・営業時間・実績の数字など、渡されていない事実は書かない。
- ほかのお店や人を悪く言わない。
- 渡されたキーワードは、文章として自然になる範囲で入れる。詰め込みすぎない。`;

const IMAGE_RULE = `
最後に、記事に添えるイラスト風の画像を1枚作ってください。
- 季節感や雰囲気が伝わる、ひと目でイラストと分かるもの
- 実在の人物や、実際の髪型写真に見える画像は作らない（お店の施術写真と誤解されないため）
- 画像の中に文字は入れない`;

function staffProfile(staff) {
  if (!staff) return "";
  return `担当スタイリスト: ${staff.name}${staff.role ? `（${staff.role}）` : ""}${staff.catch ? `\nひとこと: ${staff.catch}` : ""}`;
}

const STYLE_FIELDS = `各欄の決まり:
- スタイル名: 全角30文字以内。髪型の特徴が分かる言葉を「/」や「×」でつなぐ形でもよい。
- コメント: スタイリストコメント。全角120文字以内。どんな人に似合うか・セットのしやすさなどを、スタイリスト本人の言葉として書く。
- メニュー内容: 全角50文字以内。例「カット＋ツイストスパイラルパーマ」。
- ハッシュタグ: 8〜10個。「#」は付けず、1つ20文字以内。
- 長さ: ベリーショート／ショート／ミディアム／セミロング／ロング のどれか。
- チェック: パーマ／ストレートパーマ・縮毛矯正／エクステ／ブリーチ のうち当てはまるもの。なければ「なし」。
- 確認してほしい点: 写真やメモから分からず推測した部分（なければ「なし」）。`;

function styleParts({ salon, staff, keywords, memo }) {
  return {
    system: `あなたはメンズ美容室「${salon}」の、ホットペッパービューティーのスタイル掲載文を書くアシスタントです。
お客様が検索で見つけやすく、写真の髪型が伝わる文を作ります。

${RULES}

${STYLE_FIELDS}`,
    user: `${staffProfile(staff)}
入れたいキーワード: ${keywords.join("、") || "（おまかせ）"}
髪型のメモ: ${memo || "（なし）"}`,
  };
}

function blogParts({ salon, staff, keywords, memo, length }) {
  const samples = (staff?.posts || []).slice(0, 4)
    .map((p, k) => `--- お手本${k + 1}「${p.title}」\n${p.body.slice(0, 1200)}`)
    .join("\n\n");
  const size = { short: "300〜400文字", normal: "500〜700文字", long: "800〜1000文字" }[length] || "500〜700文字";
  return {
    system: `あなたはメンズ美容室「${salon}」のスタイリスト本人になりきって、ホットペッパービューティーのブログを書くアシスタントです。

${staffProfile(staff)}

この人が過去に書いたブログをお手本として渡します。あいさつ・名乗り方・改行の多さ・絵文字や記号（◎！など）の使い方・
最後の締め方（キーワードを「/」で並べる行など）といった「書きぐせ」をまねてください。
ただし、お手本の文をそのまま写さず、新しい内容として書いてください。

${RULES}

決まり:
- 題名: 全角30文字以内を目安に。キーワードを1つ以上自然に入れる。
- 本文: ${size}。改行を使って読みやすく。
- 確認してほしい点: 推測で書いた部分や、投稿前に本人が確かめるべき点（なければ「なし」）。

お手本:
${samples || "（お手本がありません。メンズ美容室のスタイリストらしい、親しみやすい文にしてください）"}`,
    user: `入れたいキーワード: ${keywords.join("、") || "（おまかせ）"}
今回書きたいこと: ${memo || "（おまかせ。キーワードに合うおすすめスタイルの紹介）"}`,
  };
}

// ---- ChatGPT などに貼り付けるお願い文 ----
export function stylePrompt(args) {
  const p = styleParts(args);
  return `${p.system}

${p.user}
${args.withPhoto ? "\n（髪型の写真を一緒に送ります。写真の髪型に合わせて書いてください）\n" : ""}
次の形のまま、見出しも含めて答えてください（前置きやまとめは不要）:
【スタイル名】
【コメント】
【メニュー内容】
【ハッシュタグ】（「、」区切り）
【長さ】
【チェック】
【確認してほしい点】`;
}

export function blogPrompt(args) {
  const p = blogParts(args);
  return `${p.system}

${p.user}
${args.withPhoto ? "\n（参考の写真を一緒に送ります。写真の内容に合わせて書いてください）\n" : ""}
次の形のまま、見出しも含めて答えてください（前置きやまとめは不要）:
【題名】
【本文】
【確認してほしい点】
${args.withImage ? IMAGE_RULE : ""}`;
}

// ---- 貼り戻された答えを欄ごとに分ける ----
function sections(text) {
  const out = {};
  const re = /【([^】]+)】([\s\S]*?)(?=【[^】]+】|$)/g;
  let m;
  while ((m = re.exec(String(text)))) {
    out[m[1].replace(/[（(].*$/, "").trim()] = m[2]
      .replace(/[*＊#]{2,}/g, "")
      .replace(/^[\s:：]*([（(][^）)\n]*[）)])?[\s:：]*/, "") // 見出しの後ろの（「、」区切り）などを除く
      .trim();
  }
  return out;
}
const none = (s) => (!s || /^なし[。.]?$/.test(s.trim()) ? "" : s.trim());

export function parseStyle(text) {
  const s = sections(text);
  if (!s["スタイル名"] && !s["コメント"]) return null;
  return {
    styleName: s["スタイル名"] || "",
    comment: s["コメント"] || "",
    menu: s["メニュー内容"] || "",
    hashtags: (s["ハッシュタグ"] || "").split(/[、,，\s]+/).map((t) => t.replace(/^[#＃]/, "").trim()).filter(Boolean),
    length: s["長さ"] || "",
    checks: none(s["チェック"]) ? s["チェック"].split(/[、,，／/]+/).map((t) => t.trim()).filter(Boolean) : [],
    notes: none(s["確認してほしい点"]),
  };
}

export function parseBlog(text) {
  const s = sections(text);
  if (!s["題名"] && !s["本文"]) {
    // 見出しなしで貼られたときは、1行目を題名、残りを本文とみなす
    const lines = String(text).trim().split("\n");
    if (!lines[0]) return null;
    return { title: lines[0].trim(), body: lines.slice(1).join("\n").trim(), notes: "" };
  }
  return { title: s["題名"] || "", body: s["本文"] || "", notes: none(s["確認してほしい点"]) };
}

// ================= ここから Claude API（有料・任意） =================
let clientPromise = null;
async function getClient(apiKey) {
  if (!clientPromise || clientPromise.key !== apiKey) {
    const p = import(SDK_URL).then(({ default: Anthropic }) => ({
      Anthropic,
      client: new Anthropic({ apiKey, dangerouslyAllowBrowser: true }),
    }));
    p.key = apiKey;
    clientPromise = p;
  }
  return clientPromise;
}

// 決まった形（JSON）で答えをもらう
async function ask({ apiKey, system, content, schema }) {
  if (!apiKey) throw new Error("設定タブで API キーを入れてください。");
  const { Anthropic, client } = await getClient(apiKey);
  let res;
  try {
    res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema } },
      system,
      messages: [{ role: "user", content }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error("API キーが正しくないようです。設定タブで確認してください。");
    if (e instanceof Anthropic.PermissionDeniedError) throw new Error("この API キーでは使えません（権限・残高を確認してください）。");
    if (e instanceof Anthropic.RateLimitError) throw new Error("混み合っています。1分ほど待ってからもう一度お試しください。");
    if (e instanceof Anthropic.APIConnectionError) throw new Error("通信できませんでした。電波の良いところでもう一度お試しください。");
    if (e instanceof Anthropic.APIError) throw new Error(`AI の呼び出しでエラーが出ました（${e.status ?? "?"}）: ${e.message}`);
    throw e;
  }
  if (res.stop_reason === "refusal") throw new Error("AI がこの内容では作れないと判断しました。メモの書き方を変えてお試しください。");
  if (res.stop_reason === "max_tokens") throw new Error("文章が長くなりすぎました。もう一度お試しください。");
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return JSON.parse(text);
}

// 写真を AI に渡せる形（縮小した JPEG）にする
export async function imageBlock(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  const data = c.toDataURL("image/jpeg", 0.85).split(",")[1];
  return { type: "image", source: { type: "base64", media_type: "image/jpeg", data } };
}

const JSON_NOTE = "\n\n答えは指定の JSON の形で返す。styleName=スタイル名, comment=コメント, menu=メニュー内容, hashtags=ハッシュタグ, length=長さ, checks=チェック（なければ空）, notes=確認してほしい点（なければ空文字）。title=題名, body=本文。";

export async function makeStyle({ apiKey, image, ...args }) {
  const p = styleParts(args);
  const content = [...(image ? [image] : []), { type: "text", text: p.user }];
  return ask({
    apiKey, system: p.system + JSON_NOTE, content,
    schema: {
      type: "object",
      properties: {
        styleName: { type: "string" }, comment: { type: "string" }, menu: { type: "string" },
        hashtags: { type: "array", items: { type: "string" } }, length: { type: "string" },
        checks: { type: "array", items: { type: "string" } }, notes: { type: "string" },
      },
      required: ["styleName", "comment", "menu", "hashtags", "length", "checks", "notes"],
      additionalProperties: false,
    },
  });
}

export async function makeBlog({ apiKey, image, ...args }) {
  const p = blogParts(args);
  const content = [...(image ? [image] : []), { type: "text", text: p.user }];
  return ask({
    apiKey, system: p.system + JSON_NOTE, content,
    schema: {
      type: "object",
      properties: { title: { type: "string" }, body: { type: "string" }, notes: { type: "string" } },
      required: ["title", "body", "notes"],
      additionalProperties: false,
    },
  });
}

// 設定タブの「つながるか確認」用（ごく短いやりとり）
export async function testKey(apiKey) {
  const r = await ask({
    apiKey, system: "短く答えてください。", content: "「OK」とだけ返してください。",
    schema: { type: "object", properties: { reply: { type: "string" } }, required: ["reply"], additionalProperties: false },
  });
  return r.reply;
}
