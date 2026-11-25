// Footfall: the site reports each time it is opened. Nothing about it is shown on the site;
// the owner reads it with `npm run footfall` (scripts/footfall.js).
//
//   POST /visits   { visitor, first, landing, referrer, source }   -> 204

import { z } from 'zod';
import { readJson, parse } from './http.js';
import { optionalUser, clientIp } from './auth.js';
import { underHourlyLimit } from './reads.js';

const IP_LIMIT = 240; // opens per IP per hour; past that they are quietly not stored
const KEEP_DAYS = 400;
const DAY_MS = 86400 * 1000;

const short = (n) => z.string().trim().max(n).optional().nullable();
const VisitBody = z.object({
  visitor: z.uuid({ error: 'visitor must be the random id this browser made (a UUID)' }),
  first: z.boolean().optional(),
  landing: short(40),
  referrer: short(200),
  source: short(60),
});

const SCREENS = new Set(['home', 'discover', 'library', 'sources', 'account', 'book', 'read', 'scan', 'listen']);
const landingOf = (s) => {
  const k = String(s || '').replace(/^#?\/?/, '').split(/[/?]/)[0].toLowerCase() || 'home';
  return SCREENS.has(k) ? k : 'other';
};

/** Only the host of the referring page, and not our own. */
function referrerHost(r, own) {
  if (!r) return null;
  try {
    const h = new URL(r).hostname.toLowerCase().replace(/^www\./, '');
    return own.some((o) => h === o || h.endsWith('.' + o)) ? null : h.slice(0, 120);
  } catch { return null; }
}

function deviceOf(ua = '') {
  if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return 'phone';
  return 'desktop';
}

export function visitRoutes(app, ctx) {
  const own = ['spinebrew.com', 'josbeak.github.io', 'localhost'];

  app.post('/visits', async (c) => {
    const body = parse(VisitBody, await readJson(c));
    const user = await optionalUser(ctx, c);
    const now = ctx.now();
    const country = (c.req.header('x-vercel-ip-country') || '').toUpperCase();
    await ctx.db.tx(async (q) => {
      if (!(await underHourlyLimit(q, `visits|${clientIp(c, ctx.config.trustProxy)}`, IP_LIMIT, now))) return;
      await q.query(
        `INSERT INTO visits (at, visitor, user_id, first_visit, landing, referrer, source, country, device)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          now.toISOString(), body.visitor, user?.id || null, !!body.first, landingOf(body.landing),
          referrerHost(body.referrer, own), body.source ? body.source.toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 40) || null : null,
          /^[A-Z]{2}$/.test(country) ? country : null, deviceOf(c.req.header('user-agent')),
        ],
      );
      // prune now and then, not on every open
      if (Math.random() < 0.01) await q.query('DELETE FROM visits WHERE at < $1', [new Date(+now - KEEP_DAYS * DAY_MS).toISOString()]);
    });
    return c.body(null, 204);
  });
}
