import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, book, DAY } from './helpers.js';

let h;
before(async () => { h = await setup(); });
after(() => h.close());

const uuid = () => crypto.randomUUID();

test('push everything, then pull with since', async () => {
  const { token } = await h.signup();
  const hl = uuid();
  const bm = uuid();
  const first = await h.sync(token, {
    since: 0,
    books: [book('OL45804W', { title: 'Pride and Prejudice' }), book('OX-biology-2e', { kind: 'textbook', cover: null, subjects: ['Science'] })],
    library: [
      { book_id: 'OL45804W', on_shelf: true, status: 'reading', progress: 0.31, position: { ch: 12, frac: 0.4 }, chapter_title: 'Chapter 12',
        first_opened_at: '2026-05-01T10:00:00Z', last_opened_at: '2026-05-30T10:00:00Z', finished_at: null, updated_at: '2026-05-30T10:00:00Z',
        seconds: 999999, sessions: 999 }, // client values are ignored
      { book_id: 'OX-biology-2e', on_shelf: true, status: 'want', updated_at: '2026-05-30T10:00:00Z' },
    ],
    highlights: [{ id: hl, book_id: 'OL45804W', locator: { ch: 1, sp: 0, so: 3, ep: 0, eo: 20 }, text: 'It is a truth', color: 'yellow', note: '', deleted: false, updated_at: '2026-05-30T10:00:00Z' }],
    bookmarks: [{ id: bm, book_id: 'OL45804W', locator: { ch: 2 }, label: 'Ball', deleted: false, updated_at: '2026-05-30T10:00:00Z' }],
    sessions: [{ book_id: 'OL45804W', mode: 'text', started_at: '2026-05-30T09:00:00Z', ended_at: '2026-05-30T09:30:00Z', seconds: 1800, from_progress: 0.3, to_progress: 0.31, pages: 12 }],
    events: [{ type: 'view', book_id: 'OL45804W', at: '2026-05-30T08:59:00Z', data: { from: 'home' } }],
    prefs: { fs: 18 },
  });
  assert.equal(first.status, 200);
  const b = first.body;
  assert.deepEqual(Object.keys(b).sort(), ['bookmarks', 'books', 'highlights', 'library', 'prefs', 'rev']);
  assert.equal(b.library.length, 2);
  const pp = b.library.find((r) => r.book_id === 'OL45804W');
  assert.equal(pp.updated_at, '2026-05-30T10:00:00.000Z');
  assert.equal(pp.seconds, 1800);
  assert.equal(pp.sessions, 1);
  assert.equal(pp.progress, 0.31);
  assert.deepEqual(pp.position, { ch: 12, frac: 0.4 });
  assert.equal(b.highlights[0].id, hl);
  assert.equal(b.bookmarks[0].label, 'Ball');
  assert.deepEqual(b.books.map((x) => x.id).sort(), ['OL45804W', 'OX-biology-2e']);
  assert.equal(b.books.find((x) => x.id === 'OX-biology-2e').kind, 'textbook');
  assert.deepEqual(b.prefs, { fs: 18 });
  assert.ok(b.rev > 0);

  // Nothing changed since: empty pull with the same rev.
  const again = await h.sync(token, { since: b.rev });
  assert.equal(again.body.rev, b.rev);
  assert.deepEqual([again.body.library, again.body.highlights, again.body.bookmarks, again.body.books], [[], [], [], []]);
  assert.deepEqual(again.body.prefs, { fs: 18 });

  // Another device changes one row; a pull since the old rev gets just that row and its book.
  const later = await h.sync(token, { since: b.rev, library: [{ book_id: 'OX-biology-2e', on_shelf: true, status: 'reading', progress: 0.1, updated_at: '2026-05-31T10:00:00Z' }] });
  assert.equal(later.body.library.length, 1);
  assert.equal(later.body.library[0].book_id, 'OX-biology-2e');
  assert.deepEqual(later.body.books.map((x) => x.id), ['OX-biology-2e']);
  assert.ok(later.body.rev > b.rev);

  // A fresh device (since 0) gets the full state.
  const fresh = await h.sync(token, {});
  assert.equal(fresh.body.library.length, 2);
  assert.equal(fresh.body.highlights.length, 1);
  assert.equal(fresh.body.bookmarks.length, 1);
});

test('last writer wins per row, by updated_at', async () => {
  const { token } = await h.signup();
  await h.sync(token, { books: [book('OL1W')], library: [{ book_id: 'OL1W', on_shelf: true, status: 'reading', progress: 0.5, updated_at: '2026-05-30T12:00:00Z' }] });
  const stale = await h.sync(token, { library: [{ book_id: 'OL1W', on_shelf: true, status: 'want', progress: 0.1, updated_at: '2026-05-30T11:00:00Z' }] });
  assert.equal(stale.body.library[0].status, 'reading');
  assert.equal(stale.body.library[0].progress, 0.5);
  const newer = await h.sync(token, { library: [{ book_id: 'OL1W', on_shelf: true, status: 'finished', progress: 1, finished_at: '2026-05-30T13:00:00Z', updated_at: '2026-05-30T13:00:00Z' }] });
  assert.equal(newer.body.library[0].status, 'finished');

  const id = uuid();
  await h.sync(token, { highlights: [{ id, book_id: 'OL1W', text: 'new', updated_at: '2026-05-30T12:00:00Z' }] });
  const r = await h.sync(token, { highlights: [{ id, book_id: 'OL1W', text: 'old', updated_at: '2026-05-29T12:00:00Z' }] });
  assert.equal(r.body.highlights[0].text, 'new');

  // Duplicates inside one push: the latest wins.
  const d = await h.sync(token, { highlights: [
    { id, book_id: 'OL1W', text: 'v2', updated_at: '2026-05-30T14:00:00Z' },
    { id, book_id: 'OL1W', text: 'v3', updated_at: '2026-05-30T15:00:00Z' },
  ] });
  assert.equal(d.body.highlights[0].text, 'v3');
});

test('a stale push does not bump rev', async () => {
  const { token } = await h.signup();
  const a = await h.sync(token, { books: [book('OL2W')], library: [{ book_id: 'OL2W', on_shelf: true, status: 'want', updated_at: '2026-05-30T12:00:00Z' }] });
  const b = await h.sync(token, { since: a.body.rev, library: [{ book_id: 'OL2W', on_shelf: false, status: 'want', updated_at: '2026-05-30T11:00:00Z' }] });
  assert.equal(b.body.library.length, 0);
  assert.equal(b.body.rev, a.body.rev);
});

test('tombstones sync and drop the text', async () => {
  const { token } = await h.signup();
  const hl = uuid();
  const bm = uuid();
  const a = await h.sync(token, {
    books: [book('OL3W')],
    highlights: [{ id: hl, book_id: 'OL3W', text: 'secret thought', note: 'mine', updated_at: '2026-05-30T12:00:00Z' }],
    bookmarks: [{ id: bm, book_id: 'OL3W', label: 'here', updated_at: '2026-05-30T12:00:00Z' }],
  });
  const del = await h.sync(token, {
    since: a.body.rev,
    highlights: [{ id: hl, book_id: 'OL3W', deleted: true, updated_at: '2026-05-30T13:00:00Z' }],
    bookmarks: [{ id: bm, book_id: 'OL3W', deleted: true, updated_at: '2026-05-30T13:00:00Z' }],
  });
  assert.equal(del.body.highlights.length, 1);
  assert.equal(del.body.highlights[0].deleted, true);
  assert.equal(del.body.highlights[0].text, '');
  assert.equal(del.body.highlights[0].note, '');
  assert.equal(del.body.bookmarks[0].deleted, true);
  // Another device that synced before the delete learns about it.
  const other = await h.sync(token, { since: a.body.rev });
  assert.equal(other.body.highlights[0].deleted, true);
  // Tombstones don't count.
  const me = await h.api('GET', '/me', { token });
  assert.equal(me.body.stats.highlights, 0);
  assert.equal(me.body.stats.bookmarks, 0);
});

test('seconds and sessions are maintained by the server from sittings', async () => {
  const { token, user } = await h.signup();
  const s1 = { book_id: 'OL4W', mode: 'text', started_at: '2026-05-30T09:00:00Z', ended_at: '2026-05-30T09:10:00Z', seconds: 600 };
  const a = await h.sync(token, { books: [book('OL4W')], sessions: [s1] });
  // A sitting for a book with no library row creates one the client's own row will override.
  assert.equal(a.body.library[0].seconds, 600);
  assert.equal(a.body.library[0].sessions, 1);
  assert.equal(a.body.library[0].on_shelf, false);
  assert.equal(a.body.library[0].updated_at, '1970-01-01T00:00:00.000Z');

  // Resending the same sitting (lost response) doesn't double count; a longer version updates it.
  await h.sync(token, { sessions: [s1] });
  const b = await h.sync(token, { sessions: [{ ...s1, ended_at: '2026-05-30T09:15:00Z', seconds: 900 }] });
  assert.equal(b.body.library[0].seconds, 900);
  assert.equal(b.body.library[0].sessions, 1);

  const c = await h.sync(token, {
    library: [{ book_id: 'OL4W', on_shelf: true, status: 'reading', progress: 0.2, updated_at: '2026-05-30T10:00:00Z', seconds: 5 }],
    sessions: [
      { book_id: 'OL4W', mode: 'audio', started_at: '2026-05-31T09:00:00Z', seconds: 300 },
      { book_id: 'OL4W', mode: 'scan', started_at: '2026-06-01T09:00:00Z', seconds: 120, pages: 4 },
    ],
  });
  const row = c.body.library[0];
  assert.equal(row.seconds, 1320);
  assert.equal(row.sessions, 3);
  assert.equal(row.on_shelf, true);
  assert.equal(row.updated_at, '2026-05-30T10:00:00.000Z');

  const { rows } = await h.db.query('SELECT count(*) AS n FROM reading_sessions WHERE user_id = $1 AND book_id = $2', [user.id, 'OL4W']);
  assert.equal(rows[0].n, 3);
});

test('more than 500 items in an array is a 413', async () => {
  const { token } = await h.signup();
  const events = Array.from({ length: 501 }, (_, i) => ({ type: 'search', at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString() }));
  const r = await h.sync(token, { events });
  assert.equal(r.status, 413);
  assert.match(r.body.error, /at most 500/);
  const ok = await h.sync(token, { events: events.slice(0, 500) });
  assert.equal(ok.status, 200);
});

test('bad items are rejected with the field named', async () => {
  const { token } = await h.signup();
  const r = await h.sync(token, { highlights: [{ id: 'not-a-uuid', book_id: 'OL1W' }] });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /^highlights\.0\.id: /);
  const s = await h.sync(token, { sessions: [{ book_id: 'OL1W', mode: 'telepathy', started_at: '2026-01-01T00:00:00Z', seconds: 1 }] });
  assert.equal(s.status, 400);
  assert.match(s.body.error, /^sessions\.0\.mode/);
});

test("a user can't overwrite another user's highlight by reusing its id", async () => {
  const alice = await h.signup();
  const mallory = await h.signup();
  const id = uuid();
  await h.sync(alice.token, { books: [book('OL5W')], highlights: [{ id, book_id: 'OL5W', text: 'alice', updated_at: '2026-05-30T12:00:00Z' }] });
  const m = await h.sync(mallory.token, { highlights: [{ id, book_id: 'OL5W', text: 'pwned', updated_at: '2030-01-01T00:00:00Z' }] });
  assert.equal(m.status, 200);
  assert.equal(m.body.highlights.length, 0);
  const a = await h.sync(alice.token, {});
  assert.equal(a.body.highlights[0].text, 'alice');
});

test('the shared catalogue keeps one row per book and merges sparse updates', async () => {
  const a = await h.signup();
  const b = await h.signup();
  await h.sync(a.token, { books: [book('OL6W', { title: 'Emma', meta: { gut: 'emma00158gut' } })], library: [{ book_id: 'OL6W', on_shelf: true, status: 'want' }] });
  await h.sync(b.token, { books: [{ id: 'OL6W', title: '', meta: { lv: 'emma_librivox' } }], library: [{ book_id: 'OL6W', on_shelf: true, status: 'want' }] });
  const { rows } = await h.db.query('SELECT title, meta FROM books WHERE id = $1', ['OL6W']);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Emma');
  assert.deepEqual(rows[0].meta, { gut: 'emma00158gut', lv: 'emma_librivox' });
  // Library rows referencing an unknown book get a stub book.
  const r = await h.sync(a.token, { library: [{ book_id: 'OL7W', on_shelf: true, status: 'want' }] });
  assert.equal(r.status, 200);
  assert.ok(r.body.books.find((x) => x.id === 'OL7W'));
});

test('history merges sessions and events newest first, with books attached', async () => {
  const { token } = await h.signup();
  await h.sync(token, {
    books: [book('OL10W'), book('OL11W')],
    sessions: [
      { book_id: 'OL10W', mode: 'text', started_at: '2026-05-01T10:00:00Z', seconds: 600 },
      { book_id: 'OL11W', mode: 'audio', started_at: '2026-05-03T10:00:00Z', seconds: 900 },
    ],
    events: [
      { type: 'view', book_id: 'OL10W', at: '2026-05-02T10:00:00Z' },
      { type: 'search', at: '2026-05-04T10:00:00Z', data: { q: 'austen' } },
    ],
  });
  const r = await h.api('GET', '/me/history?limit=50', { token });
  assert.equal(r.status, 200);
  const items = r.body.items;
  assert.deepEqual(items.map((i) => [i.kind, i.at]), [
    ['event', '2026-05-04T10:00:00.000Z'],
    ['session', '2026-05-03T10:00:00.000Z'],
    ['event', '2026-05-02T10:00:00.000Z'],
    ['session', '2026-05-01T10:00:00.000Z'],
  ]);
  assert.equal(items[0].type, 'search');
  assert.equal(items[0].book, null);
  assert.deepEqual(items[0].data, { q: 'austen' });
  assert.equal(items[1].book.id, 'OL11W');
  assert.equal(items[1].mode, 'audio');
  assert.equal(items[1].seconds, 900);
  assert.equal(items[2].book.id, 'OL10W');

  const page = await h.api('GET', '/me/history?limit=2&before=2026-05-03T10:00:00Z', { token });
  assert.deepEqual(page.body.items.map((i) => i.at), ['2026-05-02T10:00:00.000Z', '2026-05-01T10:00:00.000Z']);
  const bad = await h.api('GET', '/me/history?before=yesterday', { token });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /^before: /);
});

test('events older than 180 days are pruned', async () => {
  const { token, user } = await h.signup();
  const old = new Date(+h.now() - 200 * DAY).toISOString();
  await h.sync(token, { events: [{ type: 'search', at: old }, { type: 'search' }] });
  const { rows } = await h.db.query('SELECT count(*) AS n FROM events WHERE user_id = $1', [user.id]);
  assert.equal(rows[0].n, 1);
});

test('book activity summarises one book', async () => {
  const { token } = await h.signup();
  const sessions = Array.from({ length: 12 }, (_, i) => ({
    book_id: 'OL20W', mode: 'text', started_at: new Date(Date.UTC(2026, 4, 1 + i, 10)).toISOString(), seconds: 60,
  }));
  await h.sync(token, {
    books: [book('OL20W')],
    library: [{ book_id: 'OL20W', on_shelf: true, status: 'reading', progress: 0.4, updated_at: '2026-05-20T00:00:00Z' }],
    sessions,
    highlights: [
      { id: uuid(), book_id: 'OL20W', text: 'a' },
      { id: uuid(), book_id: 'OL20W', text: 'b', deleted: true },
    ],
    bookmarks: [{ id: uuid(), book_id: 'OL20W', label: 'x' }],
  });
  const r = await h.api('GET', '/me/books/OL20W/activity', { token });
  assert.equal(r.status, 200);
  assert.equal(r.body.library.status, 'reading');
  assert.equal(r.body.library.seconds, 720);
  assert.equal(r.body.sessions.count, 12);
  assert.equal(r.body.sessions.seconds, 720);
  assert.equal(r.body.sessions.first_at, '2026-05-01T10:00:00.000Z');
  assert.equal(r.body.sessions.last_at, '2026-05-12T10:01:00.000Z');
  assert.equal(r.body.sessions.recent.length, 10);
  assert.equal(r.body.sessions.recent[0].started_at, '2026-05-12T10:00:00.000Z');
  assert.equal(r.body.highlights, 1);
  assert.equal(r.body.bookmarks, 1);

  const none = await h.api('GET', '/me/books/OL99999W/activity', { token });
  assert.equal(none.status, 200);
  assert.equal(none.body.library, null);
  assert.deepEqual(none.body.sessions, { count: 0, seconds: 0, first_at: null, last_at: null, recent: [] });
});
