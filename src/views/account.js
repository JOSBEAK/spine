import { $, $$, esc } from '../lib/util.js';
import { store } from '../lib/store.js';
import { api, accountsEnabled } from '../lib/api.js';
import { signIn, signUp, signOut, syncNow, status as syncStatus, onSyncChange } from '../lib/sync.js';
import { fromServerBook } from '../lib/recs.js';
import { fmtDuration, fmtWhen } from '../ui/activity.js';
import { openLogin } from '../ui/panel.js';
import { I } from '../ui/icons.js';
import { toast } from '../ui/toast.js';

const EVENT_TEXT = { shelf_add: 'Added to your shelf', shelf_remove: 'Removed from your shelf', borrow_open: 'Opened to borrow', listen: 'Listened', finish: 'Finished', highlight: 'Highlighted a passage', link: 'Connected an account' };
const MODE_TEXT = { text: 'Read', scan: 'Read the printed pages of', borrow: 'Read a borrowed copy of', textbook: 'Studied', audio: 'Listened to' };

function authHTML() {
  return `<div class="auth-card">
    <div class="tabs" role="tablist"><button class="tab" role="tab" data-mode="in" aria-selected="true">Sign in</button><button class="tab" role="tab" data-mode="up" aria-selected="false">Create account</button></div>
    <form class="auth" novalidate>
      <label class="fld" data-only="up" hidden><span>Your name <i>(optional)</i></span><input id="a-name" name="name" autocomplete="name" maxlength="80"></label>
      <label class="fld"><span>Email</span><input id="a-email" name="email" type="email" autocomplete="email" required></label>
      <label class="fld"><span>Password</span><span class="pw"><input id="a-pass" name="password" type="password" autocomplete="current-password" minlength="8" required><button type="button" class="show" aria-label="Show password">Show</button></span><small data-only="up" hidden>At least 8 characters.</small></label>
      <p class="auth-err" role="alert" hidden></p>
      <button class="btn btn-ink" type="submit">Sign in</button>
    </form>
  </div>`;
}

const tasteHTML = t => (!t.subjects.length && !t.authors.length)
  ? '<p class="muted">Nothing yet. Open, read and shelve a few books and Spine will learn what you like.</p>'
  : (() => {
    const max = Math.max(...t.subjects.map(s => s.score), ...t.authors.map(a => a.score), 1);
    const bar = x => `<li><a href="#/discover?${x.author ? `q=${encodeURIComponent(`author:"${x.name}"`)}` : `subject=${encodeURIComponent(x.name)}&label=${encodeURIComponent(x.name)}`}"><span>${esc(x.name)}</span><i style="--w:${Math.max(6, Math.round(x.score / max * 100))}%"></i></a></li>`;
    return `<div class="taste"><div><h3>Subjects</h3><ul>${t.subjects.slice(0, 10).map(bar).join('')}</ul></div>${t.authors.length ? `<div><h3>Authors</h3><ul>${t.authors.slice(0, 6).map(a => bar({ ...a, author: true })).join('')}</ul></div>` : ''}</div>`;
  })();

function historyHTML(items) {
  if (!items.length) return '<p class="muted">Your reading history will show up here.</p>';
  return `<ol class="history">${items.slice(0, 40).map(it => {
    const b = it.book || store.book(it.book_id) || {};
    const what = it.kind === 'session' ? `${MODE_TEXT[it.mode] || 'Read'} <a href="#/book/${b.id || it.book_id}">${esc(b.title || 'a book')}</a> for ${fmtDuration(it.seconds)}` : `${EVENT_TEXT[it.type] || it.type} <a href="#/book/${b.id || it.book_id}">${esc(b.title || '')}</a>`;
    return `<li><span class="when">${fmtWhen(it.at)}</span><span>${what}</span></li>`;
  }).join('')}</ol>`;
}

const LINKS = [
  { key: 'archive', name: 'Internet Archive', l: 'A', c: '#30343c', d: 'Modern books you borrow open in the Archive\'s own window, next to Spine. Sign in there once and it remembers you. Spine never sees your password.' },
  { key: 'openlibrary', name: 'Open Library', l: 'O', c: '#3c6e9e', d: 'Bring in your public Open Library reading log: want to read, reading and read.' },
  { key: 'goodreads', name: 'Goodreads', l: 'g', c: '#5a4632', d: 'Upload your Goodreads export (My Books → Import and export → Export library) to bring your shelves over.' },
  { key: 'storygraph', name: 'The StoryGraph', l: 'S', c: '#1f6f78', d: 'Upload your StoryGraph export (Manage account → Export StoryGraph library).' },
];

function linksHTML(linked, signedIn) {
  return `<div class="links">${LINKS.map(L => {
    // the Archive sign-in lives in this browser's archive.org cookies, so only this browser can know it
    const on = L.key === 'archive' ? (store.prefs.archive ? { provider: 'archive' } : null) : linked.find(x => x.provider === L.key);
    const control = L.key === 'archive'
      ? `<button class="btn btn-line sm" data-archive>${on ? 'Open archive.org' : 'Sign in on archive.org'}</button>`
      : !signedIn ? '<span class="muted sm">Sign in to Spine to import</span>'
        : L.key === 'openlibrary'
          ? `<form class="inline" data-ol><input name="u" placeholder="Open Library username" aria-label="Open Library username" value="${esc(on?.username || '')}" required><button class="btn btn-line sm">Import</button></form>`
          : `<label class="btn btn-line sm file">Upload CSV<input type="file" accept=".csv,text/csv" data-csv="${L.key}" hidden></label>`;
    return `<div class="link-row"><div class="ic" style="background:${L.c}">${L.l}</div><div class="lt"><h3>${L.name} ${on ? `<em class="ok">${L.key === 'archive' ? 'Signed in on this browser' : 'Connected'}${on.username ? ` · ${esc(on.username)}` : ''}</em>` : ''}</h3><p>${L.d}</p></div><div class="lc">${control}${on && (signedIn || L.key === 'archive') ? `<button class="x" data-unlink="${L.key}" aria-label="${L.key === 'archive' ? 'Forget the Internet Archive on this browser' : `Disconnect ${L.name}`}">${I.x}</button>` : ''}</div></div>`;
  }).join('')}</div>`;
}

export function account() {
  const acc = store.account;
  const enabled = accountsEnabled();
  const user = acc?.user;
  const html = `
    <h1 class="page-title">${user ? esc(user.name || 'Your account') : 'Your account'}</h1>
    <p class="page-sub">${user ? `${esc(user.email)} · <span class="sync-state"></span>` : 'Spine works without an account. An account keeps your shelf, progress, highlights and history on every device, and learns what you like to read.'}</p>
    <div class="acct">
      ${!user ? (enabled ? authHTML() : '<div class="auth-card"><p class="muted">Accounts aren\'t switched on for this copy of Spine yet. Everything you do is saved in this browser.</p></div>') : ''}
      <section class="acct-sec"><h2>${I.spark} Your taste</h2><p class="muted">Built from what you open, read, shelve and highlight. Recent reading counts more.</p><div data-taste>${tasteHTML(store.interests(12))}</div></section>
      <section class="acct-sec"><h2>${I.clock} Reading history</h2><div data-history>${historyHTML(store.history())}</div></section>
      <section class="acct-sec"><h2>${I.link} Connected reading accounts</h2>${linksHTML(acc?.linked || [], !!user)}</section>
      <section class="acct-sec"><h2>Your data</h2>
        <div class="btns"><button class="btn btn-line" data-export>${I.down} Download my data</button>${user ? '<button class="btn btn-line" data-signout>Sign out</button><button class="btn btn-line danger" data-delete>Delete account</button>' : ''}</div>
        <p class="muted">${user ? 'Spine stores your account, shelf, progress, highlights, bookmarks, reading sittings and a taste profile. Passwords are hashed; we never store passwords for other services.' : 'Saved in this browser only. Clearing your browser data removes it.'}</p>
      </section>
    </div>`;

  return {
    html,
    wire(root, actions) {
      const rerender = () => actions.rerender();
      // ---- sign in / create account
      const form = $('form.auth', root);
      if (form) {
        let mode = 'in';
        $$('[data-mode]', root).forEach(t => t.onclick = () => {
          mode = t.dataset.mode;
          $$('[data-mode]', root).forEach(x => x.setAttribute('aria-selected', x === t));
          $$('[data-only="up"]', root).forEach(x => { x.hidden = mode !== 'up'; });
          $('button[type=submit]', form).textContent = mode === 'up' ? 'Create account' : 'Sign in';
          $('#a-pass', form).autocomplete = mode === 'up' ? 'new-password' : 'current-password';
        });
        $('.show', form).onclick = e => { const i = $('#a-pass', form); i.type = i.type === 'password' ? 'text' : 'password'; e.currentTarget.textContent = i.type === 'password' ? 'Show' : 'Hide'; };
        form.onsubmit = async e => {
          e.preventDefault();
          const err = $('.auth-err', form), btn = $('button[type=submit]', form);
          const email = $('#a-email', form).value.trim(), pass = $('#a-pass', form).value, name = $('#a-name', form).value.trim();
          if (!/^\S+@\S+\.\S+$/.test(email)) { err.hidden = false; err.textContent = 'Enter your email address, like name@example.com.'; return; }
          if (pass.length < 8) { err.hidden = false; err.textContent = 'Passwords need at least 8 characters.'; return; }
          btn.disabled = true; err.hidden = true;
          try {
            await (mode === 'up' ? signUp(email, pass, name) : signIn(email, pass));
            await loadLinks();
            toast(mode === 'up' ? 'Account created. Your reading now syncs.' : 'Signed in. Your reading now syncs.');
            rerender();
          } catch (x) { err.hidden = false; err.textContent = x.message; btn.disabled = false; }
        };
      }

      // ---- live sync status line
      const st = $('.sync-state', root);
      if (st) {
        const show = s => { st.textContent = s.syncing ? 'Syncing…' : s.error ? `Not synced: ${s.error}` : s.lastOk ? `Synced ${fmtWhen(new Date(s.lastOk).toISOString()) === 'today' ? 'just now' : fmtWhen(new Date(s.lastOk).toISOString())}` : 'Ready to sync'; };
        show(syncStatus());
        const off = onSyncChange(s => { if (!st.isConnected) off(); else show(s); });
        syncNow();
      }

      // ---- signed in: richer taste and history from the server
      if (store.account && accountsEnabled()) {
        api('/me/interests?limit=12').then(t => { if (root.isConnected && t) $('[data-taste]', root).innerHTML = tasteHTML({ subjects: t.subjects || [], authors: t.authors || [] }); }).catch(() => {});
        api('/me/history?limit=40').then(h => {
          if (!root.isConnected || !h?.items) return;
          const items = h.items.map(it => ({ ...it, book: it.book ? fromServerBook(it.book) : null, at: it.at || it.ended_at }));
          $('[data-history]', root).innerHTML = historyHTML(items);
        }).catch(() => {});
      }

      // ---- connected accounts
      $('[data-archive]', root)?.addEventListener('click', () => openLogin({
        onDone: async ok => {
          if (!ok) return;
          if (store.account) { try { await api('/me/links/archive', { method: 'POST', body: {} }); await loadLinks(); } catch { /* keep the local note */ } }
          toast('Done. Books you borrow will open in the Archive window, already signed in.');
          rerender();
        },
      }));
      $('[data-ol]', root)?.addEventListener('submit', async e => {
        e.preventDefault();
        const u = e.currentTarget.u.value.trim(), btn = $('button', e.currentTarget);
        btn.disabled = true; btn.textContent = 'Importing…';
        try {
          const r = await api('/me/links/openlibrary', { method: 'POST', body: { username: u }, timeout: 60000 });
          await syncNow(); await loadLinks();
          toast(`Imported ${r.imported.want + r.imported.reading + r.imported.finished} books from Open Library`);
          rerender();
        } catch (x) { toast(x.message); btn.disabled = false; btn.textContent = 'Import'; }
      });
      $$('[data-csv]', root).forEach(inp => inp.addEventListener('change', async () => {
        const f = inp.files[0]; if (!f) return;
        if (f.size > 2e6) { toast('That file is over 2 MB. Export only your shelves and try again.'); return; }
        const label = inp.closest('label'); const old = label.firstChild.textContent;
        label.firstChild.textContent = 'Matching books…';
        try {
          const r = await api(`/me/links/${inp.dataset.csv}`, { method: 'POST', body: { csv: await f.text() }, timeout: 120000 });
          await syncNow(); await loadLinks();
          toast(`Imported ${r.imported} books${r.unmatched?.length ? `; ${r.unmatched.length} couldn't be found as free books` : ''}`);
          rerender();
        } catch (x) { toast(x.message); label.firstChild.textContent = old; }
      }));
      $$('[data-unlink]', root).forEach(b => b.onclick = async () => {
        if (b.dataset.unlink === 'archive') {
          store.prefs.archive = false; store.savePrefs();
          if (store.account) api('/me/links/archive', { method: 'DELETE' }).catch(() => {});
          toast('Forgotten here. To sign out of the Archive itself, use archive.org.');
          return rerender();
        }
        try { await api(`/me/links/${b.dataset.unlink}`, { method: 'DELETE' }); await loadLinks(); rerender(); } catch (x) { toast(x.message); }
      });

      // ---- data
      $('[data-export]', root).onclick = async () => {
        let data;
        try { data = store.account ? await api('/me/export', { timeout: 60000 }) : store.exportLocal(); } catch (x) { toast(x.message); return; }
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        const a = Object.assign(document.createElement('a'), { href: url, download: `spine-${new Date().toISOString().slice(0, 10)}.json` });
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      };
      $('[data-signout]', root)?.addEventListener('click', async () => { await signOut(); toast('Signed out. Your books stay on this device.'); rerender(); });
      $('[data-delete]', root)?.addEventListener('click', e => {
        const sec = e.currentTarget.closest('.acct-sec');
        if ($('.confirm', sec)) return;
        sec.insertAdjacentHTML('beforeend', `<form class="confirm"><p><b>Delete your account and everything stored with it?</b> This can't be undone. Books saved in this browser stay here.</p><label class="fld"><span>Type your password to confirm</span><input type="password" name="p" autocomplete="current-password" required></label><div class="btns"><button type="button" class="btn btn-line" data-cancel>Keep my account</button><button class="btn btn-ink danger">Delete account</button></div></form>`);
        const f = $('.confirm', sec);
        $('[data-cancel]', f).onclick = () => f.remove();
        f.onsubmit = async ev => {
          ev.preventDefault();
          try { await api('/me', { method: 'DELETE', body: { password: f.p.value } }); store.setAccount(null); toast('Your account was deleted.'); rerender(); }
          catch (x) { toast(x.message); }
        };
      });
    },
  };
}

export async function loadLinks() {
  if (!store.account || !accountsEnabled()) return;
  try {
    const r = await api('/me/links');
    store.setAccount({ ...store.account, linked: r.links || [] });
  } catch { /* not critical */ }
}
