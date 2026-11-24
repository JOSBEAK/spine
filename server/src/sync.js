// POST /sync: push local changes, pull everything that changed since the client's last rev.
//
// Every array is written with one bulk statement (jsonb_to_recordset), so a full 500-item push is a
// handful of round trips even against a remote database. All writes for one user are serialised with
// an advisory lock so revs commit in order and no device can skip a change.

import { z } from 'zod';
import { asJson, lockUser } from './db.js';
import { HttpError, readJson, parse } from './http.js';
import { Book, BookId, upsertBooks, ensureBooks, getBooks } from './books.js';
import { addSignals, EVENT_WEIGHTS, sessionWeight } from './interests.js';
import { requireUser } from './auth.js';

export const MAX_ITEMS = 500;
const EVENT_RETENTION_DAYS = 180;
const DAY_MS = 86400 * 1000;

// Any date string Date can read, normalised to ISO 8601.
export const Ts = z
  .string()
  .max(40)
  .refine((s) => !Number.isNaN(Date.parse(s)), 'must be an ISO 8601 date, like 2026-01-31T12:00:00Z')
  .transform((s) => new Date(s).toISOString());

const clamp01 = z.number().finite().transform((n) => Math.min(1, Math.max(0, n)));
const smallJson = (max, label) =>
  z.record(z.string(), z.unknown()).refine((o) => JSON.stringify(o).length <= max, `${label} is too large (max ${max} bytes)`);
const Locator = smallJson(2000, 'locator');

const LibraryItem = z.object({
  book_id: BookId,
  on_shelf: z.boolean().nullish(),
  status: z.enum(['want', 'reading', 'finished', 'borrowed']).nullish(),
  progress: clamp01.nullish(),
  position: smallJson(2000, 'position').nullish(),
  chapter_title: z.string().max(300).nullish(),
  first_opened_at: Ts.nullish(),
  last_opened_at: Ts.nullish(),
  finished_at: Ts.nullish(),
  updated_at: Ts.nullish(),
});

const Highlight = z.object({
  id: z.guid('must be a UUID'),
  book_id: BookId,
  locator: Locator.nullish(),
  text: z.string().max(10000).nullish(),
  color: z.string().max(30).nullish(),
  note: z.string().max(10000).nullish(),
  deleted: z.boolean().nullish(),
  updated_at: Ts.nullish(),
});

const Bookmark = z.object({
  id: z.guid('must be a UUID'),
  book_id: BookId,
  locator: Locator.nullish(),
  label: z.string().max(500).nullish(),
  deleted: z.boolean().nullish(),
  updated_at: Ts.nullish(),
});

const Session = z.object({
  book_id: BookId,
  mode: z.enum(['text', 'scan', 'borrow', 'textbook', 'audio']),
  started_at: Ts,
  ended_at: Ts.nullish(),
  seconds: z.number().finite().min(0).transform((n) => Math.min(86400, Math.round(n))),
  from_progress: clamp01.nullish(),
  to_progress: clamp01.nullish(),
  pages: z.number().int().min(0).max(100000).nullish(),
});

const EventItem = z.object({
  type: z.enum(['view', 'search', 'shelf_add', 'shelf_remove', 'borrow_open', 'listen', 'finish', 'highlight', 'link']),
  book_id: BookId.nullish(),
  at: Ts.nullish(),
  data: smallJson(4000, 'data').nullish(),
});

const SyncBody = z.object({
  since: z.number().int().min(0).nullish(),
  books: z.array(Book).nullish(),
  library: z.array(LibraryItem).nullish(),
  highlights: z.array(Highlight).nullish(),
  bookmarks: z.array(Bookmark).nullish(),
  sessions: z.array(Session).nullish(),
  events: z.array(EventItem).nullish(),
  prefs: smallJson(16000, 'prefs').nullish(),
});

const ARRAYS = ['books', 'library', 'highlights', 'bookmarks', 'sessions', 'events'];

/** Keeps one item per key: the one with the latest updated_at (ON CONFLICT can't touch a row twice). */
function latestBy(items, keyFn, tsKey = 'updated_at') {
  const m = new Map();
  for (const it of items) {
    const k = keyFn(it);
    const prev = m.get(k);
    if (!prev || (it[tsKey] || '') >= (prev[tsKey] || '')) m.set(k, it);
  }
  return [...m.values()];
}

// ---------- writes ----------

export async function writeLibrary(q, userId, items, now) {
  if (!items.length) return;
  const rows = latestBy(items, (i) => i.book_id).map((i) => ({
    book_id: i.book_id,
    on_shelf: i.on_shelf ?? false,
    status: i.status ?? null,
    progress: i.progress ?? 0,
    position: i.position ?? null,
    chapter_title: i.chapter_title ?? null,
    first_opened_at: i.first_opened_at ?? null,
    last_opened_at: i.last_opened_at ?? null,
    finished_at: i.finished_at ?? null,
    updated_at: i.updated_at ?? now.toISOString(),
  }));
  await q.query(
    `INSERT INTO library (user_id, book_id, on_shelf, status, progress, position, chapter_title,
                          first_opened_at, last_opened_at, finished_at, client_updated_at, rev)
     SELECT $1, r.book_id, r.on_shelf, r.status, r.progress, r.position, r.chapter_title,
            r.first_opened_at, r.last_opened_at, r.finished_at, r.updated_at, nextval('sync_rev')
       FROM jsonb_to_recordset($2::text::jsonb) AS r(book_id text, on_shelf boolean, status text, progress real,
            position jsonb, chapter_title text, first_opened_at timestamptz, last_opened_at timestamptz,
            finished_at timestamptz, updated_at timestamptz)
     ON CONFLICT (user_id, book_id) DO UPDATE SET
       on_shelf          = excluded.on_shelf,
       status            = excluded.status,
       progress          = excluded.progress,
       position          = excluded.position,
       chapter_title     = excluded.chapter_title,
       first_opened_at   = least(library.first_opened_at, excluded.first_opened_at),
       last_opened_at    = greatest(library.last_opened_at, excluded.last_opened_at),
       finished_at       = excluded.finished_at,
       client_updated_at = excluded.client_updated_at,
       rev               = excluded.rev
     WHERE excluded.client_updated_at > library.client_updated_at`,
    [userId, asJson(rows)],
  );
}

async function writeHighlights(q, userId, items, now) {
  if (!items.length) return;
  const rows = latestBy(items, (i) => i.id).map((i) => ({
    id: i.id,
    book_id: i.book_id,
    locator: i.locator ?? {},
    // Tombstones keep only what sync needs; the quoted text and note are dropped.
    text: i.deleted ? '' : i.text ?? '',
    color: i.color ?? null,
    note: i.deleted ? '' : i.note ?? '',
    deleted: i.deleted ?? false,
    updated_at: i.updated_at ?? now.toISOString(),
  }));
  await q.query(
    `INSERT INTO highlights (id, user_id, book_id, locator, text, color, note, deleted, client_updated_at, rev)
     SELECT r.id, $1, r.book_id, r.locator, r.text, r.color, r.note, r.deleted, r.updated_at, nextval('sync_rev')
       FROM jsonb_to_recordset($2::text::jsonb) AS r(id uuid, book_id text, locator jsonb, text text, color text,
            note text, deleted boolean, updated_at timestamptz)
     ON CONFLICT (id) DO UPDATE SET
       book_id = excluded.book_id, locator = excluded.locator, text = excluded.text, color = excluded.color,
       note = excluded.note, deleted = excluded.deleted, client_updated_at = excluded.client_updated_at,
       rev = excluded.rev
     WHERE highlights.user_id = excluded.user_id
       AND excluded.client_updated_at > highlights.client_updated_at`,
    [userId, asJson(rows)],
  );
}

async function writeBookmarks(q, userId, items, now) {
  if (!items.length) return;
  const rows = latestBy(items, (i) => i.id).map((i) => ({
    id: i.id,
    book_id: i.book_id,
    locator: i.locator ?? {},
    label: i.deleted ? '' : i.label ?? '',
    deleted: i.deleted ?? false,
    updated_at: i.updated_at ?? now.toISOString(),
  }));
  await q.query(
    `INSERT INTO bookmarks (id, user_id, book_id, locator, label, deleted, client_updated_at, rev)
     SELECT r.id, $1, r.book_id, r.locator, r.label, r.deleted, r.updated_at, nextval('sync_rev')
       FROM jsonb_to_recordset($2::text::jsonb) AS r(id uuid, book_id text, locator jsonb, label text,
            deleted boolean, updated_at timestamptz)
     ON CONFLICT (id) DO UPDATE SET
       book_id = excluded.book_id, locator = excluded.locator, label = excluded.label, deleted = excluded.deleted,
       client_updated_at = excluded.client_updated_at, rev = excluded.rev
     WHERE bookmarks.user_id = excluded.user_id
       AND excluded.client_updated_at > bookmarks.client_updated_at`,
    [userId, asJson(rows)],
  );
}

/**
 * Stores sittings and keeps library.seconds / library.sessions in step with them.
 * Returns interest signals for the reading time that is new to the server.
 */
export async function writeSessions(q, userId, items) {
  if (!items.length) return [];
  const rows = latestBy(
    items.map((s) => ({
      ...s,
      ended_at: s.ended_at ?? new Date(Date.parse(s.started_at) + s.seconds * 1000).toISOString(),
    })),
    (s) => `${s.book_id}|${s.started_at}`,
    'seconds',
  );
  const payload = asJson(rows);
  const { rows: before } = await q.query(
    `SELECT s.book_id, s.started_at, s.seconds FROM reading_sessions s
       JOIN jsonb_to_recordset($2::text::jsonb) AS r(book_id text, started_at timestamptz)
         ON s.book_id = r.book_id AND s.started_at = r.started_at
      WHERE s.user_id = $1`,
    [userId, payload],
  );
  const old = new Map(before.map((r) => [`${r.book_id}|${new Date(r.started_at).toISOString()}`, r.seconds]));

  await q.query(
    `INSERT INTO reading_sessions (user_id, book_id, mode, started_at, ended_at, seconds, from_progress, to_progress, pages)
     SELECT $1, r.book_id, r.mode, r.started_at, greatest(r.ended_at, r.started_at), r.seconds, r.from_progress, r.to_progress, r.pages
       FROM jsonb_to_recordset($2::text::jsonb) AS r(book_id text, mode text, started_at timestamptz, ended_at timestamptz,
            seconds int, from_progress real, to_progress real, pages int)
     ON CONFLICT (user_id, book_id, started_at) DO UPDATE SET
       mode          = excluded.mode,
       ended_at      = greatest(reading_sessions.ended_at, excluded.ended_at),
       seconds       = greatest(reading_sessions.seconds, excluded.seconds),
       from_progress = coalesce(reading_sessions.from_progress, excluded.from_progress),
       to_progress   = coalesce(excluded.to_progress, reading_sessions.to_progress),
       pages         = greatest(reading_sessions.pages, excluded.pages)`,
    [userId, payload],
  );

  // Recompute totals from the source of truth. Rows created here (a sitting for a book the client never
  // sent a library row for) get client_updated_at = epoch, so the client's own row always wins later.
  const bookIds = [...new Set(rows.map((r) => r.book_id))];
  await q.query(
    `INSERT INTO library (user_id, book_id, on_shelf, status, client_updated_at, rev,
                          first_opened_at, last_opened_at, seconds, sessions)
     SELECT $1, t.book_id, false, 'reading', 'epoch', nextval('sync_rev'), t.first_at, t.last_at, t.seconds, t.sessions
       FROM (SELECT book_id, min(started_at) AS first_at, max(ended_at) AS last_at,
                    sum(seconds)::int AS seconds, count(*)::int AS sessions
               FROM reading_sessions
              WHERE user_id = $1 AND book_id IN (SELECT jsonb_array_elements_text($2::text::jsonb))
              GROUP BY book_id) t
     ON CONFLICT (user_id, book_id) DO UPDATE SET
       seconds         = excluded.seconds,
       sessions        = excluded.sessions,
       first_opened_at = least(library.first_opened_at, excluded.first_opened_at),
       last_opened_at  = greatest(library.last_opened_at, excluded.last_opened_at),
       rev             = excluded.rev
     WHERE library.seconds <> excluded.seconds OR library.sessions <> excluded.sessions`,
    [userId, asJson(bookIds)],
  );

  return rows.map((r) => {
    const prev = old.get(`${r.book_id}|${r.started_at}`) ?? 0;
    return { book_id: r.book_id, weight: sessionWeight(Math.max(prev, r.seconds)) - sessionWeight(prev) };
  });
}

/** Stores events (ignoring exact repeats) and returns interest signals for the new ones. */
export async function writeEvents(q, userId, items, now) {
  if (!items.length) return [];
  const rows = latestBy(
    items.map((e) => ({ type: e.type, book_id: e.book_id ?? null, at: e.at ?? now.toISOString(), data: e.data ?? {} })),
    (e) => `${e.at}|${e.type}|${e.book_id ?? ''}`,
    'at',
  );
  const { rows: inserted } = await q.query(
    `INSERT INTO events (user_id, type, book_id, at, data)
     SELECT $1, r.type, r.book_id, r.at, r.data
       FROM jsonb_to_recordset($2::text::jsonb) AS r(type text, book_id text, at timestamptz, data jsonb)
     ON CONFLICT DO NOTHING
     RETURNING type, book_id`,
    [userId, asJson(rows)],
  );
  await q.query('DELETE FROM events WHERE user_id = $1 AND at < $2', [
    userId,
    new Date(+now - EVENT_RETENTION_DAYS * DAY_MS).toISOString(),
  ]);
  return inserted.map((e) => ({ book_id: e.book_id, weight: EVENT_WEIGHTS[e.type] || 0 }));
}

// ---------- reads ----------

export const LIBRARY_COLUMNS = `book_id, on_shelf, status, progress, position, chapter_title, first_opened_at,
  last_opened_at, finished_at, client_updated_at AS updated_at, seconds, sessions`;

export async function pull(q, userId, since) {
  const [lib, hl, bm] = [
    await q.query(`SELECT ${LIBRARY_COLUMNS}, rev FROM library WHERE user_id = $1 AND rev > $2 ORDER BY rev`, [userId, since]),
    await q.query(
      `SELECT id, book_id, locator, text, color, note, deleted, client_updated_at AS updated_at, rev
         FROM highlights WHERE user_id = $1 AND rev > $2 ORDER BY rev`,
      [userId, since],
    ),
    await q.query(
      `SELECT id, book_id, locator, label, deleted, client_updated_at AS updated_at, rev
         FROM bookmarks WHERE user_id = $1 AND rev > $2 ORDER BY rev`,
      [userId, since],
    ),
  ].map((r) => r.rows);
  let rev = since;
  const strip = (rows) =>
    rows.map(({ rev: r, ...row }) => {
      if (r > rev) rev = r;
      return row;
    });
  const library = strip(lib);
  const highlights = strip(hl);
  const bookmarks = strip(bm);
  const books = await getBooks(q, [...library, ...highlights, ...bookmarks].map((r) => r.book_id));
  return { rev, library, highlights, bookmarks, books };
}

// ---------- route ----------

export function syncRoutes(app, ctx) {
  app.post('/sync', requireUser(ctx), async (c) => {
    const raw = await readJson(c);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, 'Send a JSON object with the arrays you want to sync.');
    for (const key of ARRAYS) {
      if (Array.isArray(raw[key]) && raw[key].length > MAX_ITEMS) {
        throw new HttpError(413, `Too many ${key} in one request (${raw[key].length}). Send at most ${MAX_ITEMS} per array and sync the rest in the next request.`);
      }
    }
    const body = parse(SyncBody, raw);
    const user = c.get('user');
    const now = ctx.now();
    const since = body.since ?? 0;

    const result = await ctx.db.tx(async (q) => {
      await lockUser(q, user.id);
      await upsertBooks(q, body.books || [], now);
      await ensureBooks(q, [
        ...(body.library || []), ...(body.highlights || []), ...(body.bookmarks || []), ...(body.sessions || []),
      ].map((i) => i.book_id));
      await writeLibrary(q, user.id, body.library || [], now);
      await writeHighlights(q, user.id, body.highlights || [], now);
      await writeBookmarks(q, user.id, body.bookmarks || [], now);
      const signals = [
        ...(await writeSessions(q, user.id, body.sessions || [])),
        ...(await writeEvents(q, user.id, body.events || [], now)),
      ];
      await addSignals(q, user.id, signals, now);

      const { rows } =
        body.prefs && Object.keys(body.prefs).length
          ? await q.query(`UPDATE users SET prefs = prefs || $2::text::jsonb, updated_at = $3 WHERE id = $1 RETURNING prefs`, [
              user.id, asJson(body.prefs), now.toISOString(),
            ])
          : await q.query('SELECT prefs FROM users WHERE id = $1', [user.id]);
      return { ...(await pull(q, user.id, since)), prefs: rows[0]?.prefs || {} };
    });

    return c.json({
      rev: result.rev,
      library: result.library,
      highlights: result.highlights,
      bookmarks: result.bookmarks,
      books: result.books,
      prefs: result.prefs,
    });
  });
}
