import { esc, isLight } from '../lib/util.js';
import { store } from '../lib/store.js';
import { seed, coverURL } from '../lib/openlibrary.js';
import { toneOf, sampleTone } from '../ui/book.js';

function spine(b, i, n) {
  const pages = b.pages || 220;
  const h = 196 + ((b.title.length * 37 + pages) % 48);
  const w = Math.max(30, Math.min(56, Math.round(pages / 11)));
  const lean = i === n - 1 && n > 2;
  const tone = toneOf(b);
  const p = store.progress(b.id);
  const note = store.finished(b.id) ? 'Finished' : p ? `${Math.round(p.pct * 100)}% read` : esc(b.author);
  return `<a class="spine rise ${isLight(tone) ? 'light' : ''} ${lean ? 'lean' : ''}" href="#/book/${b.id}" data-id="${b.id}" style="--tone:${tone};--sw:${w}px;--sh:${h}px;--i:${Math.min(i, 14)}" aria-label="${esc(b.title)}, ${note}">
    <i class="band"></i><b>${esc(b.title)}</b><i class="dot"></i>
    <span class="peek">${b.cover ? `<img src="${coverURL(b)}" alt="">` : ''}<b>${esc(b.title)}</b><span>${note}</span></span></a>`;
}

const plank = (label, list, empty) => `<div class="plank-box"><p class="plank-label">${label} <em>${list.length}</em></p><div class="plank-wrap"><div class="plank">${list.length ? list.map((b, i) => spine(b, i, list.length)).join('') + '<span class="bookend"></span>' : `<p class="plank-empty">${empty}</p>`}</div></div></div>`;

export function library() {
  const shelf = store.shelf();
  const reading = store.reading();
  const done = shelf.filter(b => store.finished(b.id));
  const want = shelf.filter(b => !store.progress(b.id));
  const onShelf = new Set(shelf.map(b => b.id));
  const day = Math.floor(Date.now() / 864e5);
  const picks = seed.filter(b => !onShelf.has(b.id)).sort((a, b) => ((a.cover * 31 + day) % 97) - ((b.cover * 31 + day) % 97)).slice(0, 18);
  const html = `<h1 class="page-title">Your library</h1>
    <p class="page-sub">${shelf.length ? 'Books you have started or saved. They live in this browser, no account needed.' : 'Nothing here yet. Open any book and press “Add to shelf”, or just start reading.'}</p>
    <div class="bookcase">
      <div class="bookcase-row">${plank('Reading now', reading, 'Start any book and it shows up here.')}${plank('Finished', done, 'Books you finish land here.')}</div>
      ${plank('Want to read', want, 'Open a book and press “Add to shelf.”')}
      ${plank('Picked for you', picks, '')}
    </div>`;
  return {
    html,
    wire(root) {
      [...shelf, ...picks].forEach(b => sampleTone(b).then(t => {
        root.querySelectorAll(`.spine[data-id="${b.id}"]`).forEach(el => { el.style.setProperty('--tone', t); el.classList.toggle('light', isLight(t)); });
      }));
    },
  };
}
