# Spine API

The optional backend for Spine: accounts, cross-device sync, reading history, taste-based
recommendations and linked reading accounts. The contract the frontend codes against is in
[API.md](API.md).

Node 20+, [Hono](https://hono.dev), Postgres. Runs locally with no database install (embedded
[PGlite](https://pglite.dev)), and deploys to Vercel or any Node host with a real Postgres.

## Run it locally

```bash
cd server
npm install
npm run dev        # restarts on changes; or: npm start
```

The API listens on http://localhost:8787. With no `DATABASE_URL`, data is kept in `server/.data/`
(delete the folder to start over). Try it:

```bash
curl localhost:8787/health
curl -X POST localhost:8787/auth/signup -H 'content-type: application/json' \
  -d '{"email":"me@example.com","password":"at least 8 chars"}'
curl -X POST localhost:8787/sync -H "authorization: Bearer <token>" -H 'content-type: application/json' -d '{"since":0}'
```

To use a real Postgres locally, put `DATABASE_URL=...` in `server/.env` (see `.env.example`).

## Tests

```bash
npm test
```

Tests run the real app against an in-memory PGlite database, with a fake clock and a fake
Open Library (no network). To run the same suite against a real Postgres (use a throwaway database;
the tests write to it): `TEST_DATABASE_URL=postgres://... npm test`.

## Environment variables

| Name | Default | What it does |
| --- | --- | --- |
| `DATABASE_URL` | empty | Postgres connection string. Empty means PGlite in `server/.data/` (not allowed on Vercel). |
| `ALLOWED_ORIGINS` | `https://josbeak.github.io,http://localhost:5178,http://localhost:5173` | Browser origins allowed by CORS (comma-separated, `*` for any). |
| `PORT` | `8787` | Local port. |
| `PGLITE_DIR` | `server/.data` | Where PGlite stores its files. |
| `TRUST_PROXY` | on for Vercel, off elsewhere | Use `X-Forwarded-For` as the client IP for the login rate limit. |
| `DATABASE_POOL_SIZE` | `5` | Postgres connections per instance. |
| `IMPORT_BUDGET_MS` | `240000` | CSV imports stop starting Open Library lookups after this long. |

## Deploy to Vercel

`server/` is its own Vercel project. `api/index.js` is the function, and `vercel.json` routes every
path to it.

1. Create a Postgres database. [Neon](https://neon.tech) works well (free tier): create a project and
   copy the **pooled** connection string. Supabase, RDS or any Postgres 14+ also work. The schema uses
   the `citext` extension, which these all provide.
2. In Vercel, **Add New → Project**, import the repository and set **Root Directory** to `server`.
   Framework preset: Other. No build command is needed.
3. Under **Settings → Environment Variables** add `DATABASE_URL` (and `ALLOWED_ORIGINS` if the app is
   served from somewhere else).
4. Deploy. Tables are created on the first request (migrations are idempotent and guarded by a lock,
   so parallel cold starts are safe). Check `https://<your-project>.vercel.app/health`, which should
   say `{"ok":true,"db":"postgres"}`.
5. Point the frontend at that URL.

Notes:

- `vercel.json` sets `maxDuration: 300` so large Goodreads/StoryGraph imports have time to match on
  Open Library. That needs Fluid compute (the default for new projects). If your plan allows less,
  lower `maxDuration` and set `IMPORT_BUDGET_MS` about 20 s below it.
- Without `DATABASE_URL` on Vercel every request answers 503 with a message saying so, because the
  function's file system can't hold a database.

## Other hosts

Any Node 20+ host: `npm ci && npm start` with `DATABASE_URL` and `PORT` set. Set `TRUST_PROXY=1`
if it runs behind a proxy that sets `X-Forwarded-For`.

## Layout

```
api/index.js        Vercel entry (hono/vercel handler)
src/server.js       local server (@hono/node-server)
src/app.js          the Hono app: CORS, body limit, error handling, routes
src/config.js       environment variables
src/db.js           db.query / db.tx over postgres.js or PGlite
src/schema.js       migrations (schema_version)
src/auth.js         scrypt passwords, bearer sessions, login rate limit, /auth/*
src/me.js           /me, password, export, delete, history, activity, interests, recommendations
src/sync.js         POST /sync (bulk upserts, last-writer-wins, revs)
src/books.js        shared books catalogue, subject normalisation
src/interests.js    interest weights and 60-day half-life decay
src/recs.js         recommendation rows
src/openlibrary.js  Open Library client (timeout, User-Agent, 12 h cache)
src/links.js        linked accounts and imports
src/csv.js          CSV parser, Goodreads/StoryGraph readers
```

## Privacy and security

- Passwords: scrypt (N=2^15, r=8, p=1, 16-byte salt), compared in constant time.
- Sessions: random 32-byte bearer tokens; only their SHA-256 is stored. 60-day sliding expiry.
- Login: 8 wrong passwords per IP+email in 15 minutes gives `429` with `Retry-After`.
- Linked accounts hold a public username and a status, never another service's password.
- `GET /me/export` returns everything stored about the reader; `DELETE /me` removes all of it.
- Raw events are pruned after 180 days.
