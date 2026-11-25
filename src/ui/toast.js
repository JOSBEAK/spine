import { fadeOut } from '../lib/util.js';

/** A short message at the bottom. With `action`, it shows a button (like Undo) and stays a little longer. */
export function toast(msg, { action, onAction } = {}) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = msg;
  t.appendChild(text);
  if (action) {
    const b = document.createElement('button');
    b.textContent = action;
    b.onclick = () => { onAction?.(); fadeOut(t, 200); };
    t.appendChild(b);
  }
  document.body.appendChild(t);
  setTimeout(() => { if (t.isConnected) fadeOut(t, 300); }, action ? 5200 : 2400);
}
