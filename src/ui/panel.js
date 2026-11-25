// Full-screen panels that keep readers inside Spine for books that live on another service:
//   borrow   — a preview of a borrowable book; borrowing itself happens in the Archive's own window
//              (archive.org keeps you signed in only on its own site: its cookies are SameSite=Lax, so a
//              sign-in made inside a frame on Spine is dropped at once — that is why it kept asking)
//   textbook — OpenStax's online textbook
// Each panel has "Open in browser" for anyone who prefers the original site.
import { $, esc, fetchJSON, fadeOut } from '../lib/util.js';
import { store } from '../lib/store.js';
import { borrowURL } from '../lib/openlibrary.js';
import { I } from './icons.js';

let P = null;
export const panelOpen = () => !!P;


/** Pick an English edition the Internet Archive can lend, so readers don't land on a translation. */
async function lendingItem(b) {
  try {
    const d = await fetchJSON(`https://openlibrary.org/works/${b.id}/editions.json?limit=60`, { timeout: 10000 });
    const eds = (d.entries || []).filter(e => e.ocaid);
    const eng = eds.find(e => (e.languages || []).some(l => l.key === '/languages/eng'));
    return (eng || eds[0])?.ocaid || b.lend;
  } catch { return b.lend; }
}

export async function openPanel(b, kind, { onClose } = {}) {
  closePanel(true, true);
  const el = document.createElement('div');
  el.className = 'scan panel';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  const textbook = kind === 'textbook';
  const ext = textbook ? b.web : borrowURL(b);
  el.setAttribute('aria-label', textbook ? `${b.title}, textbook` : `Borrow ${b.title}`);
  el.innerHTML = `<div class="rbar top">
      <button class="rbtn" data-close>${I.arrowL}<span>Close</span></button>
      <p class="rtitle"><b>${esc(b.title)}</b> · ${textbook ? 'OpenStax textbook' : 'from the Internet Archive lending library'}</p>
      ${textbook && b.pdf ? `<a class="ext" href="${b.pdf}" target="_blank" rel="noopener">${I.down} PDF</a>` : ''}
      <a class="ext" href="${ext}" target="_blank" rel="noopener">Open in browser ${I.ext}</a>
    </div>
    ${textbook ? '' : '<div class="borrow-bar" role="status" aria-live="polite"></div>'}
    <div class="panel-frame"><div class="r-status"><div class="lines"></div><b>Opening</b><span>${textbook ? 'Loading the textbook from OpenStax…' : 'Finding an English edition to borrow…'}</span></div></div>`;
  document.body.appendChild(el);
  document.body.style.overflow = 'hidden';
  P = { el, b, kind, onClose, started: Date.now(), active: 0, last: Date.now() };
  P.timer = setInterval(() => { if (P && document.visibilityState === 'visible') { P.active += Date.now() - P.last; } if (P) P.last = Date.now(); }, 15000);
  $('[data-close]', el).onclick = () => closePanel();
  $('[data-close]', el).focus();
  
  if (textbook) {
    store.setProgress(b, { pct: store.progress(b.id)?.pct || 0.01, chTitle: 'Reading online' });
    mountFrame(b.web, `${b.title} on OpenStax`);
  } else {
    store.markBorrowed(b);
    store.track('borrow_open', b);
    const item = await lendingItem(b);
    if (!P || P.el !== el) return;
    if (!item) { $('.panel-frame', el).innerHTML = `<div class="r-status"><b>No copy to borrow</b><span>The Internet Archive doesn't have a lending copy of this book right now.</span><a href="${ext}" target="_blank" rel="noopener">See it on Open Library</a></div>`; return; }
    P.item = item;
    const embed = `https://archive.org/details/${encodeURIComponent(item)}?view=theater&ui=embed&wrapper=false`;
    mountFrame(embed, `${b.title} on the Internet Archive`);
    paintBorrowBar();
  }
}

// ---------- the Archive window ----------
// Borrowing and signing in happen in a window of archive.org's own, opened from Spine. Spine stays open
// behind it, keeps the reader's place, and notices when the window is closed.

const WIN = 'spine-archive';
let W = null; // { win, poll, opened, onClosed }

export function archiveWindow(url, onClosed) {
  const w = Math.min(screen.availWidth || 1200, 1180), h = screen.availHeight || 900;
  const left = Math.max(0, ((screen.availWidth || w) - w) / 2);
  // keep the handle (no noopener) so Spine can see when the window closes and bring it to the front
  const win = window.open(url, WIN, `popup=yes,width=${w},height=${h},left=${left},top=0`);
  if (!win) { window.open(url, '_blank'); return null; } // a blocked window falls back to a tab
  try { win.focus(); } catch {}
  if (W) clearInterval(W.poll);
  W = { win, opened: Date.now(), onClosed };
  W.poll = setInterval(() => {
    if (!W || !W.win.closed) return paintBorrowBar(true);
    const done = W; clearInterval(done.poll); W = null;
    done.onClosed?.(Math.round((Date.now() - done.opened) / 1000));
    paintBorrowBar();
  }, 1000);
  return win;
}

const minutes = s => (s < 60 ? 'just now' : `${Math.round(s / 60)} min`);

function paintBorrowBar(tick) {
  const bar = P?.el && $('.borrow-bar', P.el);
  if (!bar) return;
  const reading = W && !W.win.closed;
  if (reading) {
    const t = minutes((Date.now() - W.opened) / 1000);
    if (tick && $('[data-t]', bar)) { $('[data-t]', bar).textContent = t; return; }
    bar.className = 'borrow-bar on';
    bar.innerHTML = `<span class="dot" aria-hidden="true"></span>
      <div class="bt"><b>Reading in the Archive window</b> · <span data-t>${t}</span><br><span>Spine is keeping your place. Close that window when you're done.</span></div>
      <button class="btn btn-ink sm" data-show>Show the book</button>
      <button class="btn btn-line sm" data-finish>I'm done</button>`;
    $('[data-show]', bar).onclick = () => { try { W.win.focus(); } catch {} };
    $('[data-finish]', bar).onclick = () => { try { W.win.close(); } catch {} };
    return;
  }
  if (tick) return;
  const known = store.prefs.archive;
  bar.className = 'borrow-bar';
  bar.innerHTML = `<div class="bt"><b>This is a preview.</b> ${known
      ? 'To read the whole book, borrow it in the Archive window, where you signed in before.'
      : 'To read the whole book, borrow it free from the Internet Archive. It opens in a window of its own; the first time, you sign in there or make a free account, and it remembers you after that.'}
      <details><summary>Why a separate window?</summary>The Archive only keeps you signed in on its own website, so a sign-in inside Spine would be forgotten right away. Your password goes to archive.org, never to Spine.</details></div>
    <button class="btn btn-ink sm" data-borrow>${I.scan} Borrow and read</button>`;
  $('[data-borrow]', bar).onclick = () => {
    if (!P?.item) return;
    archiveWindow(`https://archive.org/details/${encodeURIComponent(P.item)}`, seconds => {
      if (seconds > 20 && !store.prefs.archive) { store.prefs.archive = true; store.savePrefs(); }
    });
    paintBorrowBar();
  };
}

function mountFrame(src, title) {
  const f = $('.panel-frame', P.el);
  f.innerHTML = `<iframe src="${src}" title="${esc(title)}" allow="fullscreen; clipboard-write" allowfullscreen referrerpolicy="no-referrer-when-downgrade"></iframe>`;
}

export function closePanel(instant, silent) {
  if (!P) return false;
  const { el, onClose, b, kind } = P;
  clearInterval(P.timer);
  const seconds = Math.round((P.active + (document.visibilityState === 'visible' ? Date.now() - P.last : 0)) / 1000);
  store.addSession({ book_id: b.id, mode: kind, started_at: new Date(P.started).toISOString(), ended_at: new Date().toISOString(), seconds, from_progress: 0, to_progress: 0, pages: 0 });
  P = null;
  document.body.style.overflow = '';
  if (instant) el.remove();
  else fadeOut(el, 200);
  if (!silent) onClose?.();
  return true;
}

/**
 * Sign in to the Internet Archive in its own window (a frame inside Spine can't keep the sign-in).
 * The password goes straight to archive.org. onDone(true) once that window is closed again.
 */
export function openLogin({ onDone } = {}) {
  const win = archiveWindow('https://archive.org/account/login', () => {
    store.prefs.archive = true; store.savePrefs();
    onDone?.(true);
  });
  if (!win) { store.prefs.archive = true; store.savePrefs(); onDone?.(true); }
}
