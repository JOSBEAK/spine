export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const wait = ms => new Promise(r => setTimeout(r, ms));
export const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Muted, bookish cloth colours for books without a sampled cover colour.
const CLOTH = ['#2f4858', '#7a2a2a', '#3d5a40', '#5b4a7a', '#8a5a2b', '#274060', '#6b3e4f', '#45505c', '#7b6a3a', '#2e5e5a', '#5a2e3a', '#3a4a6b'];
export const clothFor = key => CLOTH[hashStr(key) % CLOTH.length];

export function isLight(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  if (Number.isNaN(n)) return false;
  const r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 165;
}

export function fmtClock(sec) {
  if (!Number.isFinite(sec)) return '0:00';
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function readingTime(pages) {
  if (!pages) return null;
  const m = Math.round(pages * 1.7);
  return m < 60 ? `${m} min` : `about ${Math.round(m / 60)} h`;
}

export function titleCase(s) {
  if (s !== s.toUpperCase()) return s;
  const small = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
  return s.toLowerCase().replace(/\b([a-z])([a-z']*)/g, (m, a, b, i) => (i > 0 && small.has(m) ? m : a.toUpperCase() + b));
}

export async function fetchJSON(url, { timeout = 20000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

/** Fade an element out and remove it, even if animations are paused (background tabs). */
export function fadeOut(el, ms = 220, frames = [{ opacity: 1 }, { opacity: 0 }]) {
  try { el.animate(frames, { duration: ms, easing: 'ease-in', fill: 'forwards' }); } catch { /* no WAAPI */ }
  setTimeout(() => el.remove(), ms + 30);
}
