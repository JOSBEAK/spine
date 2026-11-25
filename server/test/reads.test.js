import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, book, olDoc, T0 } from './helpers.js';

let h;
before(async () => { h = await setup(); });
after(() => h.close());

const device = () => crypto.randomUUID();
const read = (b, reader, token) => h.api('POST', '/reads', { token, body: { book: b, reader } });

test('a reader is counted once per book per month', async () => {
  h.set(T0);
  const me = device();
  assert.equal((await read(book('OL7001W'), me)).body.counted, true);
  assert.equal((await read(book('OL7001W'), me)).body.counted, false);
  assert.equal((await read(book('OL7001W'), device())).body.counted, true);
  const s = await h.api('GET', '/stats/books/OL7001W');
  assert.equal(s.status, 200);
  assert.deepEqual([s.body.month, s.body.all_time, s.body.period], [2, 2, '2026-06']);

  // a new month counts the same reader again; the old month stays in the total
  h.set('2026-07-03T09:00:00Z');
  assert.equal((await read(book('OL7001W'), me)).body.counted, true);
  const s2 = await h.api('GET', '/stats/books/OL7001W');
  assert.deepEqual([s2.body.month, s2.body.all_time], [1, 3]);
  h.set(T0);
});

test('signed-in readers are counted by account, whatever browser id they send', async () => {
  h.set(T0);
  const { token } = await h.signup();
  assert.equal((await read(book('OL7002W'), device(), token)).body.counted, true);
  assert.equal((await read(book('OL7002W'), device(), token)).body.counted, false);
  assert.equal((await read(book('OL7002W'), undefined, token)).body.counted, false);
  assert.equal((await h.api('GET', '/stats/books/OL7002W')).body.month, 1);
});

test('without an account or a browser id there is nothing to count', async () => {
  const r = await read(book('OL7003W'));
  assert.equal(r.status, 400);
  assert.match(r.body.error, /reader/);
  assert.equal((await read(book('OL7003W'), 'not-a-uuid')).status, 400);
});

test('the top list ranks by readers, and anonymous titles come from Open Library, not the request', async () => {
  h.set('2026-09-10T12:00:00Z');
  h.ol = (u) => (u.pathname === '/search.json' && /OL8001W/.test(u.searchParams.get('q')) ? { docs: [olDoc(8001, { title: 'The Real Title' })] } : { docs: [] });
  for (let i = 0; i < 3; i++) await read(book('OL8001W', { title: 'Totally Fake Title' }), device());
  await read(book('OL8002W', { title: 'Also Fake' }), device());
  const top = await h.api('GET', '/stats/top?limit=5');
  assert.equal(top.status, 200);
  assert.equal(top.body.month, '2026-09');
  assert.deepEqual(top.body.books.map((x) => [x.book.id, x.readers]), [['OL8001W', 3], ['OL8002W', 1]]);
  assert.equal(top.body.books[0].book.title, 'The Real Title');
  assert.equal(top.body.books[1].book.title, ''); // unknown to Open Library: no made-up title
  assert.match(top.headers.get('cache-control'), /max-age=60/);

  const all = await h.api('GET', '/stats/top?period=all&limit=50');
  assert.ok(all.body.books.some((x) => x.book.id === 'OL7001W' && x.readers === 3));
  assert.equal((await h.api('GET', '/stats/top?period=year')).status, 400);
  h.ol = () => ({ docs: [] });
  h.set(T0);
});

test('deleting an account removes which books it opened but keeps the totals', async () => {
  h.set(T0);
  const { token, user } = await h.signup({ password: 'correct horse' });
  await read(book('OL7004W'), undefined, token);
  const del = await h.api('DELETE', '/me', { token, body: { password: 'correct horse' } });
  assert.equal(del.status, 204);
  const { rows } = await h.db.query('SELECT count(*)::int AS n FROM monthly_readers WHERE reader = $1', [user.id]);
  assert.equal(rows[0].n, 0);
  assert.equal((await h.api('GET', '/stats/books/OL7004W')).body.month, 1);
});

test('personal responses still are never cached', async () => {
  const { token } = await h.signup();
  const r = await h.api('GET', '/me', { token });
  assert.equal(r.headers.get('cache-control'), 'no-store');
});
