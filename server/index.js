// MAMS Audit AI — web server (Node built-ins only, no npm install needed)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.js';
import { askOpenAI } from './ai.js';
import { DEFAULT_TARIFF, DEFAULT_PACKAGES, DEFAULT_SETTINGS } from './seed.js';

const __dir = path.dirname(fileURLToPath(import.meta.url));
// load .env if present (no dependency needed)
try {
  const envFile = path.join(__dir, '..', '.env');
  if (fs.existsSync(envFile)) for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}
const PUBLIC = path.join(__dir, '..', 'public');
const PORT = process.env.PORT || 3000;
const SECRET = process.env.SESSION_SECRET || 'change-me-in-production';
const DAY = 86400e3;
const ROLES = ['admin', 'auditor', 'viewer'];
const store = await openStore();

/* ---------- passwords & sessions (node:crypto only) ---------- */
const hashPw = (pw, salt = crypto.randomBytes(16).toString('hex')) =>
  salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
const checkPw = (pw, stored) => {
  const [salt, hex] = String(stored || '').split(':');
  if (!salt || !hex) return false;
  const a = Buffer.from(hex, 'hex'), b = crypto.scryptSync(pw, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const sign = s => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
function makeToken(uid) {
  const body = Buffer.from(JSON.stringify({ uid, exp: Date.now() + 7 * DAY })).toString('base64url');
  return body + '.' + sign(body);
}
function readToken(tok) {
  const [body, sig] = String(tok || '').split('.');
  if (!body || !sig || sign(body) !== sig) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.exp > Date.now() ? p : null; } catch { return null; }
}
const cookies = req => Object.fromEntries(String(req.headers.cookie || '').split(';').map(c => {
  const i = c.indexOf('='); return i < 0 ? [c.trim(), ''] : [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1))];
}).filter(x => x[0]));

/* ---------- first run: admin user + master data ---------- */
async function seedIfEmpty() {
  const d = await store.all();
  if (!d.tariff?.length) await store.setCollection('tariff', DEFAULT_TARIFF.map((t, i) => ({ id: 't' + i, ...t })));
  if (!d.packages?.length) await store.setCollection('packages', DEFAULT_PACKAGES.map((p, i) => ({ id: 'p' + i, ...p })));
  if (!Object.keys(d.settings || {}).length) await store.patchSettings(DEFAULT_SETTINGS);
  if (!d.users?.length) {
    const email = (process.env.ADMIN_EMAIL || 'admin@mams.local').toLowerCase();
    const pw = process.env.ADMIN_PASSWORD || 'mams@admin1';
    await store.upsert('users', { id: 'u' + Date.now().toString(36), email, name: 'Administrator', role: 'admin', pass: hashPw(pw), createdAt: new Date().toISOString() });
    console.log(`[seed] admin user created: ${email} / ${pw}  (change the password after first login)`);
  }
}
await seedIfEmpty();

/* ---------- helpers ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const send = (res, code, obj, headers = {}) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
};
const readBody = req => new Promise((ok, no) => {
  let n = 0; const chunks = [];
  req.on('data', c => { n += c.length; if (n > 30e6) { no(new Error('Payload too large (30 MB limit)')); req.destroy(); } chunks.push(c); });
  req.on('end', () => { try { ok(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch (e) { no(new Error('Invalid JSON body')); } });
  req.on('error', no);
});
const publicUser = u => ({ id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.createdAt });
const can = (user, need) => user && (user.role === 'admin' || (need === 'write' && user.role === 'auditor'));

async function userFrom(req) {
  const p = readToken(cookies(req).mams_session);
  if (!p) return null;
  const users = await store.get('users');
  return users.find(u => u.id === p.uid) || null;
}

/* ---------- API ---------- */
async function api(req, res, url, user) {
  const p = url.pathname.replace(/^\/api/, '');
  const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? await readBody(req).catch(e => ({ __err: e.message })) : {};
  if (body.__err) return send(res, 400, { error: body.__err });

  if (p === '/health') return send(res, 200, { ok: true, store: store.kind, ai: !!process.env.OPENAI_API_KEY });

  if (p === '/login' && req.method === 'POST') {
    const users = await store.get('users');
    const u = users.find(x => x.email === String(body.email || '').trim().toLowerCase());
    if (!u || !checkPw(String(body.password || ''), u.pass)) return send(res, 401, { error: 'Wrong email or password' });
    return send(res, 200, { user: publicUser(u) }, { 'Set-Cookie': `mams_session=${makeToken(u.id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${7 * 86400}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}` });
  }
  if (p === '/logout') return send(res, 200, { ok: true }, { 'Set-Cookie': 'mams_session=; HttpOnly; Path=/; Max-Age=0' });

  if (!user) return send(res, 401, { error: 'Please sign in' });
  if (p === '/me') return send(res, 200, { user: publicUser(user) });

  if (p === '/state' && req.method === 'GET') {
    const d = await store.all();
    return send(res, 200, {
      user: publicUser(user), bills: d.bills, tariff: d.tariff, packages: d.packages,
      settings: { ...DEFAULT_SETTINGS, ...d.settings },
      aiReady: !!process.env.OPENAI_API_KEY,
      users: user.role === 'admin' ? d.users.map(publicUser) : undefined
    });
  }

  // bills
  if (p === '/bills' && req.method === 'POST') {
    if (!can(user, 'write')) return send(res, 403, { error: 'Read-only account' });
    const list = Array.isArray(body.bills) ? body.bills : [body.bill];
    const stamped = list.filter(Boolean).map(b => ({ ...b, updatedAt: new Date().toISOString(), updatedBy: user.email }));
    await store.upsertMany('bills', stamped);
    return send(res, 200, { saved: stamped.length });
  }
  if (p.startsWith('/bills/') && req.method === 'DELETE') {
    if (!can(user, 'write')) return send(res, 403, { error: 'Read-only account' });
    return send(res, 200, { deleted: await store.remove('bills', decodeURIComponent(p.slice(7))) });
  }
  if (p === '/bills' && req.method === 'DELETE') {          // clear all (admin)
    if (user.role !== 'admin') return send(res, 403, { error: 'Admins only' });
    await store.setCollection('bills', []);
    return send(res, 200, { ok: true });
  }

  // masters (admin only)
  for (const coll of ['tariff', 'packages']) {
    if (p === '/' + coll && req.method === 'PUT') {
      if (user.role !== 'admin') return send(res, 403, { error: 'Admins only' });
      const list = (body[coll] || []).map((x, i) => ({ id: x.id || coll[0] + i + '_' + Math.random().toString(36).slice(2, 6), ...x }));
      await store.setCollection(coll, list);
      return send(res, 200, { saved: list.length, [coll]: list });
    }
  }
  if (p === '/settings' && req.method === 'PUT') {
    if (user.role !== 'admin') return send(res, 403, { error: 'Admins only' });
    const allow = ['uplift', 'tolerance', 'riskHigh', 'model', 'hospitalName'];
    const clean = Object.fromEntries(Object.entries(body.settings || {}).filter(([k]) => allow.includes(k)));
    return send(res, 200, { settings: await store.patchSettings(clean) });
  }

  // users (admin only)
  if (p === '/users' && req.method === 'POST') {
    if (user.role !== 'admin') return send(res, 403, { error: 'Admins only' });
    const email = String(body.email || '').trim().toLowerCase();
    const pw = String(body.password || '');
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) return send(res, 400, { error: 'Enter a valid email' });
    if (pw.length < 8) return send(res, 400, { error: 'Password must be at least 8 characters' });
    const users = await store.get('users');
    if (users.some(u => u.email === email)) return send(res, 409, { error: 'That email already has an account' });
    const u = { id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), email, name: String(body.name || email).trim(), role: ROLES.includes(body.role) ? body.role : 'auditor', pass: hashPw(pw), createdAt: new Date().toISOString() };
    await store.upsert('users', u);
    return send(res, 200, { user: publicUser(u) });
  }
  if (p.startsWith('/users/') && req.method === 'DELETE') {
    if (user.role !== 'admin') return send(res, 403, { error: 'Admins only' });
    const id = decodeURIComponent(p.slice(7));
    if (id === user.id) return send(res, 400, { error: 'You cannot delete your own account' });
    return send(res, 200, { deleted: await store.remove('users', id) });
  }
  if (p === '/password' && req.method === 'POST') {
    const pw = String(body.password || '');
    if (pw.length < 8) return send(res, 400, { error: 'Password must be at least 8 characters' });
    if (!checkPw(String(body.current || ''), user.pass)) return send(res, 401, { error: 'Current password is wrong' });
    await store.upsert('users', { ...user, pass: hashPw(pw) });
    return send(res, 200, { ok: true });
  }

  // AI proxy
  if (p === '/ai' && req.method === 'POST') {
    if (!can(user, 'write')) return send(res, 403, { error: 'Read-only account' });
    try {
      const settings = await store.get('settings');
      const out = await askOpenAI({ parts: body.parts, json: body.json !== false, model: settings.model });
      return send(res, 200, out);
    } catch (e) { return send(res, e.status || 500, { error: e.message }); }
  }

  return send(res, 404, { error: 'Unknown endpoint ' + p });
}

/* ---------- static files ---------- */
function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.join(PUBLIC, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

/* ---------- server ---------- */
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  try {
    if (url.pathname.startsWith('/api/')) {
      const user = await userFrom(req);
      return await api(req, res, url, user);
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const user = await userFrom(req);
      if (!user) { res.writeHead(302, { Location: '/login.html' }); return res.end(); }
    }
    serveStatic(res, url.pathname);
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
}).listen(PORT, () => console.log(`MAMS Audit AI running on http://localhost:${PORT}  (storage: ${store.kind})`));
