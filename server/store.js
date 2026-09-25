// Storage layer. Default: a JSON file on disk (zero dependencies).
// Optional: PostgreSQL when DATABASE_URL is set AND the "pg" package is installed.
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'mams.json');
const EMPTY = { users: [], bills: [], tariff: [], packages: [], settings: {} };

/* ---------- file backend ---------- */
function fileStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let cache = null, writing = false, again = false;
  const read = () => {
    if (cache) return cache;
    try { cache = { ...EMPTY, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; }
    catch { cache = structuredClone(EMPTY); }
    return cache;
  };
  const flush = () => {                       // atomic write, never twice at once
    if (writing) { again = true; return; }
    writing = true;
    const tmp = FILE + '.tmp';
    fs.promises.writeFile(tmp, JSON.stringify(cache, null, 1))
      .then(() => fs.promises.rename(tmp, FILE))
      .catch(e => console.error('[store] write failed:', e.message))
      .finally(() => { writing = false; if (again) { again = false; flush(); } });
  };
  return {
    kind: 'file (' + FILE + ')',
    async all() { return structuredClone(read()); },
    async get(coll) { return structuredClone(read()[coll]); },
    async setCollection(coll, list) { read()[coll] = list; flush(); },
    async patchSettings(obj) { const d = read(); d.settings = { ...d.settings, ...obj }; flush(); return d.settings; },
    async upsert(coll, row) {
      const d = read(), i = d[coll].findIndex(x => x.id === row.id);
      if (i >= 0) d[coll][i] = row; else d[coll].push(row);
      flush(); return row;
    },
    async upsertMany(coll, rows) { for (const r of rows) await this.upsert(coll, r); return rows.length; },
    async remove(coll, id) { const d = read(); const n = d[coll].length; d[coll] = d[coll].filter(x => x.id !== id); flush(); return n !== d[coll].length; }
  };
}

/* ---------- postgres backend (optional, needs: npm i pg) ---------- */
async function pgStore(url) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  await pool.query(`CREATE TABLE IF NOT EXISTS records(
      id TEXT PRIMARY KEY, coll TEXT NOT NULL, data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT now())`);
  await pool.query(`CREATE INDEX IF NOT EXISTS records_coll ON records(coll)`);
  const list = async coll => (await pool.query('SELECT data FROM records WHERE coll=$1', [coll])).rows.map(r => r.data);
  const store = {
    kind: 'postgres',
    async get(coll) {
      if (coll === 'settings') { const r = await pool.query(`SELECT data FROM records WHERE id='settings'`); return r.rows[0]?.data || {}; }
      return list(coll);
    },
    async all() {
      const o = { ...EMPTY };
      for (const c of ['users', 'bills', 'tariff', 'packages']) o[c] = await list(c);
      o.settings = await store.get('settings');
      return o;
    },
    async setCollection(coll, rows) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await c.query('DELETE FROM records WHERE coll=$1', [coll]);
        for (const r of rows) {
          const id = r.id || `${coll}:${r.code || r.service || Math.random().toString(36).slice(2)}`;
          await c.query('INSERT INTO records(id,coll,data) VALUES($1,$2,$3)', [id, coll, { ...r, id }]);
        }
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    },
    async patchSettings(obj) {
      const cur = await store.get('settings'), next = { ...cur, ...obj };
      await pool.query(`INSERT INTO records(id,coll,data) VALUES('settings','settings',$1)
        ON CONFLICT (id) DO UPDATE SET data=$1, updated_at=now()`, [next]);
      return next;
    },
    async upsert(coll, row) {
      await pool.query(`INSERT INTO records(id,coll,data) VALUES($1,$2,$3)
        ON CONFLICT (id) DO UPDATE SET data=$3, coll=$2, updated_at=now()`, [row.id, coll, row]);
      return row;
    },
    async upsertMany(coll, rows) { for (const r of rows) await store.upsert(coll, r); return rows.length; },
    async remove(coll, id) { const r = await pool.query('DELETE FROM records WHERE id=$1 AND coll=$2', [id, coll]); return r.rowCount > 0; }
  };
  return store;
}

export async function openStore() {
  const url = process.env.DATABASE_URL;
  if (url) {
    try { const s = await pgStore(url); console.log('[store] using PostgreSQL'); return s; }
    catch (e) { console.error('[store] PostgreSQL unavailable (' + e.message + ') — falling back to file store'); }
  }
  const s = fileStore();
  console.log('[store] using ' + s.kind);
  return s;
}
