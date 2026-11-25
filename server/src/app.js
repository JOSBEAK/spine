// The Hono app. No listen() here: src/server.js serves it locally, api/index.js on Vercel.
//
//   import app from './app.js'          -> app configured from environment variables
//   createApp({ db, fetch, now, config }) -> app with injected dependencies (tests)

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { HttpError } from './http.js';
import { createOpenLibrary } from './openlibrary.js';
import { authRoutes } from './auth.js';
import { meRoutes } from './me.js';
import { syncRoutes } from './sync.js';
import { linkRoutes } from './links.js';
import { readRoutes } from './reads.js';
import { textRoutes } from './texts.js';
import { visitRoutes } from './visits.js';

const BODY_LIMIT = 2.5 * 1024 * 1024; // CSV exports up to ~2 MB, plus JSON escaping

export function createApp({ db, fetch = globalThis.fetch, now = () => new Date(), config = loadConfig(), log = console } = {}) {
  if (!db) throw new Error('createApp needs a db (see openDb in src/db.js).');
  const ctx = { db, now, config, log, ol: createOpenLibrary({ fetch, db, now, userAgent: config.userAgent }) };
  const app = new Hono();
  const anyOrigin = config.allowedOrigins.includes('*');

  app.use(
    '*',
    cors({
      origin: (origin) => (anyOrigin || config.allowedOrigins.includes(origin) ? origin : null),
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      exposeHeaders: ['Retry-After', 'Content-Disposition'],
      maxAge: 86400,
    }),
  );
  app.use(
    '*',
    bodyLimit({
      maxSize: BODY_LIMIT,
      onError: (c) => c.json({ error: 'The request is too large (max about 2 MB). Send less at once.' }, 413),
    }),
  );
  app.use('*', async (c, next) => {
    await next();
    // public stats may be cached briefly; everything else is personal
    if (!c.res.headers.get('Cache-Control')) c.header('Cache-Control', 'no-store');
  });

  app.get('/', (c) => c.json({ name: 'Spine API', health: '/health' }));
  app.get('/health', async (c) => {
    try {
      await db.query('SELECT 1');
      return c.json({ ok: true, db: db.kind });
    } catch (err) {
      return c.json({ ok: false, db: db.kind, error: err instanceof HttpError ? err.message : 'The database is not reachable.' }, 503);
    }
  });

  authRoutes(app, ctx);
  meRoutes(app, ctx);
  syncRoutes(app, ctx);
  linkRoutes(app, ctx);
  readRoutes(app, ctx);
  textRoutes(app, { ...ctx, fetch });
  visitRoutes(app, ctx);

  app.notFound((c) => c.json({ error: `There's no ${c.req.method} ${c.req.path} endpoint. See server/API.md for the list.` }, 404));
  app.onError((err, c) => {
    if (err instanceof HttpError) {
      for (const [k, v] of Object.entries(err.headers)) c.header(k, v);
      return c.json({ error: err.message }, err.status);
    }
    log.error?.('Unhandled error on', c.req.method, c.req.path, err);
    return c.json({ error: 'Something went wrong on our side. Please try again in a moment.' }, 500);
  });

  return app;
}

/** The database configured by the environment: Postgres if DATABASE_URL is set, else PGlite in server/.data. */
export function dbFromEnv(config = loadConfig()) {
  if (!config.databaseUrl && config.onVercel) {
    const fail = async () => {
      throw new HttpError(503, 'The server has no database yet. Set DATABASE_URL in the Vercel project settings and redeploy.');
    };
    return { kind: 'postgres', query: fail, exec: fail, tx: fail, connect: fail, close: async () => {} };
  }
  return openDb({ url: config.databaseUrl, dataDir: config.dataDir });
}

const config = loadConfig();
const app = createApp({ db: dbFromEnv(config), config });
export default app;
