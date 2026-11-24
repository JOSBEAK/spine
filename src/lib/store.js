// Local-first storage. Everything a reader does is written here first (localStorage), so Spine
// works without an account. When signed in, src/lib/sync.js pushes the dirty rows to the server
// and merges back what changed elsewhere.
const KEY = 'spine.v1.';

function read(k, d) {
  try { const v = localStorage.getItem(KEY + k); return v == null ? d : JSON.parse(v); } catch { return d; }
}
const pending = new Map();
function write(k, v) {
  // coalesce bursts of writes (page turns, highlights) into one localStorage write per key
  pending.set(k, v);
  if (pending.size === 1) queueMicrotask(flush);
}
function flush() {
  for (const [k, v] of pending) {
    try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch { /* storage full or blocked: keep working in memory */ }
  }
  pending.clear();
}
addEventListener('pagehide', flush);

const now = () => new Date().toISOString();
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2));

const state = {
  shelf: read('shelf', []),            // [bookId] in the order they were added
  progress: read('progress', {}),      // bookId -> { ch, frac, page, pct, chTitle, t }
  libmeta: read('libmeta', {}),        // bookId -> { first_opened_at, last_opened_at, finished_at, updated_at, seconds, sessions, borrowed }
  books: read('books', {}),            // bookId -> slim book record
  prefs: { fs: 18, tone: 'white', face: 'serif', view: 'book', scale: 1, ...read('prefs', {}) },
  sources: { gutenberg: true, archive: true, librivox: true, lending: true, openstax: true, ...read('sources', {}) },
  found: read('found', {}),            // bookId -> { gut, lv } resolved source ids (null = none)
  tones: read('tones', {}),            // bookId -> sampled cover colour
  audio: read('audio', null),          // { bookId, item, track, time }
  highlights: read('highlights', {}),  // id -> { id, book_id, locator, text, color, note, deleted, updated_at }
  bookmarks: read('bookmarks', {}),    // id -> { id, book_id, locator, label, deleted, updated_at }
  sessions: read('sessions', []),      // recent reading sittings, newest last (kept: 400)
  events: read('events', []),          // recent actions, newest last (kept: 400)
  interests: read('interests', {}),    // 'subject:x' | 'author:y' -> { score, at }
  dirty: read('dirty', { library: [], highlights: [], bookmarks: [] }),
  outbox: read('outbox', { sessions: [], events: [] }),
  account: read('account', null),      // { token, user, rev, linked }
};

const listeners = new Set();
const emit = what => listeners.forEach(fn => { try { fn(what); } catch { /* a broken listener must not break saving */ } });

const KEEP = ['id', 'title', 'author', 'year', 'pages', 'cover', 'tone', 'gut', 'scan', 'lv', 'audio', 'blurb', 'kind', 'access', 'lend', 'coverArt', 'pdf', 'web', 'subject', 'subjects', 'genre'];
const slim = b => Object.fromEntries(KEEP.filter(k => b[k] != null).map(k => [k, b[k]]));

function markDirty(kind, id) {
  const list = state.dirty[kind];
  if (!list.includes(id)) list.push(id);
  write('dirty', state.dirty);
  emit('dirty');
}
function touchLib(id, patch = {}) {
  const m = state.libmeta[id] = { ...(state.libmeta[id] || {}), ...patch, updated_at: now() };
  write('libmeta', state.libmeta);
  markDirty('library', id);
  return m;
}

/* ---------- taste: the same decaying scores the server keeps ---------- */
const HALF_LIFE_DAYS = 60;
const GENERIC = /^(fiction|accessible book|protected daisy|in library|large type books|lending library|open library staff picks|reading level|nyt:|new york times|bestseller|award|translations into|internet archive wishlist|overdrive|fiction, general|english language|long now manual)/i;
const GENRE_SUBJECT = { Romance: 'Love stories', Mystery: 'Detective and mystery stories', Gothic: 'Horror tales', SciFi: 'Science fiction', Adventure: 'Adventure stories', Children: "Children's stories", Ideas: 'Philosophy', Poetry: 'Poetry', Classics: 'Classic literature' };
export const WEIGHTS = { view: 0.5, shelf_add: 2, borrow_open: 1.5, listen: 1.5, finish: 5, highlight: 0.5 };

function bookSignals(b) {
  if (!b) return [];
  const subs = (b.subjects?.length ? b.subjects : [b.subject || GENRE_SUBJECT[b.genre]].filter(Boolean))
    .map(s => String(s).trim()).filter(s => s && s.length <= 60 && !GENERIC.test(s)).slice(0, 5);
  const author = (b.author || '').replace(/ and others$/, '');
  return [...subs.map(s => 'subject:' + s), ...(author && author !== 'Unknown author' && author !== 'OpenStax' ? ['author:' + author] : [])];
}
function bump(b, weight) {
  if (!weight) return;
  const t = Date.now();
  for (const key of bookSignals(b)) {
    const cur = state.interests[key];
    const decayed = cur ? cur.score * 0.5 ** ((t - cur.at) / 864e5 / HALF_LIFE_DAYS) : 0;
    state.interests[key] = { score: decayed + weight, at: t };
  }
  // keep the 300 strongest
  const keys = Object.keys(state.interests);
  if (keys.length > 300) keys.sort((a, c) => state.interests[a].score - state.interests[c].score).slice(0, keys.length - 300).forEach(k => delete state.interests[k]);
  write('interests', state.interests);
}

export const store = {
  uuid,
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  get prefs() { return state.prefs; },
  savePrefs() { write('prefs', state.prefs); emit('prefs'); },

  get sources() { return state.sources; },
  setSource(k, on) { state.sources[k] = on; write('sources', state.sources); },

  remember(b) { if (!b?.id) return; state.books[b.id] = { ...(state.books[b.id] || {}), ...slim(b) }; write('books', state.books); },
  book(id) { return state.books[id]; },

  /* ---------- shelf and progress ---------- */
  onShelf: id => state.shelf.includes(id),
  toggleShelf(b) {
    const on = !state.shelf.includes(b.id);
    state.shelf = on ? [b.id, ...state.shelf] : state.shelf.filter(x => x !== b.id);
    if (on) this.remember(b);
    write('shelf', state.shelf);
    touchLib(b.id);
    this.track(on ? 'shelf_add' : 'shelf_remove', b);
    return on;
  },
  shelf: () => state.shelf.map(id => state.books[id]).filter(Boolean),

  progress: id => state.progress[id],
  setProgress(b, p) {
    const first = !state.progress[b.id];
    // text keeps {ch, frac}, scans keep {page}; both live in one record and `mode` says which was used last
    state.progress[b.id] = { ...(state.progress[b.id] || {}), ...p, t: Date.now() };
    this.remember(b);
    if (!state.shelf.includes(b.id)) { state.shelf.unshift(b.id); write('shelf', state.shelf); }
    write('progress', state.progress);
    const meta = state.libmeta[b.id] || {};
    const patch = { last_opened_at: now() };
    if (first && !meta.first_opened_at) patch.first_opened_at = now();
    if (p.pct >= 0.985 && !meta.finished_at) { patch.finished_at = now(); this.track('finish', b); }
    touchLib(b.id, patch);
  },
  markBorrowed(b) { this.remember(b); if (!state.shelf.includes(b.id)) { state.shelf.unshift(b.id); write('shelf', state.shelf); } touchLib(b.id, { borrowed: true, last_opened_at: now() }); },
  reading() {
    return Object.entries(state.progress)
      .filter(([, p]) => p.pct < 0.985)
      .sort((a, b) => b[1].t - a[1].t)
      .map(([id]) => state.books[id]).filter(Boolean);
  },
  finished: id => (state.progress[id]?.pct ?? 0) >= 0.985,
  meta: id => state.libmeta[id] || {},

  found: id => state.found[id],
  setFound(id, patch) { state.found[id] = { ...(state.found[id] || {}), ...patch }; write('found', state.found); },

  tone: id => state.tones[id],
  setTone(id, t) { state.tones[id] = t; write('tones', state.tones); },

  get audio() { return state.audio; },
  setAudio(a) { state.audio = a; write('audio', a); },

  /* ---------- highlights and bookmarks ---------- */
  highlightsFor: id => Object.values(state.highlights).filter(h => h.book_id === id && !h.deleted),
  saveHighlight(h) {
    const row = { id: h.id || uuid(), color: 'yellow', note: '', ...h, deleted: false, updated_at: now() };
    const isNew = !state.highlights[row.id];
    state.highlights[row.id] = row;
    write('highlights', state.highlights);
    markDirty('highlights', row.id);
    if (isNew) this.track('highlight', state.books[row.book_id] || { id: row.book_id });
    return row;
  },
  removeHighlight(id) {
    if (!state.highlights[id]) return;
    state.highlights[id] = { ...state.highlights[id], deleted: true, updated_at: now() };
    write('highlights', state.highlights);
    markDirty('highlights', id);
  },
  bookmarksFor: id => Object.values(state.bookmarks).filter(m => m.book_id === id && !m.deleted),
  saveBookmark(m) {
    const row = { id: m.id || uuid(), label: '', ...m, deleted: false, updated_at: now() };
    state.bookmarks[row.id] = row;
    write('bookmarks', state.bookmarks);
    markDirty('bookmarks', row.id);
    return row;
  },
  removeBookmark(id) {
    if (!state.bookmarks[id]) return;
    state.bookmarks[id] = { ...state.bookmarks[id], deleted: true, updated_at: now() };
    write('bookmarks', state.bookmarks);
    markDirty('bookmarks', id);
  },

  /* ---------- history: reading sittings and actions ---------- */
  addSession(s) {
    if (!s || s.seconds < 15) return;   // ignore accidental opens
    const row = { ...s, id: uuid() };
    state.sessions.push(row); if (state.sessions.length > 400) state.sessions.splice(0, state.sessions.length - 400);
    state.outbox.sessions.push(row); if (state.outbox.sessions.length > 400) state.outbox.sessions.shift();
    write('sessions', state.sessions); write('outbox', state.outbox);
    const m = state.libmeta[s.book_id] || {};
    touchLib(s.book_id, { seconds: (m.seconds || 0) + s.seconds, sessions: (m.sessions || 0) + 1 });
    bump(state.books[s.book_id], Math.min(4, s.seconds / 600));
    emit('session');
  },
  track(type, b, data = {}) {
    const row = { type, book_id: b?.id || null, at: now(), data };
    state.events.push(row); if (state.events.length > 400) state.events.splice(0, state.events.length - 400);
    state.outbox.events.push(row); if (state.outbox.events.length > 400) state.outbox.events.shift();
    write('events', state.events); write('outbox', state.outbox);
    if (b) { this.remember(b); bump(state.books[b.id] || b, WEIGHTS[type] || 0); }
  },
  sessionsFor: id => state.sessions.filter(s => s.book_id === id),
  history() {
    const items = [
      ...state.sessions.map(s => ({ kind: 'session', at: s.ended_at, ...s })),
      ...state.events.filter(e => !['view', 'search'].includes(e.type)).map(e => ({ kind: 'event', ...e })),
    ];
    return items.sort((a, b) => (a.at < b.at ? 1 : -1));
  },

  /* ---------- taste ---------- */
  interests(limit = 12) {
    const t = Date.now();
    const scored = Object.entries(state.interests).filter(([k]) => !GENERIC.test(k.replace(/^\w+:/, ''))).map(([k, v]) => ({ key: k, score: v.score * 0.5 ** ((t - v.at) / 864e5 / HALF_LIFE_DAYS) }));
    scored.sort((a, b) => b.score - a.score);
    const pick = prefix => scored.filter(x => x.key.startsWith(prefix)).slice(0, limit).map(x => ({ name: x.key.slice(prefix.length), score: x.score }));
    return { subjects: pick('subject:'), authors: pick('author:') };
  },

  /* ---------- account and sync plumbing (used by sync.js) ---------- */
  get account() { return state.account; },
  setAccount(a) { state.account = a; write('account', a); emit('account'); },
  dirtyRows() {
    const lib = state.dirty.library.map(id => {
      const p = state.progress[id], m = state.libmeta[id] || {};
      const status = (p?.pct ?? 0) >= 0.985 ? 'finished' : p ? 'reading' : m.borrowed ? 'borrowed' : 'want';
      return {
        book_id: id, on_shelf: state.shelf.includes(id), status, progress: p?.pct ?? 0,
        position: p ? { mode: p.mode || (p.page != null && p.ch == null ? 'scan' : 'text'), ch: p.ch ?? null, frac: p.frac ?? null, page: p.page ?? null } : null,
        chapter_title: p?.chTitle || null, first_opened_at: m.first_opened_at || null,
        last_opened_at: m.last_opened_at || null, finished_at: m.finished_at || null,
        updated_at: m.updated_at || now(),
      };
    });
    const ids = new Set([...state.dirty.library, ...state.dirty.highlights.map(h => state.highlights[h]?.book_id), ...state.dirty.bookmarks.map(m => state.bookmarks[m]?.book_id),
      ...state.outbox.sessions.map(s => s.book_id), ...state.outbox.events.map(e => e.book_id)].filter(Boolean));
    const books = [...ids].map(id => state.books[id]).filter(Boolean).map(b => ({
      id: b.id, title: b.title, author: b.author, year: b.year || null, cover: b.cover || null,
      kind: b.kind || 'book', access: b.access || 'public', subjects: (b.subjects || [b.subject || GENRE_SUBJECT[b.genre]].filter(Boolean)).slice(0, 8),
      meta: Object.fromEntries(['gut', 'scan', 'lv', 'coverArt', 'web', 'pdf', 'tone', 'pages', 'genre', 'blurb'].filter(k => b[k] != null).map(k => [k, b[k]])),
    }));
    return {
      books,
      library: lib,
      highlights: state.dirty.highlights.map(id => state.highlights[id]).filter(Boolean),
      bookmarks: state.dirty.bookmarks.map(id => state.bookmarks[id]).filter(Boolean),
      sessions: state.outbox.sessions.map(({ id, ...s }) => s),
      events: state.outbox.events,
    };
  },
  clearSent(sent) {
    const drop = (list, done) => list.filter(x => !done.includes(x));
    state.dirty.library = drop(state.dirty.library, sent.library.map(r => r.book_id));
    state.dirty.highlights = drop(state.dirty.highlights, sent.highlights.map(r => r.id));
    state.dirty.bookmarks = drop(state.dirty.bookmarks, sent.bookmarks.map(r => r.id));
    state.outbox.sessions = state.outbox.sessions.slice(sent.sessions.length);
    state.outbox.events = state.outbox.events.slice(sent.events.length);
    write('dirty', state.dirty); write('outbox', state.outbox);
  },
  markAllDirty() {
    const ids = new Set([...state.shelf, ...Object.keys(state.progress), ...Object.keys(state.libmeta)]);
    ids.forEach(id => { if (!state.libmeta[id]?.updated_at) state.libmeta[id] = { ...(state.libmeta[id] || {}), updated_at: now() }; });
    state.dirty = { library: [...ids], highlights: Object.keys(state.highlights), bookmarks: Object.keys(state.bookmarks) };
    write('libmeta', state.libmeta); write('dirty', state.dirty);
  },
  hasDirty: () => state.dirty.library.length + state.dirty.highlights.length + state.dirty.bookmarks.length + state.outbox.sessions.length + state.outbox.events.length > 0,
  /** Merge rows from the server. Last writer wins by updated_at. */
  applyRemote({ library = [], highlights = [], bookmarks = [], books = [], prefs }) {
    for (const b of books) {
      state.books[b.id] = { ...(state.books[b.id] || {}), ...slim({ ...b, ...(b.meta || {}), subjects: b.subjects }) };
    }
    for (const r of library) {
      const m = state.libmeta[r.book_id] || {};
      if (m.updated_at && m.updated_at > r.updated_at && state.dirty.library.includes(r.book_id)) continue;
      state.libmeta[r.book_id] = { ...m, first_opened_at: r.first_opened_at, last_opened_at: r.last_opened_at, finished_at: r.finished_at, updated_at: r.updated_at, seconds: r.seconds ?? m.seconds, sessions: r.sessions ?? m.sessions, borrowed: r.status === 'borrowed' || m.borrowed };
      const inShelf = state.shelf.includes(r.book_id);
      if (r.on_shelf && !inShelf) state.shelf.push(r.book_id);
      if (!r.on_shelf && inShelf) state.shelf = state.shelf.filter(x => x !== r.book_id);
      if (r.position && (r.progress > 0 || r.status === 'reading' || r.status === 'finished')) {
        const pos = r.position || {};
        state.progress[r.book_id] = { ...(state.progress[r.book_id] || {}), ...pos, pct: r.progress, chTitle: r.chapter_title, t: Date.parse(r.last_opened_at || r.updated_at) || Date.now() };
      }
    }
    for (const h of highlights) {
      const cur = state.highlights[h.id];
      if (!cur || cur.updated_at <= h.updated_at) state.highlights[h.id] = h;
    }
    for (const m of bookmarks) {
      const cur = state.bookmarks[m.id];
      if (!cur || cur.updated_at <= m.updated_at) state.bookmarks[m.id] = m;
    }
    if (prefs && typeof prefs === 'object') Object.assign(state.prefs, prefs);
    ['books', 'libmeta', 'shelf', 'progress', 'highlights', 'bookmarks', 'prefs'].forEach(k => write(k, state[k]));
    emit('remote');
  },
  /** Data that was only on this device, for the "Export" button when signed out. */
  exportLocal: () => ({ exported_at: now(), ...Object.fromEntries(['shelf', 'progress', 'libmeta', 'books', 'prefs', 'highlights', 'bookmarks', 'sessions', 'events', 'interests'].map(k => [k, state[k]])) }),
};
