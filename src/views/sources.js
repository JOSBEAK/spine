import { $$ } from '../lib/util.js';
import { store } from '../lib/store.js';
import { toast } from '../ui/toast.js';

const SOURCES = [
  { key: null, n: 'Open Library', l: 'O', c: '#3c6e9e', d: 'The catalogue: titles, authors, covers and subjects for about 1.8 million free books. Spine needs it to find anything, so it stays on.', tags: ['Catalogue', 'Covers'], url: 'https://openlibrary.org' },
  { key: 'gutenberg', n: 'Project Gutenberg', l: 'G', c: '#7a2a2a', d: 'Proofread text for more than 70,000 public-domain books, typed up by volunteers. This is what the Spine reader shows.', tags: ['Read in Spine', 'EPUB downloads'], url: 'https://www.gutenberg.org' },
  { key: 'archive', n: 'Internet Archive', l: 'A', c: '#30343c', d: 'Scans of the original printed editions, page by page, with their old typefaces and illustrations.', tags: ['Original pages'], url: 'https://archive.org' },
  { key: 'lending', n: 'Open Library lending', l: 'B', c: '#8a5a2b', d: 'A free lending library of about 2.9 million modern books, run by the Internet Archive. You borrow with a free archive.org account, one reader per copy, like a public library.', tags: ['Borrow free', 'Modern books'], url: 'https://openlibrary.org/borrow' },
  { key: 'openstax', n: 'OpenStax', l: 'X', c: '#24508a', d: 'Complete, peer-reviewed university textbooks from Rice University, free to read online or download.', tags: ['Textbooks', 'PDF'], url: 'https://openstax.org' },
  { key: 'librivox', n: 'LibriVox', l: 'L', c: '#0d6a4e', d: 'Free audiobooks of public-domain books, read by volunteers around the world.', tags: ['Audiobooks'], url: 'https://librivox.org' },
];

export function sources() {
  const on = s => (s.key ? store.sources[s.key] !== false : true);
  const html = `<h1 class="page-title">Sources</h1>
    <p class="page-sub">Spine doesn't host books. It finds them in these free libraries and lists every way to read each one. Turn a library off and Spine stops offering it.</p>
    <div class="sources">${SOURCES.map((s, i) => `<div class="source rise" style="--i:${i}">
      <div class="ic" style="background:${s.c}" aria-hidden="true">${s.l}</div>
      <div><h3><a href="${s.url}" target="_blank" rel="noopener">${s.n}</a></h3><p>${s.d}</p><div class="tags">${s.tags.map(t => `<span>${t}</span>`).join('')}</div></div>
      <button class="switch" role="switch" aria-checked="${on(s)}" aria-label="Use ${s.n}" ${s.key ? `data-src="${s.key}"` : 'disabled title="Always on"'}></button></div>`).join('')}</div>`;
  return {
    html,
    wire(root) {
      $$('[data-src]', root).forEach(btn => btn.onclick = () => {
        const s = SOURCES.find(x => x.key === btn.dataset.src);
        const next = store.sources[s.key] === false;
        store.setSource(s.key, next);
        btn.setAttribute('aria-checked', next);
        toast(next ? `${s.n} is on` : `${s.n} is off`);
      });
    },
  };
}
