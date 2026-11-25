import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';

let h;
before(async () => { h = await setup(); });
after(() => h.close());

test('serves a Gutenberg text file with long caching', async () => {
  h.ol = (u) => (u.pathname.startsWith('/metadata/') ? { result: ['gutenberg'] } : 'It is a truth universally acknowledged');
  const r = await h.api('GET', '/texts/prideandprejudic42671gut/pg42671.txt.utf8');
  assert.equal(r.status, 200);
  assert.match(String(r.body), /truth universally/);
  assert.match(r.headers.get('cache-control'), /public/);
  h.ol = () => ({ docs: [] });
});

test('refuses items outside the gutenberg collection', async () => {
  h.ol = (u) => (u.pathname.startsWith('/metadata/') ? { result: ['opensource'] } : 'secret');
  const r = await h.api('GET', '/texts/someoneelse/notes.txt');
  assert.equal(r.status, 404);
  h.ol = () => ({ docs: [] });
});

test('refuses files that are not plain text', async () => {
  const r = await h.api('GET', '/texts/prideandprejudic42671gut/pg42671.epub');
  assert.equal(r.status, 400);
});
