// Server-side Open Library client: 15 s timeout, an honest User-Agent, and a 12 h cache in ol_cache.
// `fetch` is injected so tests never touch the network.

import { HttpError } from './http.js';
import { asJson } from './db.js';

const OL = 'https://openlibrary.org';
export const SEARCH_FIELDS =
  'key,title,author_name,cover_i,first_publish_year,ebook_access,subject,lending_identifier_s,number_of_pages_median';
const CACHE_MS = 12 * 3600 * 1000;
const DAY_MS = 86400 * 1000;

export const SHELVES = {
  'want-to-read': 'want',
  'currently-reading': 'reading',
  'already-read': 'finished',
};

/** Maps an Open Library search doc to the `books` row shape. */
export function docToBook(d) {
  const meta = {};
  if (d.number_of_pages_median) meta.pages = d.number_of_pages_median;
  if (d.ebook_access === 'public' && d.lending_identifier_s) meta.scan = d.lending_identifier_s;
  return {
    id: String(d.key || '').split('/').pop(),
    title: d.title || '',
    author: (d.author_name || [])[0] || '',
    year: d.first_publish_year ? String(d.first_publish_year) : '',
    cover: d.cover_i || null,
    kind: 'book',
    access: d.ebook_access || null,
    subjects: (d.subject || []).slice(0, 8),
    meta,
  };
}

/** Maps a reading-log entry ({ work: { title, key, author_names, first_publish_year, cover_id } }). */
export function logEntryToBook(e) {
  const w = e.work || {};
  return {
    id: String(w.key || '').split('/').pop(),
    title: w.title || '',
    author: (w.author_names || [])[0] || '',
    year: w.first_publish_year ? String(w.first_publish_year) : '',
    cover: w.cover_id || null,
    kind: 'book',
    access: null,
    subjects: [],
    meta: {},
  };
}

export function createOpenLibrary({ fetch, db, now, userAgent, timeoutMs = 15000 }) {
  async function get(url) {
    let res;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': userAgent, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new HttpError(504, `Open Library didn't answer within ${Math.round(timeoutMs / 1000)} seconds. Please try again in a minute.`);
      }
      throw new HttpError(502, "Couldn't reach Open Library. Please try again in a minute.");
    }
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  }

  async function getOk(url) {
    const r = await get(url);
    if (r.status >= 400 || !r.body) {
      throw new HttpError(502, `Open Library returned an error (${r.status}). Please try again in a minute.`);
    }
    return r.body;
  }

  /** GET with the ol_cache table in front (12 h). */
  async function cached(url) {
    const t = now();
    const { rows } = await db.query('SELECT body FROM ol_cache WHERE key = $1 AND fetched_at > $2', [
      url, new Date(+t - CACHE_MS).toISOString(),
    ]);
    if (rows.length) return rows[0].body;
    const body = await getOk(url);
    await db.query(
      `INSERT INTO ol_cache (key, body, fetched_at) VALUES ($1, $2::text::jsonb, $3)
       ON CONFLICT (key) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at`,
      [url, asJson(body), t.toISOString()],
    );
    await db.query('DELETE FROM ol_cache WHERE fetched_at < $1', [new Date(+t - DAY_MS).toISOString()]);
    return body;
  }

  return {
    /** Free-text search (Solr syntax), returns book rows. Cached. */
    async search(q, { limit = 20, sort = 'readinglog' } = {}) {
      const params = new URLSearchParams({ q, fields: SEARCH_FIELDS, limit: String(limit) });
      if (sort) params.set('sort', sort);
      const body = await cached(`${OL}/search.json?${params}`);
      return (body.docs || []).filter((d) => d.key && d.title).map(docToBook);
    },

    /** Best match for a title + author (CSV imports). Cached, so a retried import is quick. */
    async match(title, author) {
      const params = new URLSearchParams({ title, fields: SEARCH_FIELDS, limit: '3' });
      if (author) params.set('author', author);
      const body = await cached(`${OL}/search.json?${params}`);
      const doc = (body.docs || []).find((d) => d.key && d.title);
      return doc ? docToBook(doc) : null;
    },

    /**
     * One page of a public reading log. Returns { entries } or throws 404 (no such user) / 403 (private log).
     * Not cached: the reader wants their current shelves.
     */
    async readingLog(username, shelf, page = 1) {
      const url = `${OL}/people/${encodeURIComponent(username)}/books/${shelf}.json?page=${page}`;
      const { status, body } = await get(url);
      const notFound = () =>
        new HttpError(404, `There's no Open Library account called "${username}". Check the username on your Open Library profile page.`);
      const isPrivate = () =>
        new HttpError(403, `The reading log for "${username}" is private. On Open Library, open Settings → Privacy, make your reading log public, then try again.`);
      if (status === 404) throw notFound();
      if (status === 401 || status === 403) throw isPrivate();
      if (status >= 400 || !body) throw new HttpError(502, `Open Library returned an error (${status}). Please try again in a minute.`);
      if (body.error) throw /not\s*found|no such|does not exist/i.test(String(body.error)) ? notFound() : isPrivate();
      if (!Array.isArray(body.reading_log_entries)) throw isPrivate();
      return { entries: body.reading_log_entries };
    },
  };
}
