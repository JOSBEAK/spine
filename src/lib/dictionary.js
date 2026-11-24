// Word meanings: Free Dictionary API first, Wiktionary as a fallback. Both allow browser requests.
import { fetchJSON } from './util.js';

const cache = new Map();

export function define(word) {
  const w = word.toLowerCase().replace(/[^a-z'-]/g, '').replace(/^'+|'+$/g, '');
  if (!w) return Promise.resolve(null);
  if (!cache.has(w)) cache.set(w, lookup(w).catch(() => null));
  return cache.get(w);
}

async function lookup(w) {
  try {
    const d = await fetchJSON(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`, { timeout: 8000 });
    const e = d[0];
    const meanings = e.meanings.slice(0, 3).map(m => ({ pos: m.partOfSpeech, defs: m.definitions.slice(0, 2).map(x => x.definition) }));
    return { word: e.word, phonetic: e.phonetic || e.phonetics?.find(p => p.text)?.text || '', meanings, source: 'Free Dictionary' };
  } catch {
    const d = await fetchJSON(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(w)}`, { timeout: 8000 });
    const en = d.en || [];
    if (!en.length) return null;
    const strip = s => s.replace(/<[^>]+>/g, '').trim();
    return { word: w, phonetic: '', meanings: en.slice(0, 3).map(m => ({ pos: m.partOfSpeech.toLowerCase(), defs: m.definitions.slice(0, 2).map(x => strip(x.definition)).filter(Boolean) })), source: 'Wiktionary' };
  }
}
