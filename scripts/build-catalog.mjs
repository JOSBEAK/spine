// Builds seo/catalog.json: every English book with clean Project Gutenberg text on Open Library
// (about 7,900), the books that get their own pre-rendered page and a place in the sitemap.
// Run now and then, then commit the result:  node scripts/build-catalog.mjs
// The site build (scripts/prerender.mjs) only reads the file, so deploys never depend on Open Library.

import { writeFileSync, mkdirSync } from 'node:fs';

const OL = 'https://openlibrary.org/search.json';
const FIELDS = 'key,title,author_name,first_publish_year,cover_i,subject,first_sentence,ia,ebook_access,lending_identifier_s';
const PAGE = 1000;
const foreign = /[Ͱ-ϿЀ-ӿ֐-ۿ぀-ヿ一-鿿가-힯]/;

async function page(n) {
  const params = new URLSearchParams({
    q: 'ebook_access:public id_project_gutenberg:* language:eng', fields: FIELDS, sort: 'readinglog', limit: PAGE, page: n,
  });
  for (let tries = 0; ; tries++) {
    try {
      const r = await fetch(`${OL}?${params}`, { headers: { 'User-Agent': 'Spine catalog builder (spinebrew.com)' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (tries >= 4) throw e;
      await new Promise(res => setTimeout(res, 3000 * (tries + 1)));
    }
  }
}

const books = [];
const seen = new Set();
for (let n = 1; ; n++) {
  const d = await page(n);
  for (const x of d.docs || []) {
    const id = x.key?.split('/').pop();
    if (!id || seen.has(id) || !x.title || foreign.test(x.title)) continue;
    seen.add(id);
    const ia = x.ia || [];
    books.push({
      id,
      t: x.title.slice(0, 200),
      a: (x.author_name || [])[0] || '',
      y: x.first_publish_year || null,
      c: x.cover_i || null,
      s: (x.subject || []).filter(s => s.length < 40 && !/[:(]/.test(s)).slice(0, 5),
      f: (x.first_sentence || []).find(s => s.length > 30 && s.length < 260) || null,
      lv: ia.some(i => /librivox/i.test(i)) || undefined,
      sc: (x.ebook_access === 'public' && !!x.lending_identifier_s) || undefined,
    });
  }
  console.log(`page ${n}: ${books.length} books`);
  if ((d.docs || []).length < PAGE) break;
  await new Promise(res => setTimeout(res, 1500)); // be gentle with Open Library
}

mkdirSync(new URL('../seo/', import.meta.url), { recursive: true });
writeFileSync(new URL('../seo/catalog.json', import.meta.url), JSON.stringify({ built: new Date().toISOString().slice(0, 10), books }));
console.log(`wrote seo/catalog.json with ${books.length} books`);
