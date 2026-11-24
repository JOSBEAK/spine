// The Spine reader. Two kinds of book share one set of controls:
//   text — Project Gutenberg text, paginated with CSS columns, with highlights, notes and a dictionary
//   scan — page images of a printed edition from the Internet Archive (public-domain scans)
// Both get 3D page turns, Book (two pages) or Page view, page size, full screen, bookmarks and saved progress.
import { $, $$, esc, reduceMotion, titleCase, fadeOut } from '../lib/util.js';
import { store } from '../lib/store.js';
import { findText, loadText, loadScan, scanImage } from '../lib/archive.js';
import { chapterHTML } from '../lib/gutenberg.js';
import { define } from '../lib/dictionary.js';
import { toneOf } from './book.js';
import { I } from './icons.js';
import { toast } from './toast.js';

let R = null;
export const readerOpen = () => !!R;

const COLORS = ['yellow', 'green', 'blue', 'pink'];
const chapterName = c => (c.sub ? `${titleCase(c.label)}, ${titleCase(c.sub)}` : titleCase(c.label || 'Opening'));
const clamp = (v, a, z) => Math.max(a, Math.min(z, v));

export function openReader(b, { fromOpen = false, onClose, onScan, mode = 'text' } = {}) {
  if (R) closeReader(true, true);
  const prefs = store.prefs;
  const el = document.createElement('div');
  el.className = 'reader';
  el.dataset.tone = prefs.tone;
  el.dataset.mode = mode;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', `Reading ${b.title}`);
  el.style.setProperty('--book', toneOf(b));
  const canFull = !!document.documentElement.requestFullscreen;
  el.innerHTML = `
    <div class="rbar top">
      <button class="rbtn" data-close>${I.arrowL}<span>Close</span></button>
      <button class="rbtn" data-toc aria-expanded="false" disabled>${I.list}<span>${mode === 'scan' ? 'Bookmarks' : 'Contents'}</span></button>
      <p class="rtitle"><b>${esc(b.title)}</b> <span class="rch"></span></p>
      <button class="rbtn icon" data-mark aria-pressed="false" aria-label="Bookmark this page" title="Bookmark this page (B)" disabled>${I.ribbon}</button>
      <button class="rbtn" data-aa aria-expanded="false">${I.aa}<span>View</span></button>
      ${canFull ? `<button class="rbtn icon" data-full aria-label="Full screen" title="Full screen (F)">${I.expand}</button>` : ''}
    </div>
    <div class="spread-wrap"><div class="spread"></div></div>
    <div class="rbar bottom"><div class="scrub" role="slider" aria-label="Position in book" tabindex="0"><div class="track"></div><div class="fill"></div><div class="knob"></div></div><div class="rmeta"><span class="pos"></span><span class="left"></span></div></div>`;
  document.body.appendChild(el);
  document.body.style.overflow = 'hidden';
  R = { el, b, mode, prefs, text: null, scan: null, ch: 0, page: 0, pages: 1, two: true, busy: false, frac: 0, aspect: 0.72, onClose, onScan, paraPage: {}, targetPara: null };
  if (fromOpen) el.animate([{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 450, easing: 'cubic-bezier(.2,.8,.2,1)' });

  $('[data-close]', el).onclick = () => closeReader();
  $('[data-aa]', el).onclick = e => togglePanel('aa', e.currentTarget);
  $('[data-toc]', el).onclick = e => togglePanel('toc', e.currentTarget);
  $('[data-mark]', el).onclick = toggleBookmark;
  $('[data-full]', el)?.addEventListener('click', toggleFull);
  const scrub = $('.scrub', el);
  scrub.onclick = e => { const r = scrub.getBoundingClientRect(); seek((e.clientX - r.left) / r.width); };
  scrub.onkeydown = e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.stopPropagation(); turn(e.key === 'ArrowRight' ? 1 : -1); } };

  let calmT;
  const wake = () => { el.classList.remove('calm'); clearTimeout(calmT); calmT = setTimeout(() => { if (R?.el === el && !$('.aa, .toc, .rpop', el)) el.classList.add('calm'); }, 2800); };
  el.addEventListener('pointermove', wake); wake();
  wireTextGestures(el);
  addEventListener('resize', onResize);
  document.addEventListener('fullscreenchange', onFullChange);

  sizePages();
  status(mode === 'scan'
    ? '<div class="lines"></div><b>Opening the book</b><span>Getting the scanned pages from the Internet Archive…</span>'
    : '<div class="lines"></div><b>Opening the book</b><span>Getting the text from Project Gutenberg…</span>');
  (mode === 'scan' ? loadScanBook : loadTextBook)();
}

/* ---------------- loading ---------------- */

async function loadTextBook() {
  const r = R;
  try {
    const item = await findText(r.b);
    if (R !== r) return;
    if (!item) throw Object.assign(new Error('nogut'), { soft: true });
    const text = await loadText(item);
    if (R !== r) return;
    if (!text.chapters.length) throw Object.assign(new Error('empty'), { soft: true });
    r.text = text;
    text.chapters[text.chapters.length - 1].end = true;
    ready();
    const p = store.progress(r.b.id);
    r.ch = clamp(p?.ch ?? 0, 0, text.chapters.length - 1);
    r.frac = p?.frac ?? 0;
    layout(false);
  } catch (e) {
    if (R !== r) return;
    const scan = r.b.scan && store.sources.archive !== false;
    status(e.soft
      ? `<b>No clean text for this one</b><span>Project Gutenberg doesn't have a typeset copy of this book.</span>${scan ? '<button data-scan>Read the original printed pages here</button>' : ''}`
      : '<b>The text didn\'t load</b><span>The Internet Archive didn\'t answer in time. Check your connection and try again.</span><button data-retry>Try again</button>');
    $('[data-retry]', r.el)?.addEventListener('click', () => { status('<div class="lines"></div><b>Trying again</b>'); loadTextBook(); });
    $('[data-scan]', r.el)?.addEventListener('click', () => { const cb = r.onScan; closeReader(true, true); history.replaceState(null, '', `#/book/${r.b.id}`); cb?.(); });
  }
}

async function loadScanBook() {
  const r = R;
  try {
    const scan = await loadScan(r.b.scan);
    if (R !== r) return;
    r.scan = scan;
    const sample = scan.pages[Math.min(8, scan.pages.length - 1)];
    r.aspect = clamp(sample.w / sample.h, 0.55, 0.85);
    ready();
    const p = store.progress(r.b.id);
    r.page = clamp(p?.page ?? 0, 0, scan.pages.length - 1);
    layout(false);
  } catch {
    if (R !== r) return;
    status('<b>The pages didn\'t load</b><span>The Internet Archive didn\'t answer in time. Check your connection and try again.</span><button data-retry>Try again</button>');
    $('[data-retry]', r.el)?.addEventListener('click', () => { status('<div class="lines"></div><b>Trying again</b>'); loadScanBook(); });
  }
}

function ready() {
  $('[data-toc]', R.el).disabled = false;
  $('[data-mark]', R.el).disabled = false;
  startSession();
}

function status(html) {
  const s = $('.spread', R.el);
  s.innerHTML = (R.two ? '<div class="pg l"></div>' : '') + `<div class="pg r"><div class="r-status">${html}</div></div>`;
}

/* ---------------- closing ---------------- */

export function closeReader(instant, silent) {
  if (!R) return;
  endSession();
  if (silent) R.onClose = null;
  const { el, onClose } = R;
  removeEventListener('resize', onResize);
  document.removeEventListener('fullscreenchange', onFullChange);
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  R = null;
  document.body.style.overflow = '';
  if (instant) el.remove();
  else fadeOut(el, 260, [{ opacity: 1 }, { opacity: 0, transform: 'scale(.98)' }]);
  onClose?.();
}

/* ---------------- reading time: one record per sitting ---------------- */

function startSession() {
  R.sess = { started_at: new Date().toISOString(), active: 0, lastTick: Date.now(), lastInput: Date.now(), from: null, pages: 0 };
  R.sessTimer = setInterval(tick, 15000);
}
function tick() {
  if (!R?.sess) return;
  const t = Date.now();
  // count time only while the page is visible and the reader has done something in the last 3 minutes
  if (document.visibilityState === 'visible' && t - R.sess.lastInput < 180000) R.sess.active += t - R.sess.lastTick;
  R.sess.lastTick = t;
}
function endSession() {
  if (!R?.sess) return;
  tick();
  clearInterval(R.sessTimer);
  const s = R.sess; R.sess = null;
  const p = store.progress(R.b.id);
  store.addSession({ book_id: R.b.id, mode: R.mode, started_at: s.started_at, ended_at: new Date().toISOString(), seconds: Math.round(s.active / 1000), from_progress: s.from ?? p?.pct ?? 0, to_progress: p?.pct ?? 0, pages: s.pages });
}
const input = () => { if (R?.sess) { if (Date.now() - R.sess.lastInput > 180000) R.sess.lastTick = Date.now(); R.sess.lastInput = Date.now(); } };
document.addEventListener('visibilitychange', () => {
  if (!R) return;
  if (document.visibilityState === 'hidden') endSession();
  else if (!R.sess && (R.text || R.scan)) startSession();
});
addEventListener('pagehide', () => { if (R) endSession(); });

/* ---------------- layout ---------------- */

let resizeT;
function onResize() { clearTimeout(resizeT); resizeT = setTimeout(() => { if (R) { sizePages(); if (R.text || R.scan) layout(); } }, 120); }
function onFullChange() {
  if (!R) return;
  const on = !!document.fullscreenElement;
  R.el.classList.toggle('full', on);
  const b = $('[data-full]', R.el);
  if (b) { b.innerHTML = on ? I.shrink : I.expand; b.setAttribute('aria-label', on ? 'Leave full screen' : 'Full screen'); }
  onResize();
}
function toggleFull() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else R.el.requestFullscreen?.().catch(() => toast('This browser doesn\'t allow full screen here.'));
}

function sizePages() {
  const el = R.el, sw = $('.spread-wrap', el), p = R.prefs;
  const W = sw.clientWidth - 48, H = sw.clientHeight - 24;
  const scale = clamp(p.scale || 1, 0.6, 1.4);
  const aspect = R.mode === 'scan' ? R.aspect : 0.72;
  let ph = Math.min(H, Math.min(H, 820) * scale);
  let pw = ph * aspect;
  if (R.mode === 'text') pw = Math.min(pw, 560 * scale);
  R.two = p.view !== 'page' && pw * 2 <= W;
  if (!R.two && pw > W) { pw = W; if (R.mode === 'scan') ph = pw / aspect; }
  R.pw = pw; R.ph = ph;
  const padX = Math.max(22, pw * 0.1), padY = Math.max(26, ph * 0.075);
  R.cw = pw - padX * 2; R.gap = padX * 2; R.step = R.cw + R.gap;
  el.classList.toggle('two', R.two);
  el.classList.toggle('bookview', p.view !== 'page');
  el.style.cssText = `--book:${toneOf(R.b)};--pw:${pw}px;--ph:${ph}px;--pad-x:${padX}px;--pad-y:${padY}px;--cw:${R.cw}px;--gap:${R.gap}px;--fs:${p.fs}px;--rf:${p.face === 'sans' ? 'var(--f-ui)' : 'var(--f-read)'}`;
}

function layout(keepFrac = true) {
  if (!R || !(R.text || R.scan)) return;
  if (R.mode === 'scan') {
    sizePages();
    R.pages = R.scan.pages.length;
    if (R.two && R.page % 2) R.page -= 1;
    R.page = clamp(R.page, 0, R.pages - 1);
    return draw();
  }
  if (keepFrac && R.pages > 1) R.frac = R.page / R.pages;
  sizePages();
  const c = R.text.chapters[R.ch];
  const marks = store.highlightsFor(R.b.id).filter(h => h.locator?.ch === R.ch);
  R.html = withMarks(chapterHTML(c) + (c.end ? `<p class="end"><b>The end</b>You finished ${esc(R.b.title)}.</p>` : ''), marks);
  const probe = document.createElement('div');
  probe.className = 'pg';
  probe.style.cssText = 'position:absolute;visibility:hidden;left:-9999px;top:0';
  probe.innerHTML = `<div class="pg-in"><div class="flow">${R.html}</div></div>`;
  R.el.appendChild(probe);
  const flow = $('.flow', probe);
  R.pages = Math.max(1, Math.ceil((flow.scrollWidth + R.gap - 2) / R.step));
  const left = flow.getBoundingClientRect().left;
  R.paraPage = {};
  $$('[data-p]', flow).forEach(p => { R.paraPage[p.dataset.p] = Math.floor((p.getBoundingClientRect().left - left + 2) / R.step); });
  probe.remove();
  R.page = R.targetPara != null && R.paraPage[R.targetPara] != null ? R.paraPage[R.targetPara] : Math.min(R.pages - 1, Math.round(R.frac * R.pages));
  R.targetPara = null;
  if (R.two && R.page % 2) R.page -= 1;
  draw();
}

function pageHTML(i, side) {
  if (i < 0 || i >= R.pages) return `<div class="pg ${side}"></div>`;
  if (R.mode === 'scan') {
    const pg = R.scan.pages[i];
    const src = scanImage(pg, R.pw * Math.min(2, devicePixelRatio || 1));
    return `<div class="pg scanpg ${side}"><img src="${src}" alt="Page ${i + 1}" decoding="async" draggable="false"><div class="folio">${esc(pg.label && !/^n?\d+$/.test(pg.label) ? pg.label : i + 1)}</div></div>`;
  }
  return `<div class="pg ${side}"><div class="pg-in"><div class="flow" style="transform:translateX(${-i * R.step}px)">${R.html}</div></div><div class="folio">${i + 1}</div></div>`;
}

function preload() {
  if (R.mode !== 'scan') return;
  for (let i = R.page + 2; i < Math.min(R.pages, R.page + 6); i++) { const im = new Image(); im.src = scanImage(R.scan.pages[i], R.pw * Math.min(2, devicePixelRatio || 1)); }
}

function bookPct() {
  if (R.mode === 'scan') return Math.min(1, (R.page + (R.two ? 2 : 1)) / R.pages);
  const c = R.text.chapters[R.ch];
  const seen = Math.min(1, (R.page + (R.two ? 2 : 1)) / R.pages);
  return Math.min(1, c.start + c.share * (R.pages <= 1 ? 1 : seen));
}

function draw() {
  const s = $('.spread', R.el), i = R.page;
  s.innerHTML = (R.two ? '<div class="board" aria-hidden="true"></div>' : '')
    + (R.two ? pageHTML(i, 'l') + pageHTML(i + 1, 'r') : pageHTML(i, 'r'))
    + '<div class="hit prev" aria-hidden="true"><span>‹</span></div><div class="hit next" aria-hidden="true"><span>›</span></div>'
    + (currentBookmark() ? '<div class="page-ribbon" aria-hidden="true"></div>' : '');
  $('.hit.prev', s).onclick = () => turn(-1);
  $('.hit.next', s).onclick = () => turn(1);
  const pct = bookPct();
  s.style.setProperty('--stackL', (2 + pct * 10).toFixed(1) + 'px');
  s.style.setProperty('--stackR', (2 + (1 - pct) * 10).toFixed(1) + 'px');
  $('.fill', R.el).style.width = pct * 100 + '%';
  $('.knob', R.el).style.left = pct * 100 + '%';
  $('.scrub', R.el).setAttribute('aria-valuenow', Math.round(pct * 100));
  const mk = $('[data-mark]', R.el);
  mk.setAttribute('aria-pressed', !!currentBookmark());
  if (R.mode === 'scan') {
    const shown = R.two ? `Pages ${i + 1}–${Math.min(i + 2, R.pages)}` : `Page ${i + 1}`;
    $('.rch', R.el).textContent = '· original printed pages';
    $('.pos', R.el).textContent = `${shown} of ${R.pages}`;
    $('.left', R.el).textContent = `${Math.round(pct * 100)}%`;
    store.setProgress(R.b, { mode: 'scan', page: i, pct, chTitle: `Page ${i + 1}` });
    preload();
  } else {
    const c = R.text.chapters[R.ch];
    $('.rch', R.el).textContent = '· ' + chapterName(c);
    const shown = R.two ? `Pages ${i + 1}–${Math.min(i + 2, R.pages)}` : `Page ${i + 1}`;
    $('.pos', R.el).textContent = `${shown} of ${R.pages} · chapter ${R.ch + 1} of ${R.text.chapters.length}`;
    const mins = Math.round(R.text.words * (1 - pct) / 240);
    $('.left', R.el).textContent = pct >= 0.999 ? 'Finished' : `${Math.round(pct * 100)}% · ${mins < 60 ? `${Math.max(1, mins)} min` : `about ${Math.round(mins / 60)} h`} left`;
    R.frac = R.page / R.pages;
    store.setProgress(R.b, { mode: 'text', ch: R.ch, frac: R.frac, pct, chTitle: chapterName(c) });
  }
  if (R.sess) { if (R.sess.from == null) R.sess.from = pct; }
}

function goChapter(ch, frac, dir, para = null) {
  R.ch = ch; R.frac = frac; R.targetPara = para;
  layout(false);
  if (!reduceMotion()) $('.spread', R.el).animate([{ opacity: 0, transform: `translateX(${dir * 24}px)` }, { opacity: 1, transform: 'none' }], { duration: 360, easing: 'cubic-bezier(.2,.8,.2,1)' });
}
function goPage(p) {
  R.page = clamp(p, 0, R.pages - 1);
  if (R.two && R.page % 2) R.page -= 1;
  draw();
}
function goLocator(loc) {
  if (loc.page != null) return goPage(loc.page);
  goChapter(clamp(loc.ch ?? 0, 0, R.text.chapters.length - 1), loc.frac ?? 0, 0, loc.sp ?? null);
}

function seek(pct) {
  if (R.mode === 'scan') return goPage(Math.floor(pct * R.pages));
  if (!R?.text) return;
  const cs = R.text.chapters;
  let ch = cs.findIndex(c => pct < c.start + c.share);
  if (ch < 0) ch = cs.length - 1;
  const c = cs[ch];
  goChapter(ch, clamp((pct - c.start) / c.share, 0, 0.999), 0);
}

export async function turn(dir) {
  if (!R || !(R.text || R.scan) || R.busy) return;
  closePop();
  input();
  const step = R.two ? 2 : 1;
  const next = R.page + dir * step;
  if (next < 0 || next > R.pages - 1) {
    if (R.mode === 'text' && dir > 0 && R.ch < R.text.chapters.length - 1) return goChapter(R.ch + 1, 0, 1);
    if (R.mode === 'text' && dir < 0 && R.ch > 0) return goChapter(R.ch - 1, 0.999, -1);
    $('.spread', R.el).animate([{ transform: 'translateX(0)' }, { transform: `translateX(${-dir * 8}px)` }, { transform: 'translateX(0)' }], { duration: 260 });
    return;
  }
  if (R.sess) R.sess.pages += step;
  if (reduceMotion()) { R.page = next; draw(); return; }
  R.busy = true;
  const s = $('.spread', R.el);
  const pw = R.pw, i = R.page;
  const pages = $$(':scope > .pg', s);
  const leaf = document.createElement('div'); leaf.className = 'turnleaf';
  let under = () => {};
  if (R.two) {
    if (dir > 0) {
      leaf.style.left = pw + 'px'; leaf.style.transformOrigin = 'left center';
      leaf.innerHTML = pageHTML(i + 1, 'r') + pageHTML(i + 2, 'l backside');
      under = () => { pages[1].outerHTML = pageHTML(i + 3, 'r'); };
    } else {
      leaf.style.left = '0px'; leaf.style.transformOrigin = 'right center';
      leaf.innerHTML = pageHTML(i, 'l') + pageHTML(i - 1, 'r backside');
      under = () => { pages[0].outerHTML = pageHTML(i - 2, 'l'); };
    }
  } else {
    leaf.style.left = '0px'; leaf.style.transformOrigin = 'left center';
    if (dir > 0) { leaf.innerHTML = pageHTML(i, 'r') + '<div class="pg l backside"></div>'; under = () => { pages[0].outerHTML = pageHTML(i + 1, 'r'); }; }
    else leaf.innerHTML = pageHTML(i - 1, 'r') + '<div class="pg l backside"></div>';
  }
  $$('.pg', leaf).forEach(p => p.insertAdjacentHTML('beforeend', '<div class="shade"></div>'));
  under();
  $('.page-ribbon', s)?.remove();
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

/* ---------------- bookmarks ---------------- */

function currentBookmark() {
  if (!R || !(R.text || R.scan)) return null;
  const marks = store.bookmarksFor(R.b.id);
  const step = R.two ? 2 : 1;
  if (R.mode === 'scan') return marks.find(m => m.locator?.page >= R.page && m.locator.page < R.page + step) || null;
  const lo = R.page / R.pages, hi = (R.page + step) / R.pages;
  return marks.find(m => m.locator?.ch === R.ch && m.locator.frac >= lo - 1e-6 && m.locator.frac < hi) || null;
}
function toggleBookmark() {
  if (!R || !(R.text || R.scan)) return;
  input();
  const cur = currentBookmark();
  if (cur) { store.removeBookmark(cur.id); toast('Bookmark removed'); }
  else {
    const label = R.mode === 'scan' ? `Page ${R.page + 1}` : `${chapterName(R.text.chapters[R.ch])} · page ${R.page + 1}`;
    store.saveBookmark({ book_id: R.b.id, locator: R.mode === 'scan' ? { page: R.page } : { ch: R.ch, frac: R.page / R.pages }, label });
    toast('Bookmarked');
  }
  draw();
}

/* ---------------- highlights ---------------- */

function withMarks(html, marks) {
  if (!marks.length) return html;
  const t = document.createElement('template');
  t.innerHTML = html;
  for (const h of marks) {
    const L = h.locator;
    for (let p = L.sp; p <= L.ep; p++) {
      const el = t.content.querySelector(`[data-p="${p}"]`);
      if (el) wrapText(el, p === L.sp ? L.so : 0, p === L.ep ? L.eo : el.textContent.length, h);
    }
  }
  return t.innerHTML;
}
function wrapText(el, s, e, h) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const hits = [];
  let pos = 0;
  while (walker.nextNode()) {
    const n = walker.currentNode, L = n.data.length;
    const a = Math.max(s, pos), z = Math.min(e, pos + L);
    if (a < z) hits.push([n, a - pos, z - pos]);
    pos += L;
  }
  for (const [n, a, z] of hits) {
    let node = n;
    if (a > 0) node = node.splitText(a);
    if (z - a < node.data.length) node.splitText(z - a);
    const m = document.createElement('mark');
    m.className = `hl hl-${h.color}${h.note ? ' has-note' : ''}`;
    m.dataset.h = h.id;
    node.parentNode.insertBefore(m, node);
    m.appendChild(node);
  }
}
function rangeLocator(range) {
  const pOf = n => (n.nodeType === 1 ? n : n.parentElement)?.closest('[data-p]');
  const sp = pOf(range.startContainer), ep = pOf(range.endContainer);
  if (!sp || !ep) return null;
  const off = (p, node, o) => { const r = document.createRange(); r.setStart(p, 0); r.setEnd(node, o); return r.toString().length; };
  const loc = { ch: R.ch, sp: +sp.dataset.p, so: off(sp, range.startContainer, range.startOffset), ep: +ep.dataset.p, eo: off(ep, range.endContainer, range.endOffset) };
  if (loc.ep < loc.sp || (loc.ep === loc.sp && loc.eo <= loc.so)) return null;
  loc.frac = (R.paraPage[loc.sp] ?? R.page) / R.pages;
  return loc;
}
function addHighlight(range, color, note = '') {
  const loc = rangeLocator(range);
  if (!loc) return null;
  const text = range.toString().replace(/\s+/g, ' ').trim().slice(0, 2000);
  const h = store.saveHighlight({ book_id: R.b.id, locator: loc, text, color, note, chapter: chapterName(R.text.chapters[R.ch]) });
  getSelection()?.removeAllRanges();
  rerender();
  return h;
}
function rerender() {
  const keep = R.page;
  const c = R.text.chapters[R.ch];
  const marks = store.highlightsFor(R.b.id).filter(h => h.locator?.ch === R.ch);
  R.html = withMarks(chapterHTML(c) + (c.end ? `<p class="end"><b>The end</b>You finished ${esc(R.b.title)}.</p>` : ''), marks);
  R.page = keep;
  draw();
}

/* ---------------- tap a word, select text ---------------- */

function wordAt(x, y) {
  let node, off;
  if (document.caretPositionFromPoint) { const c = document.caretPositionFromPoint(x, y); node = c?.offsetNode; off = c?.offset; }
  else if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(x, y); node = r?.startContainer; off = r?.startOffset; }
  if (!node || node.nodeType !== 3 || !node.parentElement?.closest('.flow')) return null;
  const t = node.data, isW = ch => /[\p{L}'’-]/u.test(ch || '');
  let a = off, z = off;
  while (a > 0 && isW(t[a - 1])) a--;
  while (z < t.length && isW(t[z])) z++;
  const word = t.slice(a, z).replace(/^['’-]+|['’-]+$/g, '');
  if (word.length < 2) return null;
  const range = document.createRange(); range.setStart(node, a); range.setEnd(node, z);
  const rect = range.getBoundingClientRect();
  if (x < rect.left - 4 || x > rect.right + 4 || y < rect.top - 4 || y > rect.bottom + 4) return null;
  return { word, range };
}

function wireTextGestures(el) {
  let down = null;
  el.addEventListener('pointerdown', e => {
    if (!e.target.closest('.spread') || e.target.closest('.hit')) return;
    down = { x: e.clientX, y: e.clientY, t: Date.now(), type: e.pointerType };
    if (!e.target.closest('.rpop')) closePop();
  });
  el.addEventListener('pointerup', e => {
    if (!down || !R) return;
    const d = down; down = null;
    input();
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    // swipe to turn on touch screens (and on scans, where there is no text to select)
    if ((d.type === 'touch' || R.mode === 'scan') && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { getSelection()?.removeAllRanges(); turn(dx < 0 ? 1 : -1); return; }
    if (R.mode === 'scan') { if (Math.abs(dx) < 6 && Math.abs(dy) < 6) turn(e.clientX > innerWidth / 2 ? 1 : -1); return; }
    const sel = getSelection();
    if (sel && !sel.isCollapsed && sel.rangeCount && sel.anchorNode?.parentElement?.closest('.flow')) {
      const range = sel.getRangeAt(0);
      if (range.toString().trim().length > 1) return showSelectionPop(range);
    }
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6 || Date.now() - d.t > 600) return;
    const mark = e.target.closest('mark.hl');
    if (mark) return showHighlightPop(mark);
    const w = wordAt(e.clientX, e.clientY);
    if (w) showWordPop(w);
  });
}

function placePop(pop, rect) {
  R.el.appendChild(pop);
  const pr = pop.getBoundingClientRect();
  let x = rect.left + rect.width / 2 - pr.width / 2;
  x = clamp(x, 12, innerWidth - pr.width - 12);
  let y = rect.top - pr.height - 10;
  if (y < 64) y = rect.bottom + 10;
  pop.style.left = x + 'px'; pop.style.top = Math.min(y, innerHeight - pr.height - 12) + 'px';
  if (!reduceMotion()) pop.animate([{ opacity: 0, transform: 'translateY(6px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' });
}
export function closePop() { $('.rpop', R?.el || document)?.remove(); }

const swatches = (cur = '') => `<div class="swatches" role="group" aria-label="Highlight colour">${COLORS.map(c => `<button class="sw hl-${c}" data-color="${c}" aria-label="Highlight ${c}" aria-pressed="${c === cur}"></button>`).join('')}</div>`;

function showSelectionPop(range) {
  closePop();
  const text = range.toString().trim();
  const single = /^[\p{L}'’-]+$/u.test(text);
  const pop = document.createElement('div');
  pop.className = 'rpop';
  pop.innerHTML = `${swatches()}<div class="rpop-actions">${single ? '<button data-define>Meaning</button>' : ''}<button data-note>Add note</button><button data-copy>Copy</button></div>`;
  const rect = range.getBoundingClientRect();
  placePop(pop, rect);
  const saved = range.cloneRange();
  $$('[data-color]', pop).forEach(b => b.onclick = () => { addHighlight(saved, b.dataset.color); closePop(); toast('Highlighted'); });
  $('[data-copy]', pop).onclick = () => { navigator.clipboard?.writeText(text).then(() => toast('Copied'), () => toast('Copy didn\'t work in this browser')); closePop(); };
  $('[data-note]', pop).onclick = () => noteEditor(pop, '', note => { addHighlight(saved, 'yellow', note); toast('Note saved'); });
  $('[data-define]', pop)?.addEventListener('click', () => { closePop(); showWordPop({ word: text, range: saved }); });
}

function showHighlightPop(mark) {
  closePop();
  const h = store.highlightsFor(R.b.id).find(x => x.id === mark.dataset.h);
  if (!h) return;
  const pop = document.createElement('div');
  pop.className = 'rpop';
  pop.innerHTML = `${swatches(h.color)}${h.note ? `<p class="rpop-note">${esc(h.note)}</p>` : ''}<div class="rpop-actions"><button data-note>${h.note ? 'Edit note' : 'Add note'}</button><button data-remove>Remove</button></div>`;
  placePop(pop, mark.getBoundingClientRect());
  $$('[data-color]', pop).forEach(b => b.onclick = () => { store.saveHighlight({ ...h, color: b.dataset.color }); closePop(); rerender(); });
  $('[data-remove]', pop).onclick = () => { store.removeHighlight(h.id); closePop(); rerender(); toast('Highlight removed'); };
  $('[data-note]', pop).onclick = () => noteEditor(pop, h.note, note => { store.saveHighlight({ ...h, note }); rerender(); toast('Note saved'); });
}

function noteEditor(pop, value, save) {
  pop.innerHTML = `<label class="rpop-label" for="note-in">Note</label><textarea id="note-in" rows="3" maxlength="2000" placeholder="What did you think?">${esc(value)}</textarea><div class="rpop-actions"><button data-cancel>Cancel</button><button data-save class="primary">Save</button></div>`;
  const ta = $('textarea', pop);
  ta.focus();
  $('[data-cancel]', pop).onclick = closePop;
  $('[data-save]', pop).onclick = () => { save(ta.value.trim()); closePop(); };
  ta.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('[data-save]', pop).click(); if (e.key === 'Escape') closePop(); };
}

async function showWordPop({ word, range }) {
  closePop();
  const pop = document.createElement('div');
  pop.className = 'rpop word';
  pop.innerHTML = `<div class="def-head"><b>${esc(word)}</b><span class="ph"></span></div><div class="def-body"><p class="def-loading">Looking it up…</p></div>${swatches()}`;
  const saved = range.cloneRange();
  placePop(pop, saved.getBoundingClientRect());
  $$('[data-color]', pop).forEach(b => b.onclick = () => { addHighlight(saved, b.dataset.color); closePop(); toast('Highlighted'); });
  const d = await define(word);
  if (!pop.isConnected) return;
  const body = $('.def-body', pop);
  if (!d) { body.innerHTML = `<p class="def-none">No meaning found for “${esc(word)}”. Names and old spellings often aren't in the dictionary.</p>`; return; }
  $('.ph', pop).textContent = d.phonetic || '';
  body.innerHTML = d.meanings.map(m => `<div class="def"><i>${esc(m.pos)}</i><ol>${m.defs.map(x => `<li>${esc(x)}</li>`).join('')}</ol></div>`).join('') + `<p class="def-src">${esc(d.source)}</p>`;
  placePop(pop, saved.getBoundingClientRect());
}

/* ---------------- panels: contents & notes, view settings ---------------- */

function togglePanel(kind, btn) {
  closePop();
  const other = kind === 'aa' ? '.toc' : '.aa';
  $(other, R.el)?.remove();
  $$('[aria-expanded]', R.el).forEach(b => b !== btn && b.setAttribute('aria-expanded', 'false'));
  const old = $('.' + kind, R.el);
  if (old) { old.remove(); btn.setAttribute('aria-expanded', 'false'); return; }
  btn.setAttribute('aria-expanded', 'true');
  if (kind === 'toc') return renderNotesPanel(R.mode === 'scan' ? 'marks' : 'toc');
  const p = R.prefs;
  const text = R.mode === 'text';
  R.el.insertAdjacentHTML('beforeend', `<div class="aa">
    <div><span class="lab">View</span><div class="seg two"><button data-view="book" aria-pressed="${p.view !== 'page'}">Book</button><button data-view="page" aria-pressed="${p.view === 'page'}">Page</button></div></div>
    <div><label for="scale">Page size</label><input id="scale" type="range" min="60" max="140" step="5" value="${Math.round((p.scale || 1) * 100)}"></div>
    ${text ? `<div><label for="fs">Text size</label><input id="fs" type="range" min="15" max="26" step="1" value="${p.fs}"></div>
    <div><span class="lab">Typeface</span><div class="seg two"><button data-face="serif" aria-pressed="${p.face === 'serif'}" style="font-family:var(--f-read)">Literata</button><button data-face="sans" aria-pressed="${p.face === 'sans'}">Geist</button></div></div>` : ''}
    <div><span class="lab">Page colour</span><div class="seg"><button class="sw-white" data-tone="white" aria-pressed="${p.tone === 'white'}">White</button><button class="sw-paper" data-tone="paper" aria-pressed="${p.tone === 'paper'}">Paper</button><button class="sw-night" data-tone="night" aria-pressed="${p.tone === 'night'}">Night</button></div></div>
    ${text ? '<p class="aa-tip">Tap a word to see its meaning. Select text to highlight it.</p>' : ''}
  </div>`);
  const aa = $('.aa', R.el);
  let t;
  const relayout = () => { clearTimeout(t); t = setTimeout(() => layout(), 120); };
  $$('[data-view]', aa).forEach(b => b.onclick = () => { p.view = b.dataset.view; store.savePrefs(); $$('[data-view]', aa).forEach(x => x.setAttribute('aria-pressed', x === b)); layout(); });
  $('#scale', aa).oninput = e => { p.scale = +e.target.value / 100; store.savePrefs(); relayout(); };
  $('#fs', aa)?.addEventListener('input', e => { p.fs = +e.target.value; store.savePrefs(); R.el.style.setProperty('--fs', p.fs + 'px'); relayout(); });
  $$('[data-face]', aa).forEach(b => b.onclick = () => { p.face = b.dataset.face; store.savePrefs(); $$('[data-face]', aa).forEach(x => x.setAttribute('aria-pressed', x === b)); layout(); });
  $$('[data-tone]', aa).forEach(b => b.onclick = () => { p.tone = b.dataset.tone; store.savePrefs(); R.el.dataset.tone = p.tone; $$('[data-tone]', aa).forEach(x => x.setAttribute('aria-pressed', x === b)); });
}

function renderNotesPanel(tab) {
  $('.toc', R.el)?.remove();
  const marks = store.bookmarksFor(R.b.id).sort((a, b) => (a.locator.ch ?? 0) - (b.locator.ch ?? 0) || (a.locator.frac ?? a.locator.page ?? 0) - (b.locator.frac ?? b.locator.page ?? 0));
  const hls = store.highlightsFor(R.b.id).sort((a, b) => a.locator.ch - b.locator.ch || a.locator.sp - b.locator.sp || a.locator.so - b.locator.so);
  const tabs = [...(R.mode === 'text' ? [['toc', 'Contents', null]] : []), ['marks', 'Bookmarks', marks.length], ...(R.mode === 'text' ? [['hls', 'Highlights', hls.length]] : [])];
  let body = '';
  if (tab === 'toc') body = `<ol>${R.text.chapters.map((c, i) => `<li><button data-ch="${i}" aria-current="${i === R.ch}"><em>${i + 1}</em><span>${esc(chapterName(c))}</span></button></li>`).join('')}</ol>`;
  if (tab === 'marks') body = marks.length ? `<ol>${marks.map(m => `<li class="note-row"><button data-loc='${esc(JSON.stringify(m.locator))}'><i class="mk">${I.ribbon}</i><span>${esc(m.label || 'Bookmark')}</span></button><button class="x" data-del-mark="${m.id}" aria-label="Remove bookmark">${I.x}</button></li>`).join('')}</ol>` : '<p class="toc-empty">No bookmarks yet. Press the ribbon at the top, or B, to mark a page.</p>';
  if (tab === 'hls') body = hls.length ? `<ol>${hls.map(h => `<li class="note-row"><button data-loc='${esc(JSON.stringify(h.locator))}'><i class="dot hl-${h.color}"></i><span><q>${esc(h.text.slice(0, 160))}${h.text.length > 160 ? '…' : ''}</q>${h.note ? `<small class="nt">${esc(h.note)}</small>` : ''}<small>${esc(h.chapter || '')}</small></span></button><button class="x" data-del-hl="${h.id}" aria-label="Remove highlight">${I.x}</button></li>`).join('')}</ol>` : '<p class="toc-empty">No highlights yet. Select any text on the page to highlight it.</p>';
  R.el.insertAdjacentHTML('beforeend', `<div class="toc"><div class="toc-tabs" role="tablist">${tabs.map(([k, n, c]) => `<button role="tab" data-tab="${k}" aria-selected="${k === tab}">${n}${c != null ? ` <em>${c}</em>` : ''}</button>`).join('')}</div>${body}</div>`);
  const toc = $('.toc', R.el);
  $('[aria-current="true"]', toc)?.scrollIntoView({ block: 'center' });
  const closeToc = () => { toc.remove(); $('[data-toc]', R.el).setAttribute('aria-expanded', 'false'); };
  $$('[data-tab]', toc).forEach(b => b.onclick = () => renderNotesPanel(b.dataset.tab));
  $$('[data-ch]', toc).forEach(b => b.onclick = () => { closeToc(); goChapter(+b.dataset.ch, 0, 0); });
  $$('[data-loc]', toc).forEach(b => b.onclick = () => { closeToc(); goLocator(JSON.parse(b.dataset.loc)); });
  $$('[data-del-mark]', toc).forEach(b => b.onclick = () => { store.removeBookmark(b.dataset.delMark); renderNotesPanel('marks'); draw(); });
  $$('[data-del-hl]', toc).forEach(b => b.onclick = () => { store.removeHighlight(b.dataset.delHl); renderNotesPanel('hls'); rerender(); });
}

export function readerKey(e) {
  if (!R) return false;
  if (e.target.closest?.('input, textarea')) return true;
  input();
  if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); turn(1); }
  else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); turn(-1); }
  else if (e.key === 'f' || e.key === 'F') toggleFull();
  else if (e.key === 'b' || e.key === 'B') toggleBookmark();
  else if (e.key === 'Escape') {
    if ($('.rpop', R.el)) return closePop(), true;
    const open = $('.aa, .toc', R.el);
    if (open) { open.remove(); $$('[aria-expanded]', R.el).forEach(b => b.setAttribute('aria-expanded', 'false')); }
    else if (!document.fullscreenElement) closeReader();
  }
  return true;
}
