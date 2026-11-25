// The signed-in reader: profile, password, export, account deletion, history, per-book activity,
// interests and recommendations.

import { z } from 'zod';
import { asJson } from './db.js';
import { readJson, parse, badRequest } from './http.js';
import { requireUser, publicUser, confirmPassword, hashPassword } from './auth.js';
import { BookId, getBooks } from './books.js';
import { LIBRARY_COLUMNS, Ts } from './sync.js';
import { listLinks } from './links.js';
import { topInterests } from './interests.js';
import { recommendations } from './recs.js';

const intParam = (v, def, min, max) => {
  if (v == null || v === '') return def;
  const n = Number(v);
  if (!Number.isInteger(n)) throw badRequest(`"${v}" is not a whole number.`);
  return Math.min(max, Math.max(min, n));
};

const PatchMe = z.object({
  name: z.string().trim().max(100, 'Names can be at most 100 characters').nullish(),
  prefs: z
    .record(z.string(), z.unknown())
    .refine((o) => JSON.stringify(o).length <= 16000, 'prefs is too large (max 16 KB)')
    .nullish(),
});
const ChangePassword = z.object({
  current: z.string({ error: 'Enter your current password' }).min(1, 'Enter your current password').max(256),
  next: z.string({ error: 'Enter a new password' }).min(8, 'Use a new password with at least 8 characters').max(256, 'Passwords can be at most 256 characters'),
});
const DeleteMe = z.object({ password: z.string({ error: 'Enter your password to delete your account' }).min(1, 'Enter your password to delete your account').max(256) });

export async function stats(q, userId) {
  const { rows } = await q.query(
    `SELECT (SELECT count(*) FROM library WHERE user_id = $1 AND on_shelf) AS books,
            (SELECT count(*) FROM library WHERE user_id = $1 AND status = 'finished') AS finished,
            (SELECT coalesce(sum(seconds), 0) FROM library WHERE user_id = $1) AS seconds,
            (SELECT count(*) FROM highlights WHERE user_id = $1 AND NOT deleted) AS highlights,
            (SELECT count(*) FROM bookmarks WHERE user_id = $1 AND NOT deleted) AS bookmarks`,
    [userId],
  );
  return rows[0];
}

export function meRoutes(app, ctx) {
  const auth = requireUser(ctx);

  app.get('/me', auth, async (c) => {
    const user = c.get('user');
    return c.json({ user: publicUser(user), linked: await listLinks(ctx.db, user.id), stats: await stats(ctx.db, user.id) });
  });

  app.patch('/me', auth, async (c) => {
    const body = parse(PatchMe, await readJson(c));
    const user = c.get('user');
    const { rows } = await ctx.db.query(
      `UPDATE users SET name = coalesce($2, name), prefs = prefs || $3::text::jsonb, updated_at = $4
        WHERE id = $1 RETURNING id, email, name, prefs, created_at`,
      [user.id, body.name ?? null, asJson(body.prefs || {}), ctx.now().toISOString()],
    );
    return c.json({ user: publicUser(rows[0]) });
  });

  app.post('/me/password', auth, async (c) => {
    const body = parse(ChangePassword, await readJson(c));
    const user = c.get('user');
    await confirmPassword(ctx, user, body.current);
    const hash = await hashPassword(body.next);
    await ctx.db.tx(async (q) => {
      await q.query('UPDATE users SET pw_hash = $2, updated_at = $3 WHERE id = $1', [user.id, hash, ctx.now().toISOString()]);
      await q.query(`DELETE FROM sessions WHERE user_id = $1 AND token_hash <> decode($2, 'hex')`, [user.id, c.get('tokenHash')]);
    });
    return c.body(null, 204);
  });

  app.get('/me/export', auth, async (c) => {
    const user = c.get('user');
    const all = async (sql) => (await ctx.db.query(sql, [user.id])).rows;
    const data = {
      exported_at: ctx.now().toISOString(),
      user: { ...publicUser(user) },
      library: await all(`SELECT ${LIBRARY_COLUMNS} FROM library WHERE user_id = $1 ORDER BY book_id`),
      highlights: await all(`SELECT id, book_id, locator, text, color, note, deleted, client_updated_at AS updated_at FROM highlights WHERE user_id = $1 ORDER BY client_updated_at`),
      bookmarks: await all(`SELECT id, book_id, locator, label, deleted, client_updated_at AS updated_at FROM bookmarks WHERE user_id = $1 ORDER BY client_updated_at`),
      reading_sessions: await all(`SELECT book_id, mode, started_at, ended_at, seconds, from_progress, to_progress, pages FROM reading_sessions WHERE user_id = $1 ORDER BY started_at`),
      events: await all(`SELECT type, book_id, at, data FROM events WHERE user_id = $1 ORDER BY at`),
      interests: await all(`SELECT key, score, updated_at FROM interests WHERE user_id = $1 ORDER BY score DESC`),
      linked_accounts: await listLinks(ctx.db, user.id),
      devices: await all(`SELECT created_at, last_seen_at, expires_at, user_agent FROM sessions WHERE user_id = $1 ORDER BY created_at`),
    };
    data.books = await getBooks(ctx.db, [...data.library, ...data.highlights, ...data.bookmarks, ...data.reading_sessions].map((r) => r.book_id));
    c.header('Content-Disposition', 'attachment; filename="spine-export.json"');
    return c.json(data);
  });

  app.delete('/me', auth, async (c) => {
    const { password } = parse(DeleteMe, await readJson(c));
    const user = c.get('user');
    await confirmPassword(ctx, user, password);
    await ctx.db.tx(async (q) => {
      await q.query('DELETE FROM users WHERE id = $1', [user.id]); // everything else cascades
      // which books they opened goes too; the monthly totals stay, since they no longer point at anyone
      await q.query('DELETE FROM monthly_readers WHERE reader = $1', [user.id]);
      await q.query(`DELETE FROM login_attempts WHERE key = $1 OR right(key, length($2) + 1) = '|' || $2`, [`pw|${user.id}`, user.email]);
    });
    return c.body(null, 204);
  });

  app.get('/me/history', auth, async (c) => {
    const user = c.get('user');
    const limit = intParam(c.req.query('limit'), 50, 1, 200);
    const beforeRaw = c.req.query('before');
    const before = beforeRaw ? parse(Ts, beforeRaw, 'before') : null;
    const { rows } = await ctx.db.query(
      `(SELECT 'session' AS kind, s.started_at AS at, s.book_id, s.mode, s.started_at, s.ended_at, s.seconds,
               s.from_progress, s.to_progress, s.pages, NULL::text AS type, NULL::jsonb AS data
          FROM reading_sessions s WHERE s.user_id = $1 AND ($2::timestamptz IS NULL OR s.started_at < $2::timestamptz)
         ORDER BY s.started_at DESC LIMIT $3)
       UNION ALL
       (SELECT 'event', e.at, e.book_id, NULL, NULL, NULL, NULL, NULL, NULL, NULL, e.type, e.data
          FROM events e WHERE e.user_id = $1 AND ($2::timestamptz IS NULL OR e.at < $2::timestamptz)
         ORDER BY e.at DESC LIMIT $3)
       ORDER BY at DESC LIMIT $3`,
      [user.id, before, limit],
    );
    const books = new Map((await getBooks(ctx.db, rows.map((r) => r.book_id))).map((b) => [b.id, b]));
    const items = rows.map((r) => {
      const book = r.book_id ? books.get(r.book_id) || null : null;
      if (r.kind === 'session') {
        const { type, data, ...s } = r;
        return { ...s, book };
      }
      return { kind: 'event', at: r.at, book_id: r.book_id, type: r.type, data: r.data || {}, book };
    });
    return c.json({ items });
  });

  app.get('/me/books/:id/activity', auth, async (c) => {
    const id = parse(BookId, c.req.param('id'), 'book id');
    const user = c.get('user');
    const [lib, agg, recent, hl, bm] = [
      await ctx.db.query(`SELECT ${LIBRARY_COLUMNS} FROM library WHERE user_id = $1 AND book_id = $2`, [user.id, id]),
      await ctx.db.query(
        `SELECT count(*) AS count, coalesce(sum(seconds), 0) AS seconds, min(started_at) AS first_at, max(ended_at) AS last_at
           FROM reading_sessions WHERE user_id = $1 AND book_id = $2`,
        [user.id, id],
      ),
      await ctx.db.query(
        `SELECT mode, started_at, ended_at, seconds, from_progress, to_progress, pages
           FROM reading_sessions WHERE user_id = $1 AND book_id = $2 ORDER BY started_at DESC LIMIT 10`,
        [user.id, id],
      ),
      await ctx.db.query('SELECT count(*) AS n FROM highlights WHERE user_id = $1 AND book_id = $2 AND NOT deleted', [user.id, id]),
      await ctx.db.query('SELECT count(*) AS n FROM bookmarks WHERE user_id = $1 AND book_id = $2 AND NOT deleted', [user.id, id]),
    ];
    return c.json({
      library: lib.rows[0] || null,
      sessions: { ...agg.rows[0], recent: recent.rows },
      highlights: hl.rows[0].n,
      bookmarks: bm.rows[0].n,
    });
  });

  app.get('/me/interests', auth, async (c) => {
    const limit = intParam(c.req.query('limit'), 20, 1, 100);
    return c.json(await topInterests(ctx.db, c.get('user').id, ctx.now(), limit));
  });

  app.get('/me/recommendations', auth, async (c) => c.json(await recommendations(ctx, c.get('user').id)));
}
