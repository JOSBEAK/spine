import { $, $$, esc } from '../lib/util.js';
import { bookHTML, skeletonHTML } from './book.js';
import { I } from './icons.js';

let uid = 0;
const loaders = new Map();
const MAX_PAGES = 6;

/**
 * A horizontal shelf. Pass `books` to render now, or `load(page)` (async → books) to fill it when it
 * scrolls into view. Loaded shelves keep fetching the next page as you scroll them sideways.
 */
export function rowHTML({ title, sub = '', books, load, all, meter }) {
  const id = 'row' + (++uid);
  if (load) loaders.set(id, { load, meter, page: 0, done: false, busy: false, seen: new Set() });
  return `<section class="row" aria-labelledby="${id}-h" data-row="${id}">
    <div class="row-head"><h2 id="${id}-h">${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}${all ? `<a href="${all}">See all ${I.arrowR}</a>` : ''}</div>
    <button class="arrow prev" aria-label="Scroll back" disabled>${I.chevL}</button>
    <div class="shelf">${books ? books.map((b, i) => bookHTML(b, { meter, i: Math.min(i, 12), cls: 'rise' })).join('') : skeletonHTML(8)}</div>
    <button class="arrow next" aria-label="Scroll forward">${I.chevR}</button>
  </section>`;
}

async function loadMore(r, first) {
  const job = loaders.get(r.dataset.row);
  if (!job || job.busy || job.done) return;
  job.busy = true;
  const shelf = $('.shelf', r);
  if (!first) shelf.insertAdjacentHTML('beforeend', skeletonHTML(3));
  try {
    const got = await job.load(job.page + 1);
    if (!r.isConnected) return;
    job.page++;
    const fresh = got.filter(b => b && !job.seen.has(b.id));
    fresh.forEach(b => job.seen.add(b.id));
    $$('.skel', shelf).forEach(x => x.parentNode.removeChild(x));
    if (first && !fresh.length) { r.parentNode.removeChild(r); return; }
    shelf.insertAdjacentHTML('beforeend', fresh.map((b, i) => bookHTML(b, { meter: job.meter, i: first ? Math.min(i, 12) : 0, cls: 'rise' })).join(''));
    if (fresh.length < 6 || job.page >= MAX_PAGES) job.done = true;
  } catch {
    if (!r.isConnected) return;
    $$('.skel', shelf).forEach(x => x.parentNode.removeChild(x));
    if (first) shelf.outerHTML = '<p class="row-empty">This shelf didn\'t load. Open Library may be busy; try again in a minute.</p>';
    job.done = true;
  } finally {
    job.busy = false;
    r._upd?.();
  }
}

function wireArrows(r) {
  const s = $('.shelf', r), p = $('.prev', r), n = $('.next', r);
  if (!s) return () => {};
  const upd = () => {
    p.disabled = s.scrollLeft < 8;
    n.disabled = s.scrollLeft + s.clientWidth > s.scrollWidth - 8 && loaders.get(r.dataset.row)?.done !== false;
    // near the end of a live shelf: fetch the next page
    if (s.scrollLeft + s.clientWidth > s.scrollWidth - 600 && loaders.get(r.dataset.row)?.page > 0) loadMore(r, false);
  };
  s.addEventListener('scroll', upd, { passive: true });
  upd();
  p.onclick = () => s.scrollBy({ left: -s.clientWidth * 0.8, behavior: 'smooth' });
  n.onclick = () => s.scrollBy({ left: s.clientWidth * 0.8, behavior: 'smooth' });
  return upd;
}

const io = new IntersectionObserver(entries => {
  entries.forEach(en => {
    if (!en.isIntersecting) return;
    io.unobserve(en.target);
    loadMore(en.target, true);
  });
}, { rootMargin: '400px 0px' });

export function wireRows(root) {
  $$('.row', root).forEach(r => {
    if (r._wired) return;
    r._wired = true;
    r._upd = wireArrows(r);
    if (loaders.has(r.dataset.row)) io.observe(r);
  });
}
