// A small RFC 4180 CSV parser (quoted fields, "" escapes, commas and newlines inside quotes, CRLF, BOM)
// plus readers for the Goodreads and StoryGraph library exports.

export function parseCsv(text) {
  const s = String(text ?? '').replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      if (ch === '\r' && s[i + 1] === '\n') i++;
    } else {
      field += ch;
    }
    i++;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

/** Rows as objects keyed by the (trimmed) header line. */
export function parseCsvObjects(text) {
  const [header, ...rows] = parseCsv(text);
  if (!header) return { columns: [], rows: [] };
  const columns = header.map((h) => h.trim());
  return {
    columns,
    rows: rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, (r[i] ?? '').trim()]))),
  };
}

const STATUS = {
  read: 'finished',
  'currently-reading': 'reading',
  'to-read': 'want',
};

const FORMATS = {
  goodreads: { label: 'Goodreads', author: 'Author', status: 'Exclusive Shelf', date: 'Date Read' },
  storygraph: { label: 'StoryGraph', author: 'Authors', status: 'Read Status', date: 'Last Date Read' },
};

/** Goodreads appends the series to titles: "The Fellowship of the Ring (The Lord of the Rings, #1)". */
export const cleanTitle = (t) => t.replace(/\s*\([^()]*#\s*\d+(\.\d+)?\)\s*$/, '').trim();

function parseDate(s) {
  if (!s) return null;
  const t = Date.parse(s.replace(/\//g, '-'));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/**
 * Reads a Goodreads or StoryGraph export into [{ title, author, status, finished_at }].
 * Shelves other than read / currently-reading / to-read (custom shelves, did-not-finish) count as 'want'.
 * Throws a plain-English Error if the file doesn't look like that export.
 */
export function readExport(text, provider) {
  const f = FORMATS[provider];
  const { columns, rows } = parseCsvObjects(text);
  if (!columns.includes('Title')) {
    throw new Error(
      `This doesn't look like a ${f.label} export: the first line should include a "Title" column. ` +
        (provider === 'goodreads'
          ? 'On Goodreads, go to My Books → Import and export → Export library.'
          : 'On StoryGraph, go to Manage account → Export StoryGraph library.'),
    );
  }
  const authorCol = columns.includes(f.author) ? f.author : columns.find((c) => c === 'Author' || c === 'Authors');
  return rows
    .map((r) => {
      const status = STATUS[(r[f.status] || '').toLowerCase()] || 'want';
      const author = (r[authorCol] || '').split(',')[0].trim();
      return {
        title: r.Title,
        author,
        status,
        finished_at: status === 'finished' ? parseDate(r[f.date]) : null,
      };
    })
    .filter((r) => r.title);
}
