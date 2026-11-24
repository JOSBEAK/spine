import { $, $$, esc, readingTime } from '../lib/util.js';
import { store } from '../lib/store.js';
import { getBook, getDescription, search, coverURL } from '../lib/openlibrary.js';
import { findText, findAudio, epubFor, loadText } from '../lib/archive.js';
import { bookHTML, applyTone } from '../ui/book.js';
import { rowHTML, wireRows } from '../ui/rows.js';
import { I } from '../ui/icons.js';
import { toast } from '../ui/toast.js';

export function bookLoading() {
  return { html: `<section class="detail"><div class="detail-grid"><div class="stage3d"></div><div class="info"><p class="eyebrow">Finding this book…</p></div></div></section>`, wire() {} };
}

const stream = (kind, { icon, title, text, src, go, best, disabled, checking, href }) => {
  const tag = href ? 'a' : 'button';
  const attrs = href ? `href="${href}" target="_blank" rel="noopener"` : `type="button" data-way="${kind}" ${disabled ? 'disabled' : ''}`;
  return `<li data-li="${kind}"><${tag} class="stream ${best ? 'best' : ''} ${checking ? 'checking' : ''}" ${attrs}><span class="ic">${icon}</span><span><b>${title}</b><span>${text}</span><span class="src">${src}</span></span><span class="go">${go}</span></${tag}></li>`;
};

function ways(b, st) {
  const S = store.sources;
  const out = [];
  if (S.gutenberg !== false) {
    out.push(st.gut === undefined
      ? stream('read', { icon: I.book, title: 'Read in Spine', text: 'Looking for a clean copy…', src: 'Project Gutenberg', go: 'Checking', checking: true, disabled: true })
      : st.gut
        ? stream('read', { icon: I.book, title: 'Read in Spine', text: 'Clean text with page turns. Change the font and size.', src: 'Project Gutenberg', go: 'Open', best: true })
        : stream('read', { icon: I.book, title: 'Read in Spine', text: "Project Gutenberg doesn't have a typeset copy of this book.", src: 'Project Gutenberg', go: 'Not available', disabled: true }));
  }
  if (S.archive !== false) {
    out.push(b.scan
      ? stream('scan', { icon: I.scan, title: 'Original printed pages', text: 'Page-by-page scan of a printed edition', src: 'Internet Archive', go: 'View scan', best: S.gutenberg === false || st.gut === null })
      : stream('scan', { icon: I.scan, title: 'Original printed pages', text: 'No public scan of this book', src: 'Internet Archive', go: 'Not available', disabled: true }));
  }
  if (S.librivox !== false) {
    out.push(st.lv === undefined
      ? stream('listen', { icon: I.ear, title: 'Listen', text: 'Looking for a recording…', src: 'LibriVox', go: 'Checking', checking: true, disabled: true })
      : st.lv
        ? stream('listen', { icon: I.ear, title: 'Listen', text: `Full recording${st.lv.runtime ? ` · ${st.lv.runtime}` : ''}`, src: 'LibriVox', go: 'Play' })
        : stream('listen', { icon: I.ear, title: 'Listen', text: 'No volunteer recording yet', src: 'LibriVox', go: 'Not available', disabled: true }));
  }
  if (S.gutenberg !== false && st.epub) {
    out.push(stream('epub', { icon: I.down, title: 'Download for your e-reader', text: 'EPUB file for Kobo, Kindle, Apple Books and others', src: 'Project Gutenberg', go: 'Download', href: st.epub }));
  }
  const n = [st.gut, b.scan, st.lv].filter(Boolean).length;
  return { list: out.join(''), n };
}

export function bookPage(b) {
  const p = store.progress(b.id);
  const words = b.title.split(' ').map((w, i) => `<span class="w" style="--i:${i}">${esc(w)}</span>`).join(' ');
  const blurb = b.blurb || b.first || '';
  const html = `<section class="detail">
    <div class="ambient" style="${b.cover ? `background-image:url(${coverURL(b, 'M')})` : `background:${b.tone}`}"></div>
    <button class="back" data-back>${I.arrowL} Back</button>
    <div class="detail-grid">
      <div class="stage3d">${bookHTML(b, { cap: false, scale: 1.7 })}<p class="hint">${I.hand} Drag the book to turn it over</p></div>
      <div class="info">
        <p class="eyebrow">${b.year ? `First published ${esc(b.year)}` : 'Public domain'}</p>
        <h1>${words}</h1>
        <p class="by"><a href="#/discover?q=${encodeURIComponent(b.author)}&mode=all">${esc(b.author)}</a></p>
        <dl class="facts">
          ${b.year ? `<div><dt>First published</dt><dd>${esc(b.year)}</dd></div>` : ''}
          ${b.pages ? `<div><dt>Length</dt><dd>${b.pages} pages</dd></div><div><dt>Reading time</dt><dd>${readingTime(b.pages)}</dd></div>` : ''}
          <div data-audio-fact><dt>Audiobook</dt><dd class="dim">${b.audio || 'Checking…'}</dd></div>
        </dl>
        <p class="blurb ${blurb ? '' : 'loading'}">${esc(blurb) || 'Loading the description…'}</p>
        <div class="btns">
          <button class="btn btn-ink" data-primary>${p ? `Keep reading · ${Math.round(p.pct * 100)}%` : 'Start reading'} ${I.arrowR}</button>
          <button class="btn btn-line shelf-btn" data-shelf aria-pressed="${store.onShelf(b.id)}"><span class="rb"></span><span>${store.onShelf(b.id) ? 'On your shelf' : 'Add to shelf'}</span></button>
        </div>
        <div class="ways">
          <h2>Ways to read</h2>
          <p class="ways-n">Checking free libraries…</p>
          <ul class="streams">${ways(b, store.found(b.id) && 'gut' in store.found(b.id) ? { gut: store.found(b.id).gut } : (b.gut ? { gut: b.gut } : {})).list}</ul>
        </div>
        ${b.subjects?.length ? `<div class="subjects">${b.subjects.map(s => `<a href="#/discover?subject=${encodeURIComponent(s)}&label=${encodeURIComponent(s)}&mode=all">${esc(s)}</a>`).join('')}</div>` : ''}
      </div>
    </div>
    ${rowHTML({ title: 'More like this', load: async () => {
      const subj = b.subjects?.[0] || b.genre && { Romance: 'Love stories', Mystery: 'Detective and mystery stories', Gothic: 'Horror tales', SciFi: 'Science fiction', Adventure: 'Adventure stories', Children: "Children's stories", Ideas: 'Philosophy', Poetry: 'Poetry', Classics: 'Classic literature' }[b.genre];
      const r = await search({ subject: subj || '', q: subj ? '' : b.author, limit: 24 });
      return r.books.filter(x => x.id !== b.id);
    } })}
  </section>`;

  return {
    html,
    wire(root, actions) {
      wireRows(root);
      applyTone(root, b);
      store.remember(b);
      const st = { gut: b.gut || undefined };
      const refresh = () => {
        const w = ways(b, st);
        $('.streams', root).innerHTML = w.list;
        $('.ways-n', root).textContent = st.gut === undefined || st.lv === undefined ? 'Checking free libraries…' : w.n ? `Found in ${w.n} free ${w.n === 1 ? 'library' : 'libraries'}` : 'No free copy found yet';
        $$('[data-way]', root).forEach(btn => btn.onclick = () => actions[btn.dataset.way](b, btn));
      };
      refresh();
      Promise.allSettled([
        findText(b).then(g => { st.gut = g; if (g) loadText(g).catch(() => {}); if (g) epubFor(g).then(u => { st.epub = u; if (root.isConnected) refresh(); }).catch(() => {}); }).catch(() => { st.gut = null; }),
        findAudio(b).then(a => { st.lv = a; if (a) b.audio = a.runtime; }).catch(() => { st.lv = null; }),
      ]).then(() => {
        if (!root.isConnected) return;
        refresh();
        const fact = $('[data-audio-fact] dd', root);
        fact.textContent = st.lv ? (st.lv.runtime || 'Available') : 'None yet';
        fact.classList.toggle('dim', !st.lv);
      });

      if (!b.blurb) getDescription(b.id).then(d => {
        if (!root.isConnected) return;
        const el = $('.blurb', root);
        el.classList.remove('loading');
        const text = d || b.first || '';
        if (!text) { el.remove(); return; }
        const short = text.length > 520 ? text.slice(0, 500).replace(/\s+\S*$/, '') + '…' : text;
        el.textContent = short;
        if (short !== text) {
          const more = document.createElement('button');
          more.className = 'more-btn'; more.textContent = 'Read more';
          more.onclick = () => { el.textContent = text; };
          el.append(' ', more);
        }
      });

      // drag to turn the book around
      const bk = $('.stage3d .bk', root);
      let drag = null, ry = -26, rx = 5;
      const set = () => { bk.style.setProperty('--ry', ry + 'deg'); bk.style.setProperty('--rx', rx + 'deg'); };
      bk.addEventListener('click', e => e.preventDefault());
      bk.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, ry, rx }; bk.classList.add('dragging'); bk.setPointerCapture(e.pointerId); bk.style.setProperty('--mx', 0); bk.style.setProperty('--my', 0); });
      bk.addEventListener('pointermove', e => { if (!drag) return; ry = drag.ry + (e.clientX - drag.x) * 0.6; rx = Math.max(-25, Math.min(25, drag.rx - (e.clientY - drag.y) * 0.3)); set(); });
      const end = () => {
        if (!drag) return; drag = null; bk.classList.remove('dragging');
        const n = ((ry % 360) + 360) % 360, back = n > 90 && n < 270, rest = back ? 206 : -26;
        ry = Math.round((ry - rest) / 360) * 360 + rest; rx = 5; set();
      };
      bk.addEventListener('pointerup', end); bk.addEventListener('pointercancel', end);

      $('[data-back]', root).onclick = () => (history.length > 1 ? history.back() : (location.hash = '#/'));
      const sb = $('[data-shelf]', root);
      sb.onclick = () => {
        const on = store.toggleShelf(b);
        sb.setAttribute('aria-pressed', on);
        sb.lastElementChild.textContent = on ? 'On your shelf' : 'Add to shelf';
        toast(on ? 'Added to your shelf' : 'Removed from your shelf');
      };
      $('[data-primary]', root).onclick = async e => {
        const btn = e.currentTarget;
        if (st.gut === undefined) { btn.disabled = true; try { st.gut = await findText(b); } catch { st.gut = null; } btn.disabled = false; }
        if (st.gut && store.sources.gutenberg !== false) actions.read(b, btn);
        else if (b.scan && store.sources.archive !== false) actions.scan(b, btn);
        else toast('No free copy of this book is available to read yet.');
      };
    },
  };
}

export async function loadBookPage(id) {
  const b = await getBook(id);
  return bookPage(b);
}
