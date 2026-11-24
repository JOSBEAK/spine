import { $, $$, esc } from '../lib/util.js';
import { search, searchTextbooks } from '../lib/openlibrary.js';
import { store } from '../lib/store.js';
import { NONFICTION, FICTION, shelfByKey } from '../lib/shelves.js';
import { bookHTML, skeletonHTML } from '../ui/book.js';

const fmt = n => n.toLocaleString('en-US');
const PAGE = 36;

const MODES = [
  ['all', 'Everything', 'Classics you can read right now, plus modern books you can borrow free.'],
  ['read', 'Read now, no sign-in', 'Public-domain books you can open straight away, as clean text or scanned pages.'],
  ['clean', 'Clean text in Spine', 'Books with proofread text that open in the Spine reader.'],
  ['borrow', 'Borrow free', 'Modern books from the Internet Archive’s free lending library. Borrowing needs a free archive.org account.'],
];

export function discover(params) {
  const f = {
    q: params.get('q') || '',
    shelf: params.get('shelf') || '',
    subject: params.get('subject') || '',
    label: params.get('label') || '',
    mode: params.get('mode') || 'all',
    era: params.get('era') || 'any',
    sort: params.get('sort') || (params.get('q') ? 'relevance' : 'readinglog'),
    english: params.get('english') !== 'no',
  };
  const lending = store.sources.lending !== false;
  const modes = MODES.filter(([k]) => lending || (k !== 'all' && k !== 'borrow'));
  if (!modes.some(([k]) => k === f.mode)) f.mode = 'read';
  const sh = shelfByKey(f.shelf);
  const textbookShelf = sh?.textbooks;

  const link = patch => {
    const p = new URLSearchParams({ q: f.q, shelf: f.shelf, subject: f.subject, label: f.label, mode: f.mode, era: f.era, sort: f.sort, english: f.english ? 'yes' : 'no', ...patch });
    [...p].forEach(([k, v]) => { if (!v) p.delete(k); });
    return '#/discover?' + p;
  };
  const chip = (on, label, patch) => `<a class="chip" role="button" href="${link(patch)}" aria-pressed="${on}">${esc(label)}</a>`;
  const shelfChip = s => chip(f.shelf === s.key, s.label, { shelf: f.shelf === s.key ? '' : s.key, subject: '', label: '' });

  const title = f.q ? `“${esc(f.q)}”` : sh ? esc(sh.title) : f.subject ? esc(f.label || f.subject) : 'Discover';
  const sub = textbookShelf ? 'Complete university textbooks from OpenStax at Rice University. Free to read online or download as a PDF.' : (MODES.find(m => m[0] === f.mode) || MODES[0])[2];
  const html = `
    <h1 class="page-title">${title}</h1>
    <p class="page-sub">${sub}</p>
    <div class="filters">
      ${textbookShelf ? '' : `<div class="chips"><span class="lbl">Show</span>${modes.map(([k, n]) => chip(f.mode === k, n, { mode: k })).join('')}</div>`}
      <div class="chips"><span class="lbl">Learn</span>${chip(!f.shelf && !f.subject, 'Everything', { shelf: '', subject: '', label: '' })}${NONFICTION.filter(s => !s.textbooks || store.sources.openstax !== false).map(shelfChip).join('')}</div>
      <div class="chips"><span class="lbl">Stories</span>${FICTION.map(shelfChip).join('')}${f.subject ? chip(true, f.label || f.subject, { subject: '', label: '' }) : ''}</div>
      ${textbookShelf ? '' : `
      <div class="chips"><span class="lbl">Written</span>${chip(f.era === 'any', 'Any time', { era: 'any' })}${chip(f.era === 'old', 'Before 1800', { era: 'old' })}${chip(f.era === '1800s', '1800s', { era: '1800s' })}${chip(f.era === '1900s', '1900–1949', { era: '1900s' })}${chip(f.era === 'modern', '1950 and later', { era: 'modern' })}</div>
      <div class="chips"><span class="lbl">Order</span>${f.q ? chip(f.sort === 'relevance', 'Best match', { sort: 'relevance' }) : ''}${chip(f.sort === 'readinglog', 'Most read', { sort: 'readinglog' })}${chip(f.sort === 'editions', 'Most printed', { sort: 'editions' })}${chip(f.sort === 'old', 'Oldest first', { sort: 'old' })}${chip(f.sort === 'new', 'Newest first', { sort: 'new' })}${chip(f.sort === 'random', 'Surprise me', { sort: 'random' })}</div>
      <div class="chips"><span class="lbl">Language</span>${chip(f.english, 'English', { english: 'yes' })}${chip(!f.english, 'Any language', { english: 'no' })}</div>`}
    </div>
    <p class="count" aria-live="polite">${textbookShelf ? '' : 'Looking…'}</p>
    <div class="grid">${textbookShelf ? '' : skeletonHTML(12)}</div>
    <div class="more" aria-live="polite"></div>`;

  return {
    html,
    wire(root) {
      $$('a.chip', root).forEach(a => a.addEventListener('click', () => { window.__keepScroll = true; }));
      const grid = $('.grid', root), count = $('.count', root), more = $('.more', root);

      if (textbookShelf) {
        const list = searchTextbooks(f.q);
        count.textContent = `${list.length} textbooks`;
        grid.innerHTML = list.map((b, i) => bookHTML(b, { i: Math.min(i, 18), cls: 'rise' })).join('') || '<p class="none">No textbook matches that search.</p>';
        return;
      }

      let page = 1, total = 0, shown = 0, loading = false, done = false;
      const seen = new Set();
      const clearSkel = () => $$('.skel', grid).forEach(x => x.parentNode.removeChild(x));
      const subject = sh?.q || f.subject;
      async function next() {
        if (loading || done) return;
        loading = true;
        more.textContent = '';
        if (page > 1) grid.insertAdjacentHTML('beforeend', skeletonHTML(6));
        try {
          const r = await search({ q: f.q, subject, mode: f.mode, era: f.era, english: f.english, sort: f.sort, page, limit: PAGE });
          if (!root.isConnected) return;
          total = r.total;
          const fresh = r.books.filter(b => !seen.has(b.id));
          fresh.forEach(b => seen.add(b.id));
          if (page === 1) {
            grid.innerHTML = '';
            // matching textbooks go first in a search
            if (f.q && !sh && store.sources.openstax !== false) {
              const tbs = searchTextbooks(f.q).slice(0, 6);
              grid.insertAdjacentHTML('beforeend', tbs.map((b, i) => bookHTML(b, { i, cls: 'rise' })).join(''));
            }
          }
          clearSkel();
          grid.insertAdjacentHTML('beforeend', fresh.map((b, i) => bookHTML(b, { i: Math.min(i, 18), cls: 'rise' })).join(''));
          shown += r.books.length;
          done = r.books.length === 0 || shown >= total;
          page++;
          count.textContent = total ? `${fmt(total)} ${total === 1 ? 'book' : 'books'}` : '';
          if (!total && !grid.children.length) grid.outerHTML = `<p class="none">${f.mode === 'clean' ? 'No clean-text books match. Try “Everything”, or turn a filter off.' : 'Nothing matches. Try a shorter search or turn a filter off.'}</p>`;
          more.textContent = done && shown > PAGE ? 'That’s everything.' : '';
        } catch {
          count.textContent = '';
          clearSkel();
          if (page === 1) grid.innerHTML = `<p class="none">Open Library didn't answer. Check your connection and <a href="${location.hash}" onclick="location.reload()">try again</a>.</p>`;
          else more.textContent = "Couldn't load more right now.";
        } finally {
          loading = false;
          if (!done && root.isConnected && more.getBoundingClientRect().top < innerHeight + 600) requestAnimationFrame(next);
        }
      }
      next();
      const io = new IntersectionObserver(e => { if (!root.isConnected) io.disconnect(); else if (e[0].isIntersecting) next(); }, { rootMargin: '600px 0px' });
      io.observe(more);
    },
  };
}
