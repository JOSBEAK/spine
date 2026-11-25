// A gentle invitation to create an account, so reading history isn't stuck in one browser.
// Never forced: it shows after a real reading sitting, at most once every few days, and stops
// for good after it has been waved away three times or once there's an account.
import { store } from '../lib/store.js';
import { accountsEnabled } from '../lib/api.js';
import { fadeOut } from '../lib/util.js';
import { I } from './icons.js';

const KEY = 'spine.v1.nudge';
const GAP_DAYS = 4;
const MAX_DISMISSALS = 3;
const MIN_SECONDS = 60; // read at least a minute in total before asking

const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || { n: 0, at: 0 }; } catch { return { n: 0, at: 0 }; } };
const save = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode */ } };

/** Opens the account page with "Create account" chosen. */
export function goSignup() {
  try { sessionStorage.setItem('spine.signup', '1'); } catch { /* ignore */ }
  if (location.hash === '#/account') dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = '#/account';
}

const sittings = () => store.history().filter(x => x.kind === 'session');
const minutesRead = () => Math.round(sittings().reduce((t, s) => t + (s.seconds || 0), 0) / 60);

function canAsk() {
  if (!accountsEnabled() || store.account?.user) return false;
  const s = load();
  if (s.n >= MAX_DISMISSALS || Date.now() - s.at < GAP_DAYS * 86400e3) return false;
  return sittings().reduce((t, x) => t + (x.seconds || 0), 0) >= MIN_SECONDS;
}

function show() {
  if (document.querySelector('.nudge') || !canAsk()) return;
  const mins = minutesRead();
  const books = new Set(sittings().map(s => s.book_id)).size;
  const el = document.createElement('aside');
  el.className = 'nudge';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-labelledby', 'nudge-h');
  el.innerHTML = `
    <button class="nudge-x" aria-label="Not now">${I.x}</button>
    <div class="nudge-ico">${I.clock}</div>
    <div>
      <h2 id="nudge-h">Keep your reading history</h2>
      <p>You've read for ${mins < 1 ? 'a minute' : `${mins} min`}${books > 1 ? ` across ${books} books` : ''}. Right now that's saved only in this browser. A free account keeps your place, highlights and history on every device.</p>
      <div class="nudge-btns"><button class="btn btn-ink sm" data-go>Create free account</button><button class="btn-quiet" data-later>Not now</button></div>
    </div>`;
  const close = dismissed => {
    if (dismissed) { const s = load(); save({ n: s.n + 1, at: Date.now() }); }
    fadeOut(el, 220);
  };
  el.querySelector('[data-go]').onclick = () => { save({ ...load(), at: Date.now() }); close(false); goSignup(); };
  el.querySelector('[data-later]').onclick = () => close(true);
  el.querySelector('.nudge-x').onclick = () => close(true);
  document.body.appendChild(el);
  save({ ...load(), at: Date.now() }); // shown counts as asked, so it won't pop up again this week
}

/** Asks after a reading sitting ends, once the reader is closed. */
export function installNudge(readerOpen) {
  let timer = 0;
  store.on(what => {
    if (what !== 'session') return;
    clearTimeout(timer);
    const tryShow = () => { if (readerOpen()) { timer = setTimeout(tryShow, 4000); return; } show(); };
    timer = setTimeout(tryShow, 1400);
  });
  store.on(what => { if (what === 'account' && store.account?.user) document.querySelector('.nudge')?.remove(); });
}

/** A quiet line for places that show reading progress to someone without an account. */
export const saveHintHTML = () => (accountsEnabled() && !store.account?.user
  ? `<button class="save-hint" data-signup>${I.clock}<span>Saved in this browser only. <u>Create a free account</u> to keep your history everywhere.</span></button>`
  : '');
