// Everything a reader owns lives in this browser's localStorage. No account, no server.
const KEY = 'spine.v1.';

function read(k, d) {
  try { const v = localStorage.getItem(KEY + k); return v == null ? d : JSON.parse(v); } catch { return d; }
}
function write(k, v) {
  try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch { /* storage full or blocked: keep working in memory */ }
}

const state = {
  shelf: read('shelf', []),            // [bookId] in the order they were added
  progress: read('progress', {}),      // bookId -> { ch, frac, pct, chTitle, t }
  books: read('books', {}),            // bookId -> slim book record for library/continue rows
  prefs: read('prefs', { fs: 18, tone: 'white', face: 'serif' }),
  sources: { gutenberg: true, archive: true, librivox: true, lending: true, openstax: true, ...read('sources', {}) },
  found: read('found', {}),            // bookId -> { gut, lv } resolved source ids (null = none)
  tones: read('tones', {}),            // bookId -> sampled cover colour
  audio: read('audio', null),          // { bookId, item, track, time }
};

const KEEP = ['id', 'title', 'author', 'year', 'pages', 'cover', 'tone', 'gut', 'scan', 'lv', 'audio', 'blurb', 'kind', 'access', 'lend', 'coverArt', 'pdf', 'web', 'subject', 'subjects'];
const slim = b => Object.fromEntries(KEEP.filter(k => b[k] != null).map(k => [k, b[k]]));

export const store = {
  get prefs() { return state.prefs; },
  savePrefs() { write('prefs', state.prefs); },

  get sources() { return state.sources; },
  setSource(k, on) { state.sources[k] = on; write('sources', state.sources); },

  remember(b) { if (!b?.id) return; state.books[b.id] = { ...(state.books[b.id] || {}), ...slim(b) }; write('books', state.books); },
  book(id) { return state.books[id]; },

  onShelf: id => state.shelf.includes(id),
  toggleShelf(b) {
    const on = !state.shelf.includes(b.id);
    state.shelf = on ? [b.id, ...state.shelf] : state.shelf.filter(x => x !== b.id);
    if (on) this.remember(b);
    write('shelf', state.shelf);
    return on;
  },
  shelf: () => state.shelf.map(id => state.books[id]).filter(Boolean),

  progress: id => state.progress[id],
  setProgress(b, p) {
    state.progress[b.id] = { ...p, t: Date.now() };
    this.remember(b);
    if (!state.shelf.includes(b.id)) { state.shelf.unshift(b.id); write('shelf', state.shelf); }
    write('progress', state.progress);
  },
  reading() {
    return Object.entries(state.progress)
      .filter(([, p]) => p.pct < 0.985)
      .sort((a, b) => b[1].t - a[1].t)
      .map(([id]) => state.books[id]).filter(Boolean);
  },
  finished: id => (state.progress[id]?.pct ?? 0) >= 0.985,

  found: id => state.found[id],
  setFound(id, patch) { state.found[id] = { ...(state.found[id] || {}), ...patch }; write('found', state.found); },

  tone: id => state.tones[id],
  setTone(id, t) { state.tones[id] = t; write('tones', state.tones); },

  get audio() { return state.audio; },
  setAudio(a) { state.audio = a; write('audio', a); },
};
