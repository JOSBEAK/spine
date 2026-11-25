# Spine API

The Spine web app works without an account: everything is kept in the browser.
Signing in adds sync across devices, server-side history, taste-based recommendations
and linked reading accounts. The app is **local-first**: it writes locally, then syncs.

- Runtime: Node 20+, [Hono](https://hono.dev). Deployable to Vercel (`api/index.js`) or any Node host (`npm start`).
- Database: Postgres. Production uses `DATABASE_URL` (Neon, Supabase, RDS, …). Local dev and tests use
  embedded Postgres ([PGlite](https://pglite.dev)) so no install is needed.
- Auth: email + password. Passwords hashed with scrypt (N=2^15, r=8, p=1, 16-byte salt).
  Sessions are random 32-byte bearer tokens; only their SHA-256 is stored. 60-day sliding expiry.
- CORS: origins from `ALLOWED_ORIGINS` (comma-separated). Bearer tokens, no cookies, so no CSRF surface.
- We never store passwords for other services. Linked accounts hold only a public username and status.

All bodies are JSON. Errors: `{ "error": "Human sentence that says what to do." }` with a 4xx/5xx status.
Timestamps are ISO 8601 strings. IDs for highlights and bookmarks are client-generated UUIDs.

## Data model

```
users            id uuid pk, email citext unique, name, pw_hash, prefs jsonb, created_at, updated_at
sessions         token_hash bytea pk, user_id fk, created_at, last_seen_at, expires_at, user_agent
login_attempts   key text pk (ip|email), failures int, window_start   -- 8 failures / 15 min → 429

books            id text pk (Open Library work id like OL45804W, or OX-<slug> for OpenStax textbooks)
                 title, author, year text, cover int, kind text ('book'|'textbook'), access text
                 ('public'|'borrowable'), subjects text[], meta jsonb (gut, scan, lv, coverArt, web, pdf,
                 tone, pages, genre), updated_at
                 -- shared catalogue cache: a book is stored once no matter how many readers have it

library          (user_id, book_id) pk, on_shelf bool, status text ('want'|'reading'|'finished'|'borrowed'),
                 progress real 0..1, position jsonb ({ch, frac} for text, {page} for scans),
                 chapter_title text, seconds int (total time read), sessions int, first_opened_at,
                 last_opened_at, finished_at, client_updated_at, rev bigint
highlights       id uuid pk, user_id, book_id, locator jsonb {ch, sp, so, ep, eo}, text, color, note,
                 deleted bool, client_updated_at, rev bigint
bookmarks        id uuid pk, user_id, book_id, locator jsonb, label, deleted bool, client_updated_at, rev
reading_sessions id bigserial, user_id, book_id, mode ('text'|'scan'|'borrow'|'textbook'|'audio'),
                 started_at, ended_at, seconds int, from_progress real, to_progress real, pages int
                 -- one row per sitting (not per page turn)
events           id bigserial, user_id, type text, book_id null, at, data jsonb
                 types: view, search, shelf_add, shelf_remove, borrow_open, listen, finish, highlight, link
                 -- raw events older than 180 days are pruned; interests keep the long-term signal
interests        (user_id, key) pk, score real, updated_at
                 key is 'subject:<name>' or 'author:<name>'; scores decay with a 60-day half-life:
                 score = score * 0.5^(days_since_update / 60) + weight
linked_accounts  (user_id, provider) pk, provider ('archive'|'openlibrary'|'goodreads'|'storygraph'),
                 username text null, status text, connected_at, last_sync_at, meta jsonb
ol_cache         key text pk, body jsonb, fetched_at   -- Open Library responses, 12 h
```

`rev` comes from one Postgres sequence (`sync_rev`) and is bumped on every write to `library`,
`highlights` and `bookmarks`, which makes "everything changed since X" a single indexed range query.
Conflicts: last writer wins per row, by `client_updated_at`.

### Interest weights

| Signal | Weight (to each of the book's first 5 subjects and its author) |
| --- | --- |
| `view` (opened the book page) | 0.5 |
| reading session | min(4, minutes / 10) |
| `shelf_add` | 2 |
| `borrow_open`, `listen` | 1.5 |
| `finish` | 5 |
| `highlight` | 0.5 |

Subjects are normalised (trimmed, max 60 chars, generic tags like "Fiction", "Accessible book",
"Protected DAISY", "In library", "Large type books", "Lending library", "Open Library Staff Picks" skipped).

## Endpoints

### Health
`GET /health` → `{ ok: true, db: "postgres"|"pglite" }`

### Accounts
- `POST /auth/signup` `{ email, password, name? }` → `201 { token, user }`. Password ≥ 8 chars. 409 if the email exists.
- `POST /auth/login` `{ email, password }` → `{ token, user }`. 401 on bad credentials, 429 when rate limited.
- `POST /auth/logout` (Bearer) → `204`
- `GET /me` → `{ user, linked: [...], stats: { books, finished, seconds, highlights, bookmarks } }`
- `PATCH /me` `{ name?, prefs? }` → `{ user }` (prefs is merged)
- `POST /me/password` `{ current, next }` → `204` (signs out other sessions)
- `GET /me/export` → full JSON export of everything stored about the user
- `DELETE /me` `{ password }` → `204`, deletes the user and all their rows

`user` = `{ id, email, name, prefs, created_at }`

### Sync (the app calls this every ~20 s while signed in, and on sign-in)
`POST /sync`
```json
{
  "since": 0,
  "books":      [{ "id": "OL45804W", "title": "...", "author": "...", "year": "1813", "cover": 123,
                   "kind": "book", "access": "public", "subjects": ["..."], "meta": {} }],
  "library":    [{ "book_id": "OL45804W", "on_shelf": true, "status": "reading", "progress": 0.31,
                   "position": {"ch": 12, "frac": 0.4}, "chapter_title": "Chapter 12",
                   "first_opened_at": "...", "last_opened_at": "...", "finished_at": null,
                   "updated_at": "..." }],
  "highlights": [{ "id": "uuid", "book_id": "...", "locator": {}, "text": "...", "color": "yellow",
                   "note": "", "deleted": false, "updated_at": "..." }],
  "bookmarks":  [{ "id": "uuid", "book_id": "...", "locator": {}, "label": "...", "deleted": false, "updated_at": "..." }],
  "sessions":   [{ "book_id": "...", "mode": "text", "started_at": "...", "ended_at": "...",
                   "seconds": 600, "from_progress": 0.3, "to_progress": 0.34, "pages": 12 }],
  "events":     [{ "type": "view", "book_id": "...", "at": "...", "data": {} }],
  "prefs":      { "fs": 18 }
}
```
Every array is optional. Library `seconds`/`sessions` are maintained by the server from `sessions`
(the client's values are ignored). Sessions and events also feed `interests`.

Response:
```json
{ "rev": 1234, "library": [...], "highlights": [...], "bookmarks": [...], "books": [...], "prefs": {} }
```
Rows with `rev > since` (including tombstones), plus the `books` they reference.
Library rows come back with `updated_at` (= client_updated_at), `seconds` and `sessions`.
Limits: 500 items per array per request (413 above that).

### History and activity
- `GET /me/history?before=<iso>&limit=50` → `{ items: [{ kind: "session"|"event", at, book, ... }] }` newest first,
  sessions and events merged, with the book record attached.
- `GET /me/books/:id/activity` → `{ library, sessions: { count, seconds, first_at, last_at, recent: [...10] },
  highlights: n, bookmarks: n }`

### Taste and recommendations
- `GET /me/interests?limit=20` → `{ subjects: [{ name, score }], authors: [{ name, score }] }`
- `GET /me/recommendations` → `{ rows: [{ title, reason, books: [book] }] }`
  Up to 6 rows: "Because you read <book>" (subject of a recently read/finished book), "More <subject>" for
  the top subjects, "More by <author>" for top authors. Books come from Open Library search
  (`ebook_access:[borrowable TO *]`, sorted by `readinglog`), cached in `ol_cache` for 12 h,
  and exclude anything already in the user's library.

### Linked reading accounts
- `GET /me/links` → `{ links: [...] }`
- `POST /me/links/openlibrary` `{ username }` → imports the user's **public** Open Library reading log
  (want-to-read, currently-reading, already-read) into `library` and `books`.
  → `{ link, imported: { want, reading, finished } }`. 404 if the user doesn't exist, 403 if the log is private.
- `POST /me/links/goodreads` and `POST /me/links/storygraph` `{ csv }` → parses the export CSV, matches each
  row on Open Library (title + author search, 4 at a time, first 400 rows), imports matches into the library.
  → `{ link, imported: n, unmatched: [{ title, author }] }`
- `POST /me/links/archive` `{ username? }` → records that the reader signed in to the Internet Archive inside
  Spine. No credentials are sent or stored. → `{ link }`
- `DELETE /me/links/:provider` → `204`

### Readers per book (public)

The app reports the first time a reader opens a book in a calendar month (UTC). A reader is the signed-in
account, or, without an account, a random UUID the browser keeps (`reader`). Each (month, book, reader) is
stored once in `monthly_readers` (pruned after 13 months); `book_month_counts` keeps the per-month totals.

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/reads` | `{ book: Book, reader?: uuid }`, optional Bearer token (then the account counts and `reader` is ignored). → `{ counted, month }`. Without an account only the book id is stored; titles shown publicly come from Open Library. Past 300 new reads per IP per hour, opens are quietly not counted. |
| GET | `/stats/top?period=month\|all&limit=10` | → `{ period, month: "2026-11", books: [{ book, readers }] }`. `all` sums the months (a reader counts once per month). Cached 60 s. |
| GET | `/stats/books/:id` | → `{ id, month, all_time, period }`. Cached 60 s. |

Deleting an account deletes its `monthly_readers` rows; the totals stay.

## Footfall (private)

`POST /visits` — the site sends one each time it is opened (a page load, not every click).
Body: `{ "visitor": "<browser's random uuid>", "first": true, "landing": "#/book/OL1W", "referrer": "https://t.co/…", "source": "x" }`.
Signed-in requests are tied to the account. Stored: time, visitor id, account (if any), first visit, the screen it opened on,
the referring host, `utm_source`/`ref`, a country code from Vercel's `x-vercel-ip-country` header, and phone/tablet/desktop.
No IP addresses or user agents are kept. 240 opens per IP per hour; rows older than 400 days are pruned. Answers `204`.

Nothing reads these numbers back over HTTP. The owner runs the report against the production database:

```bash
cd server && vercel env pull .env && npm run footfall        # last 30 days
npm run footfall -- 7                                       # last 7 days
```
