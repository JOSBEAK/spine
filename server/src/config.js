// Configuration from environment variables. See .env.example.

import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_ORIGINS = 'https://spinebrew.com,https://www.spinebrew.com,https://josbeak.github.io,http://localhost:5178,http://localhost:5173';
const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v || ''));

export function loadConfig(env = process.env) {
  return {
    databaseUrl: env.DATABASE_URL || '',
    dataDir: env.PGLITE_DIR ? path.resolve(env.PGLITE_DIR) : path.join(SERVER_ROOT, '.data'),
    allowedOrigins: (env.ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean),
    // Only trust X-Forwarded-For behind a proxy that sets it (Vercel does). Otherwise clients could fake it.
    trustProxy: env.TRUST_PROXY != null && env.TRUST_PROXY !== '' ? truthy(env.TRUST_PROXY) : Boolean(env.VERCEL),
    port: Number(env.PORT || 8787),
    // CSV imports stop starting new Open Library lookups after this long (keep below the platform timeout).
    importBudgetMs: Number(env.IMPORT_BUDGET_MS || 240000),
    userAgent: 'Spine/1.0 (+https://spinebrew.com)',
    onVercel: Boolean(env.VERCEL),
  };
}
