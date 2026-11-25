// Private footfall report: how many times Spine was opened, by whom and from where.
//
//   npm run footfall            last 30 days
//   npm run footfall -- 7       last 7 days
//
// Reads DATABASE_URL (from server/.env or the environment; `vercel env pull .env` fetches it),
// else the local PGlite database in server/.data.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
const { loadConfig } = await import('../src/config.js');
const { openDb } = await import('../src/db.js');

const days = Math.max(1, Math.min(400, Number(process.argv[2]) || 30));
const config = loadConfig();
const db = openDb({ url: config.databaseUrl, dataDir: config.dataDir, log: { error: () => {} } });
await db.connect();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const n = (v) => Number(v || 0).toLocaleString('en-US');
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '–');

const since = (d) => new Date(Date.now() - d * 86400e3).toISOString();
async function window(d) {
  const [r] = await q(`SELECT count(*) AS opens, count(DISTINCT visitor) AS visitors,
      count(DISTINCT visitor) FILTER (WHERE first_visit) AS new_visitors,
      count(*) FILTER (WHERE user_id IS NOT NULL) AS signed_in
    FROM visits WHERE at >= $1`, [since(d)]);
  return r;
}

console.log(`\nSpine footfall · ${db.kind === 'postgres' ? 'production database' : 'local database'} · ${new Date().toUTCString()}\n`);
const rows = [];
for (const [label, d] of [['Last 24 hours', 1], ['Last 7 days', 7], [`Last ${days} days`, days]]) {
  const r = await window(d);
  rows.push({ Period: label, Opens: n(r.opens), Visitors: n(r.visitors), 'New visitors': n(r.new_visitors), 'Signed in': pct(Number(r.signed_in), Number(r.opens)) });
}
console.table(rows);

const daily = await q(`SELECT to_char(date_trunc('day', at), 'YYYY-MM-DD Dy') AS day, count(*) AS opens,
    count(DISTINCT visitor) AS visitors, count(DISTINCT visitor) FILTER (WHERE first_visit) AS new
  FROM visits WHERE at >= $1 GROUP BY 1 ORDER BY 1 DESC LIMIT 14`, [since(14)]);
console.log('By day (UTC)');
console.table(daily.map((r) => ({ Day: r.day, Opens: n(r.opens), Visitors: n(r.visitors), New: n(r.new) })));

const top = async (col, label) => {
  const r = await q(`SELECT coalesce(${col}, '(none)') AS k, count(*) AS opens, count(DISTINCT visitor) AS visitors
    FROM visits WHERE at >= $1 GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, [since(days)]);
  console.log(`${label} · last ${days} days`);
  console.table(r.map((x) => ({ [label]: x.k, Opens: n(x.opens), Visitors: n(x.visitors) })));
};
await top('referrer', 'Came from');
await top('source', 'Link source');
await top('country', 'Country');
await top('device', 'Device');
await top('landing', 'Opened on');

const [u] = await q(`SELECT count(*) AS total, count(*) FILTER (WHERE created_at >= $1) AS week,
    count(*) FILTER (WHERE created_at >= $2) AS month FROM users`, [since(7), since(30)]);
console.log('Accounts');
console.table([{ Total: n(u.total), 'New, 7 days': n(u.week), 'New, 30 days': n(u.month) }]);
await db.close();
