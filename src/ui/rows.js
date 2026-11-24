import { $, $$, esc } from '../lib/util.js';
import { bookHTML, skeletonHTML } from './book.js';
import { I } from './icons.js';

let uid = 0;

/** A horizontal shelf. Pass `books` to render now, or `load` (async () => books) to fill when it scrolls into view. */
export function rowHTML({ title, sub = '', books, load, all, meter }) {
  const id = 'row' + (++uid);
  if (load) loaders.set(id, { load, meter });
  return `<section class="row" aria-labelledby="${id}-h" data-row="${id}">
    <div class="row-head"><h2 id="${id}-h">${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}${all ? `<a href="${all}">See all ${I.arrowR}</a>` : ''}</div>
    <button class="arrow prev" aria-label="Scroll back" disabled>${I.chevL}</button>
    <div class="shelf">${books ? books.map((b, i) => bookHTML(b, { meter, i: Math.min(i, 12), cls: 'rise' })).join('') : skeletonHTML(8)}</div>
    <button class="arrow next" aria-label="Scroll forward">${I.chevR}</button>
  </section>`;
}

const loaders = new Map();

function wireArrows(r) {
  const s = $('.shelf', r), p = $('.prev', r), n = $('.next', r);
  const upd = () => { p.disabled = s.scrollLeft < 8; n.disabled = s.scrollLeft + s.clientWidth > s.scrollWidth - 8; };
  s.addEventListener('scroll', upd, { passive: true });
  upd();
  p.onclick = () => s.scrollBy({ left: -s.clientWidth * 0.8, behavior: 'smooth' });
  n.onclick = () => s.scrollBy({ left: s.clientWidth * 0.8, behavior: 'smooth' });
  return upd;
}

export function wireRows(root) {
  const io = new IntersectionObserver(entries => {
    entries.forEach(async en => {
      if (!en.isIntersecting) return;
      io.unobserve(en.target);
      const r = en.target, job = loaders.get(r.dataset.row);
      if (!job) return;
      loaders.delete(r.dataset.row);
      const shelf = $('.shelf', r);
      try {
        const books = (await job.load()).slice(0, 24);
        if (!r.isConnected) return;
        if (!books.length) { r.remove(); return; }
        shelf.innerHTML = books.map((b, i) => bookHTML(b, { meter: job.meter, i: Math.min(i, 12), cls: 'rise' })).join('');
      } catch {
        if (r.isConnected) shelf.outerHTML = `<p class="row-empty">This shelf didn't load. Open Library may be busy; try again in a minute.</p>`;
      }
      r._upd?.();
    });
  }, { rootMargin: '300px 0px' });
  $$('.row', root).forEach(r => {
    r._upd = wireArrows(r);
    if (loaders.has(r.dataset.row)) io.observe(r);
  });
}
