// The original printed pages, shown with the Internet Archive's own page-flipping viewer.
import { $, esc } from '../lib/util.js';
import { scanEmbed, itemPage } from '../lib/archive.js';
import { I } from './icons.js';

export function openScan(b, { onClose } = {}) {
  closeScan(true);
  const el = document.createElement('div');
  el.className = 'scan';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', `Original pages of ${b.title}`);
  el.innerHTML = `<div class="rbar top">
      <button class="rbtn" data-close>${I.arrowL}<span>Close</span></button>
      <p class="rtitle"><b>${esc(b.title)}</b> · original printed pages</p>
      <a class="ext" href="${itemPage(b.scan)}" target="_blank" rel="noopener">Internet Archive ${I.ext}</a>
    </div>
    <iframe src="${scanEmbed(b.scan)}" title="Scanned pages of ${esc(b.title)}" allow="fullscreen" allowfullscreen></iframe>`;
  document.body.appendChild(el);
  document.body.style.overflow = 'hidden';
  el._onClose = onClose;
  $('[data-close]', el).onclick = () => closeScan();
  $('[data-close]', el).focus();
}

export function closeScan(instant, silent) {
  const el = $('.scan');
  if (!el) return false;
  document.body.style.overflow = '';
  const cb = silent ? null : el._onClose;
  if (instant) el.remove();
  else el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200 }).onfinish = () => el.remove();
  cb?.();
  return true;
}
