// Your library: the books you're reading face out on a ledge, everything else on a real bookcase.
// Each book on the shelves is a 3D box (spine, top edge, front cover). Point at one and it slides
// off the shelf and turns to show its cover; the shelf's label tells you what it is.
import { $, $$, esc, isLight, debounce } from '../lib/util.js';
import { store } from '../lib/store.js';
import { seed } from '../lib/openlibrary.js';
import { bookHTML, frontHTML, toneOf, sampleTone, applyTone } from '../ui/book.js';
import { fmtDuration, fmtWhen } from '../ui/activity.js';
import { I } from '../ui/icons.js';

let tidying = false; // stays on while you remove several books in a row

/* ---------- one book on a shelf ---------- */

function dims(b) {
  const pages = b.pages || 220;
  const h = 188 + ((b.title.length * 37 + pages) % 52);
  const w = Math.max(28, Math.min(58, Math.round(pages / 10.5)));
  return { w, h, d: Math.round(h * 0.68) };
}

function status(b) {
  if (store.finished(b.id)) return 'Finished';
  const p = store.progress(b.id);
  if (p) return `${Math.max(1, Math.round(p.pct * 100))}% read`;
  return store.onShelf(b.id) ? 'Not started' : 'Free to read';
}

function vol(b) {
  const { w, h, d } = dims(b);
  const tone = toneOf(b);
  const p = store.progress(b.id);
  const reading = p && !store.finished(b.id);
  const surname = (b.author || '').split(/[ ,]+/).filter(Boolean).pop() || '';
  const mine = store.inLibrary(b.id);
  return `<a class="vol ${isLight(tone) ? 'light' : ''}" href="#/book/${b.id}" data-id="${b.id}"${mine ? ' data-lib' : ''}
      data-tip="${esc(b.title)}" data-by="${esc(b.author || '')}" data-st="${status(b)}"
      style="--tone:${tone};--w:${w}px;--h:${h}px;--d:${d}px" aria-label="${esc(b.title)}, ${esc(b.author || '')}. ${status(b)}">
    <span class="vol-box">
      <span class="vol-spine"><i class="band"></i><b>${esc(b.title)}</b>${w >= 36 ? `<small>${esc(surname)}</small>` : ''}<i class="band low"></i></span>
      <span class="vol-top"></span>
      <span class="vol-cover" style="--w:${d}px">${frontHTML(b)}</span>
      ${reading ? `<span class="vol-ribbon" style="--p:${p.pct}"></span>` : ''}
    </span>
    ${mine ? `<span class="vol-x" aria-hidden="true">${I.x}</span>` : ''}
  </a>`;
}

/* ---------- a bookcase: rows of books, each row on its own ledge ---------- */

const GAP = 3;
function rows(list, width) {
  const out = [[]];
  let used = 0;
  for (const b of list) {
    const w = dims(b).w + GAP;
    if (used + w > width && out.at(-1).length) { out.push([]); used = 0; }
    out.at(-1).push(b); used += w;
  }
  return out;
}

function caseHTML(key, label, list, empty, width) {
  if (!list.length) {
    return `<div class="shelf3d empty"><div class="shelf-books"><span class="ghost"></span><span class="ghost"></span><span class="ghost"></span><p>${empty}</p></div>
      <div class="ledge"><span class="ledge-label"><b>${label}</b></span></div></div>`;
  }
  return rows(list, width).map((r, i) => `<div class="shelf3d" data-case="${key}">
      <div class="shelf-books">${r.map(vol).join('')}${i === 0 ? '' : ''}</div>
      <div class="ledge"><span class="ledge-label" data-default="${i === 0 ? `<b>${label}</b><em>${list.length} ${list.length === 1 ? 'book' : 'books'}</em>` : ''}">${i === 0 ? `<b>${label}</b><em>${list.length} ${list.length === 1 ? 'book' : 'books'}</em>` : ''}</span></div>
    </div>`).join('');
}

/* ---------- the books you're reading ---------- */

function nsCard(b, i) {
  const p = store.progress(b.id) || {};
  const pct = Math.max(1, Math.round((p.pct || 0) * 100));
  const where = [p.chTitle, p.t ? `read ${fmtWhen(new Date(p.t).toISOString())}` : ''].filter(Boolean).join(' · ');
  return `<article class="ns-card" style="--i:${i}">
    <button class="ns-x" data-remove-lib="${b.id}" aria-label="Remove ${esc(b.title)} from your library" title="Remove from library">${I.x}</button>
    ${bookHTML(b, { cap: false, ribbon: false })}
    <div class="ns-info">
      <b>${esc(b.title)}</b><span class="by">${esc(b.author || '')}</span>
      <div class="ns-prog"><div class="bar"><i style="width:${pct}%"></i></div><em>${pct}%</em></div>
      ${where ? `<p class="ns-where">${esc(where)}</p>` : ''}
      <button class="btn btn-ink sm" data-read="${b.id}">Keep reading ${I.arrowR}</button>
    </div>
  </article>`;
}

/* ---------- reading numbers ---------- */

function stats(shelf) {
  const sessions = store.history().filter(x => x.kind === 'session');
  const week = Date.now() - 7 * 864e5;
  const seconds = sessions.filter(s => new Date(s.at).getTime() > week).reduce((n, s) => n + (s.seconds || 0), 0);
  const days = new Set(sessions.map(s => new Date(s.at).toDateString()));
  let streak = 0;
  const d = new Date();
  if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1); // today doesn't break it yet
  while (days.has(d.toDateString())) { streak++; d.setDate(d.getDate() - 1); }
  const marks = shelf.reduce((n, b) => n + store.highlightsFor(b.id).length, 0);
  const done = shelf.filter(b => store.finished(b.id)).length;
  const cell = (v, l) => `<div><b>${v}</b><span>${l}</span></div>`;
  return `<div class="lib-stats">
    ${cell(seconds >= 60 ? fmtDuration(seconds) : seconds ? '1 min' : '0 min', 'read this week')}
    ${cell(streak, streak === 1 ? 'day in a row' : 'days in a row')}
    ${cell(done, done === 1 ? 'book finished' : 'books finished')}
    ${cell(marks, marks === 1 ? 'highlight' : 'highlights')}
  </div>`;
}

export function library() {
  const shelf = store.shelf();
  const reading = store.reading();
  const done = shelf.filter(b => store.finished(b.id));
  const want = shelf.filter(b => !store.progress(b.id));
  const onShelf = new Set(shelf.map(b => b.id));
  const day = Math.floor(Date.now() / 864e5);
  const picks = seed.filter(b => !onShelf.has(b.id)).sort((a, b) => ((a.cover * 31 + day) % 97) - ((b.cover * 31 + day) % 97)).slice(0, 22);

  const html = `<header class="lib-head rise">
      <div>
        <h1 class="page-title">Your library</h1>
        <p class="page-sub">${shelf.length ? 'Everything you’ve started or saved. Point at a book to take it off the shelf.' : 'Nothing here yet. Open any book and press “Add to shelf”, or just start reading.'}</p>
      </div>
      ${stats(shelf)}
    </header>
    ${shelf.length ? `<div class="lib-tools"><button class="btn btn-line sm" data-tidy aria-pressed="${tidying}">${tidying ? 'Done' : 'Tidy up'}</button><span class="muted sm" data-tidy-hint ${tidying ? '' : 'hidden'}>Tap a book on your shelves to take it out of your library.</span></div>` : ''}
    ${reading.length ? `<section class="lib-now rise" style="--i:1">
      <p class="lib-label">Reading now</p>
      <div class="ns-grid">${reading.slice(0, 4).map(nsCard).join('')}</div>
    </section>` : ''}
    <div class="bookcase3d rise ${tidying ? 'tidying' : ''}" style="--i:2">
      <section data-slot="want"></section>
      <section data-slot="done"></section>
      <section data-slot="picks"></section>
    </div>`;

  return {
    html,
    wire(root) {
      const cases = {
        want: ['Want to read', want, 'Press “Add to shelf” on any book and it waits for you here.'],
        done: ['Finished', done, 'Books you finish move here, with your highlights.'],
        picks: ['Picked for you today', picks, ''],
      };
      let lastW = 0;
      const paint = () => {
        const width = $('.bookcase3d', root).clientWidth - 64;
        if (Math.abs(width - lastW) < 20) return;
        lastW = width;
        for (const [key, [label, list, empty]] of Object.entries(cases)) {
          $(`[data-slot="${key}"]`, root).innerHTML = caseHTML(key, label, list, empty, width);
        }
        wireLabels(root);
      };
      paint();
      $('[data-tidy]', root)?.addEventListener('click', e => {
        tidying = !tidying;
        e.currentTarget.setAttribute('aria-pressed', tidying);
        e.currentTarget.textContent = tidying ? 'Done' : 'Tidy up';
        $('[data-tidy-hint]', root).hidden = !tidying;
        $('.bookcase3d', root).classList.toggle('tidying', tidying);
      });
      const ro = new ResizeObserver(debounce(() => { if (!root.isConnected) return ro.disconnect(); paint(); }, 120));
      ro.observe($('.bookcase3d', root));

      if (reading[0]) applyTone(root, reading[0]);
      [...shelf, ...picks].forEach(b => sampleTone(b).then(t => {
        $$(`.vol[data-id="${b.id}"]`, root).forEach(el => { el.style.setProperty('--tone', t); el.classList.toggle('light', isLight(t)); });
      }));
    },
  };
}

// The ledge in front of each row works like a museum label: it names the book you're pointing at.
function wireLabels(root) {
  $$('.shelf3d[data-case]', root).forEach(row => {
    const label = $('.ledge-label', row);
    const show = v => {
      label.classList.add('naming');
      label.innerHTML = `<b>${esc(v.dataset.tip)}</b><em>${v.dataset.by ? `${esc(v.dataset.by)} · ` : ''}${esc(v.dataset.st)}</em>`;
    };
    const reset = () => { label.classList.remove('naming'); label.innerHTML = label.dataset.default; };
    $$('.vol', row).forEach(v => {
      v.addEventListener('pointerenter', () => show(v));
      v.addEventListener('focus', () => show(v));
      v.addEventListener('pointerleave', reset);
      v.addEventListener('blur', reset);
    });
  });
}
