import { esc } from '../lib/util.js';
import { store } from '../lib/store.js';
import { seed, search, coverURL } from '../lib/openlibrary.js';
import { bookHTML, applyTone } from '../ui/book.js';
import { rowHTML, wireRows } from '../ui/rows.js';
import { I } from '../ui/icons.js';

const pick = titles => titles.map(t => seed.find(b => b.title === t)).filter(Boolean);

export const LIVE_ROWS = [
  { title: 'Detective stories', subject: 'Detective and mystery stories' },
  { title: 'Ghosts and horror', subject: '(subject:"Ghost stories" OR subject:"Horror tales")' },
  { title: 'Science fiction', sub: 'Most of it written before the term existed', subject: 'Science fiction' },
  { title: 'Love stories', subject: 'Love stories' },
  { title: 'At sea', subject: 'Sea stories' },
  { title: 'Adventure', subject: 'Adventure stories' },
  { title: 'Fairy tales and fables', subject: '(subject:"Fairy tales" OR subject:"Fables")' },
  { title: 'Young readers', subject: "Children's stories" },
  { title: 'Funny books', subject: 'Humorous stories' },
  { title: 'Short stories', subject: 'Short stories' },
  { title: 'Poetry', subject: 'Poetry' },
  { title: 'Philosophy', subject: 'Philosophy' },
  { title: 'History', subject: 'History' },
  { title: 'Travel', subject: 'Voyages and travels' },
];

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
    : `<h3>Every book here can be</h3>
       <div class="mini"><span class="how">${I.book}</span><div><b>Read</b><span>Clean text with real page turns</span></div></div>
       <div class="mini"><span class="how">${I.scan}</span><div><b>Seen as first printed</b><span>Scans of the original pages</span></div></div>
       <div class="mini"><span class="how">${I.ear}</span><div><b>Listened to</b><span>Free audiobooks, where there is one</span></div></div>`;
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

export function home() {
  const reading = store.reading();
  const html = `
    ${heroHTML()}
    ${reading.length > 1 ? rowHTML({ title: 'Continue reading', books: reading, meter: true }) : ''}
    ${rowHTML({ title: 'Where most people start', books: pick(['Pride and Prejudice', 'Frankenstein', 'The Great Gatsby', 'Dracula', 'The Picture of Dorian Gray', "Alice's Adventures in Wonderland", 'The Adventures of Sherlock Holmes', 'Meditations', 'The Metamorphosis', 'Jane Eyre', 'Little Women', 'The Count of Monte Cristo', 'Crime and Punishment', 'Moby-Dick', 'Treasure Island', 'A Christmas Carol']) })}
    ${rowHTML({ title: 'Free since 2021', sub: 'Recently out of copyright in the US', books: pick(['The Great Gatsby', 'Mrs Dalloway', 'The Murder of Roger Ackroyd', 'Winnie-the-Pooh', 'The Prophet', 'Siddhartha', 'The Waste Land', 'The Secret Adversary', 'Ulysses']) })}
    ${rowHTML({ title: 'Short enough for tonight', sub: 'Under 150 pages', books: seed.filter(b => b.pages < 150).sort((a, b) => a.pages - b.pages) })}
    ${rowHTML({ title: 'Listen while you walk', sub: 'Free audiobooks read by LibriVox volunteers', books: seed.filter(b => b.lv).slice(14, 34) })}
    ${LIVE_ROWS.map(r => rowHTML({ title: r.title, sub: r.sub, all: `#/discover?subject=${encodeURIComponent(r.subject)}&label=${encodeURIComponent(r.title)}`, load: () => search({ subject: r.subject, limit: 24 }).then(x => x.books) })).join('')}
    <p class="foot">Spine doesn't host any books. It finds them in free public libraries: the catalogue and covers come from <a href="https://openlibrary.org" target="_blank" rel="noopener">Open Library</a>, the text from <a href="https://www.gutenberg.org" target="_blank" rel="noopener">Project Gutenberg</a>, scans from the <a href="https://archive.org" target="_blank" rel="noopener">Internet Archive</a> and recordings from <a href="https://librivox.org" target="_blank" rel="noopener">LibriVox</a>. Your shelf and reading progress stay in this browser.</p>`;
  return {
    html,
    wire(root) {
      wireRows(root);
      const b = store.reading()[0] || dayPick();
      applyTone(root, b);
    },
  };
}
