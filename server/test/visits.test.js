import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, T0 } from './helpers.js';

let h;
before(async () => { h = await setup(); });
after(() => h.close());

const visit = (body, opts = {}) => h.api('POST', '/visits', { body, ...opts });
const rows = async () => (await h.db.query('SELECT * FROM visits ORDER BY id')).rows;

test('an anonymous open is stored with only coarse details', async () => {
  h.set(T0);
  const visitor = crypto.randomUUID();
  const r = await visit({ visitor, first: true, landing: '#/book/OL1W', referrer: 'https://t.co/abc?x=1', source: 'X-Launch' },
    { headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile', 'x-vercel-ip-country': 'in' } });
  assert.equal(r.status, 204);
  const v = (await rows()).at(-1);
  assert.equal(v.visitor, visitor);
  assert.equal(v.user_id, null);
  assert.deepEqual([v.first_visit, v.landing, v.referrer, v.source, v.country, v.device], [true, 'book', 't.co', 'x-launch', 'IN', 'phone']);
});

test('signed-in opens are tied to the account; our own site is not a referrer', async () => {
  const { token, user } = await h.signup();
  const r = await visit({ visitor: crypto.randomUUID(), landing: '', referrer: 'https://www.spinebrew.com/#/library' }, { token });
  assert.equal(r.status, 204);
  const v = (await rows()).at(-1);
  assert.equal(v.user_id, user.id);
  assert.equal(v.referrer, null);
  assert.equal(v.landing, 'home');
  assert.equal(v.device, 'desktop');
});

test('a visitor id is required', async () => {
  const r = await visit({ landing: 'home' });
  assert.equal(r.status, 400);
});

test('deleting an account deletes its visits', async () => {
  const { token, user } = await h.signup();
  await visit({ visitor: crypto.randomUUID() }, { token });
  const del = await h.api('DELETE', '/me', { token, body: { password: 'correct horse' } });
  assert.ok([200, 204].includes(del.status), JSON.stringify(del.body));
  const left = (await h.db.query('SELECT count(*)::int AS n FROM visits WHERE user_id = $1', [user.id])).rows[0].n;
  assert.equal(left, 0);
});
