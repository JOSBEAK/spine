import { $, $$, esc } from '../lib/util.js';
import { search } from '../lib/openlibrary.js';
import { bookHTML, skeletonHTML } from '../ui/book.js';

export const SHELVES = [
  ['', 'Everything'],
  ['Love stories', 'Love stories'],
  ['Detective and mystery stories', 'Detective stories'],
  ['(subject:"Ghost stories" OR subject:"Horror tales")', 'Ghosts and horror'],
  ['Science fiction', 'Science fiction'],
  ['Adventure stories', 'Adventure'],
  ['Sea stories', 'At sea'],
  ["Children's stories", 'Young readers'],
  ['(subject:"Fairy tales" OR subject:"Fables")', 'Fairy tales'],
  ['Humorous stories', 'Funny books'],
  ['Short stories', 'Short stories'],
  ['Poetry', 'Poetry'],
  ['Drama', 'Plays'],
  ['Philosophy', 'Philosophy'],
  ['History', 'History'],
  ['Voyages and travels', 'Travel'],
];

const fmt = n => n.toLocaleString('en-US');

export function discover(params) {
  const f = {
    q: params.get('q') || '',
    subject: params.get('subject') || '',
    label: params.get('label') || '',
    mode: params.get('mode') || 'clean',
    era: params.get('era') || 'any',
    sort: params.get('sort') || (params.get('q') ? 'relevance' : 'editions'),
    english: params.get('english') !== 'no',
  };
  const known = SHELVES.some(([k]) => k === f.subject);
  const shelves = known || !f.subject ? SHELVES : [...SHELVES, [f.subject, f.label || f.subject]];
  const link = patch => {
    const p = new URLSearchParams({ ...(f.q && { q: f.q }), ...(f.subject && { subject: f.subject }), ...(f.label && { label: f.label }), mode: f.mode, era: f.era, sort: f.sort, english: f.english ? 'yes' : 'no', ...patch });
    [...p].forEach(([k, v]) => { if (!v) p.delete(k); });
    return '#/discover?' + p;
  };
  const chip = (cur, val, label, key) => `<a class="chip" href="${link({ [key]: val, ...(key === 'subject' ? { label: '' } : {}) })}" aria-pressed="${cur === val}" role="button">${esc(label)}</a>`;
  const html = `
    <h1 class="page-title">${f.q ? `“${esc(f.q)}”` : 'Discover'}</h1>
    <p class="page-sub">${f.mode === 'clean' ? 'Books with clean, typeset text you can read right here.' : 'Every free book on Open Library, including ones that only exist as scanned pages.'}</p>
    <div class="filters">
      <div class="chips"><span class="lbl">Show</span>${chip(f.mode, 'clean', 'Clean text', 'mode')}${chip(f.mode, 'all', 'Everything free, scans too', 'mode')}</div>
      <div class="chips"><span class="lbl">Shelf</span>${shelves.map(([k, n]) => chip(f.subject, k, n, 'subject')).join('')}</div>
      <div class="chips"><span class="lbl">Written</span>${chip(f.era, 'any', 'Any time', 'era')}${chip(f.era, 'old', 'Before 1800', 'era')}${chip(f.era, '1800s', '1800s', 'era')}${chip(f.era, '1900s', '1900 and later', 'era')}</div>
      <div class="chips"><span class="lbl">Order</span>${f.q ? chip(f.sort, 'relevance', 'Best match', 'sort') : ''}${chip(f.sort, 'editions', 'Most printed', 'sort')}${chip(f.sort, 'old', 'Oldest first', 'sort')}${chip(f.sort, 'random', 'Surprise me', 'sort')}
</div>
      <div class="chips"><span class="lbl">Language</span><a class="chip" role="button" href="${link({ english: 'yes' })}" aria-pressed="${f.english}">English</a><a class="chip" role="button" href="${link({ english: 'no' })}" aria-pressed="${!f.english}">Any language</a></div>
    </div>
    <p class="count" aria-live="polite">Looking…</p>
    <div class="grid">${skeletonHTML(12)}</div>
    <div class="more" aria-live="polite"></div>`;

  return {
    html,
    wire(root) {
      const grid = $('.grid', root), count = $('.count', root), more = $('.more', root);
      let page = 1, total = 0, shown = 0, loading = false, done = false;
      const seen = new Set();
      const clearSkel = () => $$('.skel', grid).forEach(x => x.parentNode.removeChild(x));
      async function next() {
        if (loading || done) return;
        loading = true;
        more.textContent = '';
        if (page > 1) grid.insertAdjacentHTML('beforeend', skeletonHTML(6));
        try {
          const r = await search({ q: f.q, subject: f.subject, mode: f.mode, era: f.era, english: f.english, sort: f.sort, page, limit: 36 });
          if (!root.isConnected) return;
          total = r.total;
          const fresh = r.books.filter(b => !seen.has(b.id));
          fresh.forEach(b => seen.add(b.id));
          if (page === 1) grid.innerHTML = '';
          clearSkel();
          grid.insertAdjacentHTML('beforeend', fresh.map((b, i) => bookHTML(b, { i: Math.min(i, 18), cls: 'rise' })).join(''));
          shown += fresh.length;
          done = r.books.length < 36 || shown >= total;
          page++;
          count.textContent = total ? `${fmt(total)} ${total === 1 ? 'book' : 'books'}` : '';
          if (!total) grid.outerHTML = `<p class="none">${f.mode === 'clean' ? 'No clean-text books match. Try “Everything free, scans too”, or turn a filter off.' : 'Nothing matches. Try a shorter search or turn a filter off.'}</p>`;
          more.textContent = done && shown > 36 ? 'That’s everything.' : '';
        } catch {
          count.textContent = '';
          if (page === 1) grid.innerHTML = `<p class="none">Open Library didn't answer. Check your connection and <a href="${location.hash}" onclick="location.reload()">try again</a>.</p>`;
          else { clearSkel(); more.textContent = "Couldn't load more right now."; }
        } finally {
          loading = false;
          // keep filling while the end of the list is still on screen
          if (!done && root.isConnected && more.getBoundingClientRect().top < innerHeight + 600) requestAnimationFrame(next);
        }
      }
      next();
      const io = new IntersectionObserver(e => { if (!root.isConnected) io.disconnect(); else if (e[0].isIntersecting) next(); }, { rootMargin: '600px 0px' });
      io.observe(more);
      $$('a.chip', root).forEach(a => a.addEventListener('click', () => { window.__keepScroll = true; }));
    },
  };
}
