// The two signature moments: a book flying from a shelf into its page,
// and a book opening in front of you before the reader appears.
import { $, $$, wait, reduceMotion, esc } from '../lib/util.js';

let busy = false;
export const isBusy = () => busy;

function cloneBook(srcBk, rect) {
  const wrap = document.createElement('div');
  wrap.className = 'fly';
  const c = srcBk.cloneNode(true);
  c.querySelector('.bk-cap')?.remove();
  c.classList.remove('rise', 'is-pressed', 'dragging');
  c.style.cssText += `;--w:${rect.width}px;--h:${rect.height}px;--mx:0;--my:0;width:${rect.width}px`;
  wrap.style.cssText = `width:${rect.width}px;height:${rect.height}px;transform:translate(${rect.left}px,${rect.top}px)`;
  wrap.appendChild(c);
  return wrap;
}

/** Fly a book from a shelf to the big book on the detail page. `go` renders the detail page. */
export async function flyToDetail(a, go) {
  if (reduceMotion() || busy) { go(); return; }
  busy = true;
  try {
    const from = $('.bk-scene', a).getBoundingClientRect();
    const stage = $('#stage');
    const fly = cloneBook(a, from);
    stage.appendChild(fly);
    a.style.visibility = 'hidden';
    go();
    const view = $('#view');
    const target = $('.stage3d .bk', view);
    if (!target) { fly.remove(); return; }
    target.style.visibility = 'hidden';
    $('.ambient', view)?.animate([{ opacity: 0 }, { opacity: 0.38 }], { duration: 900, easing: 'ease-out' });
    $$('.info > *', view).forEach((el, i) => el.animate([{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 600, delay: 160 + i * 50, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' }));
    const to = $('.bk-scene', target).getBoundingClientRect();
    const sx = to.width / from.width;
    const fbk = $('.bk', fly), body = $('.bk-body', fbk), cov = $('.bk-cover', fbk);
    const t = parseFloat(fbk.style.getPropertyValue('--t')) || 20;
    const dur = 780, ease = 'cubic-bezier(.5,0,.15,1)';
    fly.animate([
      { transform: `translate(${from.left}px,${from.top}px) scale(1)` },
      { transform: `translate(${(from.left + to.left) / 2}px,${Math.min(from.top, to.top) - 40}px) scale(${(1 + sx) / 2})`, offset: 0.5 },
      { transform: `translate(${to.left}px,${to.top}px) scale(${sx})` },
    ], { duration: dur, easing: ease, fill: 'forwards' });
    body.animate([
      { transform: 'rotateX(8deg) rotateY(-28deg)' },
      { transform: 'rotateX(14deg) rotateY(-200deg)', offset: 0.55 },
      { transform: 'rotateX(5deg) rotateY(-386deg)' },
    ], { duration: dur, easing: ease, fill: 'forwards' });
    cov.animate([{ transform: `translateZ(${t / 2}px) rotateY(-30deg)` }, { transform: `translateZ(${t / 2}px) rotateY(0deg)` }], { duration: dur * 0.5, easing: ease, fill: 'forwards' });
    await wait(dur);
    target.style.visibility = '';
    fly.remove();
  } finally {
    a.style.visibility = '';
    busy = false;
  }
}

/** Center the book, swing the cover open, riffle the pages, then hand over to the reader. */
export async function openBookAnimation(srcBk, b, onOpen) {
  if (reduceMotion() || busy || !srcBk) { onOpen(); return; }
  busy = true;
  const stage = $('#stage');
  try {
    const veil = document.createElement('div'); veil.className = 'veil'; stage.appendChild(veil);
    const from = $('.bk-scene', srcBk).getBoundingClientRect();
    const fly = cloneBook(srcBk, from);
    const fbk = $('.bk', fly);
    $('.bk-ribbon', fbk)?.remove();
    const t = parseFloat(srcBk.style.getPropertyValue('--t')) || 30;
    const body = $('.bk-body', fbk), cov = $('.bk-cover', fbk);
    const leaves = [];
    for (let i = 0; i < 7; i++) {
      const lf = document.createElement('div'); lf.className = 'leaf';
      lf.style.transform = `translateZ(${t / 2 - 1.2 - i * 0.3}px)`;
      lf.innerHTML = i === 6
        ? `<div class="lines"></div><div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8%;font-family:var(--f-display);color:#2b2e35;text-align:center;padding:12%"><span style="font-size:${from.width * 0.1}px;line-height:1.1">${esc(b.title)}</span><span style="font-family:var(--f-read);font-style:italic;font-size:${from.width * 0.055}px;color:#8a8f99">${esc(b.author)}</span></div>`
        : '<div class="lines"></div><div class="lines"></div>';
      body.insertBefore(lf, cov); leaves.push(lf);
    }
    stage.appendChild(fly);
    srcBk.style.visibility = 'hidden';
    const vw = innerWidth, vh = innerHeight;
    const H = Math.min(vh * 0.72, 620), sc = H / from.height, W = from.width * sc;
    const tx = vw / 2, ty = (vh - H) / 2;
    const ease = 'cubic-bezier(.45,0,.1,1)';
    veil.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, fill: 'forwards' });
    const curRy = getComputedStyle(srcBk).getPropertyValue('--ry').trim() || '-26deg';
    // once the cover opens the spread is twice as wide, so the spine ends at the center
    const startX = 2 * W < vw - 24 ? tx : tx - W / 2;
    fly.animate([
      { transform: `translate(${from.left}px,${from.top}px) scale(1)` },
      { transform: `translate(${tx - W / 2}px,${ty}px) scale(${sc})`, offset: 0.45 },
      { transform: `translate(${startX}px,${ty}px) scale(${sc})` },
    ], { duration: 1100, easing: ease, fill: 'forwards' });
    body.animate([{ transform: `rotateX(5deg) rotateY(${curRy})` }, { transform: 'rotateX(0deg) rotateY(0deg)', offset: 0.45 }, { transform: 'rotateX(0deg) rotateY(0deg)' }], { duration: 1100, easing: ease, fill: 'forwards' });
    await wait(420);
    cov.animate([{ transform: `translateZ(${t / 2}px) rotateY(0deg)` }, { transform: `translateZ(${t / 2}px) rotateY(-178deg)` }], { duration: 900, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
    await wait(520);
    leaves.forEach((lf, i) => lf.animate([
      { transform: `translateZ(${t / 2 - 1.2 - i * 0.3}px) rotateY(0deg)` },
      { transform: `translateZ(${t / 2 - 1.2 + i * 0.3}px) rotateY(-176deg)` },
    ], { duration: 620, delay: i * 70, easing: 'cubic-bezier(.45,.05,.2,1)', fill: 'forwards' }));
    await wait(6 * 70 + 560);
    fly.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 380, fill: 'forwards' });
    onOpen(true);
    await wait(400);
  } finally {
    stage.innerHTML = '';
    srcBk.style.visibility = '';
    busy = false;
  }
}
