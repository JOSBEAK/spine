import { $, $$, esc, isLight, clothFor } from '../lib/util.js';
import { coverURL } from '../lib/openlibrary.js';
import { store } from '../lib/store.js';
import { I } from './icons.js';

export const thickness = (b, scale = 1) => Math.round(Math.min(46, Math.max(12, (b.pages || 220) / 13)) * scale);
export const toneOf = b => store.tone(b.id) || b.tone || clothFor(b.id);

export const isBorrow = b => b.access === 'borrowable';
export const isTextbook = b => b.kind === 'textbook';

export function frontHTML(b) {
  const tone = toneOf(b);
  if (isTextbook(b)) {
    return `<div class="tb ${isLight(tone) ? 'light' : ''}" style="background:${tone}">${b.coverArt ? `<img src="${b.coverArt}" alt="" loading="lazy" decoding="async">` : `<b>${esc(b.title)}</b>`}<i>${esc(b.subject)}</i><small>OpenStax</small></div>`;
  }
  const gen = `<div class="gen ${isLight(tone) ? 'light' : ''}"><b>${esc(b.title)}</b><i>${esc(b.author)}</i></div>`;
  const url = coverURL(b);
  return url
    ? `${gen}<img src="${url}" alt="" loading="lazy" decoding="async" class="loading" onload="this.classList.remove('loading');if(this.naturalWidth<5)this.remove()" onerror="this.remove()">`
    : gen;
}

/** A 3D book. Options: cap (caption), meter (progress bar), scale (thickness), cls, i (stagger index), ribbon. */
export function bookHTML(b, o = {}) {
  const t = thickness(b, o.scale || 1);
  const p = store.progress(b.id);
  const pct = p ? Math.round(p.pct * 100) : null;
  const audio = b.audio || store.found(b.id)?.lv;
  const tag = isTextbook(b) ? '<em class="tag tag-tb">Textbook</em>' : isBorrow(b) ? '<em class="tag" title="Borrow free with an Internet Archive account">Borrow</em>' : '';
  const cap = o.cap === false ? '' : `<div class="bk-cap"><b>${esc(b.title)}</b><span>${tag}${esc(b.author)}${b.year ? ` · ${esc(b.year)}` : ''}${audio ? ` · <span class="audio" title="Has a free audiobook">${I.hp}</span>` : ''}</span>${o.meter && pct != null ? `<div class="meter"><i style="width:${pct}%"></i></div>` : ''}</div>`;
  const ribbon = pct != null && pct < 99 && o.ribbon !== false;
  return `<a class="bk ${o.cls || ''}" href="#/book/${b.id}" data-id="${b.id}" style="--tone:${toneOf(b)};--t:${t}px;${o.i != null ? `--i:${o.i};` : ''}" aria-label="${esc(b.title)} by ${esc(b.author)}">
    <div class="bk-scene"><div class="bk-shadow"></div><div class="bk-body">
      <div class="bk-face bk-back"><b>${esc(b.title)}</b><p>${esc((b.blurb || b.first || '').slice(0, 220))}</p></div>
      <div class="bk-face bk-spine"><span>${esc(b.title)}</span></div>
      <div class="bk-face bk-top"></div>
      <div class="bk-face bk-pages"></div>
      <div class="bk-face bk-first"><b>${esc(b.title)}</b><span></span><i>${esc(b.author)}</i></div>
      <div class="bk-cover"><div class="bk-face bk-front">${frontHTML(b)}<i class="bk-sheen"></i></div><div class="bk-face bk-inside"></div></div>
      ${ribbon ? '<div class="bk-ribbon"></div>' : ''}
    </div></div>${cap}</a>`;
}

export const skeletonHTML = n => Array.from({ length: n }, () => `<div class="bk skel"><div class="bk-scene"><div class="bk-body"><div class="bk-cover"><div class="bk-face bk-front"></div></div></div></div><div class="bk-cap"><b></b><span></span></div></div>`).join('');

/* The book leans toward the cursor, lifts and opens a little on hover (CSS does the rest). */
export function installTilt() {
  document.addEventListener('pointermove', e => {
    const bk = e.target.closest?.('.bk');
    if (!bk || e.pointerType !== 'mouse' || bk.classList.contains('dragging')) return;
    const r = $('.bk-scene', bk).getBoundingClientRect();
    bk.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 2 - 1).toFixed(3));
    bk.style.setProperty('--my', ((e.clientY - r.top) / r.height * 2 - 1).toFixed(3));
  }, { passive: true });
  document.addEventListener('pointerout', e => {
    const bk = e.target.closest?.('.bk');
    if (bk && !bk.contains(e.relatedTarget)) { bk.style.setProperty('--mx', 0); bk.style.setProperty('--my', 0); }
  });
  document.addEventListener('pointerdown', e => { const bk = e.target.closest?.('.bk'); if (bk && !bk.closest('.stage3d')) bk.classList.add('is-pressed'); });
  document.addEventListener('pointerup', () => $$('.bk.is-pressed').forEach(b => b.classList.remove('is-pressed')));
}

/* Sample the cover's main colour once, so spines, edges and backs match the cover. */
const pending = new Map();
export function sampleTone(b) {
  if (!b.cover || store.tone(b.id)) return Promise.resolve(store.tone(b.id) || toneOf(b));
  if (pending.has(b.id)) return pending.get(b.id);
  const p = new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = 24; c.height = 36;
        const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(img, 0, 0, 24, 36);
        const d = x.getImageData(0, 0, 24, 36).data;
        const buckets = new Map();
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], g = d[i + 1], bl = d[i + 2];
          const l = (Math.max(r, g, bl) + Math.min(r, g, bl)) / 510;
          if (l < 0.1 || l > 0.86) continue;
          const k = (r >> 5) << 6 | (g >> 5) << 3 | (bl >> 5);
          const e = buckets.get(k) || { n: 0, r: 0, g: 0, b: 0 };
          e.n++; e.r += r; e.g += g; e.b += bl; buckets.set(k, e);
        }
        const top = [...buckets.values()].sort((a, z) => z.n - a.n)[0];
        if (!top) return resolve(toneOf(b));
        let [r, g, bl] = [top.r / top.n, top.g / top.n, top.b / top.n];
        // keep it a believable cloth colour: not too bright, not too grey
        const l = (Math.max(r, g, bl) + Math.min(r, g, bl)) / 510;
        const k = l > 0.6 ? 0.6 / l : l < 0.22 ? 0.22 / l : 1;
        [r, g, bl] = [r, g, bl].map(v => Math.min(255, Math.round(v * k)));
        const hex = '#' + [r, g, bl].map(v => v.toString(16).padStart(2, '0')).join('');
        store.setTone(b.id, hex);
        resolve(hex);
      } catch { resolve(toneOf(b)); }
    };
    img.onerror = () => resolve(toneOf(b));
    img.src = coverURL(b, 'S');
  });
  pending.set(b.id, p);
  return p;
}

export function applyTone(root, b) {
  sampleTone(b).then(t => $$(`[data-id="${b.id}"]`, root).forEach(el => el.style.setProperty('--tone', t)));
}
