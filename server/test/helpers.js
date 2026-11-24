// Test harness: the real app on in-memory PGlite, a controllable clock and a fake Open Library.

import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { loadConfig } from '../src/config.js';

export const T0 = new Date('2026-06-01T12:00:00.000Z');
export const DAY = 86400 * 1000;

export const uniqueEmail = (p = 'reader') => `${p}-${crypto.randomUUID().slice(0, 13)}@example.com`;

/**
 * Starts an app. `ol` is a function (url: URL) => object | { status, body } | throws, used as Open Library.
 * Every URL fetched is recorded in `fetched`.
 */
export async function setup() {
  // Set TEST_DATABASE_URL to run the suite against a real (throwaway!) Postgres instead of PGlite.
  const db = process.env.TEST_DATABASE_URL ? openDb({ url: process.env.TEST_DATABASE_URL }) : openDb({ memory: true });
  await db.connect();
  let clock = +T0;
  const fetched = [];
  const h = {
    db,
    fetched,
    ol: () => ({ docs: [] }),
    now: () => new Date(clock),
    advance(ms) { clock += ms; },
    set(date) { clock = +new Date(date); },
  };
  const fakeFetch = async (url, opts) => {
    const u = new URL(url);
    fetched.push({ url: u, headers: opts?.headers || {} });
    const out = await h.ol(u);
    const status = out && typeof out.status === 'number' && 'body' in out ? out.status : 200;
    const body = out && typeof out.status === 'number' && 'body' in out ? out.body : out;
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  const config = { ...loadConfig({}), trustProxy: true, importBudgetMs: 60000 };
  h.app = createApp({ db, fetch: fakeFetch, now: h.now, config, log: { error: process.env.TEST_LOG ? console.error : () => {} } });

  h.api = async (method, path, { token, body, headers = {}, raw } = {}) => {
    const init = { method, headers: { ...headers } };
    if (token) init.headers.authorization = `Bearer ${token}`;
    if (raw !== undefined) init.body = raw;
    else if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers['content-type'] = 'application/json';
    }
    const res = await h.app.request(path, init);
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, body: json, headers: res.headers };
  };

  h.signup = async (opts = {}) => {
    const email = opts.email || uniqueEmail();
    const r = await h.api('POST', '/auth/signup', { body: { email, password: opts.password || 'correct horse', name: opts.name } });
    if (r.status !== 201) throw new Error(`signup failed: ${r.status} ${JSON.stringify(r.body)}`);
    return { email, token: r.body.token, user: r.body.user };
  };

  h.sync = (token, body) => h.api('POST', '/sync', { token, body });
  h.close = () => db.close();
  return h;
}

export const book = (id, extra = {}) => ({
  id, title: `Title ${id}`, author: 'Jane Austen', year: '1813', cover: 1, kind: 'book', access: 'public',
  subjects: ['Fiction', 'Love stories', 'Courtship', 'England'], meta: {}, ...extra,
});

export const olDoc = (n, extra = {}) => ({
  key: `/works/OL${n}W`, title: `Book ${n}`, author_name: ['Some Author'], cover_i: n, first_publish_year: 1900,
  ebook_access: 'borrowable', subject: ['Adventure', 'Sea stories'], lending_identifier_s: `ia${n}`,
  number_of_pages_median: 200, ...extra,
});
