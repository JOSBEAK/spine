// Taste profile. Each signal adds weight to the book's first 5 subjects and its author.
// Scores decay with a 60-day half-life: score = score * 0.5^(days_since_update / 60) + weight

import { asJson } from './db.js';
import { getBooks, interestKeys, normSubject, normAuthor } from './books.js';

export const HALF_LIFE_DAYS = 60;

export const EVENT_WEIGHTS = {
  view: 0.5,
  shelf_add: 2,
  borrow_open: 1.5,
  listen: 1.5,
  finish: 5,
  highlight: 0.5,
};

/** A reading session is worth min(4, minutes / 10). */
export const sessionWeight = (seconds) => Math.min(4, Math.max(0, seconds) / 60 / 10);

export const decayed = (score, days) => score * 0.5 ** (Math.max(0, days) / HALF_LIFE_DAYS);

const DECAY_SQL = (score, from, to) =>
  `${score} * power(0.5::float8, greatest(0, extract(epoch from (${to} - ${from})))::float8 / 86400.0 / ${HALF_LIFE_DAYS})`;

/**
 * Adds signals [{ book_id, weight }] to the user's interests in one statement.
 * Books are looked up in the shared catalogue for their subjects and author.
 */
export async function addSignals(q, userId, signals, now) {
  const useful = signals.filter((s) => s.book_id && s.weight > 0);
  if (!useful.length) return;
  const books = new Map((await getBooks(q, useful.map((s) => s.book_id))).map((b) => [b.id, b]));
  const totals = new Map();
  for (const s of useful) {
    for (const key of interestKeys(books.get(s.book_id))) totals.set(key, (totals.get(key) || 0) + s.weight);
  }
  if (!totals.size) return;
  const rows = [...totals].map(([key, score]) => ({ key, score }));
  await q.query(
    `INSERT INTO interests (user_id, key, score, updated_at)
     SELECT $1, r.key, r.score, $3 FROM jsonb_to_recordset($2::text::jsonb) AS r(key text, score float8)
     ON CONFLICT (user_id, key) DO UPDATE SET
       score      = ${DECAY_SQL('interests.score', 'interests.updated_at', 'excluded.updated_at')} + excluded.score,
       updated_at = greatest(interests.updated_at, excluded.updated_at)`,
    [userId, asJson(rows), now.toISOString()],
  );
}

/** Current (decayed to now) top subjects and authors. */
export async function topInterests(q, userId, now, limit = 20) {
  const pick = async (prefix) => {
    const { rows } = await q.query(
      `SELECT substr(key, $3) AS name, ${DECAY_SQL('score', 'updated_at', '$2::timestamptz')} AS score
         FROM interests
        WHERE user_id = $1 AND key LIKE $4
        ORDER BY 2 DESC, key
        LIMIT $5`,
      [userId, now.toISOString(), prefix.length + 1, prefix + '%', limit * 2],
    );
    // tags filtered out after they were stored (e.g. marketing tags) are skipped on the way out too
    const ok = prefix === 'subject:' ? normSubject : normAuthor;
    return rows.filter((r) => ok(r.name) === r.name).slice(0, limit).map((r) => ({ name: r.name, score: Math.round(Number(r.score) * 1000) / 1000 }));
  };
  return { subjects: await pick('subject:'), authors: await pick('author:') };
}
