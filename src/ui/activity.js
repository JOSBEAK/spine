// "Your reading" on a book page: what this reader has done with this one book.
import { esc } from '../lib/util.js';
import { store } from '../lib/store.js';
import { api, accountsEnabled } from '../lib/api.js';
import { I } from './icons.js';

export const fmtDuration = s => {
  if (!s || s < 60) return s ? 'under a minute' : 'none yet';
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
};
export const fmtWhen = iso => {
  if (!iso) return '—';
  const d = new Date(iso), days = Math.floor((Date.now() - d) / 864e5);
  if (days < 1) return 'today';
  if (days < 2) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
};

function localActivity(id) {
  const m = store.meta(id), sess = store.sessionsFor(id);
  return {
    seconds: m.seconds || 0, sessions: m.sessions || 0,
    first: m.first_opened_at || sess[0]?.started_at || null, last: m.last_opened_at || sess.at(-1)?.ended_at || null,
    finished: m.finished_at || null, highlights: store.highlightsFor(id).length, bookmarks: store.bookmarksFor(id).length,
    pct: store.progress(id)?.pct ?? null,
  };
}

function html(a) {
  if (!a.sessions && !a.highlights && !a.bookmarks && a.pct == null) return '';
  const cell = (k, v) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`;
  return `<h2>${I.clock} Your reading</h2>
    <dl class="facts">
      ${cell('Progress', a.finished ? 'Finished' : a.pct != null ? `${Math.round(a.pct * 100)}%` : 'Not started')}
      ${cell('Time read', fmtDuration(a.seconds))}
      ${cell('Sittings', String(a.sessions || 0))}
      ${cell('Last read', fmtWhen(a.last))}
      ${cell('Highlights', String(a.highlights))}
      ${cell('Bookmarks', String(a.bookmarks))}
    </dl>`;
}

export function fillActivity(box, b) {
  if (!box) return;
  const a = localActivity(b.id);
  box.innerHTML = html(a);
  if (!store.account || !accountsEnabled()) return;
  // signed in: the server also knows about reading on other devices
  api(`/me/books/${encodeURIComponent(b.id)}/activity`).then(r => {
    if (!box.isConnected || !r) return;
    const s = r.sessions || {};
    box.innerHTML = html({
      ...a,
      seconds: Math.max(a.seconds, s.seconds || 0), sessions: Math.max(a.sessions, s.count || 0),
      last: [a.last, s.last_at, r.library?.last_opened_at].filter(Boolean).sort().at(-1) || null,
      highlights: Math.max(a.highlights, r.highlights || 0), bookmarks: Math.max(a.bookmarks, r.bookmarks || 0),
      pct: r.library?.progress ?? a.pct, finished: a.finished || r.library?.finished_at,
    });
  }).catch(() => {});
}
