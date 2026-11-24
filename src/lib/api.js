// Talks to the Spine server (server/). Set VITE_API_URL at build time to switch accounts on.
// For testing a different server from the browser: localStorage.setItem('spine.api', 'http://localhost:8787')
import { store } from './store.js';

const BUILT = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
export function apiBase() {
  try { return (localStorage.getItem('spine.api') || BUILT).replace(/\/$/, ''); } catch { return BUILT; }
}
export const accountsEnabled = () => !!apiBase();

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export async function api(path, { method = 'GET', body, timeout = 20000, auth = true } = {}) {
  const base = apiBase();
  if (!base) throw new ApiError('Accounts aren\'t switched on for this copy of Spine.', 0);
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = store.account?.token;
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  let r;
  try {
    r = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: ctl.signal });
  } catch {
    throw new ApiError('Spine\'s server didn\'t answer. Check your connection and try again.', 0);
  } finally { clearTimeout(t); }
  if (r.status === 204) return null;
  let data = null;
  try { data = await r.json(); } catch { /* empty or non-JSON body */ }
  if (!r.ok) throw new ApiError(data?.error || `Something went wrong on the server (${r.status}).`, r.status);
  return data;
}
