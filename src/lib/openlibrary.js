import { fetchJSON, clothFor } from './util.js';
import { store } from './store.js';
import SEED from '../data/seed.json';
import TEXTBOOKS from '../data/textbooks.json';

const OL = 'https://openlibrary.org';
const FIELDS = 'key,title,author_name,cover_i,first_publish_year,number_of_pages_median,edition_count,ia,id_project_gutenberg,lending_identifier_s,ebook_access,first_sentence,subject';

/** Every book the app has seen this session, by Open Library work id. */
export const known = new Map();

export const seed = SEED.map(b => ({ ...b, curated: true, tone: b.tone || clothFor(b.id) }));
seed.forEach(b => known.set(b.id, b));

/** OpenStax textbooks, baked in at build time (see scripts/build-textbooks.py). */
const TB_ORDER = ['Math', 'Science', 'Computer Science', 'Social Sciences', 'Business', 'Humanities', 'College Success', 'Nursing'];
const rank = b => (TB_ORDER.includes(b.subject) ? TB_ORDER.indexOf(b.subject) : TB_ORDER.length);
export const textbooks = [...TEXTBOOKS].sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
textbooks.forEach(b => known.set(b.id, b));

export function searchTextbooks(q = '', subject = '') {
  const t = q.toLowerCase();
  return textbooks.filter(b => (!t || `${b.title} ${b.author} ${b.subjects.join(' ')}`.toLowerCase().includes(t)) && (!subject || b.subjects.includes(subject)));
}

const lendingOn = () => store.sources.lending !== false;

// The work page lists every edition with its own Borrow button, so readers can pick their language.
export const borrowURL = b => `https://openlibrary.org/works/${b.id}`;

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
    access: d.ebook_access || 'public',
    lend: d.lending_identifier_s || null,
    scan: d.ebook_access === 'public' ? d.lending_identifier_s || null : null,
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
 * mode: 'all' = read now or borrow; 'read' = free to read now (public domain);
 *       'clean' = has Gutenberg text for the Spine reader; 'borrow' = modern books from the lending library.
 */
export async function search({ q = '', subject = '', mode = 'all', era = 'any', english = true, sort = 'readinglog', page = 1, limit = 30 } = {}) {
  const parts = [];
  if (q) parts.push(q);
  if (!lendingOn() && (mode === 'all' || mode === 'borrow')) mode = 'read';
  parts.push(mode === 'all' ? 'ebook_access:[borrowable TO *]' : mode === 'borrow' ? 'ebook_access:borrowable' : 'ebook_access:public');
  if (mode === 'clean') parts.push('id_project_gutenberg:*');
  if (subject) parts.push(subject.includes(':') || subject.startsWith('(') ? subject : `subject:"${subject}"`);
  if (era === 'old') parts.push('first_publish_year:[* TO 1799]');
  if (era === '1800s') parts.push('first_publish_year:[1800 TO 1899]');
  if (era === '1900s') parts.push('first_publish_year:[1900 TO 1949]');
  if (era === 'modern') parts.push('first_publish_year:[1950 TO *]');
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
  if (id.startsWith('OX-')) throw new Error('This textbook is no longer listed by OpenStax.');
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
