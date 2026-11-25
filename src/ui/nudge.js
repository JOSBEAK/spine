// Inviting people to create an account. Never forced: every book stays free to read without one.
// Anyone not signed in sees a welcome modal each time they open the site; it closes with ×, Esc,
// a click outside, or "Maybe later".
import { store } from '../lib/store.js';
import { accountsEnabled } from '../lib/api.js';
import { fadeOut } from '../lib/util.js';
import { I } from './icons.js';
import { here, go } from '../lib/router.js';

/** Opens the account page with "Create account" (or "Sign in") chosen. */
export function goSignup(mode = 'up') {
  if (here() === '/account') { document.querySelector(`[data-mode="${mode === 'in' ? 'in' : 'up'}"]`)?.click(); return; }
  try { sessionStorage.setItem('spine.signup', mode); } catch { /* ignore */ }
  go('/account');
}

const signedOut = () => accountsEnabled() && !store.account?.user;
const LOGO = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="17" fill="#14161b"/><rect x="15" y="12" width="13" height="40" rx="3" fill="#fff"/><rect x="15" y="18.5" width="13" height="2.6" fill="#14161b" opacity=".45"/><rect x="15" y="43" width="13" height="2.6" fill="#14161b" opacity=".45"/><rect x="36" y="17" width="11" height="35" rx="3" fill="#35c48d" transform="rotate(-15 47 52)"/></svg>';

function showWelcome() {
  if (!signedOut() || document.querySelector('.welcome')) return;
  const back = document.activeElement;
  const el = document.createElement('div');
  el.className = 'welcome';
  el.innerHTML = `
    <div class="welcome-card" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="welcome-h" aria-describedby="welcome-p">
      <button class="welcome-x" aria-label="Close">${I.x}</button>
      <div class="welcome-logo">${LOGO}</div>
      <h2 id="welcome-h">Every book here is free to read.</h2>
      <p id="welcome-p">No subscription, no card. Just sign up to keep your place, your highlights and your reading history on every device.</p>
      <ul class="welcome-list">
        <li>${I.book}<span>Read as many books as you like, free</span></li>
        <li>${I.clock}<span>Your reading history, saved to your account</span></li>
        <li>${I.spark}<span>Picks that learn what you like to read</span></li>
      </ul>
      <div class="welcome-btns"><button class="btn btn-ink" data-go>Sign up free ${I.arrowR}</button><button class="btn btn-line" data-in>Sign in</button></div>
      <button class="btn-quiet welcome-later" data-later>Maybe later, just let me read</button>
    </div>`;
  const close = () => {
    removeEventListener('keydown', onKey, true);
    fadeOut(el, 200);
    try { back?.focus?.({ preventScroll: true }); } catch { /* gone */ }
  };
  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    if (e.key === 'Tab') { // keep focus inside the dialog
      const f = [...el.querySelectorAll('button')]; const i = f.indexOf(document.activeElement); if (i < 0) { e.preventDefault(); (e.shiftKey ? f.at(-1) : f[0]).focus(); return; }
      if (e.shiftKey && i <= 0) { e.preventDefault(); f.at(-1).focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  };
  el.addEventListener('click', e => { if (e.target === el) close(); });
  el.querySelector('.welcome-x').onclick = close;
  el.querySelector('[data-later]').onclick = close;
  el.querySelector('[data-go]').onclick = () => { close(); goSignup('up'); };
  el.querySelector('[data-in]').onclick = () => { close(); goSignup('in'); };
  addEventListener('keydown', onKey, true);
  document.body.appendChild(el);
  requestAnimationFrame(() => el.querySelector('.welcome-card').focus({ preventScroll: true }));
}

/**
 * Shows the welcome modal once per page load to anyone not signed in. If the site opened straight
 * into a book (or on the account page), it waits until they leave it.
 */
export function installWelcome(readerOpen) {
  if (!signedOut()) return;
  const busy = () => readerOpen() || /^\/(account|read|scan|listen)\b/.test(here());
  const attempt = () => {
    if (busy()) return false;
    showWelcome();
    return true;
  };
  setTimeout(() => {
    if (attempt()) return;
    const onHash = () => setTimeout(() => { if (attempt()) removeEventListener('spine:route', onHash); }, 700);
    addEventListener('spine:route', onHash);
  }, 1200);
  store.on(what => { if (what === 'account' && store.account?.user) document.querySelector('.welcome')?.remove(); });
}

/** A quiet line for places that show reading progress to someone without an account. */
export const saveHintHTML = () => (signedOut()
  ? `<button class="save-hint" data-signup>${I.clock}<span>Saved in this browser only. <u>Sign up free</u> to keep your history everywhere.</span></button>`
  : '');
