// Linked reading accounts. We never store passwords for other services: a link is a public username
// (or nothing) plus a status. Imports fetch from Open Library first, then write in one short transaction.

import { z } from 'zod';
import { asJson, lockUser } from './db.js';
import { HttpError, readJson, parse, mapLimit, badRequest } from './http.js';
import { upsertBooks } from './books.js';
import { addSignals, EVENT_WEIGHTS } from './interests.js';
import { requireUser } from './auth.js';
import { SHELVES, logEntryToBook } from './openlibrary.js';
import { readExport, cleanTitle } from './csv.js';

const PROVIDERS = ['archive', 'openlibrary', 'goodreads', 'storygraph'];
const MAX_LOG_PAGES = 20;
const CSV_ROWS = 400;
const MATCH_CONCURRENCY = 4;
const RANK = { want: 1, reading: 2, finished: 3 };

export const toLink = (r) => ({
  provider: r.provider,
  username: r.username,
  status: r.status,
  connected_at: r.connected_at,
  last_sync_at: r.last_sync_at,
  meta: r.meta || {},
});

export async function listLinks(q, userId) {
  const { rows } = await q.query(
    'SELECT provider, username, status, connected_at, last_sync_at, meta FROM linked_accounts WHERE user_id = $1 ORDER BY provider',
    [userId],
  );
  return rows.map(toLink);
}

async function saveLink(q, userId, provider, username, meta, now, synced) {
  const { rows } = await q.query(
    `INSERT INTO linked_accounts (user_id, provider, username, status, connected_at, last_sync_at, meta)
     VALUES ($1, $2, $3, 'connected', $4, $5, $6::text::jsonb)
     ON CONFLICT (user_id, provider) DO UPDATE SET
       username = excluded.username, status = 'connected', last_sync_at = excluded.last_sync_at, meta = excluded.meta
     RETURNING provider, username, status, connected_at, last_sync_at, meta`,
    [userId, provider, username, now.toISOString(), synced ? now.toISOString() : null, asJson(meta)],
  );
  return toLink(rows[0]);
}

/**
 * Puts imported books on the reader's shelf. Books already on the shelf are left alone (the reader's own
 * status wins); new or off-shelf ones are added. Returns how many were added per status.
 */
async function importToLibrary(q, userId, items, now) {
  const best = new Map();
  for (const it of items) {
    if (!it.book.id) continue;
    const prev = best.get(it.book.id);
    if (!prev || RANK[it.status] > RANK[prev.status]) best.set(it.book.id, it);
  }
  const list = [...best.values()];
  const counts = { want: 0, reading: 0, finished: 0 };
  if (!list.length) return counts;
  await upsertBooks(q, list.map((i) => i.book), now);
  const rows = list.map((i) => ({
    book_id: i.book.id,
    status: i.status,
    progress: i.status === 'finished' ? 1 : 0,
    finished_at: i.status === 'finished' ? i.finished_at || null : null,
  }));
  const { rows: added } = await q.query(
    `INSERT INTO library (user_id, book_id, on_shelf, status, progress, finished_at, client_updated_at, rev)
     SELECT $1, r.book_id, true, r.status, r.progress, r.finished_at, $3, nextval('sync_rev')
       FROM jsonb_to_recordset($2::text::jsonb) AS r(book_id text, status text, progress real, finished_at timestamptz)
     ON CONFLICT (user_id, book_id) DO UPDATE SET
       on_shelf = true, status = excluded.status, progress = greatest(library.progress, excluded.progress),
       finished_at = coalesce(excluded.finished_at, library.finished_at),
       client_updated_at = excluded.client_updated_at, rev = excluded.rev
     WHERE NOT library.on_shelf
     RETURNING book_id, status`,
    [userId, asJson(rows), now.toISOString()],
  );
  for (const r of added) counts[r.status]++;
  await addSignals(
    q,
    userId,
    added.map((r) => ({ book_id: r.book_id, weight: r.status === 'finished' ? EVENT_WEIGHTS.finish : EVENT_WEIGHTS.shelf_add })),
    now,
  );
  return counts;
}

async function logLinkEvent(q, userId, provider, now) {
  await q.query(
    `INSERT INTO events (user_id, type, book_id, at, data) VALUES ($1, 'link', NULL, $2, $3::text::jsonb) ON CONFLICT DO NOTHING`,
    [userId, now.toISOString(), asJson({ provider })],
  );
}

const Username = z
  .string({ error: 'Enter your Open Library username' })
  .trim()
  .regex(/^[A-Za-z0-9_.-]{1,64}$/, 'Enter the username from your Open Library profile address (openlibrary.org/people/<username>)');
const CsvBody = z.object({
  csv: z.string({ error: 'Send the exported CSV file as text in "csv"' }).min(1, 'The CSV file is empty').max(2_000_000, 'The CSV file is too large (max 2 MB)'),
});

export function linkRoutes(app, ctx) {
  const auth = requireUser(ctx);

  app.get('/me/links', auth, async (c) => c.json({ links: await listLinks(ctx.db, c.get('user').id) }));

  app.post('/me/links/openlibrary', auth, async (c) => {
    const { username } = parse(z.object({ username: Username }), await readJson(c));
    const user = c.get('user');
    const items = [];
    for (const [shelf, status] of Object.entries(SHELVES)) {
      const seen = new Set();
      for (let page = 1; page <= MAX_LOG_PAGES; page++) {
        const { entries } = await ctx.ol.readingLog(username, shelf, page);
        const fresh = entries.filter((e) => e?.work?.key && !seen.has(e.work.key));
        if (!fresh.length) break;
        for (const e of fresh) {
          seen.add(e.work.key);
          items.push({ book: logEntryToBook(e), status });
        }
      }
    }
    const now = ctx.now();
    const result = await ctx.db.tx(async (q) => {
      await lockUser(q, user.id);
      const imported = await importToLibrary(q, user.id, items, now);
      const link = await saveLink(q, user.id, 'openlibrary', username, { found: items.length, imported }, now, true);
      await logLinkEvent(q, user.id, 'openlibrary', now);
      return { link, imported };
    });
    return c.json(result);
  });

  for (const provider of ['goodreads', 'storygraph']) {
    app.post(`/me/links/${provider}`, auth, async (c) => {
      const { csv } = parse(CsvBody, await readJson(c));
      const user = c.get('user');
      let rows;
      try {
        rows = readExport(csv, provider);
      } catch (err) {
        throw badRequest(err.message);
      }
      const batch = rows.slice(0, CSV_ROWS);
      // Stop starting new lookups before the platform's request timeout; the rest come back as unmatched.
      const deadline = Date.now() + ctx.config.importBudgetMs;
      let networkError = null;
      const matches = await mapLimit(batch, MATCH_CONCURRENCY, async (r) => {
        if (Date.now() > deadline) return null;
        try {
          return await ctx.ol.match(cleanTitle(r.title), r.author);
        } catch (err) {
          networkError = err;
          return null;
        }
      });
      const items = [];
      const unmatched = [];
      batch.forEach((r, i) => {
        if (matches[i]?.id) items.push({ book: matches[i], status: r.status, finished_at: r.finished_at });
        else unmatched.push({ title: r.title, author: r.author });
      });
      if (!items.length && networkError) throw networkError;

      const now = ctx.now();
      const result = await ctx.db.tx(async (q) => {
        await lockUser(q, user.id);
        const counts = await importToLibrary(q, user.id, items, now);
        const imported = counts.want + counts.reading + counts.finished;
        const meta = { rows: rows.length, matched: items.length, imported, unmatched: unmatched.length, skipped: Math.max(0, rows.length - CSV_ROWS) };
        const link = await saveLink(q, user.id, provider, null, meta, now, true);
        await logLinkEvent(q, user.id, provider, now);
        return { link, imported };
      });
      return c.json({ ...result, unmatched });
    });
  }

  app.post('/me/links/archive', auth, async (c) => {
    const body = parse(
      z.object({ username: z.string().trim().max(100, 'That username is too long').nullish() }),
      await readJson(c),
    );
    const now = ctx.now();
    const link = await saveLink(ctx.db, c.get('user').id, 'archive', body.username || null, {}, now, false);
    return c.json({ link });
  });

  app.delete('/me/links/:provider', auth, async (c) => {
    const provider = c.req.param('provider');
    if (!PROVIDERS.includes(provider)) {
      throw new HttpError(404, `Unknown reading account "${provider}". Use one of: ${PROVIDERS.join(', ')}.`);
    }
    await ctx.db.query('DELETE FROM linked_accounts WHERE user_id = $1 AND provider = $2', [c.get('user').id, provider]);
    return c.body(null, 204);
  });
}
