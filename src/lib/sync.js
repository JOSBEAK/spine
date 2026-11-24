// Keeps this browser and the Spine server in step. Local changes are queued in store.js
// (dirty rows, an outbox of sessions and events) and pushed in batches; the server answers with
// everything that changed elsewhere since our last sync, which store.applyRemote merges.
import { store } from './store.js';
import { api, accountsEnabled, ApiError } from './api.js';
import { debounce } from './util.js';

const LIMIT = 500;
let inflight = null;
let timer = null;
let lastOk = 0;
let lastError = null;
const listeners = new Set();
const emit = () => listeners.forEach(fn => fn(status()));

export const onSyncChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
export const status = () => ({ signedIn: !!store.account, syncing: !!inflight, lastOk, error: lastError, pending: store.hasDirty() });

export async function syncNow() {
  if (!store.account || !accountsEnabled()) return;
  if (inflight) return inflight;
  inflight = (async () => {
    emit();
    try {
      // push in slices of at most 500 per kind, then one final pull
      let rounds = 0;
      do {
        const all = store.dirtyRows();
        const batch = Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.slice(0, LIMIT)]));
        const res = await api('/sync', { method: 'POST', body: { since: store.account.rev || 0, ...batch, prefs: store.prefs } });
        store.clearSent(batch);
        store.applyRemote(res);
        store.setAccount({ ...store.account, rev: res.rev ?? store.account.rev });
        rounds++;
      } while (store.hasDirty() && rounds < 10);
      lastOk = Date.now();
      lastError = null;
    } catch (e) {
      lastError = e.message;
      if (e instanceof ApiError && e.status === 401) {
        // the session expired or was signed out elsewhere: keep the books, drop the token
        store.setAccount(null);
      }
    } finally {
      inflight = null;
      emit();
    }
  })();
  return inflight;
}

const soon = debounce(syncNow, 3000);

export function startSync() {
  if (timer) return;
  timer = setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 20000);
  store.on(what => { if (what === 'dirty' || what === 'session') soon(); if (what === 'account') emit(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); else if (store.hasDirty()) syncNow(); });
  syncNow();
}

async function enter(path, body) {
  const res = await api(path, { method: 'POST', body, auth: false });
  store.setAccount({ token: res.token, user: res.user, rev: 0 });
  // first sync from this device: send everything it already has
  store.markAllDirty();
  await syncNow();
  return res.user;
}
export const signIn = (email, password) => enter('/auth/login', { email, password });
export const signUp = (email, password, name) => enter('/auth/signup', { email, password, name: name || undefined });

export async function signOut() {
  try { await syncNow(); await api('/auth/logout', { method: 'POST' }); } catch { /* signing out locally is what matters */ }
  store.setAccount(null);
  emit();
}
