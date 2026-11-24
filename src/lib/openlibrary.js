import { fetchJSON, clothFor } from './util.js';
import { store } from './store.js';
import SEED from '../data/seed.json';

const OL = 'https://openlibrary.org';
const FIELDS = 'key,title,author_name,cover_i,first_publish_year,number_of_pages_median,edition_count,ia,id_project_gutenberg,lending_identifier_s,ebook_access,first_sentence,subject';

/** Every book the app has seen this session, by Open Library work id. */
export const known = new Map();

export const seed = SEED.map(b => ({ ...b, curated: true, tone: b.tone || clothFor(b.id) }));
seed.forEach(b => known.set(b.id, b));

export function coverURL(b, size = 'M') {
  return b.cover ? `https://covers.openlibrary.org/b/id/${b.cover}-${size}.jpg` : null;
}

export function fromDoc(d) {
  const id = d.key.split('/').pop();
  if (known.get(id)?.curated) return known.get(id);
  const ia = d.ia || [];
  const gids = (d.id_project_gutenberg || []).map(String);
  const gutItems = ia.filter(x => x.endsWith('gut'));
  const pref = gutItems.find(i => gids.some(g => /^\d+$/.test(g) && i.endsWith(g.padStart(5, '0') + 'gut')));
  const b = {
    id,
    title: d.title,
    author: (d.author_name || ['Unknown author'])[0],
    year: d.first_publish_year ? String(d.first_publish_year) : '',
    pages: d.number_of_pages_median || null,
    cover: d.cover_i || null,
    gut: pref || gutItems[0] || null,
    gutIds: gids,
    scan: d.lending_identifier_s || null,
    lv: ia.find(i => /librivox/i.test(i)) || null,
    subjects: (d.subject || []).filter(s => s.length < 40 && !/[:(]/.test(s)).slice(0, 8),
    first: (d.first_sentence || []).find(s => s.length > 30 && s.length < 260) || null,
    tone: store.tone(id) || clothFor(id),
  };
  known.set(id, { ...(known.get(id) || {}), ...b });
  return known.get(id);
}

/**
 * Search free books.
 * mode 'clean' = books with Gutenberg text (open in the Spine reader); 'all' = every public ebook incl. scans.
 */
export async function search({ q = '', subject = '', mode = 'clean', era = 'any', english = true, sort = 'editions', page = 1, limit = 30 } = {}) {
  const parts = [];
  if (q) parts.push(q);
  parts.push('ebook_access:public');
  if (mode === 'clean') parts.push('id_project_gutenberg:*');
  if (subject) parts.push(subject.includes(':') || subject.startsWith('(') ? subject : `subject:"${subject}"`);
  if (era === 'old') parts.push('first_publish_year:[* TO 1799]');
  if (era === '1800s') parts.push('first_publish_year:[1800 TO 1899]');
  if (era === '1900s') parts.push('first_publish_year:[1900 TO *]');
  if (english) parts.push('language:eng');
  const params = new URLSearchParams({ q: parts.join(' '), fields: FIELDS, limit, page });
  if (sort && sort !== 'relevance') params.set('sort', sort);
  const d = await fetchJSON(`${OL}/search.json?${params}`);
  const foreign = /[\u0370-\u03FF\u0400-\u04FF\u0590-\u06FF\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/;
  const docs = (d.docs || []).filter(x => x.title && !(english && foreign.test(x.title)));
  return { total: d.numFound ?? d.num_found ?? 0, books: docs.map(fromDoc) };
}

export async function getBook(id) {
  if (known.has(id) && known.get(id).title) return known.get(id);
  const cached = store.book(id);
  try {
    const d = await fetchJSON(`${OL}/search.json?${new URLSearchParams({ q: `key:"/works/${id}"`, fields: FIELDS })}`);
    if (d.docs?.[0]) return fromDoc(d.docs[0]);
  } catch (e) { if (!cached) throw e; }
  if (cached) { known.set(id, cached); return cached; }
  throw new Error('This book could not be found on Open Library.');
}

function cleanDescription(s) {
  return s
    .replace(/\r/g, '')
    .split(/\n-{3,}|\n\*\*Contains|\n\(\[source\]/i)[0]
    .replace(/\[([^\]]+)\]\[\d+\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*\[\d+\]:.*$/gm, '')
    .replace(/\(\s*\[?source\]?[^)]*\)/gi, '')
    .replace(/\n{2,}/g, '\n\n')
    .trim();
}

export async function getDescription(id) {
  try {
    const w = await fetchJSON(`${OL}/works/${id}.json`, { timeout: 12000 });
    const d = typeof w.description === 'string' ? w.description : w.description?.value;
    return d ? cleanDescription(d) : null;
  } catch { return null; }
}
