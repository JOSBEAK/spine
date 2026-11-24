// Full-screen panels that keep readers inside Spine for books that live on another service:
//   borrow   — the Internet Archive's own reader for a borrowable book (preview, borrow, read)
//   textbook — OpenStax's online textbook
// Each panel has "Open in browser" for anyone who prefers the original site.
import { $, esc, fetchJSON, fadeOut } from '../lib/util.js';
import { store } from '../lib/store.js';
import { borrowURL } from '../lib/openlibrary.js';
import { I } from './icons.js';

let P = null;
export const panelOpen = () => !!P;

const isSafari = () => /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent);

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
      <p class="rtitle"><b>${esc(b.title)}</b> · ${textbook ? 'OpenStax textbook' : 'borrowed from the Internet Archive'}</p>
      ${textbook && b.pdf ? `<a class="ext" href="${b.pdf}" target="_blank" rel="noopener">${I.down} PDF</a>` : ''}
      ${textbook ? '' : `<button class="ext" data-signin>${I.user} Sign in to borrow</button>`}
      <a class="ext" href="${ext}" target="_blank" rel="noopener">Open in browser ${I.ext}</a>
    </div>
    ${textbook ? '' : `<div class="panel-help" role="note">
      <p><b>Borrowing is free.</b> The Internet Archive lends each copy to one reader at a time, so it asks you to sign in with a free account. You sign in on their page right here; Spine never sees your password.
      ${isSafari() ? ' <b>Safari blocks signing in inside other sites</b>, so if it doesn\'t stick, use “Open in browser”.' : ''}</p>
      <button class="ext" data-hide-help aria-label="Hide this note">${I.x}</button>
    </div>`}
    <div class="panel-frame"><div class="r-status"><div class="lines"></div><b>Opening</b><span>${textbook ? 'Loading the textbook from OpenStax…' : 'Finding an English edition to borrow…'}</span></div></div>`;
  document.body.appendChild(el);
  document.body.style.overflow = 'hidden';
  P = { el, b, kind, onClose, started: Date.now(), active: 0, last: Date.now() };
  P.timer = setInterval(() => { if (P && document.visibilityState === 'visible') { P.active += Date.now() - P.last; } if (P) P.last = Date.now(); }, 15000);
  $('[data-close]', el).onclick = () => closePanel();
  $('[data-close]', el).focus();
  $('[data-hide-help]', el)?.addEventListener('click', e => e.currentTarget.parentElement.remove());

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
    $('[data-signin]', el).onclick = () => {
      // the Archive's login page sends the reader back to the book afterwards
      mountFrame(`https://archive.org/account/login?referer=${encodeURIComponent(embed)}`, 'Sign in to the Internet Archive');
    };
  }
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

/** The Internet Archive's own sign-in page, inside Spine. The password goes straight to archive.org. */
export function openLogin({ onDone } = {}) {
  closePanel(true, true);
  const el = document.createElement('div');
  el.className = 'scan panel';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Sign in to the Internet Archive');
  el.innerHTML = `<div class="rbar top">
      <button class="rbtn" data-close>${I.arrowL}<span>Cancel</span></button>
      <p class="rtitle"><b>Internet Archive</b> · sign in to borrow books inside Spine</p>
      <a class="ext" href="https://archive.org/account/signup" target="_blank" rel="noopener">Create a free account ${I.ext}</a>
      <button class="btn btn-ink sm" data-done>I'm signed in</button>
    </div>
    <div class="panel-help" role="note"><p>This is the Internet Archive's own page. Your password goes to archive.org, not to Spine.${isSafari() ? ' <b>Safari blocks signing in inside other sites</b>; if it doesn\'t stick, sign in at archive.org in a new tab and use “Open in browser” for borrowed books.' : ''}</p></div>
    <div class="panel-frame"><iframe src="https://archive.org/account/login" title="Internet Archive sign in" allow="clipboard-write"></iframe></div>`;
  document.body.appendChild(el);
  document.body.style.overflow = 'hidden';
  const close = ok => { document.body.style.overflow = ''; el.remove(); if (ok) { store.prefs.archive = true; store.savePrefs(); } onDone?.(ok); };
  $('[data-close]', el).onclick = () => close(false);
  $('[data-done]', el).onclick = () => close(true);
  $('[data-done]', el).focus();
}
