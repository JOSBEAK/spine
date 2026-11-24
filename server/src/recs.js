// Recommendations: up to 6 rows built from the reader's taste, filled from Open Library search
// (borrowable or better, sorted by reading-log popularity, cached 12 h), excluding books they already have.

import { topInterests } from './interests.js';
import { normSubject } from './books.js';

const MAX_ROWS = 6;
const MAX_SEARCHES = 8;
const AVAILABLE = 'ebook_access:[borrowable TO *]';
const quote = (s) => '"' + String(s).replace(/["\\]/g, ' ').trim() + '"';

async function planRows(db, userId, now) {
  const plans = [];
  const used = new Set();

  // "Because you read <book>": the most recent read/finished book that has a usable subject.
  const { rows: recent } = await db.query(
    `SELECT b.id, b.title, b.subjects FROM library l JOIN books b ON b.id = l.book_id
      WHERE l.user_id = $1 AND l.status IN ('reading', 'finished') AND b.title <> ''
      ORDER BY greatest(l.finished_at, l.last_opened_at, l.client_updated_at) DESC NULLS LAST
      LIMIT 5`,
    [userId],
  );
  for (const b of recent) {
    const subject = (b.subjects || []).map(normSubject).find(Boolean);
    if (!subject) continue;
    used.add(subject.toLowerCase());
    plans.push({
      title: `Because you read ${b.title}`,
      reason: `Popular free books about ${subject.toLowerCase()}, like ${b.title}.`,
      q: `subject:${quote(subject)} ${AVAILABLE}`,
    });
    break;
  }

  const { subjects, authors } = await topInterests(db, userId, now, 6);
  const subjectPlans = subjects
    .filter((s) => !used.has(s.name.toLowerCase()))
    .map((s) => ({
      title: `More ${s.name}`,
      reason: `${s.name} is one of the subjects you read most.`,
      q: `subject:${quote(s.name)} ${AVAILABLE}`,
    }));
  const authorPlans = authors.map((a) => ({
    title: `More by ${a.name}`,
    reason: `You keep coming back to ${a.name}.`,
    q: `author:${quote(a.name)} ${AVAILABLE}`,
  }));
  // Interleave: subject, author, subject, author... so one kind doesn't crowd out the other.
  for (let i = 0; i < Math.max(subjectPlans.length, authorPlans.length); i++) {
    if (subjectPlans[i]) plans.push(subjectPlans[i]);
    if (authorPlans[i]) plans.push(authorPlans[i]);
  }
  return plans.slice(0, MAX_SEARCHES);
}

export async function recommendations(ctx, userId) {
  const now = ctx.now();
  const plans = await planRows(ctx.db, userId, now);
  if (!plans.length) return { rows: [] };

  const { rows: lib } = await ctx.db.query('SELECT book_id FROM library WHERE user_id = $1', [userId]);
  const exclude = new Set(lib.map((r) => r.book_id));

  let lastError = null;
  const results = await Promise.all(
    plans.map((p) =>
      ctx.ol.search(p.q, { limit: 20 }).catch((err) => {
        lastError = err;
        return null;
      }),
    ),
  );
  if (results.every((r) => r === null) && lastError) throw lastError;

  const rows = [];
  results.forEach((books, i) => {
    if (!books || rows.length >= MAX_ROWS) return;
    const seen = new Set();
    const fresh = books.filter((b) => b.id && !exclude.has(b.id) && !seen.has(b.id) && seen.add(b.id));
    if (fresh.length < 3) return; // a row of one or two books looks broken
    fresh.forEach((b) => exclude.add(b.id)); // no book twice, within a row or across rows
    rows.push({ title: plans[i].title, reason: plans[i].reason, books: fresh });
  });
  return { rows };
}
