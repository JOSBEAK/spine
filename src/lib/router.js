// Real paths (/book/OL66554W, /discover?q=…) instead of #/ routes, so every book has its own URL
// that search engines can index. Internal links are plain <a href="/…">; clicks on them are caught
// here and turned into history.pushState, so the app never reloads.

const BASE = import.meta.env.BASE_URL.replace(/\/$/, ''); // '' on spinebrew.com

/** The current route, without the base: "/book/OL66554W", "/discover", "/". */
export const here = () => {
  const p = location.pathname;
  return (BASE && p.startsWith(BASE) ? p.slice(BASE.length) : p).replace(/(\/index)?\.html$/, '').replace(/(.)\/$/, '$1') || '/';
};

/** Go to an app path ("/book/OL1W", "/discover?q=x"). Listeners of 'spine:route' re-render. */
export function go(path, { replace = false } = {}) {
  const url = BASE + path;
  if (url !== location.pathname + location.search) history[replace ? 'replaceState' : 'pushState'](null, '', url);
  dispatchEvent(new Event('spine:route'));
}

/** Old links (spinebrew.com/#/book/OL1W) still work: they become the real path before the first render. */
export function upgradeHashLink() {
  if (!location.hash.startsWith('#/')) return;
  history.replaceState(null, '', BASE + (location.hash.slice(1) || '/'));
}

/** Catch clicks on internal links. Runs after the app's own handlers, which may have taken the click. */
export function installLinks() {
  document.addEventListener('click', e => {
    if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest('a[href]');
    if (!a || a.target || a.hasAttribute('download')) return;
    const h = a.getAttribute('href');
    if (!h.startsWith('/') || h.startsWith('//')) return;
    e.preventDefault();
    go(h);
  });
  addEventListener('popstate', () => dispatchEvent(new Event('spine:route')));
}
