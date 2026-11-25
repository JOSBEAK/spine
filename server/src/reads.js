// How many people read each book: one row per (month, book, reader), written on a reader's first open
// of a book in a calendar month (UTC). A reader is an account id, or a random id the browser made up.
//
//   POST /reads                 count an open (signed in or not)
//   GET  /stats/top             the most read books this month, or of all time
//   GET  /stats/books/:id       readers of one book this month and in total

import { z } from 'zod';
import { readJson, parse, badRequest, mapLimit } from './http.js';
import { optionalUser, clientIp } from './auth.js';
import { Book, BookId, upsertBooks, ensureBooks, getBooks } from './books.js';

const KEEP_MONTHS = 13;
const IP_LIMIT = 300; // new reads per IP per hour; past that, opens are quietly not counted
const HOUR_MS = 3600 * 1000;

export const monthOf = (d) => d.getUTCFullYear() * 100 + d.getUTCMonth() + 1;
const monthLabel = (m) => `${Math.floor(m / 100)}-${String(m % 100).padStart(2, '0')}`;
const minusMonths = (m, n) => {
  const t = Math.floor(m / 100) * 12 + (m % 100) - 1 - n;
  return Math.floor(t / 12) * 100 + (t % 12) + 1;
};

const ReadBody = z.object({
  book: Book,
  reader: z.uuid({ error: 'reader must be the random id this browser made (a UUID)' }).optional(),
});

/** Counts IP hits in login_attempts (key "reads|<ip>"); true while under the hourly limit. */
async function underLimit(q, ip, now) {
  const { rows } = await q.query(
    `INSERT INTO login_attempts (key, failures, window_start) VALUES ($1, 1, $2)
     ON CONFLICT (key) DO UPDATE SET
       failures     = CASE WHEN login_attempts.window_start < $3 THEN 1 ELSE login_attempts.failures + 1 END,
       window_start = CASE WHEN login_attempts.window_start < $3 THEN $2::timestamptz ELSE login_attempts.window_start END
     RETURNING failures`,
    [`reads|${ip}`, now.toISOString(), new Date(+now - HOUR_MS).toISOString()],
  );
  return rows[0].failures <= IP_LIMIT;
}

/** Fills in title and author from Open Library for works only known by id (opens from people without accounts). */
async function fillFromOpenLibrary(ctx, books) {
  const bare = books.filter((b) => !b.title && /^OL\d+W$/.test(b.id));
  if (!bare.length) return books;
  const found = await mapLimit(bare, 4, async (b) => {
    try { return (await ctx.ol.search(`key:/works/${b.id}`, { limit: 1, sort: '' }))[0] || null; } catch { return null; }
  });
  const fresh = found.filter((f) => f && f.title);
  if (fresh.length) await upsertBooks(ctx.db, fresh, ctx.now());
  const byId = new Map(fresh.map((f) => [f.id, f]));
  return books.map((b) => (byId.has(b.id) ? { ...b, ...byId.get(b.id), meta: { ...b.meta, ...byId.get(b.id).meta } } : b));
}

export function readRoutes(app, ctx) {
  app.post('/reads', async (c) => {
    const body = parse(ReadBody, await readJson(c));
    const user = await optionalUser(ctx, c);
    const reader = user?.id || body.reader;
    if (!reader) throw badRequest('Send "reader" (a random id this browser keeps), or sign in.');
    const now = ctx.now();
    const month = monthOf(now);
    const counted = await ctx.db.tx(async (q) => {
      if (!(await underLimit(q, clientIp(c, ctx.config.trustProxy), now))) return false;
      // Signed-in readers can describe a book, as sync lets them. Anyone else only names it:
      // the title shown in public lists comes from Open Library, not from an anonymous request.
      if (user) await upsertBooks(q, [body.book], now);
      else await ensureBooks(q, [body.book.id]);
      const { rows } = await q.query(
        `INSERT INTO monthly_readers (month, book_id, reader) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING RETURNING 1`,
        [month, body.book.id, reader],
      );
      if (!rows.length) return false;
      await q.query(
        `INSERT INTO book_month_counts (month, book_id, readers) VALUES ($1, $2, 1)
         ON CONFLICT (month, book_id) DO UPDATE SET readers = book_month_counts.readers + 1`,
        [month, body.book.id],
      );
      await q.query('DELETE FROM monthly_readers WHERE month < $1', [minusMonths(month, KEEP_MONTHS)]);
      return true;
    });
    return c.json({ counted, month: monthLabel(month) });
  });

  app.get('/stats/top', async (c) => {
    const period = c.req.query('period') || 'month';
    if (!['month', 'all'].includes(period)) throw badRequest('period must be "month" or "all".');
    const limit = Math.min(50, Math.max(1, Number(c.req.query('limit')) || 10));
    const month = monthOf(ctx.now());
    const { rows } = period === 'month'
      ? await ctx.db.query(
        `SELECT book_id, readers FROM book_month_counts WHERE month = $1 ORDER BY readers DESC, book_id LIMIT $2`,
        [month, limit],
      )
      : await ctx.db.query(
        `SELECT book_id, sum(readers)::int AS readers FROM book_month_counts GROUP BY book_id ORDER BY readers DESC, book_id LIMIT $1`,
        [limit],
      );
    const books = await fillFromOpenLibrary(ctx, await getBooks(ctx.db, rows.map((r) => r.book_id)));
    const byId = new Map(books.map((b) => [b.id, b]));
    c.header('Cache-Control', 'public, max-age=60');
    return c.json({
      period,
      month: monthLabel(month),
      books: rows.map((r) => ({ book: byId.get(r.book_id) || { id: r.book_id }, readers: Number(r.readers) })),
    });
  });

  app.get('/stats/books/:id', async (c) => {
    const id = parse(BookId, c.req.param('id'), 'book id');
    const month = monthOf(ctx.now());
    const { rows } = await ctx.db.query(
      `SELECT coalesce(sum(readers) FILTER (WHERE month = $2), 0)::int AS month,
              coalesce(sum(readers), 0)::int AS all_time
         FROM book_month_counts WHERE book_id = $1`,
      [id, month],
    );
    c.header('Cache-Control', 'public, max-age=60');
    return c.json({ id, month: rows[0].month, all_time: rows[0].all_time, period: monthLabel(month) });
  });
}
