// Runs after `vite build`. GitHub Pages only serves files, so every URL we want search engines to
// index needs a real file that answers 200:
//   dist/book/<id>.html      one per book in seo/catalog.json, the curated seed and the textbooks,
//                            with its own <title>, description, canonical URL, social card and
//                            schema.org Book data, plus a plain HTML summary inside #view that the
//                            app replaces as soon as it starts
//   dist/discover.html, …    the other top-level screens
//   dist/404.html            any other path (/read/<id>, books outside the catalog): the app still
//                            runs there, but the page answers 404 and is marked noindex
//   dist/robots.txt, dist/sitemap.xml
// GitHub Pages serves /book/OL66554W from book/OL66554W.html, so URLs need no trailing slash.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const SITE = (process.env.SITE_URL || 'https://spinebrew.com').replace(/\/$/, '');
const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
const read = p => JSON.parse(readFileSync(new URL(p, root), 'utf8'));

const shell = readFileSync(new URL('index.html', dist), 'utf8');
const { books: catalog } = read('seo/catalog.json');
const seed = read('src/data/seed.json');
const textbooks = read('src/data/textbooks.json');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clip = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…');
const cover = (c, size = 'L') => (c ? `https://covers.openlibrary.org/b/id/${c}-${size}.jpg` : null);

/** The shell with this page's head, and optionally some content inside #view. */
function page({ path, title, description, image, type = 'website', noindex = false, jsonld = null, body = '' }) {
  const url = SITE + path;
  let h = shell
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${esc(description)}">`)
    .replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${esc(title)}">`)
    .replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${esc(description)}">`);
  const extra = [
    noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${esc(url)}">`,
    noindex ? '' : `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:type" content="${type}">`,
    '<meta property="og:site_name" content="Spine">',
    image ? `<meta property="og:image" content="${esc(image)}">` : '',
    `<meta name="twitter:card" content="summary">`,
    jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : '',
  ].filter(Boolean).join('\n  ');
  h = h.replace('</head>', `  ${extra}\n</head>`);
  if (body) h = h.replace(/<main class="view" id="view"><\/main>/, `<main class="view" id="view">${body}</main>`);
  return h;
}

const write = (rel, html) => {
  const f = new URL(rel, dist);
  mkdirSync(new URL('./', f), { recursive: true });
  writeFileSync(f, html);
};

// ---- books
const byId = new Map();
for (const b of catalog) byId.set(b.id, { id: b.id, title: b.t, author: b.a, year: b.y, cover: b.c, subjects: b.s, first: b.f, audio: b.lv, scan: b.sc });
for (const b of seed) byId.set(b.id, { ...byId.get(b.id), id: b.id, title: b.title, author: b.author, year: b.year, cover: b.cover, blurb: b.blurb, audio: !!b.lv || byId.get(b.id)?.audio, scan: !!b.scan || byId.get(b.id)?.scan, subjects: byId.get(b.id)?.subjects || (b.genre ? [b.genre] : []) });
for (const b of textbooks) byId.set(b.id, { id: b.id, title: b.title, author: b.author, image: b.coverArt, blurb: b.blurb, subjects: b.subjects, textbook: true });

const byAuthor = new Map();
for (const b of byId.values()) if (b.author) (byAuthor.get(b.author) || byAuthor.set(b.author, []).get(b.author)).push(b);

function describe(b) {
  if (b.blurb) return clip(b.blurb, 158);
  const by = b.author ? ` by ${b.author}` : '';
  const yr = b.year ? ` (${b.year})` : '';
  const ways = [b.scan && 'the original printed pages', b.audio && 'the free audiobook'].filter(Boolean);
  return clip(`Read ${b.title}${by}${yr} free online, with real page turns and a tap-to-define dictionary${ways.length ? `. Also: ${ways.join(' and ')}` : ''}.`, 158);
}

function bookBody(b) {
  const img = b.image || cover(b.cover, 'M');
  const more = (byAuthor.get(b.author) || []).filter(x => x.id !== b.id).slice(0, 8);
  return `<article class="prerender">
    ${img ? `<img class="prerender-cover" src="${esc(img)}" alt="Cover of ${esc(b.title)}" width="180" loading="eager">` : ''}
    <div>
      <h1>${esc(b.title)}</h1>
      <p class="prerender-by">${b.author ? `by ${esc(b.author)}` : ''}${b.year ? ` · ${esc(b.year)}` : ''}</p>
      ${b.blurb ? `<p>${esc(b.blurb)}</p>` : b.first ? `<blockquote>${esc(b.first)}</blockquote>` : ''}
      <p>${b.textbook ? 'A complete, peer-reviewed OpenStax textbook, free to read online.' : `Free to read in your browser${b.scan ? ', or as the original printed scans' : ''}${b.audio ? '. A free LibriVox audiobook is available too' : ''}.`}</p>
      ${b.subjects?.length ? `<p class="prerender-tags">${b.subjects.map(s => `<a href="/discover?subject=${encodeURIComponent(s)}&amp;label=${encodeURIComponent(s)}&amp;mode=all">${esc(s)}</a>`).join(' ')}</p>` : ''}
      ${more.length ? `<h2>More by ${esc(b.author)}</h2><ul>${more.map(x => `<li><a href="/book/${encodeURIComponent(x.id)}">${esc(x.title)}</a></li>`).join('')}</ul>` : ''}
    </div>
  </article>`;
}

let n = 0;
for (const b of byId.values()) {
  const path = `/book/${encodeURIComponent(b.id)}`;
  const title = `${b.title}${b.author ? ` by ${b.author}` : ''}, free to read · Spine`;
  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'Book',
    name: b.title,
    url: SITE + path,
    ...(b.author && { author: { '@type': 'Person', name: b.author } }),
    ...(b.year && { datePublished: String(b.year) }),
    ...((b.image || b.cover) && { image: b.image || cover(b.cover) }),
    ...(b.subjects?.length && { genre: b.subjects }),
    inLanguage: 'en',
    isAccessibleForFree: true,
    bookFormat: 'https://schema.org/EBook',
  };
  write(`book/${b.id}.html`, page({ path, title, description: describe(b), image: b.image || cover(b.cover), type: 'book', jsonld, body: bookBody(b) }));
  n++;
}

// ---- top-level screens
const screens = [
  { file: 'discover.html', path: '/discover', title: 'Discover free books · Spine', description: 'Browse free classics, modern books to borrow, open textbooks and audiobooks by subject, era and author.' },
  { file: 'sources.html', path: '/sources', title: 'Where the books come from · Spine', description: 'Spine finds free, legal books from Project Gutenberg, the Internet Archive, Open Library, OpenStax and LibriVox.' },
  { file: 'library.html', path: '/library', title: 'Your library · Spine', description: 'The books you are reading and have saved.', noindex: true },
  { file: 'account.html', path: '/account', title: 'Your account · Spine', description: 'Sign up free to keep your reading history on every device.', noindex: true },
];
for (const s of screens) write(s.file, page(s));
write('404.html', page({ path: '/', title: 'Spine · free books to read and hear', description: 'Free books to read, see as first printed, or listen to.', noindex: true }));

// The home page keeps its own head, plus a canonical URL and social tags.
write('index.html', page({ path: '/', title: 'Spine · free books to read and hear', description: 'Millions of free books: classics to read with real page turns, modern books to borrow, free textbooks and audiobooks.' }));

// ---- robots.txt and sitemap
write('robots.txt', `User-agent: *
Allow: /
Disallow: /read/
Disallow: /scan/
Disallow: /borrow/
Disallow: /textbook/
Disallow: /library
Disallow: /account
Disallow: /discover?

Sitemap: ${SITE}/sitemap.xml
`);

const urls = ['/', '/discover', '/sources', ...[...byId.keys()].map(id => `/book/${encodeURIComponent(id)}`)];
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${esc(SITE + u)}</loc></url>`).join('\n')}
</urlset>
`);

console.log(`prerendered ${n} book pages, ${screens.length} screens, 404.html, robots.txt and a sitemap of ${urls.length} URLs`);
