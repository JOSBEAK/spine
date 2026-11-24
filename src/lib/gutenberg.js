// Turns a Project Gutenberg plain-text file into chapters of clean HTML paragraphs.
// Gutenberg files are hand-made and vary a lot, so this is a set of careful heuristics.

import { titleCase } from './util.js';

const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const LABEL = /^(chapter|book|part|volume|vol\.|letter|stave|act|canto|section|adventure|epilogue|prologue|preface|introduction|conclusion|postscript|appendix|scene|fit|chap\.)\b/i;
const NUMBER_ONLY = /^(?:[IVXLCDM]+|\d{1,3})\.?$/;
const NUMBER_TITLE = /^(?:[IVXLCDM]+|\d{1,3})\.\s+\S.{0,70}$/;
const SCENE_BREAK = /^[\s*.·•_~-]{3,}$/;

function isHeading(block) {
  const lines = block.split('\n');
  if (lines.length > 3) return false;
  const s = block.replace(/\s+/g, ' ').trim();
  if (s.length > 90 || s.length < 1) return false;
  if (LABEL.test(s) && !/[a-z]\s*[,;]\s*[a-z]/.test(s.slice(0, 40))) {
    // "Chapter" followed by a number, a numeral word or a title, not a sentence that starts with "Book".
    return /^\S+\.?\s+([IVXLCDM]+\b|\d+|the |one|two|three|four|five|six|seven|eight|nine|ten|first|second|third|last|[A-Z])/i.test(s) || s.split(' ').length <= 2;
  }
  if (NUMBER_ONLY.test(s)) return true;
  if (NUMBER_TITLE.test(s) && s === s.toUpperCase()) return true;
  return false;
}

function isSubtitle(block) {
  const s = block.replace(/\s+/g, ' ').trim();
  if (block.includes('\n') && block.split('\n').length > 2) return false;
  if (s.length > 70 || s.split(' ').length > 10) return false;
  if (/[,;:]$/.test(s) || /^["'“‘(]/.test(s)) return false;
  return /^[A-Z0-9]/.test(s);
}

function unwrap(block) {
  const lines = block.split('\n').map(l => l.replace(/\s+$/, ''));
  if (SCENE_BREAK.test(block.trim())) return { cls: 'gap', html: '* * *' };
  const lens = lines.map(l => l.trim().length);
  const verse = lines.length >= 2 && Math.max(...lens) < 62 && lens.reduce((a, b) => a + b, 0) / lines.length < 48 && lines.some(l => /^\s{2,}/.test(l) || l.trim().length < 40);
  const fmt = t => esc(smart(t))
    .replace(/_([^_\n]{1,200})_/g, '<em>$1</em>')
    .replace(/\s*--\s*/g, '—')
    .replace(/ {2,}/g, ' ');
  if (verse) return { cls: 'verse', html: lines.map(l => fmt(l.trim())).join('<br>') };
  return { cls: '', html: fmt(lines.map(l => l.trim()).join(' ')) };
}

function smart(t) {
  return t
    .replace(/`/g, '\u2018')
    .replace(/(^|[\s(\[\u2014-])"/g, '$1\u201C').replace(/"/g, '\u201D')
    .replace(/(^|[\s(\[\u2014-])'/g, '$1\u2018').replace(/'/g, '\u2019');
}

const LICENSE = /under construction|email me|this (work|file) is|project gutenberg|gutenberg\.(org|net)|\betext\b|e-?book is for the use|copyright laws|small print|public domain in the u/i;

function isContents(c) {
  if (/^(contents|chapter title|table of contents|list of)/i.test(c.label)) return true;
  if (c.words > 800) return false;
  const lines = c.paras.flatMap(p => p.html.split('<br>'));
  if (lines.length < 6) return false;
  const listy = lines.filter(l => /^\s*((chapter|chap\.|book|part)\s+)?([IVXLCDM]+|\d{1,3})\b/i.test(l) || /\s\d{1,4}\s*$/.test(l)).length;
  return listy / lines.length > 0.6;
}

const words = s => (s.match(/\S+/g) || []).length;

function splitHeading(text) {
  const s = text.replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  const m = s.match(/^((?:chapter|book|part|volume|vol\.|letter|stave|act|canto|section|adventure|chap\.)\s+[\w]+)[.:—–-]?\s+(.+)$/i)
    || s.match(/^([IVXLCDM]+|\d{1,3})\.\s+(.+)$/);
  if (m) return { label: m[1], sub: m[2] };
  return { label: s, sub: '' };
}

export function parseGutenberg(raw) {
  let t = raw.replace(/\r\n?/g, '\n').replace(/﻿/g, '');
  const start = t.search(/\*{3}\s*START OF (THE|THIS) PROJECT GUTENBERG[^\n]*/i);
  if (start >= 0) t = t.slice(t.indexOf('\n', start) + 1);
  else {
    const sp = t.search(/\*\s*END\*?\s*THE SMALL PRINT[^\n]*/i);
    if (sp >= 0) t = t.slice(t.indexOf('\n', sp) + 1);
  }
  const end = t.search(/\*{3}\s*END OF (THE|THIS) PROJECT GUTENBERG|\n\s*End of (the )?Project Gutenberg|\n\s*End of this Project Gutenberg/i);
  if (end >= 0) t = t.slice(0, end);

  const blocks = t.split(/\n[ \t]*\n/).map(b => b.replace(/^\n+|\s+$/g, '')).filter(b => b.trim());

  const chapters = [];
  let cur = { label: '', sub: '', paras: [], words: 0 };
  const push = () => { if (cur.paras.length || cur.label) chapters.push(cur); };

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (/^\s*\[(illustration|transcriber|footnote|sidenote)/i.test(b)) continue;
    if (/^produced by|^e-?text prepared by|^transcribed from/i.test(b.trim())) continue;
    if (chapters.length === 0 && !cur.label && LICENSE.test(b)) continue;
    if (isHeading(b)) {
      push();
      const h = splitHeading(b);
      cur = { label: h.label, sub: h.sub, paras: [], words: 0 };
      const next = blocks[i + 1];
      if (!h.sub && next && isSubtitle(next) && !isHeading(next) && blocks[i + 2]) {
        cur.sub = next.replace(/\s+/g, ' ').trim().replace(/\.$/, '');
        i++;
      }
      continue;
    }
    const p = unwrap(b);
    cur.paras.push(p);
    cur.words += words(p.html);
  }
  push();

  // Drop the empty entries a printed table of contents leaves behind, and very short front matter.
  let list = chapters.filter((c, i) => (c.words >= 60 || (i === chapters.length - 1 && c.words > 0)) && !isContents(c));
  if (list.length && !list[0].label) {
    if (list[0].words < 150) list = list.slice(1);
    else list[0].label = 'Opening';
  }

  // No headings found: cut into readable parts.
  if (list.length < 2) {
    const all = list.flatMap(c => c.paras);
    list = [];
    let part = null;
    for (const p of all) {
      if (!part || part.words > 4500) { part = { label: `Part ${list.length + 1}`, sub: '', paras: [], words: 0 }; list.push(part); }
      part.paras.push(p); part.words += words(p.html);
    }
  }

  // Very long chapters slow down page layout; split them into sittings.
  const out = [];
  for (const c of list) {
    if (c.words <= 14000) { out.push(c); continue; }
    let piece = null, n = 0;
    for (const p of c.paras) {
      if (!piece || piece.words > 9000) { n++; piece = { label: c.label, sub: n > 1 ? `${c.sub ? c.sub + ' · ' : ''}continued` : c.sub, paras: [], words: 0 }; out.push(piece); }
      piece.paras.push(p); piece.words += words(p.html);
    }
  }

  const total = out.reduce((a, c) => a + c.words, 0) || 1;
  let acc = 0;
  out.forEach(c => { c.start = acc / total; acc += c.words; c.share = c.words / total; });
  return { chapters: out, words: total };
}

export function chapterHTML(c, { first = true } = {}) {
  const label = c.label && c.label !== 'Opening' ? c.label : '';
  const head = c.sub
    ? `<div class="ch"><small>${esc(label.toUpperCase())}</small><b>${esc(titleCase(c.sub))}</b></div>`
    : `<div class="ch"><b>${esc(titleCase(label || 'Opening'))}</b></div>`;
  let firstDone = !first;
  // data-p is the paragraph's index in the chapter: highlights and jumps are anchored to it
  return head + c.paras.map((p, i) => {
    if (p.cls) return `<p class="${p.cls}" data-p="${i}">${p.html}</p>`;
    if (!firstDone && p.html.length > 120) { firstDone = true; return `<p class="first" data-p="${i}">${p.html}</p>`; }
    return `<p data-p="${i}">${p.html}</p>`;
  }).join('');
}
