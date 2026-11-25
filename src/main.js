import './styles.css';
import { $, $$, esc } from './lib/util.js';
import { store } from './lib/store.js';
import { known, getBook } from './lib/openlibrary.js';
import { accountsEnabled } from './lib/api.js';
import { startSync } from './lib/sync.js';
import { countRead } from './lib/reads.js';
import { installTilt } from './ui/book.js';
import { installSearch } from './ui/search.js';
import { flyToDetail, openBookAnimation, isBusy } from './ui/motion.js';
import { openReader, closeReader, readerOpen, readerKey } from './ui/reader.js';
import { openPanel, closePanel, panelOpen } from './ui/panel.js';
import { listen } from './ui/player.js';
import { toast } from './ui/toast.js';
import { home } from './views/home.js';
import { discover } from './views/discover.js';
import { library } from './views/library.js';
import { sources } from './views/sources.js';
import { account, loadLinks } from './views/account.js';
import { bookPage, bookLoading, loadBookPage } from './views/book.js';

const view = $('#view');
let current = null;      // key of the page currently rendered under any overlay
let pushedOverlay = false;
const OVERLAYS = ['read', 'scan', 'borrow', 'textbook'];

function parse() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs = ''] = h.split('?');
  const [name = '', id = ''] = path.split('/');
  return { name: name || 'home', id: decodeURIComponent(id), params: new URLSearchParams(qs), key: `${path}?${qs}` };
}

function goOverlay(kind, b) { pushedOverlay = true; location.hash = `#/${kind}/${encodeURIComponent(b.id)}`; }

const actions = {
  // clean text, with the book-opening animation
  read(b, btn) {
    const src = $('.stage3d .bk', view) || btn?.closest('.hero')?.querySelector('.bk') || $(`.bk[data-id="${b.id}"]`, view);
    const p = store.progress(b.id);
    // reopen a book the way it was being read last time
    if (b.kind === 'textbook') return actions.textbook(b);
    if (p?.mode === 'scan' || (p?.page != null && p?.ch == null)) return actions.scan(b, btn);
    if (b.access === 'borrowable' && !b.gut) return actions.borrow(b);
    openBookAnimation(src, b, fromOpen => { showOverlay('read', b, fromOpen); goOverlay('read', b); });
  },
  // the printed pages, in Spine's own reader
  scan(b, btn) {
    const src = $('.stage3d .bk', view) || btn?.closest('.hero')?.querySelector('.bk');
    openBookAnimation(src, b, fromOpen => { showOverlay('scan', b, fromOpen); goOverlay('scan', b); });
  },
  borrow(b) { showOverlay('borrow', b); goOverlay('borrow', b); },
  textbook(b) { showOverlay('textbook', b); goOverlay('textbook', b); },
  listen(b) { store.track('listen', b); listen(b); },
  epub() {},
  rerender() { current = null; render(); },
};

function leaveOverlay(b) {
  if (!new RegExp(`^#/(${OVERLAYS.join('|')})/`).test(location.hash)) return;
  if (pushedOverlay) { pushedOverlay = false; history.back(); }
  else location.replace(`#/book/${encodeURIComponent(b.id)}`);
}

function showOverlay(kind, b, fromOpen = false) {
  const onClose = () => leaveOverlay(b);
  countRead(b); // once per book per month, for "most read" and "readers this month"
  if (kind === 'read') openReader(b, { fromOpen, onClose, onScan: () => actions.scan(b) });
  else if (kind === 'scan') openReader(b, { fromOpen, onClose, mode: 'scan' });
  else openPanel(b, kind, { onClose });
}

function setNav(name) {
  const sect = ['home', 'discover', 'library', 'sources', 'account'].includes(name) ? name : null;
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
  if (r.name === 'book' || OVERLAYS.includes(r.name)) {
    const b = known.get(r.id) || (store.book(r.id)?.title ? store.book(r.id) : null);
    if (b?.title) { known.set(b.id, { ...b, ...(known.get(b.id) || {}) }); mount(bookPage(known.get(b.id)), b.title); }
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
  else if (r.name === 'account') mount(account(), 'Your account');
  else mount(home());
  scrollTo(0, keep ? y : 0);
}

async function render() {
  const r = parse();
  const overlay = OVERLAYS.includes(r.name);
  if ((!overlay || !['read', 'scan'].includes(r.name)) && readerOpen()) closeReader(false, true);
  if ((!overlay || ['read', 'scan'].includes(r.name)) && panelOpen()) closePanel(false, true);
  if (!overlay && r.key !== current) await renderBase(r);
  if (overlay) {
    if (current === null) await renderBase({ ...r, key: `book/${r.id}?` });
    let b = known.get(r.id) || store.book(r.id);
    if (!b) { try { b = await getBook(r.id); } catch { toast('That book could not be found.'); location.replace('#/'); return; } }
    if (['read', 'scan'].includes(r.name) && !readerOpen()) {
      if (r.name === 'scan' && !b.scan) { toast('There is no public scan of this book.'); location.replace(`#/book/${b.id}`); return; }
      showOverlay(r.name, b);
    }
    if (['borrow', 'textbook'].includes(r.name) && !panelOpen()) showOverlay(r.name, b);
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
  const id = (r || l).dataset.read || (r || l).dataset.listen;
  const b = known.get(id) || store.book(id);
  if (!b) return;
  if (r) actions.read(b, r); else actions.listen(b);
});

document.addEventListener('keydown', e => {
  if (readerKey(e)) return;
  if (e.key === 'Escape' && closePanel()) return;
  if (e.key === '/' && !e.target.closest('input, textarea')) { e.preventDefault(); $('#q').focus(); }
});

// The account button at the bottom of the rail shows who is signed in.
function paintAccount() {
  const a = $('[data-nav="account"]');
  if (!a) return;
  const u = store.account?.user;
  a.querySelector('.av').innerHTML = u ? `<b>${esc((u.name || u.email || '?').trim()[0].toUpperCase())}</b>` : '';
  a.lastChild.textContent = u ? 'You' : 'Account';
}
store.on(what => { if (what === 'account') paintAccount(); });

installTilt();
installSearch();
paintAccount();
render();
if (accountsEnabled()) { startSync(); loadLinks(); }

// Bring back the audiobook you were listening to, paused where you left it.
const au = store.audio;
if (au && store.book(au.bookId)) listen(store.book(au.bookId), { resume: true });
