// The plain text of Project Gutenberg books, fetched from the Internet Archive for the browser.
// archive.org/download answers with a redirect that has no CORS header, so a browser can't
// fetch the file itself. Only .txt files of items in the "gutenberg" collection are served, so
// this isn't a general proxy. Responses are public and long-lived; Vercel's CDN keeps them.

import { HttpError, badRequest, notFound } from './http.js';

const IA = 'https://archive.org';
const ITEM = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.txt(\.utf8)?$/;
const MAX_BYTES = 12 * 1024 * 1024; // the longest Gutenberg texts are a few MB
const TIMEOUT = 20000;

async function get(fetch, url, userAgent) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    return await fetch(url, { headers: { 'User-Agent': userAgent }, redirect: 'follow', signal: ctl.signal });
  } catch {
    throw new HttpError(504, 'The Internet Archive didn\'t answer in time. Try again in a moment.');
  } finally { clearTimeout(t); }
}

export function textRoutes(app, { fetch, config }) {
  const ua = config.userAgent;

  app.get('/texts/:item/:file', async (c) => {
    const { item, file } = c.req.param();
    if (!ITEM.test(item) || !FILE.test(file)) throw badRequest('Ask for a .txt file of a Project Gutenberg item, like /texts/prideandprejudic42671gut/pg42671.txt.utf8.');

    const meta = await get(fetch, `${IA}/metadata/${encodeURIComponent(item)}/metadata/collection`, ua);
    if (!meta.ok) throw new HttpError(502, 'The Internet Archive didn\'t describe this item. Try again in a moment.');
    const { result } = await meta.json().catch(() => ({}));
    const collections = [].concat(result || []);
    if (!collections.includes('gutenberg')) throw notFound('Only Project Gutenberg texts are available here.');

    const r = await get(fetch, `${IA}/download/${encodeURIComponent(item)}/${encodeURIComponent(file)}`, ua);
    if (r.status === 404) throw notFound('That text file isn\'t in this item.');
    if (!r.ok) throw new HttpError(502, `The Internet Archive couldn't send the text (${r.status}). Try again in a moment.`);
    const size = Number(r.headers.get('content-length') || 0);
    if (size > MAX_BYTES) throw new HttpError(413, 'This text file is too large to send.');
    const body = await r.arrayBuffer();
    if (body.byteLength > MAX_BYTES) throw new HttpError(413, 'This text file is too large to send.');

    // Bytes go through untouched: the browser decides between UTF-8 and Windows-1252, as before.
    c.header('Content-Type', 'text/plain; charset=binary');
    c.header('Cache-Control', 'public, max-age=86400, s-maxage=2592000, immutable');
    return c.body(body);
  });
}
