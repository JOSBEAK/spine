// Counting readers: the first time this browser opens a book in a calendar month, Spine tells the
// server once. People without an account are counted by a random id this browser makes up; nothing
// else about them is sent. The server keeps one row per book, reader and month.
import { api, accountsEnabled } from './api.js';
import { known, textbooks } from './openlibrary.js';
import { fromServerBook } from './recs.js';

const KEY = 'spine.v1.reads';
const DEVICE = 'spine.v1.reader';
const SEEN = 'spine.v1.seen';
const month = () => new Date().toISOString().slice(0, 7); // UTC, like the server

function load() {
  try { const v = JSON.parse(localStorage.getItem(KEY)); if (v?.m === month()) return v; } catch { /* fresh start */ }
  return { m: month(), ids: [] };
}

function readerId() {
  try {
    let id = localStorage.getItem(DEVICE);
    if (!id) { id = crypto.randomUUID(); localStorage.setItem(DEVICE, id); }
    return id;
  } catch { return null; }
}

const slim = b => ({
  id: b.id, title: b.title, author: b.author, year: b.year ? String(b.year) : null, cover: b.cover ?? null,
  kind: b.kind === 'textbook' ? 'textbook' : 'book', access: b.access || null, subjects: (b.subjects || []).slice(0, 12),
  meta: { ...(b.gut ? { gut: b.gut } : {}), ...(b.scan ? { scan: b.scan } : {}), ...(b.pages ? { pages: b.pages } : {}) },
});

const pending = new Set();
export function countRead(b) {
  if (!b?.id || !accountsEnabled()) return;
  const s = load();
  if (s.ids.includes(b.id) || pending.has(b.id)) return;
  const reader = readerId();
  if (!reader) return;
  pending.add(b.id);
  api('/reads', { method: 'POST', body: { book: slim(b), reader }, timeout: 10000 })
    .then(r => {
      const now = load(); now.ids.push(b.id);
      try { localStorage.setItem(KEY, JSON.stringify(now)); } catch { /* full */ }
      if (r?.counted) { cache.delete('b:' + b.id); fresh.add(b.id); dispatchEvent(new CustomEvent('spine:read', { detail: b.id })); } // your own read shows up straight away
    })
    .catch(() => { /* try again next time it's opened */ })
    .finally(() => pending.delete(b.id));
}

/* ---------- footfall ---------- */

// Once per page load Spine tells its server it was opened: this browser's random id, whether it
// is the first time, the screen it opened on, and the site that linked here. Only the owner sees
// these numbers; nothing about them is shown on the site.
let visited = false;
export function logVisit() {
  if (visited || !accountsEnabled()) return;
  visited = true;
  const visitor = readerId();
  if (!visitor) return;
  let first = false;
  try { first = !localStorage.getItem(SEEN); if (first) localStorage.setItem(SEEN, new Date().toISOString()); } catch { /* private mode */ }
  const qs = new URLSearchParams(location.search);
  const body = {
    visitor, first,
    landing: location.pathname.slice(0, 40),
    referrer: document.referrer ? document.referrer.slice(0, 200) : null,
    source: (qs.get('utm_source') || qs.get('ref') || '').slice(0, 60) || null,
  };
  api('/visits', { method: 'POST', body, timeout: 10000 }).catch(() => { /* not worth retrying */ });
}

/* ---------- reading the numbers back ---------- */

const cache = new Map();
const fresh = new Set(); // books whose count changed since the browser last cached it
const cached = (key, ttl, fn) => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.p;
  const p = fn().catch(e => { cache.delete(key); throw e; });
  cache.set(key, { t: Date.now(), p });
  return p;
};

/** { month, all_time } readers of one book. */
export const bookReaders = id => cached('b:' + id, 60e3, () => {
  const bust = fresh.delete(id) ? `?t=${Date.now()}` : '';
  return api(`/stats/books/${encodeURIComponent(id)}${bust}`, { auth: false, timeout: 8000 });
});

/** The most read books, as [{ book, readers }], ready to render. Books Spine can't describe are left out. */
export const topBooks = (period = 'month', limit = 10) => cached(`t:${period}:${limit}`, 60e3, async () => {
  const r = await api(`/stats/top?period=${period}&limit=${limit}`, { auth: false, timeout: 8000 });
  return (r.books || []).map(({ book, readers }) => {
    const local = known.get(book.id) || textbooks.find(t => t.id === book.id);
    const b = local?.title ? local : book.title ? fromServerBook(book) : null;
    return b ? { book: b, readers } : null;
  }).filter(Boolean);
});

export const monthName = () => new Date().toLocaleString('en', { month: 'long', timeZone: 'UTC' });
