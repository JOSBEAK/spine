// A small audiobook player that stays at the bottom while you browse.
import { $, $$, esc, fmtClock } from '../lib/util.js';
import { store } from '../lib/store.js';
import { coverURL } from '../lib/openlibrary.js';
import { findAudio, tracks as getTracks } from '../lib/archive.js';
import { I } from './icons.js';
import { toast } from './toast.js';

const audio = new Audio();
audio.preload = 'metadata';
let P = null; // { b, item, list, i }
const SPEEDS = [1, 1.25, 1.5, 0.8];

export async function listen(b, { resume = false } = {}) {
  const saved = store.audio;
  const same = saved?.bookId === b.id;
  try {
    const lv = await findAudio(b);
    if (!lv) { toast('LibriVox has no recording of this book yet.'); return; }
    const list = await getTracks(lv.item);
    if (!list.length) { toast('This recording has no playable files.'); return; }
    const i = same ? Math.min(saved.track, list.length - 1) : 0;
    P = { b, item: lv.item, list, i, runtime: lv.runtime };
    store.remember(b);
    render();
    load(i, same ? saved.time : 0, !resume);
  } catch {
    toast("The recording didn't load. Try again in a moment.");
  }
}

function load(i, at = 0, play = true) {
  P.i = i;
  const t = P.list[i];
  audio.src = t.url;
  audio.currentTime = 0;
  const seekTo = () => { if (at) audio.currentTime = at; audio.removeEventListener('loadedmetadata', seekTo); };
  audio.addEventListener('loadedmetadata', seekTo);
  audio.playbackRate = store.prefs.speed || 1;
  if (play) audio.play().catch(() => {});
  save();
  update();
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: `${P.b.title} · ${t.title}`, artist: P.b.author, album: 'LibriVox',
      artwork: P.b.cover ? [{ src: coverURL(P.b, 'L'), sizes: '400x600', type: 'image/jpeg' }] : [],
    });
    navigator.mediaSession.setActionHandler('previoustrack', () => step(-1));
    navigator.mediaSession.setActionHandler('nexttrack', () => step(1));
  }
}

const save = () => P && store.setAudio({ bookId: P.b.id, item: P.item, track: P.i, time: Math.floor(audio.currentTime || 0) });
function step(d) { const n = P.i + d; if (n >= 0 && n < P.list.length) load(n); }

function render() {
  $('.player')?.remove(); $('.tracks')?.remove();
  const el = document.createElement('div');
  el.className = 'player';
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Audiobook player');
  el.innerHTML = `${P.b.cover ? `<img src="${coverURL(P.b, 'S')}" alt="">` : ''}
    <div class="t"><b>${esc(P.b.title)}</b><span class="tt"></span></div>
    <button class="ctl" data-prev aria-label="Previous chapter">${I.prev}</button>
    <button class="play" aria-label="Play">${I.play}</button>
    <button class="ctl" data-next aria-label="Next chapter">${I.next}</button>
    <div class="scrub" aria-label="Position in chapter"><div class="track"></div><div class="fill"></div><div class="knob"></div></div>
    <span class="times"></span>
    <button class="ctl speed" data-speed aria-label="Playback speed"></button>
    <button class="ctl" data-list aria-label="All chapters">${I.list}</button>
    <button class="ctl" data-x aria-label="Close player">${I.x}</button>`;
  document.body.appendChild(el);
  document.body.classList.add('has-player');
  $('.play', el).onclick = () => (audio.paused ? audio.play().catch(() => {}) : audio.pause());
  $('[data-prev]', el).onclick = () => (audio.currentTime > 5 ? (audio.currentTime = 0) : step(-1));
  $('[data-next]', el).onclick = () => step(1);
  $('.scrub', el).onclick = e => { const r = e.currentTarget.getBoundingClientRect(); if (audio.duration) audio.currentTime = (e.clientX - r.left) / r.width * audio.duration; };
  $('[data-speed]', el).onclick = () => { const p = store.prefs; p.speed = SPEEDS[(SPEEDS.indexOf(p.speed || 1) + 1) % SPEEDS.length]; store.savePrefs(); audio.playbackRate = p.speed; update(); };
  $('[data-list]', el).onclick = toggleList;
  $('[data-x]', el).onclick = () => { audio.pause(); save(); $('.tracks')?.remove(); document.body.classList.remove('has-player'); el.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(20px)' }], { duration: 220 }).onfinish = () => el.remove(); P = null; };
  update();
}

function toggleList() {
  const old = $('.tracks');
  if (old) { old.remove(); return; }
  const el = document.createElement('div');
  el.className = 'tracks';
  el.innerHTML = P.list.map((t, i) => `<button data-i="${i}" aria-current="${i === P.i}"><em>${t.n}</em><span>${esc(t.title)}</span><small>${t.length ? fmtClock(t.length) : ''}</small></button>`).join('');
  document.body.appendChild(el);
  $('[aria-current="true"]', el)?.scrollIntoView({ block: 'center' });
  $$('[data-i]', el).forEach(b => b.onclick = () => { el.remove(); load(+b.dataset.i); });
}

function update() {
  const el = $('.player');
  if (!el || !P) return;
  const t = P.list[P.i];
  $('.tt', el).textContent = `${t.title} · ${P.i + 1} of ${P.list.length}`;
  const playing = !audio.paused;
  el.classList.toggle('playing', playing);
  const pb = $('.play', el);
  pb.innerHTML = playing ? I.pause : I.play;
  pb.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  const d = audio.duration || t.length || 0, c = audio.currentTime || 0;
  const f = d ? Math.min(1, c / d) : 0;
  $('.fill', el).style.width = f * 100 + '%';
  $('.knob', el).style.left = f * 100 + '%';
  $('.times', el).textContent = `${fmtClock(c)} / ${fmtClock(d)}`;
  $('[data-speed]', el).textContent = `${store.prefs.speed || 1}×`;
}

let lastSave = 0;
audio.addEventListener('timeupdate', () => { update(); if (Date.now() - lastSave > 5000) { lastSave = Date.now(); save(); } });
['play', 'pause', 'loadedmetadata'].forEach(ev => audio.addEventListener(ev, update));
audio.addEventListener('ended', () => step(1));
audio.addEventListener('error', () => {
  if (!P || !audio.getAttribute('src')) return;
  toast("This chapter didn't load. Skipping to the next one.");
  step(1);
});
