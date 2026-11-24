import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, book, olDoc, DAY } from './helpers.js';
import { sessionWeight, decayed, EVENT_WEIGHTS } from '../src/interests.js';
import { interestKeys, normSubject } from '../src/books.js';
import { docToBook } from '../src/openlibrary.js';

let h;
before(async () => { h = await setup(); });
after(() => h.close());

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, `${msg ?? ''} expected ${b}, got ${a}`);
const score = (list, name) => list.find((x) => x.name === name)?.score;

/** Moves the clock forward while keeping the session alive (sessions expire after 60 idle days). */
async function wait(token, days) {
  for (let left = days; left > 0; left -= 30) {
    h.advance(Math.min(30, left) * DAY);
    assert.equal((await h.api('GET', '/me', { token })).status, 200);
  }
}

test('weights and decay formula', () => {
  assert.deepEqual(EVENT_WEIGHTS, { view: 0.5, shelf_add: 2, borrow_open: 1.5, listen: 1.5, finish: 5, highlight: 0.5 });
  assert.equal(sessionWeight(15 * 60), 1.5);
  assert.equal(sessionWeight(40 * 60), 4);
  assert.equal(sessionWeight(3 * 3600), 4);
  assert.equal(decayed(8, 60), 4);
  assert.equal(decayed(8, 120), 2);
  close(decayed(10, 30), 7.0711);
});

test('subjects are normalised and generic tags skipped; first 5 plus the author', () => {
  assert.equal(normSubject('  Accessible book '), null);
  assert.equal(normSubject('Protected DAISY'), null);
  assert.equal(normSubject('nyt:combined-print-and-e-book-fiction=2010-01-01'), null);
  assert.equal(normSubject('  Science   fiction '), 'Science fiction');
  assert.equal(normSubject('x'.repeat(80)).length, 60);
  const keys = interestKeys({
    author: 'Jules Verne',
    subjects: ['Fiction', 'Accessible book', 'Sea stories', 'Submarines', 'Adventure', 'Sea stories', 'Ocean', 'Science fiction', 'Extra'],
  });
  assert.deepEqual(keys, ['subject:Sea stories', 'subject:Submarines', 'subject:Adventure', 'subject:Ocean', 'subject:Science fiction', 'author:Jules Verne']);
});

test('signals add up and decay with a 60-day half-life', async () => {
  const { token } = await h.signup();
  const subjects = ['Fiction', 'Love stories', 'Courtship', 'England'];
  await h.sync(token, {
    books: [book('OL100W', { subjects, author: 'Jane Austen' })],
    events: [
      { type: 'shelf_add', book_id: 'OL100W', at: h.now().toISOString() },
      { type: 'search', at: h.now().toISOString(), data: { q: 'austen' } }, // no weight
    ],
  });
  let r = await h.api('GET', '/me/interests', { token });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.subjects.map((s) => s.name).sort(), ['Courtship', 'England', 'Love stories']);
  close(score(r.body.subjects, 'England'), 2);
  close(score(r.body.authors, 'Jane Austen'), 2);

  // 60 days later the score has halved.
  await wait(token, 60);
  r = await h.api('GET', '/me/interests', { token });
  close(score(r.body.subjects, 'England'), 1);

  // A finish now: 2 * 0.5 + 5 = 6. Then 30 days later: 6 * 0.5^(30/60).
  await h.sync(token, { events: [{ type: 'finish', book_id: 'OL100W', at: h.now().toISOString() }] });
  r = await h.api('GET', '/me/interests', { token });
  close(score(r.body.subjects, 'England'), 6);
  await wait(token, 30);
  r = await h.api('GET', '/me/interests', { token });
  close(score(r.body.subjects, 'England'), 6 * Math.SQRT1_2);

  // A 25-minute session adds 2.5; resending it adds nothing; extending it to 60 min adds 1.5 more (cap 4).
  const s = { book_id: 'OL100W', mode: 'text', started_at: h.now().toISOString(), seconds: 25 * 60 };
  const base = 6 * Math.SQRT1_2;
  await h.sync(token, { sessions: [s] });
  r = await h.api('GET', '/me/interests', { token });
  close(score(r.body.authors, 'Jane Austen'), base + 2.5);
  await h.sync(token, { sessions: [s] });
  r = await h.api('GET', '/me/interests', { token });
  close(score(r.body.authors, 'Jane Austen'), base + 2.5);
  await h.sync(token, { sessions: [{ ...s, seconds: 60 * 60 }] });
  r = await h.api('GET', '/me/interests', { token });
  close(score(r.body.authors, 'Jane Austen'), base + 4);

  const lim = await h.api('GET', '/me/interests?limit=1', { token });
  assert.equal(lim.body.subjects.length, 1);
});

test('interests are ranked by decayed score', async () => {
  const { token } = await h.signup();
  await h.sync(token, {
    books: [book('OL101W', { subjects: ['Old love'], author: 'A' }), book('OL102W', { subjects: ['New love'], author: 'B' })],
    events: [{ type: 'finish', book_id: 'OL101W', at: h.now().toISOString() }],
  });
  await wait(token, 180); // 5 -> 0.625
  await h.sync(token, { events: [{ type: 'shelf_add', book_id: 'OL102W', at: h.now().toISOString() }] });
  const r = await h.api('GET', '/me/interests', { token });
  assert.deepEqual(r.body.subjects.map((s) => s.name), ['New love', 'Old love']);
  close(r.body.subjects[1].score, 0.625);
});

test('Open Library docs map to the books row shape', () => {
  const b = docToBook(olDoc(7, { subject: Array.from({ length: 12 }, (_, i) => `S${i}`), ebook_access: 'public' }));
  assert.deepEqual(b, {
    id: 'OL7W', title: 'Book 7', author: 'Some Author', year: '1900', cover: 7, kind: 'book', access: 'public',
    subjects: ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'], meta: { pages: 200, scan: 'ia7' },
  });
});

test('recommendations: rows from taste, library excluded, cached for 12 hours', async () => {
  const { token } = await h.signup();
  await h.db.query('DELETE FROM ol_cache'); // start cold, even on a reused TEST_DATABASE_URL
  const empty = await h.api('GET', '/me/recommendations', { token });
  assert.deepEqual(empty.body, { rows: [] });

  await h.sync(token, {
    books: [book('OL200W', { title: 'Twenty Thousand Leagues', author: 'Jules Verne', subjects: ['Fiction', 'Sea stories', 'Submarines'] })],
    library: [{ book_id: 'OL200W', on_shelf: true, status: 'finished', finished_at: h.now().toISOString(), updated_at: h.now().toISOString() }],
    events: [{ type: 'finish', book_id: 'OL200W', at: h.now().toISOString() }],
  });

  h.ol = (url) => {
    const q = url.searchParams.get('q');
    assert.match(q, /ebook_access:\[borrowable TO \*\]/);
    assert.equal(url.searchParams.get('sort'), 'readinglog');
    assert.equal(url.searchParams.get('limit'), '20');
    // Each query returns the user's own book plus some others; overlap between rows too.
    const seed = q.includes('Sea stories') ? 300 : q.includes('Submarines') ? 400 : 500;
    return { docs: [olDoc(200), ...Array.from({ length: 6 }, (_, i) => olDoc(seed + i)), olDoc(300)] };
  };
  h.fetched.length = 0;
  const r = await h.api('GET', '/me/recommendations', { token });
  assert.equal(r.status, 200);
  const titles = r.body.rows.map((x) => x.title);
  assert.equal(titles[0], 'Because you read Twenty Thousand Leagues');
  assert.ok(titles.includes('More Submarines'));
  assert.ok(titles.includes('More by Jules Verne'));
  assert.ok(!titles.includes('More Sea stories')); // already used by "Because you read"
  assert.ok(r.body.rows.length <= 6);
  for (const row of r.body.rows) {
    assert.ok(row.reason);
    assert.ok(row.books.length >= 3);
    assert.ok(!row.books.some((b) => b.id === 'OL200W'), 'library books are excluded');
  }
  const all = r.body.rows.flatMap((x) => x.books.map((b) => b.id));
  assert.equal(new Set(all).size, all.length, 'no book appears twice');
  assert.deepEqual(Object.keys(r.body.rows[0].books[0]).sort(), ['access', 'author', 'cover', 'id', 'kind', 'meta', 'subjects', 'title', 'year']);

  // Every request carried the Spine User-Agent.
  assert.ok(h.fetched.length > 0);
  for (const f of h.fetched) assert.match(f.headers['User-Agent'], /^Spine\/1\.0 \(\+https:\/\/josbeak\.github\.io\/spine\/\)$/);

  // Cached: no new fetches within 12 h, fresh fetches after.
  const n = h.fetched.length;
  h.advance(11 * 3600 * 1000);
  await h.api('GET', '/me/recommendations', { token });
  assert.equal(h.fetched.length, n);
  h.advance(2 * 3600 * 1000);
  await h.api('GET', '/me/recommendations', { token });
  assert.equal(h.fetched.length, 2 * n);
});

test('recommendations report Open Library outages plainly', async () => {
  const { token } = await h.signup();
  await h.sync(token, {
    books: [book('OL210W', { subjects: ['Unusual subject 210'], author: 'Writer 210' })],
    events: [{ type: 'shelf_add', book_id: 'OL210W', at: h.now().toISOString() }],
  });
  h.ol = () => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }); };
  const r = await h.api('GET', '/me/recommendations', { token });
  assert.equal(r.status, 504);
  assert.match(r.body.error, /Open Library didn't answer within 15 seconds/);
  h.ol = () => ({ status: 500, body: { oops: true } });
  const r2 = await h.api('GET', '/me/recommendations', { token });
  assert.equal(r2.status, 502);
});
