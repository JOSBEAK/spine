import { $, $$, esc, reduceMotion, titleCase } from '../lib/util.js';
import { store } from '../lib/store.js';
import { findText, loadText } from '../lib/archive.js';
import { chapterHTML } from '../lib/gutenberg.js';
import { I } from './icons.js';

let R = null;
export const readerOpen = () => !!R;

const chapterName = c => c.sub ? `${titleCase(c.label)}, ${titleCase(c.sub)}` : titleCase(c.label || 'Opening');

export function openReader(b, { fromOpen = false, onClose, onScan } = {}) {
  if (R) closeReader(true, true);
  const prefs = store.prefs;
  const el = document.createElement('div');
  el.className = 'reader';
  el.dataset.tone = prefs.tone;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', `Reading ${b.title}`);
  el.innerHTML = `
    <div class="rbar top">
      <button class="rbtn" data-close>${I.arrowL}<span>Close</span></button>
      <button class="rbtn" data-toc aria-expanded="false" disabled>${I.list}<span>Contents</span></button>
      <p class="rtitle"><b>${esc(b.title)}</b> <span class="rch"></span></p>
      <button class="rbtn" data-aa aria-expanded="false">${I.aa}<span>Text</span></button>
    </div>
    <div class="spread-wrap"><div class="spread"></div></div>
    <div class="rbar bottom"><div class="scrub" role="slider" aria-label="Position in book" tabindex="0"><div class="track"></div><div class="fill"></div><div class="knob"></div></div><div class="rmeta"><span class="pos"></span><span class="left"></span></div></div>`;
  document.body.appendChild(el);
  document.body.style.overflow = 'hidden';
  R = { el, b, prefs, text: null, ch: 0, page: 0, pages: 1, two: true, busy: false, frac: 0, onClose, onScan };
  if (fromOpen) el.animate([{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 450, easing: 'cubic-bezier(.2,.8,.2,1)' });

  $('[data-close]', el).onclick = () => closeReader();
  $('[data-aa]', el).onclick = e => togglePanel('aa', e.currentTarget);
  $('[data-toc]', el).onclick = e => togglePanel('toc', e.currentTarget);
  const scrub = $('.scrub', el);
  scrub.onclick = e => { const r = scrub.getBoundingClientRect(); seek((e.clientX - r.left) / r.width); };
  scrub.onkeydown = e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.stopPropagation(); turn(e.key === 'ArrowRight' ? 1 : -1); } };

  let calmT;
  const wake = () => { el.classList.remove('calm'); clearTimeout(calmT); calmT = setTimeout(() => { if (R?.el === el && !$('.aa, .toc', el)) el.classList.add('calm'); }, 2800); };
  el.addEventListener('pointermove', wake); wake();
  let sx = null;
  el.addEventListener('pointerdown', e => { if (e.target.closest('.spread')) sx = e.clientX; });
  el.addEventListener('pointerup', e => { if (sx != null && Math.abs(e.clientX - sx) > 50) turn(e.clientX < sx ? 1 : -1); sx = null; });
  addEventListener('resize', onResize);

  sizePages();
  status(`<div class="lines"></div><b>Opening the book</b><span>Getting the text from Project Gutenberg…</span>`);
  load();
}

async function load() {
  const r = R;
  try {
    const item = await findText(r.b);
    if (R !== r) return;
    if (!item) throw Object.assign(new Error('nogut'), { soft: true });
    const text = await loadText(item);
    if (R !== r) return;
    if (!text.chapters.length) throw Object.assign(new Error('empty'), { soft: true });
    r.text = text;
    const last = text.chapters.length - 1;
    text.chapters[last].end = true;
    $('[data-toc]', r.el).disabled = false;
    const p = store.progress(r.b.id);
    r.ch = Math.min(p?.ch ?? 0, last);
    r.frac = p?.frac ?? 0;
    layout();
  } catch (e) {
    if (R !== r) return;
    const scan = r.b.scan && store.sources.archive;
    status(e.soft
      ? `<b>No clean text for this one</b><span>Project Gutenberg doesn't have a typeset copy of this book.</span>${scan ? '<button data-scan>Read the original printed pages instead</button>' : ''}`
      : `<b>The text didn't load</b><span>The Internet Archive didn't answer in time. Check your connection and try again.</span><button data-retry>Try again</button>`);
    $('[data-retry]', r.el)?.addEventListener('click', () => { status('<div class="lines"></div><b>Trying again</b>'); load(); });
    $('[data-scan]', r.el)?.addEventListener('click', () => { const cb = r.onScan; closeReader(true, true); history.replaceState(null, '', `#/book/${r.b.id}`); cb?.(); });
  }
}

function status(html) {
  const s = $('.spread', R.el);
  s.innerHTML = (R.two ? '<div class="pg l"></div>' : '') + `<div class="pg r"><div class="r-status">${html}</div></div>`;
}

export function closeReader(instant, silent) {
  if (!R) return;
  if (silent) R.onClose = null;
  const { el, onClose } = R;
  removeEventListener('resize', onResize);
  R = null;
  document.body.style.overflow = '';
  if (instant) el.remove();
  else el.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(.98)' }], { duration: 260, easing: 'ease-in' }).onfinish = () => el.remove();
  onClose?.();
}

let resizeT;
function onResize() { clearTimeout(resizeT); resizeT = setTimeout(() => { if (R) { sizePages(); if (R.text) layout(); } }, 120); }

function sizePages() {
  const el = R.el, sw = $('.spread-wrap', el);
  const W = sw.clientWidth - 48, H = sw.clientHeight - 20;
  R.two = W > 900;
  const ph = Math.min(H, 760), pw = Math.min(R.two ? W / 2 : W, R.two ? 520 : 560, ph * 0.72);
  const padX = Math.max(24, pw * 0.1), padY = Math.max(28, ph * 0.075);
  R.cw = pw - padX * 2; R.gap = padX * 2; R.step = R.cw + R.gap;
  el.style.cssText = `--pw:${pw}px;--ph:${ph}px;--pad-x:${padX}px;--pad-y:${padY}px;--cw:${R.cw}px;--gap:${R.gap}px;--fs:${R.prefs.fs}px;--rf:${R.prefs.face === 'sans' ? 'var(--f-ui)' : 'var(--f-read)'}`;
}

function layout(keepFrac = true) {
  if (!R?.text) return;
  if (keepFrac && R.pages > 1) R.frac = R.page / R.pages;
  sizePages();
  const c = R.text.chapters[R.ch];
  R.html = chapterHTML(c) + (c.end ? `<p class="end"><b>The end</b>You finished ${esc(R.b.title)}.</p>` : '');
  const probe = document.createElement('div');
  probe.className = 'pg';
  probe.style.cssText = 'position:absolute;visibility:hidden;left:-9999px;top:0';
  probe.innerHTML = `<div class="pg-in"><div class="flow">${R.html}</div></div>`;
  R.el.appendChild(probe);
  const flow = $('.flow', probe);
  R.pages = Math.max(1, Math.ceil((flow.scrollWidth + R.gap - 2) / R.step));
  probe.remove();
  R.page = Math.min(R.pages - 1, Math.round(R.frac * R.pages));
  if (R.two && R.page % 2) R.page -= 1;
  draw();
}

function pageHTML(i, side) {
  if (i < 0 || i >= R.pages) return `<div class="pg ${side}"></div>`;
  return `<div class="pg ${side}"><div class="pg-in"><div class="flow" style="transform:translateX(${-i * R.step}px)">${R.html}</div></div><div class="folio">${i + 1}</div></div>`;
}

function bookPct() {
  const c = R.text.chapters[R.ch];
  const seen = Math.min(1, (R.page + (R.two ? 2 : 1)) / R.pages);
  return Math.min(1, c.start + c.share * (R.pages <= 1 ? 1 : seen));
}

function draw() {
  const s = $('.spread', R.el), i = R.page;
  s.innerHTML = (R.two ? pageHTML(i, 'l') + pageHTML(i + 1, 'r') : pageHTML(i, 'r'))
    + '<div class="hit prev" aria-hidden="true"></div><div class="hit next" aria-hidden="true"></div>';
  $('.hit.prev', s).onclick = () => turn(-1);
  $('.hit.next', s).onclick = () => turn(1);
  const pct = bookPct();
  const c = R.text.chapters[R.ch];
  s.style.setProperty('--stackL', (2 + pct * 10).toFixed(1) + 'px');
  s.style.setProperty('--stackR', (2 + (1 - pct) * 10).toFixed(1) + 'px');
  $('.fill', R.el).style.width = pct * 100 + '%';
  $('.knob', R.el).style.left = pct * 100 + '%';
  $('.scrub', R.el).setAttribute('aria-valuenow', Math.round(pct * 100));
  $('.rch', R.el).textContent = '· ' + chapterName(c);
  const shown = R.two ? `Pages ${i + 1}–${Math.min(i + 2, R.pages)}` : `Page ${i + 1}`;
  $('.pos', R.el).textContent = `${shown} of ${R.pages} · chapter ${R.ch + 1} of ${R.text.chapters.length}`;
  const leftWords = R.text.words * (1 - pct);
  const mins = Math.round(leftWords / 240);
  $('.left', R.el).textContent = pct >= 0.999 ? 'Finished' : `${Math.round(pct * 100)}% · ${mins < 60 ? `${Math.max(1, mins)} min` : `about ${Math.round(mins / 60)} h`} left`;
  R.frac = R.page / R.pages;
  store.setProgress(R.b, { ch: R.ch, frac: R.frac, pct, chTitle: chapterName(c) });
}

function goChapter(ch, frac, dir) {
  R.ch = ch; R.frac = frac;
  layout(false);
  if (!reduceMotion()) $('.spread', R.el).animate([{ opacity: 0, transform: `translateX(${dir * 24}px)` }, { opacity: 1, transform: 'none' }], { duration: 360, easing: 'cubic-bezier(.2,.8,.2,1)' });
}

function seek(pct) {
  if (!R?.text) return;
  const cs = R.text.chapters;
  let ch = cs.findIndex(c => pct < c.start + c.share);
  if (ch < 0) ch = cs.length - 1;
  const c = cs[ch];
  goChapter(ch, Math.max(0, Math.min(0.999, (pct - c.start) / c.share)), 0);
}

export async function turn(dir) {
  if (!R?.text || R.busy) return;
  const step = R.two ? 2 : 1;
  const next = R.page + dir * step;
  if (next < 0 || next > R.pages - 1) {
    if (dir > 0 && R.ch < R.text.chapters.length - 1) return goChapter(R.ch + 1, 0, 1);
    if (dir < 0 && R.ch > 0) return goChapter(R.ch - 1, 0.999, -1);
    $('.spread', R.el).animate([{ transform: 'translateX(0)' }, { transform: `translateX(${-dir * 8}px)` }, { transform: 'translateX(0)' }], { duration: 260 });
    return;
  }
  if (reduceMotion()) { R.page = next; draw(); return; }
  R.busy = true;
  const s = $('.spread', R.el);
  const pw = parseFloat(R.el.style.getPropertyValue('--pw'));
  const i = R.page;
  const leaf = document.createElement('div'); leaf.className = 'turnleaf';
  let under = () => {};
  if (R.two) {
    if (dir > 0) {
      leaf.style.left = pw + 'px'; leaf.style.transformOrigin = 'left center';
      leaf.innerHTML = pageHTML(i + 1, 'r') + pageHTML(i + 2, 'l backside');
      under = () => { s.children[1].outerHTML = pageHTML(i + 3, 'r'); };
    } else {
      leaf.style.left = '0px'; leaf.style.transformOrigin = 'right center';
      leaf.innerHTML = pageHTML(i, 'l') + pageHTML(i - 1, 'r backside');
      under = () => { s.children[0].outerHTML = pageHTML(i - 2, 'l'); };
    }
  } else {
    leaf.style.left = '0px'; leaf.style.transformOrigin = 'left center';
    if (dir > 0) { leaf.innerHTML = pageHTML(i, 'r') + '<div class="pg l backside"></div>'; under = () => { s.children[0].outerHTML = pageHTML(i + 1, 'r'); }; }
    else leaf.innerHTML = pageHTML(i - 1, 'r') + '<div class="pg l backside"></div>';
  }
  $$('.pg', leaf).forEach(p => p.insertAdjacentHTML('beforeend', '<div class="shade"></div>'));
  under();
  s.appendChild(leaf);
  const single = !R.two;
  const from = single && dir < 0 ? -180 : 0;
  const to = single ? (dir < 0 ? 0 : -180) : (dir > 0 ? -180 : 180);
  const dur = 720;
  const a = leaf.animate([
    { transform: `rotateY(${from}deg)` },
    { transform: `rotateY(${(from + to) / 2}deg) translateZ(12px)`, offset: 0.5 },
    { transform: `rotateY(${to}deg)` },
  ], { duration: dur, easing: 'cubic-bezier(.45,.05,.25,1)', fill: 'forwards' });
  const g = dir > 0 ? 'linear-gradient(90deg,rgba(0,0,0,.18),rgba(0,0,0,0) 60%)' : 'linear-gradient(270deg,rgba(0,0,0,.18),rgba(0,0,0,0) 60%)';
  $$('.shade', leaf).forEach(sh => { sh.style.background = g; sh.animate([{ opacity: 0 }, { opacity: 1, offset: 0.5 }, { opacity: 0 }], { duration: dur }); });
  try { await a.finished; } catch { /* reader closed mid-turn */ }
  if (!R) return;
  R.page = next; R.busy = false; draw();
}

function togglePanel(kind, btn) {
  const other = kind === 'aa' ? '.toc' : '.aa';
  $(other, R.el)?.remove();
  $$('[aria-expanded]', R.el).forEach(b => b !== btn && b.setAttribute('aria-expanded', 'false'));
  const old = $('.' + kind, R.el);
  if (old) { old.remove(); btn.setAttribute('aria-expanded', 'false'); return; }
  btn.setAttribute('aria-expanded', 'true');
  if (kind === 'toc') {
    R.el.insertAdjacentHTML('beforeend', `<div class="toc"><h3>Contents</h3><ol>${R.text.chapters.map((c, i) => `<li><button data-ch="${i}" aria-current="${i === R.ch}"><em>${i + 1}</em><span>${esc(chapterName(c))}</span></button></li>`).join('')}</ol></div>`);
    const toc = $('.toc', R.el);
    $('[aria-current="true"]', toc)?.scrollIntoView({ block: 'center' });
    $$('[data-ch]', toc).forEach(b => b.onclick = () => { toc.remove(); btn.setAttribute('aria-expanded', 'false'); goChapter(+b.dataset.ch, 0, 0); });
    return;
  }
  const p = R.prefs;
  R.el.insertAdjacentHTML('beforeend', `<div class="aa">
    <div><label for="fs">Text size</label><input id="fs" type="range" min="15" max="26" step="1" value="${p.fs}"></div>
    <div><span class="lab">Typeface</span><div class="seg two"><button data-face="serif" aria-pressed="${p.face === 'serif'}" style="font-family:var(--f-read)">Literata</button><button data-face="sans" aria-pressed="${p.face === 'sans'}">Geist</button></div></div>
    <div><span class="lab">Page</span><div class="seg"><button class="sw-white" data-tone="white" aria-pressed="${p.tone === 'white'}">White</button><button class="sw-paper" data-tone="paper" aria-pressed="${p.tone === 'paper'}">Paper</button><button class="sw-night" data-tone="night" aria-pressed="${p.tone === 'night'}">Night</button></div></div>
  </div>`);
  const aa = $('.aa', R.el);
  let t;
  $('#fs', aa).oninput = e => { p.fs = +e.target.value; store.savePrefs(); R.el.style.setProperty('--fs', p.fs + 'px'); clearTimeout(t); t = setTimeout(() => layout(), 150); };
  $$('[data-face]', aa).forEach(b => b.onclick = () => { p.face = b.dataset.face; store.savePrefs(); $$('[data-face]', aa).forEach(x => x.setAttribute('aria-pressed', x === b)); layout(); });
  $$('[data-tone]', aa).forEach(b => b.onclick = () => { p.tone = b.dataset.tone; store.savePrefs(); R.el.dataset.tone = p.tone; $$('[data-tone]', aa).forEach(x => x.setAttribute('aria-pressed', x === b)); });
}

export function readerKey(e) {
  if (!R) return false;
  if (e.target.closest?.('input')) return true;
  if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); turn(1); }
  else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); turn(-1); }
  else if (e.key === 'Escape') {
    const open = $('.aa, .toc', R.el);
    if (open) { open.remove(); $$('[aria-expanded]', R.el).forEach(b => b.setAttribute('aria-expanded', 'false')); }
    else closeReader();
  }
  return true;
}
