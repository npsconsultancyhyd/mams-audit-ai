# MAMS Audit AI — web app

Hospital billing audit for **Cash · Insurance · Aarogyasri** bills: tariff and package checks,
implant market-price checks, ChatGPT bill reading and suggested bills, dashboards and Excel export.

This is the single-page app you already have, rebuilt as a proper web app: a small Node server,
shared data for the whole team, user accounts with roles, and the OpenAI key kept on the server.

---

## What's in the box

```
mams-audit/
├── package.json         no dependencies — runs on plain Node 20+
├── .env.example         copy to .env and fill in
├── render.yaml          one-click config for Render
├── Dockerfile           if you'd rather run a container
├── server/
│   ├── index.js         HTTP server, sessions, roles, REST API, static files
│   ├── store.js         storage: JSON file by default, PostgreSQL optional
│   ├── ai.js            OpenAI proxy (retries, model fallback) — holds the key
│   └── seed.js          tariff, packages and default settings for first run
└── public/
    ├── index.html       app shell
    ├── login.html       sign-in page
    ├── styles.css       all styling (light + dark)
    └── app.js           the whole audit app: rules engine, views, AI, Excel export
```

## Run it locally

```bash
cd mams-audit
cp .env.example .env          # then edit .env
npm start                     # http://localhost:3000
```

There is nothing to install — `npm install` is optional and installs nothing.
Open the printed URL and sign in with the `ADMIN_EMAIL` / `ADMIN_PASSWORD` from your `.env`.
The first run creates that admin account, the cash tariff and the package master; change the
password from **Settings & AI** straight away.

## Deploy

### Render (matches `render.yaml`)
1. Push this folder to a GitHub repository.
2. Render → **New → Blueprint** → pick the repo. It reads `render.yaml`.
3. Set `OPENAI_API_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` when asked. `SESSION_SECRET` is generated.
4. Deploy. Build command is empty; start command is `node server/index.js`.

`render.yaml` attaches a 1 GB disk at `/var/data` for the JSON data file. **A disk needs a paid
instance type** — on the free tier the disk is dropped and data disappears on every redeploy, so
either use a paid instance or attach PostgreSQL (below).

### Railway
New project → Deploy from repo → add a **Volume** mounted at `/data`, then set `DATA_DIR=/data`
plus the same environment variables. Start command: `node server/index.js`.

### Vercel
Vercel's serverless functions have no persistent disk, so use it only with PostgreSQL
(`DATABASE_URL`, see below) — and note this server is a plain Node HTTP server, so Render,
Railway, Fly.io, a VPS or Docker fit it better.

### Docker / hospital server
```bash
docker build -t mams-audit .
docker run -d -p 3000:3000 --env-file .env -v mams-data:/data mams-audit
```

## Environment variables

| Variable | What it does |
|---|---|
| `OPENAI_API_KEY` | Your OpenAI key. Stays on the server; the browser never sees it. |
| `OPENAI_MODEL` | Starting model, default `gpt-5-mini`. The server falls back to another model if this one is retired or busy. |
| `SESSION_SECRET` | Signs the login cookie. Use a long random string; changing it signs everyone out. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | The administrator created on first run (ignored afterwards). |
| `HOSPITAL_NAME` | Shown under the app title. |
| `DATA_DIR` | Where the JSON data file lives. Default `./data`. |
| `DATABASE_URL` | Optional PostgreSQL. See below. |
| `PORT` | Default 3000. |

## Storage

**Default — JSON file** at `$DATA_DIR/mams.json`, written atomically. Simple, fast, no setup, and
easy to back up: copy the file. Fine for one hospital's audit volume. It needs a persistent disk.

**PostgreSQL (optional)** — set `DATABASE_URL` and run `npm i pg` once. The server creates a
single `records` table and uses it instead of the file. Choose this on hosts with no disk, or when
you want managed backups. I could not test this adapter from my sandbox (no network access to a
database), so try it on a scratch database first; the file store is the tested path.

Either way, **Settings & AI → Backup JSON** downloads everything, and **Restore JSON** loads it back.

## Accounts and roles

| Role | Can do |
|---|---|
| `admin` | Everything: tariff master, package master, settings, users, clearing data. |
| `auditor` | Add, edit and delete bills, bulk import, run the AI features, export. |
| `viewer` | Read and export only. The Bill Input tab is hidden and the server rejects any write. |

Admins add users under **Settings & AI**. Passwords are hashed with scrypt; the session is a signed
HttpOnly cookie valid for 7 days. Put the app behind HTTPS (Render, Railway and Fly do this for
you) — the cookie is marked `Secure` when `NODE_ENV=production`.

## How the app talks to the server

| Endpoint | Purpose |
|---|---|
| `POST /api/login`, `POST /api/logout`, `GET /api/me` | Sign in / out |
| `GET /api/state` | Everything the app needs: bills, tariff, packages, settings, user |
| `POST /api/bills`, `DELETE /api/bills/:id`, `DELETE /api/bills` | Save / remove bills |
| `PUT /api/tariff`, `PUT /api/packages`, `PUT /api/settings` | Master data (admin) |
| `POST /api/users`, `DELETE /api/users/:id`, `POST /api/password` | Accounts |
| `POST /api/ai` | Proxy to OpenAI — the browser sends text or a file, never a key |
| `GET /api/health` | `{ok, store, ai}` for uptime checks |

The browser saves changes as you make them and re-reads from the server every 60 seconds, so two
auditors working at once see each other's bills. A red toast appears if a save fails.

## Things worth knowing

- **Excel export** uses SheetJS from a CDN. On a hospital network without internet, download
  `xlsx.full.min.js` into `public/` and change the `<script>` tag in `index.html`; without it the
  app still exports CSV.
- **The microphone** in the Tariff Master needs Chrome or Edge. It works properly once the app is
  served over HTTPS (it usually fails on `file://` pages, which is why hosting it helps).
- **ChatGPT price advice** comes from the model's training, not a live price feed. Put your own
  negotiated implant rates in the tariff master — the rule-based column then uses your prices.
- **Sample data**: the tariff, packages and the "Load sample bills" button are illustrative.
  Replace them with the hospital's real rates before using this for actual audits.
