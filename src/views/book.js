import { $, $$, esc, readingTime } from '../lib/util.js';
import { store } from '../lib/store.js';
import { getBook, getDescription, search, searchTextbooks, coverURL, borrowURL } from '../lib/openlibrary.js';
import { findText, findAudio, epubFor, loadText } from '../lib/archive.js';
import { bookHTML, applyTone, isBorrow, isTextbook } from '../ui/book.js';
import { rowHTML, wireRows } from '../ui/rows.js';
import { I } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { fillActivity } from '../ui/activity.js';
import { accountsEnabled } from '../lib/api.js';
import { bookReaders } from '../lib/reads.js';

export function bookLoading() {
  return { html: `<section class="detail"><div class="detail-grid"><div class="stage3d"></div><div class="info"><p class="eyebrow">Finding this book…</p></div></div></section>`, wire() {} };
}

// One row per way to read, like Stremio's stream list: the row opens it inside Spine,
// the small arrow opens the original site in a new tab.
const stream = (kind, { icon, title, text, src, go, best, disabled, checking, href, ext }) => {
  const tag = href ? 'a' : 'button';
  const attrs = href ? `href="${href}" target="_blank" rel="noopener"` : `type="button" data-way="${kind}" ${disabled ? 'disabled' : ''}`;
  const out = ext && !disabled ? `<a class="stream-ext" href="${ext}" target="_blank" rel="noopener" aria-label="Open ${esc(title)} in your browser" title="Open in browser">${I.ext}</a>` : '';
  return `<li data-li="${kind}" class="${ext && !disabled ? 'has-ext' : ''}"><${tag} class="stream ${best ? 'best' : ''} ${checking ? 'checking' : ''}" ${attrs}><span class="ic">${icon}</span><span><b>${title}</b><span>${text}</span><span class="src">${src}</span></span><span class="go">${go}</span></${tag}>${out}</li>`;
};

const gutenbergURL = item => { const m = /(\d{1,6})gut$/.exec(item || ''); return m ? `https://www.gutenberg.org/ebooks/${parseInt(m[1], 10)}` : 'https://www.gutenberg.org'; };
const iaURL = item => `https://archive.org/details/${encodeURIComponent(item)}`;

// A book first published before 1929 may be public domain in the US, so free libraries can have it.
const maybePublicDomain = b => !b.year || parseInt(b.year, 10) < 1929 || /BC|c\./.test(b.year);

function textbookWays(b) {
  const S = store.sources;
  if (S.openstax === false) return { list: '', n: 0 };
  return {
    list: stream('textbook', { icon: I.book, title: 'Read here', text: 'The full textbook with figures and practice questions, inside Spine.', src: 'OpenStax', go: 'Read here', best: true, ext: b.web })
      + (b.pdf ? stream('pdf', { icon: I.down, title: 'Download the PDF', text: 'Keep it offline or print the chapters you need', src: 'OpenStax', go: 'Download', href: b.pdf }) : ''),
    n: 1,
  };
}

function ways(b, st) {
  const S = store.sources;
  const out = [];
  const borrow = isBorrow(b);
  const old = maybePublicDomain(b);
  if (borrow && S.lending !== false) {
    out.push(stream('borrow', { icon: I.scan, title: 'Borrow free', text: 'Look inside here, then borrow it for an hour or for 14 days in the Archive\'s reader window. Needs a free archive.org account.', src: 'Open Library lending library', go: 'Look inside', best: !st.gut, ext: borrowURL(b) }));
  }
  if (S.gutenberg !== false && (!borrow || old)) {
    out.push(st.gut === undefined
      ? stream('read', { icon: I.book, title: 'Read in Spine', text: 'Looking for a clean copy…', src: 'Project Gutenberg', go: 'Checking', checking: true, disabled: true })
      : st.gut
        ? stream('read', { icon: I.book, title: 'Clean text', text: 'Typeset text with page turns, highlights and a dictionary.', src: 'Project Gutenberg', go: 'Read here', best: true, ext: gutenbergURL(st.gut) })
        : borrow ? '' : stream('read', { icon: I.book, title: 'Read in Spine', text: "Project Gutenberg doesn't have a typeset copy of this book.", src: 'Project Gutenberg', go: 'Not available', disabled: true }));
  }
  if (S.archive !== false && !borrow) {
    out.push(b.scan
      ? stream('scan', { icon: I.scan, title: 'Original printed pages', text: 'Every page of a printed edition, with page turns and bookmarks.', src: 'Internet Archive', go: 'Read here', best: S.gutenberg === false || st.gut === null, ext: iaURL(b.scan) })
      : stream('scan', { icon: I.scan, title: 'Original printed pages', text: 'No public scan of this book', src: 'Internet Archive', go: 'Not available', disabled: true }));
  }
  if (S.librivox !== false && old) {
    out.push(st.lv === undefined
      ? stream('listen', { icon: I.ear, title: 'Listen', text: 'Looking for a recording…', src: 'LibriVox', go: 'Checking', checking: true, disabled: true })
      : st.lv
        ? stream('listen', { icon: I.ear, title: 'Listen', text: `Full recording${st.lv.runtime ? ` · ${st.lv.runtime}` : ''}`, src: 'LibriVox', go: 'Play here', ext: iaURL(st.lv.item) })
        : borrow ? '' : stream('listen', { icon: I.ear, title: 'Listen', text: 'No volunteer recording yet', src: 'LibriVox', go: 'Not available', disabled: true }));
  }
  if (S.gutenberg !== false && st.epub) {
    out.push(stream('epub', { icon: I.down, title: 'Download for your e-reader', text: 'EPUB file for Kobo, Kindle, Apple Books and others', src: 'Project Gutenberg', go: 'Download', href: st.epub }));
  }
  const n = [st.gut, b.scan, st.lv, borrow && S.lending !== false].filter(Boolean).length;
  return { list: out.join(''), n };
}

function moreLike(b) {
  if (isTextbook(b)) {
    const same = searchTextbooks('', b.subject).filter(x => x.id !== b.id);
    return rowHTML({ title: `More ${b.subject.toLowerCase()} textbooks`, books: same.length ? same : searchTextbooks().filter(x => x.id !== b.id).slice(0, 20) });
  }
  return rowHTML({ title: 'More like this', load: async page => {
    const subj = b.subjects?.[0] || b.genre && { Romance: 'Love stories', Mystery: 'Detective and mystery stories', Gothic: 'Horror tales', SciFi: 'Science fiction', Adventure: 'Adventure stories', Children: "Children's stories", Ideas: 'Philosophy', Poetry: 'Poetry', Classics: 'Classic literature' }[b.genre];
    const r = await search({ subject: subj ? (subj.includes(':') ? subj : `subject:"${subj}"`) : '', q: subj ? '' : `author:"${b.author}"`, page, limit: 24 });
    return r.books.filter(x => x.id !== b.id);
  } });
}

export function bookPage(b) {
  const tb = isTextbook(b), borrow = isBorrow(b);
  const p = store.progress(b.id);
  const words = b.title.split(' ').map((w, i) => `<span class="w" style="--i:${i}">${esc(w)}</span>`).join(' ');
  const blurb = b.blurb || b.first || '';
  const eyebrow = tb ? `Free textbook · ${esc(b.subject)}` : borrow ? `${b.year ? `First published ${esc(b.year)} · ` : ''}Borrow free` : b.year ? `First published ${esc(b.year)}` : 'Public domain';
  const facts = tb
    ? `<div><dt>Subject</dt><dd>${esc(b.subject)}</dd></div><div><dt>Publisher</dt><dd>OpenStax</dd></div><div><dt>Price</dt><dd>Free</dd></div>`
    : `${b.year ? `<div><dt>First published</dt><dd>${esc(b.year)}</dd></div>` : ''}
       ${b.pages ? `<div><dt>Length</dt><dd>${b.pages} pages</dd></div><div><dt>Reading time</dt><dd>${readingTime(b.pages)}</dd></div>` : ''}
       ${borrow ? '<div><dt>Access</dt><dd>Borrow free</dd></div>' : `<div data-audio-fact><dt>Audiobook</dt><dd class="dim">${b.audio || 'Checking…'}</dd></div>`}`;
  const readersFact = accountsEnabled() ? '<div data-readers><dt>Read this month</dt><dd class="dim">Counting…</dd></div>' : '';
  const ext = tb ? b.web : borrow ? borrowURL(b) : null;
  const primary = `<button class="btn btn-ink" data-primary>${p && !tb && !borrow ? `Keep reading · ${Math.round(p.pct * 100)}%` : borrow ? 'Read here' : 'Start reading'} ${I.arrowR}</button>`
    + (ext ? `<a class="btn btn-line" href="${ext}" target="_blank" rel="noopener">Open in browser ${I.ext}</a>` : '');
  const authorLink = tb ? esc(b.author) : `<a href="#/discover?q=${encodeURIComponent(b.author)}&mode=all&sort=relevance">${esc(b.author)}</a>`;
  const ambient = b.cover ? `background-image:url(${coverURL(b, 'M')})` : `background:${b.tone}`;
  const initial = tb ? textbookWays(b) : ways(b, store.found(b.id) && 'gut' in store.found(b.id) ? { gut: store.found(b.id).gut } : (b.gut ? { gut: b.gut } : {}));
  const html = `<section class="detail">
    <div class="ambient" style="${ambient}"></div>
    <button class="back" data-back>${I.arrowL} Back</button>
    <div class="detail-grid">
      <div class="stage3d">${bookHTML(b, { cap: false, scale: tb ? 2 : 1.7 })}<p class="hint">${I.hand} Drag the book to turn it over</p></div>
      <div class="info">
        <p class="eyebrow">${eyebrow}</p>
        <h1>${words}</h1>
        <p class="by">${authorLink}</p>
        <dl class="facts">${facts}${readersFact}</dl>
        <p class="blurb ${blurb ? '' : 'loading'}">${esc(blurb) || 'Loading the description…'}</p>
        <div class="btns">
          ${primary}
          <button class="btn btn-line shelf-btn" data-shelf aria-pressed="${store.onShelf(b.id)}"><span class="rb"></span><span>${store.onShelf(b.id) ? 'On your shelf' : 'Add to shelf'}</span></button>
          ${store.inLibrary(b.id) ? `<button class="btn-quiet" data-remove-lib="${b.id}">${I.x} Remove from library</button>` : ''}
        </div>
        <div class="ways">
          <h2>Ways to read</h2>
          <p class="ways-n">${tb ? 'Free and openly licensed, from OpenStax at Rice University' : 'Checking free libraries…'}</p>
          <ul class="streams">${initial.list}</ul>
          ${borrow ? `<p class="note">Borrowing works like a public library: one reader at a time per copy, so popular books can have a waitlist. ${store.sources.lending === false ? 'Lending is turned off in <a href="#/sources">Sources</a>.' : ''}</p>` : ''}
          ${tb && store.sources.openstax === false ? '<p class="note">OpenStax is turned off in <a href="#/sources">Sources</a>.</p>' : ''}
        </div>
        <div class="activity ways" data-activity></div>
        ${!tb && b.subjects?.length ? `<div class="subjects">${b.subjects.map(s => `<a href="#/discover?subject=${encodeURIComponent(s)}&label=${encodeURIComponent(s)}&mode=all">${esc(s)}</a>`).join('')}</div>` : ''}
      </div>
    </div>
    ${moreLike(b)}
  </section>`;

  return {
    html,
    wire(root, actions) {
      wireRows(root);
      applyTone(root, b);
      store.remember(b);
      wireDrag($('.stage3d .bk', root));
      // how many people opened this book this month (each reader once)
      const rf = $('[data-readers] dd', root);
      const showReaders = () => bookReaders(b.id).then(r => {
        if (!rf.isConnected) return;
        rf.classList.toggle('dim', !r.month);
        rf.textContent = r.month ? `${r.month.toLocaleString('en')} ${r.month === 1 ? 'person' : 'people'}` : 'Be the first';
        rf.title = r.all_time ? `${r.all_time.toLocaleString('en')} ${r.all_time === 1 ? 'reader' : 'readers'} since Spine opened, each counted once a month` : '';
      }).catch(() => rf.parentElement?.remove());
      if (rf) {
        showReaders();
        const onRead = e => { if (!rf.isConnected) return removeEventListener('spine:read', onRead); if (e.detail === b.id) showReaders(); };
        addEventListener('spine:read', onRead);
      }
      $('[data-back]', root).onclick = () => (history.length > 1 ? history.back() : (location.hash = '#/'));
      const sb = $('[data-shelf]', root);
      sb.onclick = () => {
        const on = store.toggleShelf(b);
        sb.setAttribute('aria-pressed', on);
        sb.lastElementChild.textContent = on ? 'On your shelf' : 'Add to shelf';
        toast(on ? 'Added to your shelf' : 'Removed from your shelf');
      };
      store.track('view', b);
      fillActivity($('[data-activity]', root), b);
      if (tb) {
        $$('[data-way]', root).forEach(btn => btn.onclick = () => actions.textbook(b, btn));
        $('[data-primary]', root).onclick = e => actions.textbook(b, e.currentTarget);
        return;
      }

      const borrow = isBorrow(b), old = maybePublicDomain(b);
      const st = { gut: b.gut || (borrow && !old ? null : undefined), lv: old ? undefined : null };
      const refresh = () => {
        const w = ways(b, st);
        $('.streams', root).innerHTML = w.list;
        $('.ways-n', root).textContent = st.gut === undefined || st.lv === undefined ? 'Checking free libraries…' : w.n ? `Found in ${w.n} free ${w.n === 1 ? 'library' : 'libraries'}` : 'No free copy found yet';
        $$('[data-way]', root).forEach(btn => btn.onclick = () => actions[btn.dataset.way](b, btn));
      };
      refresh();
      Promise.allSettled([
        st.gut === undefined
          ? findText(b).then(g => { st.gut = g; if (g) loadText(g).catch(() => {}); if (g) epubFor(g).then(u => { st.epub = u; if (root.isConnected) refresh(); }).catch(() => {}); }).catch(() => { st.gut = null; })
          : Promise.resolve(st.gut && epubFor(st.gut).then(u => { st.epub = u; if (root.isConnected) refresh(); }).catch(() => {})),
        st.lv === undefined ? findAudio(b).then(a => { st.lv = a; if (a) b.audio = a.runtime; }).catch(() => { st.lv = null; }) : null,
      ]).then(() => {
        if (!root.isConnected) return;
        refresh();
        const fact = $('[data-audio-fact] dd', root);
        if (fact) { fact.textContent = st.lv ? (st.lv.runtime || 'Available') : 'None yet'; fact.classList.toggle('dim', !st.lv); }
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

      $('[data-primary]', root)?.addEventListener('click', async e => {
        const btn = e.currentTarget;
        if (borrow && !st.gut) return actions.borrow(b, btn);
        if (st.gut === undefined) { btn.disabled = true; try { st.gut = await findText(b); } catch { st.gut = null; } btn.disabled = false; }
        if (st.gut && store.sources.gutenberg !== false) actions.read(b, btn);
        else if (b.scan && store.sources.archive !== false) actions.scan(b, btn);
        else if (borrow && store.sources.lending !== false) actions.borrow(b, btn);
        else toast('No free copy of this book is available to read yet.');
      });
    },
  };
}

// drag the big book to turn it around and read the back
function wireDrag(bk) {
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
}

export async function loadBookPage(id) {
  const b = await getBook(id);
  return bookPage(b);
}
