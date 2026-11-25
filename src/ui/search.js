import { go } from '../lib/router.js';
import { $, $$, esc, debounce } from '../lib/util.js';
import { search, searchTextbooks, coverURL } from '../lib/openlibrary.js';
import { store } from '../lib/store.js';

function mark(s, term) {
  const i = s.toLowerCase().indexOf(term.toLowerCase());
  return i < 0 ? esc(s) : esc(s.slice(0, i)) + '<mark>' + esc(s.slice(i, i + term.length)) + '</mark>' + esc(s.slice(i + term.length));
}

export function installSearch() {
  const box = $('#search'), q = $('#q');
  let sel = -1, seq = 0;
  const close = () => { $('.results', box)?.remove(); sel = -1; q.setAttribute('aria-expanded', 'false'); };
  const show = html => {
    let r = $('.results', box);
    if (!r) { box.insertAdjacentHTML('beforeend', '<div class="results" role="listbox" id="results"></div>'); r = $('.results', box); }
    r.innerHTML = html;
    q.setAttribute('aria-expanded', 'true');
  };
  const run = debounce(async term => {
    const my = ++seq;
    try {
      const { books, total } = await search({ q: term, mode: 'all', sort: 'relevance', limit: 7, english: false });
      if (my !== seq || q.value.trim() !== term) return;
      const tbs = store.sources.openstax !== false ? searchTextbooks(term).slice(0, 2) : [];
      const all = [...tbs, ...books].slice(0, 8);
      show(all.length
        ? all.map(b => `<a class="result" role="option" href="/book/${b.id}">${b.coverArt ? `<img src="${b.coverArt}" alt="" style="background:${b.tone}">` : b.cover ? `<img src="${coverURL(b, 'S')}" alt="">` : `<span style="width:34px;height:50px;border-radius:2px 4px 4px 2px;background:${b.tone};flex:none"></span>`}<div><b>${mark(b.title, term)}</b><span>${mark(b.author, term)}${b.year ? ` · ${esc(b.year)}` : ''}${b.kind === 'textbook' ? ' · Textbook' : b.access === 'borrowable' ? ' · Borrow free' : ''}</span></div></a>`).join('')
          + (total > books.length ? `<a class="result" role="option" href="/discover?q=${encodeURIComponent(term)}&mode=all&sort=relevance"><div><b>See all ${total.toLocaleString('en-US')} results</b></div></a>` : '')
        : `<p class="empty">No free books match “${esc(term)}”. Try an author's surname or fewer words.</p>`);
    } catch {
      if (my === seq) show('<p class="empty">Search is unavailable right now. Check your connection.</p>');
    }
  }, 260);

  q.addEventListener('input', () => {
    const t = q.value.trim();
    if (t.length < 2) { close(); seq++; return; }
    show('<p class="empty">Searching…</p>');
    run(t);
  });
  q.addEventListener('keydown', e => {
    const items = $$('.result', box);
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && items.length) {
      e.preventDefault();
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((x, i) => x.setAttribute('aria-selected', i === sel));
    }
    if (e.key === 'Enter') {
      seq++; // a search still on its way must not reopen the list
      if (items[sel]) items[sel].click();
      else if (q.value.trim()) store.track('search', null, { q: q.value.trim() }), go(`/discover?q=${encodeURIComponent(q.value.trim())}&mode=all&sort=relevance`);
      close(); q.blur();
    }
    if (e.key === 'Escape') { close(); q.blur(); }
  });
  document.addEventListener('click', e => {
    if (e.target.closest('.result')) { close(); q.value = ''; return; }
    if (!box.contains(e.target)) close();
  });
}
