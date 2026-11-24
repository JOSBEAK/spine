// Local server: `npm start` (or `npm run dev` to restart on changes). Listens on PORT, default 8787.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { serve } = await import('@hono/node-server');
const { createApp, dbFromEnv } = await import('./app.js');
const { loadConfig } = await import('./config.js');

const config = loadConfig();
const db = dbFromEnv(config);
try {
  await db.connect();
} catch (err) {
  console.error(`Could not open the ${db.kind} database: ${err.message}`);
  process.exit(1);
}
const app = createApp({ db, config });

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  const where = db.kind === 'pglite' ? `PGlite in ${config.dataDir}` : 'Postgres (DATABASE_URL)';
  console.log(`Spine API listening on http://localhost:${info.port}  database: ${where}`);
});

async function shutdown() {
  server.close();
  await db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
