// The shared `books` catalogue cache: one row per book no matter how many readers have it.

import { z } from 'zod';
import { asJson } from './db.js';

export const BookId = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/, 'must be an Open Library work id like OL45804W or a textbook id like OX-biology-2e');

export const Book = z.object({
  id: BookId,
  title: z.string().max(500).nullish(),
  author: z.string().max(500).nullish(),
  year: z.union([z.string().max(20), z.number().int()]).nullish(),
  cover: z.number().int().nullish(),
  kind: z.enum(['book', 'textbook']).nullish(),
  access: z.string().max(30).nullish(),
  subjects: z.array(z.string().max(200)).max(50).nullish(),
  meta: z.record(z.string(), z.unknown()).nullish(),
});

/** Turns a validated client/Open Library book into a row for bulk upsert. */
export function bookRow(b) {
  return {
    id: b.id,
    title: (b.title || '').slice(0, 500),
    author: (b.author || '').slice(0, 500),
    year: b.year == null ? '' : String(b.year),
    cover: b.cover ?? null,
    kind: b.kind || 'book',
    access: b.access || null,
    subjects: (b.subjects || []).slice(0, 30).map((s) => String(s).slice(0, 200)),
    meta: b.meta && typeof b.meta === 'object' ? b.meta : {},
  };
}

/**
 * Bulk upsert into the shared catalogue. Empty incoming fields never wipe known ones, and meta is merged,
 * so a stub or a sparse record from one reader can't erase what another reader's client sent.
 */
export async function upsertBooks(q, books, now) {
  if (!books.length) return;
  const byId = new Map(books.map((b) => [b.id, bookRow(b)]));
  await q.query(
    `INSERT INTO books (id, title, author, year, cover, kind, access, subjects, meta, updated_at)
     SELECT r.id, r.title, r.author, r.year, r.cover, r.kind, r.access,
            ARRAY(SELECT jsonb_array_elements_text(coalesce(r.subjects, '[]'::jsonb))), coalesce(r.meta, '{}'::jsonb), $2
       FROM jsonb_to_recordset($1::text::jsonb) AS r(id text, title text, author text, year text, cover int, kind text,
                                               access text, subjects jsonb, meta jsonb)
     ON CONFLICT (id) DO UPDATE SET
       title      = coalesce(nullif(excluded.title, ''), books.title),
       author     = coalesce(nullif(excluded.author, ''), books.author),
       year       = coalesce(nullif(excluded.year, ''), books.year),
       cover      = coalesce(excluded.cover, books.cover),
       kind       = CASE WHEN excluded.kind = 'textbook' THEN 'textbook' ELSE books.kind END,
       access     = coalesce(excluded.access, books.access),
       subjects   = CASE WHEN cardinality(excluded.subjects) > 0 THEN excluded.subjects ELSE books.subjects END,
       meta       = books.meta || excluded.meta,
       updated_at = excluded.updated_at`,
    [asJson([...byId.values()]), now.toISOString()],
  );
}

/** Makes sure every referenced id exists (as an empty stub if the client never sent the record). */
export async function ensureBooks(q, ids) {
  const list = [...new Set(ids)].filter(Boolean);
  if (!list.length) return;
  await q.query(
    `INSERT INTO books (id) SELECT jsonb_array_elements_text($1::text::jsonb) ON CONFLICT (id) DO NOTHING`,
    [asJson(list)],
  );
}

export async function getBooks(q, ids) {
  const list = [...new Set(ids)].filter(Boolean);
  if (!list.length) return [];
  const { rows } = await q.query(
    `SELECT id, title, author, year, cover, kind, access, subjects, meta FROM books
      WHERE id IN (SELECT jsonb_array_elements_text($1::text::jsonb))`,
    [asJson(list)],
  );
  return rows.map(toBook);
}

export const toBook = (r) => ({
  id: r.id,
  title: r.title,
  author: r.author,
  year: r.year,
  cover: r.cover,
  kind: r.kind,
  access: r.access,
  subjects: r.subjects || [],
  meta: r.meta || {},
});

// ---------- subject normalisation (for interests) ----------

const GENERIC = new Set(
  [
    'fiction', 'accessible book', 'protected daisy', 'in library', 'large type books', 'lending library',
    'open library staff picks', 'internet archive wishlist', 'general', 'fiction, general', 'literature',
    'reading level-grade 11', 'reading level-grade 12', 'long now manual for civilization', 'overdrive',
  ].map((s) => s.toLowerCase()),
);

/** Trimmed, whitespace-collapsed, max 60 chars; null for generic catalogue tags. */
export function normSubject(s) {
  const t = String(s || '').replace(/\s+/g, ' ').trim().slice(0, 60).trim();
  if (!t) return null;
  const low = t.toLowerCase();
  if (GENERIC.has(low) || low.startsWith('nyt:') || low.includes('=')) return null;
  // marketing and catalogue tags say nothing about taste
  if (/new york times|bestseller|award|translations into|reading level|^accessible/.test(low)) return null;
  return t;
}

export function normAuthor(s) {
  const t = String(s || '').replace(/\s+/g, ' ').replace(/ and others$/i, '').trim().slice(0, 60).trim();
  if (!t || /^unknown( author)?$/i.test(t) || /^openstax$/i.test(t)) return null;
  return t;
}

/** The interest keys a book feeds: its first 5 (non-generic) subjects and its author. */
export function interestKeys(book) {
  if (!book) return [];
  const keys = [];
  const seen = new Set();
  for (const s of book.subjects || []) {
    const n = normSubject(s);
    if (!n || seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    keys.push('subject:' + n);
    if (keys.length === 5) break;
  }
  const a = normAuthor(book.author);
  if (a) keys.push('author:' + a);
  return keys;
}
