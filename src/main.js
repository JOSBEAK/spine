import './styles.css';
import { $, $$ } from './lib/util.js';
import { store } from './lib/store.js';
import { known, getBook } from './lib/openlibrary.js';
import { installTilt } from './ui/book.js';
import { installSearch } from './ui/search.js';
import { flyToDetail, openBookAnimation, isBusy } from './ui/motion.js';
import { openReader, closeReader, readerOpen, readerKey } from './ui/reader.js';
import { openScan, closeScan } from './ui/scan.js';
import { listen } from './ui/player.js';
import { toast } from './ui/toast.js';
import { home } from './views/home.js';
import { discover } from './views/discover.js';
import { library } from './views/library.js';
import { sources } from './views/sources.js';
import { bookPage, bookLoading, loadBookPage } from './views/book.js';

const view = $('#view');
let current = null;      // key of the page currently rendered under any overlay
let pushedOverlay = false;

function parse() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs = ''] = h.split('?');
  const [name = '', id = ''] = path.split('/');
  return { name: name || 'home', id, params: new URLSearchParams(qs), key: `${path}?${qs}` };
}

const actions = {
  read(b, btn) {
    const src = $('.stage3d .bk', view) || btn?.closest('.hero')?.querySelector('.bk') || $(`.bk[data-id="${b.id}"]`, view);
    openBookAnimation(src, b, fromOpen => {
      showReader(b, fromOpen);
      pushedOverlay = true;
      location.hash = `#/read/${b.id}`;
    });
  },
  scan(b) {
    showScan(b);
    pushedOverlay = true;
    location.hash = `#/scan/${b.id}`;
  },
  listen(b) { listen(b); },
  epub() {},
};

function leaveOverlay(b) {
  if (!/^#\/(read|scan)\//.test(location.hash)) return;
  if (pushedOverlay) { pushedOverlay = false; history.back(); }
  else location.replace(`#/book/${b.id}`);
}
const showReader = (b, fromOpen) => openReader(b, { fromOpen, onClose: () => leaveOverlay(b), onScan: () => actions.scan(b) });
const showScan = b => openScan(b, { onClose: () => leaveOverlay(b) });

function setNav(name) {
  const sect = ['home', 'discover', 'library', 'sources'].includes(name) ? name : null;
  $$('[data-nav]').forEach(a => (a.dataset.nav === sect ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
}

function mount(v, title) {
  view.innerHTML = v.html;
  v.wire(view, actions);
  document.title = title ? `${title} · Spine` : 'Spine · free books to read and hear';
}

async function renderBase(r) {
  current = r.key;
  setNav(r.name);
  const keep = window.__keepScroll; window.__keepScroll = false;
  const y = scrollY;
  if (r.name === 'book' || r.name === 'read' || r.name === 'scan') {
    const b = known.get(r.id);
    if (b?.title) mount(bookPage(b), b.title);
    else {
      mount(bookLoading());
      try {
        const v = await loadBookPage(r.id);
        if (current !== r.key) return;
        mount(v, known.get(r.id)?.title);
      } catch {
        if (current !== r.key) return;
        view.innerHTML = '<p class="none pad">This book could not be found. It may have been merged into another record on Open Library. <a href="#/">Back to Home</a></p>';
      }
    }
  }
  else if (r.name === 'discover') mount(discover(r.params), r.params.get('q') || 'Discover');
  else if (r.name === 'library') mount(library(), 'Your library');
  else if (r.name === 'sources') mount(sources(), 'Sources');
  else mount(home());
  scrollTo(0, keep ? y : 0);
}

async function render() {
  const r = parse();
  const overlay = r.name === 'read' || r.name === 'scan';
  if (!overlay && readerOpen()) closeReader(false, true);
  if (r.name !== 'scan') closeScan(false, true);
  if (!overlay && r.key !== current) await renderBase(r);
  if (overlay) {
    if (current === null) await renderBase({ ...r, key: `book/${r.id}?` });
    let b = known.get(r.id);
    if (!b) { try { b = await getBook(r.id); } catch { toast('That book could not be found.'); location.replace('#/'); return; } }
    if (r.name === 'read' && !readerOpen()) showReader(b, false);
    if (r.name === 'scan' && !$('.scan')) {
      if (b.scan) showScan(b); else { toast('There is no public scan of this book.'); location.replace(`#/book/${b.id}`); }
    }
  }
}

addEventListener('hashchange', () => { if (!isBusy()) render(); });

// A book on a shelf flies into its own page.
document.addEventListener('click', e => {
  const a = e.target.closest('a.bk');
  if (!a || a.closest('.stage3d') || a.closest('#stage') || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
  e.preventDefault();
  if (isBusy()) return;
  const id = a.dataset.id;
  flyToDetail(a, () => { history.pushState(null, '', `#/book/${id}`); renderBase(parse()); });
});

// Buttons outside the book page: hero "Keep reading", "Listen instead".
document.addEventListener('click', e => {
  const r = e.target.closest('[data-read]');
  const l = e.target.closest('[data-listen]');
  if (!r && !l) return;
  e.preventDefault();
  const b = known.get((r || l).dataset.read || (r || l).dataset.listen) || store.book((r || l).dataset.read || (r || l).dataset.listen);
  if (!b) return;
  if (r) actions.read(b, r); else actions.listen(b);
});

document.addEventListener('keydown', e => {
  if (readerKey(e)) return;
  if (e.key === 'Escape' && closeScan()) return;
  if (e.key === '/' && !e.target.closest('input, textarea')) { e.preventDefault(); $('#q').focus(); }
});

installTilt();
installSearch();
render();

// Bring back the audiobook you were listening to, paused where you left it.
const a = store.audio;
if (a && store.book(a.bookId)) listen(store.book(a.bookId), { resume: true });
