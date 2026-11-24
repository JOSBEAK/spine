// One tiny database interface over two drivers:
//   - `postgres` (postgres.js) when DATABASE_URL is set (Neon, Supabase, RDS, ...)
//   - embedded PGlite otherwise: persisted to a folder for local dev, in memory for tests.
//
//   db.query(sql, params) -> { rows, count }
//   db.tx(async (q) => { await q.query(...) })   q has the same query() method
//   db.kind -> 'postgres' | 'pglite'
//
// Both are real Postgres, so the app writes one set of SQL. Values are normalised the same way:
// int8 (bigint, count(*)) comes back as a JS number, timestamptz as Date, jsonb as objects,
// arrays as JS arrays. Connecting and migrating happen lazily on the first query.

import { mkdirSync } from 'node:fs';
import { migrate } from './schema.js';

const INT8 = 20;

export function openDb({ url, dataDir, memory = false, log = console } = {}) {
  const kind = url ? 'postgres' : 'pglite';
  let ready = null;
  let driver = null;

  async function init() {
    driver = kind === 'postgres' ? await postgresDriver(url) : await pgliteDriver({ dataDir, memory });
    await migrate(driver);
    return driver;
  }

  function connect() {
    if (!ready) {
      ready = init().catch((err) => {
        ready = null; // let the next request retry instead of caching the failure forever
        log.error?.('Database failed to start:', err.message);
        throw err;
      });
    }
    return ready;
  }

  return {
    kind,
    connect,
    async query(sql, params = []) {
      const d = await connect();
      return d.query(sql, params);
    },
    async exec(sql) {
      const d = await connect();
      return d.exec(sql);
    },
    async tx(fn) {
      const d = await connect();
      return d.tx(fn);
    },
    async close() {
      if (!ready) return;
      const d = await ready.catch(() => null);
      ready = null;
      await d?.close();
    },
  };
}

async function pgliteDriver({ dataDir, memory }) {
  const { PGlite } = await import('@electric-sql/pglite');
  const { citext } = await import('@electric-sql/pglite/contrib/citext');
  if (!memory && dataDir) mkdirSync(dataDir, { recursive: true });
  const pg = new PGlite({
    ...(memory || !dataDir ? {} : { dataDir }),
    extensions: { citext },
    parsers: { [INT8]: (v) => Number(v) },
  });
  await pg.waitReady;
  const wrap = (h) => ({
    async query(sql, params = []) {
      const r = await h.query(sql, params);
      return { rows: r.rows, count: r.affectedRows ?? r.rows.length };
    },
    async exec(sql) {
      await h.exec(sql);
    },
  });
  return {
    ...wrap(pg),
    tx: (fn) => pg.transaction((t) => fn(wrap(t))),
    close: () => pg.close(),
  };
}

async function postgresDriver(url) {
  const { default: postgres } = await import('postgres');
  const sql = postgres(url, {
    max: Number(process.env.DATABASE_POOL_SIZE || 5),
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false, // works behind transaction-mode poolers (PgBouncer, Neon's pooled URL)
    onnotice: () => {},
    transform: { undefined: null },
    types: {
      int8: { to: INT8, from: [INT8], serialize: (v) => String(v), parse: (v) => Number(v) },
    },
  });
  const wrap = (h) => ({
    async query(text, params = []) {
      const r = await h.unsafe(text, params);
      return { rows: Array.from(r), count: r.count ?? r.length };
    },
    async exec(text) {
      await h.unsafe(text); // simple protocol: several statements allowed
    },
  });
  return {
    ...wrap(sql),
    tx: (fn) => sql.begin((t) => fn(wrap(t))),
    close: () => sql.end({ timeout: 5 }),
  };
}

/**
 * Serialise a value for a JSON parameter. Always write it in SQL as `$n::text::jsonb`: postgres.js would
 * JSON-encode a string a second time if the parameter were typed jsonb, while text passes through on both
 * drivers. Bulk writes use `jsonb_to_recordset($n::text::jsonb)` so a whole array is one statement.
 */
export const asJson = (v) => JSON.stringify(v ?? null);

/**
 * Serialise all rev-bumping writes for one user. Without this, two devices syncing at once could commit
 * revs out of order and a third device could skip a row. Call it first thing inside db.tx().
 */
export async function lockUser(q, userId) {
  await q.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [userId]);
}
