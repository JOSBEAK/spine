// Internet Archive: Gutenberg text mirrors, LibriVox audiobooks, scans, EPUB files.
import { fetchJSON } from './util.js';
import { store } from './store.js';
import { parseGutenberg } from './gutenberg.js';

const IA = 'https://archive.org';
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const surname = a => norm(a).split(' ').filter(w => w.length > 1).pop() || '';
const quoteTitle = t => norm(t.split(/[:;(]/)[0]).split(' ').slice(0, 8).join(' ');

async function iaSearch(q, fl, rows = 10) {
  const p = new URLSearchParams({ q, rows, output: 'json' });
  fl.forEach(f => p.append('fl[]', f));
  const d = await fetchJSON(`${IA}/advancedsearch.php?${p}`, { timeout: 15000 });
  return d.response?.docs || [];
}

const metaCache = new Map();
export function metadata(item) {
  if (!metaCache.has(item)) metaCache.set(item, fetchJSON(`${IA}/metadata/${encodeURIComponent(item)}`, { timeout: 20000 }).catch(e => { metaCache.delete(item); throw e; }));
  return metaCache.get(item);
}
export const download = (item, file) => `${IA}/download/${encodeURIComponent(item)}/${file.split('/').map(encodeURIComponent).join('/')}`;
export const scanEmbed = item => `${IA}/embed/${encodeURIComponent(item)}`;
export const itemPage = item => `${IA}/details/${encodeURIComponent(item)}`;

/** Find the Project Gutenberg mirror item for a book. Resolves to an identifier or null. */
export async function findText(b) {
  if (b.gut) return b.gut;
  const f = store.found(b.id);
  if (f && 'gut' in f) return f.gut;
  const docs = await iaSearch(`collection:gutenberg AND title:("${quoteTitle(b.title)}") AND creator:(${surname(b.author)})`, ['identifier', 'title'], 12);
  const want = norm(b.title);
  const pick = docs.find(d => norm(d.title) === want) || docs.find(d => norm(d.title).startsWith(quoteTitle(b.title))) || null;
  const gut = pick?.identifier || null;
  store.setFound(b.id, { gut });
  b.gut = gut;
  return gut;
}

/** Find a LibriVox recording. Resolves to { item, runtime } or null. */
export async function findAudio(b) {
  const f = store.found(b.id);
  if (f && 'lv' in f) return f.lv;
  const q = `collection:librivoxaudio AND title:("${quoteTitle(b.title)}") AND creator:(${surname(b.author)})`;
  let docs = await iaSearch(`${q} AND language:(English OR eng)`, ['identifier', 'title', 'runtime'], 12);
  if (!docs.length) docs = await iaSearch(q, ['identifier', 'title', 'runtime'], 12);
  const ok = docs.filter(d => d.runtime && !/dramatic|abridged|selections|excerpt/i.test(d.title));
  const prefer = b.lv && ok.find(d => d.identifier === b.lv);
  const want = norm(b.title);
  const d = prefer || ok.find(x => norm(x.title) === want) || ok[0];
  const lv = d ? { item: d.identifier, runtime: fmtRuntime(d.runtime) } : null;
  store.setFound(b.id, { lv });
  return lv;
}

function fmtRuntime(r) {
  if (!r) return null;
  const p = String(r).split(':').map(Number);
  if (p.some(Number.isNaN)) return String(r);
  while (p.length < 3) p.unshift(0);
  return p[0] ? `${p[0]} h ${String(p[1]).padStart(2, '0')} m` : `${p[1]} min`;
}

export async function epubFor(item) {
  const m = await metadata(item);
  const files = (m.files || []).map(f => f.name).filter(n => /\.epub$/i.test(n));
  const best = files.find(n => /-images\.epub$/i.test(n)) || files.find(n => /^pg\d+\.epub$/i.test(n)) || files[0];
  return best ? download(item, best) : null;
}

export async function tracks(item) {
  const m = await metadata(item);
  const all = (m.files || []).filter(f => /\.mp3$/i.test(f.name));
  const low = all.filter(f => /64kb/i.test(f.name));
  const list = (low.length ? low : all).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return list.map((f, i) => ({
    n: i + 1,
    title: (f.title || f.name.replace(/(_64kb)?\.mp3$/i, '').replace(/_/g, ' ')).trim(),
    url: download(item, f.name),
    length: toSec(f.length),
  }));
}
function toSec(l) {
  if (!l) return null;
  if (String(l).includes(':')) return String(l).split(':').map(Number).reduce((a, b) => a * 60 + b, 0);
  return Math.round(parseFloat(l));
}

const textCache = new Map();
/** Fetch and parse the full text. Resolves to { chapters, words }. */
export function loadText(item) {
  if (!textCache.has(item)) textCache.set(item, (async () => {
    const m = await metadata(item);
    const names = (m.files || []).map(f => f.name).filter(n => /\.txt(\.utf8)?$/i.test(n) && !/_meta\.txt$|_djvu\.txt$|readme|license/i.test(n));
    const rank = n => /\.txt\.utf8$/i.test(n) ? 0 : /-0\.txt$/i.test(n) ? 1 : /^pg\d+\.txt$/i.test(n) ? 2 : /^\d+\.txt$/i.test(n) ? 3 : /-8\.txt$/i.test(n) ? 4 : 5;
    names.sort((a, b) => rank(a) - rank(b));
    if (!names.length) throw new Error('No plain-text file in this Gutenberg item.');
    const r = await fetch(download(item, names[0]));
    if (!r.ok) throw new Error(`The text file did not load (${r.status}).`);
    const buf = await r.arrayBuffer();
    let raw;
    try { raw = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { raw = new TextDecoder('windows-1252').decode(buf); }
    return parseGutenberg(raw);
  })().catch(e => { textCache.delete(item); throw e; }));
  return textCache.get(item);
}
