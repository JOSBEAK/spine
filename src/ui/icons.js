const s = (d, w = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const I = {
  arrowR: s('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  arrowL: s('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
  chevR: s('<path d="m9 6 6 6-6 6"/>'),
  chevL: s('<path d="m15 6-6 6 6 6"/>'),
  ext: s('<path d="M14 5h5v5M19 5l-8 8M17 14v5H5V7h5"/>'),
  book: s('<path d="M12 6.5C10.5 5 8 4.5 4 4.5v13c4 0 6.5.5 8 2 1.5-1.5 4-2 8-2v-13c-4 0-6.5.5-8 2z"/><path d="M12 6.5v13"/>', 1.7),
  scan: s('<rect x="5" y="3.5" width="14" height="17" rx="1.5"/><path d="M8.5 8h7M8.5 11h7M8.5 14h4"/>', 1.7),
  ear: s('<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3.5" y="13.5" width="4" height="6.5" rx="1.5"/><rect x="16.5" y="13.5" width="4" height="6.5" rx="1.5"/>', 1.7),
  down: s('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', 1.7),
  hand: s('<path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4"/>', 1.7),
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1"/><rect x="13.5" y="5" width="4" height="14" rx="1"/></svg>',
  prev: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 6h2v12H7zM19 6v12l-9-6z"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M15 6h2v12h-2zM5 6v12l9-6z"/></svg>',
  list: s('<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>'),
  x: s('<path d="M6 6l12 12M18 6 6 18"/>'),
  aa: s('<path d="M3 18 8 6l5 12M4.8 14h6.4M14.5 18l3.2-8 3.3 8M15.5 15.6h4.4"/>', 1.8),
  hp: s('<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><path d="M4 15h3v5H4zM17 15h3v5h-3z"/>', 2.2),
};
