import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, uniqueEmail, book, DAY } from './helpers.js';
import { hashPassword, verifyPassword } from '../src/auth.js';

let h;
before(async () => { h = await setup(); });
after(() => h.close());

test('health reports the database', async () => {
  const r = await h.api('GET', '/health');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, db: h.db.kind });
});

test('password hashes use scrypt N=2^15 and verify in constant time', async () => {
  const stored = await hashPassword('hunter22hunter');
  assert.match(stored, /^scrypt\$32768\$8\$1\$/);
  assert.equal(await verifyPassword('hunter22hunter', stored), true);
  assert.equal(await verifyPassword('hunter22hunteR', stored), false);
  assert.equal(await verifyPassword('x', 'garbage'), false);
});

test('signup, me, login, logout', async () => {
  const email = uniqueEmail();
  const s = await h.api('POST', '/auth/signup', { body: { email: `  ${email.toUpperCase()} `, password: 'longenough', name: 'Ada' } });
  assert.equal(s.status, 201);
  assert.ok(s.body.token.length >= 40);
  assert.deepEqual(Object.keys(s.body.user).sort(), ['created_at', 'email', 'id', 'name', 'prefs']);
  assert.equal(s.body.user.email, email);
  assert.equal(s.body.user.name, 'Ada');

  // Only the hash of the token is stored.
  const { rows } = await h.db.query('SELECT encode(token_hash, $1) AS h FROM sessions WHERE user_id = $2', ['hex', s.body.user.id]);
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].h, s.body.token);
  assert.equal(rows[0].h.length, 64);

  const me = await h.api('GET', '/me', { token: s.body.token });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.id, s.body.user.id);
  assert.deepEqual(me.body.linked, []);
  assert.deepEqual(me.body.stats, { books: 0, finished: 0, seconds: 0, highlights: 0, bookmarks: 0 });

  const dup = await h.api('POST', '/auth/signup', { body: { email, password: 'longenough' } });
  assert.equal(dup.status, 409);
  assert.match(dup.body.error, /already exists/);

  const login = await h.api('POST', '/auth/login', { body: { email: email.toUpperCase(), password: 'longenough' } });
  assert.equal(login.status, 200);
  assert.notEqual(login.body.token, s.body.token);
  assert.equal(login.body.user.email, email);

  const out = await h.api('POST', '/auth/logout', { token: login.body.token });
  assert.equal(out.status, 204);
  const after = await h.api('GET', '/me', { token: login.body.token });
  assert.equal(after.status, 401);
  assert.ok(after.body.error);
  // The other session still works.
  assert.equal((await h.api('GET', '/me', { token: s.body.token })).status, 200);
});

test('signup validation errors are plain sentences', async () => {
  const short = await h.api('POST', '/auth/signup', { body: { email: uniqueEmail(), password: 'short' } });
  assert.equal(short.status, 400);
  assert.equal(short.body.error, 'password: Use a password with at least 8 characters.');
  const bad = await h.api('POST', '/auth/signup', { body: { email: 'not-an-email', password: 'longenough' } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /^email: Enter a valid email address/);
  const junk = await h.api('POST', '/auth/signup', { raw: '{nope', headers: { 'content-type': 'application/json' } });
  assert.equal(junk.status, 400);
  assert.match(junk.body.error, /not valid JSON/);
  const noAuth = await h.api('GET', '/me');
  assert.equal(noAuth.status, 401);
  const missing = await h.api('GET', '/nope');
  assert.equal(missing.status, 404);
  assert.match(missing.body.error, /GET \/nope/);
});

test('wrong password gives 401, then 429 after 8 failures in 15 minutes', async () => {
  const { email } = await h.signup({ password: 'right password' });
  const headers = { 'x-forwarded-for': '203.0.113.9' };
  for (let i = 0; i < 8; i++) {
    const r = await h.api('POST', '/auth/login', { body: { email, password: 'wrong password' }, headers });
    assert.equal(r.status, 401, `attempt ${i + 1}`);
    assert.equal(r.body.error, "That email and password don't match. Check them and try again.");
  }
  const blocked = await h.api('POST', '/auth/login', { body: { email, password: 'right password' }, headers });
  assert.equal(blocked.status, 429);
  assert.match(blocked.body.error, /Too many wrong passwords\. Please wait 15 minutes/);
  assert.equal(blocked.headers.get('retry-after'), '900');

  // A different IP is not blocked for this email.
  const other = await h.api('POST', '/auth/login', { body: { email, password: 'right password' }, headers: { 'x-forwarded-for': '198.51.100.7' } });
  assert.equal(other.status, 200);

  // After the window the original IP may try again, and success clears the counter.
  h.advance(15 * 60 * 1000 + 1000);
  const ok = await h.api('POST', '/auth/login', { body: { email, password: 'right password' }, headers });
  assert.equal(ok.status, 200);
  const { rows } = await h.db.query('SELECT count(*) AS n FROM login_attempts WHERE key = $1', [`203.0.113.9|${email}`]);
  assert.equal(rows[0].n, 0);
});

test('unknown email is a 401 too', async () => {
  const r = await h.api('POST', '/auth/login', { body: { email: uniqueEmail('ghost'), password: 'whatever1' } });
  assert.equal(r.status, 401);
});

test('sessions expire after 60 days without use and slide when used', async () => {
  const { token } = await h.signup();
  h.advance(59 * DAY);
  assert.equal((await h.api('GET', '/me', { token })).status, 200); // slides expiry forward
  h.advance(59 * DAY);
  assert.equal((await h.api('GET', '/me', { token })).status, 200);
  h.advance(61 * DAY);
  assert.equal((await h.api('GET', '/me', { token })).status, 401);
});

test('PATCH /me merges prefs and renames', async () => {
  const { token } = await h.signup();
  await h.api('PATCH', '/me', { token, body: { prefs: { fs: 18, theme: 'paper' } } });
  const r = await h.api('PATCH', '/me', { token, body: { name: 'Grace', prefs: { fs: 20 } } });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.name, 'Grace');
  assert.deepEqual(r.body.user.prefs, { fs: 20, theme: 'paper' });
});

test('changing the password signs out other sessions', async () => {
  const { email, token } = await h.signup({ password: 'first password' });
  const other = (await h.api('POST', '/auth/login', { body: { email, password: 'first password' } })).body.token;
  const wrong = await h.api('POST', '/me/password', { token, body: { current: 'nope nope', next: 'second password' } });
  assert.equal(wrong.status, 401);
  const r = await h.api('POST', '/me/password', { token, body: { current: 'first password', next: 'second password' } });
  assert.equal(r.status, 204);
  assert.equal((await h.api('GET', '/me', { token })).status, 200);
  assert.equal((await h.api('GET', '/me', { token: other })).status, 401);
  assert.equal((await h.api('POST', '/auth/login', { body: { email, password: 'first password' } })).status, 401);
  assert.equal((await h.api('POST', '/auth/login', { body: { email, password: 'second password' } })).status, 200);
});

test('export contains everything about the user, and no secrets', async () => {
  const { token, user } = await h.signup({ name: 'Exporter' });
  await h.sync(token, {
    books: [book('OL900W')],
    library: [{ book_id: 'OL900W', on_shelf: true, status: 'reading', updated_at: '2026-06-01T10:00:00Z' }],
    highlights: [{ id: crypto.randomUUID(), book_id: 'OL900W', text: 'A truth universally acknowledged', updated_at: '2026-06-01T10:00:00Z' }],
    sessions: [{ book_id: 'OL900W', mode: 'text', started_at: '2026-06-01T09:00:00Z', seconds: 300 }],
    events: [{ type: 'view', book_id: 'OL900W', at: '2026-06-01T08:00:00Z' }],
  });
  const r = await h.api('GET', '/me/export', { token });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /spine-export\.json/);
  const e = r.body;
  assert.equal(e.user.id, user.id);
  assert.equal(e.library.length, 1);
  assert.equal(e.highlights.length, 1);
  assert.equal(e.reading_sessions.length, 1);
  assert.equal(e.events.length, 1);
  assert.ok(e.interests.length > 0);
  assert.equal(e.books[0].id, 'OL900W');
  assert.equal(e.devices.length, 1);
  const text = JSON.stringify(e);
  assert.ok(!text.includes('scrypt$'));
  assert.ok(!text.includes(token));
});

test('DELETE /me needs the password and removes every row', async () => {
  const { token, user } = await h.signup({ password: 'delete me please' });
  await h.sync(token, {
    books: [book('OL901W')],
    library: [{ book_id: 'OL901W', on_shelf: true, status: 'want', updated_at: '2026-06-01T10:00:00Z' }],
    bookmarks: [{ id: crypto.randomUUID(), book_id: 'OL901W', label: 'here', updated_at: '2026-06-01T10:00:00Z' }],
    sessions: [{ book_id: 'OL901W', mode: 'scan', started_at: '2026-06-01T09:00:00Z', seconds: 60 }],
    events: [{ type: 'shelf_add', book_id: 'OL901W' }],
  });
  await h.api('POST', '/me/links/archive', { token, body: {} });
  const bad = await h.api('DELETE', '/me', { token, body: { password: 'wrong one!' } });
  assert.equal(bad.status, 401);
  const missing = await h.api('DELETE', '/me', { token, body: {} });
  assert.equal(missing.status, 400);
  const r = await h.api('DELETE', '/me', { token, body: { password: 'delete me please' } });
  assert.equal(r.status, 204);
  for (const t of ['users', 'sessions', 'library', 'highlights', 'bookmarks', 'reading_sessions', 'events', 'interests', 'linked_accounts']) {
    const col = t === 'users' ? 'id' : 'user_id';
    const { rows } = await h.db.query(`SELECT count(*) AS n FROM ${t} WHERE ${col} = $1`, [user.id]);
    assert.equal(rows[0].n, 0, t);
  }
  // The shared catalogue keeps the book.
  const { rows } = await h.db.query('SELECT count(*) AS n FROM books WHERE id = $1', ['OL901W']);
  assert.equal(rows[0].n, 1);
  assert.equal((await h.api('GET', '/me', { token })).status, 401);
});

test('CORS allows configured origins and answers preflight', async () => {
  const pre = await h.app.request('/sync', {
    method: 'OPTIONS',
    headers: { origin: 'https://josbeak.github.io', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' },
  });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), 'https://josbeak.github.io');
  assert.match(pre.headers.get('access-control-allow-headers').toLowerCase(), /authorization/);
  const evil = await h.app.request('/health', { headers: { origin: 'https://evil.example' } });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
});

test('bodies over the size limit get 413', async () => {
  const { token } = await h.signup();
  const r = await h.api('POST', '/me/links/goodreads', { token, raw: JSON.stringify({ csv: 'x'.repeat(3 * 1024 * 1024) }), headers: { 'content-type': 'application/json' } });
  assert.equal(r.status, 413);
  assert.ok(r.body.error);
});
