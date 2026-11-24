// Personal shelves for Home, built from the reader's taste (store.interests, or the server's
// /me/recommendations when signed in). Every row is a lazy loader so Home stays fast.
import { store } from './store.js';
import { api, accountsEnabled } from './api.js';
import { search, known } from './openlibrary.js';
import { clothFor } from './util.js';

export function fromServerBook(r) {
  const m = r.meta || {};
  const b = {
    id: r.id, title: r.title, author: r.author || 'Unknown author', year: r.year || '', cover: r.cover || null,
    kind: r.kind === 'textbook' ? 'textbook' : undefined, access: r.access || 'public', subjects: r.subjects || [],
    gut: m.gut || null, scan: m.scan || null, lv: m.lv || null, coverArt: m.coverArt, web: m.web, pdf: m.pdf,
    pages: m.pages || null, tone: m.tone || clothFor(r.id), lend: m.lend || null,
  };
  if (!known.get(b.id)?.curated) known.set(b.id, { ...(known.get(b.id) || {}), ...b });
  return known.get(b.id);
}

const seen = () => new Set([...store.shelf().map(b => b.id), ...store.reading().map(b => b.id)]);

/** Row specs: { key, title, sub, load(page) } */
export async function personalRows() {
  if (store.account && accountsEnabled()) {
    try {
      const { rows } = await api('/me/recommendations', { timeout: 25000 });
      if (rows?.length) return rows.map((r, i) => ({ key: 'srv' + i, title: r.title, sub: r.reason, books: r.books.map(fromServerBook) }));
    } catch { /* fall back to local taste */ }
  }
  return localRows();
}

export function localRows() {
  const { subjects, authors } = store.interests(6);
  const rows = [];
  const exclude = seen();
  const filterSeen = list => list.filter(b => !exclude.has(b.id));
  const recent = [...store.reading(), ...store.shelf()].find(b => b.kind !== 'textbook');
  const recentSubject = recent && (recent.subjects?.[0] || recent.subject);
  if (recent && recentSubject) rows.push({ key: 'because', title: `Because you read ${recent.title}`, sub: `More ${recentSubject.toLowerCase()}`, load: page => search({ subject: `subject:"${recentSubject}"`, page, limit: 24 }).then(r => filterSeen(r.books)) });
  subjects.filter(s => s.name !== recentSubject).slice(0, 3).forEach(s => rows.push({ key: 'sub:' + s.name, title: `More ${s.name.toLowerCase()}`, sub: 'From what you read', load: page => search({ subject: `subject:"${s.name}"`, page, limit: 24 }).then(r => filterSeen(r.books)) }));
  authors.slice(0, 2).forEach(a => rows.push({ key: 'au:' + a.name, title: `More by ${a.name}`, load: page => search({ q: `author:"${a.name}"`, page, limit: 24 }).then(r => filterSeen(r.books)) }));
  return rows;
}
