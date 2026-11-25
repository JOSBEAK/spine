// "Most read on Spine": the ten books the most people opened, this month or of all time.
// Each reader counts once per book per month (see lib/reads.js and server/src/reads.js).
import { $, $$, esc } from '../lib/util.js';
import { topBooks, monthName } from '../lib/reads.js';
import { bookHTML } from './book.js';

const MIN = 3; // fewer than this and a ranking means nothing yet

const people = n => `${n.toLocaleString('en')} ${n === 1 ? 'reader' : 'readers'}`;

function listHTML(items) {
  return items.map(({ book, readers }, i) => `<li class="t10-item rise" style="--i:${i}">
      <span class="t10-n" aria-hidden="true">${i + 1}</span>
      ${bookHTML(book, { cap: false, ribbon: false })}
      <p class="t10-cap"><b>${esc(book.title)}</b><span>${people(readers)}</span></p>
    </li>`).join('');
}

const sub = period => (period === 'month' ? `${monthName()} so far · each reader counted once` : 'Since Spine opened · each reader counted once a month');

/** Fills `slot` with the ranking, or leaves it empty while there isn't one worth showing. */
export async function fillTop10(slot) {
  let month = [], all = [];
  try { [month, all] = await Promise.all([topBooks('month'), topBooks('all')]); } catch { return; }
  if (!slot.isConnected) return;
  const lists = { month, all };
  let period = month.length >= MIN ? 'month' : all.length >= MIN ? 'all' : null;
  if (!period) return;
  const both = month.length >= MIN && all.length >= MIN;
  slot.innerHTML = `<section class="row top10" aria-labelledby="t10-h">
      <div class="row-head">
        <h2 id="t10-h">Most read on Spine</h2><p class="t10-sub">${sub(period)}</p>
        ${both ? `<div class="t10-tabs" role="tablist" aria-label="Period">
          <button role="tab" data-period="month" aria-selected="${period === 'month'}">This month</button>
          <button role="tab" data-period="all" aria-selected="${period === 'all'}">All time</button>
        </div>` : ''}
      </div>
      <ol class="t10">${listHTML(lists[period])}</ol>
    </section>`;
  $$('[data-period]', slot).forEach(btn => btn.addEventListener('click', () => {
    period = btn.dataset.period;
    $$('[data-period]', slot).forEach(b => b.setAttribute('aria-selected', b === btn));
    $('.t10-sub', slot).textContent = sub(period);
    $('.t10', slot).innerHTML = listHTML(lists[period]);
    $('.t10', slot).scrollLeft = 0;
  }));
}
