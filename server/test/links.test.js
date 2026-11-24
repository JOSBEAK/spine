import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, book, olDoc } from './helpers.js';
import { parseCsv, readExport, cleanTitle } from '../src/csv.js';

let h;
before(async () => { h = await setup(); });
after(() => h.close());

// ---------- CSV ----------

test('CSV parser handles quotes, escaped quotes, commas and newlines in fields, CRLF and BOM', () => {
  const text = '﻿a,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\n1,,3\n\n"",last,"="\n';
  assert.deepEqual(parseCsv(text), [
    ['a', 'b', 'c'],
    ['x, y', 'say "hi"', 'line1\nline2'],
    ['1', '', '3'],
    ['', 'last', '='],
  ]);
  assert.deepEqual(parseCsv('no,trailing,newline'), [['no', 'trailing', 'newline']]);
  assert.deepEqual(parseCsv(''), []);
});

const GOODREADS = [
  'Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Average Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies',
  '1885,"Pride and Prejudice",Jane Austen,"Austen, Jane",,"=""0679783261""","=""9780679783268""",5,4.29,Modern Library,Paperback,279,2000,1813,2023/05/14,2023/01/02,,,read,"Loved it, truly.\nSecond line",,,1,0',
  '33,"The Fellowship of the Ring (The Lord of the Rings, #1)",J.R.R. Tolkien,"Tolkien, J.R.R.",,"","",0,4.38,,,,,1954,,2024/01/01,currently-reading,currently-reading (#1),currently-reading,,,,0,0',
  '99,"Some Unknown Book",Nobody Real,"Real, Nobody",,"","",0,0,,,,,,,2024/01/01,to-read,to-read (#2),to-read,,,,0,0',
].join('\n');

const STORYGRAPH = [
  'Title,Authors,Contributors,ISBN/UID,Format,Read Status,Date Added,Last Date Read,Dates Read,Read Count,Moods,Pace,Character- or Plot-Driven?,Strong Character Development?,Loveable Characters?,Diverse Characters?,Flawed Characters?,Star Rating,Review,Content Warnings,Content Warning Description,Tags,Owned?',
  'Frankenstein,"Mary Shelley, Percy Bysshe Shelley",,9780141439471,paperback,read,2024/02/01,2024/03/01,2024/02/01-2024/03/01,1,dark,slow,,,,,,4.5,,,,,No',
  'Dracula,Bram Stoker,,,ebook,to-read,2024/02/01,,,0,,,,,,,,,,,,,No',
  'Middlemarch,George Eliot,,,ebook,did-not-finish,2024/02/01,,,0,,,,,,,,,,,,,No',
].join('\n');

test('reads Goodreads exports', () => {
  const rows = readExport(GOODREADS, 'goodreads');
  assert.deepEqual(rows, [
    { title: 'Pride and Prejudice', author: 'Jane Austen', status: 'finished', finished_at: '2023-05-14T00:00:00.000Z' },
    { title: 'The Fellowship of the Ring (The Lord of the Rings, #1)', author: 'J.R.R. Tolkien', status: 'reading', finished_at: null },
    { title: 'Some Unknown Book', author: 'Nobody Real', status: 'want', finished_at: null },
  ]);
  assert.equal(cleanTitle(rows[1].title), 'The Fellowship of the Ring');
});

test('reads StoryGraph exports', () => {
  const rows = readExport(STORYGRAPH, 'storygraph');
  assert.deepEqual(rows, [
    { title: 'Frankenstein', author: 'Mary Shelley', status: 'finished', finished_at: '2024-03-01T00:00:00.000Z' },
    { title: 'Dracula', author: 'Bram Stoker', status: 'want', finished_at: null },
    { title: 'Middlemarch', author: 'George Eliot', status: 'want', finished_at: null },
  ]);
});

test('a file that is not an export is explained', () => {
  assert.throws(() => readExport('foo,bar\n1,2', 'goodreads'), /doesn't look like a Goodreads export/);
});

// ---------- links ----------

const KNOWN = {
  'Pride and Prejudice|Jane Austen': olDoc(66554, { title: 'Pride and Prejudice', author_name: ['Jane Austen'], subject: ['Love stories'] }),
  'The Fellowship of the Ring|J.R.R. Tolkien': olDoc(27448, { title: 'The Fellowship of the Ring', author_name: ['J.R.R. Tolkien'] }),
  'Frankenstein|Mary Shelley': olDoc(450063, { title: 'Frankenstein', author_name: ['Mary Shelley'] }),
  'Dracula|Bram Stoker': olDoc(81633, { title: 'Dracula', author_name: ['Bram Stoker'] }),
};
const matcher = (url) => {
  assert.equal(url.pathname, '/search.json');
  const doc = KNOWN[`${url.searchParams.get('title')}|${url.searchParams.get('author')}`];
  return { docs: doc ? [doc] : [] };
};

test('Goodreads import matches rows on Open Library and fills the library', async () => {
  const { token } = await h.signup();
  await h.db.query('DELETE FROM ol_cache'); // start cold, even on a reused TEST_DATABASE_URL
  h.ol = matcher;
  h.fetched.length = 0;
  const r = await h.api('POST', '/me/links/goodreads', { token, body: { csv: GOODREADS } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.imported, 2);
  assert.deepEqual(r.body.unmatched, [{ title: 'Some Unknown Book', author: 'Nobody Real' }]);
  assert.equal(r.body.link.provider, 'goodreads');
  assert.equal(r.body.link.status, 'connected');
  assert.equal(r.body.link.username, null);
  assert.ok(r.body.link.last_sync_at);
  assert.equal(h.fetched.length, 3);

  const s = await h.sync(token, {});
  const lib = Object.fromEntries(s.body.library.map((l) => [l.book_id, l]));
  assert.equal(lib.OL66554W.status, 'finished');
  assert.equal(lib.OL66554W.on_shelf, true);
  assert.equal(lib.OL66554W.finished_at, '2023-05-14T00:00:00.000Z');
  assert.equal(lib.OL27448W.status, 'reading');
  assert.equal(s.body.books.find((b) => b.id === 'OL66554W').title, 'Pride and Prejudice');

  // Importing again adds nothing new and uses the cache.
  const again = await h.api('POST', '/me/links/goodreads', { token, body: { csv: GOODREADS } });
  assert.equal(again.body.imported, 0);
  assert.equal(h.fetched.length, 3);

  const links = await h.api('GET', '/me/links', { token });
  assert.deepEqual(links.body.links.map((l) => l.provider), ['goodreads']);
  const interests = await h.api('GET', '/me/interests', { token });
  assert.ok(interests.body.authors.some((a) => a.name === 'Jane Austen'));
});

test("StoryGraph import keeps the reader's own shelf status", async () => {
  const { token } = await h.signup();
  await h.sync(token, {
    books: [book('OL81633W', { title: 'Dracula' })],
    library: [{ book_id: 'OL81633W', on_shelf: true, status: 'finished', updated_at: '2026-05-01T00:00:00Z' }],
  });
  h.ol = matcher;
  const r = await h.api('POST', '/me/links/storygraph', { token, body: { csv: STORYGRAPH } });
  assert.equal(r.status, 200);
  assert.equal(r.body.imported, 1); // Frankenstein; Dracula was already on the shelf
  assert.deepEqual(r.body.unmatched, [{ title: 'Middlemarch', author: 'George Eliot' }]);
  const s = await h.sync(token, {});
  assert.equal(s.body.library.find((l) => l.book_id === 'OL81633W').status, 'finished');
});

test('CSV import errors', async () => {
  const { token } = await h.signup();
  const notCsv = await h.api('POST', '/me/links/goodreads', { token, body: { csv: 'hello' } });
  assert.equal(notCsv.status, 400);
  assert.match(notCsv.body.error, /Goodreads export/);
  const missing = await h.api('POST', '/me/links/storygraph', { token, body: {} });
  assert.equal(missing.status, 400);
  assert.match(missing.body.error, /^csv: /);
  h.ol = () => { throw new TypeError('fetch failed'); };
  const down = await h.api('POST', '/me/links/goodreads', { token, body: { csv: GOODREADS.replace(/Pride and Prejudice/g, 'Pride 2').replace('Fellowship', 'Fellow') } });
  assert.equal(down.status, 502);
  assert.match(down.body.error, /Couldn't reach Open Library/);
});

const logEntry = (n, title) => ({ work: { title, key: `/works/OL${n}W`, author_names: ['Author ' + n], first_publish_year: 1900 + n, cover_id: n } });

test('Open Library reading log import', async () => {
  const { token } = await h.signup();
  h.fetched.length = 0;
  h.ol = (url) => {
    const m = url.pathname.match(/^\/people\/([^/]+)\/books\/(want-to-read|currently-reading|already-read)\.json$/);
    assert.ok(m, url.pathname);
    assert.equal(m[1], 'bookworm');
    const page = Number(url.searchParams.get('page'));
    const shelves = {
      'want-to-read': [[logEntry(1, 'One'), logEntry(2, 'Two')], [logEntry(3, 'Three')]],
      'currently-reading': [[logEntry(4, 'Four')]],
      'already-read': [[logEntry(5, 'Five'), logEntry(1, 'One')]], // also on want-to-read: finished wins
    };
    return { reading_log_entries: shelves[m[2]][page - 1] || [] };
  };
  const r = await h.api('POST', '/me/links/openlibrary', { token, body: { username: 'bookworm' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.imported, { want: 2, reading: 1, finished: 2 });
  assert.equal(r.body.link.provider, 'openlibrary');
  assert.equal(r.body.link.username, 'bookworm');
  const s = await h.sync(token, {});
  const lib = Object.fromEntries(s.body.library.map((l) => [l.book_id, l.status]));
  assert.deepEqual(lib, { OL1W: 'finished', OL2W: 'want', OL3W: 'want', OL4W: 'reading', OL5W: 'finished' });
  const b5 = s.body.books.find((b) => b.id === 'OL5W');
  assert.deepEqual([b5.title, b5.author, b5.year, b5.cover], ['Five', 'Author 5', '1905', 5]);

  const me = await h.api('GET', '/me', { token });
  assert.equal(me.body.linked[0].provider, 'openlibrary');
  assert.equal(me.body.stats.books, 5);
  assert.equal(me.body.stats.finished, 2);

  const hist = await h.api('GET', '/me/history', { token });
  assert.ok(hist.body.items.some((i) => i.kind === 'event' && i.type === 'link' && i.data.provider === 'openlibrary'));
});

test('Open Library: unknown user is 404, private log is 403', async () => {
  const { token } = await h.signup();
  h.ol = () => ({ status: 404, body: { error: 'Not found' } });
  const nf = await h.api('POST', '/me/links/openlibrary', { token, body: { username: 'nobody' } });
  assert.equal(nf.status, 404);
  assert.match(nf.body.error, /no Open Library account called "nobody"/);
  h.ol = () => ({ status: 200, body: { error: 'private' } });
  const priv = await h.api('POST', '/me/links/openlibrary', { token, body: { username: 'shy' } });
  assert.equal(priv.status, 403);
  assert.match(priv.body.error, /is private/);
  const bad = await h.api('POST', '/me/links/openlibrary', { token, body: { username: '../etc' } });
  assert.equal(bad.status, 400);
  const links = await h.api('GET', '/me/links', { token });
  assert.deepEqual(links.body.links, []);
});

test('Internet Archive link and unlinking', async () => {
  const { token } = await h.signup();
  const r = await h.api('POST', '/me/links/archive', { token, body: { username: 'reader@archive' } });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body.link).sort(), ['connected_at', 'last_sync_at', 'meta', 'provider', 'status', 'username']);
  assert.equal(r.body.link.username, 'reader@archive');
  const noName = await h.api('POST', '/me/links/archive', { token });
  assert.equal(noName.body.link.username, null);
  assert.equal((await h.api('DELETE', '/me/links/archive', { token })).status, 204);
  assert.deepEqual((await h.api('GET', '/me/links', { token })).body.links, []);
  const unknown = await h.api('DELETE', '/me/links/myspace', { token });
  assert.equal(unknown.status, 404);
});
