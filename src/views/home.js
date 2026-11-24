import { $, esc } from '../lib/util.js';
import { store } from '../lib/store.js';
import { seed, search, coverURL, textbooks } from '../lib/openlibrary.js';
import { shelfByKey, SHELVES } from '../lib/shelves.js';
import { personalRows } from '../lib/recs.js';
import { bookHTML, applyTone } from '../ui/book.js';
import { rowHTML, wireRows } from '../ui/rows.js';
import { I } from '../ui/icons.js';

const nf = s => `(${s.map(x => `subject:"${x}"`).join(' OR ')}) -subject:fiction`;

// Subjects that only appear further down the endless board.
const MORE = [
  ['Fantasy', 'subject:"Fantasy"'], ['Thrillers and suspense', '(subject:"Suspense" OR subject:"Thrillers")'], ['Mythology', 'subject:"Mythology"'],
  ['Leadership', nf(['Leadership'])], ['Relationships', nf(['Interpersonal relations', 'Love'])], ['Parenting', nf(['Parenting', 'Child rearing'])],
  ['Economics', nf(['Economics'])], ['Politics', nf(['Political science', 'Politics and government'])], ['Law', nf(['Law'])],
  ['Medicine', nf(['Medicine'])], ['Nature', nf(['Natural history', 'Nature'])], ['Animals', nf(['Animals', 'Dogs', 'Cats'])],
  ['Space', nf(['Outer space', 'Astronomy', 'Space flight'])], ['Art', nf(['Art', 'Painting'])], ['Music', nf(['Music'])],
  ['Photography', nf(['Photography'])], ['Architecture and design', nf(['Architecture', 'Design'])], ['Writing', nf(['Authorship', 'Creative writing'])],
  ['Marketing', nf(['Marketing', 'Advertising'])], ['Sports', nf(['Sports'])], ['Chess and games', nf(['Chess', 'Games'])],
  ['Gardening', nf(['Gardening'])], ['Religion', nf(['Religion', 'Christianity', 'Buddhism'])], ['True crime', nf(['Crime', 'Murder'])],
  ['World War II', nf(['World War, 1939-1945'])], ['Ancient Rome', 'subject:"Rome"'], ['Ancient Greece', 'subject:"Greece"'],
  ['India', 'subject:"India"'], ['China', 'subject:"China"'], ['Africa', 'subject:"Africa"'], ['Westerns', 'subject:"Western stories"'],
  ['War stories', 'subject:"War stories"'], ['Graphic novels', '(subject:"Comic books, strips, etc." OR subject:"Graphic novels")'],
  ['Learning English', nf(['English language'])], ['Inventions', nf(['Inventions', 'Inventors'])], ['Travel writing', nf(['Description and travel'])],
];
const DECADES = Array.from({ length: 22 }, (_, i) => 1800 + i * 10);

// A live shelf: Open Library books on a subject, read-now and borrowable, most read first.
const live = key => {
  const sh = shelfByKey(key);
  return rowHTML({ title: sh.title, sub: sh.sub, all: `#/discover?shelf=${key}`, load: page => search({ subject: sh.q, page, limit: 24 }).then(x => x.books) });
};

// Lead with the subjects people look for most; leave out the Spanish editions on Home.
const TB_ORDER = ['Math', 'Science', 'Computer Science', 'Social Sciences', 'Business', 'Humanities', 'College Success', 'Nursing'];
const textbookShelf = () => {
  const by = TB_ORDER.map(sub => textbooks.filter(b => b.subject === sub && !/Volume [23]\b/i.test(b.title)));
  const out = [];
  for (let i = 0; out.length < 28 && by.some(l => l[i]); i++) by.forEach(l => l[i] && out.push(l[i]));
  return out.slice(0, 28);
};

const pick = titles => titles.map(t => seed.find(b => b.title === t)).filter(Boolean);

function dayPick() {
  const list = seed.filter(b => b.gut && b.blurb);
  const day = Math.floor(Date.now() / 864e5);
  return list[day % list.length];
}

function heroHTML() {
  const reading = store.reading();
  const b = reading[0] || dayPick();
  const p = store.progress(b.id);
  const pct = p ? Math.round(p.pct * 100) : null;
  const others = reading.slice(1, 3);
  const side = others.length
    ? `<h3>Also on your nightstand</h3>${others.map(o => `<a class="mini" href="#/book/${o.id}">${o.cover ? `<img src="${coverURL(o, 'S')}" alt="">` : ''}<div><b>${esc(o.title)}</b><span>${esc(o.author)}</span><div class="meter"><i style="width:${Math.round((store.progress(o.id)?.pct || 0) * 100)}%"></i></div></div></a>`).join('')}`
    : `<h3>Three ways to read</h3>
       <div class="mini"><span class="how">${I.book}</span><div><b>Read here</b><span>Clean text or the original printed pages</span></div></div>
       <div class="mini"><span class="how">${I.scan}</span><div><b>Borrow free</b><span>Modern books from a free lending library</span></div></div>
       <div class="mini"><span class="how">${I.ear}</span><div><b>Listen</b><span>Free audiobooks of the classics</span></div></div>`;
  return `<section class="hero rise">
    <div class="ambient" style="${b.cover ? `background-image:url(${coverURL(b, 'M')})` : `background:${b.tone}`}"></div>
    ${bookHTML(b, { cap: false, scale: 1.5 })}
    <div style="min-width:0">
      <p class="eyebrow">${p ? 'Continue reading' : 'Book of the day'}</p>
      <h1>${esc(b.title)}</h1>
      <p class="by">${esc(b.author)}${b.year ? ` · ${esc(b.year)}` : ''}</p>
      <p class="where">${p ? `${esc(p.chTitle || 'Where you left off')}.` : esc(b.blurb || b.first || '')}</p>
      ${p ? `<div class="progress"><div class="bar"><i style="width:${pct}%"></i></div><span>${pct}% read</span></div>` : ''}
      <div class="btns">
        <button class="btn btn-ink" data-read="${b.id}">${p ? 'Keep reading' : 'Start reading'} ${I.arrowR}</button>
        ${b.lv || b.audio ? `<button class="btn btn-line" data-listen="${b.id}">${I.ear} Listen instead</button>` : `<a class="btn btn-line" href="#/book/${b.id}">About this book</a>`}
      </div>
    </div>
    <div class="nightstand">${side}</div>
  </section>`;
}

/** Rows for the endless part of the board: taste first, then every shelf, subject and decade, then surprises. */
function* endless() {
  const { subjects, authors } = store.interests(20);
  const used = new Set();
  const taste = [
    ...subjects.slice(3).map(s => ({ title: `Because you like ${s.name.toLowerCase()}`, q: `subject:"${s.name}"` })),
    ...authors.slice(2).map(a => ({ title: `More by ${a.name}`, author: a.name })),
  ];
  const rest = [
    ...['young', 'philosophy', 'poetry', 'funny', 'short', 'travel', 'plays', 'fairy'].map(k => shelfByKey(k)).map(s => ({ title: s.title, q: s.q, all: `#/discover?shelf=${s.key}` })),
    ...MORE.map(([title, q]) => ({ title, q })),
  ];
  const decades = DECADES.map(d => ({ title: `Written in the ${d}s`, sub: d < 1930 ? 'Free to read here' : 'Most of these are to borrow', era: [d, d + 9] }));
  // interleave: one taste row, two subject rows, one decade row
  let ti = 0, ri = 0, di = 0;
  while (ti < taste.length || ri < rest.length || di < decades.length) {
    if (ti < taste.length) yield taste[ti++];
    if (ri < rest.length) yield rest[ri++];
    if (ri < rest.length) yield rest[ri++];
    if (di < decades.length) yield decades[di++];
  }
  // after that, it never ends: random picks from every shelf
  const all = [...SHELVES.filter(s => s.q), ...MORE.map(([title, q]) => ({ title, q }))];
  for (let n = 1; ; n++) {
    const s = all[Math.floor(Math.random() * all.length)];
    const key = s.title + n;
    if (used.has(key)) continue;
    used.add(key);
    yield { title: `${s.title}: more surprises`, q: s.q, sort: 'random' };
  }
}

function rowFor(spec) {
  const load = page => (spec.author
    ? search({ q: `author:"${spec.author}"`, page, limit: 24 })
    : search({ subject: spec.q || '', q: spec.era ? `first_publish_year:[${spec.era[0]} TO ${spec.era[1]}]` : '', sort: spec.sort || 'readinglog', page, limit: 24 })
  ).then(x => x.books);
  return rowHTML({ title: spec.title, sub: spec.sub, all: spec.all, load });
}

export function home() {
  const reading = store.reading();
  const html = `
    ${heroHTML()}
    ${reading.length > 1 ? rowHTML({ title: 'Continue reading', books: reading, meter: true }) : ''}
    <div class="personal" aria-live="polite"></div>
    ${rowHTML({ title: 'Where most people start', books: pick(['Pride and Prejudice', 'Frankenstein', 'The Great Gatsby', 'Dracula', 'The Picture of Dorian Gray', "Alice's Adventures in Wonderland", 'The Adventures of Sherlock Holmes', 'Meditations', 'The Metamorphosis', 'Jane Eyre', 'Little Women', 'The Count of Monte Cristo', 'Crime and Punishment', 'Moby-Dick', 'Treasure Island', 'A Christmas Carol']) })}
    ${live('self-help')}
    ${live('money')}
    ${rowHTML({ title: 'Free since 2021', sub: 'Recently out of copyright in the US', books: pick(['The Great Gatsby', 'Mrs Dalloway', 'The Murder of Roger Ackroyd', 'Winnie-the-Pooh', 'The Prophet', 'Siddhartha', 'The Waste Land', 'The Secret Adversary', 'Ulysses']) })}
    ${live('programming')}
    ${live('science')}
    ${store.sources.openstax !== false ? rowHTML({ title: 'Free university textbooks', sub: 'Complete and peer-reviewed, from OpenStax', books: textbookShelf(), all: '#/discover?shelf=textbooks' }) : ''}
    ${rowHTML({ title: 'Short enough for tonight', sub: 'Under 150 pages', books: seed.filter(b => b.pages < 150).sort((a, b) => a.pages - b.pages) })}
    ${rowHTML({ title: 'Listen while you walk', sub: 'Free audiobooks read by LibriVox volunteers', books: seed.filter(b => b.lv).slice(14, 34) })}
    ${['detective', 'engineering', 'horror', 'maths', 'scifi', 'lives', 'love', 'food', 'sea', 'health', 'adventure', 'history'].map(live).join('')}
    <div class="board-more" aria-hidden="true"></div>`;
  return {
    html,
    wire(root) {
      wireRows(root);
      applyTone(root, store.reading()[0] || dayPick());

      // personal shelves arrive a moment later (they may come from the server)
      personalRows().then(rows => {
        const box = $('.personal', root);
        if (!box || !rows.length) return;
        box.innerHTML = rows.slice(0, 4).map(r => rowHTML(r)).join('');
        wireRows(box);
      }).catch(() => {});

      // the endless board: three more shelves every time you get near the bottom
      const gen = endless();
      const sentinel = $('.board-more', root);
      const add = () => {
        const frag = document.createElement('div');
        for (let i = 0; i < 3; i++) frag.insertAdjacentHTML('beforeend', rowFor(gen.next().value));
        sentinel.before(...frag.children);
        wireRows(root);
        // observing again reports the marker's current position, so a still-visible marker adds more
        io.unobserve(sentinel);
        setTimeout(() => { if (root.isConnected) io.observe(sentinel); }, 250);
      };
      const io = new IntersectionObserver(e => {
        if (!root.isConnected) { io.disconnect(); return; }
        if (e[0].isIntersecting) add();
      }, { rootMargin: '1200px 0px' });
      io.observe(sentinel);
    },
  };
}
