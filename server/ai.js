// OpenAI proxy: the API key never leaves the server.
const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini';
const FALLBACKS = ['gpt-5-mini', 'gpt-5', 'gpt-4.1-mini', 'gpt-4o-mini', 'gpt-4o'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

let modelList = null;
async function listModels(key) {
  if (modelList) return modelList;
  try {
    const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + key } });
    const d = await r.json();
    const ids = (d.data || []).map(m => m.id)
      .filter(n => /^gpt-\d/.test(n) && !/(audio|realtime|transcribe|tts|image|search|instruct|codex|oss|nano|\d{4}-\d{2}-\d{2})/.test(n));
    const ver = n => parseFloat((n.match(/^gpt-(\d+(\.\d+)?)/) || [])[1] || 0);
    const score = n => ver(n) * 10 + (/-mini$/.test(n) ? 2 : 0) + (/^gpt-[\d.]+$/.test(n) ? 1 : 0) - (/preview/.test(n) ? 1 : 0);
    modelList = ids.sort((a, b) => score(b) - score(a));
  } catch { modelList = []; }
  return modelList;
}

async function call(model, content, json, key) {
  const body = { model, messages: [{ role: 'user', content }] };
  if (json) body.response_format = { type: 'json_object' };
  let res, d = {};
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify(body)
    });
    d = await res.json().catch(() => ({}));
  } catch (e) { return { ok: false, status: 0, msg: 'Could not reach OpenAI: ' + e.message, code: 'network' }; }
  return { ok: res.ok, status: res.status, d, code: d?.error?.code || d?.error?.type || '', msg: d?.error?.message || 'OpenAI error ' + res.status };
}

const isQuota = r => /insufficient_quota|billing|exceeded your current quota/i.test(r.code + ' ' + r.msg);
const isAuth = r => r.status === 401 || /invalid_api_key|incorrect api key/i.test(r.code + ' ' + r.msg);
const isBusy = r => !isQuota(r) && ([0, 429, 500, 502, 503, 504].includes(r.status) || /overloaded|rate limit|try again|server_error|timeout/i.test(r.msg));
const isNoModel = r => r.status === 404 || /model_not_found|does not exist|do not have access to (the )?model|deprecated|not supported/i.test(r.code + ' ' + r.msg);

/** parts: [{text}] | [{file:{mime,data,name}}] -> OpenAI content array */
function toContent(parts) {
  return parts.map(p => {
    if (p.text !== undefined) return { type: 'text', text: String(p.text) };
    const f = p.file || {}, url = `data:${f.mime};base64,${f.data}`;
    return String(f.mime || '').startsWith('image/')
      ? { type: 'image_url', image_url: { url, detail: 'high' } }
      : { type: 'file', file: { filename: f.name || 'bill.pdf', file_data: url } };
  });
}

export async function askOpenAI({ parts, json = true, model }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw Object.assign(new Error('OPENAI_API_KEY is not set on the server'), { status: 503 });
  const content = toContent(parts || []);
  const WAITS = [2000, 5000, 10000];
  const tried = new Set(); let queue = [model || DEFAULT_MODEL], r = null, used = null, listed = false;
  while (queue.length) {
    const m = queue.shift(); if (tried.has(m)) continue; tried.add(m);
    for (let i = 0; i <= WAITS.length; i++) {
      r = await call(m, content, json, key);
      if (r.ok) { used = m; break; }
      if (!isBusy(r) || i === WAITS.length) break;
      await sleep(WAITS[i]);
    }
    if (used) break;
    if (isAuth(r)) throw Object.assign(new Error('OpenAI rejected the server API key. ' + r.msg), { status: 502 });
    if (isQuota(r)) throw Object.assign(new Error('OpenAI account has no credit left. ' + r.msg), { status: 402 });
    if (!(isBusy(r) || isNoModel(r))) break;
    if (!listed) { listed = true; const pool = (await listModels(key)); (pool.length ? pool : FALLBACKS).slice(0, 6).forEach(x => { if (!tried.has(x) && !queue.includes(x)) queue.push(x); }); }
  }
  if (!used) throw Object.assign(new Error((r?.msg || 'OpenAI unavailable') + (isBusy(r) ? ' — all models are busy, try again in a minute.' : '')), { status: 502 });
  return { model: used, text: r.d.choices?.[0]?.message?.content || '' };
}
